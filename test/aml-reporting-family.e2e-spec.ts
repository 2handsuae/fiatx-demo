import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 必须在任何读 DATABASE_URL 的 import 之前执行（同 sanction-subject-split.e2e-spec.ts）。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-aml-reporting-family.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（照 sanction-subject-split.e2e-spec.ts 先例）───────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[aml-reporting-family e2e] 拒绝运行：本 suite 会写入客户/限制/报送台数据，但 ` +
      `DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。`,
  );
}

// Node 18 polyfill（@nestjs/schedule 需要 globalThis.crypto），同波二/波三既有 e2e 头注释。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';

import { RegulatoryFilingService } from '../src/modules/governance/regulatory-filings/regulatory-filing.service';
import { FilingEntryKinds } from '../src/modules/governance/regulatory-filings/regulatory-filing.constants';
import { addBusinessDays } from '../src/modules/governance/regulatory-filings/business-days';

import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext, ApprovalStatuses } from '../src/modules/governance/approvals/constants/approval.constants';

import { SanctionDispositionWorkflowService } from '../src/modules/identity/customers/sanction-disposition-workflow.service';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../src/modules/identity/customers/customer-restriction-workflow.service';
import { CustomerAccessService } from '../src/modules/identity/customers/customer-access.service';
import { RESTRICTION_CAUSE_POLICY } from '../src/modules/identity/customers/constants/restriction-cause.constant';

import { MaterialRequestsService } from '../src/modules/identity/material-requests/material-requests.service';

import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';

import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * 战役甲波三 · Task 8：报文族联动 e2e（真 AppModule，零 mock，独立库 —— 见 test/e2e-db.ts）。
 *
 * 覆盖波三 T3（族独占/closeNoFiling/openForSanction）、T4+修1（定性三出口/409 防重/
 * impact 快照/DECIDED 角色回退/requiredFields 守 approvalNo/精确按 approvalNo 取快照）、
 * T5（entries 分 kind 规则表）、T7（⚡ EOCN 端点）的运行时行为，六段结构照波二先例
 * （regulatory-filing.e2e-spec.ts）：真 app.init()、直调各主体 service（合规官/MLRO
 * 两个 actor 用种子里真实的 compliance_lead@fiatx.com / mlro@fiatx.com，因为
 * RegulatoryFilingService.assertFamily 与 openForSanction 都按真实 userId 查
 * AccessControlService.hasPermission，捏造 id 查不到任何角色绑定）。
 *
 * ⚡ EOCN 命中一段走真实 HTTP（supertest + /auth/login），其余全部直调 service ——
 * 与 incident-register.e2e-spec.ts 用例 7 的"真实 HTTP 权限探针"同一套取舍：guard 层
 * 已经在别的 e2e 里验证过，本文件的重点是族独占/状态机/定性三出口这些服务层行为。
 */
describe('AML reporting family e2e (战役甲波三 · 报文族联动, Task 8)', () => {
  jest.setTimeout(120000);

  let app: INestApplication;
  let prisma: PrismaService;
  let filings: RegulatoryFilingService;
  let approvalsService: ApprovalsService;
  let dispositionWorkflow: SanctionDispositionWorkflowService;
  let restrictionsService: CustomerRestrictionsService;
  let restrictionWorkflow: CustomerRestrictionWorkflowService;
  let customerAccess: CustomerAccessService;
  let materialRequests: MaterialRequestsService;
  let deposits: DepositTransactionsService;

  let complianceUserId: string;
  let complianceUserNo: string;
  let mlroUserId: string;
  let mlroUserNo: string;
  const compliance = (): ApprovalActorContext => makeActor(complianceUserId, complianceUserNo, 'COMPLIANCE_OFFICER');
  const mlro = (): ApprovalActorContext => makeActor(mlroUserId, mlroUserNo, 'MLRO');

  let fiatAssetId: string;
  const RUN_TAG = Date.now().toString(36);
  let custSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    filings = app.get(RegulatoryFilingService);
    approvalsService = app.get(ApprovalsService);
    dispositionWorkflow = app.get(SanctionDispositionWorkflowService);
    restrictionsService = app.get(CustomerRestrictionsService);
    restrictionWorkflow = app.get(CustomerRestrictionWorkflowService);
    customerAccess = app.get(CustomerAccessService);
    materialRequests = app.get(MaterialRequestsService);
    deposits = app.get(DepositTransactionsService);

    // 真查种子管理员（COMPLIANCE_OFFICER/MLRO）——assertFamily/openForSanction 走真实
    // hasPermission(userId, cap.filing.*) DB 查，捏造 id 查不到角色绑定（同波二先例）。
    const [complianceUser, mlroUser] = await Promise.all([
      (prisma as any).user.findFirst({ where: { email: 'compliance_lead@fiatx.com' } }),
      (prisma as any).user.findFirst({ where: { email: 'mlro@fiatx.com' } }),
    ]);
    if (!complianceUser || !mlroUser) {
      throw new Error(
        'Fixture role-seed admins (COMPLIANCE_OFFICER/MLRO) not seeded on the e2e DB — run ' +
          '`DATABASE_URL="file:/tmp/exchange_js_wt_act-a-wave3/e2e-aml-reporting-family.db" npm run db:base:sync` first.',
      );
    }
    complianceUserId = complianceUser.id; complianceUserNo = complianceUser.userNo;
    mlroUserId = mlroUser.id; mlroUserNo = mlroUser.userNo;

    // 自建最小 AED 资产行（不经 db:biz:init / TigerBeetle——本波报文族零账务，客户面
    // PROCESSING 收敛检查只需要一笔挂着的充值单，不需要真余额）。
    const asset = await prisma.asset.upsert({
      where: { code: 'AED' },
      create: { assetNo: 'AST-E2E-AML-AED', type: 'FIAT', currency: 'AED', code: 'AED', network: 'AED_ZAND', decimals: 2, status: 'ACTIVE' },
      update: {},
      select: { id: true },
    } as any);
    fiatAssetId = (asset as any).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  // ── helpers ────────────────────────────────────────────────────────────

  function makeActor(userId: string, userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function auditActionsFor(filingNo: string): Promise<string[]> {
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: any) => r.action as string);
  }

  /** 等 SANCTION_DISPOSITION_LANDED 落库并回它的 metadata（三出口各自的落地摘要）。 */
  async function waitForLanded(customerNo: string, approvalNo: string): Promise<Record<string, any>> {
    await waitUntil(async () => {
      const row = await (prisma as any).auditLogEvent.findFirst({
        where: { primarySubjectNo: customerNo, action: AuditActions.SANCTION_DISPOSITION_LANDED, approvalNo },
      });
      return !!row;
    });
    const row = await (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectNo: customerNo, action: AuditActions.SANCTION_DISPOSITION_LANDED, approvalNo },
    });
    return JSON.parse(row.metadata as string);
  }

  async function makeActiveCustomer(tag: string, opts: { withSumsubApplicant?: boolean } = {}): Promise<{ id: string; customerNo: string }> {
    custSeq += 1;
    const email = `e2e_aml_${RUN_TAG}_${tag}@example.com`;
    return prisma.customerMain.create({
      data: {
        email,
        customerNo: buildDeterministicNo('CU', email),
        // 含 RUN_TAG（每次进程启动都变）——避免同一个持久化 e2e 库被反复起跑时，
        // 上一轮遗留行与本轮撞 phone 唯一约束（customerNo 本身已含 RUN_TAG 不会撞，
        // 但 phone 是独立唯一列，不能只看 custSeq）。
        phone: `+1${RUN_TAG}${String(custSeq).padStart(3, '0')}`,
        firstName: 'Pat', lastName: 'Sample',
        customerType: 'INDIVIDUAL', lifecycle: 'ACTIVE', riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
        ...(opts.withSumsubApplicant ? { sumsubApplicantId: `sumsub-e2e-${RUN_TAG}-${tag}` } : {}),
      },
      select: { id: true, customerNo: true },
    } as any);
  }

  /** 每客户一个钱包（(vaultCode, network, ownerNo) 唯一约束），缓存复用。 */
  const walletIdByCustomer = new Map<string, string>();
  async function ensureWallet(c: { id: string; customerNo: string }): Promise<string> {
    const cached = walletIdByCustomer.get(c.customerNo);
    if (cached) return cached;
    const wallet = await prisma.wallet.create({
      data: {
        walletNo: `WA-E2E-AML-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND',
        iban: `AE_E2E_AML_${c.customerNo}`, status: 'ACTIVE',
      },
    } as any);
    walletIdByCustomer.set(c.customerNo, (wallet as any).id);
    return (wallet as any).id;
  }

  /** COMPLIANCE_PENDING 挂账充值 fixture（不动账本/TigerBeetle）——供客户面冻结期收敛断言。 */
  async function makeDeposit(c: { id: string; customerNo: string }, amount: string): Promise<{ id: string; depositNo: string }> {
    const walletId = await ensureWallet(c);
    const depositNo = generateReferenceNo('DEP');
    return prisma.depositTransaction.create({
      data: {
        depositNo, traceId: depositNo, correlationId: randomUUID(),
        ownerType: 'CUSTOMER', ownerId: c.id,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        assetId: fiatAssetId, toWalletId: walletId,
        amount: new Prisma.Decimal(amount), netAmount: new Prisma.Decimal(amount), feeAmount: new Prisma.Decimal(0),
      },
      select: { id: true, depositNo: true },
    } as any);
  }

  async function loginAdmin(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: '123456' });
    if (!res.body?.access_token) throw new Error(`login ${email} failed: ${JSON.stringify(res.body)}`);
    return res.body.access_token as string;
  }

  // ── ① B 线确认全链（CONFIRMED）────────────────────────────────────────

  describe('① B 线确认全链：⚡命中→定性 CONFIRMED→MLRO 批→便签翻牌+CNMR→标已提交→回执→close', () => {
    let c1: { id: string; customerNo: string };
    let oldRestrictionNo: string;
    let oldRestrictionOpenedAt: Date;
    let newRestrictionNo: string;
    let cnmrFilingNo: string;
    let confirmApprovalNo: string;

    it('⚡ 真打 T7 端点命中存量 ACTIVE 客户 → 贴 SILENT SANCTION 便签', async () => {
      c1 = await makeActiveCustomer('confirm');
      const token = await loginAdmin('compliance_lead@fiatx.com');
      const res = await request(app.getHttpServer())
        .post('/admin/sumsub/simulate/eocn-sanctions-hit')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerNo: c1.customerNo, listRef: 'EOCN-LIST-2026-09-C1' });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      oldRestrictionNo = res.body.restrictionNo;

      const row = await restrictionsService.findByNo(oldRestrictionNo);
      expect(row).not.toBeNull();
      expect(row!.cause).toBe('SANCTION');
      expect(row!.status).toBe('OPEN');
      expect(row!.visibility).toBe('SILENT');
      oldRestrictionOpenedAt = row!.openedAt;

      // 二次 ⚡ 命中同一客户 → 409（controller 显式拒绝，不是 open() 的静默幂等）。
      const dupToken = token;
      const dupRes = await request(app.getHttpServer())
        .post('/admin/sumsub/simulate/eocn-sanctions-hit')
        .set('Authorization', `Bearer ${dupToken}`)
        .send({ customerNo: c1.customerNo, listRef: 'EOCN-LIST-2026-09-C1-DUP' });
      expect(dupRes.status).toBe(409);
    });

    it('合规官提 CONFIRMED → MLRO 批 → 便签翻牌 SANCTION_CONFIRMED(DISCLOSED) + 开 CNMR', async () => {
      const externalCaseRef = 'EOCN-CASE-C1-001';
      const { approvalNo, restrictionNo } = await dispositionWorkflow.initiateDisposition(
        c1.customerNo, 'CONFIRMED', 'Name and DOB match confirmed against EOCN list entry', externalCaseRef, compliance(),
      );
      confirmApprovalNo = approvalNo;
      expect(restrictionNo).toBe(oldRestrictionNo);

      await approvalsService.approve(approvalNo, { reason: 'MLRO confirms sanctions match' }, mlro());
      const landed = await waitForLanded(c1.customerNo, approvalNo);
      newRestrictionNo = landed.restrictionNo;
      cnmrFilingNo = landed.filingNo;
      expect(landed.previousRestrictionNo).toBe(oldRestrictionNo);
      expect(cnmrFilingNo).toMatch(/^FIL/);

      // 旧 SANCTION 便签已释放；新 SANCTION_CONFIRMED 便签 DISCLOSED，customerLabel 非空。
      const oldRow = await restrictionsService.findByNo(oldRestrictionNo);
      expect(oldRow!.status).toBe('RELEASED');
      const newRow = await restrictionsService.findByNo(newRestrictionNo);
      expect(newRow!.cause).toBe('SANCTION_CONFIRMED');
      expect(newRow!.status).toBe('OPEN');
      expect(newRow!.visibility).toBe('DISCLOSED');
      expect(RESTRICTION_CAUSE_POLICY.SANCTION_CONFIRMED.customerLabel).toContain('confirmed sanctions match');

      // 客户面读口径（CustomerAccessService.resolve）确实会把它列进 disclosed——横幅可见依据。
      const access = await customerAccess.resolve(c1.id);
      const disclosedConfirmed = access.disclosed.find((d) => d.restrictionNo === newRestrictionNo);
      expect(disclosedConfirmed).toBeDefined();
      expect(disclosedConfirmed!.cause).toBe('SANCTION_CONFIRMED');
      expect(disclosedConfirmed!.label).toBe(RESTRICTION_CAUSE_POLICY.SANCTION_CONFIRMED.customerLabel);

      // CNMR 单真实存在（评审 P6：不能只看批准 200）——externalCaseRef 落库、
      // deadline = 便签 openedAt + 5 工作日（迪拜日历，真调 addBusinessDays）。
      const cnmrRow = await filings.findByNo(cnmrFilingNo);
      expect(cnmrRow.type).toBe('CNMR');
      expect(cnmrRow.status).toBe('DRAFT');
      expect(cnmrRow.externalCaseRef).toBe(externalCaseRef);
      expect(cnmrRow.deadlineAt).not.toBeNull();
      expect((cnmrRow.deadlineAt as Date).getTime()).toBe(addBusinessDays(oldRestrictionOpenedAt, 5).getTime());

      // FILING_OPENED（CNMR）与 SANCTION_DISPOSITION_LANDED 共享同一个 requestId——
      // 同一次裁决落地触发的两笔写入，真事件管线钉死，不是巧合的字符串相等。
      const filingOpenedRow = await (prisma as any).auditLogEvent.findFirst({
        where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: cnmrFilingNo, action: AuditActions.FILING_OPENED },
      });
      const landedRow = await (prisma as any).auditLogEvent.findFirst({
        where: { primarySubjectNo: c1.customerNo, action: AuditActions.SANCTION_DISPOSITION_LANDED, approvalNo },
      });
      expect(filingOpenedRow.requestId).toBe(landedRow.requestId);
      expect(filingOpenedRow.requestId).toBeTruthy();

      // 客户审计时间线 FROZEN/UNFROZEN 配对正确（T4 修1 后行为：判据按 customerLevel，
      // 不是字面量 cause==='SANCTION'）——旧便签一条 UNFROZEN，新便签一条 FROZEN，
      // 两者 metadata.restrictionNo 各自指向对应的便签号，不是"只见解冻不见重冻"的假解冻。
      const frozenRows = await (prisma as any).auditLogEvent.findMany({
        where: { primarySubjectNo: c1.customerNo, action: AuditActions.CUSTOMER_FROZEN },
        orderBy: { seq: 'asc' },
      });
      const unfrozenRows = await (prisma as any).auditLogEvent.findMany({
        where: { primarySubjectNo: c1.customerNo, action: AuditActions.CUSTOMER_UNFROZEN },
        orderBy: { seq: 'asc' },
      });
      const frozenRestrictionNos = frozenRows.map((r: any) => JSON.parse(r.metadata).restrictionNo);
      const unfrozenRestrictionNos = unfrozenRows.map((r: any) => JSON.parse(r.metadata).restrictionNo);
      expect(frozenRestrictionNos).toContain(oldRestrictionNo);
      expect(frozenRestrictionNos).toContain(newRestrictionNo);
      expect(unfrozenRestrictionNos).toContain(oldRestrictionNo);
      expect(unfrozenRestrictionNos).not.toContain(newRestrictionNo);
    });

    it('MLRO 标已提交（回执 externalRef）→ RECEIPT_ACK 记录 → close', async () => {
      const submitResult = await filings.markSubmitted(cnmrFilingNo, { externalRef: 'EOCN-ACK-CNMR-C1-001' }, mlro());
      expect(submitResult.filingNo).toBe(cnmrFilingNo);
      expect((await filings.findByNo(cnmrFilingNo)).status).toBe('SUBMITTED');

      await filings.addEntry(cnmrFilingNo, { kind: FilingEntryKinds.RECEIPT_ACK, body: 'EOCN acknowledged CNMR receipt' }, mlro());
      await filings.close(cnmrFilingNo, mlro());
      expect((await filings.findByNo(cnmrFilingNo)).status).toBe('CLOSED');

      const actions = await auditActionsFor(cnmrFilingNo);
      expect(actions).toEqual([
        AuditActions.FILING_OPENED, AuditActions.FILING_SUBMITTED, AuditActions.FILING_ENTRY_LOGGED, AuditActions.FILING_CLOSED,
      ]);
    });
  });

  // ── ② B 线部分→指令→排除（PARTIAL 二次定性 CLEARED，客户面全程）──────────

  describe('② B 线部分→指令→排除：⚡命中→PARTIAL(PNMR+补料)→AUTHORITY_INSTRUCTION→二次定性 CLEARED→客户面全程无感', () => {
    let c2: { id: string; customerNo: string };
    let restrictionNo: string;
    let restrictionOpenedAt: Date;
    let depositId: string;
    let plainDepositNo: string;
    let frozenDepositNo: string;
    let partialApprovalNo: string;
    let pnmrFilingNo: string;
    let clearApprovalNo: string;

    it('⚡ 命中（直调 workflow）→ 在途充值随后被广播冻结', async () => {
      c2 = await makeActiveCustomer('partial', { withSumsubApplicant: true });
      // 命中前先挂一笔在途充值（COMPLIANCE_PENDING）——⚡ 广播会把它冻住，验证"冻结期
      // 交易视图收敛不可区分"。
      const plainDep = await makeDeposit(c2, '400');
      plainDepositNo = plainDep.depositNo; // 对照组：全程不冻，留着跟冻结单同桶比对
      const dep = await makeDeposit(c2, '5000');
      depositId = dep.id;
      frozenDepositNo = dep.depositNo;

      const opened = await restrictionWorkflow.openRestriction(
        { customerId: c2.id, cause: 'SANCTION', reason: 'EOCN sanctions list update (e2e partial scenario)', caseRef: 'EOCN-LIST-C2', openedBy: compliance().userNo! },
        compliance(),
      );
      restrictionNo = opened.restrictionNo;
      const row = await restrictionsService.findByNo(restrictionNo);
      expect(row!.status).toBe('OPEN');
      restrictionOpenedAt = row!.openedAt;

      await waitUntil(async () => (await prisma.depositTransaction.findUnique({ where: { id: depositId } }))!.status === 'FROZEN');
    });

    it('客户面全程：冻结期交易视图收敛（PROCESSING 桶），不可区分', async () => {
      const view = await deposits.findAllForCustomer(c2.id, { bucket: 'PROCESSING' } as any);
      const byNo = new Map(view.items.map((i: any) => [i.depositNo, i.status]));
      expect(byNo.get(frozenDepositNo)).toBe('COMPLIANCE_PENDING'); // 不是 'FROZEN' 字面量
      expect(byNo.get(plainDepositNo)).toBe('COMPLIANCE_PENDING'); // 两者收敛后同一个状态，无法区分
      expect(Array.from(byNo.values())).not.toContain('FROZEN');
    });

    it('合规官提 PARTIAL → MLRO 批 → SANCTION 便签维持 SILENT/OPEN + 开 PNMR + 自动发中性补料', async () => {
      const externalCaseRef = 'EOCN-CASE-C2-001';
      const { approvalNo } = await dispositionWorkflow.initiateDisposition(
        c2.customerNo, 'PARTIAL', 'Partial name/DOB match — verification in progress', externalCaseRef, compliance(),
      );
      partialApprovalNo = approvalNo;
      await approvalsService.approve(approvalNo, { reason: 'MLRO approves partial disposition' }, mlro());
      const landed = await waitForLanded(c2.customerNo, approvalNo);
      pnmrFilingNo = landed.filingNo;
      expect(landed.restrictionNo).toBe(restrictionNo);
      expect(landed.materialRequestNo).toMatch(/^MRQ|^REQ|.+/); // 存在即可，前缀由 no-generator 决定，不在本测试断言口径内

      // 便签原样 SILENT/OPEN——PARTIAL 不翻牌。
      const row = await restrictionsService.findByNo(restrictionNo);
      expect(row!.status).toBe('OPEN');
      expect(row!.cause).toBe('SANCTION');
      expect(row!.visibility).toBe('SILENT');

      // PNMR 单真实存在 + 锚断言（锚＝便签 openedAt，非批准时刻）。
      const pnmrRow = await filings.findByNo(pnmrFilingNo);
      expect(pnmrRow.type).toBe('PNMR');
      expect(pnmrRow.status).toBe('DRAFT');
      expect(pnmrRow.externalCaseRef).toBe(externalCaseRef);
      expect((pnmrRow.deadlineAt as Date).getTime()).toBe(addBusinessDays(restrictionOpenedAt, 5).getTime());

      // 补料请求已发：中性话术、restrictionNo=null（restrict:false，不重复摁）——
      // 即客户面 blocking:false，reason 无 sanction/filing 词根。
      const live = await materialRequests.listLiveByCustomer(c2.id);
      const mr = live.find((r) => r.materialType === 'EMIRATES_ID');
      expect(mr).toBeDefined();
      expect(mr!.restrictionNo).toBeNull();
      expect(mr!.reason.toLowerCase()).not.toMatch(/sanction|filing/);
    });

    it('AUTHORITY_INSTRUCTION 记录（PNMR 非终态可追加）', async () => {
      await filings.addEntry(
        pnmrFilingNo,
        { kind: FilingEntryKinds.AUTHORITY_INSTRUCTION, body: 'EOCN instructs: submitted ID sufficiently distinguishes the customer from the list entry — proceed to clear' },
        mlro(),
      );
      const view = await filings.getView(pnmrFilingNo);
      const instr = view.entries.find((e: any) => e.kind === FilingEntryKinds.AUTHORITY_INSTRUCTION);
      expect(instr).toBeDefined();
      expect(instr!.commDraftedBy).toBeNull();
    });

    it('二次定性 CLEARED（同一张便签）→ MLRO 批 → 解除落地，releaseApprovalNo=第二张定性单号，PNMR 保留', async () => {
      const { approvalNo, restrictionNo: sameRestrictionNo } = await dispositionWorkflow.initiateDisposition(
        c2.customerNo, 'CLEARED', 'EOCN instruction confirms no match — clearing per authority instruction', 'EOCN-CASE-C2-001', compliance(),
      );
      clearApprovalNo = approvalNo;
      expect(sameRestrictionNo).toBe(restrictionNo);
      expect(approvalNo).not.toBe(partialApprovalNo);

      await approvalsService.approve(approvalNo, { reason: 'MLRO approves clearance per EOCN instruction' }, mlro());
      await waitUntil(async () => (await restrictionsService.findByNo(restrictionNo))!.status === 'RELEASED');

      const row = await restrictionsService.findByNo(restrictionNo);
      expect(row!.status).toBe('RELEASED');
      expect(row!.releaseApprovalNo).toBe(clearApprovalNo); // 第二张定性单号，不是第一张 PARTIAL 的
      expect(row!.releaseApprovalNo).not.toBe(partialApprovalNo);
      expect(row!.releaseMode).toBe('MANUAL');

      // PNMR 单不受二次定性影响，原样保留（DRAFT，未被撤/改）。
      const pnmrRow = await filings.findByNo(pnmrFilingNo);
      expect(pnmrRow.status).toBe('DRAFT');
      expect(pnmrRow.filingNo).toBe(pnmrFilingNo);

      // 未翻出 SANCTION_CONFIRMED 新便签——CLEARED 出口不开新便签。
      const confirmedRow = await restrictionsService.findOpenByCause(c2.id, 'SANCTION_CONFIRMED' as any, null);
      expect(confirmedRow).toBeNull();
    });
  });

  // ── ③ A 线 STR 全链（无签发链）────────────────────────────────────────

  describe('③ A 线 STR 全链：MLRO 开→DRAFT 直达标已提交→CUSTOMER_COMM+回执→close，全生命周期零审批单', () => {
    let strFilingNo: string;

    it('MLRO 开 STR（externalCaseRef 必填）→ DRAFT 直达标已提交（无签发链）', async () => {
      await expect(filings.openManual({ type: 'STR' } as any, mlro())).rejects.toThrow(/externalCaseRef/);

      const { filingNo } = await filings.openManual(
        { type: 'STR', title: 'e2e 可疑交易报告', externalCaseRef: 'SUMSUB-CASE-STR-C3-001' } as any,
        mlro(),
      );
      strFilingNo = filingNo;
      const row = await filings.findByNo(strFilingNo);
      expect(row.status).toBe('DRAFT');
      expect(row.authority).toBe('UAE_FIU');
      expect(row.externalCaseRef).toBe('SUMSUB-CASE-STR-C3-001');

      await filings.saveDraft(strFilingNo, '事件时间线：客户在短时间内经多笔小额交易累计转出异常大额，形成可疑怀疑。', mlro());

      // AML 族 DRAFT→SUBMITTED 是族边集里的合法边——直达，不经过 PENDING_SIGNOFF/SIGNED_OFF。
      await filings.markSubmitted(strFilingNo, { externalRef: 'GOAML-ACK-STR-C3-001' }, mlro());
      expect((await filings.findByNo(strFilingNo)).status).toBe('SUBMITTED');
    });

    it('CUSTOMER_COMM 必填 commDraftedBy（MLRO 亲录预审）与回执 → close', async () => {
      await expect(
        filings.addEntry(strFilingNo, { kind: FilingEntryKinds.CUSTOMER_COMM, body: 'Advised customer their account review is ongoing.' } as any, mlro()),
      ).rejects.toThrow(/commDraftedBy/);

      await filings.addEntry(
        strFilingNo,
        { kind: FilingEntryKinds.CUSTOMER_COMM, body: 'Advised customer their account review is ongoing; no mention of any report.', commDraftedBy: 'MLRO (self-recorded predraft)' } as any,
        mlro(),
      );
      const view = await filings.getView(strFilingNo);
      const comm = view.entries.find((e: any) => e.kind === FilingEntryKinds.CUSTOMER_COMM);
      expect(comm!.commDraftedBy).toBe('MLRO (self-recorded predraft)');
      expect(comm!.recordedByUserId).toBe(mlroUserNo);

      await filings.addEntry(strFilingNo, { kind: FilingEntryKinds.RECEIPT_ACK, body: 'goAML acknowledged STR receipt' } as any, mlro());
      await filings.close(strFilingNo, mlro());
      expect((await filings.findByNo(strFilingNo)).status).toBe('CLOSED');
    });

    it('全生命周期零审批单（AML 单无签发链，entityRef 查 REG_FILING_SUBMIT total=0）', async () => {
      const { total } = await approvalsService.list({ actionType: ApprovalActionTypes.REG_FILING_SUBMIT, entityRef: strFilingNo } as any);
      expect(total).toBe(0);

      const actions = await auditActionsFor(strFilingNo);
      expect(actions).toEqual([
        AuditActions.FILING_OPENED, AuditActions.FILING_DRAFT_SAVED, AuditActions.FILING_SUBMITTED,
        AuditActions.FILING_ENTRY_LOGGED, AuditActions.FILING_ENTRY_LOGGED, AuditActions.FILING_CLOSED,
      ]);
    });
  });

  // ── ④ 不报结案（closeNoFiling 理由闸 + 态限）──────────────────────────

  describe('④ 不报结案：DRAFT→CLOSED 理由必填闸；SUBMITTED 态拒；CNMR（不允许类型）调它拒', () => {
    it('STR 开单 → closeNoFiling 空理由 400 → 带理由 → CLOSED，审计 reason=理由', async () => {
      const { filingNo } = await filings.openManual({ type: 'STR', title: 'e2e 决定不报', externalCaseRef: 'SUMSUB-CASE-STR-NOFILE-001' } as any, mlro());

      await expect(filings.closeNoFiling(filingNo, '', mlro())).rejects.toThrow(/noFilingReason/);

      const reasonText = 'On review, the pattern was explained by a legitimate business invoice; no suspicion formed.';
      await filings.closeNoFiling(filingNo, reasonText, mlro());
      const row = await filings.findByNo(filingNo);
      expect(row.status).toBe('CLOSED');
      expect(row.noFilingReason).toBe(reasonText);

      const auditRow = await (prisma as any).auditLogEvent.findFirst({
        where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo, action: AuditActions.FILING_CLOSED_NO_FILING },
      });
      expect(auditRow.reason).toBe(reasonText);
    });

    it('SUBMITTED 态 STR 调 closeNoFiling → 400（只有 DRAFT 单能走这条边）', async () => {
      const { filingNo } = await filings.openManual({ type: 'STR', title: 'e2e 已提交单拒不报', externalCaseRef: 'SUMSUB-CASE-STR-SUBMITTED-001' } as any, mlro());
      await filings.markSubmitted(filingNo, { externalRef: 'GOAML-ACK-SUBMITTED-001' }, mlro());
      expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED');

      await expect(filings.closeNoFiling(filingNo, 'trying anyway', mlro())).rejects.toThrow(BadRequestException);
      expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED'); // 原地不动
    });

    it('CNMR（allowNoFilingClose=false 的类型）调 closeNoFiling → 400', async () => {
      const { filingNo } = await filings.openManual({ type: 'CNMR', externalCaseRef: 'EOCN-MANUAL-NOFILE-TEST' } as any, mlro());
      await expect(filings.closeNoFiling(filingNo, 'CNMR is a mandatory filing, this should never succeed', mlro())).rejects.toThrow(/does not allow a no-filing close/);
    });
  });

  // ── ⑤ 越界双向（服务层族拒）─────────────────────────────────────────

  describe('⑤ 越界双向：合规官打 AML 写动作 403、MLRO 打 GENERAL 写动作 403（服务层族拒）；GENERAL 单打新两 kind 拒', () => {
    it('合规官 openManual(STR) → 403（cap.filing.aml 缺失）', async () => {
      await expect(
        filings.openManual({ type: 'STR', title: 'e2e 越界', externalCaseRef: 'X' } as any, compliance()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('MLRO openManual(MATERIAL_CHANGE_NOTIFICATION，GENERAL 族) → 403（cap.filing.general 缺失）', async () => {
      await expect(
        filings.openManual({ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'e2e 越界' } as any, mlro()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('GENERAL 单打 CUSTOMER_COMM/AUTHORITY_INSTRUCTION 两新 kind → 400（两 kind 仅 AML 族）', async () => {
      const { filingNo } = await filings.openManual({ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'e2e GENERAL 单打新 kind' } as any, compliance());
      await expect(
        filings.addEntry(filingNo, { kind: FilingEntryKinds.CUSTOMER_COMM, body: 'x', commDraftedBy: 'y' } as any, compliance()),
      ).rejects.toThrow(/not available for GENERAL family/);
      await expect(
        filings.addEntry(filingNo, { kind: FilingEntryKinds.AUTHORITY_INSTRUCTION, body: 'x' } as any, compliance()),
      ).rejects.toThrow(/not available for GENERAL family/);
    });
  });

  // ── ⑥ 审批与 SoD ────────────────────────────────────────────────────

  describe('⑥ 审批与 SoD：MLRO 自提自批 403；待决期间重复提单 409；驳回/撤单后便签保持 OPEN；手工链缺 releaseOrderRef 400', () => {
    it('MLRO 自提定性单后自批 → 403（SoD 真拦，便签原样 OPEN）', async () => {
      const c3 = await makeActiveCustomer('sod');
      const opened = await restrictionWorkflow.openRestriction(
        { customerId: c3.id, cause: 'SANCTION', reason: 'e2e SoD probe', caseRef: 'EOCN-LIST-C3', openedBy: mlro().userNo! },
        mlro(),
      );

      const { approvalNo } = await dispositionWorkflow.initiateDisposition(c3.customerNo, 'CLEARED', 'e2e self-submit probe', 'EOCN-CASE-C3-SOD', mlro());

      await expect(approvalsService.approve(approvalNo, { reason: 'MLRO tries to approve own submission' }, mlro()))
        .rejects.toMatchObject({ message: 'Maker and checker must be different users' });

      const row = await restrictionsService.findByNo(opened.restrictionNo);
      expect(row!.status).toBe('OPEN'); // 裁决失败，未落地

      // 待决期间重复提单 → 409（同一张便签同 customerNo，上面那张案仍 PENDING）。
      await expect(
        dispositionWorkflow.initiateDisposition(c3.customerNo, 'PARTIAL', 'e2e duplicate submission probe', 'EOCN-CASE-C3-DUP', compliance()),
      ).rejects.toThrow(ConflictException);
    });

    it('驳回后 SANCTION 便签保持 OPEN', async () => {
      const c4 = await makeActiveCustomer('reject');
      const opened = await restrictionWorkflow.openRestriction(
        { customerId: c4.id, cause: 'SANCTION', reason: 'e2e reject probe', caseRef: 'EOCN-LIST-C4', openedBy: compliance().userNo! },
        compliance(),
      );
      const { approvalNo } = await dispositionWorkflow.initiateDisposition(c4.customerNo, 'CLEARED', 'e2e reject probe', 'EOCN-CASE-C4', compliance());
      await approvalsService.reject(approvalNo, { reason: 'Insufficient evidence to clear' }, mlro());

      await waitUntil(async () => {
        const row = await (prisma as any).auditLogEvent.findFirst({
          where: { primarySubjectNo: c4.customerNo, action: AuditActions.SANCTION_DISPOSITION_DECIDED, approvalNo },
        });
        return !!row;
      });
      const row = await restrictionsService.findByNo(opened.restrictionNo);
      expect(row!.status).toBe('OPEN');
    });

    it('撤单后 SANCTION 便签保持 OPEN', async () => {
      const c5 = await makeActiveCustomer('cancel');
      const opened = await restrictionWorkflow.openRestriction(
        { customerId: c5.id, cause: 'SANCTION', reason: 'e2e cancel probe', caseRef: 'EOCN-LIST-C5', openedBy: compliance().userNo! },
        compliance(),
      );
      const { approvalNo } = await dispositionWorkflow.initiateDisposition(c5.customerNo, 'PARTIAL', 'e2e cancel probe', 'EOCN-CASE-C5', compliance());
      await approvalsService.cancel(approvalNo, { reason: 'Withdrawing pending more evidence' }, compliance());

      await waitUntil(async () => {
        const row = await (prisma as any).auditLogEvent.findFirst({
          where: { primarySubjectNo: c5.customerNo, action: AuditActions.SANCTION_DISPOSITION_DECIDED, approvalNo },
        });
        return !!row;
      });
      const row = await restrictionsService.findByNo(opened.restrictionNo);
      expect(row!.status).toBe('OPEN');
    });

    it('评审清单第 8 条：SANCTION_CONFIRMED 手工解除链缺 releaseOrderRef → 400（政府文书闸原样把关）', async () => {
      const c6 = await makeActiveCustomer('manual-release');
      const opened = await restrictionWorkflow.openRestriction(
        { customerId: c6.id, cause: 'SANCTION', reason: 'e2e manual-release probe', caseRef: 'EOCN-LIST-C6', openedBy: compliance().userNo! },
        compliance(),
      );
      const { approvalNo } = await dispositionWorkflow.initiateDisposition(c6.customerNo, 'CONFIRMED', 'e2e manual-release probe', 'EOCN-CASE-C6', compliance());
      await approvalsService.approve(approvalNo, { reason: 'MLRO confirms' }, mlro());
      const landed = await waitForLanded(c6.customerNo, approvalNo);
      const confirmedRestrictionNo = landed.restrictionNo as string;
      expect(opened.restrictionNo).not.toBe(confirmedRestrictionNo);

      // 手工解除链（initiateRelease）对 SANCTION_CONFIRMED（MLRO_APPROVAL 政策）缺
      // releaseOrderRef 应 400——同一道政府文书闸，本因由未被制裁定性链绕过。
      await expect(
        restrictionWorkflow.initiateRelease(confirmedRestrictionNo, { reason: 'trying manual release without an order ref' }, compliance()),
      ).rejects.toThrow(/government release order reference/);
    });
  });
});

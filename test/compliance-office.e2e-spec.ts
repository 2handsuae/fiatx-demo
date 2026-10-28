import * as path from 'path';
import * as dotenv from 'dotenv';

// 同 regulatory-filing.e2e-spec.ts：Node 18 polyfill（@nestjs/schedule 需要
// globalThis.crypto，Node 19+ 才稳），main.ts 不在本 harness 里跑，这里补一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// PrismaService / TigerBeetleService 要在任何其它 import 之前看到本 worktree 的
// DATABASE_URL / TB_ADDRESS（同 regulatory-filing.e2e-spec.ts 头注释）。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { RegulatoryFilingService } from '../src/modules/governance/regulatory-filings/regulatory-filing.service';
import { RegulatoryFilingWorkflowService } from '../src/modules/governance/regulatory-filings/regulatory-filing-workflow.service';
import { RegulatoryFilingSweepService } from '../src/modules/governance/regulatory-filings/regulatory-filing-sweep.service';
import { ComplianceObligationsService } from '../src/modules/governance/compliance-office/compliance-obligations.service';
import { ComplianceObligationSweepService } from '../src/modules/governance/compliance-office/compliance-obligation-sweep.service';
import { ComplianceClockWallService } from '../src/modules/governance/compliance-office/compliance-clock-wall.service';
import { OutsourcingVendorsService } from '../src/modules/governance/compliance-office/outsourcing-vendors.service';
import { OutsourcingVendorWorkflowService } from '../src/modules/governance/compliance-office/outsourcing-vendor-workflow.service';
import { ApplyVendorBodyDto } from '../src/modules/governance/compliance-office/dto/compliance-office.dto';
import { ResponsibleIndividualsService } from '../src/modules/governance/compliance-office/responsible-individuals.service';
import { RiReplacementWorkflowService } from '../src/modules/governance/compliance-office/ri-replacement-workflow.service';
import { advanceDueDate } from '../src/modules/governance/compliance-office/compliance-office.constants';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * 战役甲波四 · 合规办公室骨架（Task 8）e2e：真 AppModule 零 mock，与既有 e2e 串行
 * （同一 SQLite 库 + 同一 TigerBeetle 实例，见 jest-e2e.json 头注释）。
 *
 * Ruling R2（自证原则）：本文件一律自造单据自证——种子里的 3 义务/3 vendor/4 RI 席位
 * 可能同时存在于库里（T7 种子），但本文件的断言只锚定自己创建的单据/义务/vendor/RI 席位，
 * 从不依赖种子行的具体状态；clock-wall 的正/负向检查也按 refNo 精确过滤，不依赖行数。
 *
 * 四段对应 task-8-brief.md：① 义务全弧（simulateDue→sweep 开单→翻期→报送单六态全弧办结）
 * ② 报送单 ⚡ 超时（simulateDeadlineTimeout→filing sweep→overdueMarkedAt+审计+墙上 overdue）
 * ③ 登记册（服务商准入全弧〔甲波六 T6：申请→评估→分流审批→一般 ACTIVE / 重大待报备〕+ 终态零出边；RI 换人批准/驳回/在途重复提 400）
 * ④ clock-wall 行集（按时提交下墙；DISABLED 义务下墙）。
 *
 * actor 工厂照 regulatory-filing.e2e-spec.ts 先例：
 *   - compliance() 经 RegulatoryFilingService 的 GENERAL 族 assertFamily 真查
 *     COMPLIANCE_OFFICER 角色绑定——必须是种子里真实绑定该角色的管理员 id
 *     （compliance_lead@fiatx.com）。compliance-office 三个主体服务本身不查权限
 *     （actor 只用于审计落名），但本文件让它们复用同一个合规官身份，贴合业务narrative。
 *   - smo() 只经 ApprovalsService.approve/reject 的候选角色数组比对，不查真实 DB 行
 *     绑定——随机造 id 即可（RI_REPLACEMENT 与 REG_FILING_SUBMIT 策略同为
 *     SENIOR_MANAGEMENT_OFFICER 单步批）。
 */
describe('Compliance office e2e (战役甲波四 · 合规办公室骨架, Task 8)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;

  let filings: RegulatoryFilingService; let filingWorkflow: RegulatoryFilingWorkflowService;
  let filingSweepService: RegulatoryFilingSweepService; let approvalsService: ApprovalsService;
  let obligations: ComplianceObligationsService; let obligationSweep: ComplianceObligationSweepService;
  let clockWall: ComplianceClockWallService;
  let vendors: OutsourcingVendorsService;
  let vendorWorkflow: OutsourcingVendorWorkflowService;
  let responsibleIndividuals: ResponsibleIndividualsService;
  let riReplacementWorkflow: RiReplacementWorkflowService;

  let complianceUserId: string;
  const compliance = () => makeActor(complianceUserId, 'E2E_CO_COMPLIANCE', 'COMPLIANCE_OFFICER');
  // 只经 ApprovalsService.approve/reject 的候选角色集比对，不查真实 DB 行绑定——照
  // regulatory-filing.e2e-spec.ts 的 smo() 先例，随机造 id 即可。
  const smoUserId = randomUUID();
  const smo = () => makeActor(smoUserId, 'E2E_CO_SMO', 'SENIOR_MANAGEMENT_OFFICER');
  // 服务商准入（甲波六 T6）：运营申请、CISO 评估、CFO 第一步批——这三个角色都只经 workflow / ApprovalsService 的候选角色比对，
  // 不查真实 DB 行绑定，随机造 id 即可。
  const opsUserId = randomUUID(); const cisoUserId = randomUUID(); const cfoUserId = randomUUID();
  const ops = () => makeActor(opsUserId, 'E2E_CO_OPS', 'OPS_OFFICER');
  const ciso = () => makeActor(cisoUserId, 'E2E_CO_CISO', 'CISO');
  const cfo = () => makeActor(cfoUserId, 'E2E_CO_CFO', 'CFO');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();
    prisma = app.get(PrismaService);

    filings = app.get(RegulatoryFilingService);
    filingWorkflow = app.get(RegulatoryFilingWorkflowService);
    filingSweepService = app.get(RegulatoryFilingSweepService);
    approvalsService = app.get(ApprovalsService);
    obligations = app.get(ComplianceObligationsService);
    obligationSweep = app.get(ComplianceObligationSweepService);
    clockWall = app.get(ComplianceClockWallService);
    vendors = app.get(OutsourcingVendorsService);
    vendorWorkflow = app.get(OutsourcingVendorWorkflowService);
    responsibleIndividuals = app.get(ResponsibleIndividualsService);
    riReplacementWorkflow = app.get(RiReplacementWorkflowService);

    // 真查种子管理员 id（COMPLIANCE_OFFICER 邮箱）——assertFamily 走真实 DB 查询，捏造 id
    // 查不到任何角色绑定（同 regulatory-filing.e2e-spec.ts 判例）。
    const complianceUser = await (prisma as any).user.findFirst({ where: { email: 'compliance_lead@fiatx.com' } });
    if (!complianceUser) throw new Error('Fixture role-seed admin (COMPLIANCE_OFFICER) not seeded — run `bash scripts/stack.sh reset self` first.');
    complianceUserId = complianceUser.id;
  });
  afterAll(async () => { if (app) await app.close(); });

  function makeActor(userId: string, userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function auditActionsFor(subjectType: string, subjectNo: string): Promise<string[]> {
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectType: subjectType, primarySubjectNo: subjectNo },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r: any) => r.action as string);
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('① 义务全弧：建义务→simulateDue→sweep 直调开单(deadline=翻期前 nextDueAt、createdByUserId=SYSTEM)→义务翻期+lastFilingNo 回填→同一 now 再 sweep 零新单→工单六态全弧办结', async () => {
    const { obligationNo } = await obligations.create(compliance(), {
      name: 'e2e 波四周期义务全弧测试', frequency: 'MONTHLY', authority: 'VARA',
      basisNote: 'e2e task-8 §① fixture', leadBusinessDays: 0,
      nextDueAt: '2099-01-01T00:00:00.000Z',
    });
    expect(obligationNo).toMatch(/^OBL/);

    // ⚡ 快进：nextDueAt 拨到调用时刻——捕获这个"翻期前"的值供后续核对 deadline/dueAt。
    await obligations.simulateDue(compliance(), obligationNo);
    const dueMoment = (await obligations.findByNo(obligationNo)).nextDueAt;

    // leadBusinessDays=0 时 sweep 判据退化为 now >= nextDueAt——sweepNow 必然晚于
    // dueMoment（两次 await 之间的真实时间流逝），天然满足判据，不必再拨钟。
    const sweepNow = new Date();
    const sweepResult = await obligationSweep.sweep(sweepNow);
    // 全局判据用 >=1（同 regulatory-filing.e2e-spec.ts ④ 先例：库里可能还有其它到期义务，
    // 包括 T7 种子——不断言全局零/一这类跟其它行状态耦合的数字，只锚定本义务自己）。
    expect(sweepResult.generated).toBeGreaterThanOrEqual(1);

    const afterFirstSweep = await obligations.findByNo(obligationNo);
    expect(afterFirstSweep.lastFilingNo).not.toBeNull();
    expect(afterFirstSweep.nextDueAt.getTime()).toBe(advanceDueDate(dueMoment, 'MONTHLY').getTime());

    const filingNo = afterFirstSweep.lastFilingNo as string;
    expect(filingNo).toMatch(/^FIL/);
    const filingRow = await filings.findByNo(filingNo);
    expect(filingRow.type).toBe('PERIODIC_RETURN');
    expect(filingRow.authority).toBe('VARA');
    expect(filingRow.status).toBe('DRAFT');
    expect(filingRow.createdByUserId).toBe('SYSTEM');
    expect(filingRow.deadlineAt).not.toBeNull();
    // deadline = 翻期前 nextDueAt（PERIODIC_RETURN：EXTERNAL 锚 + deadlineBusinessDays=0，
    // 期末即截止，无宽限）。
    expect((filingRow.deadlineAt as Date).getTime()).toBe(dueMoment.getTime());

    const actionsAfterFirstSweep = await auditActionsFor('COMPLIANCE_OBLIGATION', obligationNo);
    expect(actionsAfterFirstSweep).toEqual([
      AuditActions.OBLIGATION_REGISTERED, AuditActions.OBLIGATION_DUE_FASTFORWARDED, AuditActions.OBLIGATION_FILING_GENERATED,
    ]);

    // 同一 now 再 sweep：一期一单——本义务的 nextDueAt 已翻到一个月后，同一 sweepNow 天然
    // 不会再命中它（本断言锚定的是本义务自己的状态不变，不是全局 generated 计数）。
    await obligationSweep.sweep(sweepNow);
    const afterSecondSweep = await obligations.findByNo(obligationNo);
    expect(afterSecondSweep.lastFilingNo).toBe(filingNo);
    expect(afterSecondSweep.nextDueAt.getTime()).toBe(afterFirstSweep.nextDueAt.getTime());
    expect(await auditActionsFor('COMPLIANCE_OBLIGATION', obligationNo)).toEqual(actionsAfterFirstSweep);

    // 工单六态全弧办结：合规官起草 → 送签 → 高管批 → 标已提交 → 办结（复用波二 workflow
    // 服务调用形状，同 regulatory-filing.e2e-spec.ts ① 先例）。
    await filings.saveDraft(filingNo, 'e2e 周期报送草稿：本期无重大变化。', compliance());
    const signoff = await filingWorkflow.submitForSignoff(filingNo, compliance());
    const approvalRow = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: signoff.approvalNo } });
    expect(approvalRow.actionType).toBe(ApprovalActionTypes.REG_FILING_SUBMIT);

    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e SMO signoff periodic return' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');

    await filings.markSubmitted(filingNo, { externalRef: 'VARA-PERIODIC-E2E-001' }, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED');

    await filings.close(filingNo, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('CLOSED');

    expect(await auditActionsFor('REGULATORY_FILING', filingNo)).toEqual([
      AuditActions.FILING_OPENED, AuditActions.FILING_DRAFT_SAVED, AuditActions.FILING_SIGNOFF_REQUESTED,
      AuditActions.FILING_SIGNED_OFF, AuditActions.FILING_SUBMITTED, AuditActions.FILING_CLOSED,
    ]);
  });

  it('② 报送单 ⚡ 超时：自建带钟 DRAFT 单 → simulateDeadlineTimeout 回拨 deadlineAt 至 1h 前 → filing sweep 直调 → overdueMarkedAt 落地 + FILING_OVERDUE_MARKED 审计 → clock-wall 行 overdue=true', async () => {
    const { filingNo } = await filings.openManual({
      type: 'INFO_REQUEST_RESPONSE', authority: 'VARA', title: 'e2e 监管问询答复（⚡超时演示）',
      receivedAt: new Date().toISOString(),
    }, compliance());

    const row = await filings.findByNo(filingNo);
    expect(row.status).toBe('DRAFT');
    expect(row.overdueMarkedAt).toBeNull();
    // 开单时 deadlineAt = receivedAt+48h（未来），此刻尚未逾期——⚡ 装置要拨的正是这个钟。
    expect((row.deadlineAt as Date).getTime()).toBeGreaterThan(Date.now());

    await filings.simulateDeadlineTimeout(filingNo, compliance());
    const afterFastForward = await filings.findByNo(filingNo);
    expect((afterFastForward.deadlineAt as Date).getTime()).toBeLessThan(Date.now());
    expect(afterFastForward.status).toBe('DRAFT'); // ⚡ 装置只拨钟不改状态

    const sweepResult = await filingSweepService.sweep();
    expect(sweepResult.marked).toBeGreaterThanOrEqual(1);

    const afterSweep = await filings.findByNo(filingNo);
    expect(afterSweep.overdueMarkedAt).not.toBeNull();

    const overdueAudits = await (prisma as any).auditLogEvent.count({
      where: { primarySubjectType: 'REGULATORY_FILING', primarySubjectNo: filingNo, action: AuditActions.FILING_OVERDUE_MARKED },
    });
    expect(overdueAudits).toBe(1);

    const wall = await clockWall.getWall();
    const wallRow = wall.find((r) => r.refNo === filingNo);
    expect(wallRow).toBeDefined();
    expect(wallRow!.kind).toBe('FILING');
    expect(wallRow!.overdue).toBe(true);
  });

  /** 服务商申请表：默认四问全「不会」（NON_MATERIAL）；给 impactContinuity: true 即判 MATERIAL。 */
  const vendorForm = (overrides: Partial<ApplyVendorBodyDto> = {}): ApplyVendorBodyDto => ({
    name: 'e2e Office Printing Ltd', registeredIn: 'United Arab Emirates (Dubai)', registrationNo: 'DED-E2E-0001',
    deliveryLocations: ['AE'], contactName: 'E2E Contact', contactEmail: 'contact@e2e-vendor.example',
    beneficialOwners: [{ seq: 1, name: 'E2E Owner One' }],
    serviceDescription: 'Outsourced printing and mailing', regulatedFunction: false, contractStart: '2026-11-01',
    involvesPersonalData: false, involvesConfidentialInfo: false, applicationReason: 'e2e vendor onboarding',
    impactLicence: false, impactLegal: false, impactFinancial: false, impactContinuity: false, replaceability: 'EASY',
    ...overrides,
  });

  /** 合规官把名单上的人逐名筛一遍（全绿）并定档——送审前提。 */
  async function screenAndRate(vendorNo: string, form: ApplyVendorBodyDto) {
    await vendorWorkflow.recordScreening(vendorNo, { subjectKind: 'COMPANY', subjectName: form.name, listsChecked: ['UN', 'OFAC'], result: 'GREEN' }, compliance());
    for (const o of form.beneficialOwners ?? []) {
      await vendorWorkflow.recordScreening(vendorNo, { subjectKind: 'BENEFICIAL_OWNER', subjectName: o.name, uboSeq: o.seq, listsChecked: ['UN', 'OFAC', 'PEP'], result: 'GREEN' }, compliance());
    }
    await vendorWorkflow.saveAssessment(vendorNo, { riskTier: 'LOW', opinion: 'e2e: clean file' }, compliance());
  }

  it('③a 服务商准入：运营申请(系统判重大性)→合规评估→按重大性分流审批→一般 ACTIVE、重大 PENDING_NOTIFICATION(付款门拦)；合规官只剩终止，终态零出边', async () => {
    // —— 一般路：四问全「不会」→ NON_MATERIAL → CFO 单步 → ACTIVE ——
    const normalForm = vendorForm();
    const normal = await vendorWorkflow.apply(normalForm, ops());
    expect(normal.vendorNo).toMatch(/^VEN/);
    expect(normal).toMatchObject({ status: 'PENDING_ASSESSMENT', criticality: 'NON_MATERIAL' });
    await expect(vendors.assertActiveByNo(normal.vendorNo)).rejects.toThrow(/not ACTIVE/); // 申请中付不了款

    // 缺名单筛查就送审 → 拒（门不可绕）
    await expect(vendorWorkflow.conclude(normal.vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance())).rejects.toThrow(/Screening missing/);
    expect((await vendors.findByNo(normal.vendorNo)).status).toBe('PENDING_ASSESSMENT');

    await screenAndRate(normal.vendorNo, normalForm);
    const sent = await vendorWorkflow.conclude(normal.vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance());
    expect(sent.status).toBe('PENDING_APPROVAL');
    const normalApproval = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: sent.approvalNo } });
    expect(normalApproval.actionType).toBe(ApprovalActionTypes.VENDOR_APPROVAL);
    // 送审后评估锁定
    await expect(vendorWorkflow.saveAssessment(normal.vendorNo, { riskTier: 'LOW', opinion: 'late edit' }, compliance())).rejects.toThrow('Assessment is locked');

    await approvalsService.approve(sent.approvalNo!, { reason: 'e2e CFO approve' }, cfo());
    await waitUntil(async () => (await vendors.findByNo(normal.vendorNo)).status === 'ACTIVE');
    await expect(vendors.assertActiveByNo(normal.vendorNo)).resolves.toBeUndefined();

    // 终止（合规官）：ACTIVE → TERMINATED；终态零出边——再 terminate 显式拒
    await vendorWorkflow.terminate(normal.vendorNo, { notes: 'e2e: contract ended' }, compliance());
    expect((await vendors.findByNo(normal.vendorNo)).status).toBe('TERMINATED');
    await expect(vendorWorkflow.terminate(normal.vendorNo, {}, compliance())).rejects.toThrow(/Illegal vendor status transition/);

    expect(await auditActionsFor('OUTSOURCING_VENDOR', normal.vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED, AuditActions.VENDOR_TERMINATED,
    ]);

    // —— 重大路：一个「会」→ MATERIAL → 要 CISO 评估 → CFO→高管两步 → PENDING_NOTIFICATION（批了也不能付款）——
    const majorForm = vendorForm({ name: 'e2e Core Ledger Hosting LLC', impactContinuity: true, deliveryLocations: ['AE', 'IE'] });
    const major = await vendorWorkflow.apply(majorForm, ops());
    expect(major.criticality).toBe('MATERIAL');
    await screenAndRate(major.vendorNo, majorForm);
    // 重大服务商缺 CISO 评估 → 不能送审（等 CISO）
    await expect(vendorWorkflow.conclude(major.vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance())).rejects.toThrow(/CISO/);
    await vendorWorkflow.recordInfosec(major.vendorNo, {
      soc2: 'HAS', iso27001: 'HAS', dataLocationAcceptable: true, drPlanAcceptable: true, opinion: 'e2e: acceptable', verdict: 'ACCEPTABLE',
    }, ciso());
    const majorSent = await vendorWorkflow.conclude(major.vendorNo, { conclusion: 'SENT_FOR_APPROVAL' }, compliance());
    const majorApproval = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: majorSent.approvalNo } });
    expect(majorApproval.actionType).toBe(ApprovalActionTypes.VENDOR_MATERIAL_APPROVAL);

    await approvalsService.approve(majorSent.approvalNo!, { reason: 'e2e CFO step' }, cfo());
    expect((await vendors.findByNo(major.vendorNo)).status).toBe('PENDING_APPROVAL'); // 两步单：第一步批完还没落地
    await approvalsService.approve(majorSent.approvalNo!, { reason: 'e2e SMO step' }, smo());
    await waitUntil(async () => (await vendors.findByNo(major.vendorNo)).status === 'PENDING_NOTIFICATION');
    await expect(vendors.assertActiveByNo(major.vendorNo)).rejects.toThrow(/not ACTIVE/); // 报备门：待报备付不了款
    // 合规官也不能借「终止」绕开报备门
    await expect(vendorWorkflow.terminate(major.vendorNo, {}, compliance())).rejects.toThrow(/Illegal vendor status transition/);
    expect((await vendors.findByNo(major.vendorNo)).status).toBe('PENDING_NOTIFICATION');

    // 甲波六 T7：批准落地（迁 PENDING_NOTIFICATION）之后紧接着报送台开告知单、单号盖回服务商——开单在迁状态之后，故先等盖章，
    // 服务商审计里才多出 VENDOR_NOTIFICATION_OPENED（报备门全程另见 vendor-onboarding.e2e-spec.ts）。
    await waitUntil(async () => !!(await vendors.findByNo(major.vendorNo)).notificationFilingNo);
    expect(await auditActionsFor('OUTSOURCING_VENDOR', major.vendorNo)).toEqual([
      AuditActions.VENDOR_APPLIED, AuditActions.VENDOR_SENT_FOR_APPROVAL, AuditActions.VENDOR_APPROVED, AuditActions.VENDOR_NOTIFICATION_OPENED,
    ]);
    const approvedEvent = await (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectType: 'OUTSOURCING_VENDOR', primarySubjectNo: major.vendorNo, action: AuditActions.VENDOR_APPROVED },
    });
    expect(JSON.parse(approvedEvent.metadata)).toMatchObject({ vendorNo: major.vendorNo });
    expect(approvedEvent).toMatchObject({ fromStatus: 'PENDING_APPROVAL', toStatus: 'PENDING_NOTIFICATION', approvalNo: majorSent.approvalNo });
  });

  it('③b RI 登记册：建席位→提换人→高管批(incumbent 已换、pending 清空、RI_REPLACEMENT_APPLIED 携 approvalNo)→驳回分支(pending 清空不换人)→在途重复提 400', async () => {
    const { riNo } = await responsibleIndividuals.createSeat(compliance(), {
      position: 'MLRO', incumbentName: 'e2e Incumbent A', effectiveFrom: '2026-01-01T00:00:00.000Z',
      varaRef: 'VARA-RI-E2E-SEAT-001',
    });
    expect(riNo).toMatch(/^RI/);
    expect((await responsibleIndividuals.findByNo(riNo)).pendingApprovalNo).toBeNull();

    const { approvalNo: approvalNo1 } = await riReplacementWorkflow.initiateReplacement(riNo, {
      newIncumbentName: 'e2e Incumbent B', effectiveFrom: '2026-02-01T00:00:00.000Z',
      reason: 'e2e replace A with B', varaRef: 'VARA-RI-E2E-REPL-001',
    }, compliance());
    expect((await responsibleIndividuals.findByNo(riNo)).pendingApprovalNo).toBe(approvalNo1);

    const approvalRow1 = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: approvalNo1 } });
    expect(approvalRow1.actionType).toBe(ApprovalActionTypes.RI_REPLACEMENT);

    // 在途重复提 400：同一席位已有在途换人，第二次提案（无论内容）一律拒——一席一在途。
    await expect(riReplacementWorkflow.initiateReplacement(riNo, {
      newIncumbentName: 'e2e Incumbent C (should not land)', effectiveFrom: '2026-02-01T00:00:00.000Z',
      reason: 'e2e duplicate while pending',
    }, compliance())).rejects.toThrow(/already has a pending replacement/);

    // 高管批：incumbent 已换、pending 清空。
    await approvalsService.approve(approvalNo1, { reason: 'e2e SMO approve RI replacement' }, smo());
    await waitUntil(async () => (await responsibleIndividuals.findByNo(riNo)).pendingApprovalNo === null);

    const afterApply = await responsibleIndividuals.findByNo(riNo);
    expect(afterApply.incumbentName).toBe('e2e Incumbent B');
    expect(afterApply.pendingApprovalNo).toBeNull();

    // RI_REPLACEMENT_APPLIED 审计存在，且 metadata 携带真实 from/to（R5 修复：
    // responsible-individuals.service.ts 的 applyReplacement 现在把 fromIncumbent/
    // toIncumbent/approvalNo 镜像进 metadata，不再只留在校验用的顶层 extra——查审计行
    // 本身就能看到"换的是谁、换成了谁、批的是哪一单"）。
    const actionsAfterApply = await auditActionsFor('RESPONSIBLE_INDIVIDUAL', riNo);
    expect(actionsAfterApply).toEqual([
      AuditActions.RI_SEAT_REGISTERED, AuditActions.RI_REPLACEMENT_PROPOSED, AuditActions.RI_REPLACEMENT_APPLIED,
    ]);
    const appliedEvent = await (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectType: 'RESPONSIBLE_INDIVIDUAL', primarySubjectNo: riNo, action: AuditActions.RI_REPLACEMENT_APPLIED },
    });
    expect(appliedEvent.approvalNo).toBe(approvalNo1);
    const appliedMetadata = JSON.parse(appliedEvent.metadata);
    expect(appliedMetadata).toMatchObject({ fromIncumbent: 'e2e Incumbent A', toIncumbent: 'e2e Incumbent B', approvalNo: approvalNo1 });

    // 整备波 T3：批准落地之后，报送台自动出现一张 SYSTEM 源 MATERIAL_CHANGE_NOTIFICATION DRAFT 单
    // （标题携席位与新旧任，无钟），FILING_OPENED 审计 metadata 带 riNo/approvalNo。
    // 开单发生在 applyReplacement 之后（pending 清空的瞬间告知单可能还没出），故 waitUntil；
    // 按 approvalNo 经审计 metadata 反查——approvalNo 每次运行唯一，重跑共享库不串单（RI 行不回填
    // filingNo，双向可查正是靠这条审计 metadata）。
    const findAutoOpened = (approvalNo: string) => (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectType: 'REGULATORY_FILING', action: AuditActions.FILING_OPENED, metadata: { contains: approvalNo } },
    });
    await waitUntil(async () => !!(await findAutoOpened(approvalNo1)));
    const autoOpened = await findAutoOpened(approvalNo1);
    expect(JSON.parse(autoOpened.metadata)).toMatchObject({ source: 'RI_REPLACEMENT', riNo, approvalNo: approvalNo1 });
    const autoFiling = await filings.findByNo(autoOpened.primarySubjectNo);
    expect(autoFiling).toMatchObject({
      type: 'MATERIAL_CHANGE_NOTIFICATION', status: 'DRAFT', createdByUserId: 'SYSTEM', deadlineAt: null, authority: 'VARA',
      title: 'Responsible Individual change — MLRO: e2e Incumbent A → e2e Incumbent B',
    });

    // 驳回分支：再提一次换人，高管 DECLINE——pending 清空，incumbent 不变（不是 D）。
    const { approvalNo: approvalNo2 } = await riReplacementWorkflow.initiateReplacement(riNo, {
      newIncumbentName: 'e2e Incumbent D (should not land)', effectiveFrom: '2026-03-01T00:00:00.000Z',
      reason: 'e2e decline branch',
    }, compliance());
    await approvalsService.reject(approvalNo2, { reason: 'e2e SMO decline replacement' }, smo());
    await waitUntil(async () => (await responsibleIndividuals.findByNo(riNo)).pendingApprovalNo === null);

    const afterReject = await responsibleIndividuals.findByNo(riNo);
    expect(afterReject.incumbentName).toBe('e2e Incumbent B'); // 未换
    expect(afterReject.pendingApprovalNo).toBeNull();
    // 驳回没换人 = 没有重大变更可告知：不开单（给一个事件循环周期的余量，再断言无单）。
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await findAutoOpened(approvalNo2)).toBeNull();

    expect(await auditActionsFor('RESPONSIBLE_INDIVIDUAL', riNo)).toEqual([
      AuditActions.RI_SEAT_REGISTERED, AuditActions.RI_REPLACEMENT_PROPOSED, AuditActions.RI_REPLACEMENT_APPLIED,
      AuditActions.RI_REPLACEMENT_PROPOSED, AuditActions.RI_REPLACEMENT_REJECTED,
    ]);
  });

  it('④ clock-wall 行集：按时提交的单不在墙上；DISABLED 义务不在墙上', async () => {
    // 按时提交：一张新 INFO_REQUEST_RESPONSE 走满 DRAFT→PENDING_SIGNOFF→SIGNED_OFF→
    // SUBMITTED（正常路径，未逾期）——先验它在 DRAFT 态确实上墙，排除"查询本身失灵"这个
    // 假阴性解释，再验提交后下墙。
    const { filingNo } = await filings.openManual({
      type: 'INFO_REQUEST_RESPONSE', authority: 'VARA', title: 'e2e 监管问询答复（按时提交）',
      receivedAt: new Date().toISOString(),
    }, compliance());

    const wallBeforeSubmit = await clockWall.getWall();
    expect(wallBeforeSubmit.some((r) => r.refNo === filingNo)).toBe(true);

    await filings.saveDraft(filingNo, 'e2e 按时答复内容：材料齐备，无异常。', compliance());
    const signoff = await filingWorkflow.submitForSignoff(filingNo, compliance());
    await approvalsService.approve(signoff.approvalNo, { reason: 'e2e SMO signoff on-time filing' }, smo());
    await waitUntil(async () => (await filings.findByNo(filingNo)).status === 'SIGNED_OFF');
    await filings.markSubmitted(filingNo, { externalRef: 'VARA-REG-E2E-ONTIME-001' }, compliance());
    expect((await filings.findByNo(filingNo)).status).toBe('SUBMITTED');

    const wallAfterSubmit = await clockWall.getWall();
    expect(wallAfterSubmit.some((r) => r.refNo === filingNo)).toBe(false);

    // DISABLED 义务不上墙：新建一条 ACTIVE 义务先验证在墙上，setStatus DISABLED 后验证下墙。
    const { obligationNo } = await obligations.create(compliance(), {
      name: 'e2e 墙行集测试义务（DISABLED 下墙）', frequency: 'ANNUAL', authority: 'VARA',
      basisNote: 'e2e task-8 §④ fixture', nextDueAt: '2099-01-01T00:00:00.000Z',
    });
    const wallWithObligation = await clockWall.getWall();
    expect(wallWithObligation.some((r) => r.refNo === obligationNo)).toBe(true);

    await obligations.setStatus(obligationNo, compliance(), 'DISABLED');
    const wallAfterDisable = await clockWall.getWall();
    expect(wallAfterDisable.some((r) => r.refNo === obligationNo)).toBe(false);
  });
});

import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors recon-adjustment-money-arcs.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { toBusinessDate, endOfBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { DispositionService } from '../src/modules/clearing-settle/reconciliation/disposition/disposition.service';
import { ReconciliationCaseService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service';
import { InternalTransferWorkflowService } from '../src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service';
import { CaseAgingSweepService } from '../src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service';
import { AdjustmentStatus } from '../src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { WalletCashAccountService } from '../src/modules/accounting/tigerbeetle/wallet-cash-account.service';
import { bigintToHex } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';

/**
 * 平账 A 批（spec §2/§3）e2e（Task 12）：案件账龄 → 公司池核销 全链路，真 AppModule
 * 零 mock。夹具搭法（fresh wallet、真 TB 转账铺底、外部对账单、waitUntil 轮询）照抄
 * 同目录 recon-adjustment-money-arcs.e2e-spec.ts；账龄拨钟/扫描/核销是本文件新增的
 * 三个真实服务：ReconciliationCaseService.simulateTimeout（⚡拨钟，留一条操作员审计）→
 * CaseAgingSweepService.checkAgingBreaches（真扫描，置 slaBreached + 一条系统审计）→
 * AdjustmentService.createDraft 的核销四前提守卫（超期 / 已定性挂起·调查中 / 公司账簿 /
 * 小额线）→ 真审批中心（RECON_ADJUSTMENT_POST，单步 CFO）→ 真 onApproved →
 * AccountingService.executeTransfer 真落账 → WalletReconRunService.run() 真重对账
 * 自愈。DispositionService.record 是查证结论的落点（零账务），第五族核销的开单锚
 * 就是它落的那一行。
 *
 * ⚠ 必须与另外两份 recon e2e 串行跑——test/jest-e2e.json 的 `maxWorkers: 1` 已经
 *   处理了这件事（三份文件共享同一个 SQLite + TigerBeetle，都调全局的
 *   WalletReconRunService.run()），本文件不需要也不应该另开一套隔离。
 */
describe('Recon case aging → write-off e2e (平账 A 批, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let adjustments: AdjustmentService;
  let dispositions: DispositionService;
  let caseService: ReconciliationCaseService;
  let agingSweep: CaseAgingSweepService;
  let walletRecon: WalletReconRunService;
  let reconQuery: ReconciliationQueryService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let approvalsService: ApprovalsService;
  let transferWf: InternalTransferWorkflowService;

  let aedAssetId: string;
  let aedCode: string; // 'AED' — equals asset.currency for fiat, unlike crypto

  // Cutoff pinned a few days ahead of wall-clock `now` so every fixture write
  // in this file (effectiveDate defaults to today) is unconditionally included
  // via effectiveCutoffFilter's `effectiveDate < businessDate(cutoff)` branch —
  // no dependency on exact test-execution timing.
  let CUTOFF: Date;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();

    prisma = app.get(PrismaService);
    adjustments = app.get(AdjustmentService);
    dispositions = app.get(DispositionService);
    caseService = app.get(ReconciliationCaseService);
    agingSweep = app.get(CaseAgingSweepService);
    walletRecon = app.get(WalletReconRunService);
    reconQuery = app.get(ReconciliationQueryService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    approvalsService = app.get(ApprovalsService);
    transferWf = app.get(InternalTransferWorkflowService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed || !aed.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aed.id;
    aedCode = aed.code;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** Fresh customer wallet row — always creates, never reused across scenarios
   *  so each scenario's account_flows are provably exclusive to it. */
  async function createCustomerWallet(opts: {
    ownerId: string; ownerNo: string; network: string; walletRole: 'C_VIBAN' | 'C_DEP'; iban?: string; address?: string;
  }): Promise<{ id: string }> {
    const created = await (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId, ownerNo: opts.ownerNo,
        vaultCode: 'CLIENT_DEPOSIT', walletRole: opts.walletRole, network: opts.network,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
    });
    // 戊波一:每个钱包一个现金户——运行时钱包在开地址流程里开户,这里直接 prisma.create 的夹具要补上,
    // 否则解析不到该钱包的现金户(调账落账 / 夹具铺底都要用)。
    await app.get(WalletCashAccountService).ensureForWallet(created);
    return { id: created.id };
  }

  /** Fresh firm (PLATFORM) wallet row — deliberately NOT the seeded F_FEE wallet,
   *  which is a shared aggregate other e2e suites post real fee income to
   *  concurrently. ownerType:'PLATFORM' → 现金户码 50（公司现金）。
   *  唯一键 (vaultCode, network, ownerNo) 不允许第二条 PLATFORM 行，独立归属号
   *  避开种子的 'PLATFORM'。 */
  async function createFirmWallet(opts: { vaultCode: string; network: string }): Promise<{ id: string }> {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-ADJ-FIRM-${tag}`,
        ownerType: 'PLATFORM', ownerId: null, ownerNo: `PLATFORM-E2E-${tag}`,
        vaultCode: opts.vaultCode, walletRole: opts.vaultCode, network: opts.network,
        status: 'ACTIVE',
      },
    });
    await app.get(WalletCashAccountService).ensureForWallet(created); // 同上:夹具钱包补开现金户
    return { id: created.id };
  }

  /** Fresh fixture customer, exclusive to one scenario — mirrors sla.e2e-spec.ts's
   *  makeCustomer() / material-requests.e2e-spec.ts's per-call customer maker.
   *  Task 4 made Wallet's unique key (vaultCode, network, ownerNo); the two
   *  scenarios below used to share carol/dave's ownerNo on AED_ZAND, which no
   *  longer coexists with the other recon e2e files' own carol/dave AED_ZAND rows
   *  (all three run serially against the same DB — maxWorkers:1) nor with itself
   *  on a re-run. customerNo comes from generateReferenceNo (fresh every call),
   *  so repeated suite runs never collide on customerMain's own unique fields. */
  async function makeCustomer(tag: string): Promise<{ id: string; customerNo: string }> {
    const customerNo = generateReferenceNo('CU');
    const row = await (prisma as any).customerMain.create({
      data: {
        email: `e2e_recon_aging_${tag}_${customerNo}@example.com`.toLowerCase(),
        customerNo,
        phone: `+1${customerNo.replace(/\D/g, '')}`,
        firstName: 'Recon', lastName: 'Fixture',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
        riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
      },
      select: { id: true, customerNo: true },
    });
    return { id: row.id, customerNo: row.customerNo };
  }

  /** Fresh customers don't inherit the demo seed's per-customer TB accounts —
   *  seed.business.ts only provisions CLIENT_PAYABLE/DEPOSIT_SUSPENSE unconditionally
   *  for the 8 seeded DEMO_CUSTOMERS (carol/dave included). The 跨日切 scenario calls
   *  fundCustomerWallet() on a makeCustomer() row, so it needs AED provisioned first —
   *  mirrors swap-sumsub-scenarios.e2e-spec.ts's own per-customer step. */
  async function ensureCustomerAedTbAccounts(customerId: string, customerNo: string): Promise<void> {
    for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
      await ensureTbAccountRegistry(prisma as any, {
        code, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: customerId, ownerNo: customerNo,
        assetCode: aedCode, description: `e2e recon-aging ${code}/AED`,
      });
    }
    await provisionTbAccounts(prisma as any);
  }

  /** Real production evidence shape — mirrors deposit-workflow.service.ts's own
   *  Step 1 (DR 客户现金·落地钱包 / CR 暂扣，码 1) + Step 2 (DR 暂扣 / CR 应付，纯账面
   *  重分类，码 2) exactly。戊波一:现金类账户一钱包一户——Step 1 的借方是这只钱包自己的
   *  现金户（A.CLIENT_CASH），只经 AccountingService.resolveCashAccountId 取；钱包由
   *  createCustomerWallet 开好现金户。证据不再带钱包标签 / 跨外部标记。 */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; assetId: string; ledger: number; currency: string; amount: bigint; tag: string;
    /** Step 1 的外部参考号——matcher 按它与外部对账单行配对（Task 12 新增）。 */
    externalRef?: string;
    /** 分录的业务生效日（默认跟随写入时刻）。 */
    effectiveDate?: string;
  }): Promise<string> {
    // Random suffix (not just Date.now()) so repeated test runs never reuse a
    // prior run's (sourceType, sourceNo, eventCode) — TigerBeetle's transfer id
    // is a deterministic hash of exactly those fields and persists across runs
    // (this worktree's TB file survives jest re-invocations); a collision makes
    // executeTransfer() treat the transfer as "already exists" and SILENTLY SKIP
    // the evidence/account_flow write for THIS run's (fresh) wallet, leaving
    // the wallet's internal total at 0 with no error raised anywhere.
    const sourceNo = `E2E-RECON-ADJ-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

    const walletCashId = await accounting.resolveCashAccountId(opts.walletId, opts.ledger);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });

    await accounting.executeTransfer({
      debitAccountId: walletCashId,
      creditAccountId: suspenseId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_CASH],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-aging write-off tests (Step 1)',
        externalRef: opts.externalRef ?? null,
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for recon-aging write-off tests (Step 2)',
        ...(opts.effectiveDate ? { effectiveDate: opts.effectiveDate } : {}),
      },
    });

    return sourceNo;
  }

  /** Give a FIRM wallet a real internal balance in its own cash account (A.FIRM_CASH, 码 50)
   *  by the real capital-injection shape（附录 B「注资」：DR 现金·收款钱包 / CR 公司权益，码 70）。
   *  戊波一:公司钱包的余额就是它自己的现金户余额。Same deterministic-transfer-id caution as
   *  fundCustomerWallet. */
  async function fundFirmWallet(opts: {
    walletId: string; ledger: number; currency: string; amount: bigint; tag: string;
    /** 外部参考号——matcher 按它与外部对账单行配对（Task 12 新增）。 */
    externalRef?: string;
  }): Promise<void> {
    const sourceNo = `E2E-RECON-ADJ-FIRMFUND-${opts.tag}-${randomUUID().slice(0, 8)}`;
    const walletCashId = await accounting.resolveCashAccountId(opts.walletId, opts.ledger);
    const equityId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger: opts.ledger, ownerType: 'SYSTEM' });

    await accounting.executeTransfer({
      debitAccountId: walletCashId,
      creditAccountId: equityId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.CAPITAL_INJECTION,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'E2E_FIRM_FIXTURE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_CASH],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_EQUITY],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund firm wallet cash (capital-injection shape)',
        externalRef: opts.externalRef ?? null,
      },
    });
  }

  /** 外部对账单行——subAccount 盖成钱包 id（ZAND 把 VirtualAccount / 托管子账户
   *  号填在这一列），run 的 fetchExternalLinesForWallet 就按它圈定本钱包的行。
   *  datetime 默认 now（远早于 CUTOFF，两处 `datetime <= cutoff` 过滤都进得来）；
   *  跨日切场景要把它钉在一个具体时刻，故加一个可选 datetime。 */
  async function createExternalLine(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM';
    direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string; datetime?: Date;
  }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: {
        source: 'ZAND',
        accountRef: opts.walletId,
        subAccount: opts.walletId,
        book: opts.book,
        currency: opts.currency,
        direction: opts.direction,
        amount: opts.amount.toString(),
        externalRef: opts.externalRef,
        datetime: opts.datetime ?? new Date(),
        description: opts.description ?? 'Incoming',
        dedupKey: `E2E-AGING-${randomUUID()}`,
      },
      select: { id: true },
    });
  }

  async function upsertExternalBalance(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint;
    /** 对账单所属业务日（默认 CUTOFF 那天）。跨日切场景要把它放到过去的某一天。 */
    cutoffDate?: string;
  }): Promise<void> {
    const cutoffDate = opts.cutoffDate ?? toBusinessDate(CUTOFF);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: 'ZAND', accountRef: opts.walletId, cutoffDate } },
      create: {
        source: 'ZAND', accountRef: opts.walletId, currency: opts.currency, book: opts.book,
        cutoffDate, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId,
      },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }

  // 不声明显式返回类型（同 test/recon-reattribution.e2e-spec.ts 的同名 helper）——
  // 本文件的用例要读 slaDeadline / slaBreached / bucket / businessDate 等字段，
  // 声明窄类型会把它们编译期擦掉；prisma 已经是 `as any`，让它按实际返回值推断。
  async function openCaseFor(walletId: string) {
    return (prisma as any).reconciliationCase.findFirst({
      where: { walletRef: walletId, status: 'OPEN' },
    });
  }

  async function latestApprovalCase(actionType: string, entityRef: string) {
    return (prisma as any).approvalCase.findFirst({
      where: { actionType, entityRef },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function adjustmentRow(adjustmentNo: string) {
    return (prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
  }

  /** 戊波一:凭证行的借 / 贷账户 id 是十六进制串;现金户只经 resolveCashAccountId 取,开支 / 权益 / 收入是该币种的 SYSTEM 户。 */
  const cashHex = async (walletId: string, ledger: number) => bigintToHex(await accounting.resolveCashAccountId(walletId, ledger));
  const systemHex = async (code: number, ledger: number) =>
    bigintToHex(await accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' }));
  /** 钱包现金户已落账净额(资产类,借增贷减)——核销的现金腿**真的**落在案子钱包自己的现金户上的行为证明
   *  （场景用专属新钱包，余额从 0 起算，可断言绝对值）。 */
  async function cashPosted(walletId: string, ledger: number): Promise<bigint> {
    const b = await accounting.lookupBalance(await accounting.resolveCashAccountId(walletId, ledger));
    return b.debitsPosted - b.creditsPosted;
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  it('主链路：查无果 → 拨钟 → 扫描超期（留痕）→ 金库开核销单 → CFO 批 → 落账（借对账核销损失/贷公司现金·案子钱包 7）→ 重对账 RESOLVED', async () => {
    // 同日 reset self 重跑会复用同一个 caseNo（reconciliation_cases 被清空重铺，
    // audit_log_events 不会）——按 caseNo 查审计会连上一轮session 遗留的历史行
    // 一起捞出来。AuditLogEvent 没有 createdAt 列（组 B 时间只有 occurredAt /
    // recordedAt / effectiveDate，见 prisma/schema.prisma 的 model 定义）；
    // recordedAt 由 AuditLogsService 在写入路径无条件盖成 `new Date()`（不像
    // occurredAt 可以被调用方传入的业务时间覆盖，audit-logs.service.ts:1027-1028），
    // 是「这行到底是不是本次跑写的」唯一靠得住的时间锚，故拿它给下面的账龄审计
    // 查询圈定下限，不削断言本身。
    const testStartedAt = new Date();
    const ledger = 1; // AED
    const wallet = await createFirmWallet({ vaultCode: 'F_FEE', network: 'AED_ZAND' });
    const REF = `E2E-WO-${randomUUID().slice(0, 8)}`;
    await fundFirmWallet({ walletId: wallet.id, ledger, currency: aedCode, amount: 5000n, tag: 'WO', externalRef: REF });
    await createExternalLine({ walletId: wallet.id, currency: aedCode, book: 'FIRM', direction: 'IN', amount: 4993n, externalRef: REF });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'FIRM', closingBalance: 4993n });

    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('FIRM');
    expect(kase.slaBreached).toBe(false);
    expect(new Date(kase.slaDeadline).toISOString()).toBe(new Date(endOfBusinessDate(toBusinessDate(CUTOFF)).getTime() + 3 * 86_400_000).toISOString());

    // 运营定性：查不出（锚 = 读面那行的两个真实证据 id）
    const detail0 = await reconQuery.getCase(kase.caseNo);
    const row0 = detail0.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const ops = makeActor('E2E_OPS_DISPOSER', 'OPS_OFFICER');
    const disp = await dispositions.record({
      caseNo: kase.caseNo,
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', findingNote: 'e2e：对了回单，差额 7 分无规律，已穷尽调查',
      deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops);
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');

    // 反例①：未超期开核销单 → 400
    const treasury = makeActor('E2E_TREASURY_WO', 'TREASURY_OFFICER');
    const woDto = {
      caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: kase.businessDate,
      explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      reasonInternal: 'e2e 核销', dispositionNo: disp.dispositionNo,
    };
    await expect(adjustments.createDraft(woDto as any, treasury)).rejects.toThrow(/aging threshold/);
    expect((await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();

    // ⚡拨钟 + 扫描 → 超期 + 两条审计
    await caseService.simulateTimeout(kase.caseNo, ops);
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    const breached = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(breached.slaBreached).toBe(true);
    expect(breached.status).toBe('OPEN');
    const agingAudits = await (prisma as any).auditLogEvent.findMany({ where: { primarySubjectNo: kase.caseNo, recordedAt: { gte: testStartedAt }, action: { in: ['RECON_AGING_TIMEOUT_SIMULATED', 'RECON_CASE_AGING_BREACHED'] } } });
    expect(agingAudits.map((a: any) => a.action).sort()).toEqual(['RECON_AGING_TIMEOUT_SIMULATED', 'RECON_CASE_AGING_BREACHED']);

    // 读面解锁：nextStep = WRITE_OFF 四项
    const detail1 = await reconQuery.getCase(kase.caseNo);
    const row1 = detail1.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row1.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: kase.businessDate });

    // 反例②：超线 → 400
    await expect(adjustments.createDraft({ ...woDto, amount: '10001' } as any, treasury)).rejects.toThrow(/small-amount threshold/);

    // 正路径
    const { adjustmentNo } = await adjustments.createDraft(woDto as any, treasury);
    const drafted = await (prisma as any).auditLogEvent.findFirst({ where: { action: 'RECON_ADJUSTMENT_DRAFTED', primarySubjectNo: adjustmentNo } });
    expect(drafted.reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).adjustmentNo).toBe(adjustmentNo);

    await adjustments.submit(adjustmentNo, treasury);
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    // brief 原文断言 approvalCase.reason——但 ApprovalCase 模型没有 reason 列
    // （prisma/schema.prisma:531-554；reason 只存在于 ApprovalStep 上，且要到
    // CFO 裁决时才写入，写的也是裁决理由不是 impact 文案）。真正落 impact 文案
    // 的地方是 submit() 传给 createAndSubmit 的 objectSnapshot.impact——同目录
    // recon-reattribution.e2e-spec.ts:551 已经是读 objectSnapshot 的既有先例，
    // 这里照它改读那里（唯一偏离 brief 原文的一行，报告里也记了）。
    expect(JSON.parse(approvalCase.objectSnapshot).impact).toContain('Firm pool unexplained write-off');
    await approvalsService.approve(approvalCase.approvalNo, { reason: 'e2e CFO approve write-off' }, makeActor('E2E_CFO_APPROVER', 'CFO'));
    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    // 过账断言（不依赖对账引擎）：戊波一·附录 B「核销（公司池）」——托管里少了：
    // 借 对账核销损失(X.EXPENSE_RECON_LOSS) / 贷 该钱包现金户(A.FIRM_CASH)。
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_CASH]);
    expect(evidence[0].debitTbAccountId).toBe(await systemHex(TB_ACCOUNT_CODES.EXPENSE_RECON_LOSS, ledger));
    expect(evidence[0].creditTbAccountId).toBe(await cashHex(wallet.id, ledger));
    expect(String(evidence[0].amount)).toBe('7');
    expect(await cashPosted(wallet.id, ledger)).toBe(4993n); // 铺底 5000 − 核销 7 = 外部真值 4993
    const posted = await (prisma as any).auditLogEvent.findFirst({ where: { action: 'RECON_ADJUSTMENT_POSTED', primarySubjectNo: adjustmentNo } });
    expect(posted.reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    expect(JSON.parse(posted.actorRolesAtTime)).toEqual(['CFO']);

    await walletRecon.run({ cutoff: CUTOFF });
    const healed = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healed.status).toBe('RESOLVED');
    expect(healed.resolutionReason).toBe('AUTO_HEALED');
  });

  it('反例③（戊波二改口）：客户池超期 + 调查中——拿公司池核销码 400 指路「认损补缺」；认损补缺建单放行（金额 / 成因 / 生效日由服务端定），撤回即解锁', async () => {
    // 真造一个客户池破口（戊波二前这里是个假案子 + 假流水 id 的调账单反例；认损补缺要在案件页同一份差异行上取金额，所以必须是真行）：
    // 铺底 5000（真实充值两跳形状）、托管回单只到 4993 → 同参考号 AMOUNT_MISMATCH，差额 7 分，落在小额线内。
    const customer = await makeCustomer('EX3');
    await ensureCustomerAedTbAccounts(customer.id, customer.customerNo);
    const wallet = await createCustomerWallet({ ownerId: customer.id, ownerNo: customer.customerNo, network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: `AE-E2E-${randomUUID().slice(0, 8)}` });
    const REF = `E2E-EX3-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: customer.id, assetId: aedAssetId, ledger: 1, currency: aedCode, amount: 5000n, tag: 'EX3', externalRef: REF } as any);
    await createExternalLine({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', direction: 'IN', amount: 4993n, externalRef: REF });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', closingBalance: 4993n });
    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('CUSTOMER');
    const row0 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const ops = makeActor('E2E_OPS_EX3', 'OPS_OFFICER');
    const disp = await dispositions.record({
      caseNo: kase.caseNo,
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', disposition: 'HOLD_INVESTIGATING', findingNote: 'e2e：客户池托管少 7 分，查无可查',
      deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops);
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');
    await caseService.simulateTimeout(kase.caseNo, ops);
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    expect((await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep)
      .toMatchObject({ kind: 'SHORTFALL_TOPUP', amount: '7', lossSource: 'AGING', customerNo: customer.customerNo });

    const treasury = makeActor('E2E_TREASURY_C', 'TREASURY_OFFICER');
    const base = { caseNo: kase.caseNo, direction: 'REDUCE', amount: '7', effectiveDate: kase.businessDate, explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id, reasonInternal: 'x', dispositionNo: disp.dispositionNo };
    // 公司池核销码拿到客户池 → 400，话术指路认损补缺（不再有客户池认损调账单）
    await expect(adjustments.createDraft({ ...base, reasonCode: 'UNEXPLAINED_WRITE_OFF' } as any, treasury)).rejects.toThrow(/Recognize loss & top up/);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).adjustmentNo).toBeNull();

    // 认损补缺放行：出钱钱包 = 新建的运营户（夹具铺 50.00），建单即挂
    const from = await createFirmWallet({ vaultCode: 'F_OPS', network: 'AED_ZAND' });
    await fundFirmWallet({ walletId: from.id, ledger: 1, currency: aedCode, amount: 5000n, tag: 'EX3' });
    const req = await transferWf.initiateShortfallTopup({ caseNo: kase.caseNo, flowId: row0.internalFlow!.id, externalLineId: row0.externalLine!.id, fromWalletId: from.id, reason: 'e2e 认损补缺' }, treasury);
    expect(req.status).toBe('PENDING_APPROVAL');
    const itr = await (prisma as any).internalTransfer.findUnique({ where: { transferNo: req.transferNo } });
    expect(itr).toMatchObject({ purpose: 'SHORTFALL_TOPUP', lossSource: 'AGING', fromWalletId: from.id, toWalletId: wallet.id });
    expect(itr.amount.toString()).toBe('0.07'); // 金额 = 差异行的差额（7 分），不是客户端传的
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).transferNo).toBe(req.transferNo);
    expect((await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined(); // 挂了单，按钮收起
    // 撤回 → 行解锁、按钮回来
    await transferWf.cancel(req.transferNo, { reason: 'e2e 撤回' }, treasury);
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).transferNo).toBeNull();
    expect((await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep?.kind).toBe('SHORTFALL_TOPUP');
  });

  it('跨日切：跑批截止点后 6 小时的外部行，案件页仍显示那条「我有外无」（spec §6.1）', async () => {
    const day = toBusinessDate(new Date(CUTOFF.getTime() + 2 * 86_400_000));
    const runCutoff = new Date(`${day}T10:00:00.000Z`);
    const customer = await makeCustomer('STRADDLE');
    await ensureCustomerAedTbAccounts(customer.id, customer.customerNo);
    const wallet = await createCustomerWallet({ ownerId: customer.id, ownerNo: customer.customerNo, network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: `AE-E2E-${randomUUID().slice(0, 8)}` });
    const REF = `E2E-STRADDLE-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: customer.id, assetId: aedAssetId, ledger: 1, currency: aedCode, amount: 800n, tag: 'S9', externalRef: REF } as any);
    await createExternalLine({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', direction: 'IN', amount: 800n, externalRef: REF, datetime: new Date(`${day}T16:00:00.000Z`) });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', closingBalance: 800n, cutoffDate: day });

    await walletRecon.run({ cutoff: runCutoff });
    const kase = await openCaseFor(wallet.id);
    expect(kase.bucket).toBe('COMPENSATING');
    const detail = await reconQuery.getCase(kase.caseNo);
    expect(detail.flowSummary.orphanInternal).toBe(1);   // 修前为 0：页面按日终重建，16:00 的行落回窗内
  });
});

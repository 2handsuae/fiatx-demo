import * as path from 'path';
import * as dotenv from 'dotenv';

// Must be set before AppModule is imported — the 补料 e2e cases (Task 6, migrated
// 2026-08-18 to the material-request-ledger contract) drive
// MaterialRequestsService.mintSessionToken(), which calls the REAL SumsubClient's
// createActionSdkToken(). Without this switch it would try a genuine HTTP POST
// to api.sumsub.com using whatever APP_TOKEN/SECRET_KEY happen to be in .env
// (this worktree's never has them — see deposit-sumsub-verdicts.e2e-spec.ts's
// identical comment). The original 9 verdict-button cases below are unaffected —
// they only ever touch the separately-mocked SUMSUB_TXN_CLIENT.
process.env.SUMSUB_MOCK_MODE = 'true';

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors withdraw-money-arcs.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { WithdrawDemoScenarioService } from '../src/modules/withdraw-sumsub/demo-scenario.service';
import { MaterialRequestsService } from '../src/modules/identity/material-requests/material-requests.service';
import { MaterialRequestReviewService } from '../src/modules/identity/material-requests/material-request-review.service';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * Task 12: withdraw Sumsub verdict-button e2e — mirrors
 * test/deposit-sumsub-verdicts.e2e-spec.ts's structure (real AppModule, only
 * SUMSUB_TXN_CLIENT mocked), but drives the withdraw domain's 9 single-step
 * verdict buttons (`src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts`)
 * through the REAL production entry point `WithdrawDemoScenarioService.runVerdict()`
 * — the exact method the admin Simulation panel's buttons call — which itself
 * primes the mock Sumsub client and drives the real
 * ingest→router→handler→workflow chain end to end.
 *
 * Non-destructive by design (unlike deposit-sumsub-verdicts, which wipes the
 * whole deposit_transactions table and needs a dedicated throwaway DB): this
 * suite never truncates any table. It uses `demo_grace@example.com` (not
 * demo_alice/demo_bob/demo_frank, owned by the other e2e suites) with a fixed
 * registered destination address per asset, so parallel jest workers running
 * other spec files never race this suite's fixtures. Runs against the
 * worktree's regular self-stack DB (same `.env` as withdraw-money-arcs).
 */
describe('Withdraw Sumsub verdict buttons (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: WithdrawWorkflowService;
  let withdrawService: WithdrawTransactionsService;
  let withdrawQuoteService: WithdrawQuoteService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let demoService: WithdrawDemoScenarioService;
  let materialRequests: MaterialRequestsService;
  let materialRequestReview: MaterialRequestReviewService;
  let mockSumsubTxnClient: MockSumsubTxnClient;

  let customerId: string;
  let customerNo: string;

  let fiatAssetId: string;
  let fiatCode: string;
  let registeredIban: string;

  const HARNESS_ACTOR = { actorId: 'E2E_HARNESS', actorRole: 'OPS_OFFICER' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(WithdrawWorkflowService);
    withdrawService = app.get(WithdrawTransactionsService);
    withdrawQuoteService = app.get(WithdrawQuoteService);
    fundsOrders = app.get(FundsOrderService);
    accounting = app.get(AccountingService);
    demoService = app.get(WithdrawDemoScenarioService);
    // 2026-08-18 迁移：WithdrawVerificationSessionService（按 seq 定位）已被
    // Task 9 掏空，职责并入材料请求账——改取 MaterialRequestsModule 导出的
    // MaterialRequestsService（按 requestNo 定位）。This app.init() call is also
    // the place that proves the module's SumsubClient DI wiring
    // (MaterialRequestsService's constructor dependency, via forwardRef(OnboardingModule))
    // actually resolves end to end.
    materialRequests = app.get(MaterialRequestsService);
    materialRequestReview = app.get(MaterialRequestReviewService);
    mockSumsubTxnClient = app.get(SUMSUB_TXN_CLIENT) as unknown as MockSumsubTxnClient;

    const customer = await prisma.customerMain.findUnique({
      where: { email: 'demo_grace@example.com' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer demo_grace@example.com not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;
    customerNo = customer.customerNo;

    // submitSumsubTxn (birth-time Gate 0 equivalent) needs an applicantId on file
    // to actually stamp a real sumsubTxnId — without it, WithdrawDemoScenarioService's
    // verdict delivery would mint a txnId no withdraw row actually carries, and the
    // handler would treat every delivery as an orphan webhook (see that service's
    // header comment).
    await prisma.customerMain.update({
      where: { id: customerId },
      data: { sumsubApplicantId: 'e2e0withdrawscenariosgrace1' },
    });

    const fiatAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    if (!fiatAsset || !fiatAsset.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    fiatAssetId = fiatAsset.id;
    fiatCode = fiatAsset.code;

    await ensureCustomerWallet({ assetId: fiatAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK', iban: `AE_WD_SCN_${customerNo}` });

    registeredIban = 'AE070331234567890198765';
    await ensureWithdrawalAddress({
      assetId: fiatAssetId, addressType: 'BANK', network: 'FIAT',
      address: registeredIban, iban: registeredIban,
    });

    await fundCustomer(fiatAssetId, 'AED', '1000000');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /**
   * 2026-08-29 业主口径变更（见 spec §2.6(5) / withdraw-applicant-actions.service.ts:98
   * `const restrict = sceneTag === 'PEP_APPLICANT' || sceneTag === 'PEP_COUNTERPARTY'`）：
   * 便签挂谁由 tag 决定，取代了 2026-08-18 材料请求账迁移时那条"只要下发过补料
   * 就无差别锁客户"的旧行为（`issuer.register({ restrict: true, ... })` 曾经
   * 写死）。新口径——
   *
   *  - 普通 SOF 补料（无 sceneTag，本文件②V2_AWAIT_USER / ⑤V5_AWAIT_USER_MULTI
   *    两条用例恒如此）问的是"这笔钱哪来的" = 交易层的事 → `restrict=false`，
   *    `resolveCause` 直接返回 null（material-request-issuer.service.ts:166），
   *    `persist()` 连 `openRestriction` 都不调（同文件:138）——只挂订单，
   *    压根不开便签，客户的 WITHDRAW/SWAP 能力不受影响。
   *  - PEP（③V3_AWAIT_USER_PEP_APPLICANT，本文件只测这一档）问的是"这个人是不是
   *    政治人物" = 人身层的事 → `restrict=true`，才落 `PENDING_DOCUMENT` 因由
   *    默认 scopes `['WITHDRAW','SWAP']`（restriction-cause.constant.ts:93-100）
   *    的客户级便签，直到 Sumsub 复核 GREEN（`MaterialRequestReviewService
   *    .applyReview` → `autoRelease`）或运营人工放行才解开。
   *
   * 由此改写下面两点：
   *
   * 1) `WithdrawWorkflowService.assertCustomerComplianceOrFreeze`（"A4 客户级
   *    合规闸"，定义于 withdraw-workflow.service.ts:140，payout-phase 检查点在
   *    :913）只看 `CustomerAccessService.resolve().blocked.has('WITHDRAW')`，
   *    纯由 `customer_restrictions` 表驱动。"补料完整弧"/"多条 action" 两条用例
   *    走的都是纯 SOF verdict（②/⑤），从未开过便签，这道闸在这两条用例的路径上
   *    根本不会被触发——有没有下面的 `reviewGreen(...)`，`V1_APPROVED` 都能推进
   *    到 PAYOUT_PENDING。两处调用仍然保留，但理由已经换了：
   *      a) 它复刻的是 `sumsub-ingestion.service.ts` 处理真实
   *         `applicantActionReviewed` webhook 时调的同一个方法/同一个 actor
   *         字面量（见下面 helper 的 doc）——SOF 材料请求在生产环境里终究要被
   *         Sumsub 给出复核结论，没有便签可撕不代表这一步不发生，删掉它会让
   *         "补料完整弧"这个用例名不副实。
   *      b) 验证 `applyReview` 对"零便签"材料请求的返回契约（`row.restrictionNo`
   *         为 null 时跳过 `autoRelease` 但落章照常完成，返回
   *         `{outcome:'APPROVED'}`）——这个分支已有更精确的 mock 单测覆盖
   *         （material-request-review.service.spec.ts「GREEN 但这一行没挂
   *         便签 → 不调 autoRelease」），这里是走真实 DI/事务/事件的 e2e 复核，
   *         不是重复劳动。
   * 2) 本 domain 的 admin 模拟面板没有 V7/V8 那样的"认证复核"按钮可以喂
   *    `applicantActionReviewed` 走完解锁弧（已登记 BACKLOG）——上一条要用的
   *    `applyReview` 只能直接调 service，不经过某个 demo 按钮。
   *
   * 便签本身若不清场还会带来第三个问题：suite 本身"non-destructive by
   * design"，共用同一个持久化客户（demo_grace）；③（PEP）用例只停在
   * ACTION_PENDING、从不释放自己开出的客户级便签（②⑤是 SOF，压根没开便签，
   * 不在此列），会挡住后面用例自己的
   * `WithdrawWorkflowService.createWithdrawal()`（真实走 `CustomerAccessService
   * .assertCapability` 闸，直接 403）——这不是被测代码的 bug，是测试之间需要的
   * 隔离，与 swap-sumsub-scenarios.e2e-spec.ts 在 beforeAll 里 `deleteMany` 是
   * 同一类清场，只是这里的用例是交叉的（create 与 verdict 穿插），改成每条用例
   * 开跑前都清一次。
   *
   * 终审 Important #4（2026-08-18 二次修订）：此前同一份 fixture 的
   * externalActionId 是固定字面量（`EXT-SOF-0001`/`EXT-MULTI-0001..3`），材料
   * 请求账的 externalActionId 又是全表 `@unique`（不按客户/单号分段）——同一个
   * 字面量被两条独立用例各登记一次会在 DB 唯一约束上直接 P2002（且不会被
   * 重试，`material-requests.service.ts` 的 `create()` 只重试 `requestNo`
   * 撞号）。根因已在 `verdict-buttons.ts` 层修掉（applicantActions 改成按调用
   * 现铸），这里的 `beforeEach` 保留纯粹是测试卫生，不再是绕过 P2002 的必要
   * 条件。
   */
  beforeEach(async () => {
    await prisma.customerRestriction.deleteMany({ where: { customerId } });
    await prisma.materialRequest.deleteMany({ where: { customerId } });
  });

  /** 复刻 sumsub-ingestion.service.ts 处理 applicantActionReviewed webhook 时的
   *  真实调用（同一个 actor 字面量），模拟"Sumsub 复核这条材料请求 GREEN"。 */
  async function reviewGreen(externalActionId: string) {
    return materialRequestReview.applyReview({
      externalActionId,
      reviewAnswer: 'GREEN',
      actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  async function ensureCustomerWallet(opts: {
    assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string; address?: string;
  }): Promise<string> {
    const existing = await (prisma as any).wallet.findFirst({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, assetId: opts.assetId, walletRole: opts.walletRole, status: 'ACTIVE' },
    });
    if (existing) return existing.id;
    const created = await (prisma as any).wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
    });
    return created.id;
  }

  async function ensureWithdrawalAddress(opts: {
    assetId: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId, assetId: opts.assetId, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-SCN-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: `e2e-withdraw-sumsub-scenarios-address-${opts.addressType}`,
      },
    });
  }

  async function fundCustomer(assetId: string, currency: string, amount: string): Promise<void> {
    const asset = await (prisma as any).asset.findUnique({ where: { id: assetId } });
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    const amountBigint = decimalToBigint(amount, asset.decimals);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: amountBigint,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo: `E2E-WITHDRAW-SCN-FUND-${currency}`,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: currency,
        traceId: `e2e-withdraw-scn-fund-${currency}`,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for withdraw sumsub-scenario tests',
        isExternalCrossing: false,
      },
    });
  }

  async function createQuote(assetId: string, assetCode: string, amount: string) {
    return withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
      assetId, assetCode, amount: new Prisma.Decimal(amount), customerId,
    });
  }

  /** Real production birth: WithdrawWorkflowService.createWithdrawal() via a
   *  real quote, then polls for the fire-and-forget birth-time submitSumsubTxn
   *  to stamp a real sumsubTxnId before the caller delivers any verdict. */
  async function createWithdrawal(opts: { assetId: string; assetCode: string; amount: string; toIban: string }) {
    const quote = await createQuote(opts.assetId, opts.assetCode, opts.amount);
    const dto: any = { assetId: opts.assetId, amount: Number(opts.amount), toIban: opts.toIban, quoteId: quote.id };
    const w = await workflow.createWithdrawal(dto, customerId, 'CUSTOMER');
    await waitUntil(async () => {
      const row = await withdrawService.findOneInternal(w.id);
      return !!row.sumsubTxnId;
    });
    return w;
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

  /**
   * Delivers one verdict button through the REAL production entry point
   * (WithdrawDemoScenarioService.runVerdict) — same code the admin simulation
   * button calls.
   */
  async function deliver(withdrawId: string, buttonKey: string) {
    return demoService.runVerdict(withdrawId, buttonKey, HARNESS_ACTOR);
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const row = await withdrawService.findOneInternal(id);
    return row?.status;
  }

  async function auditActionsFor(id: string): Promise<string[]> {
    const w = await (prisma as any).withdrawTransaction.findUnique({ where: { id }, select: { withdrawNo: true } });
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectNo: w!.withdrawNo, primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION },
      select: { action: true },
    });
    return rows.map((r: any) => r.action);
  }

  // ── matrix (9 single-step verdict buttons) ──────────────────────────────

  it('① approved: COMPLIANCE_PENDING → PAYOUT_PENDING, payout + fee legs created', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '200', toIban: registeredIban });

    await deliver(w.id, 'V1_APPROVED');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_SUMSUB_SUBMITTED);
    expect(actions).toContain(AuditActions.WITHDRAW_COMPLIANCE_PASSED);
    expect(actions).toContain(AuditActions.WITHDRAW_PAYOUT_INITIATED);

    const legs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, {});
    expect(legs.map((l: any) => l.legSeq).sort()).toEqual([1, 2]);
  });

  it('② awaiting user: ACTION_PENDING, manualReason=CLIENT_ACTION', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '150', toIban: registeredIban });

    await deliver(w.id, 'V2_AWAIT_USER');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).manualReason).toBe('CLIENT_ACTION');
    const detail = await withdrawService.findOneForAdmin(w.id);
    expect((detail as any).sumsubDetail.applicantActionIds.length).toBeGreaterThan(0);
  });

  it('③ awaiting user · PEP: ACTION_PENDING, manualReason=EDD_PEP, 报文含 PEP_APPLICANT tag', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '150', toIban: registeredIban });

    await deliver(w.id, 'V3_AWAIT_USER_PEP_APPLICANT');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).manualReason).toBe('EDD_PEP');
    const detail = await withdrawService.findOneForAdmin(w.id);
    expect((detail as any).sumsubDetail.tags).toContain('PEP_APPLICANT');
  });

  it('⑧ rejected · sanctions: FROZEN, 零记账', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '250', toIban: registeredIban });

    await deliver(w.id, 'V8_REJECTED_SANCTION_COUNTERPARTY');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_FROZEN);
    expect(actions).not.toContain(AuditActions.WITHDRAW_PAYOUT_INITIATED);
    const legs = await fundsOrders.findByParent({ withdrawTransactionId: w.id }, {});
    expect(legs).toHaveLength(0);
  });

  it('⑨ rejected · MLRO freeze: FROZEN', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '300', toIban: registeredIban });

    await deliver(w.id, 'V9_REJECTED_MLRO_FREEZE');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_FROZEN);
  });

  it('⑪ then ⑩ rejected · dispoTag=FINAL_REJECTED: MANUAL_CHECKING → REJECTED + locks released (disposition tag only executes from MANUAL_CHECKING)', async () => {
    const amount = '350';
    const before = await accounting.getCustomerAvailableBalance(customerId, 'AED');

    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount, toIban: registeredIban });

    await deliver(w.id, 'V11_REJECTED_NO_TAG');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);

    await deliver(w.id, 'V10_REJECTED_DISPOSITION');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.REJECTED);

    const actions = await auditActionsFor(w.id);
    expect(actions).toContain('WITHDRAW_REFUNDED'); // 站2-β:标签路并入 REFUNDED,解锁事实在其 metadata

    const after = await accounting.getCustomerAvailableBalance(customerId, 'AED');
    expect(after.available).toBe(before.available); // fully restored
  });

  it('⑪ rejected · no disposition tag: MANUAL_CHECKING', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '220', toIban: registeredIban });

    await deliver(w.id, 'V11_REJECTED_NO_TAG');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.MANUAL_CHECKING);
    const actions = await auditActionsFor(w.id);
    expect(actions).not.toContain(AuditActions.WITHDRAW_FROZEN);
  });

  it('⑥ on hold: 状态不变 (COMPLIANCE_PENDING) + slaDeadline set', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '90', toIban: registeredIban });

    await deliver(w.id, 'V6_ONHOLD');

    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
    const refreshed = await withdrawService.findOne(w.id);
    expect((refreshed as any).slaDeadline).toBeTruthy();
    const actions = await auditActionsFor(w.id);
    expect(actions).toContain(AuditActions.WITHDRAW_ONHOLD);
  });

  // ── Task 6 → 2026-08-18 材料请求账迁移：补料 embed 弧 + 接口层不可区分 + 多条 action
  //
  // Mirrors test/deposit-sumsub-verdicts.e2e-spec.ts's four cases (structure/
  // helpers identical). 原先直接调 `WithdrawVerificationSessionService`（按
  // (customerId, withdrawNo, seq) 定位，backs `CustomerWithdrawController`'s
  // `GET/POST my/:withdrawNo/verification-session/:seq`）——该服务已被 Task 9
  // 掏空（职责并入材料请求账，见 withdraw-verification-session.service.ts 文件头
  // 注释），本节改直接调 `MaterialRequestsService`（按 `requestNo` 定位，与
  // `material-requests.client.controller.ts` 的 `getSession`/`submit` 端点背后
  // 同一对方法：`mintSessionToken`/`markSubmitted`），下面两个 helper 原样复刻
  // 控制器的响应体映射。`workflow`/`deliver` 不受影响。

  /** 复刻 MaterialRequestsClientController.getSession 的响应体映射 */
  async function getSessionView(requestNo: string): Promise<{ submitted: boolean; sdkToken: string | null }> {
    const sdkToken = await materialRequests.mintSessionToken(requestNo, customerId);
    return sdkToken ? { submitted: false, sdkToken } : { submitted: true, sdkToken: null };
  }

  /** 复刻 MaterialRequestsClientController.submit 的落章调用 */
  async function submitMaterial(requestNo: string): Promise<boolean> {
    return materialRequests.markSubmitted(requestNo, {
      actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER',
    });
  }

  it('补料完整弧：awaitUser → 取会话 → 提交 → 状态未动 → 裁决放行 → PAYOUT_PENDING', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '120', toIban: registeredIban });

    await deliver(w.id, 'V2_AWAIT_USER');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);

    const live = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    expect(live).toHaveLength(1);
    const requestNo = live[0].requestNo;

    const session1 = await getSessionView(requestNo);
    expect(session1.submitted).toBe(false);
    expect(session1.sdkToken).toBeTruthy();

    expect(await submitMaterial(requestNo)).toBe(true);

    const after = await withdrawService.findOneInternal(w.id);
    expect(after.status).toBe(WithdrawTransactionStatus.ACTION_PENDING); // 状态没动
    // 2026-08-18 迁移注记：旧断言在这里查 withdrawTransaction.actionSubmittedAt
    // truthy —— 子表时代 submitBySeq 在"全部交齐"时顺带写的缓存戳。Task 9 把
    // 提交入口挪到 MaterialRequestsService.markSubmitted 之后，这条写入路径没有
    // 对应物被接上：全仓 grep 只有 clearWithdrawCache 写 actionSubmittedAt，且
    // 只写 null，没有任何代码再把它置为非 null（真实回归，已登记 BACKLOG，与充值
    // 域同款）。等价的业务事实改读材料账自己的状态：这一行已经从
    // PENDING_SUBMISSION 变成 SUBMITTED，即"客户已不再欠这份材料"。
    const row = await materialRequests.findByNo(requestNo);
    expect(row?.status).toBe('SUBMITTED');
    // SLA 表仍新鲜：建 action 时（V2_AWAIT_USER 投递时）设的 7 天窗口，测试在
    // 毫秒级时间内跑完，未被打破——不是"提交时重置"证明的，只是还没到期。
    expect(new Date((after as any).slaDeadline).getTime())
      .toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    // 材料提交≠材料通过审核——submit 只是"客户交了"。但这条用例走的是纯 SOF
    // verdict（V2_AWAIT_USER，sceneTag 恒 undefined），2026-08-29 口径下
    // register() 传 restrict=false，压根没开客户级便签（见本文件 beforeEach
    // 上方说明注释）——A4 合规闸不会因为这条材料请求冻住下面的 V1_APPROVED，
    // 有没有这步 reviewGreen 结果都一样。留着是为了复刻 Sumsub 真实复核
    // webhook 的同一调用，并验证 applyReview 对"零便签"请求的返回契约。
    const reviewed = await reviewGreen(row!.externalActionId);
    expect(reviewed?.outcome).toBe('APPROVED');

    await deliver(w.id, 'V1_APPROVED');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
  });

  it('接口不可区分：已提交的单，ACTION_PENDING 与 FROZEN 的会话响应体全等', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '130', toIban: registeredIban });

    await deliver(w.id, 'V2_AWAIT_USER');
    const live = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    expect(live).toHaveLength(1);
    const requestNo = live[0].requestNo;
    await submitMaterial(requestNo);

    const before = await getSessionView(requestNo);

    await deliver(w.id, 'V8_REJECTED_SANCTION_COUNTERPARTY');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);

    const after = await getSessionView(requestNo);
    expect(after).toEqual(before);
  });

  // ── Task 6 → 2026-08-18 迁移：多条 action（材料账取代子表 + "全部交齐" 缓存）

  it('多条 action：交完前两条仍 ACTION_PENDING，交完第三条才算全部交齐', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '170', toIban: registeredIban });

    await deliver(w.id, 'V5_AWAIT_USER_MULTI');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);

    // 2026-08-18 迁移注记：旧断言读 findOneForCustomerByWithdrawNo(...).actions
    // （子表关系 `applicantActions`，`{seq, submittedAt}`）。Task 9 之后该子表
    // 零写入（WithdrawApplicantActionsService 内脏已换材料账），这个关系恒空
    // 数组——不是本次要修的范围（withdraw-transactions.service.ts 未改动），但
    // 断言必须换成真实数据源：材料账按 externalActionId 定位同一批 action。
    //
    // 终审 Important #4（2026-08-18 二次修订）：V5_AWAIT_USER_MULTI fixture 的
    // 三个 externalActionId 此前是固定字面量 EXT-MULTI-000{1,2,3}，已改成按
    // 调用现铸（见 src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts），
    // 断言相应从"是这三个字面量"改成"有三条互不相同的活行"，用真实返回值
    // 定位而不是硬编码字面量。
    const live = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    expect(live).toHaveLength(3);
    expect(new Set(live.map((r) => r.externalActionId)).size).toBe(3);
    expect(live.every((r) => r.status === 'PENDING_SUBMISSION')).toBe(true); // 一条都还没交

    const [firstNo, secondNo, thirdNo] = live.map((r) => r.requestNo);

    await submitMaterial(firstNo);
    await submitMaterial(secondNo);
    const midway = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    expect(midway.filter((r) => r.status === 'PENDING_SUBMISSION')).toHaveLength(1); // 还没交齐
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.ACTION_PENDING);

    await submitMaterial(thirdNo);
    const final = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    expect(final.every((r) => r.status === 'SUBMITTED')).toBe(true); // 三条逐条都已提交
    expect(final.filter((r) => r.status === 'PENDING_SUBMISSION')).toHaveLength(0); // 全部交齐

    // V5_AWAIT_USER_MULTI 同样是纯 SOF verdict（sceneTag 恒 undefined），三条
    // action 的 register() 都传 restrict=false，一张便签都没开——不存在"三张都
    // 要复核 GREEN 才能撕开 access.blocked"这回事，A4 合规闸不会因为它们冻住
    // 下面的 V1_APPROVED（同"补料完整弧"用例的注记）。三次 reviewGreen 仍然
    // 保留，理由同上：复刻真实复核 webhook 调用 + 验证 applyReview 对"零便签"
    // 请求的返回契约，不是为了解锁付款。
    for (const ext of live.map((r) => r.externalActionId)) {
      const reviewed = await reviewGreen(ext);
      expect(reviewed?.outcome).toBe('APPROVED');
    }

    await deliver(w.id, 'V1_APPROVED');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.PAYOUT_PENDING);
  });

  it('逐条不可区分：同一条 action 在 ACTION_PENDING 与 FROZEN 下会话响应体全等', async () => {
    const w = await createWithdrawal({ assetId: fiatAssetId, assetCode: fiatCode, amount: '175', toIban: registeredIban });

    await deliver(w.id, 'V5_AWAIT_USER_MULTI');
    const live = await materialRequests.listLiveByOrder('WITHDRAW', w.withdrawNo);
    // 终审 Important #4：externalActionId 现铸不再是固定字面量，任取一条即可——
    // 这条用例只关心"同一条 action 前后两次会话响应体相等"，不关心是哪一条。
    const requestNo = live[0].requestNo;
    await submitMaterial(requestNo);

    const before = await getSessionView(requestNo);

    await deliver(w.id, 'V8_REJECTED_SANCTION_COUNTERPARTY');
    expect(await statusOf(w.id)).toBe(WithdrawTransactionStatus.FROZEN);

    const after = await getSessionView(requestNo);
    expect(after).toEqual(before);
  });
});

import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's
// internal load timing (belt-and-braces — ConfigModule.forRoot() in
// AppModule loads the same .env, this just guarantees the order).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositStatusChangedEvent } from '../src/modules/trading/deposit-transactions/events/deposit-transaction.events';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { SumsubIngestionService } from '../src/modules/sumsub-ingestion/sumsub-ingestion.service';
import { DepositSlaService } from '../src/modules/deposit-sumsub/deposit-sla.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { WithdrawalAddressService } from '../src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { DEPOSIT_SCENARIOS, DepositScenario } from '../src/modules/deposit-sumsub/fixtures/scenarios';
import { runScenario, DepositScenarioRunnerCtx, ScenarioDeposit } from './helpers/deposit-scenario-runner';

/**
 * Task 12: 8 场景 e2e + 幂等/乱序,充值状态机·计划1 引擎收官验证。
 *
 * Harness 说明(详见 .superpowers/sdd/task-12-report.md):
 * - 用 `Test.createTestingModule({ imports: [AppModule] })` 装真实 Nest app,只 override
 *   SUMSUB_TXN_CLIENT → MockSumsubTxnClient(submit/getTxn 走 mock,别的一律真实服务/真实 DB/
 *   真实 TigerBeetle —— 本 worktree 的 self 栈 TB 需先 `bash scripts/stack.sh up` 且已跑过
 *   `npm run db:biz:init` 播种 assets/customers,否则 beforeAll 会直接抛错停下,不会硬凑假绿)。
 * - 驱动到 COMPLIANCE_PENDING:没有走 detected()→funds_order→事件级联(那条链是 fire-and-forget
 *   emit,event handler 不被 caller await,在测试里会竞态)。改为最简且可靠的设置:直接
 *   Prisma 建一条 status=COMPLIANCE_PENDING 的 deposit,primeSubmit 预置 mock 应答,再直接
 *   调用 DepositWorkflowService.handleDepositStatusChanged()(即 'deposit.status.changed'
 *   事件真正会调的那个方法,只是不经过 EventEmitter2 的 fire-and-forget 派发,全程可 await)。
 *   PAYIN_PENDING→COMPLIANCE_PENDING 之前那段(payin 检测/STEP_1 记账)不在本任务范围
 *   (那是更早的管线阶段,不是本状态机的验证目标)。
 * - S1 记账守恒:demo customer CU2601019430 的 CLIENT_PAYABLE/DEPOSIT_SUSPENSE TB 账户已由
 *   `db:biz:init` 播种注册(resolveTbAccountId 不会懒建账户,找不到直接抛异常),所以复用她。
 *   STEP_2(DEPOSIT_SUSPENSE→CLIENT_PAYABLE)不依赖 STEP_1 先记的账 —— 两个账户 flags=0,
 *   没有 debits_must_not_exceed_credits 约束,可以只测 STEP_2 这一腿。
 */
describe('Deposit Sumsub scenarios (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: DepositWorkflowService;
  let depositService: DepositTransactionsService;
  let ingestionService: SumsubIngestionService;
  let slaService: DepositSlaService;
  let accounting: AccountingService;
  let mockSumsubTxnClient: MockSumsubTxnClient;

  let customerId: string;
  let fiatAssetId: string;
  let fiatDecimals: number;
  let fiatWalletId: string;
  let cryptoAssetId: string;
  let cryptoWalletId: string;

  let ctx: DepositScenarioRunnerCtx;
  let depositNoSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    // The full AppModule wires many @OnEvent handlers onto shared event names (e.g.
    // funds_order.status.changed across deposit/withdraw/swap workflows). Past
    // EventEmitter2's default maxListeners=10, it tries to log a possible-memory-leak
    // warning via process.emitWarning(new Error(...)) — under this Jest/Node combo that
    // throws (cross-realm `instanceof Error` mismatch) instead of just warning. Raise
    // the cap before app.init() (which triggers EventSubscribersLoader) so the app boots
    // exactly like the real process does; this is a jest-only knob, no src/ changes.
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(DepositWorkflowService);
    depositService = app.get(DepositTransactionsService);
    ingestionService = app.get(SumsubIngestionService);
    slaService = app.get(DepositSlaService);
    accounting = app.get(AccountingService);
    mockSumsubTxnClient = app.get(SUMSUB_TXN_CLIENT) as unknown as MockSumsubTxnClient;

    ctx = {
      ingestionService,
      mockSumsubTxnClient,
      depositService: {
        setSlaDeadline: (id, deadline) => depositService.setSlaDeadline(id, deadline),
      },
      slaService: {
        checkSlaBreaches: () => slaService.checkSlaBreaches(),
      },
    };

    const customer = await prisma.customerMain.findUnique({
      where: { customerNo: 'CU2601019430' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer CU2601019430 (demo_alice) not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;
    await prisma.customerMain.update({
      where: { id: customerId },
      data: { sumsubApplicantId: '6b1c47f0a2d38e5904bb7215' },
    });

    // Clean slate: DepositKytVerdictHandler.findBySumsubTxnId() does a global
    // findFirst on sumsubFinanceTxnId/sumsubTravelRuleTxnId — the fixtures reuse
    // short, fixed ids ('T1', 'T3', ...) by design, so any leftover deposit rows
    // from a previous run of this suite (or an interrupted run) would collide and
    // make findFirst resolve to the WRONG (stale) deposit. This worktree DB is
    // dedicated to this test suite, so wiping prior deposit rows before each run
    // is safe and keeps the suite repeatable.
    await prisma.depositTransaction.deleteMany({});
    // Same reasoning extended to the wallet/withdrawal-address fixtures created
    // below with hardcoded ibans/addresses ('AE_E2E_TEST_IBAN', 'DE8937...') — a
    // second run against this same worktree DB without this wipe hits the
    // `[customerId, assetId, address]` unique constraint on withdrawal_addresses
    // (BANK_ACCOUNT_ALREADY_REGISTERED), so this suite was only ever repeatable once.
    await prisma.wallet.deleteMany({ where: { ownerId: customerId } });
    await prisma.withdrawalAddress.deleteMany({ where: { customerId } });

    const fiatAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    const cryptoAsset = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
    if (!fiatAsset || !cryptoAsset) {
      throw new Error('Fixture assets AED/USDT not seeded — run `npm run db:biz:init` first.');
    }
    fiatAssetId = fiatAsset.id;
    fiatDecimals = fiatAsset.decimals;
    cryptoAssetId = cryptoAsset.id;

    // ownerNo (not just ownerId) must be set — TB evidence's R2 invariant guard
    // (account-flow-projector.service.ts) cross-checks walletRef's wallet.ownerNo
    // against the tb_account_registry's ownerNo for the posting account; a wallet
    // with ownerId set but ownerNo null fails that check and STEP_2 accounting
    // throws (caught as DEPOSIT_ACCOUNTING_BLOCKED, deposit never reaches SUCCESS).
    const fiatWallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        type: 'FIAT_BANK',
        assetId: fiatAssetId,
        iban: 'AE_E2E_TEST_IBAN',
        status: 'ACTIVE',
      },
    });
    fiatWalletId = fiatWallet.id;

    const cryptoWallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        type: 'CRYPTO_ADDRESS',
        assetId: cryptoAssetId,
        address: 'T_E2E_TEST_ADDRESS',
        status: 'ACTIVE',
      },
    });
    cryptoWalletId = cryptoWallet.id;

    // I1 fix: approveDeposit (via both checkAutoApproval and the new applyKytApproved
    // path) is gated on the customer having an active fiat withdrawal address
    // ("trading-ready"). The demo fixture customer has none by default in this
    // worktree's DB, so every approved→SUCCESS scenario below would now get held
    // in COMPLIANCE_PENDING instead. Seed one real ACTIVE bank withdrawal address via
    // the actual service (first bank address for a customer auto-activates, no
    // cooling period) so the e2e customer matches real trading-ready semantics.
    await app.get(WithdrawalAddressService).createBankAccount({
      customerId,
      customerNo: customer.customerNo,
      assetId: fiatAssetId,
      iban: 'DE89370400440532013000',
      swiftBic: 'DEUTDEFF500',
      bankName: 'E2E Test Bank',
      beneficiaryName: customer.customerNo,
      ownershipDeclaredAt: new Date(),
      ownershipProofType: 'E2E_FIXTURE',
      traceId: 'task-12-e2e-withdrawal-address-seed',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function uniqueDepositNo(scenarioKey: string): string {
    depositNoSeq += 1;
    return `DEPT12${scenarioKey}${Date.now()}${depositNoSeq}`;
  }

  /** Mirrors DepositWorkflowService.decimalToBigint (private) for the balance assertion. */
  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  /**
   * Creates a deposit directly at COMPLIANCE_PENDING and drives Gate 0
   * (submitSumsubTxns + initializeComplianceGates) for real — see file header
   * for why this bypasses the funds_order/event cascade.
   */
  async function createDepositAtCompliancePending(
    scenario: DepositScenario,
    opts: { isCrypto: boolean; amount: string },
  ): Promise<ScenarioDeposit> {
    const assetId = opts.isCrypto ? cryptoAssetId : fiatAssetId;
    const toWalletId = opts.isCrypto ? cryptoWalletId : fiatWalletId;
    const depositNo = uniqueDepositNo(scenario.key);

    const created = await prisma.depositTransaction.create({
      data: {
        depositNo,
        traceId: depositNo,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        statusHistory: JSON.stringify([
          {
            status: DepositTransactionStatus.COMPLIANCE_PENDING,
            timestamp: new Date().toISOString(),
            operatorId: 'E2E_HARNESS',
            reason: 'Task 12 e2e fixture: created directly at COMPLIANCE_PENDING (see spec file header)',
          },
        ]),
        assetId,
        toWalletId,
        amount: new Prisma.Decimal(opts.amount),
        netAmount: new Prisma.Decimal(opts.amount),
        feeAmount: new Prisma.Decimal(0),
        // final-review Fix 4: initiateReturn() now requires a sender address/IBAN on
        // file (a RETURN_TO_SENDER disposition needs somewhere to send the funds back
        // to) — S6_DIRTY_MANUAL_RETURN exercises that path, so every fixture deposit
        // here needs one, matching what a real inbound transfer signal would capture.
        fromIban: opts.isCrypto ? undefined : 'E2E_SENDER_IBAN',
        fromAddress: opts.isCrypto ? 'E2E_SENDER_ADDRESS' : undefined,
      },
    });

    // Must prime BEFORE Gate 0 fires submitSumsubTxns, or the mock falls back to
    // `MOCK-${clientTxnId}` and the fixture's kytTxnId never matches on webhook lookup.
    mockSumsubTxnClient.primeSubmit(created.depositNo, scenario.submit.financeTxnId);
    if (scenario.submit.travelRuleTxnId) {
      mockSumsubTxnClient.primeSubmit(`${created.depositNo}-TR`, scenario.submit.travelRuleTxnId);
    }

    // Real Gate-0 entry point — the exact method 'deposit.status.changed' would invoke,
    // called directly (and awaited) instead of via the fire-and-forget EventEmitter2 emit.
    await workflow.handleDepositStatusChanged(
      new DepositStatusChangedEvent(
        created.id,
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER',
        customerId,
        assetId,
        opts.amount,
      ),
    );

    return { id: created.id, depositNo: created.depositNo };
  }

  async function auditActionsFor(depositId: string): Promise<string[]> {
    const rows = await prisma.auditLogEvent.findMany({
      where: { entityId: depositId, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  async function finalStatusOf(depositId: string): Promise<string | undefined> {
    const row = await prisma.depositTransaction.findUnique({ where: { id: depositId } });
    return row?.status;
  }

  // ── 8 scenarios ──────────────────────────────────────────────────────────

  it('S1_HAPPY_FIAT: fiat happy path → SUCCESS, STEP_2 posts DEPOSIT_SUSPENSE→CLIENT_PAYABLE (customer +amount)', async () => {
    const scenario = DEPOSIT_SCENARIOS.S1_HAPPY_FIAT;
    const amount = '100.00';

    const before = await accounting.getCustomerAvailableBalance(customerId, 'AED');

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);

    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_GATE0_PASSED);
    expect(actions).toContain(AuditActions.DEPOSIT_SUMSUB_SUBMITTED);
    expect(actions).toContain(AuditActions.DEPOSIT_COMPLETED);

    // 记账守恒(brief Step 2):真 TigerBeetle,客户 CLIENT_PAYABLE(AED) 净额 +amount。
    const after = await accounting.getCustomerAvailableBalance(customerId, 'AED');
    const expectedDelta = decimalToBigint(amount, fiatDecimals);
    expect(after.total - before.total).toBe(expectedDelta);
  });

  it('S2_HAPPY_CRYPTO: crypto happy path (finance + travelRule legs) → SUCCESS', async () => {
    const scenario = DEPOSIT_SCENARIOS.S2_HAPPY_CRYPTO;
    const amount = '10.500000';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: true, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_COMPLETED);
  });

  it('S3_SANCTIONS: SANCTION tag on rejected → FROZEN, zero-accounting', async () => {
    const scenario = DEPOSIT_SCENARIOS.S3_SANCTIONS;
    const amount = '200.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_FROZEN);
    // FROZEN 零记账:不应该出现 DEPOSIT_COMPLETED
    expect(actions).not.toContain(AuditActions.DEPOSIT_COMPLETED);
  });

  it('S4_PEP_EDD_PASS: PEP → ACTION_PENDING, EDD 补料后自动重评 approved → SUCCESS', async () => {
    const scenario = DEPOSIT_SCENARIOS.S4_PEP_EDD_PASS;
    const amount = '150.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_COMPLETED);
  });

  it('S5_DIRTY_MANUAL_FROZEN: rejected(no tag)→MANUAL_CHECKING, rejected(FROZEN_BY_MLRO)→FROZEN', async () => {
    const scenario = DEPOSIT_SCENARIOS.S5_DIRTY_MANUAL_FROZEN;
    const amount = '300.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_MANUAL_CHECKING);
    expect(actions).toContain(AuditActions.DEPOSIT_FROZEN);
  });

  it('S6_DIRTY_MANUAL_RETURN: rejected(no tag)→MANUAL_CHECKING, rejected(RETURN_TO_SENDER)→opens DEPOSIT_RETURN approval, stays MANUAL_CHECKING (A2)', async () => {
    const scenario = DEPOSIT_SCENARIOS.S6_DIRTY_MANUAL_RETURN;
    const amount = '250.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    // A2: RETURN_TO_SENDER no longer drives a direct status transition — it opens a
    // maker-checker approval instead. Deposit stays MANUAL_CHECKING (real settlement +
    // the RETURNING/RETURNED transition lands in A3).
    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_MANUAL_CHECKING);
    expect(actions).toContain(AuditActions.DEPOSIT_RETURN_APPROVAL_REQUESTED);

    const returnApproval = await prisma.approvalCase.findFirst({
      where: { actionType: 'DEPOSIT_RETURN', entityRef: deposit.id },
    });
    expect(returnApproval).toBeTruthy();
    expect(returnApproval?.status).toBe('PENDING');
  });

  it('S7_DIRTY_MANUAL_OVERTURNED: rejected(no tag)→MANUAL_CHECKING, 官方裁决翻回 approved → SUCCESS', async () => {
    const scenario = DEPOSIT_SCENARIOS.S7_DIRTY_MANUAL_OVERTURNED;
    const amount = '120.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_MANUAL_CHECKING);
    expect(actions).toContain(AuditActions.DEPOSIT_MANUAL_APPROVED);
    expect(actions).toContain(AuditActions.DEPOSIT_COMPLETED);
  });

  it('S9_ONHOLD_SLA: onHold挂起, SLA 定时器扫到过期 → MANUAL_CHECKING', async () => {
    const scenario = DEPOSIT_SCENARIOS.S9_ONHOLD_SLA;
    const amount = '80.00';

    const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });
    await runScenario(ctx, scenario, deposit);

    expect(await finalStatusOf(deposit.id)).toBe(scenario.expectedFinalStatus);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_ONHOLD);
    expect(actions).toContain(AuditActions.DEPOSIT_SLA_BREACHED);
  });

  // ── idempotency + out-of-order ───────────────────────────────────────────

  describe('idempotency + out-of-order (workflow/handler layer)', () => {
    it('same applicantKytTxnApproved delivered twice → deposit transitions once (2nd is no-op)', async () => {
      // Own scenario object with a unique financeTxnId (NOT S1's fixed 'T1') —
      // findBySumsubTxnId() does a global lookup with no per-run scoping, so
      // reusing a fixture's hardcoded id here would collide with the S1 test's
      // own (already-SUCCESS, terminal) deposit and findFirst() could resolve
      // to the wrong row.
      const scenario: DepositScenario = {
        ...DEPOSIT_SCENARIOS.S1_HAPPY_FIAT,
        key: 'IDEMPOTENCY_TEST',
        submit: { financeTxnId: `IDEM-${Date.now()}` },
      };
      const amount = '90.00';

      const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });

      // ingest() with isSimulated:true bypasses ingestion-layer dedupe on purpose —
      // this test targets workflow/handler-layer idempotency (applyKytVerdict's
      // KYT_VERDICT_TERMINAL_STATUSES short-circuit), a separate layer from the
      // dedupe already covered elsewhere. See runner header comment.
      const webhook = { type: 'applicantKytTxnApproved', kytTxnId: scenario.submit.financeTxnId };

      await ingestionService.ingest(webhook, { isSimulated: true });
      expect(await finalStatusOf(deposit.id)).toBe('SUCCESS');
      const actionsAfterFirst = await auditActionsFor(deposit.id);
      const completedCountAfterFirst = actionsAfterFirst.filter(
        (a) => a === AuditActions.DEPOSIT_COMPLETED,
      ).length;
      expect(completedCountAfterFirst).toBe(1);

      // Second delivery of the identical webhook.
      await ingestionService.ingest(webhook, { isSimulated: true });
      expect(await finalStatusOf(deposit.id)).toBe('SUCCESS');
      const actionsAfterSecond = await auditActionsFor(deposit.id);
      const completedCountAfterSecond = actionsAfterSecond.filter(
        (a) => a === AuditActions.DEPOSIT_COMPLETED,
      ).length;
      expect(completedCountAfterSecond).toBe(1); // unchanged — 2nd delivery was a no-op
    });

    it('out-of-order: Approved delivered before Created → final status still correct (Created is a no-op receipt)', async () => {
      const scenario: DepositScenario = {
        ...DEPOSIT_SCENARIOS.S1_HAPPY_FIAT,
        key: 'OUT_OF_ORDER_TEST',
        submit: { financeTxnId: `OOO-${Date.now()}` },
      };
      const amount = '70.00';

      const deposit = await createDepositAtCompliancePending(scenario, { isCrypto: false, amount });

      // Approved FIRST (out of the fixture's natural Created→Approved order).
      await ingestionService.ingest(
        { type: 'applicantKytTxnApproved', kytTxnId: scenario.submit.financeTxnId },
        { isSimulated: true },
      );
      expect(await finalStatusOf(deposit.id)).toBe('SUCCESS');

      // Created arrives late — DepositWebhookRouter logs a debug receipt and returns,
      // it must not touch deposit state.
      await ingestionService.ingest(
        { type: 'applicantKytTxnCreated', kytTxnId: scenario.submit.financeTxnId },
        { isSimulated: true },
      );
      expect(await finalStatusOf(deposit.id)).toBe('SUCCESS');

      const actions = await auditActionsFor(deposit.id);
      const completedCount = actions.filter((a) => a === AuditActions.DEPOSIT_COMPLETED).length;
      expect(completedCount).toBe(1);
    });
  });
});

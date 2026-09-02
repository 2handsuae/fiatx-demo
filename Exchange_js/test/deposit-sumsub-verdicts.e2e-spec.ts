import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash, randomUUID } from 'crypto';

// Must run BEFORE any import that reads DATABASE_URL. This suite's beforeAll
// deletes every deposit_transaction + wallet row and re-seeds a fixed set of
// fixtures — pointed at the worktree's shared stack DB (the one being used for
// live acceptance), that wipe destroys real in-flight data (2026-07-31: exactly
// this happened, twice — see doc-final/BACKLOG.md and .env's DATABASE_URL for
// the accepted-data DB this suite must never touch).
// 原先写死 /tmp/exchange_js_wt_deposit_arcs/ —— 那个 worktree 早删了，库停在删除
// 当天的 schema，本轮加 lifecycle 列后整支 suite 报「column does not exist」，
// 且报错指向一个不存在的目录。改成跟着当前 worktree 的栈目录走（见 e2e-db.ts）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-deposit-verdicts.db');

// 第二道保险：上面那行硬编码若将来被人删掉/改回读 .env，这里兜住。
// 只认库名含 "e2e-" 的专用库，其余一律拒跑并说清怎么办 —— 光靠"记得别跑"守不住，
// 2026-07-31 已两次实证（第二次是审查者出于完全正当的动机跑的）。
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[deposit-sumsub verdicts e2e] 拒绝运行：本 suite 会清空 deposit_transactions 并重建客户钱包，` +
      `但 DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。\n` +
      `专用库需先 prisma migrate deploy + 业务种子；库名必须含 "e2e-"。`,
  );
}

// 同样必须在任何 import 之前。本 suite 全程走 mock 的 Sumsub 交易客户端，不打真实
// api.sumsub.com；缺这个开关时 SumsubClient 会因为没有 APP_TOKEN/SECRET_KEY 抛错，
// travelRule 分型那条用例随之红。
//
// ⚠️ 不能靠 .env：worktree 的 .env 由 scripts/stack.sh 每次 up 重新生成，从不写
// SUMSUB_*（main 与各 worktree 均已核实为空）。所以这里与上面的 DATABASE_URL 一样
// 硬编码——测试自带的运行前提不该依赖一个会被工具重写的文件。
process.env.SUMSUB_MOCK_MODE = 'true';

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's
// internal load timing (belt-and-braces — ConfigModule.forRoot() in
// AppModule loads the same .env, this just guarantees the order). dotenv does
// NOT override an already-set process.env key, so the assignment above wins
// for DATABASE_URL while TB_ADDRESS still comes from .env (same running
// TigerBeetle instance as this worktree's self-stack).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏(2026-07-31 加,因为已经真的炸过两次)────────────────────────
// 双保险:即使有人改坏了上面的 env 赋值,也不允许在栈库上跑 deleteMany。
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `Refusing to run: this suite wipes deposit_transactions but DATABASE_URL is ${process.env.DATABASE_URL}. ` +
      `Point it at a dedicated e2e database (e.g. file:/tmp/exchange_js_wt_deposit_arcs/e2e-deposit-verdicts.db, ` +
      `after \`DATABASE_URL=... TB_ADDRESS=... npx prisma migrate deploy && npm run db:base:sync && npm run db:biz:init\`).`,
  );
}

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositStatusChangedEvent } from '../src/modules/trading/deposit-transactions/events/deposit-transaction.events';
import { DepositTransactionStatus, DepositTransactionAction } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { DepositDemoScenarioService } from '../src/modules/deposit-sumsub/demo-scenario.service';
import { MaterialRequestsService } from '../src/modules/identity/material-requests/material-requests.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { WithdrawalAddressService } from '../src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * Task 9: e2e 按 9 个单步裁决按钮(`fixtures/verdict-buttons.ts`)重写,取代已废弃的
 * 8 场景多步剧本(`fixtures/scenarios.ts`,已删,见 commit 1e06c6dc)。
 *
 * Harness 说明:
 * - 用 `Test.createTestingModule({ imports: [AppModule] })` 装真实 Nest app,只 override
 *   SUMSUB_TXN_CLIENT → MockSumsubTxnClient(submit/getTxn 走 mock,别的一律真实服务/真实 DB/
 *   真实 TigerBeetle)。
 * - **裁决投递复用生产代码路径**:每个用例调 `DepositDemoScenarioService.runVerdict()`——
 *   这正是 admin 仿真按钮点击时后端实际跑的方法(按钮 → controller → 这个 service),不是
 *   测试自己拼一遍 webhook。好处:报文形状(buildTxnReport)、txnId 铸造/复用、审计记录
 *   全部与生产行为同一份代码,e2e 验证的是"按钮语义对不对",不是"测试替身像不像"。
 * - 建单直接 Prisma 插入 COMPLIANCE_PENDING(不经 `detected()`/funds_order 级联——那条链是
 *   fire-and-forget emit,测试里会竞态),然后手动调用 `handleDepositStatusChanged()`
 *   驱动真实 Gate 0(compliance 状态检查 + submitSumsubTxns 提交 mock 交易)。
 * - below-min 用例直接在建单时落 `limitHoldReason: 'BELOW_MIN'`(生产里这是 `detected()`
 *   查限额规则后落的标 —— 这里跳过规则查询,直接给结果,与
 *   `DepositWorkflowService.holdIfHeld`(原 holdBelowMinIfNeeded) 的 JSDoc "判定依据是建单时落的
 *   limitHoldReason,不重查规则" 完全一致)。
 *
 * ⚠️ 破坏性护栏(务必读):本 suite 的 `beforeAll` 会 `depositTransaction.deleteMany({})`
 * 清空整张表并重建客户钱包 —— 见文件顶部的物理拦截。DATABASE_URL 必须指向专用 e2e 库,
 * 绝不能是 worktree 常驻栈正在验收的库。
 */
describe('Deposit Sumsub verdict buttons (e2e, Task 9)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: DepositWorkflowService;
  let depositService: DepositTransactionsService;
  let demoService: DepositDemoScenarioService;
  let materialRequests: MaterialRequestsService;
  let accounting: AccountingService;
  let approvalsService: ApprovalsService;
  let mockSumsubTxnClient: MockSumsubTxnClient;

  let customerId: string;
  let fiatAssetId: string;
  let fiatDecimals: number;
  let fiatWalletId: string;
  let cryptoAssetId: string;
  let cryptoWalletId: string;

  let depositNoSeq = 0;

  const HARNESS_ACTOR = { actorId: 'E2E_HARNESS', actorRole: 'OPS_OFFICER' };

  // 2026-08-31：原先调 workflow.adminFreeze()，该方法随 PATCH /deposit-transactions/:id/status
  // 路由退役（Task 4）—— 它唯一的调用方就是那条零消费方的 controller 分支。这里改直调
  // depositService.updateStatus()，与仍然活着的两条自动 FREEZE 路径（Gate 0 执法级限制、
  // KYT rejected）走同一个原语；本用例只关心「冻上之后客户端会话视图逐字不变」，
  // 不断言审计，故不复刻 adminFreeze 附带的那次 depositAudit。
  const freezeDeposit = (depositId: string, reason: string) =>
    depositService.updateStatus(
      depositId,
      { action: DepositTransactionAction.FREEZE, reason },
      {
        actor: {
          actorType: 'ADMIN',
          actorId: HARNESS_ACTOR.actorId,
          actorRole: HARNESS_ACTOR.actorRole,
        },
        sourcePlatform: 'ADMIN_API',
      },
    );
  // Maker-checker: ApprovalsService.approve() rejects same-user maker+checker, so
  // initiateConfiscation (maker) and approve (checker) must use distinct actors.
  const OPS_MAKER: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'E2E_OPS_MAKER',
    userNo: 'E2E_OPS_MAKER',
    role: 'OPS_OFFICER',
    roleCodes: ['OPS_OFFICER'],
  };
  // 2026-08-31：DEPOSIT_CONFISCATION 的单步裁决人由 OPS_OFFICER 改为 CFO
  // （没收 = 客户的钱变公司收入，属财务事项；原配置里提单人与裁决人同为运营，
  //  构成自批死锁）。maker 仍是运营 —— 发起没收是运营的动作，不变。
  const CFO_CHECKER: ApprovalActorContext = {
    actorType: 'ADMIN',
    userId: 'E2E_CFO_CHECKER',
    userNo: 'E2E_CFO_CHECKER',
    role: 'CFO',
    roleCodes: ['CFO'],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    // See Task 12's harness note (deposit-workflow.service.ts's history): the full
    // AppModule wires many @OnEvent handlers onto shared event names, past
    // EventEmitter2's default maxListeners=10 a possible-memory-leak warning would
    // throw under this Jest/Node combo. Raise the cap before app.init().
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(DepositWorkflowService);
    depositService = app.get(DepositTransactionsService);
    demoService = app.get(DepositDemoScenarioService);
    materialRequests = app.get(MaterialRequestsService);
    accounting = app.get(AccountingService);
    approvalsService = app.get(ApprovalsService);
    mockSumsubTxnClient = app.get(SUMSUB_TXN_CLIENT) as unknown as MockSumsubTxnClient;

    const customer = await prisma.customerMain.findUnique({
      where: { customerNo: 'CU2601019430' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer CU2601019430 (demo_alice) not found — the dedicated e2e DB needs " +
          'business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;
    await prisma.customerMain.update({
      where: { id: customerId },
      data: { sumsubApplicantId: '6b1c47f0a2d38e5904bb7215' },
    });

    // Clean slate — this DB is dedicated to this suite, so wiping prior deposit/wallet
    // rows before each run is safe and keeps the suite repeatable (mirrors Task 12's
    // harness; `findBySumsubTxnId()` does a global lookup with no per-run scoping).
    await prisma.depositTransaction.deleteMany({});
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
    // cross-checks walletRef's wallet.ownerNo against tb_account_registry's ownerNo.
    const fiatWallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customer.customerNo,
        type: 'FIAT_BANK', assetId: fiatAssetId, iban: 'AE_E2E_TEST_IBAN', status: 'ACTIVE',
      },
    });
    fiatWalletId = fiatWallet.id;

    const cryptoWallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customer.customerNo,
        type: 'CRYPTO_ADDRESS', assetId: cryptoAssetId, address: 'T_E2E_TEST_ADDRESS', status: 'ACTIVE',
      },
    });
    cryptoWalletId = cryptoWallet.id;

    // Trading-ready gate (2026-07-11 invariant): approve is held without an active
    // fiat withdrawal address on file. Seed one via the real service.
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
      traceId: 'task-9-e2e-withdrawal-address-seed',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /**
   * 2026-08-18 材料请求账迁移发现：`material_requests.externalActionId` 是
   * **全表** `@unique`（不按客户/单号分段），而 `verdict-buttons.ts` fixture 曾对
   * 同一按钮固定复用同一个字面量（`V2_AWAIT_USER`→`EXT-SOF-0001`、
   * `V5_AWAIT_USER_MULTI`→`EXT-MULTI-0001..3`）。本 suite 里"补料后通过"
   * （原有用例）与"补料完整弧"/"接口不可区分"三条独立用例都会触发
   * V2_AWAIT_USER，"多条 action"/"逐条不可区分" 都会触发 V5_AWAIT_USER_MULTI——
   * 旧的专属子表按 `(depositTransactionId, seq)` 去重，
   * 互不冲突；材料账的去重键是全表 `externalActionId`，第二条用例登记同一个
   * 字面量会在 DB 唯一约束上直接 P2002（且不会被重试，`material-requests
   * .service.ts` 的 `create()` 只重试 `requestNo` 撞号）。
   *
   * 终审 Important #4（2026-08-18 二次修订）：根因已在 fixture 层修掉——
   * `verdict-buttons.ts` 的 applicantActions 改成按调用现铸（getter +
   * randomUUID），不再有任何两次调用共享同一个 externalActionId，跨订单/跨
   * 用例也不会撞。这个 `beforeEach` 保留下来纯粹是测试卫生（每条用例开跑前
   * 清空上一条用例登记的材料请求行，避免 `listLiveByCustomer` 之类断言意外
   * 数到别的用例留下的行），不再是绕过 P2002 的必要条件。
   *
   * beforeAll 只在整个 suite 开跑前清一次 depositTransaction/wallet，不够——
   * 这里补一个 `beforeEach`。
   *
   * DEPOSIT 域不需要像 withdraw-sumsub-scenarios.e2e-spec.ts 那样额外处理
   * `customer_restrictions`：`PENDING_DOCUMENT` 因由的默认 scopes 是
   * `['WITHDRAW','SWAP']`（`restriction-cause.constant.ts`），不含 DEPOSIT——
   * 充值这边的 awaitUser 从不会连带摁住充值能力本身，`approveDeposit()` 也没有
   * withdraw 域那道"A4 客户级合规闸"，V1_APPROVED 可以直接放行，不需要额外
   * 补一步复核 GREEN。
   */
  beforeEach(async () => {
    await prisma.materialRequest.deleteMany({ where: { customerId } });
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Mirrors DepositWorkflowService.decimalToBigint (private) for the balance assertion. */
  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  /**
   * Creates a deposit directly at COMPLIANCE_PENDING and drives Gate 0
   * (submitSumsubTxns) for real, mirroring `detected()`'s COMPLIANCE_PENDING
   * entry without the funds_order/event cascade (fire-and-forget, races in tests).
   */
  async function createDeposit(opts: {
    isCrypto: boolean;
    amount: string;
    counterpartyIsVasp?: boolean;
    belowMin?: boolean;
  }): Promise<{ id: string; depositNo: string }> {
    depositNoSeq += 1;
    const assetId = opts.isCrypto ? cryptoAssetId : fiatAssetId;
    const toWalletId = opts.isCrypto ? cryptoWalletId : fiatWalletId;
    const depositNo = `DEPT9V${Date.now()}${depositNoSeq}`;
    // Sumsub-shaped 24-hex txnId (not a real submission — just what Gate 0's
    // submitSumsubTxns is primed to hand back for this deposit's clientTxnId).
    const submitTxnId = createHash('sha1').update(`gate0:${depositNo}`).digest('hex').slice(0, 24);

    const created = await prisma.depositTransaction.create({
      data: {
        depositNo,
        traceId: depositNo,
        correlationId: randomUUID(), // 审计主线根——INHERIT 闸要求主单必携（生产由 detected() 铸）
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        statusHistory: JSON.stringify([
          {
            status: DepositTransactionStatus.COMPLIANCE_PENDING,
            timestamp: new Date().toISOString(),
            operatorId: 'E2E_HARNESS',
            reason: 'Task 9 e2e fixture: created directly at COMPLIANCE_PENDING (see spec file header)',
          },
        ]),
        assetId,
        toWalletId,
        amount: new Prisma.Decimal(opts.amount),
        netAmount: new Prisma.Decimal(opts.amount),
        feeAmount: new Prisma.Decimal(0),
        // initiateReturn() requires a sender address/IBAN on file (RETURN_TO_SENDER
        // needs somewhere to send the funds back to) — every fixture needs one.
        fromIban: opts.isCrypto ? undefined : 'E2E_SENDER_IBAN',
        fromAddress: opts.isCrypto ? 'E2E_SENDER_ADDRESS' : undefined,
        counterpartyIsVasp: opts.isCrypto ? (opts.counterpartyIsVasp ?? null) : undefined,
        limitHoldReason: opts.belowMin ? 'BELOW_MIN' : undefined,
      },
    });

    mockSumsubTxnClient.primeSubmit(created.depositNo, submitTxnId);

    // Real Gate-0 entry point — the exact method 'deposit.status.changed' would invoke.
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

  /**
   * Delivers one verdict button through the REAL production entry point
   * (DepositDemoScenarioService.runVerdict) — same code the admin simulation
   * button calls. Builds the txn report off the deposit's actual sumsubTxnType,
   * primes the mock client, and drives the real ingest→router→handler→workflow chain.
   */
  async function deliver(depositId: string, buttonKey: string) {
    return demoService.runVerdict(depositId, buttonKey, HARNESS_ACTOR);
  }

  async function auditActionsFor(depositId: string): Promise<string[]> {
    const dep = await prisma.depositTransaction.findUnique({ where: { id: depositId }, select: { depositNo: true } });
    const rows = await prisma.auditLogEvent.findMany({
      where: { primarySubjectNo: dep!.depositNo, primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  async function statusOf(depositId: string): Promise<string | undefined> {
    const row = await prisma.depositTransaction.findUnique({ where: { id: depositId } });
    return row?.status;
  }

  /**
   * The approval-decided handlers (onConfiscationDecided/onReturnDecided/…) are wired
   * via `@OnEvent(name, { async: true })`. Under `eventemitter2`, that option defers
   * the listener body through `setImmediate` and does NOT hand its promise back to
   * `emitAsync()` — so `ApprovalsService.approve()` resolves before the confiscation
   * start (or any other decided-event side effect) has actually landed. This is a
   * genuine fire-and-forget gap in production too (same shape as the funds_order
   * cascade documented elsewhere in this file), so the e2e polls instead of asserting
   * immediately after `approve()`.
   */
  async function waitForStatus(
    depositId: string,
    expected: DepositTransactionStatus,
    timeoutMs = 3000,
  ): Promise<string | undefined> {
    const start = Date.now();
    let last: string | undefined;
    while (Date.now() - start < timeoutMs) {
      last = await statusOf(depositId);
      if (last === expected) return last;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return last;
  }

  // ── matrix ───────────────────────────────────────────────────────────────

  it('通过: ① → SUCCESS, STEP_2 posts DEPOSIT_SUSPENSE→CLIENT_PAYABLE (customer +amount)', async () => {
    const amount = '200.00';
    const before = await accounting.getCustomerAvailableBalance(customerId, 'AED');

    const deposit = await createDeposit({ isCrypto: false, amount });
    await deliver(deposit.id, 'V1_APPROVED');

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_SUMSUB_SUBMITTED);
    expect(actions).toContain('DEPOSIT_APPROVED');

    const after = await accounting.getCustomerAvailableBalance(customerId, 'AED');
    expect(after.total - before.total).toBe(decimalToBigint(amount, fiatDecimals));
  });

  it('小额挂起: ① (50 USDT, min=100 假定 belowMin) → OPERATION_PENDING + DEPOSIT_HELD·BELOW_MIN + 未记账', async () => {
    const deposit = await createDeposit({ isCrypto: true, amount: '50.000000', belowMin: true });
    await deliver(deposit.id, 'V1_APPROVED');

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.OPERATION_PENDING);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain('DEPOSIT_HELD');
    expect(actions).not.toContain('DEPOSIT_APPROVED');
  });

  it('小额放行: ① → waive → SUCCESS + limitHoldReason=null', async () => {
    const deposit = await createDeposit({ isCrypto: true, amount: '50.000000', belowMin: true });
    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.OPERATION_PENDING);

    await workflow.waiveLimitHold(deposit.id, HARNESS_ACTOR);

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
    const refreshed = await depositService.findOne(deposit.id);
    expect((refreshed as any).limitHoldReason).toBeNull();
  });

  it('小额没收: ① → confiscate (approved) → CONFISCATING', async () => {
    const deposit = await createDeposit({ isCrypto: true, amount: '50.000000', belowMin: true });
    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.OPERATION_PENDING);

    await workflow.initiateConfiscation(
      deposit.id,
      { reason: 'E2E: below-min T&C handling fee' },
      OPS_MAKER,
    );

    const approvalCase = await (prisma as any).approvalCase.findFirst({
      where: { actionType: 'DEPOSIT_CONFISCATION', entityRef: deposit.depositNo, status: 'PENDING' },
    });
    expect(approvalCase).toBeTruthy();

    await approvalsService.approve(approvalCase.approvalNo, { reason: 'E2E approve' }, CFO_CHECKER);

    // See waitForStatus's doc comment: onConfiscationDecided runs off a fire-and-forget
    // `{ async: true }` event listener, so the CONFISCATING flip lands slightly after
    // approve() resolves.
    expect(await waitForStatus(deposit.id, DepositTransactionStatus.CONFISCATING)).toBe(
      DepositTransactionStatus.CONFISCATING,
    );
  });

  it('补料后通过: ② → ① → ACTION_PENDING → SUCCESS; 中途 applicantActionIds 非空', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '150.00' });

    await deliver(deposit.id, 'V2_AWAIT_USER');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.ACTION_PENDING);

    const detail = await depositService.findOneForAdmin(deposit.id);
    expect((detail as any).sumsubDetail.applicantActionIds.length).toBeGreaterThan(0);

    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
  });

  it('PEP 补料: ③ → ACTION_PENDING + 报文含 PEP_APPLICANT tag', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '150.00' });

    await deliver(deposit.id, 'V3_AWAIT_USER_PEP_APPLICANT');

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.ACTION_PENDING);
    const detail = await depositService.findOneForAdmin(deposit.id);
    expect((detail as any).sumsubDetail.tags).toContain('PEP_APPLICANT');
  });

  it('制裁: ⑧ → FROZEN + 零记账', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '200.00' });

    await deliver(deposit.id, 'V8_REJECTED_SANCTION_COUNTERPARTY');

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.FROZEN);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain(AuditActions.DEPOSIT_FROZEN);
    expect(actions).not.toContain('DEPOSIT_APPROVED');
  });

  it('MLRO 冻结: ⑪ → ⑨ → MANUAL_CHECKING → FROZEN', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '300.00' });

    await deliver(deposit.id, 'V11_REJECTED_NO_TAG');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.MANUAL_CHECKING);

    await deliver(deposit.id, 'V9_REJECTED_MLRO_FREEZE');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.FROZEN);
  });

  it('MLRO 退回: ⑪ → ⑩ → 开 DEPOSIT_RETURN 审批, 留 MANUAL_CHECKING', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '250.00' });

    await deliver(deposit.id, 'V11_REJECTED_NO_TAG');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.MANUAL_CHECKING);

    await deliver(deposit.id, 'V10_REJECTED_DISPOSITION');

    // A2: RETURN_TO_SENDER opens a maker-checker approval instead of a direct
    // status transition — deposit stays MANUAL_CHECKING.
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.MANUAL_CHECKING);
    const actions = await auditActionsFor(deposit.id);
    expect(actions).toContain('DEPOSIT_RETURN_REQUESTED');

    const returnApproval = await (prisma as any).approvalCase.findFirst({
      where: { actionType: 'DEPOSIT_RETURN', entityRef: deposit.depositNo },
    });
    expect(returnApproval).toBeTruthy();
    expect(returnApproval?.status).toBe('PENDING');
  });

  it('挂起有证据: ⑥ → 状态不变(COMPLIANCE_PENDING) + sumsubScore=55 + 报文非空', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '80.00' });

    await deliver(deposit.id, 'V6_ONHOLD');

    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
    const refreshed = await depositService.findOne(deposit.id);
    expect((refreshed as any).sumsubScore).toBe(55);
    expect((refreshed as any).sumsubTxnDetailJson).toBeTruthy();
  });

  it('travelRule 分型: VASP + 3000 USDT 单投 ① → 报文 data.type===travelRule 且 travelRuleInfo 存在', async () => {
    const deposit = await createDeposit({ isCrypto: true, amount: '3000.000000', counterpartyIsVasp: true });

    await deliver(deposit.id, 'V1_APPROVED');

    const refreshed = await depositService.findOne(deposit.id);
    expect((refreshed as any).sumsubTxnType).toBe('travelRule');

    const detail = await depositService.findOneForAdmin(deposit.id);
    const raw = (detail as any).sumsubDetail.raw;
    expect(raw.data.type).toBe('travelRule');
    expect(raw.travelRuleInfo).toBeTruthy();
  });

  it('finance 分型: 非 VASP 3000 USDT 单投 ① → 报文 data.type===finance 且 travelRuleInfo 不存在', async () => {
    const deposit = await createDeposit({ isCrypto: true, amount: '3000.000000', counterpartyIsVasp: false });

    await deliver(deposit.id, 'V1_APPROVED');

    const refreshed = await depositService.findOne(deposit.id);
    expect((refreshed as any).sumsubTxnType).toBe('finance');

    const detail = await depositService.findOneForAdmin(deposit.id);
    const raw = (detail as any).sumsubDetail.raw;
    expect(raw.data.type).toBe('finance');
    expect(raw.travelRuleInfo).toBeUndefined();
  });

  it('幂等: ① ① → 只流转一次, 第二次 no-op', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '90.00' });

    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
    const actionsAfterFirst = await auditActionsFor(deposit.id);
    const completedAfterFirst = actionsAfterFirst.filter((a) => a === 'DEPOSIT_APPROVED').length;
    expect(completedAfterFirst).toBe(1);

    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
    const actionsAfterSecond = await auditActionsFor(deposit.id);
    const completedAfterSecond = actionsAfterSecond.filter((a) => a === 'DEPOSIT_APPROVED').length;
    expect(completedAfterSecond).toBe(1); // unchanged — 2nd delivery was a no-op
  });

  // ── Task 7 → 2026-08-18 材料请求账迁移：补料 embed 弧 + 接口层不可区分 ──
  //
  // 这套 e2e 没有 supertest/HTTP 层（全文件同款：直接调 service，与生产
  // controller 路由等价的最小切片）。原先直接调 `DepositVerificationSessionService`
  // （按 (customerId, depositNo, seq) 定位）——该服务已被 Task 8 掏空（职责并入
  // 材料请求账，见 deposit-verification-session.service.ts 文件头注释），本节改
  // 直接调 `MaterialRequestsService`（按 `requestNo` 定位，与
  // `material-requests.client.controller.ts` 的 `getSession`/`submit` 端点背后
  // 同一对方法：`mintSessionToken`/`markSubmitted`），下面两个 helper 原样复刻
  // 控制器的响应体映射，保持断言可读性。
  // （2026-08-31 更新：原文这里说「DepositWorkflowService.adminFreeze() 不受影响」——
  //  该方法与它背后的 `PATCH :id/status` 路由已随 Task 4 一并退役，本文件改用
  //  上方的 freezeDeposit() helper 直调 updateStatus。）

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

  it('补料完整弧：awaitUser → 取会话 → 提交 → 状态未动 → 操作员放行 → SUCCESS', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '120.00' });

    await deliver(deposit.id, 'V2_AWAIT_USER');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.ACTION_PENDING);

    const live = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    expect(live).toHaveLength(1);
    const requestNo = live[0].requestNo;

    const session1 = await getSessionView(requestNo);
    expect(session1.submitted).toBe(false);
    expect(session1.sdkToken).toBeTruthy();

    expect(await submitMaterial(requestNo)).toBe(true);

    const after = (await depositService.findOne(deposit.id)) as any;
    expect(after.status).toBe(DepositTransactionStatus.ACTION_PENDING); // 状态没动
    // 2026-08-18 迁移注记：旧断言在这里查 depositTransaction.actionSubmittedAt
    // truthy —— 子表时代 submitBySeq 在"全部交齐"时顺带写的缓存戳。Task 8 把
    // 提交入口挪到 MaterialRequestsService.markSubmitted 之后，这条写入路径没有
    // 对应物被接上：全仓 grep 只有 clearDepositCache 写 actionSubmittedAt，且只
    // 写 null，没有任何代码再把它置为非 null（真实回归，已登记 BACKLOG）。
    // 等价的业务事实改读材料账自己的状态：这一行已经从 PENDING_SUBMISSION 变成
    // SUBMITTED，即"客户已不再欠这份材料"——这才是下游（Sumsub 复核）真正关心
    // 的信号，比一个已经没有写入方的缓存字段更贴近事实。
    const row = await materialRequests.findByNo(requestNo);
    expect(row?.status).toBe('SUBMITTED');
    // slaDeadline 仍新鲜：建 action 时（V2_AWAIT_USER 投递时）设的 7 天窗口，
    // 测试在毫秒级时间内跑完，未被打破——不是"提交时重置"证明的，只是还没到期。
    expect(new Date(after.slaDeadline).getTime())
      .toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
  });

  it('接口不可区分：已提交的单，ACTION_PENDING 与 FROZEN 的会话响应体全等', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '130.00' });

    await deliver(deposit.id, 'V2_AWAIT_USER');
    const live = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    expect(live).toHaveLength(1);
    const requestNo = live[0].requestNo;
    await submitMaterial(requestNo);

    const before = await getSessionView(requestNo);

    await freezeDeposit(deposit.id, 'E2E: tipping-off equality check');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.FROZEN);

    const after = await getSessionView(requestNo);
    expect(after).toEqual(before);
  });

  // ── Task 7 → 2026-08-18 迁移：多条 action（材料账取代子表 + "全部交齐" 缓存）

  it('多条 action：交完前两条仍 ACTION REQUIRED，交完第三条才算全部交齐', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '170.00' });

    await deliver(deposit.id, 'V5_AWAIT_USER_MULTI');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.ACTION_PENDING);

    // 2026-08-18 迁移注记：旧断言读 findOneForCustomerByDepositNo(...).actions
    // （子表关系 `applicantActions`，`{seq, submittedAt}`）。Task 8 之后该子表
    // 零写入（DepositApplicantActionsService 内脏已换材料账），这个关系恒空
    // 数组——不是本次要修的范围（deposit-transactions.service.ts 未改动），但
    // 断言必须换成真实数据源：材料账按 externalActionId 定位同一批 action。
    //
    // 终审 Important #4（2026-08-18 二次修订）：V5_AWAIT_USER_MULTI fixture
    // 的三个 externalActionId 此前是固定字面量 EXT-MULTI-000{1,2,3}，会在两笔
    // 不同订单先后点这个按钮时撞材料请求账的全表 @unique 约束（P2002）。已改成
    // 按调用现铸（见 src/modules/deposit-sumsub/fixtures/verdict-buttons.ts），
    // 断言相应从"是这三个字面量"改成"有三条互不相同的活行"，用真实返回值
    // 定位而不是硬编码字面量。
    const live = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    expect(live).toHaveLength(3);
    expect(new Set(live.map((r) => r.externalActionId)).size).toBe(3);
    expect(live.every((r) => r.status === 'PENDING_SUBMISSION')).toBe(true); // 一条都还没交

    const [first, second, third] = live.map((r) => r.requestNo);

    await submitMaterial(first);
    await submitMaterial(second);
    const midway = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    expect(midway.filter((r) => r.status === 'PENDING_SUBMISSION')).toHaveLength(1); // 还没交齐
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.ACTION_PENDING);

    await submitMaterial(third);
    const final = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    expect(final.every((r) => r.status === 'SUBMITTED')).toBe(true); // 三条逐条都已提交
    expect(final.filter((r) => r.status === 'PENDING_SUBMISSION')).toHaveLength(0); // 全部交齐

    await deliver(deposit.id, 'V1_APPROVED');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.SUCCESS);
  });

  it('逐条不可区分：同一条 action 在 ACTION_PENDING 与 FROZEN 下会话响应体全等', async () => {
    const deposit = await createDeposit({ isCrypto: false, amount: '175.00' });

    await deliver(deposit.id, 'V5_AWAIT_USER_MULTI');
    const live = await materialRequests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    // 终审 Important #4：externalActionId 现铸不再是固定字面量，任取一条即可——
    // 这条用例只关心"同一条 action 前后两次会话响应体相等"，不关心是哪一条。
    const requestNo = live[0].requestNo;
    await submitMaterial(requestNo);

    const before = await getSessionView(requestNo);

    await freezeDeposit(deposit.id, 'E2E: multi-action tipping-off equality check');
    expect(await statusOf(deposit.id)).toBe(DepositTransactionStatus.FROZEN);

    const after = await getSessionView(requestNo);
    expect(after).toEqual(before);
  });
});

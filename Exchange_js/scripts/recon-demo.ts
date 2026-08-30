// scripts/recon-demo.ts
//
// Phase B / T8: anchor-free per-wallet reconciliation demo. Replaces the
// V8 five-formula generator with a 1:1 mirror engine built on top of
// `WalletReconRunService` (T7), `WalletBalanceCheckerService` (T6) and the
// `account_flows` projection (T3).
//
//   --mode=pass    External statement EXACTLY mirrors every wallet's
//                  isExternalCrossing flows (same amount/direction/ref) +
//                  external closing balance == internal balance.
//                  Expected: status=PASS, casesOpened=0, orphan/mismatch=0.
//
//   --mode=break   Pass-mode setup, then inject 15 scenarios covering the
//                  root-cause matrix (see specs/2026-08-30-recon-break-
//                  scenarios-design.md §3) and write `manifest.json`.
//                  成因按「谁错了」分三真相：
//                    金额不对   ④我方小数点错 ⑩对方记错 ⑪舍入精度
//                    我有外无   ⑦我方重复入账 ⑧假信号 ③银行漏报 ⑫跨日切
//                    外有我无   ⑤漏监听充值 ⑨对账单重复行 ⑥退汇
//                    在途       ①在途时序差
//                    公司补记   ⑭银行杂费 ⑮银行利息
//                    跨钱包     ⑬记错钱包
//                    净额口径   ②手续费轧差
//
//                  ⚠️ **旧的 disjoint-wallet 前提已于 2026-08-30 显式废除。**
//                  一个钱包现在可以挂多条场景（三个展示位就是靠这个：同一个
//                  形状三条差异、三种相反处置摆在一屏）。因此**桶是钱包的属性、
//                  不是场景的属性**，答案键拆两级——场景断言差异行，钱包断言桶。
//
//   --mode=reset   Delete WALLET_V1 runs/cases + all ExternalBalance /
//                  ExternalStatementLine rows + demo-tagged FundsOrder rows.
//                  Demo:all business data is left untouched.
//
// Anchor-free: every walletRef / asset / amount comes from the *current*
// account_flows snapshot. The script will work on any seeded dataset; the
// only requirement is ≥1 FIRM wallet + enough CUSTOMER wallets with
// isExternalCrossing flows to host the injected scenarios (一个钱包可以挂多条，
// 具体分配见 Task 4 起改用的按人设显式指定)。
//
// Run:
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=pass
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=break
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=reset

// Node 18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module
// load. Must precede every other import.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { fakeChainTxHash, fakeBankRef } from '../src/common/utils/fake-external-refs.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { WalletBalanceCheckerService } from '../src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { TERMINAL_STATUSES } from '../src/modules/funds-orders/constants/funds-order-transitions.constant';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
// Scenario 1 去合成壳（canon2 T5）：复用 demo:in-transit 同一个共享夹具造真卡提现，
// 金闸门的「在途检测」从此跑在真非终态资金单 + 分外部行上，与 demo:in-transit 同源。
import { createStuckWithdraw, DEMO_STUCK_WD_REF_PREFIX } from './demo-fixtures';
import { resolveDemoCustomers } from './demo-lib';

type Mode = 'pass' | 'break' | 'reset';

// Minimal ctx for the shared stuck-withdraw fixture (scenario 1). The fixture
// (`createStuckWithdraw` / `injectStuckExternalMirror`) is duck-typed on `any`
// but really needs exactly these handles — the same set demo-lib's DemoCtx
// exposes. Built from the recon-demo app so scenario 1 drives a REAL withdraw
// through the workflow (no synthetic funds_orders.create shell).
interface StuckFixtureCtx {
  app: import('@nestjs/common').INestApplicationContext;
  prisma: PrismaService;
  fundsOrders: FundsOrderService;
  withdrawQuote: WithdrawQuoteService;
  withdraws: WithdrawTransactionsService;
  withdrawWf: WithdrawWorkflowService;
}

const D = (n: any) => new Prisma.Decimal(n);

const MANIFEST_PATH = process.env.RECON_DEMO_MANIFEST_PATH
  ?? '/tmp/exchange_js_main/recon-demo-manifest.json';

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): { mode: Mode; cutoffIso: string | null } {
  let mode: Mode = 'pass';
  let cutoffIso: string | null = null;
  for (const a of argv) {
    const m = a.match(/^--mode=(pass|break|reset)$/);
    if (m) mode = m[1] as Mode;
    else if (a.startsWith('--mode=')) console.warn(`unknown --mode "${a}" — defaulting to "pass"`);
    const c = a.match(/^--cutoff=(.+)$/);
    if (c) cutoffIso = c[1];
  }
  return { mode, cutoffIso };
}

// 15-scenario model（2026-08-30 重做）：每个场景重现一个**成因**，成因按
// 「谁错了」分三真相（我方错 / 对方错 / 都没错）——见
// specs/2026-08-30-recon-break-scenarios-design.md §3。
//
// ⚠️ **本轮显式废除了旧的 disjoint-wallet 前提**（旧文件头写着"Each scenario
// targets its own wallet … so cases stay disjoint"）。一个钱包现在可以挂多条
// 场景——现实本来如此，而且"同一个形状三条差异、三种相反处置摆在一屏"是整套
// 演示最值钱的一屏。代价是：**桶是钱包的属性，不再是场景的属性**，故答案键
// 拆成两级。
type RootCause =
  | 'IN_TRANSIT_TIMING'
  | 'FEE_NETTED'
  | 'STATEMENT_MISSING_LINE'
  | 'SCALE_ERROR'
  | 'BANK_CHARGE'
  | 'MISSED_DEPOSIT'
  | 'BANK_INTEREST'
  | 'BANK_RETURN'
  | 'DUPLICATE_DEPOSIT'
  | 'VOIDED_SIGNAL'
  | 'STATEMENT_DUPLICATE_LINE'
  | 'COUNTERPARTY_AMOUNT_ERROR'
  | 'ROUNDING_DIFF'
  | 'CUTOFF_STRADDLE'
  | 'MISROUTED_CREDIT';

type LineType = 'IN_TRANSIT' | 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
type Bucket = 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

/** 每个场景断言：我造出了哪些差异行。 */
interface ScenarioExpectation {
  scenarioId: number;
  rootCause: RootCause;
  /** 绝大多数场景只产生一条；MISROUTED_CREDIT（记错钱包）跨两个钱包，故是数组。 */
  expectedLines: Array<{
    walletRef: string;
    lineType: LineType;
    amount: string;
    externalRef: string | null;
  }>;
  fundsOrderNo?: string;        // IN_TRANSIT_TIMING only
  detail: Record<string, unknown>;
}

/** 每个被注入的钱包断言：它最终落在哪个桶。 */
interface WalletExpectation {
  walletRef: string;
  scenarioIds: number[];
  expectedBucket: Bucket;
  /**
   * 桶是怎么推出来的，供审的人核。**多场景钱包必填且必须写清算式** ——
   * 这个值是人手算的，算错了答案键就是错的，而答案键错的表现是
   * "测试绿着但证明了错的东西"。单场景钱包写一句话即可。
   */
  bucketRationale: string;
  /**
   * 这个钱包上有没有 demo:all 留下的非终态资金单。只有在途场景那个钱包
   * 允许为 true——见 Task 3 的前置闸。
   */
  hasNonTerminalFundsOrder: boolean;
}

interface ManifestV3 {
  cutoff: string;
  scenarios: ScenarioExpectation[];
  wallets: WalletExpectation[];
}

// ── Helpers ─────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Route a wallet's external feed to ZAND (fiat) or HEXTRUST (custody) by
 * looking at the asset code prefix. The wallet recon engine doesn't
 * actually consume `source` for matching — both `subAccount==walletRef`
 * and the `account_ref` fall-through ignore it — but we still pick a
 * source so the rows look plausible to operators eyeballing the table.
 */
function sourceFor(assetCode: string): 'HEXTRUST' | 'ZAND' {
  // AED / USD / EUR → bank statement (ZAND); USDT-* / BTC → custody
  // (HEXTRUST). Bias toward HEXTRUST for any non-fiat code.
  return /^(USDT|BTC|ETH|USDC)/i.test(assetCode) ? 'HEXTRUST' : 'ZAND';
}

// Legacy scenario-1 shell tag. Since canon2 T5, scenario 1 drives a REAL stuck
// withdraw (via createStuckWithdraw) instead of a synthetic FundsOrder, so no
// new DEMO-IT- rows are created — this prefix now only cleans rows left by the
// pre-T5 shell. (The real stuck withdraw's funds_order + withdraw txn ARE
// cleaned on reset via clearStuckFixtureWithdraws → reset && break is idempotent.)
const DEMO_IN_TRANSIT_REF_PREFIX = 'DEMO-IT-';

/**
 * Delete the demo-fixture stuck WITHDRAWS scenario 1 leaves behind, so
 * `recon:demo:reset && recon:demo:break` is idempotent (no accumulation of
 * non-terminal payout legs → no Pass3 mis-claim → stable 9/9).
 *
 * Identification (union of two demo-only signals, run BEFORE the external-line
 * blanket-delete so the tag path still has rows to read):
 *   (a) tag reverse-lookup — the fixture writes external_ref =
 *       `${DEMO_STUCK_WD_REF_PREFIX}${withdrawNo}`; strip the prefix to recover
 *       the withdrawNo of the *current* cycle's stuck withdraw.
 *   (b) non-terminal-leg — any withdraw_transaction carrying a non-terminal
 *       funds_order leg. This catches ORPHANS whose external line was already
 *       deleted by a prior reset / demo:in-transit cleanup (the tag path alone
 *       misses these — exactly the pre-existing dirty state). In a demo DB this
 *       is unambiguous: demo:all drives every withdraw to SUCCESS, so the only
 *       non-terminal withdraws are fixture stuck ones.
 *
 * Deleting the withdraw_transaction CASCADE-removes its funds_order legs
 * (funds_orders.withdrawTransactionId FK is ON DELETE CASCADE). Stuck payout
 * legs are non-terminal → never POSTED → leave no account_flows / TB, so this
 * is a clean delete (no ledger reversal needed).
 *
 * Scope: WITHDRAWS only. Stuck SWAPS (demo:in-transit only — recon:demo never
 * creates them) have legs 1/2 already CLEARED (real TB postings + account_flows),
 * so a correct teardown must reverse TB too → that belongs to a full
 * db:reset:business, not this scoped demo reset. They don't affect recon:demo's
 * 9/9 (leg3 has no external line post-reset, so Pass3 can't claim it).
 */
async function clearStuckFixtureWithdraws(prisma: PrismaService): Promise<number> {
  const TERMINAL = ['CLEARED', 'FAILED', 'TIMEOUT'];
  // (a) tag reverse-lookup — current cycle.
  const stuckLines = (await (prisma as any).externalStatementLine.findMany({
    where: { externalRef: { startsWith: DEMO_STUCK_WD_REF_PREFIX } },
    select: { externalRef: true },
  })) as Array<{ externalRef: string | null }>;
  const taggedWithdrawNos = Array.from(
    new Set(
      stuckLines
        .map((l) => l.externalRef?.slice(DEMO_STUCK_WD_REF_PREFIX.length))
        .filter((n): n is string => !!n),
    ),
  );
  // (b) non-terminal-leg — orphans + current cycle.
  const withdrawIdsFromLegs = (await (prisma as any).fundsOrder.findMany({
    where: { withdrawTransactionId: { not: null }, status: { notIn: TERMINAL } },
    select: { withdrawTransactionId: true },
    distinct: ['withdrawTransactionId'],
  })) as Array<{ withdrawTransactionId: string | null }>;
  const legWithdrawIds = withdrawIdsFromLegs
    .map((r) => r.withdrawTransactionId)
    .filter((id): id is string => !!id);

  if (taggedWithdrawNos.length === 0 && legWithdrawIds.length === 0) return 0;
  const { count } = await (prisma as any).withdrawTransaction.deleteMany({
    where: {
      OR: [
        { withdrawNo: { in: taggedWithdrawNos } },
        { id: { in: legWithdrawIds } },
      ],
    },
  });
  return count; // funds_order legs CASCADE-deleted with the parent withdraw.
}

async function clearWalletDemo(prisma: PrismaService): Promise<{
  runs: number; cases: number; lineItems: number; balances: number; lines: number; fundsOrders: number;
}> {
  // Wipe all wallet-engine footprint (runs/cases/line_items + all external
  // statement rows). Demo:all business data is not touched.
  const runs = (await (prisma as any).reconciliationRun.findMany({
    select: { id: true },
  })) as Array<{ id: string }>;
  const runIds = runs.map((r) => r.id);
  let deletedLineItems = 0;
  let deletedCases = 0;
  if (runIds.length) {
    deletedLineItems = (await (prisma as any).reconciliationLineItem.deleteMany({
      where: { foundByRunId: { in: runIds } },
    })).count;
    deletedCases = (await (prisma as any).reconciliationCase.deleteMany({
      where: { OR: [{ openedByRunId: { in: runIds } }, { lastObservedRunId: { in: runIds } }] },
    })).count;
  }
  const deletedRuns = runIds.length
    ? (await (prisma as any).reconciliationRun.deleteMany({ where: { id: { in: runIds } } })).count
    : 0;
  // Delete the fixture stuck withdraws (+ CASCADE their non-terminal legs)
  // BEFORE the external-line blanket-delete, so the tag reverse-lookup still
  // has its DEMO-STUCK-WD- external rows to read. This is what keeps
  // reset && break idempotent (no leg accumulation → stable 9/9).
  const deletedStuck = await clearStuckFixtureWithdraws(prisma);
  // externalStatementLine/externalBalance blanket-deletes already cover
  // scenario 9's orphan head (accountRef=DEMO-ORPHAN-ADDR) — no separate
  // filter needed, both tables are demo-only footprint.
  const deletedLines = (await (prisma as any).externalStatementLine.deleteMany({})).count;
  const deletedBalances = (await (prisma as any).externalBalance.deleteMany({})).count;
  // Legacy pre-T5 scenario-1 shell cleanup: delete any DEMO-IT--tagged funds
  // orders left by the pre-T5 synthetic shell (never a real business funds
  // order). Post-T5 scenario 1's real stuck withdraw is cleaned above via
  // clearStuckFixtureWithdraws.
  const deletedShellFundsOrders = (await (prisma as any).fundsOrder.deleteMany({
    where: { referenceNo: { startsWith: DEMO_IN_TRANSIT_REF_PREFIX } },
  })).count;
  return {
    runs: deletedRuns, cases: deletedCases, lineItems: deletedLineItems,
    balances: deletedBalances, lines: deletedLines,
    fundsOrders: deletedShellFundsOrders + deletedStuck,
  };
}

// ── Phase 1: walk account_flows, build per-wallet mirror data ───────────
//
// For each wallet that has crossing flows, derive:
//   - balance via the same engine the recon uses (so PASS is guaranteed)
//   - crossing rows = the external lines we will write
//   - book ('CUSTOMER' | 'FIRM') from the WalletBalanceCheckerService
interface WalletPlan {
  walletRef: string;
  walletKind: 'CUSTOMER' | 'FIRM';
  book: 'CLIENT' | 'FIRM';
  currency: string;
  internalTotal: bigint;
  coaCode: string;
  ownerNo: string | null;
  // Mirrored statement lines for this wallet (one per crossing flow).
  lines: Array<{
    direction: 'IN' | 'OUT';
    amount: Prisma.Decimal;
    externalRef: string | null;
    datetime: Date;
    // We carry the flow id only so break mode can match injections back to
    // a real internal source if needed.
    sourceFlowId: string;
  }>;
}

async function planWallets(
  prisma: PrismaService,
  balanceChecker: WalletBalanceCheckerService,
  _tbEvidence: TbEvidenceService,
  cutoff: Date,
): Promise<WalletPlan[]> {
  // Single source of truth so external and internal can NEVER drift:
  //   closingBalance     ← balanceChecker.internal.total = TB net for this wallet
  //   statement_lines    ← every POSTED account_flow row landing on this wallet
  //                        AND on one of the wallet's "owned" TB account codes
  //                        (CUSTOMER → CLIENT_PAYABLE/DEPOSIT_SUSPENSE;
  //                         FIRM     → FIRM_OPS/SET/INCOME_SWAP_FEE/
  //                         INCOME_WITHDRAW_FEE/INCOME_OTHER, plus retired
  //                         202/203 kept so pre-COA-v2 history still mirrors).
  //                        Aggregate codes (CLIENT_ASSET=1 / FIRM_ASSET=50)
  //                        are filtered out — matches WalletBalanceChecker.
  //
  // Direction semantic (verified empirically against Alice's CU2601019430
  // CLIENT_PAYABLE postings — image-1 evidence):
  //   account_flows.direction='IN'  ⇒ external statement IN  (balance UP)
  //   account_flows.direction='OUT' ⇒ external statement OUT (balance DOWN)
  // The TB accounts in scope (CLIENT_PAYABLE/SUSPENSE = LIABILITY,
  // FIRM_OPS/SET/INCOME_*/retired-202/203 = EQUITY) are ALL credit-normal
  // right-side-of-BS accounts → same single rule for both books, no
  // role/event override.
  //
  // The isExternalCrossing filter is INTENTIONALLY NOT applied:
  //   Internal-only postings (e.g. DEPOSIT_SUSPENSE_TO_PAYABLE) are part of
  //   the wallet's TB net balance. Filtering them out makes
  //   Σ(IN − OUT) ≠ TB net. Empirical check on Alice's payable:
  //     with-filter   net = −1050  (wrong)
  //     no-filter     net = +1950  (matches TB net = image-1 closing)
  //
  // Result: closing = opening(0) + Σ(IN − OUT) = TB net, by construction,
  // for every wallet.
  // COA v2 (2026-08-13): 收入段 210/211/212;202/203/204 已废弃且无兼容层(demo 随时 reset)。
  const FIRM_CODES = new Set<number>([200, 201, 210, 211, 212]);
  const CUSTOMER_CODES = new Set<number>([100, 101]);
  const allActiveWallets = (await (prisma as any).wallet.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      walletRole: true,
      ownerType: true,
      ownerNo: true,
      asset: { select: { code: true, currency: true } },
    },
  })) as Array<{
    id: string;
    walletRole: string;
    ownerType: string;
    ownerNo: string | null;
    asset: { code: string; currency: string } | null;
  }>;

  const plans: WalletPlan[] = [];
  for (const w of allActiveWallets) {
    const currency = w.asset?.code ?? w.asset?.currency ?? null;
    if (!currency) continue;
    const isFirm = w.ownerType !== 'CUSTOMER';
    const ownedCodes = isFirm ? FIRM_CODES : CUSTOMER_CODES;

    // Step 1 — pull every POSTED *crossing* account_flow on this walletRef up
    // to cutoff. isExternalCrossing=true is the demarcation between what an
    // external system (Zand for fiat / HexTrust for crypto) actually observes
    // vs internal book-to-book movements (e.g. DEPOSIT_SUSPENSE_TO_PAYABLE)
    // that the bank/custodian never sees. Including the latter would put
    // phantom rows on the customer's external statement.
    const rawFlows = (await (prisma as any).accountFlow.findMany({
      where: {
        walletRef: w.id,
        transferType: 'POSTED',
        isExternalCrossing: true,
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        tbAccountId: true,
        direction: true,
        amount: true,
        externalRef: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as Array<{
      id: string;
      tbAccountId: string;
      direction: string;
      amount: Prisma.Decimal;
      externalRef: string | null;
      createdAt: Date;
    }>;

    // Step 2 — resolve tbAccountId → code, drop aggregate legs (code 1/50)
    // and keep only rows posting to the wallet's "owned" TB accounts.
    //
    // tb_account_registry stores tbAccountId in 32-char padded form
    // ('0886e84...'), but account_flows.tbAccountId can be either 32-char
    // padded or 31-char unpadded ('886e84...') depending on the writer.
    // Pad both sides to 32 chars before joining so F_SET / F_FEE / etc.
    // flows don't silently drop on a string mismatch.
    const padTbId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);
    const tbAccountIds = Array.from(
      new Set(rawFlows.map((f) => padTbId(f.tbAccountId))),
    );
    const regs = tbAccountIds.length
      ? (await (prisma as any).tbAccountRegistry.findMany({
          where: { tbAccountId: { in: tbAccountIds } },
          select: { tbAccountId: true, code: true },
        })) as Array<{ tbAccountId: string; code: number }>
      : [];
    const codeById = new Map<string, number>(
      regs.map((r) => [padTbId(r.tbAccountId), r.code]),
    );

    const flows = rawFlows.filter((f) => {
      const code = codeById.get(padTbId(f.tbAccountId));
      return code !== undefined && ownedCodes.has(code);
    });

    // Step 3 — balance from the engine's own check. closingBalance below
    // will equal bal.internal.total ⇒ drift is structurally 0.
    const bal = await balanceChecker.checkBalance({
      walletRef: w.id,
      externalClosing: 0n,
      cutoff,
    });

    plans.push({
      walletRef: w.id,
      walletKind: isFirm ? 'FIRM' : 'CUSTOMER',
      book: isFirm ? 'FIRM' : 'CLIENT',
      currency,
      internalTotal: bal.internal.total,
      coaCode: bal.coaCode,
      ownerNo: bal.ownerNo ?? w.ownerNo,
      lines: flows.map((f) => ({
        direction: f.direction as 'IN' | 'OUT',
        amount: f.amount,
        externalRef: f.externalRef,
        // Use the real posting time — no random shift. Operators expect the
        // external statement timestamp to match the internal ledger event.
        datetime: f.createdAt,
        sourceFlowId: f.id,
      })),
    });
  }

  return plans;
}

// ── Phase 2: write external balances + statement lines per the plan ─────
async function writeMirror(
  prisma: PrismaService,
  plans: WalletPlan[],
  cutoff: Date,
): Promise<{ balances: number; lines: number }> {
  const cutoffDate = ymd(cutoff);
  let balances = 0;
  let lines = 0;
  for (const p of plans) {
    // External balance = the wallet's TB net balance (bal.internal.total).
    // Because each line is a 1:1 projection of a credit/debit posting on the
    // wallet's owned TB accounts (planWallets step 2), and direction is taken
    // raw from account_flows.direction, opening(0) + Σ(IN − OUT) = TB net by
    // construction. The accountRef key is a stable derived key (so the upsert
    // composite unique constraint behaves); we use the walletRef itself.
    const accountRef = p.walletRef;
    const source = sourceFor(p.currency);
    const closingBalance = D(p.internalTotal.toString());
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source, accountRef, cutoffDate } },
      update: {
        currency: p.currency,
        book: p.book,
        closingBalance,
        openingBalance: D(0),
        asOfAt: cutoff,
        status: 'INGESTED',
        walletRef: p.walletRef,
        coaCode: p.coaCode,
        ownerNo: p.ownerNo,
        lineCount: p.lines.length,
      },
      create: {
        source,
        accountRef,
        currency: p.currency,
        book: p.book,
        cutoffDate,
        closingBalance,
        openingBalance: D(0),
        asOfAt: cutoff,
        status: 'INGESTED',
        walletRef: p.walletRef,
        coaCode: p.coaCode,
        ownerNo: p.ownerNo,
        lineCount: p.lines.length,
      },
    });
    balances += 1;

    // Statement lines — one per crossing flow.
    let seq = 0;
    for (const l of p.lines) {
      seq += 1;
      // Stable dedupKey so re-running the script overwrites cleanly.
      const dedupKey = `DEMO-${cutoffDate}-${p.walletRef}-${seq}-${l.sourceFlowId.slice(0, 8)}`;
      await (prisma as any).externalStatementLine.upsert({
        where: { dedupKey },
        update: {
          source,
          accountRef,
          // subAccount == walletRef is THE matching key the engine uses
          // (see wallet-recon-run.service.fetchExternalLinesForWallet).
          subAccount: p.walletRef,
          book: p.book,
          currency: p.currency,
          direction: l.direction,
          amount: l.amount,
          externalRef: l.externalRef,
          datetime: l.datetime,
          description: 'Demo mirror line',
        },
        create: {
          source,
          accountRef,
          subAccount: p.walletRef,
          book: p.book,
          currency: p.currency,
          direction: l.direction,
          amount: l.amount,
          externalRef: l.externalRef,
          datetime: l.datetime,
          description: 'Demo mirror line',
          dedupKey,
        },
      });
      lines += 1;
    }
  }
  return { balances, lines };
}

/**
 * 注入前置闸（fail-closed）。除了明确允许的钱包（在途场景那个），其余目标钱包
 * 必须没有非终态资金单——有就直接抛错，**不许静默降级**。
 *
 * 为什么必须炸而不是跳过：这类问题最难查的不是它本身，是它静默。demo:all 全绿、
 * recon 报少几个 DETECTED，中间没有任何东西说"我挑钱包时妥协了"。
 * 出处：cfec505f（FIRM 钱包挑选补排除条件）把同一条道理用在了挑钱包上，
 * 这里把它推广成所有目标钱包的前置断言。
 */
async function assertTargetWalletsClean(
  prisma: PrismaService,
  targets: Array<{ walletRef: string; allowNonTerminal: boolean }>,
): Promise<void> {
  const mustBeClean = targets.filter((t) => !t.allowNonTerminal).map((t) => t.walletRef);
  if (mustBeClean.length === 0) return;

  const open = (await (prisma as any).fundsOrder.findMany({
    where: {
      status: { notIn: Array.from(TERMINAL_STATUSES) },
      OR: [
        { fromWalletId: { in: mustBeClean } },
        { toWalletId: { in: mustBeClean } },
      ],
    },
    select: { fundsOrderNo: true, status: true, fromWalletId: true, toWalletId: true },
  })) as Array<{ fundsOrderNo: string; status: string; fromWalletId: string | null; toWalletId: string | null }>;

  if (open.length === 0) return;

  // 把内部 UUID 换成人能直接认出来的业务键——这道闸的价值全在"炸得响、能直接定位"，
  // 抛一串 UUID 等于让撞上的人再查一次库。
  const walletIds = Array.from(new Set(
    open.flatMap((o) => [o.fromWalletId, o.toWalletId]).filter((id): id is string => !!id),
  ));
  const walletRows = (await (prisma as any).wallet.findMany({
    where: { id: { in: walletIds } },
    select: { id: true, walletNo: true, ownerNo: true, walletRole: true },
  })) as Array<{ id: string; walletNo: string; ownerNo: string | null; walletRole: string | null }>;
  const nameOf = (id: string | null): string => {
    if (!id) return '-';
    const w = walletRows.find((x) => x.id === id);
    return w ? `${w.walletNo}(${w.ownerNo ?? 'PLATFORM'}/${w.walletRole ?? '?'})` : id;
  };

  const detail = open
    .map((o) => `${o.fundsOrderNo}(${o.status}) from=${nameOf(o.fromWalletId)} to=${nameOf(o.toWalletId)}`)
    .join('; ');
  throw new Error(
    `注入前置闸：${open.length} 笔非终态资金单落在本不该有在途的目标钱包上 —— ${detail}\n` +
    '在途识别会认领它们并把这些钱包的桶重判成 BREAK，答案键就不再成立。\n' +
    '处理：要么把该场景挪到别的钱包，要么在 WalletExpectation 里把 hasNonTerminalFundsOrder 设为 true 并相应改期望桶。',
  );
}

// ── Phase 3 (break only): inject 8 scenarios (ids 1/2/3/4/5/6/14/15 — the
// rest of the 15-scenario matrix lands in Task 5-8) ──
//
// 场景与钱包**不再一一对应**：一个钱包可以挂多条场景（2026-08-30 起）。
// 因此桶是钱包的属性、不是场景的属性，答案键分两级——见 ManifestV3 的类型注释。
//
// Scenario 1 (canon2 T5) no longer synthesises a shell funds_order — it drives
// a REAL stuck withdraw via the shared `createStuckWithdraw` fixture (same path
// as demo:in-transit), which lands on a demo customer's C_VIBAN. That wallet is
// determined by the fixture (not by owner), so we run it FIRST, then recover
// `slotInTransit` by reverse-looking-up `stuck.walletRef` in `plans` (see the
// explicit per-persona slot assignment below, 2026-08-30) rather than picking
// it like the other slots.
async function injectScenarios(
  prisma: PrismaService,
  plans: WalletPlan[],
  cutoff: Date,
  ctx: StuckFixtureCtx,
): Promise<ManifestV3> {
  if (plans.length === 0) throw new Error('No eligible wallets — seed business data first');
  const cutoffDate = ymd(cutoff);

  // ── Scenario 1 FIRST — real stuck withdraw on a demo customer's C_VIBAN ──
  // Runs FIRST, before the explicit per-persona slot lookups below, because its
  // (fixture-chosen) wallet is recovered from `stuck.walletRef` afterwards
  // (see `slotInTransit`, 2026-08-30) rather than looked up by owner+asset like
  // the other slots. Uses the AED (fiat) leg, which parks at
  // SUBMITTED (non-terminal, POST未做) → the customer C_VIBAN carries a −分
  // external OUT line the matcher's Pass3 claims as in-transit. (writeMirror has
  // already written this wallet's ExternalBalance closing=internalTotal + coaCode;
  // the fixture's injectStuckExternalMirror upsert-updates only closing/line and
  // leaves coaCode intact — and since the stuck leg is unposted, internalPosted ==
  // internalTotal, so closing = internalTotal − bumpMinor lands the intended
  // delta=−bumpMinor. See canon2 T5.)
  const demoCustomers = await resolveDemoCustomers(prisma);
  const s1Customer = demoCustomers[0]; // demo_alice — same customer demo:in-transit uses
  const s1Asset = await (prisma as any).asset.findFirst({
    where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' },
  });
  if (!s1Asset) throw new Error('scenario 1: AED active asset not seeded — run business seed first');
  const stuck = await createStuckWithdraw(ctx, {
    customer: s1Customer,
    asset: s1Asset,
    amount: '500',
    cutoff,
  });

  // 钱包分配按 specs/2026-08-30-recon-break-scenarios-design.md §4.2 显式指定。
  // 不再用轮转挑选：一个钱包挂哪些场景是设计决策，让遍历顺序决定它，等于
  // 演示内容随数据顺序漂移，而且展示位（同形不同真相摆一屏）根本没法安排。
  const planByOwnerAsset = (ownerNo: string, assetCode: string): WalletPlan => {
    const p = plans.find((x) => x.ownerNo === ownerNo && x.currency === assetCode && x.walletKind === 'CUSTOMER');
    if (!p) throw new Error(`找不到 ${ownerNo} 的 ${assetCode} 客户钱包 —— demo:all 是否跑过？花名册是否含该客户的素材单？`);
    return p;
  };
  const emailToNo = async (email: string): Promise<string> => {
    const c = await (prisma as any).customerMain.findUnique({ where: { email }, select: { customerNo: true } });
    if (!c) throw new Error(`客户不存在：${email}`);
    return c.customerNo;
  };

  const ALICE_NO = await emailToNo('demo_alice@example.com');
  const BOB_NO   = await emailToNo('demo_bob@example.com');
  const GRACE_NO = await emailToNo('demo_grace@example.com');
  const FRANK_NO = await emailToNo('demo_frank@example.com');
  const JACK_NO  = await emailToNo('demo_jack@example.com');
  const KATE_NO  = await emailToNo('demo_kate@example.com');

  // ⚠️ 在途那个钱包**必须从卡单 fixture 推出来，不能按 owner 猜**：场景 ① 用的是
  // createStuckWithdraw 造的那笔真卡单（变量 `stuck`），它挂在哪个钱包由花名册
  // #20 决定。按 owner 硬猜今天恰好一致，但花名册一改就会**静默分叉**——场景 ①
  // 指着 A 钱包、前置闸放行的是 B 钱包。
  const slotInTransit = plans.find((p) => p.walletRef === stuck.walletRef);
  if (!slotInTransit) throw new Error(`在途场景的钱包不在 plans 里：${stuck.walletRef}`);

  const slotShowcaseA     = planByOwnerAsset(GRACE_NO, 'AED');        // 展示位甲：金额不对三真相 ④⑩⑪
  const slotShowcaseB     = planByOwnerAsset(FRANK_NO, 'AED');        // 展示位乙：我有外无三真相 ③⑦⑧
  const slotShowcaseC     = planByOwnerAsset(BOB_NO,   'USDT-TRON');  // 展示位丙：外有我无两真相 ⑤⑨
  const slotFeeNetted     = planByOwnerAsset(BOB_NO,   'AED');        // ② 手续费轧差
  const slotReturn        = planByOwnerAsset(ALICE_NO, 'USDT-TRON');  // ⑥ 退汇
  const slotCutoff        = planByOwnerAsset(GRACE_NO, 'USDT-TRON');  // ⑫ 跨日切
  const slotMisroutedFrom = planByOwnerAsset(JACK_NO,  'AED');        // ⑬ 记错钱包 · 发出端
  const slotMisroutedTo   = planByOwnerAsset(KATE_NO,  'AED');        // ⑬ 记错钱包 · 接收端

  // ── FIRM wallet pick (scenarios 5+7 — shared wallet, hedged pair) ──────
  // Exclude any FIRM wallet that is already the from/to side of a non-terminal
  // funds_order. This always includes scenario 1's OWN stuck withdraw created
  // just above: createStuckWithdraw drives a REAL 2-leg withdrawal, and leg 2
  // (the fee) lands on a FIRM wallet — e.g. E.INCOME_OTHER — and stays
  // non-terminal right alongside the stuck main leg, every single break run.
  // A pre-existing non-terminal withdrawal seeded by the business roster
  // (e.g. #20, "卡在半路（对账用）") trips the same check the same way.
  // Scenarios 5+7 only inject ghost ORPHAN_EXTERNAL lines expecting a
  // SOFT_FLAG bucket — but a wallet that already carries a real non-terminal
  // funds order also produces an IN_TRANSIT line, and the engine correctly
  // reclassifies "orphan + in-transit on the same wallet" as BREAK. That
  // 排除已带非终态资金单的 FIRM 钱包。理由**不是**"场景之间要互不重叠"
  // （那个 disjoint 前提已于 2026-08-30 废除，一个钱包现在可以挂多条场景），
  // 而是另一条独立的轴：**业务数据污染场景**。
  // 场景 5+7 只注入对冲的幽灵 ORPHAN_EXTERNAL 行、期望落在 SOFT_FLAG；但一个
  // 已经挂着真实非终态资金单的钱包会**额外**产生一条 IN_TRANSIT 行，引擎于是
  // （正确地）把"孤儿 + 在途同处一个钱包"重判成 BREAK —— 答案键期望 SOFT_FLAG，
  // 于是 #5/#7 双双 MISSED，而引擎一点没错。
  // 这件事与一个钱包上挂几条场景无关：就算一钱包只挂一条，它照样会咬人。
  // 用的是引擎自己 Pass 3（在途匹配）判"还没了结"的同一套 TERMINAL_STATUSES。
  const firmCandidatesAll = [...plans]
    .filter((p) => p.walletKind === 'FIRM')
    .sort((a, b) => a.walletRef.localeCompare(b.walletRef));
  const firmWalletIds = firmCandidatesAll.map((p) => p.walletRef);
  const openFundsOrders = firmWalletIds.length
    ? ((await (prisma as any).fundsOrder.findMany({
        where: {
          status: { notIn: Array.from(TERMINAL_STATUSES) },
          OR: [
            { fromWalletId: { in: firmWalletIds } },
            { toWalletId: { in: firmWalletIds } },
          ],
        },
        select: { fromWalletId: true, toWalletId: true },
      })) as Array<{ fromWalletId: string | null; toWalletId: string | null }>)
    : [];
  const dirtyFirmWalletIds = new Set(
    openFundsOrders.flatMap((r) => [r.fromWalletId, r.toWalletId]).filter((id): id is string => !!id),
  );
  const firmCandidates = firmCandidatesAll.filter((p) => !dirtyFirmWalletIds.has(p.walletRef));
  if (firmCandidates.length === 0) {
    throw new Error(
      firmCandidatesAll.length === 0
        ? 'Need ≥1 FIRM wallet for scenarios 5+7 — seed firm-side activity.'
        : `All ${firmCandidatesAll.length} FIRM wallet(s) already carry a non-terminal funds order ` +
          `(e.g. an in-transit withdraw fee leg) — none left clean for scenarios 5+7. Refusing to ` +
          `silently reuse a dirty wallet (it would mask #5/#7 as BREAK instead of SOFT_FLAG). Seed a ` +
          `FIRM wallet with crossing flows but no open funds_orders, or clear the stray non-terminal order.`,
    );
  }
  const s5s7Plan = firmCandidates[0];

  // 前置闸：目标钱包不得带非终态资金单（在途场景那个除外——它就是靠真卡单的）。
  await assertTargetWalletsClean(prisma, [
    { walletRef: slotInTransit.walletRef,     allowNonTerminal: true  },
    { walletRef: slotShowcaseA.walletRef,     allowNonTerminal: false },
    { walletRef: slotShowcaseB.walletRef,     allowNonTerminal: false },
    { walletRef: slotShowcaseC.walletRef,     allowNonTerminal: false },
    { walletRef: slotFeeNetted.walletRef,     allowNonTerminal: false },
    { walletRef: slotReturn.walletRef,        allowNonTerminal: false },
    { walletRef: slotCutoff.walletRef,        allowNonTerminal: false },
    { walletRef: slotMisroutedFrom.walletRef, allowNonTerminal: false },
    { walletRef: slotMisroutedTo.walletRef,   allowNonTerminal: false },
    { walletRef: s5s7Plan.walletRef,          allowNonTerminal: false },
  ]);

  const scenarios: ScenarioExpectation[] = [];
  const wallets: WalletExpectation[] = [];

  // Build a deterministic but realistic external ref (e.g. BANK-PO-… for
  // fiat, 0x… for crypto). Seq incl. inj index so multiple ghosts don't
  // collide.
  let injSeq = 0;
  const refFor = (currency: string, kind: string): string => {
    injSeq += 1;
    return /^(USDT|BTC|ETH|USDC)/i.test(currency)
      ? fakeChainTxHash(`${kind}${injSeq}`)
      : fakeBankRef(`${kind}${injSeq}`, cutoffDate);
  };

  // Helper: shift the wallet's closingBalance by `delta` (signed) to keep
  // it consistent with the intended residual. Direction sign convention:
  //   customer/firm wallet (credit-normal): IN means balance up, OUT down.
  async function bumpClosing(plan: WalletPlan, delta: Prisma.Decimal): Promise<string> {
    const source = sourceFor(plan.currency);
    const eb = await (prisma as any).externalBalance.findUnique({
      where: {
        source_accountRef_cutoffDate: {
          source, accountRef: plan.walletRef, cutoffDate,
        },
      },
    });
    if (!eb) throw new Error(`No external balance for wallet ${plan.walletRef}`);
    const newClose = eb.closingBalance.plus(delta);
    await (prisma as any).externalBalance.update({
      where: { id: eb.id },
      data: { closingBalance: newClose },
    });
    return eb.closingBalance.toString();
  }

  // ── Scenario 1 — 在途时序差 (IN_TRANSIT) — REAL stuck withdraw ───────────
  // The withdraw was already created above (before the explicit slot lookups) via the
  // shared `createStuckWithdraw` fixture — a real withdraw driven through the
  // workflow to a non-terminal payout leg (fiat SUBMITTED, POST未做). The
  // fixture also wrote the −分 external OUT line + upsert-updated the wallet's
  // ExternalBalance closing (= internalTotal − bumpMinor, coaCode preserved).
  // So this block only records the manifest entry; no synthetic shell here.
  //
  // The matcher's Pass3 (子轮B: amount+direction+72h, refsOf(leg) empty) claims
  // this leg → line item matchStatus=IN_TRANSIT, internalSourceNo=leg no. The
  // in-transit amount is the external line's minor value (net × 10^decimals),
  // read back for the manifest's display/answer key.
  {
    const line = await (prisma as any).externalStatementLine.findUnique({
      where: { dedupKey: `${DEMO_STUCK_WD_REF_PREFIX}${stuck.withdrawNo}` },
      select: { amount: true },
    });
    // No silent fallback: the fixture always writes this line (its dedupKey ==
    // DEMO-STUCK-WD-<withdrawNo>). Missing it means the fixture broke — throw
    // rather than fall back to stuck.amount, which is the GROSS main-unit ('500'),
    // wrong both in scale and value vs the NET minor (49800) we need here.
    if (!line) throw new Error(`scenario 1: fixture external line missing for ${stuck.withdrawNo}`);
    const inTransitMinor = line.amount.toString(); // 分（net × 10^decimals）
    scenarios.push({
      scenarioId: 1,
      rootCause: 'IN_TRANSIT_TIMING',
      expectedLines: [{
        walletRef: stuck.walletRef,
        lineType: 'IN_TRANSIT',
        amount: inTransitMinor,
        externalRef: stuck.externalRef,
      }],
      fundsOrderNo: stuck.fundsOrderNo,
      detail: {
        withdrawNo: stuck.withdrawNo,
        fundsOrderId: stuck.fundsOrderId,
        fundsOrderNo: stuck.fundsOrderNo,
        note: 'real non-terminal payout leg (SUBMITTED) — external −分 OUT line claimed in-transit by Pass3',
      },
    });
    wallets.push({
      walletRef: stuck.walletRef,
      scenarioIds: [1],
      expectedBucket: 'IN_TRANSIT',
      bucketRationale: '唯一差异是这条被 Pass3 判定为在途的外部行，其余流水与收盘全部对齐 → 无残差、无孤儿行 → IN_TRANSIT；这张非终态资金单本身就是本场景的设计前提（花名册 #20）',
      hasNonTerminalFundsOrder: true,
    });
  }

  // ── Scenario 2 — 手续费差额 (BREAK / AMOUNT_MISMATCH) ───────────────────
  // Bank nets a fee out of the deposit before crediting — same externalRef,
  // amount = internal − fee. Bump closing by the same negative delta so the
  // wallet's balance check also breaks (not just the line item).
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotFeeNetted.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on ${slotFeeNetted.walletRef}`);
    const fee = D('97');
    const newAmount = candidate.amount.minus(fee);
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    const signedDelta = candidate.direction === 'IN' ? fee.negated() : fee;
    const prevClose = await bumpClosing(slotFeeNetted, signedDelta);
    scenarios.push({
      scenarioId: 2,
      rootCause: 'FEE_NETTED',
      expectedLines: [{
        walletRef: slotFeeNetted.walletRef,
        lineType: 'AMOUNT_MISMATCH',
        amount: fee.toString(),
        externalRef: candidate.externalRef,
      }],
      detail: {
        externalLineId: candidate.id,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
    wallets.push({
      walletRef: slotFeeNetted.walletRef,
      scenarioIds: [2],
      expectedBucket: 'BREAK',
      bucketRationale: '银行扣费后才入账 → 外部金额 = 内部金额 − 手续费，收盘同步压低同额 → 残差 = 手续费 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── Scenario 3 — 对账单缺行 (BREAK / ORPHAN_INTERNAL) ───────────────────
  // Bank never reported one credit/debit. Delete the mirrored line AND
  // shrink external closingBalance by that line's amount.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotShowcaseB.walletRef },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line to delete on ${slotShowcaseB.walletRef}`);
    await (prisma as any).externalStatementLine.delete({ where: { id: candidate.id } });
    const signedDelta = candidate.direction === 'IN'
      ? candidate.amount.negated()
      : candidate.amount;
    const prevClose = await bumpClosing(slotShowcaseB, signedDelta);
    scenarios.push({
      scenarioId: 3,
      rootCause: 'STATEMENT_MISSING_LINE',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef,
        lineType: 'ORPHAN_INTERNAL',
        amount: candidate.amount.toString(),
        externalRef: candidate.externalRef,
      }],
      detail: {
        deletedExternalLineId: candidate.id,
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
    wallets.push({
      walletRef: slotShowcaseB.walletRef,
      scenarioIds: [3],
      expectedBucket: 'BREAK',
      bucketRationale: '删一条外部行并压低同额收盘 → 残差 = 该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── Scenario 4 — 精度/单位错 (BREAK / AMOUNT_MISMATCH) ──────────────────
  // Bank posts the line with a scale error (×100 — e.g. cents-vs-units bug).
  // Bump closing by the same delta so the balance check breaks too.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotShowcaseA.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on ${slotShowcaseA.walletRef}`);
    const newAmount = candidate.amount.times(100);
    const scaleDelta = newAmount.minus(candidate.amount);
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    const signedDelta = candidate.direction === 'IN' ? scaleDelta : scaleDelta.negated();
    const prevClose = await bumpClosing(slotShowcaseA, signedDelta);
    scenarios.push({
      scenarioId: 4,
      rootCause: 'SCALE_ERROR',
      expectedLines: [{
        walletRef: slotShowcaseA.walletRef,
        lineType: 'AMOUNT_MISMATCH',
        amount: scaleDelta.toString(),
        externalRef: candidate.externalRef,
      }],
      detail: {
        externalLineId: candidate.id,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
    wallets.push({
      walletRef: slotShowcaseA.walletRef,
      scenarioIds: [4],
      expectedBucket: 'BREAK',
      bucketRationale: '银行按 ×100 记错精度/单位 → 外部金额比内部金额多出 scaleDelta，收盘同步偏移同额 → 残差 = scaleDelta ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑭ — 银行杂费 (SOFT_FLAG，与场景 ⑮ 银行利息对冲，共用同一个公司钱包) ───
  // Insert a ghost OUT line (bank charge) on the shared FIRM wallet, closing
  // moves down. Scenario 15 inserts an equal-amount IN (bank interest) that
  // exactly cancels this on closing, so the wallet's net delta stays 0
  // (SOFT_FLAG) while both lines individually show up as orphanExternal.
  const s5s7Amount = D('200');
  {
    const fakeRef = refFor(s5s7Plan.currency, 'CHARGE');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s5s7Plan.currency),
        accountRef: s5s7Plan.walletRef,
        subAccount: s5s7Plan.walletRef,
        book: s5s7Plan.book,
        currency: s5s7Plan.currency,
        direction: 'OUT',
        amount: s5s7Amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo bank charge (ghost OUT, hedged by scenario 15 bank interest)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s5s7Plan.walletRef}-s5-bank-charge`,
      },
    });
    const prevClose = await bumpClosing(s5s7Plan, s5s7Amount.negated());
    scenarios.push({
      scenarioId: 14,
      rootCause: 'BANK_CHARGE',
      expectedLines: [{
        walletRef: s5s7Plan.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: s5s7Amount.toString(),
        externalRef: fakeRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        direction: 'OUT',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s5s7Amount.negated().toString(),
        pairedWithScenario: 15,
      },
    });
    // 场景 14+15 共用一个 FIRM 钱包（对冲对）——桶断言只在场景 15 那段推一次，见下方。
  }

  // ── 场景 ⑤ — 充值漏监听 (BREAK / ORPHAN_EXTERNAL) ───────────────────────
  // Bank sees a customer deposit our listener never picked up. Insert a
  // ghost IN line, bump closing up — no in-transit order explains it, so
  // it's a hard break.
  {
    const s6Amount = D('61');
    const fakeRef = refFor(slotShowcaseC.currency, 'MISSEDDEP');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotShowcaseC.currency),
        accountRef: slotShowcaseC.walletRef,
        subAccount: slotShowcaseC.walletRef,
        book: slotShowcaseC.book,
        currency: slotShowcaseC.currency,
        direction: 'IN',
        amount: s6Amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo missed-deposit-listener credit (bank saw it, we never ingested it)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotShowcaseC.walletRef}-s6-missed-deposit`,
      },
    });
    const prevClose = await bumpClosing(slotShowcaseC, s6Amount);
    scenarios.push({
      scenarioId: 5,
      rootCause: 'MISSED_DEPOSIT',
      expectedLines: [{
        walletRef: slotShowcaseC.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: s6Amount.toString(),
        externalRef: fakeRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s6Amount.toString(),
      },
    });
    wallets.push({
      walletRef: slotShowcaseC.walletRef,
      scenarioIds: [5],
      expectedBucket: 'BREAK',
      bucketRationale: '银行侧有一笔我方监听漏收的入账 → 插入一条无内部对应的孤儿外部 IN 行，收盘同步调高同额、无人对冲 → 残差 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑮ — 银行利息 (SOFT_FLAG，与场景 ⑭ 银行杂费对冲，共用同一个公司钱包) ───
  // Same FIRM wallet as scenario 14, same amount, opposite direction (IN).
  // Nets scenario 14's OUT to a 0 closing delta ⇒ same wallet, same case,
  // bucket=SOFT_FLAG (balance ties, but 2 orphaned lines expose the wash).
  {
    const fakeRef = refFor(s5s7Plan.currency, 'INTEREST');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s5s7Plan.currency),
        accountRef: s5s7Plan.walletRef,
        subAccount: s5s7Plan.walletRef,
        book: s5s7Plan.book,
        currency: s5s7Plan.currency,
        direction: 'IN',
        amount: s5s7Amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo bank interest (ghost IN, hedges scenario 14 bank charge)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s5s7Plan.walletRef}-s7-bank-interest`,
      },
    });
    const prevClose = await bumpClosing(s5s7Plan, s5s7Amount);
    scenarios.push({
      scenarioId: 15,
      rootCause: 'BANK_INTEREST',
      expectedLines: [{
        walletRef: s5s7Plan.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: s5s7Amount.toString(),
        externalRef: fakeRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s5s7Amount.toString(),
        pairedWithScenario: 14,
      },
    });
    wallets.push({
      walletRef: s5s7Plan.walletRef,
      scenarioIds: [14, 15],
      expectedBucket: 'SOFT_FLAG',
      bucketRationale: '杂费 −X 与利息 +X 金额相等方向相反 → 残差 = 0；两条孤儿外部行 → 异常数 2 > 0 → SOFT_FLAG',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑥ — 退汇 (BREAK / ORPHAN_EXTERNAL / 客户账簿) ──────────────────
  // 一笔已经入过账的钱被银行退了回去：银行对账单上多出一条 OUT，我方账上
  // 还留着那笔入账。→ 外有我无 + 余额差。
  // ⚠️ 2026-08-30 重写：旧版造了一进一出净额为零的两条行，又单独把收盘压低
  // 同额——现实里没有哪个事件同时产生这两样（旧 spec §8 短板 1 已登记）。
  {
    const s6Amount = D('4700');   // 分 —— USDT 0.004700
    const outRef = refFor(slotReturn.currency, 'RETURNOUT');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotReturn.currency),
        accountRef: slotReturn.walletRef,
        subAccount: slotReturn.walletRef,
        book: slotReturn.book,
        currency: slotReturn.currency,
        direction: 'OUT',
        amount: s6Amount,
        externalRef: outRef,
        datetime: cutoff,
        description: 'Demo bank return — a previously credited deposit was clawed back',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotReturn.walletRef}-s6-bank-return`,
      },
    });
    const prevClose = await bumpClosing(slotReturn, s6Amount.negated());
    scenarios.push({
      scenarioId: 6,
      rootCause: 'BANK_RETURN',
      expectedLines: [{
        walletRef: slotReturn.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: s6Amount.toString(),
        externalRef: outRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        prevClosingBalance: prevClose,
        closingBalanceDelta: s6Amount.negated().toString(),
      },
    });
    wallets.push({
      walletRef: slotReturn.walletRef,
      scenarioIds: [6],
      expectedBucket: 'BREAK',
      bucketRationale: '加一条 OUT 幽灵行并压低同额收盘 → 残差 = −该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  return { cutoff: cutoff.toISOString(), scenarios, wallets };
}

// ── Phase 3.5: populate balanceAfter on every line via running-balance pass.
// For each (source, accountRef, currency) tuple owning a balance row on
// `cutoff`, fetch lines for that day in datetime ASC order, start from
// openingBalance, accumulate IN(+) / OUT(−), write balanceAfter per line.
// Runs in both pass and break modes so demo lines always carry a running
// balance for the External Balances detail page roll-forward column.
async function populateBalanceAfter(prisma: PrismaService, cutoff: Date): Promise<number> {
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const balances = (await (prisma as any).externalBalance.findMany({
    where: { cutoffDate },
    select: { source: true, accountRef: true, currency: true, openingBalance: true },
  })) as Array<{ source: string; accountRef: string; currency: string; openingBalance: Prisma.Decimal | null }>;

  const dayLo = new Date(`${cutoffDate}T00:00:00.000Z`);
  const dayHi = new Date(`${cutoffDate}T23:59:59.999Z`);
  let updated = 0;

  for (const b of balances) {
    const lines = (await (prisma as any).externalStatementLine.findMany({
      where: {
        source: b.source,
        accountRef: b.accountRef,
        currency: b.currency,
        datetime: { gte: dayLo, lte: dayHi },
      },
      orderBy: { datetime: 'asc' },
      select: { id: true, direction: true, amount: true },
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal }>;

    let running = new Prisma.Decimal(b.openingBalance ?? 0);
    for (const l of lines) {
      running = l.direction === 'IN' ? running.plus(l.amount) : running.minus(l.amount);
      await (prisma as any).externalStatementLine.update({
        where: { id: l.id },
        data: { balanceAfter: running },
      });
      updated += 1;
    }
  }
  return updated;
}

// ── Phase 4: 两级校验 ────────────────────────────────────────────────────
//   按场景 —— 每条场景的每一条 expectedLine 都要在本轮 line items 里找得到
//   按钱包 —— 每个被注入的钱包，其 case 的 bucket 要等于期望值
async function verifyManifest(
  prisma: PrismaService,
  runId: string,
  manifest: ManifestV3,
): Promise<{
  scenariosDetected: number;
  scenariosMissed: string[];
  walletsOk: number;
  walletsMismatched: string[];
}> {
  const lineItems = (await (prisma as any).reconciliationLineItem.findMany({
    where: { foundByRunId: runId },
    select: {
      matchStatus: true,
      walletRef: true,
      externalRef: true,
      internalSourceNo: true,
    },
  })) as Array<{
    matchStatus: string;
    walletRef: string | null;
    externalRef: string | null;
    internalSourceNo: string | null;
  }>;

  const cases = (await (prisma as any).reconciliationCase.findMany({
    where: { openedByRunId: runId },
    select: { caseNo: true, walletRef: true, bucket: true },
  })) as Array<{ caseNo: string; walletRef: string | null; bucket: string | null }>;

  // ── 按场景 ──
  const scenariosMissed: string[] = [];
  let scenariosDetected = 0;
  for (const sc of manifest.scenarios) {
    const allLinesHit = sc.expectedLines.every((exp) =>
      lineItems.some(
        (l) => l.matchStatus === exp.lineType
          && l.walletRef === exp.walletRef
          && (exp.externalRef ? l.externalRef === exp.externalRef : true),
      ),
    );
    // 在途场景额外断言：那条 IN_TRANSIT 行必须指向我们造的那张资金单，
    // 否则"认领到了某张在途单"这个绿灯可能来自别的单。
    const fundsOrderHit = sc.fundsOrderNo
      ? lineItems.some(
          (l) => l.matchStatus === 'IN_TRANSIT'
            && l.internalSourceNo === sc.fundsOrderNo,
        )
      : true;
    if (allLinesHit && fundsOrderHit) scenariosDetected += 1;
    else scenariosMissed.push(`scenario#${sc.scenarioId}(${sc.rootCause})`);
  }

  // ── 按钱包 ──
  const walletsMismatched: string[] = [];
  let walletsOk = 0;
  for (const w of manifest.wallets) {
    const c = cases.find((x) => x.walletRef === w.walletRef);
    if (c && c.bucket === w.expectedBucket) walletsOk += 1;
    else {
      walletsMismatched.push(
        `${w.walletRef} expect=${w.expectedBucket} actual=${c?.bucket ?? '(无 case)'} [${w.bucketRationale}]`,
      );
    }
  }

  return { scenariosDetected, scenariosMissed, walletsOk, walletsMismatched };
}

// ── Phase 5 (break only): identity self-check ────────────────────────────
// Reads the run row's five-bucket counters and cross-checks two identities
// that must always hold for a wallet-level reconciliation run:
//   ① walletCount == matchedCount + inTransitCount + softFlagCount + breakCount
//   ② openedCount + reObservedCount == inTransitCount + softFlagCount + breakCount
//      (every non-MATCHED wallet gets exactly one case — either newly opened
//      this run or re-observed from a prior run).
async function assertIdentities(
  prisma: PrismaService,
  runId: string,
): Promise<{ ok: boolean; checks: Array<[string, boolean]> }> {
  const run = (await (prisma as any).reconciliationRun.findUnique({
    where: { id: runId },
    select: {
      walletCount: true, matchedCount: true, inTransitCount: true,
      softFlagCount: true, breakCount: true, openedCount: true, reObservedCount: true,
    },
  })) as {
    walletCount: number; matchedCount: number; inTransitCount: number;
    softFlagCount: number; breakCount: number; openedCount: number; reObservedCount: number;
  };

  const nonMatchedBuckets = run.inTransitCount + run.softFlagCount + run.breakCount;
  const identity1 = run.walletCount === run.matchedCount + nonMatchedBuckets;
  const identity2 = run.openedCount + run.reObservedCount === nonMatchedBuckets;

  const checks: Array<[string, boolean]> = [
    [`identity① walletCount(${run.walletCount}) == matched(${run.matchedCount}) + inTransit(${run.inTransitCount}) + softFlag(${run.softFlagCount}) + break(${run.breakCount})`, identity1],
    [`identity② opened(${run.openedCount}) + reObserved(${run.reObservedCount}) == inTransit+softFlag+break(${nonMatchedBuckets})`, identity2],
  ];
  return { ok: identity1 && identity2, checks };
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  const { mode, cutoffIso } = parseArgs(process.argv.slice(2));
  const cutoff = cutoffIso ? new Date(cutoffIso) : new Date();
  console.log(`════════ recon:demo  mode=${mode}  cutoff=${cutoff.toISOString()} ════════`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  if (mode === 'reset') {
    const r = await clearWalletDemo(prisma);
    console.log(`reset done: runs=${r.runs} cases=${r.cases} line_items=${r.lineItems} balances=${r.balances} lines=${r.lines} fundsOrders=${r.fundsOrders}`);
    await app.close();
    process.exit(0);
  }

  // Both pass and break start from a clean slate — wipe WALLET_V1 footprint
  // so the new Run is the only one for this cutoff.
  const cleared = await clearWalletDemo(prisma);
  if (cleared.runs > 0 || cleared.balances > 0 || cleared.lines > 0 || cleared.fundsOrders > 0) {
    console.log(`self-clean: runs=${cleared.runs} cases=${cleared.cases} line_items=${cleared.lineItems} balances=${cleared.balances} lines=${cleared.lines} fundsOrders=${cleared.fundsOrders}`);
  }

  // Phase 1 — build per-wallet plan from current account_flows.
  const balanceChecker = app.get(WalletBalanceCheckerService);
  const tbEvidence = app.get(TbEvidenceService);
  const plans = await planWallets(prisma, balanceChecker, tbEvidence, cutoff);
  if (plans.length === 0) {
    console.error('No eligible wallets — seed business data (demo:all) first');
    await app.close();
    process.exit(1);
  }
  console.log(`planned ${plans.length} wallet(s):`);
  for (const p of plans) {
    console.log(`  ${p.walletRef}  ${p.currency}  book=${p.book}  internal=${p.internalTotal.toString()}  lines=${p.lines.length}  coa=${p.coaCode}  owner=${p.ownerNo ?? '-'}`);
  }

  // Phase 2 — write mirror external rows.
  const written = await writeMirror(prisma, plans, cutoff);
  console.log(`mirror written: external_balances=${written.balances}  external_statement_lines=${written.lines}`);

  // Phase 3 (break only) — inject 8 scenarios + write manifest.
  //
  // Scenario 1 now drives a REAL stuck withdraw whose external OUT line is
  // stamped `datetime = leg.createdAt` — created *inside* injectScenarios, i.e.
  // AFTER the top-of-main cutoff. The engine's fetchExternalLinesForWallet
  // filters `datetime <= cutoff`, so we must run the engine on a cutoff that is
  // ≥ every fixture line's timestamp. Re-capture `engineCutoff` right after
  // injection (same business day → ExternalBalance cutoffDate still matches;
  // scenario 2-9 lines are stamped at the earlier cutoff, still ≤ engineCutoff).
  // This mirrors demo:in-transit + recon:rerun, where the recon cutoff is always
  // captured later than the fixture.
  let engineCutoff = cutoff;
  let manifest: ManifestV3 | null = null;
  if (mode === 'break') {
    const ctx: StuckFixtureCtx = {
      app,
      prisma,
      fundsOrders: app.get(FundsOrderService),
      withdrawQuote: app.get(WithdrawQuoteService),
      withdraws: app.get(WithdrawTransactionsService),
      withdrawWf: app.get(WithdrawWorkflowService),
    };
    manifest = await injectScenarios(prisma, plans, cutoff, ctx);
    engineCutoff = new Date(); // ≥ every fixture line's datetime (see above)
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`manifest written to ${MANIFEST_PATH}  (${manifest.scenarios.length} scenarios, ${manifest.wallets.length} wallets)`);
    for (const sc of manifest.scenarios) {
      const wallets = Array.from(new Set(sc.expectedLines.map((l) => l.walletRef))).join(',') || '(case-only)';
      console.log(`  [#${sc.scenarioId} ${sc.rootCause}] wallet=${wallets}`);
    }
  }

  // Phase 3.5 — populate balanceAfter on every line (running balance from opening).
  // Keyed on cutoffDate = the day the ExternalBalance/lines were written (the
  // early `cutoff`), so use that (not engineCutoff) — they share the same
  // business day in the normal case; only a midnight-straddling injection would
  // diverge, which the fixture already documents as out of scope.
  const balanceAfterCount = await populateBalanceAfter(prisma, cutoff);
  console.log(`balanceAfter populated on ${balanceAfterCount} line(s)`);

  // Phase 4 — run the engine (on engineCutoff ≥ every fixture line's datetime).
  const engine = app.get(WalletReconRunService);
  const result = await engine.run({ cutoff: engineCutoff, manifest: manifest ?? undefined });
  console.log(`\n──── engine result ────`);
  console.log(`runId=${result.runId}`);
  console.log(`status=${result.status}  walletsChecked=${result.walletsChecked}  casesOpened=${result.casesOpened}`);
  console.log(`orphanInternal=${result.orphanInternal}  orphanExternal=${result.orphanExternal}  mismatch=${result.mismatch}`);

  // Phase 5 — assertions.
  let ok = true;
  if (mode === 'pass') {
    const checks = [
      ['status==PASS', result.status === 'PASS'],
      ['casesOpened==0', result.casesOpened === 0],
      ['orphanInternal==0', result.orphanInternal === 0],
      ['orphanExternal==0', result.orphanExternal === 0],
      ['mismatch==0', result.mismatch === 0],
    ] as const;
    console.log(`\n──── pass-mode asserts ────`);
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? 'OK' : 'FAIL'}  ${label}`);
      if (!pass) ok = false;
    }
  } else if (mode === 'break' && manifest) {
    const v = await verifyManifest(prisma, result.runId, manifest);
    console.log(`\n──── manifest verification ────`);
    for (const sc of manifest.scenarios) {
      const missed = v.scenariosMissed.some((m) => m.startsWith(`scenario#${sc.scenarioId}(`));
      const wallets = Array.from(new Set(sc.expectedLines.map((l) => l.walletRef.slice(0, 8)))).join(',') || '(case-only)';
      console.log(`  #${String(sc.scenarioId).padStart(2)}  ${sc.rootCause.padEnd(26)} wallet=${wallets}  ${missed ? 'MISSED' : 'DETECTED'}`);
    }
    console.log(`  scenarios: ${v.scenariosDetected}/${manifest.scenarios.length} DETECTED`);
    console.log(`  wallets:   ${v.walletsOk}/${manifest.wallets.length} bucket OK`);
    for (const m of v.walletsMismatched) console.log(`    ✗ ${m}`);

    const idn = await assertIdentities(prisma, result.runId);
    console.log(`\n──── identity self-check ────`);
    for (const [label, ok] of idn.checks) console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}`);

    const asserts: Array<[string, boolean]> = [
      ['status==BREAK', result.status === 'BREAK'],
      [`scenarios ${v.scenariosDetected}/${manifest.scenarios.length}`, v.scenariosDetected === manifest.scenarios.length],
      [`wallets ${v.walletsOk}/${manifest.wallets.length}`, v.walletsOk === manifest.wallets.length],
      ['identities OK', idn.ok],
    ];
    console.log(`\n──── break-mode asserts ────`);
    for (const [label, pass] of asserts) {
      console.log(`  ${pass ? 'OK ' : 'BAD'} ${label}`);
      if (!pass) ok = false;
    }
    if (ok) console.log(`\nALL ${manifest.scenarios.length} SCENARIOS DETECTED PER MANIFEST`);
    else console.error('\nASSERT(S) FAILED');
  }

  console.log(`\n════════ recon:demo ${mode} DONE — ${ok ? 'OK' : 'FAILED'} ════════`);
  await app.close();
  // Both modes exit 0 on expected outcome — break is success when the
  // engine catches every injected scenario + both identities hold.
  // Anomaly-detection/identity failure or pass-mode break trips a non-zero
  // exit code.
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

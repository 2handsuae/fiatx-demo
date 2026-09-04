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
//                  disposition matrix and write `manifest.json`.
//                  按处置分组（spec 2026-09-01-recon-disposition-conclusion-
//                  design.md §5，= 走查顺序），15 行 = 15 场景：
//                    ① 在途时序差   推单
//                    ② 小数点错位   冲正
//                    ③ 我方少记     冲正
//                    ④ 舍入精度差   冲正
//                    ⑤ 手续费轧差   冲正
//                    ⑥ 重复入账     冲销（机器佐证）
//                    ⑦ 假信号入账   冲销（纯人判）
//                    ⑧ 记错客户     改记（一场景两案，BREAK ×2）
//                    ⑨ 跨日切       挂起·等下期
//                    ⑩ 查无果       挂起·调查中
//                    ⑪ 银行杂费     补记（与⑫对冲）
//                    ⑫ 银行利息     补记（与⑪对冲）
//                    ⑬ 漏监听充值   补单·充值补录（B 批开门，链上）
//                    ⑭ 入金被退汇   补单·退汇认领（B 批开门，法币，叠 Kate AED）
//                    ⑮ 出金被退回   补单·退回认领（B 批开门，法币，叠 Grace AED）
//                  公理：外部资料是权威——不平只能是三种性质之一：我方账错了 /
//                  我方账缺了 / 时机没到，没有第四档"外部数据本身可以商榷"。
//                  旧版两条场景（银行漏报明细、对账单重复行）已删：两者都靠
//                  直接改外部收盘余额让场景成立——这就是把外部数据当成可以由
//                  我们改动/商榷的东西，与"外部资料是权威"自相矛盾，故删。
//
//                  ⚠️ **旧的 disjoint-wallet 前提已于 2026-08-30 显式废除。**
//                  一个钱包现在可以挂多条场景（展示位就是靠这个：同一个钱包
//                  上摆多条差异，讲清楚"形状相同、处置未必相同"或"形状相同、
//                  处置反而相同"两种教训）。因此**桶是钱包的属性、
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

// 栈环境守卫必须排在所有 import 之前。本文件 import 了 AppModule 及一串 Nest
// provider（第 50 行起），守卫此前只经 './demo-lib'（第 63 行）传递引入，排在它们之后。
// 今天不出事是因为 TigerBeetle 客户端建在 onModuleInit 里、晚于 import 完成——
// 那是巧合不是保证：这条传递引入链上任何文件将来加了模块级副作用，
// recon:demo* 就会在连上账本之后才报错，而那时已经写进别人的账本了。
// 2026-08-31 Task 7 评审 Medium 提出，比照 recon-rerun.ts 的做法直接前置。
import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: true });

import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { fakeChainTxHash, fakeBankRef } from '../src/common/utils/fake-external-refs.util';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { WalletBalanceCheckerService } from '../src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { TERMINAL_STATUSES } from '../src/modules/funds-orders/constants/funds-order-transitions.constant';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
// Scenario 1 去合成壳（canon2 T5）：复用 demo:in-transit 同一个共享夹具造真卡提现，
// 金闸门的「在途检测」从此跑在真非终态资金单 + 分外部行上，与 demo:in-transit 同源。
import { createStuckWithdraw, DEMO_STUCK_WD_REF_PREFIX } from './demo-fixtures';
import { resolveDemoCustomers } from './demo-lib';
// T11 同词原则：种子答案键的成因码直接取注册表类型，编译期与 T1 的
// CAUSE_REGISTRY 同源——种子改错码、加错码、漏改码都会在这里炸编译。
import type { CauseCode } from '../src/modules/clearing-settle/reconciliation/disposition/cause-registry';

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

// 15-scenario model（2026-09-01 平账一期半重排，分组表见文件头；2026-09-03
// 平账 B 批补场景 ⑭⑮，14→15）：每个场景
// 重现一个**成因**，成因码 = disposition/cause-registry.ts 的注册表码——
// 种子答案键与注册表**编译期同源**，改错码、漏改码这里直接编译不过。
//
// ⚠️ **本轮显式废除了旧的 disjoint-wallet 前提**（旧文件头写着"Each scenario
// targets its own wallet … so cases stay disjoint"）。一个钱包现在可以挂多条
// 场景——现实本来如此。代价是：**桶是钱包的属性，不再是场景的属性**，故答案键
// 拆成两级。
//
// 唯一游离于注册表之外的是场景 ①：在途不是差异、不走定性菜单，成因表里没有
// 它的条目，保留种子专用字面量 `IN_TRANSIT_TIMING`。
type RootCause = CauseCode | 'IN_TRANSIT_TIMING';

type LineType = 'IN_TRANSIT' | 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
type Bucket = 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

/** 每个场景断言：我造出了哪些差异行。 */
interface ScenarioExpectation {
  scenarioId: number;
  rootCause: RootCause;
  /** 绝大多数场景只产生一条；MISATTRIBUTED_FROM（记错客户）跨两个钱包，故是数组。 */
  expectedLines: Array<{
    walletRef: string;
    lineType: LineType;
    amount: string;
    externalRef: string | null;
    /**
     * 排他匹配键（可选，仅在同一钱包上多条期望可能共享同一
     * (matchStatus, walletRef, externalRef) 三元组时才需要真正钉行——
     * 展示位甲 ②③④ 就是这种情况：同一钱包同一天的 fakeBankRef 撞号，
     * 三条期望字面三元组完全相同，非排他匹配下会退化成同一句话问三遍
     * （2026-08-30 评审实证）。
     *
     * 取值 = reconciliationLineItem.internalSourceId（= account_flows.id）。
     * ⚠️ 不是 internalSourceNo——那一列**只有 IN_TRANSIT 行**才写
     * （wallet-recon-run.service.ts writeLineItems() 的 inTransit 循环），
     * AMOUNT_MISMATCH / ORPHAN_INTERNAL / ORPHAN_EXTERNAL 三类行恒为 null。
     *
     * ⚠️ 但 internalSourceId **只在 AMOUNT_MISMATCH / ORPHAN_INTERNAL 两类行上有值**
     * （已实跑核对：这两类逐行不同，可用作钉行键）。**ORPHAN_EXTERNAL 上它恒为 null**
     * ——writeLineItems() 的 orphanExternal 循环压根不写这个字段，结构上也说得通：
     * 外部孤儿按定义没有对应的内部流水，没有 id 可写。
     * **所以外部孤儿要钉行得用 externalTxId**（那个循环写的是它），别照抄这里。
     */
    internalSourceId?: string;
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
// cleaned on reset via clearStuckFixtureWithdraws, so this fixture alone never
// accumulates leg residue across reruns — that does NOT extend to the whole
// script: scenario ⑥'s duplicate-deposit injection below writes real TB
// ledger transfers that this lightweight reset does not undo, see that
// block's comment for why a full db reset is required after it has run.)
const DEMO_IN_TRANSIT_REF_PREFIX = 'DEMO-IT-';

/**
 * Delete the demo-fixture stuck WITHDRAWS scenario 1 leaves behind, so this
 * fixture alone never accumulates non-terminal payout legs across reruns
 * (→ no Pass3 mis-claim). Scoped to scenario 1's withdraw fixture only — it
 * does NOT make `recon:demo:reset && recon:demo:break` idempotent overall:
 * scenario ⑥'s duplicate-deposit injection (below, in the showcase-B block)
 * writes real TB ledger transfers that this lightweight reset never undoes.
 * After ⑥ has run once, a green rerun needs a full db reset
 * (`stack.sh reset`), not just `recon:demo:reset`.
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
 * scenario count (leg3 has no external line post-reset, so Pass3 can't claim it).
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
  // has its DEMO-STUCK-WD- external rows to read. This is what keeps THIS
  // fixture's legs from accumulating across reruns — it does not by itself
  // make reset && break idempotent overall; see clearStuckFixtureWithdraws'
  // docblock above for the ⑥ duplicate-deposit exception (real TB ledger
  // writes that a lightweight recon:demo:reset never undoes).
  const deletedStuck = await clearStuckFixtureWithdraws(prisma);
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
  const assetRows = (await (prisma as any).asset.findMany({ select: { code: true, network: true } })) as Array<{ code: string; network: string }>;
  const assetsByNetwork = new Map<string, Array<{ code: string }>>();
  for (const a of assetRows) {
    const list = assetsByNetwork.get(a.network) ?? [];
    list.push({ code: a.code });
    assetsByNetwork.set(a.network, list);
  }
  const allActiveWallets = (await (prisma as any).wallet.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, walletRole: true, ownerType: true, ownerNo: true, network: true },
  })) as Array<{ id: string; walletRole: string; ownerType: string; ownerNo: string | null; network: string }>;

  const plans: WalletPlan[] = [];
  for (const w of allActiveWallets) {
    // 一条网络上的每个资产各计划一行（今天每网络恰一个资产，将来上第二个 TRC-20 币这里自动多一行）
    for (const a of assetsByNetwork.get(w.network) ?? []) {
      const currency = a.code;
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

// ── Phase 3 (break only): inject the full break-scenario matrix ────────
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
  accounting: AccountingService,
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

  // 钱包分配按 specs/2026-09-01-recon-disposition-conclusion-design.md §5 显式指定。
  // 不再用轮转挑选：一个钱包挂哪些场景是设计决策，让遍历顺序决定它，等于
  // 演示内容随数据顺序漂移，而且展示位（同一钱包摆多条差异）根本没法安排。
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

  const slotShowcaseA     = planByOwnerAsset(GRACE_NO, 'AED');        // 展示位甲：金额不对 ②③④（三种成因，同一处置）
  const slotShowcaseB     = planByOwnerAsset(FRANK_NO, 'AED');        // 展示位乙：我有外无 ⑥⑦（机器佐证 vs 纯人判）
  const slotShowcaseC     = planByOwnerAsset(BOB_NO,   'USDT-TRON');  // ⑬ 漏监听充值（原展示位丙，⑨已删只剩单场景）
  const slotFeeNetted     = planByOwnerAsset(BOB_NO,   'AED');        // ⑤ 手续费轧差
  const slotReturn        = planByOwnerAsset(KATE_NO,  'AED');        // ⑭ 入金被退汇（B 批搬家：退汇只有法币；Alice USDT 位空出给二期场景 16）
  const slotPayoutReturn  = planByOwnerAsset(GRACE_NO, 'AED');        // ⑮ 出金被退回（叠展示位甲）
  const slotCutoff        = planByOwnerAsset(GRACE_NO, 'USDT-TRON');  // ⑨ 跨日切
  const slotMisroutedFrom = planByOwnerAsset(JACK_NO,  'AED');        // ⑧ 记错客户 · 发出端
  const slotMisroutedTo   = planByOwnerAsset(KATE_NO,  'AED');        // ⑧ 记错客户 · 接收端

  // ── FIRM wallet pick (scenarios ⑪⑫ — shared wallet, hedged pair) ──────
  // Exclude any FIRM wallet that is already the from/to side of a non-terminal
  // funds_order. This always includes scenario 1's OWN stuck withdraw created
  // just above: createStuckWithdraw drives a REAL 2-leg withdrawal, and leg 2
  // (the fee) lands on a FIRM wallet — e.g. E.INCOME_OTHER — and stays
  // non-terminal right alongside the stuck main leg, every single break run.
  // A pre-existing non-terminal withdrawal seeded by the business roster
  // (e.g. #20, "卡在半路（对账用）") trips the same check the same way.
  // Scenarios ⑪⑫ only inject ghost ORPHAN_EXTERNAL lines expecting a
  // SOFT_FLAG bucket — but a wallet that already carries a real non-terminal
  // funds order also produces an IN_TRANSIT line, and the engine correctly
  // reclassifies "orphan + in-transit on the same wallet" as BREAK. That
  // 排除已带非终态资金单的 FIRM 钱包。理由**不是**"场景之间要互不重叠"
  // （那个 disjoint 前提已于 2026-08-30 废除，一个钱包现在可以挂多条场景），
  // 而是另一条独立的轴：**业务数据污染场景**。
  // 场景 ⑪⑫ 只注入对冲的幽灵 ORPHAN_EXTERNAL 行、期望落在 SOFT_FLAG；但一个
  // 已经挂着真实非终态资金单的钱包会**额外**产生一条 IN_TRANSIT 行，引擎于是
  // （正确地）把"孤儿 + 在途同处一个钱包"重判成 BREAK —— 答案键期望 SOFT_FLAG，
  // 于是 #⑪/#⑫ 双双 MISSED，而引擎一点没错。
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
        ? 'Need ≥1 FIRM wallet for scenarios ⑪⑫ — seed firm-side activity.'
        : `All ${firmCandidatesAll.length} FIRM wallet(s) already carry a non-terminal funds order ` +
          `(e.g. an in-transit withdraw fee leg) — none left clean for scenarios ⑪⑫. Refusing to ` +
          `silently reuse a dirty wallet (it would mask #⑪/#⑫ as BREAK instead of SOFT_FLAG). Seed a ` +
          `FIRM wallet with crossing flows but no open funds_orders, or clear the stray non-terminal order.`,
    );
  }
  const firmHedgedPlan = firmCandidates[0];

  // 场景 ⑩ · 查无果（spec §5）：公司池一条外部行金额改 7 分 + 同步压收盘——
  // 「翻遍凭证也对不上」的小额差，答案键成因就是 UNEXPLAINED。放公司池是刻意的：
  // 下一轮核销上线时公司池核销 = 一笔分录进损益即结案，这条素材直接复用。
  const firmUnexplainedPlan = firmCandidates.find(
    (p) => p.walletRef !== firmHedgedPlan.walletRef && p.lines.length > 0,
  );
  if (!firmUnexplainedPlan) {
    throw new Error('场景 ⑩ 需要第二个带外部行的干净公司钱包——现有公司钱包要么被 ⑪⑫ 占用要么无流水。');
  }

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
    { walletRef: firmHedgedPlan.walletRef,    allowNonTerminal: false },
    { walletRef: firmUnexplainedPlan.walletRef, allowNonTerminal: false },
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

  // ── Scenario 5 — 手续费轧差 (BREAK / AMOUNT_MISMATCH) ───────────────────
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
      scenarioId: 5,
      rootCause: 'AMT_FEE_NETTED',
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
      scenarioIds: [5],
      expectedBucket: 'BREAK',
      bucketRationale: '银行扣费后才入账 → 外部金额 = 内部金额 − 手续费，收盘同步压低同额 → 残差 = 手续费 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 展示位乙 · 同样是「我有外无」，两种成因、一贵一贱的证据 ─────────────
  // ⑥ 重复入账     → 我方错 → 冲销（机器佐证：有据可查）
  // ⑦ 假信号入账   → 我方错 → 冲销（纯人判：无据可查）
  // ⑥ 的可辨识证据：它的孤儿行在**已匹配列表里有个同 ref 同额的双胞胎**
  // （银行报一笔、我方入两笔），⑦ 的孤儿没有。这是这一屏最值钱的对照。
  // 旧版这里还有第三条「银行漏报明细」——公理 1 下已删：它靠直接改外部收盘
  // 余额让场景成立，等于把外部数据当成可以由我们商榷/改动的东西，与
  // "外部资料是权威"矛盾。
  {
    const lines = (await (prisma as any).externalStatementLine.findMany({
      where: { subAccount: slotShowcaseB.walletRef },
      orderBy: { datetime: 'asc' },
      take: 2,
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null }>;
    if (lines.length < 2) {
      throw new Error(`展示位乙需要 ≥2 条外部行，实际 ${lines.length} 条（钱包 ${slotShowcaseB.walletRef}）`);
    }
    const [lDup, l8] = lines;

    // ⑦ 假信号入账：我方收到一个假的入账信号并入了账，银行那边根本没这笔
    await (prisma as any).externalStatementLine.delete({ where: { id: l8.id } });
    const s8Signed = l8.direction === 'IN' ? l8.amount.negated() : l8.amount;
    const s8Prev = await bumpClosing(slotShowcaseB, s8Signed);

    // ⑥ 我方重复入账：银行报了一笔（lDup 保留不动），我方账上再入一笔同 ref 的。
    // ⚠️ 固定 sourceNo 保证可重跑：TB 的 transfer id 是 (sourceType, sourceNo,
    // eventCode) 的确定性哈希，重跑时判为已存在直接跳过，不会二次入账。
    // ⚠️ recon:demo:reset **不回滚账本**（它只清外部数据与 WALLET_V1 的 run/case），
    // 彻底归零要走 stack.sh reset self（会重建 TigerBeetle）。
    const dupLedger = TB_LEDGERS[slotShowcaseB.currency === 'AED' ? 'AED' : 'USDT'];
    const owner = await (prisma as any).customerMain.findUnique({
      where: { customerNo: slotShowcaseB.ownerNo! }, select: { id: true },
    });
    if (!owner) throw new Error(`找不到展示位乙钱包的客户：${slotShowcaseB.ownerNo}`);
    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: dupLedger, ownerType: 'SYSTEM' });
    const suspenseId    = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: dupLedger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
    const payableId     = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: dupLedger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
    // 铁律⑥：展示位乙这一屏，⑦ 那一行的 sourceNo 是真实 DEP 号（原单据自带）；
    // ⑥ 是这里现造的，必须造成同样的 DEP 号形状，否则演示者要点开去开调账单
    // 的那一行会显示一个内嵌钱包 UUID 前缀的编造单号，与旁边那行对不上。
    // buildDeterministicNo 给的是确定性哈希（同一批 cutoffDate+walletRef 永远
    // 得到同一个号），满足上面 ⚠️ 的可重跑要求；日期段固定 260101，与
    // generateReferenceNo('DEP') 的真实调用日期（本仓库当下业务日在 2026-08
    // 之后）不会撞号。
    const dupSourceNo = buildDeterministicNo('DEP', cutoffDate, slotShowcaseB.walletRef);
    const dupAmount = BigInt(lDup.amount.toFixed(0));

    await accounting.executeTransfer({
      debitAccountId: clientAssetId, creditAccountId: suspenseId, amount: dupAmount, ledger: dupLedger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: dupSourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: slotShowcaseB.currency, traceId: dupSourceNo,
        actorType: 'SYSTEM', actorId: 'RECON_DEMO',
        memo: 'Demo duplicate deposit — bank reported ONE credit, our books took it twice',
        debitWalletRef: slotShowcaseB.walletRef, creditWalletRef: slotShowcaseB.walletRef,
        isExternalCrossing: true,           // 这一腿要参与流水匹配
        externalRef: lDup.externalRef,      // 与银行那条同 ref → 一笔匹配、一笔成孤儿
        effectiveDate: cutoffDate,
      },
    });
    await accounting.executeTransfer({
      debitAccountId: suspenseId, creditAccountId: payableId, amount: dupAmount, ledger: dupLedger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: dupSourceNo, eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: slotShowcaseB.currency, traceId: dupSourceNo,
        actorType: 'SYSTEM', actorId: 'RECON_DEMO',
        memo: 'Demo duplicate deposit (reclass)',
        debitWalletRef: slotShowcaseB.walletRef, creditWalletRef: slotShowcaseB.walletRef,
        isExternalCrossing: false,          // 纯账面重分类，不参与匹配
        effectiveDate: cutoffDate,
      },
    });

    // ⚠️⚠️ 排他钉行键——**不加这个，本任务交付的那一刻就把 Task 5 刚堵上的洞
    // 在 Frank 的钱包上原样重挖一遍**（2026-08-30 复审拿真实库数据实测：Frank
    // 的 AED 钱包三笔充值共用同一个 `externalRef = ZB20260830275C7FCE5B`，
    // 与 Grace 钱包完全相同的撞号前提）。⑥⑦ 两条的 (matchStatus, walletRef,
    // externalRef) 三元组字面相同，不钉行就会退化成"同一句话问两遍"：谁的注入
    // 被写坏都不会被发现，只要另外一条还活着，脚本照样全绿退出 0。
    // 见 Global Constraints 里那条 🔴，以及展示位甲 ②③④ 的写法。
    //
    // ⑦ 的键是确定的：它把自己的外部行删了，对应的内部流水直接变孤儿，
    // 取 planWallets 排出的同位置 sourceFlowId 即可（与上面 [lDup, l8] 同序）。
    const [, plB8] = slotShowcaseB.lines;
    //
    // ⑥ 不一样，**它是本批唯一一个键要反查的**：lDup 的外部行没删，而内部侧
    // 现在有两笔同 ref 的流水（原始那笔 + 我们刚造的这笔）。匹配器会配走一笔、
    // 剩一笔成孤儿——**成孤儿的应当是后造的这笔**（原始那笔 createdAt 更早）。
    // 所以键要按 dupSourceNo 把刚造的 account_flow 反查回来：
    //
    // ⚠️ 本地订正 #1：需求书原文这里写的是 `walletId: slotShowcaseB.walletRef`，
    // 但 AccountFlow 模型（prisma/schema.prisma）没有 walletId 字段，只有
    // walletRef（本文件 421 行、wallet-flow-matcher.service.ts 176 行等处的
    // accountFlow 查询全都用 walletRef）——按原文写会在这一行直接抛
    // PrismaClientValidationError，已改成 walletRef。
    //
    // ⚠️ 本地订正 #2（实跑发现，比订正 #1 更隐蔽）：光改 walletRef 还不够。
    // 上面两次 executeTransfer（STEP_1 ASSET_TO_SUSPENSE / STEP_2
    // SUSPENSE_TO_PAYABLE）用的是**同一个** sourceNo=dupSourceNo，且都把
    // debitWalletRef/creditWalletRef 设成了同一个 Frank 钱包——AccountFlowProjectorService
    // 每次 executeTransfer 落两行（借/贷各一行，walletRef 相同）。所以
    // `{ sourceNo: dupSourceNo, walletRef }` 这一查询条件其实会命中 **4 行**：
    // STEP_1 借（CLIENT_ASSET 聚合户,OUT,crossing=true）/ STEP_1 贷
    // （DEPOSIT_SUSPENSE,IN,crossing=true——这行才是我们要的)/ STEP_2 借
    // （DEPOSIT_SUSPENSE,OUT,crossing=false）/ STEP_2 贷（CLIENT_PAYABLE,IN,
    // crossing=false)。`orderBy: createdAt desc` 挑的是**最晚**写入的一行——
    // 而 STEP_2 在 STEP_1 之后落库，於是挑中的是 STEP_2 的某一行（crossing=
    // false）。匹配器的候选集固定过滤 isExternalCrossing=true（wallet-flow-
    // matcher.service.ts 176 行），STEP_2 两行永远不会出现在
    // reconciliation_line_items 里——钉的键指向一个匹配器压根看不见的流水，
    // ⑥ 因此**必定** MISSED，与"谁跟谁配对"的匹配器行为完全无关（实跑核对：
    // account_flows 里 sourceNo=dupSourceNo 的 4 行，isExternalCrossing=1
    // 的只有 STEP_1 那两行；不加 isExternalCrossing/direction 过滤，findFirst
    // 在这 4 行里挑到的确实是 STEP_2 的一行）。加 isExternalCrossing:true 还不够
    // 唯一（STEP_1 的借贷两行都是 crossing=true，createdAt 相同，谁在前不确定），
    // 需要再加 direction:'IN' 精确锁定 STEP_1 的贷方（DEPOSIT_SUSPENSE）那一行——
    // 即真正会被 planWallets/matcher 视为"这笔充值的内部证据"的那一行。
    const dupFlow = (await (prisma as any).accountFlow.findFirst({
      where: {
        sourceNo: dupSourceNo, walletRef: slotShowcaseB.walletRef,
        isExternalCrossing: true, direction: 'IN',
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })) as { id: string } | null;
    if (!dupFlow) throw new Error(`⑥ 反查不到刚造的重复入账流水：sourceNo=${dupSourceNo}`);
    // ⚠️ 如果 ⑥ 判了 MISSED 而 ⑦ 正常，**先别怀疑注入写坏了**——那说明匹配器
    // 把原始那笔当成了孤儿、把重复那笔配走了，即"谁跟外部行配对"和这里的假设
    // 相反。那是关于匹配器行为的真实发现，报上来，不要改成"两个 id 试一个"糊过去。

    scenarios.push({
      scenarioId: 6, rootCause: 'DUP_BOOKING',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef, lineType: 'ORPHAN_INTERNAL',
        amount: lDup.amount.toString(), externalRef: lDup.externalRef,
        internalSourceId: dupFlow.id,
      }],
      detail: { dupSourceNo, bankReportedTimes: 1, bookedTimes: 2, sharedExternalRef: lDup.externalRef },
    });
    scenarios.push({
      scenarioId: 7, rootCause: 'PHANTOM_BOOKING',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef, lineType: 'ORPHAN_INTERNAL',
        amount: l8.amount.toString(), externalRef: l8.externalRef,
        internalSourceId: plB8.sourceFlowId,
      }],
      detail: { deletedExternalLineId: l8.id, prevClosingBalance: s8Prev },
    });
    wallets.push({
      walletRef: slotShowcaseB.walletRef,
      scenarioIds: [6, 7],
      expectedBucket: 'BREAK',
      bucketRationale:
        '⑦ 删一条外部行并压低同额收盘（外部少一笔）；⑥ 内部多入一笔而外部不变。' +
        '两者都把「外部 − 内部」推向负 → 残差 ≠ 0 → BREAK。',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 展示位甲 · 三条金额差，同一种处置 ───────────────────────────────────
  // ② 小数点错位   我方把金额录错了 100 倍
  // ③ 我方少记     外部金额比我方记的多一个固定小额——注入杠杆与旧版相同，
  //                成因码统一收口为 AMT_MISBOOKED（旧版曾单独挂一个成因标签，
  //                本轮起并入「我方账错了」这一档，不再单独区分）
  // ④ 舍入精度差   双方计价精度不同造成的固定尾差
  // 三条构造杠杆各异，但公理 1 之下去处完全相同——外部资料是权威，我方账对不上
  // 就冲正，不需要先争「是谁的错」。这一点本身就是这一屏最想讲清楚的道理。
  {
    const lines = (await (prisma as any).externalStatementLine.findMany({
      where: { subAccount: slotShowcaseA.walletRef },
      orderBy: { datetime: 'asc' },
      take: 3,
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null }>;
    if (lines.length < 3) {
      throw new Error(
        `展示位甲需要 ≥3 条外部行，实际 ${lines.length} 条（钱包 ${slotShowcaseA.walletRef}）—— ` +
        '花名册给 Grace 的 AED 单是否被改少了？',
      );
    }

    // ② 小数点错位：我方把金额记成了 1/100（外部才是对的）→ 外部 − 内部 = +99×内部
    const [l2, l3, l4] = lines;

    // 排他匹配键（answer key 给机器用）+ 人读业务号（answer key 给人用）——
    // 「对外用业务键」是本项目不可违反规则之一，manifest.json 是业务同事对着
    // 屏幕核对的答案键，不能只挂 UUID。
    // slotShowcaseA.lines 是 planWallets 按 createdAt asc 排出的原始流水
    // （与上面按 datetime asc 取的三条外部行一一对应——writeMirror 逐条镜像、
    // 顺序不变），取其 sourceFlowId（= account_flows.id）作为排他匹配键；
    // 再查一次 account_flows.sourceNo 拿真实 DEP 号填进 detail。
    const [pl2, pl3, pl4] = slotShowcaseA.lines;
    const showcaseAFlows = (await (prisma as any).accountFlow.findMany({
      where: { id: { in: [pl2.sourceFlowId, pl3.sourceFlowId, pl4.sourceFlowId] } },
      select: { id: true, sourceNo: true },
    })) as Array<{ id: string; sourceNo: string }>;
    const depositNoOf = (flowId: string): string => {
      const f = showcaseAFlows.find((x) => x.id === flowId);
      if (!f) throw new Error(`展示位甲：account_flows 找不到 ${flowId} —— sourceFlowId 与外部行的顺序假设对不上`);
      return f.sourceNo;
    };

    const s2New = l2.amount.mul(100);
    await (prisma as any).externalStatementLine.update({ where: { id: l2.id }, data: { amount: s2New } });
    const s2Delta = s2New.minus(l2.amount);
    const s2Prev = await bumpClosing(slotShowcaseA, l2.direction === 'IN' ? s2Delta : s2Delta.negated());

    // ③ 我方少记：外部金额比我方记的多一个固定小额，我方账错了 → 冲正补齐
    const s3Delta = D('333');
    const s3New = l3.amount.plus(s3Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: l3.id }, data: { amount: s3New } });
    const s3Prev = await bumpClosing(slotShowcaseA, l3.direction === 'IN' ? s3Delta : s3Delta.negated());

    // ④ 舍入精度差：双方舍入规则不同造成的固定尾差——精度虽小，公理 1 下仍需冲正
    const s4Delta = D('2');
    const s4New = l4.amount.plus(s4Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: l4.id }, data: { amount: s4New } });
    const s4Prev = await bumpClosing(slotShowcaseA, l4.direction === 'IN' ? s4Delta : s4Delta.negated());

    scenarios.push({
      scenarioId: 2,
      rootCause: 'AMT_MISBOOKED',
      expectedLines: [{
        walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s2New.toString(),
        externalRef: l2.externalRef, internalSourceId: pl2.sourceFlowId,
      }],
      detail: {
        lineId: l2.id, internalAmount: l2.amount.toString(), externalAmount: s2New.toString(),
        prevClosingBalance: s2Prev, depositNo: depositNoOf(pl2.sourceFlowId),
      },
    });
    scenarios.push({
      scenarioId: 3,
      rootCause: 'AMT_MISBOOKED',
      expectedLines: [{
        walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s3New.toString(),
        externalRef: l3.externalRef, internalSourceId: pl3.sourceFlowId,
      }],
      detail: {
        lineId: l3.id, internalAmount: l3.amount.toString(), externalAmount: s3New.toString(),
        prevClosingBalance: s3Prev, depositNo: depositNoOf(pl3.sourceFlowId),
      },
    });
    scenarios.push({
      scenarioId: 4,
      rootCause: 'AMT_ROUNDING',
      expectedLines: [{
        walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s4New.toString(),
        externalRef: l4.externalRef, internalSourceId: pl4.sourceFlowId,
      }],
      detail: {
        lineId: l4.id, internalAmount: l4.amount.toString(), externalAmount: s4New.toString(),
        prevClosingBalance: s4Prev, depositNo: depositNoOf(pl4.sourceFlowId),
      },
    });
    wallets.push({
      walletRef: slotShowcaseA.walletRef,
      scenarioIds: [2, 3, 4, 15],
      expectedBucket: 'BREAK',
      bucketRationale:
        '三条金额差同时存在：② 外部−内部 = 99×原额、③ +333、④ +2（方向按各自行的 IN/OUT 计入收盘）。' +
        '三者之和恒 ≠ 0（② 一项就远大于其余两项之和），且无在途 → 残差 ≠ 0 → BREAK。' +
        '；⑮ 再加一条 IN 幽灵行并抬高同额收盘（900 AED 出款退回），残差仍 ≠ 0 → BREAK',
    hasNonTerminalFundsOrder: false,
    });
  }

  // ── Scenario 10 — 查无果 (BREAK / AMOUNT_MISMATCH / 公司池) ─────────────
  {
    const line = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: firmUnexplainedPlan.walletRef, amount: { gt: 7 } },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; direction: string; externalRef: string | null } | null;
    if (!line) throw new Error(`场景 10 需要钱包 ${firmUnexplainedPlan.currency}/coa=${firmUnexplainedPlan.coaCode} 至少一条金额 > 7 分的外部行`);
    const s10Delta = D('-7'); // 外部比内部少 7 分——差额无规律、查无可查
    const newAmount = line.amount.plus(s10Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: line.id }, data: { amount: newAmount } });
    const signed = line.direction === 'IN' ? s10Delta : s10Delta.negated();
    const prevClose = await bumpClosing(firmUnexplainedPlan, signed);
    scenarios.push({
      scenarioId: 10, rootCause: 'UNEXPLAINED',
      expectedLines: [{
        walletRef: firmUnexplainedPlan.walletRef, lineType: 'AMOUNT_MISMATCH',
        amount: newAmount.toString(), externalRef: line.externalRef,
      }],
      detail: { lineId: line.id, internalAmount: line.amount.toString(), externalAmount: newAmount.toString(), prevClosingBalance: prevClose },
    });
    wallets.push({
      walletRef: firmUnexplainedPlan.walletRef, scenarioIds: [10], expectedBucket: 'BREAK',
      bucketRationale: '一条外部行金额 −7 分并压低同额收盘 → 残差 = −7 ≠ 0 → BREAK。成因查无果，处置 = 挂起·调查中 → 账龄到线（⚡拨钟）→ 公司池小额核销（金库开单、CFO 批）→ 重对账自愈。',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑪ — 银行杂费 (SOFT_FLAG，与场景 ⑫ 银行利息对冲，共用同一个公司钱包) ───
  // Insert a ghost OUT line (bank charge) on the shared FIRM wallet, closing
  // moves down. Scenario 12 inserts an equal-amount IN (bank interest) that
  // exactly cancels this on closing, so the wallet's net delta stays 0
  // (SOFT_FLAG) while both lines individually show up as orphanExternal.
  const firmHedgedAmount = D('200');
  {
    const fakeRef = refFor(firmHedgedPlan.currency, 'CHARGE');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(firmHedgedPlan.currency),
        accountRef: firmHedgedPlan.walletRef,
        subAccount: firmHedgedPlan.walletRef,
        book: firmHedgedPlan.book,
        currency: firmHedgedPlan.currency,
        direction: 'OUT',
        amount: firmHedgedAmount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo bank charge (ghost OUT, hedged by scenario 12 bank interest)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${firmHedgedPlan.walletRef}-s11-bank-charge`,
      },
    });
    const prevClose = await bumpClosing(firmHedgedPlan, firmHedgedAmount.negated());
    scenarios.push({
      scenarioId: 11,
      rootCause: 'BANK_CHARGE_UNBOOKED',
      expectedLines: [{
        walletRef: firmHedgedPlan.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: firmHedgedAmount.toString(),
        externalRef: fakeRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        direction: 'OUT',
        prevClosingBalance: prevClose,
        closingBalanceDelta: firmHedgedAmount.negated().toString(),
        pairedWithScenario: 12,
      },
    });
    // 场景 11+12 共用一个 FIRM 钱包（对冲对）——桶断言只在场景 12 那段推一次，见下方。
  }

  // ── 场景 ⑬ — 充值漏监听 (BREAK / ORPHAN_EXTERNAL) ───────────────────────
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
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotShowcaseC.walletRef}-s13-missed-deposit`,
      },
    });
    const prevClose = await bumpClosing(slotShowcaseC, s6Amount);
    scenarios.push({
      scenarioId: 13,
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
      scenarioIds: [13],
      expectedBucket: 'BREAK',
      bucketRationale: '加一条幽灵 IN 行并抬高同额收盘 → 残差 = +该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── ⑨ 跨日切 (SOFT_FLAG / ORPHAN_INTERNAL / 客户账簿) ────────────────────
  // 对方按它的营业日切账、我方按 UTC：一笔真实发生的流水落在了对方的下一个
  // 营业日，本期对账单上没有它。→ 我方有、外部本期没有。
  //
  // ⚠️ **这是唯一不碰收盘的场景**：收盘是对方给的一个数、本来就含这笔；
  // 变的只是这笔出现在哪一期的明细里。于是 **余额分毫不差、流水配不上**
  // → 残差 0 + 异常 1 + 无在途 → SOFT_FLAG。
  // 这一条是"只看余额会漏掉什么"的活教材：只对余额的话，这个钱包会被判成
  // 完全正常，而实际上有一笔流水两边对不上。
  //
  // 杠杆：把该行的 datetime 挪到截止点之后。引擎取外部行的条件是
  // `datetime <= cutoff`（wallet-recon-run.service.ts fetchExternalLinesForWallet），
  // 故这条行本期不参与匹配；externalBalance 按 cutoffDate 取，不受影响。
  {
    const straddle = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotCutoff.walletRef },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; externalRef: string | null } | null;
    if (!straddle) {
      throw new Error(
        `⑨ 跨日切需要 ≥1 条外部行（钱包 ${slotCutoff.walletRef}）—— ` +
        '花名册给 Grace 的 USDT 素材单（seq 22/23）是否还在？',
      );
    }
    const shifted = new Date(cutoff.getTime() + 6 * 60 * 60 * 1000);   // 截止点之后 6 小时
    await (prisma as any).externalStatementLine.update({
      where: { id: straddle.id },
      data: {
        datetime: shifted,
        description: 'Demo cutoff straddle — landed in the counterparty\'s NEXT business day',
      },
    });
    scenarios.push({
      scenarioId: 9,
      rootCause: 'CUTOFF_STRADDLE',
      expectedLines: [{ walletRef: slotCutoff.walletRef, lineType: 'ORPHAN_INTERNAL', amount: straddle.amount.toString(), externalRef: straddle.externalRef }],
      detail: { shiftedLineId: straddle.id, shiftedTo: shifted.toISOString(), closingBalanceUntouched: true },
    });
    wallets.push({
      walletRef: slotCutoff.walletRef,
      scenarioIds: [9],
      expectedBucket: 'SOFT_FLAG',
      bucketRationale:
        '只挪了一条外部行的时间、**收盘一分没动** → 余额差 = 0；该行本期不参与匹配 → 它的内部对手成孤儿 → 异常数 1；' +
        '无在途 → 命中「残差 0 且无在途 且 流水异常 > 0 → SOFT_FLAG」。',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── ⑧ 记错客户 (BREAK ×2 / 跨两个钱包) ──────────────────────────────────
  // 一笔本该记到 Jack 账上的钱，被记到了 Kate 账上。
  //   发出端（Jack）：我方账上有、对账单上没有 → 我有外无
  //   接收端（Kate）：对账单上有、我方账上没有 → 外有我无
  // 一个成因、两个案子——这是 15 条里唯一跨钱包的，答案键里两条 expectedLines
  // 指向不同的 walletRef，但共用同一个 scenarioId。
  {
    const moved = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotMisroutedFrom.walletRef, direction: 'IN' },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; externalRef: string | null } | null;
    if (!moved) {
      throw new Error(
        `⑧ 记错客户需要发出端有 ≥1 条 IN 方向外部行（钱包 ${slotMisroutedFrom.walletRef}）—— ` +
        '花名册给 Jack 的 AED 素材单（seq 24/25）是否还在？',
      );
    }

    // 发出端：删掉那条行 + 压低同额收盘
    await (prisma as any).externalStatementLine.delete({ where: { id: moved.id } });
    const fromPrev = await bumpClosing(slotMisroutedFrom, moved.amount.negated());

    // 接收端：同一笔钱出现在别的客户账上 + 抬高同额收盘
    const toRef = refFor(slotMisroutedTo.currency, 'MISROUTED');
    const toCreated = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotMisroutedTo.currency),
        accountRef: slotMisroutedTo.walletRef,
        subAccount: slotMisroutedTo.walletRef,
        book: slotMisroutedTo.book,
        currency: slotMisroutedTo.currency,
        direction: 'IN',
        amount: moved.amount,
        externalRef: toRef,
        datetime: cutoff,
        description: 'Demo misrouted credit — this belongs to another customer',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotMisroutedTo.walletRef}-s8-misattributed`,
      },
    });
    const toPrev = await bumpClosing(slotMisroutedTo, moved.amount);

    scenarios.push({
      scenarioId: 8,
      rootCause: 'MISATTRIBUTED_FROM',
      expectedLines: [
        { walletRef: slotMisroutedFrom.walletRef, lineType: 'ORPHAN_INTERNAL', amount: moved.amount.toString(), externalRef: moved.externalRef },
        { walletRef: slotMisroutedTo.walletRef,   lineType: 'ORPHAN_EXTERNAL', amount: moved.amount.toString(), externalRef: toRef },
      ],
      detail: {
        deletedFromLineId: moved.id,
        insertedToLineId: toCreated.id,
        fromPrevClosingBalance: fromPrev,
        toPrevClosingBalance: toPrev,
        note: '一个成因两个案子：发出端我有外无（MISATTRIBUTED_FROM）、接收端外有我无（对端成因是 MISATTRIBUTED_TO）',
      },
    });
    wallets.push({
      walletRef: slotMisroutedFrom.walletRef,
      scenarioIds: [8],
      expectedBucket: 'BREAK',
      bucketRationale: '发出端：删掉一条 IN 行并压低同额收盘 → 残差 = −该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
    wallets.push({
      walletRef: slotMisroutedTo.walletRef,
      scenarioIds: [8, 14],
      expectedBucket: 'BREAK',
      bucketRationale: '接收端：加一条 IN 幽灵行并抬高同额收盘 → 残差 = +该行金额 ≠ 0 → BREAK' +
        '；⑭ 再加一条 OUT 幽灵行并压低同额收盘（1200 AED 退汇），残差仍 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑫ — 银行利息 (SOFT_FLAG，与场景 ⑪ 银行杂费对冲，共用同一个公司钱包) ───
  // Same FIRM wallet as scenario 11, same amount, opposite direction (IN).
  // Nets scenario 11's OUT to a 0 closing delta ⇒ same wallet, same case,
  // bucket=SOFT_FLAG (balance ties, but 2 orphaned lines expose the wash).
  {
    const fakeRef = refFor(firmHedgedPlan.currency, 'INTEREST');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(firmHedgedPlan.currency),
        accountRef: firmHedgedPlan.walletRef,
        subAccount: firmHedgedPlan.walletRef,
        book: firmHedgedPlan.book,
        currency: firmHedgedPlan.currency,
        direction: 'IN',
        amount: firmHedgedAmount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo bank interest (ghost IN, hedges scenario 11 bank charge)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${firmHedgedPlan.walletRef}-s12-bank-interest`,
      },
    });
    const prevClose = await bumpClosing(firmHedgedPlan, firmHedgedAmount);
    scenarios.push({
      scenarioId: 12,
      rootCause: 'BANK_INTEREST_UNBOOKED',
      expectedLines: [{
        walletRef: firmHedgedPlan.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: firmHedgedAmount.toString(),
        externalRef: fakeRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: firmHedgedAmount.toString(),
        pairedWithScenario: 11,
      },
    });
    wallets.push({
      walletRef: firmHedgedPlan.walletRef,
      scenarioIds: [11, 12],
      expectedBucket: 'SOFT_FLAG',
      bucketRationale: '杂费 −X 与利息 +X 金额相等方向相反 → 残差 = 0；两条孤儿外部行 → 异常数 2 > 0 → SOFT_FLAG',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑭ — 入金被退汇 (BREAK / ORPHAN_EXTERNAL / 客户账簿 / 法币) ──────────
  // 银行把一笔已经入账的钱扣了回去：账单上多一条 OUT，我方账上那笔充值仍在 → 外有我无 + 余额差。
  // B 批（2026-09-03）搬到 Kate AED：退汇只有法币；原单必须是一笔真实 SUCCESS 充值（花名册 #28，1200 AED），
  // 认领时候选靠「同钱包 · SUCCESS · 同金额」找它，所以这里先断言它在。叠在改记接收端钱包上（一案两行）。
  {
    const s14Amount = D('120000');   // 分 —— 1200.00 AED = 花名册 #28
    const original = await (prisma as any).depositTransaction.findFirst({
      where: { toWalletId: slotReturn.walletRef, status: 'SUCCESS', amount: new Prisma.Decimal('1200') },
    });
    if (!original) throw new Error('场景 14 需要 Kate 有一笔 SUCCESS 的 1200 AED 充值（花名册 #28）—— demo:all 是否跑过？花名册 #28 是否改了？');
    const outRef = refFor(slotReturn.currency, 'CLAWBACK');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotReturn.currency), accountRef: slotReturn.walletRef, subAccount: slotReturn.walletRef,
        book: slotReturn.book, currency: slotReturn.currency, direction: 'OUT', amount: s14Amount, externalRef: outRef,
        channelRef: original.referenceNo ?? null, datetime: cutoff,
        description: 'Demo bank return — a previously credited deposit was clawed back',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotReturn.walletRef}-s14-bounced`,
      },
    });
    const prevClose = await bumpClosing(slotReturn, s14Amount.negated());
    scenarios.push({
      scenarioId: 14, rootCause: 'BOUNCED_FUNDS',
      expectedLines: [{ walletRef: slotReturn.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: s14Amount.toString(), externalRef: outRef }],
      detail: { insertedExternalLineId: created.id, originalDepositNo: original.depositNo, prevClosingBalance: prevClose, closingBalanceDelta: s14Amount.negated().toString() },
    });
  }

  // ── 场景 ⑮ — 出金被退回 (BREAK / ORPHAN_EXTERNAL / 客户账簿 / 法币) ──────────
  // 一笔已经成功出款的提现，几天后被银行原路退回：账单上多一条 IN、带原出款关联号，我方账上那笔提现仍是 SUCCESS。
  // 原单 = 花名册 #16（Grace AED 提现成功，花名册记的 900 是税前 amount）。叠进展示位甲（一案四行）。
  // ⚠️ 用 amount=900 钉行（花名册字面量、不随手续费漂移），但外部真正过账、日后会被退回的
  // 是 netAmount（付款腿 isExternalCrossing=true 用的就是它，见 withdraw-workflow.service.ts
  // 的 payout principal leg）——两者因 2 AED 提现手续费而不相等，s15Amount 必须从 original
  // 现读取 netAmount 换算，不能对着花名册的 900 硬编（那是税前数，会查不到行）。
  {
    const original = await (prisma as any).withdrawTransaction.findFirst({
      where: { fromWalletId: slotPayoutReturn.walletRef, status: 'SUCCESS', amount: new Prisma.Decimal('900') },
    });
    if (!original) throw new Error('场景 15 需要 Grace 有一笔 SUCCESS 的 900 AED 提现（花名册 #16）—— demo:all 是否跑过？花名册 #16 是否改了？');
    const s15Amount = D(original.netAmount).mul(100);   // 分 —— netAmount(AED) → 外部对账单口径
    const inRef = refFor(slotPayoutReturn.currency, 'PAYOUTRET');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotPayoutReturn.currency), accountRef: slotPayoutReturn.walletRef, subAccount: slotPayoutReturn.walletRef,
        book: slotPayoutReturn.book, currency: slotPayoutReturn.currency, direction: 'IN', amount: s15Amount, externalRef: inRef,
        channelRef: original.withdrawNo, datetime: cutoff,
        description: 'Demo bank return — a completed payout bounced back (Return)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotPayoutReturn.walletRef}-s15-payout-returned`,
      },
    });
    const prevClose = await bumpClosing(slotPayoutReturn, s15Amount);
    scenarios.push({
      scenarioId: 15, rootCause: 'PAYOUT_RETURNED',
      expectedLines: [{ walletRef: slotPayoutReturn.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: s15Amount.toString(), externalRef: inRef }],
      detail: { insertedExternalLineId: created.id, originalWithdrawNo: original.withdrawNo, prevClosingBalance: prevClose, closingBalanceDelta: s15Amount.toString() },
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
      internalSourceId: true,
    },
  })) as Array<{
    matchStatus: string;
    walletRef: string | null;
    externalRef: string | null;
    internalSourceNo: string | null;
    internalSourceId: string | null;
  }>;

  const cases = (await (prisma as any).reconciliationCase.findMany({
    where: { openedByRunId: runId },
    select: { caseNo: true, walletRef: true, bucket: true },
  })) as Array<{ caseNo: string; walletRef: string | null; bucket: string | null }>;

  // ── 按场景 ──
  // 排他匹配：同一条 lineItem 不能同时为两条期望作证。用一个可变副本，命中
  // 即从池子里摘除，保证每条真实行只用一次——2026-08-30 评审实证：展示位甲
  // ②③④ 三条期望的 (matchStatus, walletRef, externalRef) 三元组字面完全相同
  // （同一钱包同一天的 fakeBankRef 撞号），非排他匹配下三条断言在数学上退化
  // 成同一句话问三遍——谁的注入被弄坏都不会被发现，只要另外两条还活着。
  // internalSourceId 可选谓词是钉行的关键（见 ScenarioExpectation 类型注释）：
  // 三条的三元组虽然相同，但各自的 internalSourceId 不同，谁的行被破坏，
  // claim() 就会精确地在那一条上落空，而不是三条里随便哪条落空。
  const unclaimed = [...lineItems];
  const claim = (exp: ScenarioExpectation['expectedLines'][number]): boolean => {
    const idx = unclaimed.findIndex(
      (l) => l.matchStatus === exp.lineType
        && l.walletRef === exp.walletRef
        && (exp.externalRef ? l.externalRef === exp.externalRef : true)
        && (exp.internalSourceId ? l.internalSourceId === exp.internalSourceId : true),
    );
    if (idx === -1) return false;
    unclaimed.splice(idx, 1);
    return true;
  };

  const scenariosMissed: string[] = [];
  let scenariosDetected = 0;
  for (const sc of manifest.scenarios) {
    const allLinesHit = sc.expectedLines.every((exp) => claim(exp));
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

  // Phase 3 (break only) — inject the full break-scenario matrix + write manifest.
  //
  // Scenario 1 now drives a REAL stuck withdraw whose external OUT line is
  // stamped `datetime = leg.createdAt` — created *inside* injectScenarios, i.e.
  // AFTER the top-of-main cutoff. The engine's fetchExternalLinesForWallet
  // filters `datetime <= cutoff`, so we must run the engine on a cutoff that is
  // ≥ every fixture line's timestamp. Re-capture `engineCutoff` right after
  // injection (same business day → ExternalBalance cutoffDate still matches;
  // every scenario other than #1 has its lines stamped at the earlier cutoff,
  // still ≤ engineCutoff — don't hardcode the scenario count here, it grows).
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
    manifest = await injectScenarios(prisma, plans, cutoff, ctx, app.get(AccountingService));
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
      // 堵"多报"：wallets 断言只查每个被注入钱包的桶对不对，从不检查引擎有没有
      // 在**没被注入**的干净钱包上凭空开案——那种案子不属于任何 manifest 条目，
      // 不会出现在 walletsMismatched 里，今天零覆盖。casesOpened 是本轮开的案件
      // 总数，必须恰好等于被注入钱包数：多了就是有干净钱包被错误地判成了 BREAK。
      [`casesOpened ${result.casesOpened}/${manifest.wallets.length}`, result.casesOpened === manifest.wallets.length],
      ['identities OK', idn.ok],
    ];
    // ⚠️ 循环变量必须叫 `pass`、不能叫 `ok` —— 外层有个 `let ok = true`，收尾的
    // `process.exit(ok ? 0 : 1)` 读的就是它；用 `ok` 当循环变量会把它遮蔽掉，断言失败传不出去。
    // pass 分支早就是这么避开的，照抄它。同理**不要用 `process.exitCode = 1`**——
    // 收尾那句显式 `process.exit(0)` 会覆盖它，失败照样退 0。
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

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
//   --mode=break   Pass-mode setup, then inject 9 scenarios (one MVP root
//                  cause each — see Task 10 spec) and write `manifest.json`
//                  (the answer key). The engine should classify every
//                  scenario's wallet into its expected bucket
//                  (IN_TRANSIT / SOFT_FLAG / BREAK) and produce a matching
//                  line item of the expected matchStatus.
//                    1. IN_TRANSIT_TIMING     — real non-terminal FundsOrder
//                    2. FEE_NETTED            — AMOUNT_MISMATCH (BREAK)
//                    3. STATEMENT_MISSING_LINE— ORPHAN_INTERNAL (BREAK)
//                    4. SCALE_ERROR           — AMOUNT_MISMATCH (BREAK)
//                    5. BANK_CHARGE           — ORPHAN_EXTERNAL (SOFT_FLAG, paired w/ 7)
//                    6. MISSED_DEPOSIT        — ORPHAN_EXTERNAL (BREAK)
//                    7. BANK_INTEREST         — ORPHAN_EXTERNAL (SOFT_FLAG, paired w/ 5)
//                    8. BANK_RETURN           — ORPHAN_EXTERNAL (BREAK)
//                    9. ORPHAN_DEPOSIT        — ORPHAN_EXTERNAL (BREAK, unattributed head)
//                  Each scenario targets its own wallet (5+7 deliberately
//                  share one FIRM wallet — a hedged pair) so cases stay
//                  disjoint and per-scenario checks are independent.
//
//   --mode=reset   Delete WALLET_V1 runs/cases + all ExternalBalance /
//                  ExternalStatementLine rows + demo-tagged FundsOrder rows.
//                  Demo:all business data is left untouched.
//
// Anchor-free: every walletRef / asset / amount comes from the *current*
// account_flows snapshot. The script will work on any seeded dataset; the
// only requirement is ≥6 distinct CUSTOMER wallets + ≥1 FIRM wallet with
// isExternalCrossing flows so each scenario can land on its own wallet.
//
// Run:
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=pass
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=break
//   npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=reset

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

// ── Manifest v2 types ────────────────────────────────────────────────────
// 9-scenario model: each scenario reproduces one MVP root cause of a wallet
// reconciliation break, mapped onto the engine's three buckets
// (IN_TRANSIT / SOFT_FLAG / BREAK — MATCHED is never injected). See Task 10
// spec table for the full scenario → injection → expected-bucket mapping.
interface InjectionV2 {
  scenarioId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  rootCause:
    | 'IN_TRANSIT_TIMING'
    | 'FEE_NETTED'
    | 'STATEMENT_MISSING_LINE'
    | 'SCALE_ERROR'
    | 'BANK_CHARGE'
    | 'MISSED_DEPOSIT'
    | 'BANK_INTEREST'
    | 'BANK_RETURN'
    | 'ORPHAN_DEPOSIT';
  walletRef: string;            // scenario 9 uses the accountRef value as a stand-in
  expectedBucket: 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';
  // null only for scenario 9: T5's unattributedBalances branch (walletRef
  // in ExternalBalance is null) deliberately skips both engines — see
  // wallet-recon-run.service.ts §2c ("no internal face to compare against,
  // so neither engine runs") — so no line item is ever produced for an
  // orphan head. The case (bucket=BREAK, deltaAmount=closing) is the only
  // signal; verifyManifest checks the case alone for this scenario.
  expectedLineType: 'IN_TRANSIT' | 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL' | null;
  amount: string;
  externalRef: string | null;
  fundsOrderNo?: string;        // scenario 1 only
  detail: Record<string, unknown>;
}

interface ManifestV2 {
  cutoff: string;
  injections: InjectionV2[];
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
// Scenario 9's orphan external head/line use this fixed accountRef.
const DEMO_ORPHAN_ACCOUNT_REF = 'DEMO-ORPHAN-ADDR';

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

// ── Phase 3 (break only): inject 9 scenarios — one MVP root cause each ──
//
// Each scenario lands on its own wallet (scenario 5+7 deliberately share one
// FIRM wallet — see below) so cases stay disjoint and per-scenario checks
// are independent.
//
// Scenario 1 (canon2 T5) no longer synthesises a shell funds_order — it drives
// a REAL stuck withdraw via the shared `createStuckWithdraw` fixture (same path
// as demo:in-transit), which lands on a demo customer's C_VIBAN. That wallet is
// determined by the fixture (not the round-robin), so we run it FIRST, then
// exclude its walletRef from the CUSTOMER pool and round-robin the remaining
// 5 wallets across scenarios 2/3/4/6/8. FIRM wallet (scenarios 5+7) unchanged.
async function injectScenarios(
  prisma: PrismaService,
  plans: WalletPlan[],
  cutoff: Date,
  ctx: StuckFixtureCtx,
): Promise<ManifestV2> {
  if (plans.length === 0) throw new Error('No eligible wallets — seed business data first');
  const cutoffDate = ymd(cutoff);

  // ── Scenario 1 FIRST — real stuck withdraw on a demo customer's C_VIBAN ──
  // Runs before the round-robin so its (fixture-chosen) wallet can be excluded
  // from the scenarios-2/3/4/6/8 pool. Uses the AED (fiat) leg, which parks at
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

  // ── CUSTOMER wallet picks (scenarios 2/3/4/6/8) — exclude scenario 1's ──
  const candidateWallets: WalletPlan[] = [];
  for (const p of [...plans].sort((a, b) => a.walletRef.localeCompare(b.walletRef))) {
    if (p.walletKind !== 'CUSTOMER') continue;
    if (p.lines.length === 0) continue;
    if (p.walletRef === stuck.walletRef) continue; // reserved for scenario 1
    candidateWallets.push(p);
  }
  if (candidateWallets.length < 5) {
    throw new Error(
      `Need ≥5 customer wallets (besides scenario 1's) with crossing flows for ` +
      `scenarios 2/3/4/6/8; got ${candidateWallets.length}. Seed more deposit/withdraw activity.`,
    );
  }
  // Round-robin across (currency, ownerNo) tuples so picks are maximally
  // diverse — avoids stacking multiple scenarios on the same wallet.
  const buckets = new Map<string, WalletPlan[]>();
  for (const p of candidateWallets) {
    const key = `${p.currency}|${p.ownerNo}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p);
  }
  const bucketKeys = Array.from(buckets.keys()).sort();
  const picks: WalletPlan[] = [];
  let cursor = 0;
  while (picks.length < 5) {
    let advanced = false;
    for (let i = 0; i < bucketKeys.length && picks.length < 5; i++) {
      const key = bucketKeys[(cursor + i) % bucketKeys.length];
      const arr = buckets.get(key)!;
      if (arr.length > 0) {
        picks.push(arr.shift()!);
        advanced = true;
      }
    }
    cursor += 1;
    if (!advanced) break;
  }
  if (picks.length < 5) {
    throw new Error(`Could only pick ${picks.length}/5 distinct customer wallets (besides scenario 1's)`);
  }
  const [s2Plan, s3Plan, s4Plan, s6Plan, s8Plan] = picks;

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
  // silently fails #5/#7 without the engine being wrong — it breaks the
  // disjoint-wallet premise this whole generator depends on (see file-header
  // comment). Same TERMINAL_STATUSES the engine's own Pass 3 (in-transit
  // matching) treats as "still open".
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

  const injections: InjectionV2[] = [];

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
  // The withdraw was already created above (before the round-robin) via the
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
    injections.push({
      scenarioId: 1,
      rootCause: 'IN_TRANSIT_TIMING',
      walletRef: stuck.walletRef,
      expectedBucket: 'IN_TRANSIT',
      expectedLineType: 'IN_TRANSIT',
      amount: inTransitMinor,
      externalRef: stuck.externalRef,
      fundsOrderNo: stuck.fundsOrderNo,
      detail: {
        withdrawNo: stuck.withdrawNo,
        fundsOrderId: stuck.fundsOrderId,
        fundsOrderNo: stuck.fundsOrderNo,
        note: 'real non-terminal payout leg (SUBMITTED) — external −分 OUT line claimed in-transit by Pass3',
      },
    });
  }

  // ── Scenario 2 — 手续费差额 (BREAK / AMOUNT_MISMATCH) ───────────────────
  // Bank nets a fee out of the deposit before crediting — same externalRef,
  // amount = internal − fee. Bump closing by the same negative delta so the
  // wallet's balance check also breaks (not just the line item).
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: s2Plan.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on ${s2Plan.walletRef}`);
    const fee = D('97');
    const newAmount = candidate.amount.minus(fee);
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    const signedDelta = candidate.direction === 'IN' ? fee.negated() : fee;
    const prevClose = await bumpClosing(s2Plan, signedDelta);
    injections.push({
      scenarioId: 2,
      rootCause: 'FEE_NETTED',
      walletRef: s2Plan.walletRef,
      expectedBucket: 'BREAK',
      expectedLineType: 'AMOUNT_MISMATCH',
      amount: fee.toString(),
      externalRef: candidate.externalRef,
      detail: {
        externalLineId: candidate.id,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
  }

  // ── Scenario 3 — 对账单缺行 (BREAK / ORPHAN_INTERNAL) ───────────────────
  // Bank never reported one credit/debit. Delete the mirrored line AND
  // shrink external closingBalance by that line's amount.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: s3Plan.walletRef },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line to delete on ${s3Plan.walletRef}`);
    await (prisma as any).externalStatementLine.delete({ where: { id: candidate.id } });
    const signedDelta = candidate.direction === 'IN'
      ? candidate.amount.negated()
      : candidate.amount;
    const prevClose = await bumpClosing(s3Plan, signedDelta);
    injections.push({
      scenarioId: 3,
      rootCause: 'STATEMENT_MISSING_LINE',
      walletRef: s3Plan.walletRef,
      expectedBucket: 'BREAK',
      expectedLineType: 'ORPHAN_INTERNAL',
      amount: candidate.amount.toString(),
      externalRef: candidate.externalRef,
      detail: {
        deletedExternalLineId: candidate.id,
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
  }

  // ── Scenario 4 — 精度/单位错 (BREAK / AMOUNT_MISMATCH) ──────────────────
  // Bank posts the line with a scale error (×100 — e.g. cents-vs-units bug).
  // Bump closing by the same delta so the balance check breaks too.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: s4Plan.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on ${s4Plan.walletRef}`);
    const newAmount = candidate.amount.times(100);
    const scaleDelta = newAmount.minus(candidate.amount);
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    const signedDelta = candidate.direction === 'IN' ? scaleDelta : scaleDelta.negated();
    const prevClose = await bumpClosing(s4Plan, signedDelta);
    injections.push({
      scenarioId: 4,
      rootCause: 'SCALE_ERROR',
      walletRef: s4Plan.walletRef,
      expectedBucket: 'BREAK',
      expectedLineType: 'AMOUNT_MISMATCH',
      amount: scaleDelta.toString(),
      externalRef: candidate.externalRef,
      detail: {
        externalLineId: candidate.id,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
  }

  // ── Scenario 5 — 银行杂费 (SOFT_FLAG, paired with scenario 7) ───────────
  // Insert a ghost OUT line (bank charge) on the shared FIRM wallet, closing
  // moves down. Scenario 7 inserts an equal-amount IN (bank interest) that
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
        description: 'Demo bank charge (ghost OUT, hedged by scenario 7 bank interest)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s5s7Plan.walletRef}-s5-bank-charge`,
      },
    });
    const prevClose = await bumpClosing(s5s7Plan, s5s7Amount.negated());
    injections.push({
      scenarioId: 5,
      rootCause: 'BANK_CHARGE',
      walletRef: s5s7Plan.walletRef,
      expectedBucket: 'SOFT_FLAG',
      expectedLineType: 'ORPHAN_EXTERNAL',
      amount: s5s7Amount.toString(),
      externalRef: fakeRef,
      detail: {
        insertedExternalLineId: created.id,
        direction: 'OUT',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s5s7Amount.negated().toString(),
        pairedWithScenario: 7,
      },
    });
  }

  // ── Scenario 6 — 充值漏监听 (BREAK / ORPHAN_EXTERNAL) ───────────────────
  // Bank sees a customer deposit our listener never picked up. Insert a
  // ghost IN line, bump closing up — no in-transit order explains it, so
  // it's a hard break.
  {
    const s6Amount = D('61');
    const fakeRef = refFor(s6Plan.currency, 'MISSEDDEP');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s6Plan.currency),
        accountRef: s6Plan.walletRef,
        subAccount: s6Plan.walletRef,
        book: s6Plan.book,
        currency: s6Plan.currency,
        direction: 'IN',
        amount: s6Amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo missed-deposit-listener credit (bank saw it, we never ingested it)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s6Plan.walletRef}-s6-missed-deposit`,
      },
    });
    const prevClose = await bumpClosing(s6Plan, s6Amount);
    injections.push({
      scenarioId: 6,
      rootCause: 'MISSED_DEPOSIT',
      walletRef: s6Plan.walletRef,
      expectedBucket: 'BREAK',
      expectedLineType: 'ORPHAN_EXTERNAL',
      amount: s6Amount.toString(),
      externalRef: fakeRef,
      detail: {
        insertedExternalLineId: created.id,
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s6Amount.toString(),
      },
    });
  }

  // ── Scenario 7 — 银行利息 (SOFT_FLAG, paired with scenario 5) ───────────
  // Same FIRM wallet as scenario 5, same amount, opposite direction (IN).
  // Nets scenario 5's OUT to a 0 closing delta ⇒ same wallet, same case,
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
        description: 'Demo bank interest (ghost IN, hedges scenario 5 bank charge)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s5s7Plan.walletRef}-s7-bank-interest`,
      },
    });
    const prevClose = await bumpClosing(s5s7Plan, s5s7Amount);
    injections.push({
      scenarioId: 7,
      rootCause: 'BANK_INTEREST',
      walletRef: s5s7Plan.walletRef,
      expectedBucket: 'SOFT_FLAG',
      expectedLineType: 'ORPHAN_EXTERNAL',
      amount: s5s7Amount.toString(),
      externalRef: fakeRef,
      detail: {
        insertedExternalLineId: created.id,
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: s5s7Amount.toString(),
        pairedWithScenario: 5,
      },
    });
  }

  // ── Scenario 8 — 银行退汇 (BREAK / ORPHAN_EXTERNAL) ─────────────────────
  // Insert an IN + a return OUT (same channelRef, equal amount) — both are
  // brand-new external lines with no internal counterpart at all. Per spec,
  // the closing net change must be −amount (not 0): only the return OUT's
  // effect is applied to closing, modelling "internal already carries one
  // IN that this injection doesn't touch, and the bank now claws it back."
  {
    const s8Amount = D('47');
    const channelRef = refFor(s8Plan.currency, 'RETURNCH');
    const inRef = refFor(s8Plan.currency, 'RETURNIN');
    const outRef = refFor(s8Plan.currency, 'RETURNOUT');
    const inLine = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s8Plan.currency),
        accountRef: s8Plan.walletRef,
        subAccount: s8Plan.walletRef,
        book: s8Plan.book,
        currency: s8Plan.currency,
        direction: 'IN',
        amount: s8Amount,
        externalRef: inRef,
        channelRef,
        datetime: cutoff,
        description: 'Demo bank return — original IN leg',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s8Plan.walletRef}-s8-return-in`,
      },
    });
    const outLine = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s8Plan.currency),
        accountRef: s8Plan.walletRef,
        subAccount: s8Plan.walletRef,
        book: s8Plan.book,
        currency: s8Plan.currency,
        direction: 'OUT',
        amount: s8Amount,
        externalRef: outRef,
        channelRef,
        datetime: cutoff,
        description: 'Demo bank return — clawback OUT leg (same channelRef as IN)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s8Plan.walletRef}-s8-return-out`,
      },
    });
    const prevClose = await bumpClosing(s8Plan, s8Amount.negated());
    injections.push({
      scenarioId: 8,
      rootCause: 'BANK_RETURN',
      walletRef: s8Plan.walletRef,
      expectedBucket: 'BREAK',
      expectedLineType: 'ORPHAN_EXTERNAL',
      amount: s8Amount.toString(),
      externalRef: outRef,
      detail: {
        channelRef,
        insertedInLineId: inLine.id,
        insertedOutLineId: outLine.id,
        inExternalRef: inRef,
        outExternalRef: outRef,
        prevClosingBalance: prevClose,
        closingBalanceDelta: s8Amount.negated().toString(),
      },
    });
  }

  // ── Scenario 9 — 孤儿充值 (BREAK, unattributed head, no line item) ──────
  // No internal wallet claims this external account at all — walletRef is
  // null on the ExternalBalance head. This exercises T5's
  // unattributedBalances branch (no silent skip; must surface as BREAK).
  // The statement line is still written (a real orphan head would have
  // statement detail behind it), but T5 intentionally does not run the
  // flow matcher for unattributed heads, so no ORPHAN_EXTERNAL line item
  // is produced — only the case-level BREAK signal is expected here.
  {
    const s9Amount = D('53');
    const s9Currency = 'AED';
    const s9Book = 'FIRM';
    const s9Source = sourceFor(s9Currency);
    await (prisma as any).externalBalance.create({
      data: {
        source: s9Source,
        accountRef: DEMO_ORPHAN_ACCOUNT_REF,
        currency: s9Currency,
        book: s9Book,
        cutoffDate,
        closingBalance: s9Amount,
        openingBalance: D(0),
        asOfAt: cutoff,
        status: 'INGESTED',
        walletRef: null,
        lineCount: 1,
      },
    });
    const fakeRef = refFor(s9Currency, 'ORPHANDEP');
    await (prisma as any).externalStatementLine.create({
      data: {
        source: s9Source,
        accountRef: DEMO_ORPHAN_ACCOUNT_REF,
        subAccount: null,
        book: s9Book,
        currency: s9Currency,
        direction: 'IN',
        amount: s9Amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo orphan deposit — no internal wallet claims this external account',
        dedupKey: `DEMO-INJ-${cutoffDate}-${DEMO_ORPHAN_ACCOUNT_REF}-s9-orphan-deposit`,
      },
    });
    injections.push({
      scenarioId: 9,
      rootCause: 'ORPHAN_DEPOSIT',
      walletRef: DEMO_ORPHAN_ACCOUNT_REF,
      expectedBucket: 'BREAK',
      expectedLineType: null,
      amount: s9Amount.toString(),
      externalRef: fakeRef,
      detail: {
        accountRef: DEMO_ORPHAN_ACCOUNT_REF,
        closingBalance: s9Amount.toString(),
      },
    });
  }

  return { cutoff: cutoff.toISOString(), injections };
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

// ── Phase 4: read back the run + match each manifest injection against
// the recorded reconciliation_line_items / case row ─────────────────────
async function verifyManifest(
  prisma: PrismaService,
  runId: string,
  manifest: ManifestV2,
): Promise<{ detected: number; missed: string[] }> {
  const lineItems = (await (prisma as any).reconciliationLineItem.findMany({
    where: { foundByRunId: runId },
    select: {
      matchStatus: true,
      walletRef: true,
      externalRef: true,
      internalAmount: true,
      externalAmount: true,
      internalSourceNo: true,
    },
  })) as Array<{
    matchStatus: string;
    walletRef: string | null;
    externalRef: string | null;
    internalAmount: Prisma.Decimal | null;
    externalAmount: Prisma.Decimal | null;
    internalSourceNo: string | null;
  }>;
  const cases = (await (prisma as any).reconciliationCase.findMany({
    where: { openedByRunId: runId },
    select: { caseNo: true, walletRef: true, deltaAmount: true, bucket: true, book: true, assetCode: true },
  })) as Array<{ caseNo: string; walletRef: string | null; deltaAmount: Prisma.Decimal; bucket: string | null; book: string | null; assetCode: string }>;

  const missed: string[] = [];
  let detected = 0;

  for (const inj of manifest.injections) {
    const walletCase = cases.find((c) => c.walletRef === inj.walletRef);
    const bucketOk = !!walletCase && walletCase.bucket === inj.expectedBucket;
    // expectedLineType===null (scenario 9 only): T5 deliberately skips the
    // flow matcher for unattributed heads, so the case-level bucket check
    // alone is the expected signal — see InjectionV2.expectedLineType doc.
    const lineHit = inj.expectedLineType === null
      ? true
      : lineItems.some(
          (l) => l.matchStatus === inj.expectedLineType
            && l.walletRef === inj.walletRef
            && (inj.externalRef ? l.externalRef === inj.externalRef : true),
        );
    let hit = bucketOk && lineHit;

    // Scenario 1 — extra assertion: the matched IN_TRANSIT line item must
    // carry internalSourceNo == the funds order we created.
    if (inj.scenarioId === 1 && hit) {
      const s1Hit = lineItems.some(
        (l) => l.matchStatus === 'IN_TRANSIT'
          && l.walletRef === inj.walletRef
          && l.internalSourceNo === inj.fundsOrderNo,
      );
      hit = hit && s1Hit;
    }

    if (hit) detected += 1;
    else missed.push(`scenario#${inj.scenarioId}(${inj.rootCause})`);
  }
  return { detected, missed };
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

  // Phase 3 (break only) — inject 9 scenarios + write manifest.
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
  let manifest: ManifestV2 | null = null;
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
    console.log(`manifest written to ${MANIFEST_PATH}  (${manifest.injections.length} scenarios)`);
    for (const inj of manifest.injections) {
      console.log(`  [#${inj.scenarioId} ${inj.rootCause}] walletRef=${inj.walletRef}  bucket=${inj.expectedBucket}  amount=${inj.amount}`);
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
    const { detected, missed } = await verifyManifest(prisma, result.runId, manifest);
    const identities = await assertIdentities(prisma, result.runId);

    console.log(`\n──── 9-scenario scorecard ────`);
    for (const inj of manifest.injections) {
      const isMissed = missed.includes(`scenario#${inj.scenarioId}(${inj.rootCause})`);
      console.log(`  #${inj.scenarioId}  ${inj.rootCause.padEnd(24)} wallet=${inj.walletRef}  expect=${inj.expectedBucket}/${inj.expectedLineType}  ${isMissed ? 'MISSED' : 'DETECTED'}`);
    }
    console.log(`  score: ${detected}/${manifest.injections.length} DETECTED`);

    console.log(`\n──── identity self-check ────`);
    for (const [label, pass] of identities.checks) {
      console.log(`  ${pass ? 'OK' : 'FAIL'}  ${label}`);
    }

    const checks = [
      ['status==BREAK', result.status === 'BREAK'],
      [`manifest detected ${detected}/${manifest.injections.length} (9/9)`, detected === manifest.injections.length && manifest.injections.length === 9],
      ['identities OK', identities.ok],
    ] as const;
    console.log(`\n──── break-mode asserts ────`);
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? 'OK' : 'FAIL'}  ${label}`);
      if (!pass) ok = false;
    }
    if (missed.length === 0) {
      console.log(`ALL ${manifest.injections.length} SCENARIOS DETECTED PER MANIFEST`);
    } else {
      console.log(`MISSED: ${missed.join(', ')}`);
    }
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

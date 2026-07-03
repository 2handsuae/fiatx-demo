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
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';

type Mode = 'pass' | 'break' | 'reset';

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

// Scenario 1 tags every demo-created FundsOrder's referenceNo with this
// prefix so reset can find + delete exactly the rows this script created,
// without touching any real business funds order.
const DEMO_IN_TRANSIT_REF_PREFIX = 'DEMO-IT-';
// Scenario 9's orphan external head/line use this fixed accountRef.
const DEMO_ORPHAN_ACCOUNT_REF = 'DEMO-ORPHAN-ADDR';

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
  // externalStatementLine/externalBalance blanket-deletes already cover
  // scenario 9's orphan head (accountRef=DEMO-ORPHAN-ADDR) — no separate
  // filter needed, both tables are demo-only footprint.
  const deletedLines = (await (prisma as any).externalStatementLine.deleteMany({})).count;
  const deletedBalances = (await (prisma as any).externalBalance.deleteMany({})).count;
  // Scenario 1 — delete only the demo-tagged funds orders (referenceNo
  // prefix), never a real business funds order.
  const deletedFundsOrders = (await (prisma as any).fundsOrder.deleteMany({
    where: { referenceNo: { startsWith: DEMO_IN_TRANSIT_REF_PREFIX } },
  })).count;
  return {
    runs: deletedRuns, cases: deletedCases, lineItems: deletedLineItems,
    balances: deletedBalances, lines: deletedLines, fundsOrders: deletedFundsOrders,
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
  //                         FIRM     → FIRM_OPS/SET/FEE/LIQ).
  //                        Aggregate codes (CLIENT_ASSET=1 / FIRM_ASSET=50)
  //                        are filtered out — matches WalletBalanceChecker.
  //
  // Direction semantic (verified empirically against Alice's CU2601019430
  // CLIENT_PAYABLE postings — image-1 evidence):
  //   account_flows.direction='IN'  ⇒ external statement IN  (balance UP)
  //   account_flows.direction='OUT' ⇒ external statement OUT (balance DOWN)
  // The TB accounts in scope (CLIENT_PAYABLE/SUSPENSE = LIABILITY,
  // FIRM_OPS/SET/FEE/LIQ = EQUITY) are ALL credit-normal right-side-of-BS
  // accounts → same single rule for both books, no role/event override.
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
  const FIRM_CODES = new Set<number>([200, 201, 202, 203]);
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
    // C_CMA is a platform fiat pool needed by demo:withdraw as the source
    // wallet, but the user wants it hidden from External Balances UI. The
    // wallet still exists in DB; we just don't mirror it into external_*.
    if (w.walletRole === 'C_CMA') continue;
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
// are independent. Wallet picks reuse the existing round-robin-by-
// (currency, ownerNo) diversity logic, extended to 6 CUSTOMER wallets
// (scenarios 2/3/4/6/8 + scenario 1's own wallet) plus 1 FIRM wallet
// (scenarios 5+7).
async function injectScenarios(
  prisma: PrismaService,
  plans: WalletPlan[],
  cutoff: Date,
  fundsOrders: FundsOrderService,
): Promise<ManifestV2> {
  if (plans.length === 0) throw new Error('No eligible wallets — seed business data first');
  const cutoffDate = ymd(cutoff);

  // ── CUSTOMER wallet picks (scenarios 2/3/4/6/8 + scenario 1) ───────────
  const candidateWallets: WalletPlan[] = [];
  for (const p of [...plans].sort((a, b) => a.walletRef.localeCompare(b.walletRef))) {
    if (p.walletKind !== 'CUSTOMER') continue;
    if (p.lines.length === 0) continue;
    candidateWallets.push(p);
  }
  if (candidateWallets.length < 6) {
    throw new Error(
      `Need ≥6 customer wallets with crossing flows for scenarios 1/2/3/4/6/8; ` +
      `got ${candidateWallets.length}. Seed more deposit/withdraw activity.`,
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
  while (picks.length < 6) {
    let advanced = false;
    for (let i = 0; i < bucketKeys.length && picks.length < 6; i++) {
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
  if (picks.length < 6) {
    throw new Error(`Could only pick ${picks.length}/6 distinct customer wallets`);
  }
  const [s2Plan, s3Plan, s4Plan, s6Plan, s8Plan, s1Plan] = picks;

  // ── FIRM wallet pick (scenarios 5+7 — shared wallet, hedged pair) ──────
  const firmCandidates = [...plans]
    .filter((p) => p.walletKind === 'FIRM')
    .sort((a, b) => a.walletRef.localeCompare(b.walletRef));
  if (firmCandidates.length === 0) {
    throw new Error('Need ≥1 FIRM wallet for scenarios 5+7 — seed firm-side activity.');
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

  // ── Scenario 1 — 在途时序差 (IN_TRANSIT) ────────────────────────────────
  // Build a REAL, state-machine-legal, non-terminal FundsOrder attached to
  // an existing SUCCESS deposit transaction on s1Plan's wallet, then mirror
  // it as an external confirmation line. This does NOT touch TigerBeetle:
  // FundsOrderService.create() only writes the funds_orders row + emits
  // `funds_order.status.changed`; the deposit/withdraw workflow listeners
  // only react on newStatus ∈ {CONFIRMED, CLEARED, FAILED, TIMEOUT} — a
  // freshly-created SUBMITTED order is a verified no-op for all three
  // workflow listeners (deposit/withdraw/swap), so no TB posting fires.
  // SUBMITTED also matches the real production entry state for a crypto
  // payin funds order (see deposit-transactions.service.ts: `isCrypto ?
  // SUBMITTED : CONFIRMED`), so this is state-machine-realistic, not a
  // synthetic status.
  {
    const s1Amount = D('101');
    const deposit = await (prisma as any).depositTransaction.findFirst({
      where: { toWalletId: s1Plan.walletRef, status: 'SUCCESS' },
      select: { id: true, assetId: true, toWalletId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!deposit) {
      throw new Error(`No SUCCESS deposit transaction on wallet ${s1Plan.walletRef} for scenario 1`);
    }
    const txHash = refFor(s1Plan.currency, 'INTRANSIT');
    const created = await fundsOrders.create({
      depositTransactionId: deposit.id,
      assetId: deposit.assetId,
      amount: s1Amount.toString(),
      netAmount: s1Amount.toString(),
      toWalletId: s1Plan.walletRef,
      txHash,
      referenceNo: `${DEMO_IN_TRANSIT_REF_PREFIX}${s1Plan.walletRef.slice(0, 8)}`,
      initialStatus: FundsOrderStatus.SUBMITTED,
    });

    // External mirror: bank/chain confirms the deposit before our own
    // ledger posts it — a fresh statement line with the funds order's
    // txHash as externalRef, IN direction, and the closing bumped by the
    // same amount so residual = delta(+101) − inTransitSigned(+101) = 0.
    await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(s1Plan.currency),
        accountRef: s1Plan.walletRef,
        subAccount: s1Plan.walletRef,
        book: s1Plan.book,
        currency: s1Plan.currency,
        direction: 'IN',
        amount: s1Amount,
        externalRef: txHash,
        datetime: cutoff,
        description: 'Demo in-transit confirmation (external ahead of internal ledger)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s1Plan.walletRef}-s1-in-transit`,
      },
    });
    const prevClose = await bumpClosing(s1Plan, s1Amount);
    injections.push({
      scenarioId: 1,
      rootCause: 'IN_TRANSIT_TIMING',
      walletRef: s1Plan.walletRef,
      expectedBucket: 'IN_TRANSIT',
      expectedLineType: 'IN_TRANSIT',
      amount: s1Amount.toString(),
      externalRef: txHash,
      fundsOrderNo: created.fundsOrderNo,
      detail: {
        depositTransactionId: deposit.id,
        fundsOrderId: created.id,
        fundsOrderStatus: created.status,
        prevClosingBalance: prevClose,
        closingBalanceDelta: s1Amount.toString(),
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
  let manifest: ManifestV2 | null = null;
  if (mode === 'break') {
    const fundsOrders = app.get(FundsOrderService);
    manifest = await injectScenarios(prisma, plans, cutoff, fundsOrders);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`manifest written to ${MANIFEST_PATH}  (${manifest.injections.length} scenarios)`);
    for (const inj of manifest.injections) {
      console.log(`  [#${inj.scenarioId} ${inj.rootCause}] walletRef=${inj.walletRef}  bucket=${inj.expectedBucket}  amount=${inj.amount}`);
    }
  }

  // Phase 3.5 — populate balanceAfter on every line (running balance from opening).
  const balanceAfterCount = await populateBalanceAfter(prisma, cutoff);
  console.log(`balanceAfter populated on ${balanceAfterCount} line(s)`);

  // Phase 4 — run the engine.
  const engine = app.get(WalletReconRunService);
  const result = await engine.run({ cutoff, manifest: manifest ?? undefined });
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

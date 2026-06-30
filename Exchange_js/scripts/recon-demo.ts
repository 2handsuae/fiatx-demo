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
//   --mode=break   Pass-mode setup, then inject 4 anomalies and write
//                  `manifest.json` (the answer key). The engine should
//                  detect every injected anomaly as a matching line_item
//                  in the new run, plus open at least one balance + one
//                  flow case.
//                    1. ORPHAN_INTERNAL  — delete one mirrored external line
//                    2. ORPHAN_EXTERNAL  — insert one synthetic external line
//                    3. AMOUNT_MISMATCH  — adjust one external line's amount
//                    4. BALANCE_BREAK    — adjust one wallet's closingBalance
//                  Each anomaly is targeted at a DIFFERENT wallet so the
//                  open Cases stay disjoint and the per-anomaly checks are
//                  independent.
//
//   --mode=reset   Delete WALLET_V1 runs/cases + all ExternalBalance /
//                  ExternalStatementLine rows. Demo:all business data is
//                  left untouched.
//
// Anchor-free: every walletRef / asset / amount comes from the *current*
// account_flows snapshot. The script will work on any seeded dataset; the
// only requirement is that ≥4 distinct wallets have isExternalCrossing
// flows so each anomaly can land on its own wallet.
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

// ── Manifest types ──────────────────────────────────────────────────────
// Two-bucket model that mirrors the cockpit's three-tier status:
//   HARD BREAK (Bucket 1) — external balance ≠ internal. Touch a line AND
//     bump the wallet's closingBalance so a real bank-side miss/ghost/
//     amount-error shows up the way it would in production.
//       · ORPHAN_INTERNAL: bank漏报 — we have it, bank doesn't.
//       · ORPHAN_EXTERNAL: 幽灵入账 — bank has it, we don't.
//       · AMOUNT_MISMATCH: 金额差   — same ref, different amount.
//   SOFT FLAG (Bucket 2) — external balance == internal, but line items
//     don't line up. Pair-cancel scenarios.
//       · PAIR_CANCEL_ORPHAN:    delete real (+X) + insert ghost (+X)
//       · PAIR_CANCEL_MISMATCH:  one line +a, another line −a
type InjectionType =
  | 'ORPHAN_INTERNAL'
  | 'ORPHAN_EXTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'PAIR_CANCEL_ORPHAN'
  | 'PAIR_CANCEL_MISMATCH';

interface ManifestInjection {
  type: InjectionType;
  bucket: 'HARD_BREAK' | 'SOFT_FLAG';
  walletRef: string;
  detail: Record<string, unknown>;
}

interface Manifest {
  cutoff: string;
  injections: ManifestInjection[];
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

async function clearWalletDemo(prisma: PrismaService): Promise<{
  runs: number; cases: number; lineItems: number; balances: number; lines: number;
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
  const deletedLines = (await (prisma as any).externalStatementLine.deleteMany({})).count;
  const deletedBalances = (await (prisma as any).externalBalance.deleteMany({})).count;
  return { runs: deletedRuns, cases: deletedCases, lineItems: deletedLineItems, balances: deletedBalances, lines: deletedLines };
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

// ── Phase 3 (break only): inject 4 anomalies — one per wallet ───────────
//
// Picks 4 different wallets to host the 4 anomalies. If fewer than 4
// wallets are eligible we reuse the last one (defensive — the script
// still completes, though manifest validation may overlap on the same
// wallet's case). The pick is deterministic (first by walletRef sort
// order) so re-runs produce the same manifest.
async function injectAnomalies(
  prisma: PrismaService,
  plans: WalletPlan[],
  cutoff: Date,
): Promise<Manifest> {
  if (plans.length === 0) throw new Error('No eligible wallets — seed business data first');
  const cutoffDate = ymd(cutoff);

  // Pick CUSTOMER wallets only — that's where bank/chain mismatches
  // actually happen in production (firm wallets are internal-only).
  // Prefer wallets that already have ≥1 mirrored line so the inject
  // operations have raw material to mutate.
  const candidateWallets: WalletPlan[] = [];
  for (const p of [...plans].sort((a, b) => a.walletRef.localeCompare(b.walletRef))) {
    if (p.walletKind !== 'CUSTOMER') continue;
    if (p.lines.length === 0) continue;
    candidateWallets.push(p);
  }
  if (candidateWallets.length < 5) {
    throw new Error(
      `Need ≥5 customer wallets with crossing flows for the 3 HARD + 2 SOFT injections; ` +
      `got ${candidateWallets.length}. Seed more deposit/withdraw activity.`,
    );
  }
  // Round-robin across (currency, ownerNo) tuples so picks are maximally
  // diverse — avoids stacking 3 mutations on the same wallet.
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
    throw new Error(`Could only pick ${picks.length}/5 distinct customer wallets`);
  }

  const [hardOrphanIntPlan, hardOrphanExtPlan, hardMismatchPlan, softOrphanPlan, softMismatchPlan] = picks;
  const injections: ManifestInjection[] = [];

  // Build a deterministic but realistic external ref (e.g. BANK-PO-… for fiat,
  // 0x… for crypto). Seq incl. inj index so multiple ghosts don't collide.
  let injSeq = 0;
  const refFor = (currency: string, kind: string): string => {
    injSeq += 1;
    return /^(USDT|BTC|ETH|USDC)/i.test(currency)
      ? fakeChainTxHash(`${kind}${injSeq}`)
      : fakeBankRef(`${kind}${injSeq}`, cutoffDate);
  };
  // Per-asset injection amount calibrated for visible-on-cockpit AND
  // realistic-bank-mismatch magnitudes. Fees / FX rounding errors in
  // production are typically 1-50 of the base unit, not micro-cents.
  // 6-decimal currencies: 5,000,000 minor = 5.0 unit (clear 1st-digit diff).
  const injAmountFor = (currency: string): Prisma.Decimal =>
    /^(USDT|BTC|ETH|USDC)/i.test(currency)
      ? D('5000000')  /* 5 USDT — fee-scale ghost/mismatch */
      : D('5000000'); /* 5 AED  — fee-scale ghost/mismatch */

  // Helper: shift the wallet's closingBalance by `delta` (signed) to keep
  // it consistent with the line change. Direction sign convention:
  //   customer wallet (credit-normal): IN means balance up, OUT down.
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

  // ── Bucket 1: HARD BREAK — balance != external ──────────────────────

  // 1A. ORPHAN_INTERNAL — bank missed reporting one credit/debit.
  //     Delete a real mirrored line AND shrink external closingBalance
  //     by that line's amount (bank's closing also won't reflect the
  //     line it never saw).
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: hardOrphanIntPlan.walletRef },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line to delete on ${hardOrphanIntPlan.walletRef}`);
    await (prisma as any).externalStatementLine.delete({ where: { id: candidate.id } });
    const signedDelta = candidate.direction === 'IN'
      ? candidate.amount.negated()
      : candidate.amount;
    const prevClose = await bumpClosing(hardOrphanIntPlan, signedDelta);
    injections.push({
      type: 'ORPHAN_INTERNAL',
      bucket: 'HARD_BREAK',
      walletRef: hardOrphanIntPlan.walletRef,
      detail: {
        deletedExternalLineId: candidate.id,
        externalRef: candidate.externalRef,
        amount: candidate.amount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
  }

  // 1B. ORPHAN_EXTERNAL — bank booked a phantom credit (fee/refund/test wire).
  //     Insert a ghost line AND bump external closingBalance accordingly.
  {
    const amount = injAmountFor(hardOrphanExtPlan.currency);
    const fakeRef = refFor(hardOrphanExtPlan.currency, 'GHOST');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(hardOrphanExtPlan.currency),
        accountRef: hardOrphanExtPlan.walletRef,
        subAccount: hardOrphanExtPlan.walletRef,
        book: hardOrphanExtPlan.book,
        currency: hardOrphanExtPlan.currency,
        direction: 'IN',
        amount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo phantom external credit (fee/refund/test wire)',
        dedupKey: `DEMO-INJ-${cutoffDate}-${hardOrphanExtPlan.walletRef}-hard-orphan-ext`,
      },
    });
    const prevClose = await bumpClosing(hardOrphanExtPlan, amount); // IN → balance up
    injections.push({
      type: 'ORPHAN_EXTERNAL',
      bucket: 'HARD_BREAK',
      walletRef: hardOrphanExtPlan.walletRef,
      detail: {
        insertedExternalLineId: created.id,
        externalRef: fakeRef,
        amount: amount.toString(),
        direction: 'IN',
        prevClosingBalance: prevClose,
        closingBalanceDelta: amount.toString(),
      },
    });
  }

  // 1C. AMOUNT_MISMATCH — same ref, but bank booked a different number
  //     (FX rounding / hidden fee). Shift external line amount AND
  //     bump closing by the same delta so the balance check fires too.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: hardMismatchPlan.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on ${hardMismatchPlan.walletRef}`);
    const delta = injAmountFor(hardMismatchPlan.currency); // fee-scale shift
    const newAmount = candidate.amount.plus(delta);
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    const signedDelta = candidate.direction === 'IN' ? delta : delta.negated();
    const prevClose = await bumpClosing(hardMismatchPlan, signedDelta);
    injections.push({
      type: 'AMOUNT_MISMATCH',
      bucket: 'HARD_BREAK',
      walletRef: hardMismatchPlan.walletRef,
      detail: {
        externalLineId: candidate.id,
        externalRef: candidate.externalRef,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
  }

  // ── Bucket 2: SOFT FLAG — balance == external, but flow has anomalies ─

  // 2A. PAIR_CANCEL_ORPHAN — delete one real line, insert a ghost of the
  //     SAME direction with amount = real.amount + ε. The external CLOSING
  //     balance is NOT touched: it was already set to the internal TB net
  //     in the pass-mirror phase, and internal hasn't moved, so leaving it
  //     alone keeps the balance check at delta=0 (SOFT-flag bucket).
  //
  //     Why the ε shift instead of an exact replica: the matcher's Pass 2
  //     fuzzy step pairs flows on (amount + direction + ±60min). With an
  //     identical amount the ghost would fuzzy-pair with the deleted real's
  //     internal twin and the anomaly would vanish. Shifting by 1 minor
  //     unit makes Decimal.equals(ghost.amount, real.amount) false → fuzzy
  //     skips → real's internal twin surfaces as orphan_internal AND the
  //     ghost surfaces as orphan_external, exactly as the SOFT_FLAG bucket
  //     promises. The 1-unit running-balance drift on the line-by-line
  //     `balanceAfter` column is intentional and is the cockpit signal an
  //     operator uses to spot the wash.
  {
    const real = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: softOrphanPlan.walletRef },
      orderBy: { datetime: 'asc' },
    });
    if (!real) throw new Error(`No external line to pair-cancel on ${softOrphanPlan.walletRef}`);
    await (prisma as any).externalStatementLine.delete({ where: { id: real.id } });
    const fakeRef = refFor(softOrphanPlan.currency, 'PAIR');
    const eps = D('1');
    const ghostAmount = real.amount.plus(eps);
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(softOrphanPlan.currency),
        accountRef: softOrphanPlan.walletRef,
        subAccount: softOrphanPlan.walletRef,
        book: softOrphanPlan.book,
        currency: softOrphanPlan.currency,
        direction: real.direction,
        amount: ghostAmount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo pair-cancel — ghost (amount shifted by ε) replaces deleted real line',
        dedupKey: `DEMO-INJ-${cutoffDate}-${softOrphanPlan.walletRef}-soft-pair-orphan`,
      },
    });
    // closingBalance untouched — external balance was set to internal TB net
    // in the pass-mirror phase, and internal hasn't moved → delta stays 0.
    injections.push({
      type: 'PAIR_CANCEL_ORPHAN',
      bucket: 'SOFT_FLAG',
      walletRef: softOrphanPlan.walletRef,
      detail: {
        deletedExternalLineId: real.id,
        deletedExternalRef: real.externalRef,
        insertedExternalLineId: created.id,
        insertedExternalRef: fakeRef,
        deletedAmount: real.amount.toString(),
        insertedAmount: ghostAmount.toString(),
        direction: real.direction,
      },
    });
  }

  // 2B. PAIR_CANCEL_MISMATCH — find two real lines, bump one by +Δ and
  //     the other by −Δ. Sum unchanged (balance ties), but the matcher
  //     reports 2 amount_mismatch anomalies.
  {
    const reals = await (prisma as any).externalStatementLine.findMany({
      where: { subAccount: softMismatchPlan.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
      take: 2,
    });
    if (reals.length < 2) {
      throw new Error(`Need ≥2 external lines on ${softMismatchPlan.walletRef} for pair-cancel mismatch; got ${reals.length}`);
    }
    const [a, b] = reals;
    const delta = injAmountFor(softMismatchPlan.currency);
    // a gets +delta in the OUT direction means balance goes down by delta;
    // b takes the opposite sign so net stays zero. Compute signed adjustments
    // such that a.direction-signed + b.direction-signed sums to 0.
    const aSign = a.direction === 'IN' ? 1 : -1;
    const bSign = b.direction === 'IN' ? 1 : -1;
    // We want aSign*+delta + bSign*+adjB = 0, so adjB = -(aSign/bSign)*delta.
    const adjB = aSign === bSign ? delta.negated() : delta;
    await (prisma as any).externalStatementLine.update({
      where: { id: a.id }, data: { amount: a.amount.plus(delta) },
    });
    await (prisma as any).externalStatementLine.update({
      where: { id: b.id }, data: { amount: b.amount.plus(adjB) },
    });
    injections.push({
      type: 'PAIR_CANCEL_MISMATCH',
      bucket: 'SOFT_FLAG',
      walletRef: softMismatchPlan.walletRef,
      detail: {
        lineAId: a.id, lineAExternalRef: a.externalRef,
        lineAOldAmount: a.amount.toString(), lineANewAmount: a.amount.plus(delta).toString(),
        lineBId: b.id, lineBExternalRef: b.externalRef,
        lineBOldAmount: b.amount.toString(), lineBNewAmount: b.amount.plus(adjB).toString(),
        netDelta: '0',
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
  manifest: Manifest,
): Promise<{ detected: number; missed: string[] }> {
  const lineItems = (await (prisma as any).reconciliationLineItem.findMany({
    where: { foundByRunId: runId },
    select: {
      matchStatus: true,
      walletRef: true,
      externalRef: true,
      internalAmount: true,
      externalAmount: true,
    },
  })) as Array<{
    matchStatus: string;
    walletRef: string | null;
    externalRef: string | null;
    internalAmount: Prisma.Decimal | null;
    externalAmount: Prisma.Decimal | null;
  }>;
  const cases = (await (prisma as any).reconciliationCase.findMany({
    where: { openedByRunId: runId },
    select: { caseNo: true, walletRef: true, deltaAmount: true, book: true, assetCode: true },
  })) as Array<{ caseNo: string; walletRef: string | null; deltaAmount: Prisma.Decimal; book: string | null; assetCode: string }>;

  const missed: string[] = [];
  let detected = 0;

  for (const inj of manifest.injections) {
    let hit = false;
    if (inj.type === 'ORPHAN_INTERNAL') {
      // HARD: the deleted external line means matcher logs orphan_internal
      // AND the wallet's case has deltaAmount != 0 from the closing bump.
      const orphanHit = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_INTERNAL' && l.walletRef === inj.walletRef,
      );
      const balHit = cases.some((c) => c.walletRef === inj.walletRef && !c.deltaAmount.equals(0));
      hit = orphanHit && balHit;
    } else if (inj.type === 'ORPHAN_EXTERNAL') {
      const ref = inj.detail['externalRef'];
      const orphanHit = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_EXTERNAL'
          && l.walletRef === inj.walletRef
          && (ref ? l.externalRef === ref : true),
      );
      const balHit = cases.some((c) => c.walletRef === inj.walletRef && !c.deltaAmount.equals(0));
      hit = orphanHit && balHit;
    } else if (inj.type === 'AMOUNT_MISMATCH') {
      const ref = inj.detail['externalRef'];
      const mismatchHit = lineItems.some(
        (l) => l.matchStatus === 'AMOUNT_MISMATCH'
          && l.walletRef === inj.walletRef
          && (ref ? l.externalRef === ref : true),
      );
      const balHit = cases.some((c) => c.walletRef === inj.walletRef && !c.deltaAmount.equals(0));
      hit = mismatchHit && balHit;
    } else if (inj.type === 'PAIR_CANCEL_ORPHAN') {
      // SOFT: balance equal (delta=0), but matcher logs 1 orphan_internal + 1 orphan_external.
      const oi = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_INTERNAL' && l.walletRef === inj.walletRef,
      );
      const oe = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_EXTERNAL'
          && l.walletRef === inj.walletRef
          && l.externalRef === inj.detail['insertedExternalRef'],
      );
      const balOk = cases.some((c) => c.walletRef === inj.walletRef && c.deltaAmount.equals(0));
      hit = oi && oe && balOk;
    } else if (inj.type === 'PAIR_CANCEL_MISMATCH') {
      // SOFT: balance equal (delta=0), but matcher logs 2 amount mismatches.
      const refA = inj.detail['lineAExternalRef'];
      const refB = inj.detail['lineBExternalRef'];
      const mA = lineItems.some(
        (l) => l.matchStatus === 'AMOUNT_MISMATCH'
          && l.walletRef === inj.walletRef && l.externalRef === refA,
      );
      const mB = lineItems.some(
        (l) => l.matchStatus === 'AMOUNT_MISMATCH'
          && l.walletRef === inj.walletRef && l.externalRef === refB,
      );
      const balOk = cases.some((c) => c.walletRef === inj.walletRef && c.deltaAmount.equals(0));
      hit = mA && mB && balOk;
    }
    if (hit) detected += 1;
    else missed.push(`${inj.type}@${inj.walletRef}`);
  }
  return { detected, missed };
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
    console.log(`reset done: runs=${r.runs} cases=${r.cases} line_items=${r.lineItems} balances=${r.balances} lines=${r.lines}`);
    await app.close();
    process.exit(0);
  }

  // Both pass and break start from a clean slate — wipe WALLET_V1 footprint
  // so the new Run is the only one for this cutoff.
  const cleared = await clearWalletDemo(prisma);
  if (cleared.runs > 0 || cleared.balances > 0 || cleared.lines > 0) {
    console.log(`self-clean: runs=${cleared.runs} cases=${cleared.cases} line_items=${cleared.lineItems} balances=${cleared.balances} lines=${cleared.lines}`);
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

  // Phase 3 (break only) — inject 4 anomalies + write manifest.
  let manifest: Manifest | null = null;
  if (mode === 'break') {
    manifest = await injectAnomalies(prisma, plans, cutoff);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`manifest written to ${MANIFEST_PATH}  (${manifest.injections.length} injections)`);
    for (const inj of manifest.injections) {
      console.log(`  [${inj.type}] walletRef=${inj.walletRef}  ${JSON.stringify(inj.detail)}`);
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
    const hardCount = manifest.injections.filter((i) => i.bucket === 'HARD_BREAK').length;
    const softCount = manifest.injections.filter((i) => i.bucket === 'SOFT_FLAG').length;
    const checks = [
      ['status==BREAK', result.status === 'BREAK'],
      [`casesOpened==${manifest.injections.length} (3 HARD + 2 SOFT = 5 distinct wallets)`,
        result.casesOpened === manifest.injections.length],
      ['orphanInternal>=2 (1 hard + 1 from pair-cancel)', result.orphanInternal >= 2],
      ['orphanExternal>=2 (1 hard + 1 from pair-cancel)', result.orphanExternal >= 2],
      ['mismatch>=3 (1 hard + 2 from pair-cancel)', result.mismatch >= 3],
      [`manifest detected ${detected}/${manifest.injections.length}`, detected === manifest.injections.length],
    ] as const;
    console.log(`\n──── break-mode asserts ────`);
    console.log(`  injection plan: ${hardCount} HARD BREAK + ${softCount} SOFT FLAG`);
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? 'OK' : 'FAIL'}  ${label}`);
      if (!pass) ok = false;
    }
    if (missed.length === 0) {
      console.log(`ALL ${manifest.injections.length} ANOMALIES DETECTED PER MANIFEST`);
    } else {
      console.log(`MISSED: ${missed.join(', ')}`);
    }
  }

  console.log(`\n════════ recon:demo ${mode} DONE — ${ok ? 'OK' : 'FAILED'} ════════`);
  await app.close();
  // Both modes exit 0 on expected outcome — break is success when the
  // engine catches every injected anomaly. Anomaly-detection failure or
  // pass-mode break trips a non-zero exit code.
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

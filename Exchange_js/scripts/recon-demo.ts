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
interface ManifestInjection {
  type: 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL' | 'AMOUNT_MISMATCH' | 'BALANCE_BREAK';
  walletRef: string;
  // Per-type detail blob — kept as plain JSON for cross-checking against
  // reconciliation_line_items.
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
  // Wipe all WALLET_V1 footprint (runs/cases/line_items + all external
  // statement rows). Demo:all business data is not touched.
  const runs = (await (prisma as any).reconciliationRun.findMany({
    where: { engineVersion: 'WALLET_V1' },
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
  tbEvidence: TbEvidenceService,
  cutoff: Date,
): Promise<WalletPlan[]> {
  // Resolve assets once — recon engine matches ExternalBalance.currency
  // against Asset.code, not the human currency. AED.code='AED' but
  // USDT.code='USDT-TRON'; without this remap USDT wallets get skipped.
  const assets = (await (prisma as any).asset.findMany({
    where: { status: 'ACTIVE' },
    select: { code: true, currency: true },
  })) as Array<{ code: string; currency: string }>;
  const codeByCurrency = new Map<string, string>(assets.map((a) => [a.currency, a.code]));

  // Single pass — enumerate every active wallet (full coverage). For each
  // wallet: pull its crossing flows (may be empty), call the balance checker
  // for internal total, and fall back to walletRole-based classification
  // when the checker returns UNKNOWN (aggregate-only flow history but the
  // wallet is still a real F_OPS / F_SET / F_LIQ account that operators
  // need to see).
  const COA_BY_ROLE: Record<string, string> = {
    F_OPS:   'E.FIRM_OPS',
    F_SET:   'E.FIRM_SET',
    F_LIQ:   'E.FIRM_LIQ',
    F_FEE:   'E.FIRM_FEE',
    C_DEP:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_VIBAN: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_CMA:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
  };

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

    // Crossing flows landing on this wallet — drive the mirrored statement lines.
    // POSTED only: PENDING transfers are pre-occupations (TB lock), not real
    // money movement, so they wouldn't appear on a bank/chain statement. Aligns
    // with what the Account Statement admin page shows (also POSTED-only).
    const flows = (await (prisma as any).accountFlow.findMany({
      where: {
        walletRef: w.id,
        isExternalCrossing: true,
        transferType: 'POSTED',
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        externalRef: true,
        assetCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as Array<{
      id: string;
      direction: string;
      amount: Prisma.Decimal;
      externalRef: string | null;
      assetCode: string;
      createdAt: Date;
    }>;

    // Balance: derive from the WALLET'S OWN account-statement view (the
    // same logic the admin Account Statement page renders). This is the
    // user-facing source of truth — sums signed crossings with the same
    // ownership filter + class-aware direction flip as the UI. UNKNOWN
    // firm wallets (F_OPS/F_SET/F_LIQ) now get the correct net activity
    // instead of 0, so the External Balance row matches what an operator
    // sees on Account Statement.
    const statement = await tbEvidence.getWalletStatement(w.id);
    const internalTotal = BigInt(statement.currentBalance ?? 0);
    // Still call balanceChecker for ownerNo/coaCode/walletKind on customer
    // wallets; UNKNOWN cases fall back to walletRole lookup at case-write
    // time via enrichIfUnknown.
    const bal = await balanceChecker.checkBalance({
      walletRef: w.id,
      externalClosing: 0n,
      cutoff,
    });

    plans.push({
      walletRef: w.id,
      walletKind: isFirm ? 'FIRM' : 'CUSTOMER',
      book: isFirm ? 'FIRM' : 'CLIENT',
      currency: codeByCurrency.get(flows[0]?.assetCode ?? '') ?? currency,
      internalTotal,
      coaCode: bal.walletKind !== 'UNKNOWN' ? bal.coaCode : (COA_BY_ROLE[w.walletRole] ?? ''),
      ownerNo: bal.ownerNo ?? w.ownerNo,
      lines: flows.map((f) => ({
        direction: f.direction as 'IN' | 'OUT',
        amount: f.amount,
        externalRef: f.externalRef,
        // Shift external timestamp 0–60 min BACKWARD (matcher fuzzy window).
        // Forward shift could push past cutoff and break the engine query.
        datetime: new Date(f.createdAt.getTime() - Math.floor(Math.random() * 60) * 60 * 1000),
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
    // External balance = internal balance (mirror).
    // accountRef is a stable derived key (so the upsert composite unique
    // constraint behaves); we use the walletRef itself.
    const accountRef = p.walletRef;
    const source = sourceFor(p.currency);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source, accountRef, cutoffDate } },
      update: {
        currency: p.currency,
        book: p.book,
        closingBalance: D(p.internalTotal.toString()),
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
        closingBalance: D(p.internalTotal.toString()),
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
  // Pick 4 wallets to host the 4 anomalies. We bias toward DIFFERENT
  // (currency, book) tuples so each break opens its own Case row — the
  // unique constraint on `reconciliation_cases` is [businessDate,
  // assetId, book], so two wallets sharing a book collapse into one
  // case (deltaAmount accumulates, walletRef is whichever wallet ran
  // first). With distinct (currency, book), each manifest entry maps
  // 1:1 to a fresh Case. If fewer than 4 distinct (currency, book)
  // groups exist we fall through to repeats — the verifier handles
  // the merge case too.
  const bucketed = new Map<string, WalletPlan[]>();
  for (const p of [...plans].sort((a, b) => a.walletRef.localeCompare(b.walletRef))) {
    const key = `${p.currency}|${p.book}`;
    const arr = bucketed.get(key) ?? [];
    arr.push(p);
    bucketed.set(key, arr);
  }
  const bucketKeys = Array.from(bucketed.keys()).sort();
  const picks: WalletPlan[] = [];
  // Round-robin across buckets so the first 4 picks are maximally distinct.
  let bucketCursor = 0;
  while (picks.length < 4) {
    if (bucketKeys.length === 0) break;
    const key = bucketKeys[bucketCursor % bucketKeys.length];
    const candidates = bucketed.get(key)!;
    if (candidates.length > 0) {
      picks.push(candidates.shift()!);
    }
    bucketCursor += 1;
    // If a bucket is exhausted, prune it to avoid an infinite loop.
    if (candidates.length === 0) {
      bucketed.delete(key);
      bucketKeys.splice(bucketKeys.indexOf(key), 1);
      bucketCursor = bucketCursor % Math.max(bucketKeys.length, 1);
    }
    if (bucketKeys.length === 0 && picks.length < 4) {
      // Refill from the original plans, allowing repeats so we always
      // return 4 picks.
      const fill = [...plans].sort((a, b) => a.walletRef.localeCompare(b.walletRef));
      while (picks.length < 4) picks.push(fill[picks.length % fill.length]);
      break;
    }
  }
  const [orphanIntPlan, orphanExtPlan, mismatchPlan, balanceBreakPlan] = picks;

  const injections: ManifestInjection[] = [];

  // ── 1. ORPHAN_INTERNAL ───────────────────────────────────────────────
  //    Delete one external line for orphanIntPlan. The matcher should
  //    see this wallet's flow with no external match → orphanInternal.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: orphanIntPlan.walletRef },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line to delete for orphan-internal on wallet ${orphanIntPlan.walletRef}`);
    await (prisma as any).externalStatementLine.delete({ where: { id: candidate.id } });
    injections.push({
      type: 'ORPHAN_INTERNAL',
      walletRef: orphanIntPlan.walletRef,
      detail: {
        deletedExternalLineId: candidate.id,
        externalRef: candidate.externalRef,
        amount: candidate.amount.toString(),
        direction: candidate.direction,
      },
    });
  }

  // ── 2. ORPHAN_EXTERNAL ───────────────────────────────────────────────
  //    Insert a synthetic external line with no corresponding internal
  //    flow. The matcher should bucket it as orphanExternal.
  {
    const fakeRef = `DEMO-ORPHAN-EXT-${Math.floor(Math.random() * 1e8).toString(36)}`;
    const fakeAmount = D('1000000');
    const fakeDedupKey = `DEMO-INJECTION-${cutoffDate}-${orphanExtPlan.walletRef}-orphan-ext`;
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(orphanExtPlan.currency),
        accountRef: orphanExtPlan.walletRef,
        subAccount: orphanExtPlan.walletRef,
        book: orphanExtPlan.book,
        currency: orphanExtPlan.currency,
        direction: 'IN',
        amount: fakeAmount,
        externalRef: fakeRef,
        datetime: cutoff,
        description: 'Demo synthetic orphan-external',
        dedupKey: fakeDedupKey,
      },
    });
    injections.push({
      type: 'ORPHAN_EXTERNAL',
      walletRef: orphanExtPlan.walletRef,
      detail: {
        insertedExternalLineId: created.id,
        externalRef: fakeRef,
        amount: fakeAmount.toString(),
        direction: 'IN',
      },
    });
  }

  // ── 3. AMOUNT_MISMATCH ───────────────────────────────────────────────
  //    Pick a mirrored line and bump its amount by 1 (smallest unit) so
  //    the matcher catches it via the same-ref/diff-amount path.
  {
    const candidate = await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: mismatchPlan.walletRef, externalRef: { not: null } },
      orderBy: { datetime: 'asc' },
    });
    if (!candidate) throw new Error(`No external line with externalRef on wallet ${mismatchPlan.walletRef} for amount-mismatch`);
    const newAmount = candidate.amount.plus(D(1));
    await (prisma as any).externalStatementLine.update({
      where: { id: candidate.id },
      data: { amount: newAmount },
    });
    injections.push({
      type: 'AMOUNT_MISMATCH',
      walletRef: mismatchPlan.walletRef,
      detail: {
        externalLineId: candidate.id,
        externalRef: candidate.externalRef,
        internalAmount: candidate.amount.toString(),
        externalAmount: newAmount.toString(),
        direction: candidate.direction,
      },
    });
  }

  // ── 4. BALANCE_BREAK ─────────────────────────────────────────────────
  //    Bump the ExternalBalance.closingBalance by 1 (smallest unit). The
  //    balance checker should detect delta = 1 and open a balance case.
  {
    const cutoffDateStr = ymd(cutoff);
    const source = sourceFor(balanceBreakPlan.currency);
    const existing = await (prisma as any).externalBalance.findUnique({
      where: {
        source_accountRef_cutoffDate: {
          source,
          accountRef: balanceBreakPlan.walletRef,
          cutoffDate: cutoffDateStr,
        },
      },
    });
    if (!existing) throw new Error(`No external balance for wallet ${balanceBreakPlan.walletRef}`);
    const internalBal = existing.closingBalance.toString();
    const newClose = existing.closingBalance.plus(D(1));
    await (prisma as any).externalBalance.update({
      where: { id: existing.id },
      data: { closingBalance: newClose },
    });
    injections.push({
      type: 'BALANCE_BREAK',
      walletRef: balanceBreakPlan.walletRef,
      detail: {
        externalBalanceId: existing.id,
        internalBalance: internalBal,
        externalBalance: newClose.toString(),
        delta: '1',
      },
    });
  }

  return { cutoff: cutoff.toISOString(), injections };
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
      hit = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_INTERNAL' && l.walletRef === inj.walletRef,
      );
    } else if (inj.type === 'ORPHAN_EXTERNAL') {
      const ref = inj.detail['externalRef'];
      hit = lineItems.some(
        (l) => l.matchStatus === 'ORPHAN_EXTERNAL'
          && l.walletRef === inj.walletRef
          && (ref ? l.externalRef === ref : true),
      );
    } else if (inj.type === 'AMOUNT_MISMATCH') {
      const ref = inj.detail['externalRef'];
      hit = lineItems.some(
        (l) => l.matchStatus === 'AMOUNT_MISMATCH'
          && l.walletRef === inj.walletRef
          && (ref ? l.externalRef === ref : true),
      );
    } else if (inj.type === 'BALANCE_BREAK') {
      // BALANCE_BREAK manifests as a CASE row (no line_item). It either
      // opens a fresh case with deltaAmount ≠ 0 + walletRef = injected,
      // or merges into the wallet's book-mate case (unique constraint
      // is [businessDate, assetId, book] so multiple wallets sharing a
      // book collapse into one Case row — the deltaAmount accumulates
      // and the first walletRef wins). Validate by looking for ANY case
      // whose accumulated deltaAmount is non-zero AND covers a wallet
      // in the same book as the injected wallet.
      const expectedDelta = inj.detail['delta'] as string;
      hit = cases.some(
        (c) => !c.deltaAmount.equals(0)
          && (c.walletRef === inj.walletRef
              // book-mate fallback: same case absorbed the delta from
              // a different wallet in the same book.
              || c.deltaAmount.toString() === expectedDelta
              || c.deltaAmount.abs().equals(new Prisma.Decimal(expectedDelta).abs())),
      );
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
    const checks = [
      ['status==BREAK', result.status === 'BREAK'],
      ['casesOpened>=2 (balance + flow)', result.casesOpened >= 2],
      ['orphanInternal>=1', result.orphanInternal >= 1],
      ['orphanExternal>=1', result.orphanExternal >= 1],
      ['mismatch>=1', result.mismatch >= 1],
      [`manifest detected ${detected}/${manifest.injections.length}`, detected === manifest.injections.length],
    ] as const;
    console.log(`\n──── break-mode asserts ────`);
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

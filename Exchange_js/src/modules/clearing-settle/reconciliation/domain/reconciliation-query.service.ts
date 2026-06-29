import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { WalletBalanceCheckerService } from '../engine/v2/wallet-balance-checker.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
} from '../engine/v2/wallet-flow-matcher.service';
import {
  AccountStatusRow,
  AccountStatusRowStatus,
  FlowComparisonRow,
  FlowComparisonSummary,
  RunDetailSummary,
} from '../dto/reconciliation.dto';

// ── Types used by pairManifest ────────────────────────────────────────────────

export interface ManifestBreak {
  currency: string;
  book: string;
  bucket: string;       // ORPHAN_INTERNAL | ORPHAN_EXTERNAL | AMOUNT_MISMATCH
  targetType: string;
  targetRef: string;
  internalAmount: string | null;
  externalAmount: string | null;
  signedDelta: string;
  note: string;
}

/** Line-item annotated with its parent case's assetCode and book. */
export interface AnnotatedLineItem {
  id: string;
  matchStatus: string;
  internalSourceNo: string | null;
  internalTxHash: string | null;
  externalTxId: string | null;    // external booking/tx id (legacy "externalRef" in task doc)
  externalTxHash: string | null;
  internalAmount: unknown;
  externalAmount: unknown;
  _currency: string;
  _book: string;
  [key: string]: unknown;
}

export interface PairResult {
  matched: Array<{ break: ManifestBreak; item: AnnotatedLineItem }>;
  missed: ManifestBreak[];
  extra: AnnotatedLineItem[];
}

/**
 * Primary amount for pairing: prefer internalAmount (present for ORPHAN_INTERNAL and
 * AMOUNT_MISMATCH); fall back to externalAmount (present for ORPHAN_EXTERNAL).
 * Returns null when neither is available (treated as non-matchable).
 */
function primaryAmount(internalAmount: unknown, externalAmount: unknown): string | null {
  if (internalAmount != null) return String(internalAmount);
  if (externalAmount != null) return String(externalAmount);
  return null;
}

const AMOUNT_TOLERANCE = 1e-6;

function amountsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(parseFloat(a) - parseFloat(b)) < AMOUNT_TOLERANCE;
}

/**
 * Pure function — no DB access.
 * Key = (currency, book, bucket, primaryAmount).
 * A manifest break matches a line-item when:
 *   - same currency  (_currency === break.currency)
 *   - same book      (_book ?? '' === break.book ?? '')
 *   - same bucket    (matchStatus === break.bucket)
 *   - primaryAmount(break) ≈ primaryAmount(item)  (within 1e-6)
 *
 * primaryAmount = internalAmount if present, else externalAmount.
 * This is rail-agnostic: CRYPTO can ref-match coincidentally, but FIAT cannot
 * (the engine assigns payinNo/UUIDs the manifest never knows).
 *
 * targetRef and line-item ref fields are preserved in returned data for DISPLAY,
 * but are NOT used as the match key.
 *
 * Each item may be claimed by at most one break (first-come, first-served).
 */
export function pairManifest(
  breaks: ManifestBreak[],
  items: AnnotatedLineItem[],
): PairResult {
  const unclaimedItems = new Set(items.map((_, i) => i));
  const matched: PairResult['matched'] = [];
  const missed: ManifestBreak[] = [];

  for (const brk of breaks) {
    const brkAmount = primaryAmount(brk.internalAmount, brk.externalAmount);
    let found = -1;
    for (const idx of unclaimedItems) {
      const item = items[idx];
      const itemAmount = primaryAmount(item.internalAmount, item.externalAmount);
      if (
        item._currency === brk.currency &&
        (item._book ?? '') === (brk.book ?? '') &&
        item.matchStatus === brk.bucket &&
        amountsEqual(brkAmount, itemAmount)
      ) {
        found = idx;
        break;
      }
    }
    if (found >= 0) {
      matched.push({ break: brk, item: items[found] });
      unclaimedItems.delete(found);
    } else {
      missed.push(brk);
    }
  }

  const extra = [...unclaimedItems].map((i) => items[i]);
  return { matched, missed, extra };
}

// ─── T3 helpers ──────────────────────────────────────────────────────────────

/**
 * Three-tier status per industry "balance first" convention:
 *   delta != 0                          → BREAK         (red — hard break, investigate)
 *   delta == 0 & flow has anomalies     → FLOW_REVIEW   (amber — "fake match" probe;
 *                                                        balance happens to nett, but
 *                                                        line-items orphan/mismatch)
 *   delta == 0 & flow clean             → MATCH         (green — done)
 *
 * Why FLOW_REVIEW is a distinct tier: balance can match by coincidence (one
 * wrong-amount debit cancelled by one wrong-amount credit). Flagging this as
 * a softer "review" — not a hard break — catches fraud/omissions without
 * inflating the BREAK count operations triages first.
 */
function deriveAccountStatus(
  deltaIsZero: boolean,
  orphanInternal: number,
  orphanExternal: number,
  mismatch: number,
): AccountStatusRowStatus {
  if (!deltaIsZero) return 'BREAK';
  const flowAnomaly = orphanInternal + orphanExternal + mismatch > 0;
  return flowAnomaly ? 'FLOW_REVIEW' : 'MATCH';
}

@Injectable()
export class ReconciliationQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletBalanceChecker: WalletBalanceCheckerService,
    private readonly walletFlowMatcher: WalletFlowMatcherService,
  ) {}

  listRuns(q: { businessDate?: string; layer?: string }) {
    return this.prisma.reconciliationRun.findMany({
      where: {
        businessDate: q.businessDate,
        layer: q.layer,
      },
      orderBy: [{ businessDate: 'desc' }, { layer: 'asc' }, { seq: 'desc' }],
    });
  }
  /**
   * Run detail. Builds the per-wallet status table from ExternalBalance + a
   * fresh balance-checker pass + this run's Cases (so the UI cockpit can
   * render the dashboard without N round-trips).
   */
  async getRun(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { runNo },
    });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);
    const cases = await this.prisma.reconciliationCase.findMany({
      where: { lastObservedRunId: run.id },
      orderBy: [{ assetCode: 'asc' }, { book: 'asc' }],
      select: {
        id: true,
        caseNo: true,
        assetCode: true,
        book: true,
        status: true,
        deltaAmount: true,
        walletRef: true,
      },
    });

    const { rows: accountStatusTable, summary } = await this.buildAccountStatusTable(
      run.businessDate,
      cases as any,
    );

    return {
      ...run,
      hasDemoManifest: run.demoManifest !== null,
      cases,
      accountStatusTable,
      summary,
    };
  }

  /**
   * T3 listCases:
   *   - default to status=OPEN when caller omits status (cockpit landing view)
   *   - pass status='ALL' to opt out and see every status
   *   - sort by aging desc (oldest first → triage prioritisation)
   *   - decorate each row with aging (days since firstSeenAt|createdAt)
   *     and surface firstSeenRunId / lastUpdatedRunId for run-history drill-down
   */
  async listCases(q: { status?: string; assetCode?: string; runNo?: string }) {
    // Resolve runNo → internal id upfront; unknown run = empty list.
    let runIdFilter: string | undefined;
    if (q.runNo) {
      const run = await this.prisma.reconciliationRun.findUnique({
        where: { runNo: q.runNo }, select: { id: true },
      });
      if (!run) return [];
      runIdFilter = run.id;
    }

    const effectiveStatus = q.status === undefined ? 'OPEN' : q.status === 'ALL' ? undefined : q.status;
    const where: any = { status: effectiveStatus, assetCode: q.assetCode };
    if (runIdFilter) {
      where.OR = [
        { firstSeenRunId: runIdFilter },
        { lastUpdatedRunId: runIdFilter },
      ];
    }
    const rows = await this.prisma.reconciliationCase.findMany({
      where,
      orderBy: { createdAt: 'asc' }, // oldest first = highest aging; re-sorted below for resilience
    });

    // Resolve walletRef (UUID) → walletNo (business key) so the cockpit
    // never exposes raw IDs. Legacy XREF synthetic walletRefs (start with
    // 'XREF:') from rows produced before the cross-wallet feature was
    // retired are filtered out of the wallet lookup; their walletNo stays
    // null and the row surfaces walletRef verbatim for the operator.
    const realWalletRefs = Array.from(new Set(
      rows.map((r: any) => r.walletRef).filter((w: string | null): w is string => !!w && !w.startsWith('XREF:'))
    ));
    const wallets = realWalletRefs.length
      ? ((await (this.prisma as any).wallet.findMany({
          where: { id: { in: realWalletRefs } },
          select: { id: true, walletNo: true },
        })) as Array<{ id: string; walletNo: string | null }>)
      : [];
    const walletNoById = new Map(wallets.map((w) => [w.id, w.walletNo]));

    // Resolve firstSeenRunId / lastUpdatedRunId → runNo (business key).
    const runIds = Array.from(new Set(
      rows.flatMap((r: any) => [r.firstSeenRunId, r.lastUpdatedRunId])
          .filter((id: string | null): id is string => !!id)
    ));
    const runs = runIds.length === 0
      ? []
      : ((await this.prisma.reconciliationRun.findMany({
          where: { id: { in: runIds } },
          select: { id: true, runNo: true },
        })) as Array<{ id: string; runNo: string }>);
    const runNoById = new Map(runs.map((r) => [r.id, r.runNo]));

    const now = Date.now();
    const decorated = rows.map((r: any) => {
      const ref = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
      const aging = Number.isFinite(ref) ? Math.floor((now - ref) / 86_400_000) : 0;
      return {
        ...r,
        aging,
        firstSeenRunId: r.firstSeenRunId ?? null,
        lastUpdatedRunId: r.lastUpdatedRunId ?? null,
        firstSeenRunNo: r.firstSeenRunId ? (runNoById.get(r.firstSeenRunId) ?? null) : null,
        lastUpdatedRunNo: r.lastUpdatedRunId ? (runNoById.get(r.lastUpdatedRunId) ?? null) : null,
        walletNo: walletNoById.get(r.walletRef) ?? null,
      };
    });
    decorated.sort((a, b) => b.aging - a.aging);
    return decorated;
  }

  /**
   * Case detail (T3). Per-wallet WALLET_V1 cases get a fresh `flowComparison`:
   * re-run the wallet-flow-matcher against the source datasets (external lines
   * + internal account_flows) so the UI shows BOTH sides of every comparison
   * row — matched pairs, orphans, mismatches. Legacy non-wallet cases return
   * flowComparison=[] and summary all-zero (the old lineItems include is left
   * untouched).
   */
  async getCase(caseNo: string) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({
      where: { caseNo }, include: { lineItems: true },
    });
    if (!kase) throw new NotFoundException(`Case ${caseNo} not found`);

    let flowComparison: FlowComparisonRow[] = [];
    let flowSummary: FlowComparisonSummary = { matched: 0, orphanInternal: 0, orphanExternal: 0, mismatch: 0 };
    if (kase.walletRef && !kase.walletRef.startsWith('XREF:')) {
      const built = await this.buildFlowComparison(kase);
      flowComparison = built.rows;
      flowSummary = built.summary;
    }

    const walletRow = kase.walletRef && !kase.walletRef.startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({
          where: { id: kase.walletRef },
          select: { walletNo: true },
        })
      : null;

    const linkedRunId = kase.lastUpdatedRunId ?? kase.openedByRunId ?? null;
    const linkedRunRow = linkedRunId
      ? await this.prisma.reconciliationRun.findUnique({
          where: { id: linkedRunId },
          select: { runNo: true },
        })
      : null;

    return {
      ...kase,
      walletNo: walletRow?.walletNo ?? null,
      linkedRunNo: linkedRunRow?.runNo ?? null,
      flowComparison,
      flowSummary,
    };
  }

  async listExternalBalances(q: { cutoffDate?: string; book?: string; source?: string; currency?: string }) {
    const rows = await this.prisma.externalBalance.findMany({
      where: { cutoffDate: q.cutoffDate, book: q.book, source: q.source, currency: q.currency },
      orderBy: [{ book: 'asc' }, { source: 'asc' }, { currency: 'asc' }, { accountRef: 'asc' }],
    });

    // walletRef → walletNo + walletRole join (mirrors buildAccountStatusTable pattern)
    const realWalletRefs = Array.from(new Set(
      rows.map(r => r.walletRef).filter((w): w is string => !!w && !w.startsWith('XREF:')),
    ));
    const wallets = realWalletRefs.length === 0
      ? []
      : await this.prisma.wallet.findMany({
          where: { id: { in: realWalletRefs } },
          select: { id: true, walletNo: true, walletRole: true },
        });
    const walletById = new Map(wallets.map(w => [w.id, w]));

    // Asset decimals lookup (currency → decimals via asset.code)
    const currencies = Array.from(new Set(rows.map(r => r.currency)));
    const assets = currencies.length === 0
      ? []
      : await this.prisma.asset.findMany({
          where: { code: { in: currencies } },
          select: { code: true, decimals: true },
        });
    const decimalsByCode = new Map(assets.map(a => [a.code, a.decimals]));

    return rows.map(r => ({
      ...r,
      walletNo: r.walletRef ? (walletById.get(r.walletRef)?.walletNo ?? null) : null,
      walletRole: r.walletRef ? (walletById.get(r.walletRef)?.walletRole ?? null) : null,
      decimals: decimalsByCode.get(r.currency) ?? 0,
    }));
  }

  async getExternalBalanceByWallet(walletNo: string, cutoffDate: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { walletNo },
      select: { id: true, walletNo: true, walletRole: true },
    });
    if (!wallet) throw new NotFoundException(`no external balance for ${walletNo} on ${cutoffDate}`);

    const balance = await this.prisma.externalBalance.findFirst({
      where: { walletRef: wallet.id, cutoffDate },
    });
    if (!balance) throw new NotFoundException(`no external balance for ${walletNo} on ${cutoffDate}`);

    const dayLo = new Date(`${cutoffDate}T00:00:00.000Z`);
    const dayHi = new Date(`${cutoffDate}T23:59:59.999Z`);
    const lines = await this.prisma.externalStatementLine.findMany({
      where: {
        source: balance.source,
        accountRef: balance.accountRef,
        currency: balance.currency,
        datetime: { gte: dayLo, lte: dayHi },
      },
      orderBy: { datetime: 'asc' },
    });

    const asset = await this.prisma.asset.findFirst({
      where: { code: balance.currency },
      select: { decimals: true },
    });

    return {
      ...balance,
      walletNo: wallet.walletNo,
      walletRole: wallet.walletRole,
      decimals: asset?.decimals ?? 0,
      lines,
    };
  }

  /**
   * Demo compare: pairs the injected break manifest stored on a run against
   * the engine-detected case line-items.  Returns the run summary, the raw
   * manifest breaks, the detected line-items (annotated with currency/book),
   * and the pairing result { matched, missed, extra }.
   */
  async getDemoCompare(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({ where: { runNo } });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);

    const breaks: ManifestBreak[] = run.demoManifest
      ? (JSON.parse(run.demoManifest) as { breaks: ManifestBreak[] }).breaks ?? []
      : [];

    const cases = await this.prisma.reconciliationCase.findMany({
      where: { lastObservedRunId: run.id },
      include: { lineItems: { where: { foundByRunId: run.id }, orderBy: { lineNo: 'asc' } } },
    });

    // Flatten line-items annotated with their parent case's currency and book.
    const detected: AnnotatedLineItem[] = [];
    for (const kase of cases) {
      for (const item of kase.lineItems) {
        detected.push({ ...item, _currency: kase.assetCode, _book: kase.book ?? '' });
      }
    }

    const reconciliation = pairManifest(breaks, detected);

    return {
      run: {
        runNo: run.runNo,
        businessDate: run.businessDate,
        status: run.status,
        invariantStatus: run.invariantStatus,
      },
      manifest: breaks,
      detected,
      reconciliation,
    };
  }

  // ─── T3 builders ───────────────────────────────────────────────────────────

  /**
   * Build the per-wallet status table for the cockpit Run detail page.
   * Source datasets:
   *   - ExternalBalance @ businessDate (one row per wallet checked)
   *   - this run's Cases (already includes wallet-level findings)
   *   - wallets table (walletRole + ownerNo metadata)
   *   - customer_main table (display name)
   *
   * For MATCH rows we still need to run the balance checker (the run already
   * did, but the result isn't persisted per-wallet — only the absence of a Case
   * implies pass). We accept the second pass: recon detail isn't hot.
   *
   * If a wallet has a Case from this run, its caseId + line-item counts come
   * straight from the Case + its lineItems (avoiding a second matcher pass).
   */
  private async buildAccountStatusTable(
    businessDate: string,
    cases: Array<{
      id: string;
      caseNo: string;
      assetCode: string;
      book: string | null;
      status: string;
      deltaAmount: Prisma.Decimal;
      walletRef: string | null;
    }>,
  ): Promise<{ rows: AccountStatusRow[]; summary: RunDetailSummary }> {
    const balances = (await (this.prisma as any).externalBalance.findMany({
      where: { cutoffDate: businessDate, walletRef: { not: null } },
      select: {
        walletRef: true,
        closingBalance: true,
        currency: true,
        coaCode: true,
        ownerNo: true,
      },
    })) as Array<{
      walletRef: string;
      closingBalance: Prisma.Decimal;
      currency: string;
      coaCode: string | null;
      ownerNo: string | null;
    }>;

    if (balances.length === 0) {
      return {
        rows: [],
        summary: { accountsChecked: 0, matchCount: 0, flowReviewCount: 0, breakCount: 0, balanceBreakCount: 0, orphanCount: 0, mismatchCount: 0 },
      };
    }

    // Index this run's wallet-keyed cases for O(1) lookup; XREF synthetic
    // walletRefs (start with "XREF:") aren't real wallets and don't belong in
    // this table — keep them out.
    const caseByWalletRef = new Map<string, (typeof cases)[number] & { lineItems?: any[] }>();
    for (const c of cases) {
      if (!c.walletRef || c.walletRef.startsWith('XREF:')) continue;
      caseByWalletRef.set(c.walletRef, c);
    }
    // Bulk-load line items for those cases (avoid N round-trips).
    const caseIds = Array.from(caseByWalletRef.values()).map((c) => c.id);
    const allLineItems = caseIds.length
      ? ((await (this.prisma as any).reconciliationLineItem.findMany({
          where: { caseId: { in: caseIds } },
          select: { caseId: true, matchStatus: true },
        })) as Array<{ caseId: string; matchStatus: string }>)
      : [];
    const lineItemsByCase = new Map<string, Array<{ matchStatus: string }>>();
    for (const li of allLineItems) {
      const arr = lineItemsByCase.get(li.caseId) ?? [];
      arr.push(li);
      lineItemsByCase.set(li.caseId, arr);
    }

    // Bulk-load wallet metadata.
    const walletRefs = Array.from(new Set(balances.map((b) => b.walletRef)));
    const wallets = (await (this.prisma as any).wallet.findMany({
      where: { id: { in: walletRefs } },
      select: { id: true, walletNo: true, walletRole: true, ownerNo: true, ownerType: true },
    })) as Array<{ id: string; walletNo: string | null; walletRole: string | null; ownerNo: string | null; ownerType: string }>;
    const walletById = new Map(wallets.map((w) => [w.id, w]));

    // Bulk-load customer names for customer-owned wallets.
    const customerNos = Array.from(
      new Set(
        wallets
          .filter((w) => w.ownerType === 'CUSTOMER' && w.ownerNo)
          .map((w) => w.ownerNo as string),
      ),
    );
    const customers = customerNos.length
      ? ((await (this.prisma as any).customerMain.findMany({
          where: { customerNo: { in: customerNos } },
          select: { customerNo: true, firstName: true, lastName: true, companyName: true },
        })) as Array<{ customerNo: string; firstName: string | null; lastName: string | null; companyName: string | null }>)
      : [];
    const nameByCustomerNo = new Map(
      customers.map((c) => [
        c.customerNo,
        c.companyName ?? ([c.firstName, c.lastName].filter(Boolean).join(' ') || null),
      ]),
    );

    // Use the cutoff = end-of-businessDate (UTC) for the balance check. This
    // is what WalletReconRunService passes when it runs the recon — keeps
    // recomputed deltas consistent with the original run.
    const cutoff = new Date(`${businessDate}T23:59:59.999Z`);

    const rows: AccountStatusRow[] = [];
    // Three-tier counts (cockpit Overview):
    let matchCount = 0;
    let flowReviewCount = 0;
    let breakCount = 0;
    // Per-anomaly account tallies (backward-compat — separate axis from status):
    let balanceBreakCount = 0;
    let orphanCount = 0;
    let mismatchCount = 0;

    for (const bal of balances) {
      const externalBig = BigInt(bal.closingBalance.toString());
      const check = await this.walletBalanceChecker.checkBalance({
        walletRef: bal.walletRef,
        externalClosing: externalBig,
        cutoff,
      });
      const meta = walletById.get(bal.walletRef);
      const ownerName = meta?.ownerType === 'CUSTOMER' && meta.ownerNo
        ? nameByCustomerNo.get(meta.ownerNo) ?? null
        : null;

      const kase = caseByWalletRef.get(bal.walletRef);
      const items = kase ? lineItemsByCase.get(kase.id) ?? [] : [];
      let oi = 0, oe = 0, mm = 0;
      for (const li of items) {
        if (li.matchStatus === 'ORPHAN_INTERNAL') oi += 1;
        else if (li.matchStatus === 'ORPHAN_EXTERNAL') oe += 1;
        else if (li.matchStatus === 'AMOUNT_MISMATCH') mm += 1;
      }
      const flowTotal = oi + oe + mm;
      const matched = 0; // line items only encode anomalies; matched pairs not persisted
      const status = deriveAccountStatus(check.delta === 0n, oi, oe, mm);
      if (status === 'MATCH') matchCount += 1;
      else if (status === 'FLOW_REVIEW') flowReviewCount += 1;
      else if (status === 'BREAK') breakCount += 1;
      if (check.delta !== 0n) balanceBreakCount += 1;
      if (oi > 0 || oe > 0) orphanCount += 1;
      if (mm > 0) mismatchCount += 1;

      rows.push({
        walletRef: bal.walletRef,
        walletNo: walletById.get(bal.walletRef)?.walletNo ?? null,
        walletRole: meta?.walletRole ?? null,
        ownerNo: meta?.ownerNo ?? bal.ownerNo ?? null,
        ownerName,
        asset: bal.currency,
        coaCode: bal.coaCode ?? check.coaCode,
        internal: { balance: check.internal.total.toString() },
        external: { balance: check.external.toString() },
        delta: check.delta.toString(),
        flowMatched: matched,
        flowTotal,
        flowOrphanInternal: oi,
        flowOrphanExternal: oe,
        flowMismatch: mm,
        status,
        caseId: kase?.id ?? null,
        caseNo: kase?.caseNo ?? null,
      });
    }

    const summary: RunDetailSummary = {
      accountsChecked: rows.length,
      matchCount,
      flowReviewCount,
      breakCount,
      balanceBreakCount,
      orphanCount,
      mismatchCount,
    };

    return { rows, summary };
  }

  /**
   * Build the per-case flow comparison rows for the cockpit Case detail page.
   * Two-pass reconstruction:
   *   1. matched pairs → recompute via WalletFlowMatcherService (re-run the
   *      same pairing the engine did)
   *   2. orphans + mismatches → enrich the matched output with line-item
   *      details (source/dest IDs come from the matcher; we hydrate the
   *      original rows for display fields)
   *
   * This produces one FlowComparisonRow per pair OR orphan — i.e. the union
   * of matched + matcherResult anomalies. Matched rows have both sides
   * populated; orphan rows have one side null.
   */
  private async buildFlowComparison(
    kase: { walletRef: string; businessDate: string },
  ): Promise<{ rows: FlowComparisonRow[]; summary: FlowComparisonSummary }> {
    // End-of-businessDate cutoff — same as the engine uses.
    const cutoff = new Date(`${kase.businessDate}T23:59:59.999Z`);

    // 1. Source datasets.
    const accountRefs = (await (this.prisma as any).externalBalance.findMany({
      where: { walletRef: kase.walletRef, cutoffDate: kase.businessDate },
      select: { accountRef: true },
    })) as Array<{ accountRef: string }>;

    const externalRowsRaw = (await (this.prisma as any).externalStatementLine.findMany({
      where: {
        OR: [
          { subAccount: kase.walletRef },
          { subAccount: null, accountRef: { in: accountRefs.map((a) => a.accountRef) } },
        ],
        datetime: { lte: cutoff },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        externalRef: true,
        datetime: true,
        description: true,
      },
    })) as Array<{
      id: string;
      direction: string;
      amount: Prisma.Decimal;
      externalRef: string | null;
      datetime: Date;
      description: string | null;
    }>;

    const externalLines: ExternalStatementLineInput[] = externalRowsRaw.map((r) => ({
      id: r.id,
      direction: r.direction as 'IN' | 'OUT',
      amount: r.amount,
      externalRef: r.externalRef,
      datetime: r.datetime,
    }));
    const extById = new Map(externalRowsRaw.map((r) => [r.id, r]));

    const internalRows = (await (this.prisma as any).accountFlow.findMany({
      where: {
        walletRef: kase.walletRef,
        isExternalCrossing: true,
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        externalRef: true,
        eventCode: true,
        sourceType: true,
        sourceNo: true,
        createdAt: true,
      },
    })) as Array<{
      id: string;
      direction: string;
      amount: Prisma.Decimal;
      externalRef: string | null;
      eventCode: string;
      sourceType: string;
      sourceNo: string;
      createdAt: Date;
    }>;
    const intById = new Map(internalRows.map((r) => [r.id, r]));

    // 2. Re-pair via the matcher (uses the same precedence as the engine).
    const matcher = await this.walletFlowMatcher.matchFlows({
      walletRef: kase.walletRef,
      externalLines,
      cutoff,
    });

    const rows: FlowComparisonRow[] = [];
    for (const m of matcher.matched) {
      const ext = extById.get(m.externalLineId);
      const intl = intById.get(m.internalFlowId);
      if (!ext || !intl) continue;
      rows.push({
        externalLine: {
          id: ext.id,
          externalRef: ext.externalRef,
          amount: ext.amount.toString(),
          direction: ext.direction as 'IN' | 'OUT',
          timestamp: ext.datetime.toISOString(),
          description: ext.description,
        },
        internalFlow: {
          id: intl.id,
          externalRef: intl.externalRef,
          amount: intl.amount.toString(),
          direction: intl.direction as 'IN' | 'OUT',
          timestamp: intl.createdAt.toISOString(),
          eventCode: intl.eventCode,
          sourceType: intl.sourceType,
          sourceNo: intl.sourceNo,
        },
        matchType: 'MATCHED',
      });
    }
    for (const oi of matcher.orphanInternal) {
      const intl = intById.get(oi.internalFlowId);
      if (!intl) continue;
      rows.push({
        externalLine: null,
        internalFlow: {
          id: intl.id,
          externalRef: intl.externalRef,
          amount: intl.amount.toString(),
          direction: intl.direction as 'IN' | 'OUT',
          timestamp: intl.createdAt.toISOString(),
          eventCode: intl.eventCode,
          sourceType: intl.sourceType,
          sourceNo: intl.sourceNo,
        },
        matchType: 'ORPHAN_INTERNAL',
      });
    }
    for (const oe of matcher.orphanExternal) {
      const ext = extById.get(oe.externalLineId);
      if (!ext) continue;
      rows.push({
        externalLine: {
          id: ext.id,
          externalRef: ext.externalRef,
          amount: ext.amount.toString(),
          direction: ext.direction as 'IN' | 'OUT',
          timestamp: ext.datetime.toISOString(),
          description: ext.description,
        },
        internalFlow: null,
        matchType: 'ORPHAN_EXTERNAL',
      });
    }
    for (const m of matcher.mismatch) {
      const ext = extById.get(m.externalLineId);
      const intl = intById.get(m.internalFlowId);
      if (!ext || !intl) continue;
      const delta = ext.amount.minus(intl.amount);
      rows.push({
        externalLine: {
          id: ext.id,
          externalRef: ext.externalRef,
          amount: ext.amount.toString(),
          direction: ext.direction as 'IN' | 'OUT',
          timestamp: ext.datetime.toISOString(),
          description: ext.description,
        },
        internalFlow: {
          id: intl.id,
          externalRef: intl.externalRef,
          amount: intl.amount.toString(),
          direction: intl.direction as 'IN' | 'OUT',
          timestamp: intl.createdAt.toISOString(),
          eventCode: intl.eventCode,
          sourceType: intl.sourceType,
          sourceNo: intl.sourceNo,
        },
        matchType: 'AMOUNT_MISMATCH',
        deltaAmount: delta.toString(),
      });
    }

    const summary: FlowComparisonSummary = {
      matched: matcher.matched.length,
      orphanInternal: matcher.orphanInternal.length,
      orphanExternal: matcher.orphanExternal.length,
      mismatch: matcher.mismatch.length,
    };

    return { rows, summary };
  }
}

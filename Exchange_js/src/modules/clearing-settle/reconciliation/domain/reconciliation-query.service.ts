import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
} from '../engine/v2/wallet-flow-matcher.service';
import { effectiveCutoffFilter } from '../engine/v2/effective-cutoff';
import {
  AccountStatusRow,
  CaseExplain,
  CaseObservation,
  FlowComparisonRow,
  FlowComparisonSummary,
  ReconRunDetail,
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

@Injectable()
export class ReconciliationQueryService {
  constructor(
    private readonly prisma: PrismaService,
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
   * Run detail (T6). Reads the per-wallet status table straight from the
   * reconciliation_run_wallets snapshot rows the orchestrator wrote at run
   * time (T5) — no balanceChecker/matcher recompute. Runs from before the
   * snapshot table existed have zero snapshot rows; those are flagged
   * `legacy: true` so the UI can show a "no per-wallet detail" notice
   * instead of a misleading empty "all clear" table.
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

    const runWallets = (await (this.prisma as any).reconciliationRunWallet.findMany({
      where: { runId: run.id },
      orderBy: [{ assetCode: 'asc' }, { book: 'asc' }],
    })) as Array<{
      walletRef: string;
      assetCode: string;
      book: string;
      coaCode: string | null;
      ownerNo: string | null;
      bucket: string;
      internalTotal: Prisma.Decimal;
      externalClosing: Prisma.Decimal;
      deltaAmount: Prisma.Decimal;
      inTransitAmount: Prisma.Decimal;
      matchedCount: number;
      orphanInternal: number;
      orphanExternal: number;
      mismatchCount: number;
      inTransitCount: number;
      caseNo: string | null;
    }>;

    const legacy = runWallets.length === 0;

    // walletRef → walletNo/walletRole join (mirrors the pattern used by
    // listExternalBalances / listCases); XREF synthetic refs never resolve.
    const realWalletRefs = Array.from(new Set(
      runWallets.map((w) => w.walletRef).filter((w) => !w.startsWith('XREF:')),
    ));
    const wallets = realWalletRefs.length
      ? ((await (this.prisma as any).wallet.findMany({
          where: { id: { in: realWalletRefs } },
          select: { id: true, walletNo: true, walletRole: true },
        })) as Array<{ id: string; walletNo: string | null; walletRole: string | null }>)
      : [];
    const walletById = new Map(wallets.map((w) => [w.id, w]));

    // T4 (canon2): asset decimals per row so the display layer can scale each
    // wallet's amounts (分) back to 元 by its own asset's precision — a run
    // spans multiple assets (AED=2, USDT=6). Same lookup as listExternalBalances:
    // asset table by currency code, never hardcoded.
    const runAssetCodes = Array.from(new Set(runWallets.map((w) => w.assetCode)));
    const runAssets = runAssetCodes.length
      ? ((await (this.prisma as any).asset.findMany({
          where: { code: { in: runAssetCodes } },
          select: { code: true, decimals: true },
        })) as Array<{ code: string; decimals: number }>)
      : [];
    const decimalsByCode = new Map(runAssets.map((a) => [a.code, a.decimals]));

    const accountStatusTable: AccountStatusRow[] = legacy ? [] : runWallets.map((w) => ({
      walletRef: w.walletRef,
      walletNo: walletById.get(w.walletRef)?.walletNo ?? null,
      walletRole: walletById.get(w.walletRef)?.walletRole ?? null,
      asset: w.assetCode,
      decimals: decimalsByCode.get(w.assetCode) ?? 0,
      book: w.book,
      coaCode: w.coaCode,
      ownerNo: w.ownerNo,
      internal: { balance: w.internalTotal.toString() },
      external: { balance: w.externalClosing.toString() },
      delta: w.deltaAmount.toString(),
      inTransitAmount: w.inTransitAmount.toString(),
      flowMatched: w.matchedCount,
      flowTotal: w.matchedCount + w.orphanInternal + w.orphanExternal + w.mismatchCount,
      flowOrphanInternal: w.orphanInternal,
      flowOrphanExternal: w.orphanExternal,
      flowMismatch: w.mismatchCount,
      inTransitCount: w.inTransitCount,
      bucket: w.bucket as AccountStatusRow['bucket'],
      caseId: null,
      caseNo: w.caseNo,
    }));

    const summary: RunDetailSummary = {
      walletCount: run.walletCount,
      matchedCount: run.matchedCount,
      inTransitCount: run.inTransitCount,
      softFlagCount: run.softFlagCount,
      breakCount: run.breakCount,
      openedCount: run.openedCount,
      reObservedCount: run.reObservedCount,
      closedCount: run.closedCount,
    };

    const result: ReconRunDetail = {
      ...run,
      hasDemoManifest: run.demoManifest !== null,
      cases,
      accountStatusTable,
      summary,
      legacy,
    };
    return result;
  }

  /**
   * T3 listCases:
   *   - default to status=OPEN when caller omits status (cockpit landing view)
   *   - pass status='ALL' to opt out and see every status
   *   - sort by aging desc (oldest first → triage prioritisation)
   *   - decorate each row with aging (days since firstSeenAt|createdAt)
   *     and surface firstSeenRunId / lastUpdatedRunId for run-history drill-down
   */
  async listCases(q: { status?: string; assetCode?: string; runNo?: string; bucket?: string }) {
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
    const where: any = { status: effectiveStatus, assetCode: q.assetCode, bucket: q.bucket };
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
   * Case detail (T3 + T6). Per-wallet WALLET_V1 cases get a fresh
   * `flowComparison`: re-run the wallet-flow-matcher against the source
   * datasets (external lines + internal account_flows) so the UI shows BOTH
   * sides of every comparison row — matched pairs, orphans, mismatches.
   * Legacy non-wallet cases return flowComparison=[] and summary all-zero
   * (the old lineItems include is left untouched).
   *
   * T6 additions:
   *   - explain: residual decomposition (delta = inTransitSigned + residual)
   *   - observation: first/last-seen run history + re-observation count +
   *     close run + aging (mirrors the bucket-classifier's residual math —
   *     see engine/v2/bucket-classifier.ts)
   *   - bucket surfaced straight from the case row
   *   - IN_TRANSIT line items appended to flowComparison with fundsOrderNo
   *   - buildFlowComparison's cutoff now reads the lastObservedRunId run's
   *     businessDate instead of the case's own (frozen-at-first-seen)
   *     businessDate — a case re-observed on a later day must compare
   *     against that day's data, not the day it was first opened (T5 §2.5
   *     made cases cross-day; this closes the resulting cutoff drift).
   */
  async getCase(caseNo: string) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({
      where: { caseNo }, include: { lineItems: true },
    });
    if (!kase) throw new NotFoundException(`Case ${caseNo} not found`);

    // Resolve the run history references up front — lastObservedRun's
    // businessDate also drives buildFlowComparison's cutoff below.
    const [firstSeenRun, lastObservedRun, closedByRun] = await Promise.all([
      kase.firstSeenRunId
        ? this.prisma.reconciliationRun.findUnique({
            where: { id: kase.firstSeenRunId },
            select: { runNo: true, startedAt: true },
          })
        : Promise.resolve(null),
      kase.lastObservedRunId
        ? this.prisma.reconciliationRun.findUnique({
            where: { id: kase.lastObservedRunId },
            select: { runNo: true, businessDate: true, completedAt: true },
          })
        : Promise.resolve(null),
      kase.status === 'RESOLVED' && kase.closedByRunId
        ? this.prisma.reconciliationRun.findUnique({
            where: { id: kase.closedByRunId },
            select: { runNo: true },
          })
        : Promise.resolve(null),
    ]);

    let flowComparison: FlowComparisonRow[] = [];
    let flowSummary: FlowComparisonSummary = { matched: 0, orphanInternal: 0, orphanExternal: 0, mismatch: 0 };
    if (kase.walletRef && !kase.walletRef.startsWith('XREF:')) {
      // Cutoff = the businessDate of the run that most recently observed this
      // case, not kase.businessDate (frozen at first-seen under cross-day reuse).
      const cutoffBusinessDate = lastObservedRun?.businessDate ?? kase.businessDate;
      const built = await this.buildFlowComparison({ walletRef: kase.walletRef, businessDate: cutoffBusinessDate, assetCode: kase.assetCode });
      flowComparison = built.rows;
      flowSummary = built.summary;
    }

    // T6: append persisted IN_TRANSIT line items — these aren't reconstructed
    // by buildFlowComparison's live matcher re-run (that only replays
    // matched/orphan/mismatch); IN_TRANSIT is sourced straight from the
    // case's own lineItems, which T5 already writes with internalSourceNo =
    // the explaining funds order's business number.
    const inTransitLineItems = (kase.lineItems ?? []).filter((li: any) => li.matchStatus === 'IN_TRANSIT');

    // T4 (push disposition): decorate each in-transit row with the explaining
    // funds order's current status so the cockpit can badge "已推进·待重对账"
    // (funds order已 CLEARED but the case is still OPEN — a rerun will close it).
    // ONE batched `in` query keyed on the collected fundsOrderNos — no N+1.
    const inTransitFundsOrderNos = Array.from(new Set(
      inTransitLineItems
        .map((li: any) => li.internalSourceNo)
        .filter((no: string | null): no is string => !!no),
    ));
    const fundsOrderStatusByNo = new Map<string, string>();
    if (inTransitFundsOrderNos.length > 0) {
      const fundsOrders = (await (this.prisma as any).fundsOrder.findMany({
        where: { fundsOrderNo: { in: inTransitFundsOrderNos } },
        select: { fundsOrderNo: true, status: true },
      })) as Array<{ fundsOrderNo: string; status: string }>;
      for (const fo of fundsOrders) fundsOrderStatusByNo.set(fo.fundsOrderNo, fo.status);
    }

    // Task 6 (调账单标记): 按 lineItemId 批量查 reconciliation_adjustments，把
    // { adjustmentNo, status } 挂到每条差异项（kase.lineItems）上——前端据此把
    // 已开单的行置灰。ONE batched `in` query keyed on the case's lineItem ids —
    // 同上一段 in-transit 补单子状态的写法，no N+1。同一 lineItemId 若曾开过多张
    // 单（如首张被 REJECTED 后重开），按 createdAt 升序覆盖，保留最新一张的状态。
    const allLineItemIds = (kase.lineItems ?? []).map((li: any) => li.id);
    const adjustmentByLineItemId = new Map<string, { adjustmentNo: string; status: string }>();
    if (allLineItemIds.length > 0) {
      const adjustments = (await (this.prisma as any).reconciliationAdjustment.findMany({
        where: { lineItemId: { in: allLineItemIds } },
        select: { lineItemId: true, adjustmentNo: true, status: true },
        orderBy: { createdAt: 'asc' },
      })) as Array<{ lineItemId: string | null; adjustmentNo: string; status: string }>;
      for (const adj of adjustments) {
        if (adj.lineItemId) adjustmentByLineItemId.set(adj.lineItemId, { adjustmentNo: adj.adjustmentNo, status: adj.status });
      }
    }
    const decoratedLineItems = (kase.lineItems ?? []).map((li: any) => ({
      ...li,
      adjustment: adjustmentByLineItemId.get(li.id) ?? null,
    }));

    for (const li of inTransitLineItems) {
      const fundsOrderNo = li.internalSourceNo ?? null;
      flowComparison.push({
        externalLine: {
          id: li.externalTxId ?? undefined,
          externalRef: li.externalRef ?? null,
          amount: li.externalAmount != null ? li.externalAmount.toString() : '0',
          direction: (li.externalDirection ?? 'IN') as 'IN' | 'OUT',
          timestamp: li.externalTimestamp ? li.externalTimestamp.toISOString() : new Date(0).toISOString(),
          description: null,
        },
        internalFlow: null,
        matchType: 'IN_TRANSIT',
        fundsOrderNo,
        fundsOrderStatus: fundsOrderNo ? (fundsOrderStatusByNo.get(fundsOrderNo) ?? null) : null,
      });
    }

    const walletRow = kase.walletRef && !kase.walletRef.startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({
          where: { id: kase.walletRef },
          select: { walletNo: true },
        })
      : null;

    // T4 (canon2): the display layer scales every amount by 10^decimals to turn
    // integer base units (分) back into 元. Same source as listExternalBalances
    // and buildFlowComparison — asset table by currency code, never hardcoded.
    const assetRow = (await (this.prisma as any).asset.findUnique({
      where: { code: kase.assetCode },
      select: { decimals: true },
    })) as { decimals: number } | null;

    const linkedRunId = kase.lastUpdatedRunId ?? kase.openedByRunId ?? null;
    const linkedRunRow = linkedRunId
      ? await this.prisma.reconciliationRun.findUnique({
          where: { id: linkedRunId },
          select: { runNo: true },
        })
      : null;

    // explain: delta = inTransitSigned + residual (bucket-classifier's
    // residual formula — see engine/v2/bucket-classifier.ts).
    const inTransitSigned = inTransitLineItems.reduce(
      (sum: Prisma.Decimal, li: any) => {
        const amt = li.externalAmount ?? new Prisma.Decimal(0);
        return li.externalDirection === 'OUT' ? sum.minus(amt) : sum.plus(amt);
      },
      new Prisma.Decimal(0),
    );
    const delta = kase.deltaAmount as Prisma.Decimal;
    const explain: CaseExplain = {
      internalTotal: (kase.tbAmount as Prisma.Decimal).toString(),
      externalClosing: (kase.actualExternal as Prisma.Decimal).toString(),
      delta: delta.toString(),
      inTransitSigned: inTransitSigned.toString(),
      residual: delta.minus(inTransitSigned).toString(),
    };

    // reObservedCount: distinct foundByRunId among this case's line items,
    // minus the first observation (opening the case doesn't count as a
    // re-observation).
    // KNOWN LIMITATION: this is currently always 0 — T5's line items are
    // delete-then-insert on every rerun (see writeLineItems, called from
    // upsertCaseForWallet in wallet-recon-run.service.ts), so foundByRunId
    // only ever holds the most recent run's id and the distinct count is
    // always 1. A correct fix needs either a dedicated counter column on
    // ReconciliationCase (incremented in upsertCaseForWallet's `existing`
    // branch) or a change to the line-item accumulation strategy — both are
    // out of scope for T6 and left for a follow-up task.
    const distinctFoundByRuns = new Set((kase.lineItems ?? []).map((li: any) => li.foundByRunId));
    const reObservedCount = Math.max(0, distinctFoundByRuns.size - 1);

    const ageDays = kase.status === 'OPEN'
      ? Math.floor((Date.now() - new Date(kase.createdAt).getTime()) / 86_400_000)
      : null;

    const observation: CaseObservation = {
      firstSeenRunNo: firstSeenRun?.runNo ?? null,
      firstSeenAt: firstSeenRun?.startedAt ? firstSeenRun.startedAt.toISOString() : null,
      lastObservedRunNo: lastObservedRun?.runNo ?? null,
      reObservedCount,
      closedByRunNo: closedByRun?.runNo ?? null,
      ageDays,
    };

    return {
      ...kase,
      lineItems: decoratedLineItems,
      walletNo: walletRow?.walletNo ?? null,
      linkedRunNo: linkedRunRow?.runNo ?? null,
      decimals: assetRow?.decimals ?? 0,
      bucket: kase.bucket ?? null,
      flowComparison,
      flowSummary,
      explain,
      observation,
    };
  }

  async listExternalBalances(q: { cutoffDate?: string; book?: string; source?: string; currency?: string }) {
    const rows = await this.prisma.externalBalance.findMany({
      where: { cutoffDate: q.cutoffDate, book: q.book, source: q.source, currency: q.currency },
      orderBy: [{ book: 'asc' }, { source: 'asc' }, { currency: 'asc' }, { accountRef: 'asc' }],
    });

    // walletRef → walletNo + walletRole join (mirrors getRun's runWallets join pattern)
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
    kase: { walletRef: string; businessDate: string; assetCode: string },
  ): Promise<{ rows: FlowComparisonRow[]; summary: FlowComparisonSummary }> {
    // T6: cutoff comes from kase.businessDate here, but the CALLER (getCase)
    // now passes the businessDate of the case's lastObservedRunId run — not
    // the case's own frozen businessDate (which stays pinned to the
    // first-seen day under cross-day case reuse, T5 §2.5). Using the stale
    // first-seen day here would compare against day-old external/internal
    // data after a case has been re-observed on a later day.
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
        ...effectiveCutoffFilter(cutoff),
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
    // Pass this case's real asset.decimals so Pass 3 can convert its funds_order
    // (元) candidates to 分 and correctly claim in-transit external lines. With
    // decimals=0 the funds_order 元 would never scale to match a 分 external
    // line, so this display re-run would drop every in-transit pairing and show
    // the line as a hard orphan. Same source as the run service: asset table by
    // currency code (never hardcoded).
    const assetForDecimals = (await (this.prisma as any).asset.findUnique({
      where: { code: kase.assetCode },
      select: { decimals: true },
    })) as { decimals: number } | null;
    const matcher = await this.walletFlowMatcher.matchFlows({
      walletRef: kase.walletRef,
      externalLines,
      cutoff,
      decimals: assetForDecimals?.decimals ?? 0,
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

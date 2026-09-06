import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AccountingService } from '../../../accounting/tigerbeetle/accounting.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
} from '../engine/v2/wallet-flow-matcher.service';
import { effectiveCutoffFilter } from '../engine/v2/effective-cutoff';
import {
  ExplainedDifferenceService,
  explainedBy,
} from '../disposition/explained-difference.service';
import {
  CAUSE_REGISTRY,
  CauseCode,
  menuFor,
  resolveOutlet,
  resolveWriteOff,
  staticOutletLabel,
} from '../disposition/cause-registry';
import { isSmallAmount } from '../disposition/recon-thresholds.constant';
import { deriveFundingNextStep } from '../disposition/funding-next-step';
import {
  AccountStatusRow,
  CaseAdjustmentSummary,
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
    private readonly explainedDifferences: ExplainedDifferenceService,
    private readonly accounting: AccountingService,
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

    // 平账一期半（spec §3/§8）：列表页要看到处置进度——不开详情页就知道这批案子
    // 有几条已经定过性、还剩几条异常行没人看过。
    const caseNos = rows.map((r: any) => r.caseNo);
    const dispositionCounts = caseNos.length
      ? await (this.prisma as any).reconciliationDisposition.groupBy({
          by: ['caseNo'], where: { caseNo: { in: caseNos } }, _count: { _all: true },
        })
      : [];
    const dispCountByCase = new Map<string, number>(dispositionCounts.map((g: any) => [g.caseNo, g._count._all]));
    const caseIds = rows.map((r: any) => r.id);
    const anomalyCounts = caseIds.length
      ? await (this.prisma as any).reconciliationLineItem.groupBy({
          by: ['caseId'],
          where: { caseId: { in: caseIds }, matchStatus: { in: ['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] } },
          _count: { _all: true },
        })
      : [];
    const anomalyByCaseId = new Map<string, number>(anomalyCounts.map((g: any) => [g.caseId, g._count._all]));
    // Δ 分→元（BACKLOG 在案）：decimals 随行下发，前端按行缩放
    const assetCodes = Array.from(new Set(rows.map((r: any) => r.assetCode)));
    const assets = assetCodes.length
      ? ((await (this.prisma as any).asset.findMany({ where: { code: { in: assetCodes } }, select: { code: true, decimals: true } })) as Array<{ code: string; decimals: number }>)
      : [];
    const decimalsByCode = new Map(assets.map((a) => [a.code, a.decimals]));

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

    // 平账二期：列表徽标——待补款 / 待垫款 / 进行中，金库一眼找到活
    const lossAdjustments = caseNos.length
      ? ((await (this.prisma as any).reconciliationAdjustment.findMany({ where: { caseNo: { in: caseNos }, status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS' }, select: { caseNo: true, adjustmentNo: true } })) as Array<{ caseNo: string; adjustmentNo: string }>)
      : [];
    const bounceDispositions = caseNos.length
      ? ((await (this.prisma as any).reconciliationDisposition.findMany({ where: { caseNo: { in: caseNos }, outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null }, select: { caseNo: true, explainedExternalLineId: true, walletRef: true } })) as Array<{ caseNo: string; explainedExternalLineId: string | null; walletRef: string }>)
      : [];
    const liveTransfers = caseNos.length
      ? ((await (this.prisma as any).internalTransfer.findMany({ where: { sourceCaseNo: { in: caseNos }, status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } }, select: { sourceCaseNo: true, purpose: true, status: true, sourceAdjustmentNo: true, sourceExternalLineId: true } })) as Array<{ sourceCaseNo: string; purpose: string; status: string; sourceAdjustmentNo: string | null; sourceExternalLineId: string | null }>)
      : [];
    const fundingByCase = new Map<string, { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' }>();
    for (const a of lossAdjustments) {
      const t = liveTransfers.find((x) => x.sourceAdjustmentNo === a.adjustmentNo);
      if (t?.status === 'SUCCESS') continue;
      fundingByCase.set(a.caseNo, { kind: 'COMPENSATION', status: t ? 'IN_PROGRESS' : 'PENDING' });
    }
    for (const b of bounceDispositions) {
      if (!b.explainedExternalLineId || fundingByCase.has(b.caseNo)) continue;
      const t = liveTransfers.find((x) => x.sourceExternalLineId === b.explainedExternalLineId);
      if (t?.status === 'SUCCESS') continue;
      if (t) { fundingByCase.set(b.caseNo, { kind: 'ADVANCE', status: 'IN_PROGRESS' }); continue; }
      const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: b.explainedExternalLineId }, select: { amount: true } });
      const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: b.walletRef }, select: { ownerId: true } });
      const row = rows.find((r: any) => r.caseNo === b.caseNo);
      const currency = row ? (await (this.prisma as any).asset.findUnique({ where: { code: row.assetCode }, select: { currency: true } }))?.currency : null;
      if (!line || !wallet?.ownerId || !currency) continue;
      const available = (await this.accounting.getCustomerAvailableBalance(wallet.ownerId, currency)).available;
      if (BigInt(line.amount.toString()) > available) fundingByCase.set(b.caseNo, { kind: 'ADVANCE', status: 'PENDING' });
    }

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
        dispositionCount: dispCountByCase.get(r.caseNo) ?? 0,
        anomalyLineCount: anomalyByCaseId.get(r.id) ?? 0,
        decimals: decimalsByCode.get(r.assetCode) ?? 0,
        pendingFunding: fundingByCase.get(r.caseNo) ?? null,
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
            select: { runNo: true, businessDate: true, completedAt: true, cutoffAt: true },
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
      // 平账 A 批（spec §6.1）：截止 = 最近一次观察它的那轮跑批**实际用的截止时刻**，
      // 不再是当天 23:59:59——跑批用精确时刻（演示传的 cutoff / 手动触发的 ISO），
      // 页面按日终重建会把「截止点后 6 小时」的跨日切外部行落回窗内，孤儿消失、无行可处置。
      // 历史 run 没记 cutoffAt 时回落日终（改动前的行为）。
      const cutoffBusinessDate = lastObservedRun?.businessDate ?? kase.businessDate;
      const cutoff: Date = lastObservedRun?.cutoffAt ?? new Date(`${cutoffBusinessDate}T23:59:59.999Z`);
      const built = await this.buildFlowComparison({ walletRef: kase.walletRef, cutoff, businessDate: cutoffBusinessDate, assetCode: kase.assetCode });
      flowComparison = built.rows;
      flowSummary = built.summary;
    }

    // 平账二期 Task 8：caseAdjustments 与紧随其后的 assetRow / caseCurrency 一起，
    // 从原位置（下方 IN_TRANSIT 追加段之后）上移到这里——补款 / 垫款回挂块（再往下）要用。
    // Task 7（调账单 admin 前端 · 控制方裁定）：案件级调账单列表，按 caseNo 直查
    // 全部——不依赖 lineItems 是否为空、不依赖某行是否曾传过 lineItemId（新表单
    // 不再传）。运营在案件页一眼看到本案已开过哪些调账单，防重复开单的目的靠这份
    // 列表达成，不靠"整行置灰"（brief 原方案做不到——flowComparison 的行 id 和
    // ReconciliationLineItem.id 不是一张表，且后者每轮对账 delete-then-insert
    // 没有跨轮身份）。
    //
    // Fix 6（末站整改）：Task 6 曾在这里按 lineItemId 批量查调账单、把
    // { adjustmentNo, status } 挂到每条差异项上供前端"整行置灰"——该用途随 Task 7
    // 改用上面这条 caseNo 查询后废弃：新表单不再传 lineItemId（恒空 Map），
    // 且前端从未渲染过 kase.lineItems（管理台按 flowComparison 展示对账行，不是
    // 原始 lineItems）。按 CLAUDE.md §3 视为本分支自产的孤儿，随 Task 6 的
    // lineItemId 查询与 decoratedLineItems 一并删除；下方 return 里的
    // `lineItems` 字段回落到 `...kase` 展开自带的原始值（Task 6 之前的行为）。
    const caseAdjustments = (await (this.prisma as any).reconciliationAdjustment.findMany({
      where: { caseNo: kase.caseNo },
      select: { adjustmentNo: true, status: true, reasonCode: true, direction: true, amount: true },
      orderBy: { createdAt: 'desc' },
    })) as CaseAdjustmentSummary[];
    // T4 (canon2): the display layer scales every amount by 10^decimals to turn
    // integer base units (分) back into 元. Same source as listExternalBalances
    // and buildFlowComparison — asset table by currency code, never hardcoded.
    // 平账 A 批：也是 nextStep 判小额线要用的币种（按 currency，不按 code）——提前
    // 到这里查一次，下文用同一个变量，不查两次。
    const assetRow = (await (this.prisma as any).asset.findUnique({
      where: { code: kase.assetCode }, select: { decimals: true, currency: true },
    })) as { decimals: number; currency: string } | null;
    const caseCurrency = assetRow?.currency ?? kase.assetCode;
    // 平账二期（spec §7.2/§7.3）：补款 / 垫款回挂——读本案的划转单（直查 internal_transfers，
    // 与 resolveSupplementRef 读业务域表同款先例），按来源锚回贴到行上。
    const adjustmentByNo = new Map(caseAdjustments.map((a) => [a.adjustmentNo, a]));
    const caseTransfers = (await (this.prisma as any).internalTransfer.findMany({
      where: { sourceCaseNo: kase.caseNo }, orderBy: { createdAt: 'desc' },
      select: { transferNo: true, purpose: true, status: true, sourceAdjustmentNo: true, sourceExternalLineId: true },
    })) as Array<{ transferNo: string; purpose: string; status: string; sourceAdjustmentNo: string | null; sourceExternalLineId: string | null }>;
    const transferByAdjustment = new Map<string, (typeof caseTransfers)[number]>();
    const transferByLine = new Map<string, (typeof caseTransfers)[number]>();
    for (const t of caseTransfers) { // 最新在前，只留每个来源最新的一张
      if (t.sourceAdjustmentNo && !transferByAdjustment.has(t.sourceAdjustmentNo)) transferByAdjustment.set(t.sourceAdjustmentNo, t);
      if (t.sourceExternalLineId && !transferByLine.has(t.sourceExternalLineId)) transferByLine.set(t.sourceExternalLineId, t);
    }
    const walletOwner = kase.walletRef && !kase.walletRef.startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, select: { walletNo: true, ownerId: true } })
      : null;
    let availableMinorCache: bigint | null = null;
    const availableMinor = async (): Promise<bigint> => {
      if (availableMinorCache === null) {
        availableMinorCache = walletOwner?.ownerId ? (await this.accounting.getCustomerAvailableBalance(walletOwner.ownerId, caseCurrency)).available : 0n;
      }
      return availableMinorCache;
    };

    // ── 平账一期半（spec §3/§8）：行注解——定性回贴 / 双胞胎线索 / 成因菜单 ──
    // 跑在 IN_TRANSIT 追加段之前：此刻 flowComparison 只有 built.rows 的四类
    // 行，IN_TRANSIT 行还没生成，天然不会被这段行注解处理（它们不是差异）。
    // ① 定性记录：按锚（flowId / externalLineId）回贴到行上。
    const dispositions = (await (this.prisma as any).reconciliationDisposition.findMany({
      where: { caseNo },
    })) as any[];
    // 平账三期（Task 9）：案件级事故列表——按 sourceCaseNo 查询，覆盖全部事故类型
    // （UNAUTHORIZED_OUTFLOW 建单时同样带 sourceCaseNo，见 IncidentService.register
    // :151 + assertUnauthorizedOutflow :171，并非只有 LARGE_UNEXPLAINED/
    // CLIENT_SHORTFALL 两类落在这里）。这条是案件级全量列表，不是对行级
    // disposition.incidentNo 的互补——案子上的「升级事故」/「登记欠款」按钮
    // 看这个列表判断是否已经登记过。按创建倒序，空数组表示该案从未挂过事故。
    const caseIncidents = (await (this.prisma as any).incident.findMany({
      where: { sourceCaseNo: caseNo },
      orderBy: { createdAt: 'desc' },
      select: { incidentNo: true, status: true, type: true },
    })) as Array<{ incidentNo: string; status: string; type: string }>;
    const dByFlow = new Map<string, any>();
    const dByExt = new Map<string, any>();
    for (const d of dispositions) {
      if (d.explainedFlowId) dByFlow.set(d.explainedFlowId, d);
      if (d.explainedExternalLineId) dByExt.set(d.explainedExternalLineId, d);
    }
    // ② 双胞胎线索（15 个成因里唯一机器认得出的证据，spec §0.3）：
    //    已匹配行的 (externalRef, amount) 集合——ORPHAN_INTERNAL 行命中即标。
    const matchedKeys = new Set(
      flowComparison
        .filter((r) => r.matchType === 'MATCHED' && r.externalLine?.externalRef)
        .map((r) => `${r.externalLine!.externalRef}|${r.externalLine!.amount}`),
    );
    const caseBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    for (const r of flowComparison) {
      if (r.matchType === 'MATCHED' || r.matchType === 'IN_TRANSIT') continue;
      const d = (r.internalFlow && dByFlow.get(r.internalFlow.id!)) || (r.externalLine && dByExt.get(r.externalLine.id!)) || null;
      // 出口的三个可执行字段（族 / 调账 reason / 方向）随读面下发：金库拿它们
      // 直接开调账单，不必先替运营重发一次定性——「开单」是只读动作，让它去打
      // 写端点会跨角色边界（定性写权归运营、调账写权归金库，没有角色两者兼有），
      // 也会把徽标里「查证是谁做的」改成写单人。判定仍只有 resolveOutlet 一处。
      // 格（matchType × book）取定性当时存下来的那一对：成因是在那一格里选的，
      // 用行的当前格重判，跨轮次重分类的行会抛「成因不属于该格」把读面打挂。
      const resolved = d ? resolveOutlet(d.causeCode as CauseCode, {
        matchType: d.matchType, book: d.book === 'FIRM' ? 'FIRM' : 'CLIENT',
        deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
        internalDirection: r.internalFlow?.direction,
        internalSourceType: r.internalFlow?.sourceType,
        externalDirection: r.externalLine?.direction,
      }) : null;
      r.disposition = d ? {
        dispositionNo: d.dispositionNo, causeCode: d.causeCode,
        causeLabel: CAUSE_REGISTRY[d.causeCode as CauseCode]?.label ?? d.causeCode,
        outlet: d.outlet, outletLabel: staticOutletLabel(d.causeCode as CauseCode),
        family: resolved!.family, reasonCode: resolved!.reasonCode, direction: resolved!.direction,
        findingNote: d.findingNote, adjustmentNo: d.adjustmentNo ?? null,
        deferredTarget: d.deferredTarget ?? null,
        supplementNo: d.supplementNo ?? null,
        supplementRef: await this.resolveSupplementRef(d.supplementNo ?? null),
        incidentNo: d.incidentNo ?? null,
        createdBy: d.createdByUserId, createdAt: (d.updatedAt ?? d.createdAt).toISOString(),
      } : null;
      r.duplicateTwinRef = (r.matchType === 'ORPHAN_INTERNAL' && r.internalFlow?.externalRef
        && matchedKeys.has(`${r.internalFlow.externalRef}|${r.internalFlow.amount}`))
        ? r.internalFlow.externalRef : null;
      r.menu = menuFor(r.matchType as any, caseBook);
      // 平账 A 批（spec §2.6）+ 二期（spec §7.1）：超期解锁——判据全在服务端。
      // 公司池：小额 → 核销，大额 → 事故（三期）；客户池：多出来的不论大小 → 指路补录
      // （这一判断排在金额判断之前，见下方 if 顺序）；「托管里少了」再看金额——
      // 小额 → 认损，大额 → 事故。
      if (kase.status === 'OPEN' && kase.slaBreached && d && d.outlet === 'HOLD_INVESTIGATING' && !d.adjustmentNo) {
        const wo = resolveWriteOff({
          matchType: r.matchType as any, book: caseBook,
          deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
          internalDirection: r.internalFlow?.direction, externalDirection: r.externalLine?.direction,
          internalAmount: r.internalFlow?.amount, externalAmount: r.externalLine?.amount, deltaAmount: r.deltaAmount,
        });
        if (caseBook === 'CLIENT' && wo.direction === 'INCREASE') {
          r.nextStep = { kind: 'CLIENT_SURPLUS' };
        } else if (!isSmallAmount(caseCurrency, BigInt(wo.amountMinor))) {
          r.nextStep = { kind: 'INCIDENT_DEFERRED' };
        } else {
          r.nextStep = { kind: 'WRITE_OFF', reasonCode: wo.reasonCode, direction: wo.direction, amount: wo.amountMinor, effectiveDate: kase.businessDate };
        }
      }
      // 平账二期：补款 / 垫款——案子 RESOLVED 之后也要给（认损让案子愈了，补款是对客户的交代）
      if (d && caseBook === 'CLIENT') {
        const adj = d.adjustmentNo ? (adjustmentByNo.get(d.adjustmentNo) ?? null) : null;
        const bounce = d.outlet === 'SUPPLEMENT' && d.deferredTarget === 'SUPPLEMENT_BOUNCE' && r.externalLine?.id
          ? { externalLineId: r.externalLine.id, lineAmountMinor: BigInt(r.externalLine.amount), availableMinor: await availableMinor(), supplementNo: d.supplementNo ?? null }
          : null;
        const transfer = (d.adjustmentNo ? transferByAdjustment.get(d.adjustmentNo) : undefined) ?? (r.externalLine?.id ? transferByLine.get(r.externalLine.id) : undefined) ?? null;
        const funding = deriveFundingNextStep({
          book: 'CLIENT', customerNo: kase.ownerNo ?? null, walletNo: walletOwner?.walletNo ?? null,
          adjustment: adj ? { adjustmentNo: adj.adjustmentNo, status: adj.status, reasonCode: adj.reasonCode, amount: adj.amount } : null,
          transfer, bounce,
        });
        if (funding.transfer) r.transfer = funding.transfer;
        if (funding.nextStep) r.nextStep = funding.nextStep;
      }
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
      walletNo: walletRow?.walletNo ?? null,
      linkedRunNo: linkedRunRow?.runNo ?? null,
      decimals: assetRow?.decimals ?? 0,
      bucket: kase.bucket ?? null,
      flowComparison,
      flowSummary,
      explain,
      observation,
      adjustments: caseAdjustments,
      incidents: caseIncidents,
    };
  }

  /** 补单回挂的单号 → 详情页链接用的 { kind, no, id }。SIG… 没有页面，id 为 null。 */
  private async resolveSupplementRef(no: string | null): Promise<{ kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null> {
    if (!no) return null;
    if (no.startsWith('DEP')) {
      const d = await (this.prisma as any).depositTransaction.findUnique({ where: { depositNo: no }, select: { id: true } });
      return { kind: 'DEPOSIT', no, id: d?.id ?? null };
    }
    if (no.startsWith('WD')) {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({ where: { withdrawNo: no }, select: { id: true } });
      return { kind: 'WITHDRAW', no, id: w?.id ?? null };
    }
    return { kind: 'SIGNAL', no, id: null };
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
    kase: { walletRef: string; cutoff: Date; businessDate: string; assetCode: string },
  ): Promise<{ rows: FlowComparisonRow[]; summary: FlowComparisonSummary }> {
    // cutoff 由 getCase 决定（run.cutoffAt 优先，历史行回落日终），本函数不再自算。
    const cutoff = kase.cutoff;

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

    // ④ 案件页要看得见「这条差异已被 ADJxxx 解释」——与对账引擎算桶时用的是
    // 同一份索引（explained-difference.service.ts），不各写一套判断。
    const explained = await this.explainedDifferences.indexForWallet(kase.walletRef);

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
        explainedByAdjustmentNo: explainedBy(explained, oi),
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
        explainedByAdjustmentNo: explainedBy(explained, oe),
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
        explainedByAdjustmentNo: explainedBy(explained, m),
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

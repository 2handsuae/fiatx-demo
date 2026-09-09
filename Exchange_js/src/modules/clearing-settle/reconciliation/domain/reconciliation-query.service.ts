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
  CauseMatchType,
  DispositionKind,
  DISPOSITION_LABEL,
  OUTLET_OF,
  RowFacts,
  StoredOutlet,
  causesFor,
  dispositionsFor,
  resolveWriteOff,
} from '../disposition/cause-registry';
import { REASON_SPECS, ReasonCode } from '../disposition/adjustment-rules';
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

// Task 5（读面翻转）：出口 → 处置种类反向表——OUTLET_OF 是单射（cause-registry.ts 单一
// 来源，Task 13 起直接导出，这里不再手抄一份处置种类键表），读面用它反查回处置种类
// 再取 DISPOSITION_LABEL，取代旧的 resolveOutlet(causeCode) 反推（Task 13 已随旧两层
// 折叠码退役——那条路径连成因都不该再管出口文案）。
const KIND_OF_OUTLET = new Map<StoredOutlet, DispositionKind>(
  (Object.entries(OUTLET_OF) as Array<[DispositionKind, StoredOutlet]>).map(([kind, outlet]) => [outlet, kind]),
);

// Task 5（读面翻转）：案件列表气泡——demo 答案键场景条目，业务键（scenarioId/
// causeCode），不带 walletRef（铁律⑥）。
interface DemoScenarioEntry {
  scenarioId: number; causeCode: string; causeLabel: string; dispositionLabel: string; clue: string;
}

// 差异行级推荐（本任务）：按 break 铺场轮 run.demoManifest 反查单行成因用的最小
// 形状——只取 scenarios[].{scenarioId,rootCause,expectedLines[].{walletRef,externalRef}}。
interface DemoManifestShape {
  scenarios?: Array<{
    scenarioId: number;
    rootCause: string;
    expectedLines?: Array<{ walletRef: string; externalRef?: string | null }>;
  }>;
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

    // Task 5（读面翻转）：气泡数据源——最近一轮带 demoManifest 的跑批，按业务键
    // walletRef 聚合到本页在列的案件上；真实/pass 轮（demoManifest 恒 null）不
    // 参与，命中不到任何案件，字段天然不下发。空列表不必发这次查询。
    const demoScenariosByWallet = rows.length
      ? await this.loadDemoScenariosByWalletRef()
      : new Map<string, DemoScenarioEntry[]>();

    const now = Date.now();
    const decorated = rows.map((r: any) => {
      const ref = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
      const aging = Number.isFinite(ref) ? Math.floor((now - ref) / 86_400_000) : 0;
      const demoScenarios = r.walletRef ? demoScenariosByWallet.get(r.walletRef) : undefined;
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
        ...(demoScenarios ? { demoScenarios } : {}),
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
    // Task 12 消费：额外带上定损结论（assessedAmount/assessmentBasis）——只用于
    // 下面按 disposition.incidentNo 反查「该行事故是否已定损 FIRM_LOSS」，不进
    // 对外的 `incidents` 投影（那份契约仍是 {incidentNo,status,type}[]，见下方 map）。
    const caseIncidentRows = (await (this.prisma as any).incident.findMany({
      where: { sourceCaseNo: caseNo },
      orderBy: { createdAt: 'desc' },
      select: { incidentNo: true, status: true, type: true, assessedAmount: true, assessmentBasis: true },
    })) as Array<{ incidentNo: string; status: string; type: string; assessedAmount: Prisma.Decimal | null; assessmentBasis: string | null }>;
    const caseIncidents = caseIncidentRows.map(({ incidentNo, status, type }) => ({ incidentNo, status, type }));
    const incidentByNo = new Map(caseIncidentRows.map((i) => [i.incidentNo, i]));
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
    // ⚡ 差异行级推荐（本任务）：只有真实钱包案件（非 XREF、非 legacy）才可能挂着
    // break 铺场答案键——与上面 flowComparison 的构建同一个门控条件，XREF/legacy
    // 案件不发这次查询（真实/pass 轮无 manifest 时 loadDemoLineCausesForWallet 内部
    // 的 findFirst 落空，返回空表，同样零命中）。
    const demoLineCauses = (kase.walletRef && !kase.walletRef.startsWith('XREF:'))
      ? await this.loadDemoLineCausesForWallet(kase.walletRef)
      : new Map<string, { scenarioId: number; rootCause: string }>();
    const caseBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    for (const r of flowComparison) {
      if (r.matchType === 'MATCHED' || r.matchType === 'IN_TRANSIT') continue;
      const d = (r.internalFlow && dByFlow.get(r.internalFlow.id!)) || (r.externalLine && dByExt.get(r.externalLine.id!)) || null;
      // Task 5（读面翻转）：outletLabel 不再靠 resolveOutlet 从成因反推——写端（Task
      // 1-4）已经把 outlet 存成 outletOf(处置) 的结果，这里用 KIND_OF_OUTLET 反查
      // 处置种类再取 DISPOSITION_LABEL。family/reasonCode/direction 也不再现算：
      // 那三个是「开调账单」这个动作才真正定下来的执行细节（reasonCode 由财务在
      // 开单表单上选，不是成因单射推出来的），行上挂着单就从单上读（adjustmentByNo
      // 已在上面建好）；没开单说明这一步还没做，省略这三个字段，不让读面替一个
      // 还没发生的决定编答案。
      const linkedAdjustment = d?.adjustmentNo ? (adjustmentByNo.get(d.adjustmentNo) ?? null) : null;
      r.disposition = d ? {
        dispositionNo: d.dispositionNo, causeCode: d.causeCode,
        causeLabel: CAUSE_REGISTRY[d.causeCode as CauseCode]?.label ?? d.causeCode,
        outlet: d.outlet, outletLabel: DISPOSITION_LABEL[KIND_OF_OUTLET.get(d.outlet as StoredOutlet)!],
        ...(linkedAdjustment ? {
          family: REASON_SPECS[linkedAdjustment.reasonCode as ReasonCode]?.family,
          reasonCode: linkedAdjustment.reasonCode,
          direction: linkedAdjustment.direction as 'REDUCE' | 'INCREASE',
        } : {}),
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
      // Task 5（读面翻转）：这一格（matchType × book）当下合法的处置清单——按处置
      // 分组，组内带该处置在这一格可选的成因，供前端两级选择（先选处置、再选成
      // 因）。取代旧的一格一份平铺成因菜单 `r.menu`（本任务起不再下发）。
      const rowFacts: RowFacts = {
        matchType: r.matchType as CauseMatchType, book: caseBook,
        deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
        internalDirection: r.internalFlow?.direction,
        internalSourceType: r.internalFlow?.sourceType,
        externalDirection: r.externalLine?.direction,
      };
      r.dispositions = dispositionsFor(rowFacts).map((kind) => ({
        kind, label: DISPOSITION_LABEL[kind],
        // SUPPLEMENT 三码不分方向全出会让 IN 行选中 OUT 专属成因（如 BOUNCED_FUNDS），
        // 一路填到发起才被 assertClaimable 拒——按行方向过滤，判据即 CAUSE_REGISTRY
        // 里登记的 requiredDirection（写端 resolveOutlet 用的同一份）。
        causes: kind === 'SUPPLEMENT'
          ? causesFor(kind, rowFacts.matchType, rowFacts.book)
            .filter((c) => CAUSE_REGISTRY[c.code].requiredDirection === rowFacts.externalDirection)
          : causesFor(kind, rowFacts.matchType, rowFacts.book),
      }));
      // ⚡ 差异行级推荐（本任务）：按行的匹配键（externalLine.externalRef ??
      // internalFlow.externalRef，旧 WIP 同款）反查种子成因，取该成因 usableIn[0]
      // 的处置种类作为推荐。MISATTRIBUTED_FROM/TO 同一 rootCause 铺两侧（发出端
      // ORPHAN_INTERNAL 用 FROM、接收端 ORPHAN_EXTERNAL 只认 TO）——种子成因在本行
      // 不合法时试一次对端码（旧 WIP 同款 sibling 逻辑）。最终必须同时满足：推荐的
      // 处置种类在上面刚算出的 r.dispositions 里、且成因也在该处置的 causes 清单
      // 里——两者任一不满足就不下发（宁缺勿错，例如 SWAP 行/方向过滤后该成因已被
      // 摘掉）。真实/pass 轮 demoLineCauses 恒空表，天然不命中。
      const seedRef = r.externalLine?.externalRef ?? r.internalFlow?.externalRef;
      const seedEntry = seedRef ? demoLineCauses.get(seedRef) : undefined;
      const tryDemoCause = (code: string): { code: CauseCode; kind: DispositionKind } | null => {
        const spec = CAUSE_REGISTRY[code as CauseCode];
        if (!spec) return null; // 如 IN_TRANSIT_TIMING——不在成因表里，不是差异
        const kind = spec.usableIn[0];
        const dispEntry = r.dispositions!.find((entry) => entry.kind === kind);
        if (!dispEntry || !dispEntry.causes.some((c) => c.code === code)) return null;
        return { code: code as CauseCode, kind };
      };
      if (seedEntry) {
        let hit = tryDemoCause(seedEntry.rootCause);
        if (!hit) {
          const sibling = seedEntry.rootCause === 'MISATTRIBUTED_FROM' ? 'MISATTRIBUTED_TO'
            : seedEntry.rootCause === 'MISATTRIBUTED_TO' ? 'MISATTRIBUTED_FROM' : null;
          if (sibling) hit = tryDemoCause(sibling);
        }
        if (hit) {
          r.demoRecommended = {
            scenarioId: seedEntry.scenarioId,
            causeCode: hit.code,
            causeLabel: CAUSE_REGISTRY[hit.code].label,
            disposition: hit.kind,
            dispositionLabel: DISPOSITION_LABEL[hit.kind],
          };
        }
      }
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
          // Task 12：带上金额——「升级事故」按钮要用它预填 LARGE_UNEXPLAINED 的金额。
          r.nextStep = { kind: 'INCIDENT_DEFERRED', amount: wo.amountMinor };
        } else {
          r.nextStep = { kind: 'WRITE_OFF', reasonCode: wo.reasonCode, direction: wo.direction, amount: wo.amountMinor, effectiveDate: kase.businessDate };
        }
      }
      // 平账三期（Task 12）：定性行挂着事故且事故已定损「公司承损」——认损开单入口对该行
      // 可用，不受账龄线/小额线约束——这正是 assertIncidentWriteOffAllowed 的三重闸（状态
      // ASSESSED/RESOLVING + 口径 FIRM_LOSS + 未挂单），前端按钮只是不让人白点，真闸仍在
      // 后端。复用 WRITE_OFF 这个 nextStep 形状——案件页 openWriteOff/「认损」按钮已经是
      // 通用实现，不必另开一种 kind。金额锁定为定损额（元→最小单位，惯例同
      // receipt-lookup.service.ts）。
      //
      // Task 4（死胡同修复）：判据从 `d.outlet === 'INCIDENT'` 改成只看 `d.incidentNo`——
      // 「大额查不出→挂起·调查中→超期→升级事故」（LARGE_UNEXPLAINED）那条路
      // attachIncident 只写 incidentNo 一列，outlet 原地留在 HOLD_INVESTIGATING（不是
      // UNAUTHORIZED_OUTFLOW 专用的静态出口 INCIDENT）；按 outlet 分流会让这类行永远出不了
      // WRITE_OFF nextStep，事故定了损也没有入口开认损单。块位置仍在上面的账龄块之后——
      // 大额行会先被账龄块判成 INCIDENT_DEFERRED，事故一旦定损，这里原地覆盖成 WRITE_OFF；
      // reasonCode/direction 按簿现算而不是硬编码客户池的码——公司池升级事故同样要解锁核销。
      if (kase.status === 'OPEN' && d && d.incidentNo && !d.adjustmentNo) {
        const incident = incidentByNo.get(d.incidentNo);
        if (incident && (incident.status === 'ASSESSED' || incident.status === 'RESOLVING')
          && incident.assessmentBasis === 'FIRM_LOSS' && incident.assessedAmount != null) {
          const decimals = assetRow?.decimals ?? 0;
          const assessedMinor = new Prisma.Decimal(incident.assessedAmount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0);
          // 评审收（Minor）：公司簿 reasonCode 直接取 resolveWriteOff 已经按 book 算好的
          // 结果，别再本地重抄一遍同一条公式；客户池只有 REDUCE 一种方向（spec §7.1），
          // 仍本地判，不必为它多绕一次 resolveWriteOff。
          const wo = caseBook === 'FIRM' ? resolveWriteOff({
            matchType: r.matchType as any, book: caseBook,
            deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
            internalDirection: r.internalFlow?.direction, externalDirection: r.externalLine?.direction,
            internalAmount: r.internalFlow?.amount, externalAmount: r.externalLine?.amount, deltaAmount: r.deltaAmount,
          }) : null;
          const reasonCode = caseBook === 'FIRM' ? wo!.reasonCode : 'UNEXPLAINED_CLIENT_LOSS';
          const direction = caseBook === 'CLIENT' ? 'REDUCE' : wo!.direction;
          r.nextStep = { kind: 'WRITE_OFF', reasonCode, direction, amount: assessedMinor, effectiveDate: kase.businessDate };
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

  /**
   * Task 5（读面翻转）：气泡数据源——最近一轮带 demoManifest 的跑批（真实/pass
   * 轮 demoManifest 恒 null，`findFirst` 落空即返回空表），按
   * scenarios[].expectedLines[].walletRef 聚合成 walletRef → 场景清单。
   * causeLabel/dispositionLabel 取自成因注册表（唯一真相），不重抄 manifest 里
   * 的展示文案。场景①（在途）的 rootCause 是种子专用字面量 'IN_TRANSIT_TIMING'，
   * 天生不在 CAUSE_REGISTRY 里——查不到即跳过（在途不是差异，不走定性菜单，见
   * recon-demo.ts 的 RootCause 类型注释）。铁律⑥：产出里不带 walletRef，它只是
   * 这里的聚合键，不进对外字段。
   */
  private async loadDemoScenariosByWalletRef(): Promise<Map<string, DemoScenarioEntry[]>> {
    const byWallet = new Map<string, DemoScenarioEntry[]>();
    const manifest = await this.loadLatestDemoManifest();
    if (!manifest) return byWallet;
    for (const scenario of manifest.scenarios ?? []) {
      const causeSpec = CAUSE_REGISTRY[scenario.rootCause as CauseCode];
      if (!causeSpec) continue; // 场景①在途——成因表里没有它的条目
      const entry: DemoScenarioEntry = {
        scenarioId: scenario.scenarioId,
        causeCode: scenario.rootCause,
        causeLabel: causeSpec.label,
        dispositionLabel: DISPOSITION_LABEL[causeSpec.usableIn[0]],
        // Minor 4（终审修复批）：业主原始诉求"悬浮出现场景说明"——气泡此前只有场景号
        // + 成因标题，没有说明这条差异该怎么查证；同一来源（注册表该码 clue）
        // 已经喂给成因菜单的辅助文案，气泡这里原样带上，不另造一份文案。
        clue: causeSpec.clue,
      };
      const walletRefs = new Set((scenario.expectedLines ?? []).map((l) => l.walletRef));
      for (const walletRef of walletRefs) {
        const list = byWallet.get(walletRef);
        if (list) list.push(entry); else byWallet.set(walletRef, [entry]);
      }
    }
    return byWallet;
  }

  /**
   * 差异行级推荐（本任务）：最近一轮带 demoManifest 的跑批——与 loadDemoScenariosByWalletRef
   * 同一份查询，抽成共用私有方法，getCase 的行级反查不再另发一次 findFirst。
   * 真实/pass 轮（demoManifest 恒 null）返回 null。
   */
  private async loadLatestDemoManifest(): Promise<DemoManifestShape | null> {
    const demoRun = await this.prisma.reconciliationRun.findFirst({
      where: { demoManifest: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { demoManifest: true },
    });
    if (!demoRun?.demoManifest) return null;
    return JSON.parse(demoRun.demoManifest) as DemoManifestShape;
  }

  /**
   * 差异行级推荐（本任务）：按本案钱包过滤出 externalRef → {scenarioId, rootCause}
   * 映射——getCase 行注解循环按行的匹配键（externalLine.externalRef ??
   * internalFlow.externalRef，旧 WIP 同款）查这张表，取种子成因推出推荐处置。
   * 同一钱包上不同场景撞了同一个 externalRef 的情况本答案键不产生（每条种子行的
   * externalRef 在铺场脚本里各自生成），后写覆盖先写即可，不必特殊处理。
   */
  private async loadDemoLineCausesForWallet(walletRef: string): Promise<Map<string, { scenarioId: number; rootCause: string }>> {
    const byExternalRef = new Map<string, { scenarioId: number; rootCause: string }>();
    const manifest = await this.loadLatestDemoManifest();
    if (!manifest) return byExternalRef;
    for (const scenario of manifest.scenarios ?? []) {
      for (const line of scenario.expectedLines ?? []) {
        if (line.walletRef === walletRef && line.externalRef) {
          byExternalRef.set(line.externalRef, { scenarioId: scenario.scenarioId, rootCause: scenario.rootCause });
        }
      }
    }
    return byExternalRef;
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

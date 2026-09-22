// src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts
//
// Phase B / T7: per-wallet reconciliation orchestrator. Replaces the V8
// five-formula identity check with a 1:1 wallet-level comparison:
//   1. Internal-identity pre-gate (sum L per ledger == sum A per ledger).
//      If broken → status='INTERNAL_BREAK', no per-wallet checks (signal
//      that the ledger itself has lost integrity — fix that first).
//   2. For each wallet present in ExternalBalance @ cutoff:
//        a. balanceChecker (T6) — open Case if delta ≠ 0
//        b. flowMatcher       — open Case + LineItems for orphan/mismatch
//   3. Cross-wallet same-externalRef invariant — e.g. WITHDRAW_FEE_POST
//      (client OUT) and WITHDRAW_FEE_FIRM (firm IN) share ref WDRxxx:fee;
//      |amount(client OUT)| must equal |amount(firm IN)|. Mismatch → case.
//
// Out of scope for T7: Case SLA / resolution workflow, Reimbursement
// re-creation, evidence-side line items beyond orphan/mismatch records.

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { decimalsMapOf } from '../domain/asset-decimals.util';
import {
  WalletBalanceCheckerService,
  WalletBalanceCheckResult,
} from '../engine/v2/wallet-balance-checker.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
} from '../engine/v2/wallet-flow-matcher.service';
import {
  TB_ACCOUNT_CODES,
  TB_CODE_TO_COA,
  ASSET_TB_CODES,
} from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TigerBeetleService } from '../../../accounting/tigerbeetle/tigerbeetle.service';
import { computeBucket, ReconBucket } from '../engine/v2/bucket-classifier';
import {
  EMPTY_EXPLAINED_INDEX,
  ExplainedDifferenceService,
  ExplainedIndex,
  explainedBy,
} from '../disposition/explained-difference.service';
import { computeAgingDeadline, severityLinesFor } from '../disposition/recon-thresholds.constant';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditActorContext, AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../../audit-logging/constants/audit-actions.constant';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';

const RUN_LAYER = 'WALLET';

// T2: severity thresholds used to triage cases in the cockpit UI.
// 波五 T5：单一阈值跨币种硬套（AED 100 元与 USDT 0.01 元同判 HIGH，跨资产不可比）
// 已改为按 asset.currency 索引的注册表，见 recon-thresholds.constant.ts
// SEVERITY_LINES_MINOR / severityLinesFor（fail-fast，不静默兜底）。
type CaseSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export function computeSeverity(currency: string, delta: bigint): CaseSeverity {
  const { med, high } = severityLinesFor(currency);
  const mag = delta < 0n ? -delta : delta;
  if (mag >= high) return 'HIGH';
  if (mag >= med) return 'MEDIUM';
  return 'LOW';
}

interface WalletReconRunInput {
  cutoff: Date;
  manifest?: unknown;
}

export interface WalletReconRunResult {
  runId: string;
  status: 'PASS' | 'BREAK' | 'INTERNAL_BREAK';
  walletsChecked: number;
  casesOpened: number;        // newly created cases this run
  casesReObserved: number;    // existing OPEN cases re-confirmed this run
  casesAutoHealed: number;    // cases auto-resolved this run (previously breaking wallet now passes)
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}

interface InternalIdentityResult {
  balanced: boolean;
  breaks: Array<{ ledger: number; side: 'CLIENT' | 'FIRM'; asset: string; liab: string; delta: string }>;
}

interface ExternalBalanceRow {
  walletRef: string | null;
  closingBalance: Prisma.Decimal;
  book: string;
  currency: string;
  accountRef: string;
}

@Injectable()
export class WalletReconRunService {
  private readonly logger = new Logger(WalletReconRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceChecker: WalletBalanceCheckerService,
    private readonly flowMatcher: WalletFlowMatcherService,
    private readonly tigerBeetle: TigerBeetleService,
    private readonly auditLogs: AuditLogsService,
    private readonly explainedDifferences: ExplainedDifferenceService,
    private readonly caseService: ReconciliationCaseService,
  ) {}

  async run(input: WalletReconRunInput, actor?: AuditActorContext): Promise<WalletReconRunResult> {
    const { cutoff } = input;
    const businessDate = toBusinessDate(cutoff);
    // 平账 A 批（spec §2.1）：本轮新开的案子一律以本轮业务日起算账龄——同一轮同一只钟。
    const slaDeadline = computeAgingDeadline(businessDate);

    // Stamp the run row up-front so callers always get a runId, even if
    // pre-gate trips.
    const run = await this.createRun(businessDate, input.manifest, actor ? 'MANUAL' : 'SCHEDULED', cutoff);

    // ── 1. Internal-identity pre-gate ──────────────────────────────────────
    const identity = await this.computeInternalIdentity(cutoff);
    if (!identity.balanced) {
      this.logger.warn(`[wallet-recon] internal identity break — skipping per-wallet checks. breaks=${JSON.stringify(identity.breaks)}`);
      await this.finishRun(run.id, {
        status: 'INTERNAL_BREAK',
        walletsChecked: 0,
        casesOpened: 0,
        casesReObserved: 0,
        casesAutoHealed: 0,
        bucketCounts: { matched: 0, inTransit: 0, softFlag: 0, break: 0 },
      });
      return {
        runId: run.id,
        status: 'INTERNAL_BREAK',
        walletsChecked: 0,
        casesOpened: 0,
        casesReObserved: 0,
        casesAutoHealed: 0,
        orphanInternal: 0,
        orphanExternal: 0,
        mismatch: 0,
      };
    }

    // ── 2. List wallets to check ────────────────────────────────────────────
    // Round3: no longer filter out walletRef=null heads — those are
    // "unattributed" external accounts (no internal wallet claims them) and
    // must surface as BREAK cases instead of being silently skipped.
    const cutoffDate = toBusinessDate(cutoff);
    const externalBalances = (await this.prisma.externalBalance.findMany({
      where: { cutoffDate },
      select: { walletRef: true, closingBalance: true, book: true, currency: true, accountRef: true },
    })) as ExternalBalanceRow[];

    const attributedBalances = externalBalances.filter((b) => b.walletRef !== null);
    const unattributedBalances = externalBalances.filter((b) => b.walletRef === null);
    const walletRefs = Array.from(
      new Set(attributedBalances.map((b) => b.walletRef).filter((r): r is string => !!r)),
    );

    // Canonical-minor (T1): batch-load asset.decimals for every currency in this
    // run so the flow matcher can convert amounts 元→分 at its boundary. Only the
    // funds_order side needs converting — external_statement_lines are ALREADY 分
    // (contract, §2.5) so the matcher takes them straight; funds_orders still store
    // 元 this round, so ONLY they get ×10^decimals. The in-transit output is minor,
    // to compare against balanceCheck.delta (already minor). One query, keyed by
    // currency=asset.code. (Same pattern as reconciliation-query.service.ts.)
    // 波五 T5：runCurrencies 覆盖 attributed + unattributed 两类头——严重度的
    // currency 映射两类都要用（unattributed 头也会开案、算严重度）。
    const runCurrencies = Array.from(new Set(externalBalances.map((b) => b.currency)));
    const assetsForDecimals = runCurrencies.length === 0
      ? []
      : ((await this.prisma.asset.findMany({
          where: { code: { in: runCurrencies } },
          select: { code: true, decimals: true, currency: true },
        })) as Array<{ code: string; decimals: number; currency: string }>);
    const decimalsByCurrency = decimalsMapOf(assetsForDecimals);
    // 波五 T5：severityLinesFor 按 asset.currency 索引，但这里的 bal.currency 实存
    // asset.code（如 'USDT-TRON'）——同一批 asset.findMany 顺手补 currency 字段，
    // 建 code→currency 映射；取不到就地 throw，不静默兜底（陷阱见 :328 附近注释）。
    const assetCurrencyByCode = new Map(assetsForDecimals.map((a) => [a.code, a.currency]));

    let casesCreated = 0;
    let casesUpdated = 0;
    let orphanInternal = 0;
    let orphanExternal = 0;
    let mismatch = 0;
    // T2 auto-heal input: every real walletRef touched by this run as
    // "still breaking" (includes unattributed accountRef "wallets").
    const currentBreakingWallets = new Set<string>();
    // ③ 自愈的第二个入参：本轮**真的查过**的钱包。
    // 2026-08-29 业主走查逮到：此前自愈只判「不在破口集合里」，没有任何条件要求
    // 「本轮查过这个钱包」。于是外部对账单一行都取不到时（业务日没有对账单——
    // 夜间任务跑昨天、演示数据盖今天，天天如此），破口集合是空集，`notIn []`
    // 命中所有 OPEN 案件 → 一次查了 0 个钱包的对账把 8 个案子全关了
    // （实测 RUN20260827-1：walletCount=0 / closedCount=8）。
    // 业务口径：**收不到对账单本身是一类异常，永远不能当成「账平了」**。
    const observedWallets = new Set<string>();
    // Round3: per-wallet snapshot rows — written for EVERY processed wallet
    // (all four buckets, matched included) so the run-detail page has a
    // single source of truth to render from (T6 reads this table only).
    // 快照载荷此前是 Record<string, unknown>——等于对这张表的写入完全没类型，写错列名
    // tsc 也不知道。改用 Prisma 生成的入参类型(`Prisma` 已在本文件 :20 导入)。
    const snapshotRows: Prisma.ReconciliationRunWalletCreateManyInput[] = [];
    const bucketCounts = { matched: 0, inTransit: 0, softFlag: 0, break: 0 };

    for (const walletRef of walletRefs) {
      const bal = attributedBalances.find((b) => b.walletRef === walletRef)!;
      const assetCurrency = assetCurrencyByCode.get(bal.currency);
      if (!assetCurrency) throw new Error(`Asset currency not found for code: ${bal.currency}`);
      const outcome = await this.processAttributedWallet({
        walletRef,
        bal,
        cutoff,
        runId: run.id,
        traceId: run.traceId ?? null,
        businessDate,
        slaDeadline,
        decimals: decimalsByCurrency.get(bal.currency) ?? 0,
        assetCurrency,
      });
      if (!outcome.observed) continue;
      observedWallets.add(walletRef);
      orphanInternal += outcome.orphanInternal;
      orphanExternal += outcome.orphanExternal;
      mismatch += outcome.mismatch;
      if (outcome.bucket) this.bumpBucketCount(bucketCounts, outcome.bucket);
      if (outcome.caseOutcome === 'CREATED') casesCreated += 1;
      else if (outcome.caseOutcome === 'REOBSERVED') casesUpdated += 1;
      if (outcome.breaking) currentBreakingWallets.add(walletRef);
      if (outcome.snapshotRow) snapshotRows.push(outcome.snapshotRow);
    }

    // ── 2c. Unattributed external heads (walletRef=null) — no internal face
    // to compare against, so neither engine runs. Always BREAK; case keyed
    // on accountRef standing in for walletRef.
    for (const bal of unattributedBalances) {
      const assetCurrency = assetCurrencyByCode.get(bal.currency);
      if (!assetCurrency) throw new Error(`Asset currency not found for code: ${bal.currency}`);
      const outcome = await this.processUnattributedHead({
        bal,
        runId: run.id,
        traceId: run.traceId ?? null,
        businessDate,
        slaDeadline,
        assetCurrency,
      });
      if (!outcome.observed) continue;
      const walletRef = bal.accountRef;
      observedWallets.add(walletRef);
      if (outcome.caseOutcome === 'CREATED') casesCreated += 1;
      else if (outcome.caseOutcome === 'REOBSERVED') casesUpdated += 1;
      currentBreakingWallets.add(walletRef);
      this.bumpBucketCount(bucketCounts, 'BREAK');
      if (outcome.snapshotRow) snapshotRows.push(outcome.snapshotRow);
    }

    // ── 3. Persist per-wallet snapshot rows — single write, all buckets.
    if (snapshotRows.length > 0) {
      await this.prisma.reconciliationRunWallet.createMany({ data: snapshotRows });
    }

    // ── 4. Auto-heal: 本轮**查过**且**没破口**的钱包，其 OPEN 案件视为已恢复
    // → RESOLVED + AUTO_HEALED。Scoped to layer=WALLET so this never touches
    // legacy V8 cases.
    const closedCount = await this.autoHealCases({
      runId: run.id,
      traceId: run.traceId ?? null,
      businessDate,
      observedWallets,
      currentBreakingWallets,
    });

    // ── 5. Summarize ────────────────────────────────────────────────────────
    const totalOpenAfter = casesCreated + casesUpdated;
    const status: WalletReconRunResult['status'] = totalOpenAfter > 0 ? 'BREAK' : 'PASS';
    const walletsChecked = walletRefs.length + unattributedBalances.length;
    await this.finishRun(run.id, {
      status,
      walletsChecked,
      casesOpened: casesCreated,
      casesReObserved: casesUpdated,
      casesAutoHealed: closedCount,
      bucketCounts,
    });

    await this.auditRunCompleted({
      runNo: run.runNo,
      traceId: run.traceId ?? null,
      actor,
      status,
      walletsChecked,
      casesOpened: casesCreated,
      casesReObserved: casesUpdated,
      casesAutoHealed: closedCount,
      bucketCounts,
      cutoffAt: cutoff,
    });

    return {
      runId: run.id,
      status,
      walletsChecked,
      casesOpened: casesCreated,
      casesReObserved: casesUpdated,
      casesAutoHealed: closedCount,
      orphanInternal,
      orphanExternal,
      mismatch,
    };
  }

  // ── 波三 T5：归属钱包循环体（剪切粘贴自 run()，行为零差异）────────────────
  private async processAttributedWallet(args: {
    walletRef: string;
    bal: ExternalBalanceRow;
    cutoff: Date;
    runId: string;
    traceId: string | null;
    businessDate: string;
    slaDeadline: Date;
    decimals: number;
    assetCurrency: string;
  }): Promise<{
    observed: boolean;
    snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput | null;
    bucket: ReconBucket | null;
    caseOutcome: 'CREATED' | 'REOBSERVED' | null;
    breaking: boolean;
    orphanInternal: number;
    orphanExternal: number;
    mismatch: number;
  }> {
    const { walletRef, bal, cutoff, runId, traceId, businessDate, slaDeadline, decimals, assetCurrency } = args;
    const currency = bal.currency;
    const assetId = await this.resolveAssetId(currency);
    if (!assetId) {
      return {
        observed: false,
        snapshotRow: null,
        bucket: null,
        caseOutcome: null,
        breaking: false,
        orphanInternal: 0,
        orphanExternal: 0,
        mismatch: 0,
      };
    }
    // 查到这里就算「本轮真的看过这个钱包」——③ 自愈的前提。outcome.observed=true，
    // 由 run() 据此 add 进 observedWallets。

    // 2a. Balance check (T6)
    const balanceCheck: WalletBalanceCheckResult = await this.balanceChecker.checkBalance({
      walletRef,
      externalClosing: BigInt(bal.closingBalance.toString()),
      cutoff,
    });

    // 2a'. Enrich UNKNOWN — when the checker can't classify (firm wallet
    // whose flows landed only on aggregate FIRM_ASSET legs, or a fresh
    // wallet with zero activity), look up walletRole + ownerType + ownerNo
    // from the wallet table so the case row gets meaningful coaCode/book/
    // owner instead of empty strings + 'CUSTOMER' book.
    const enriched = await this.enrichIfUnknown(walletRef, balanceCheck);

    // 2b. Flow match
    const externalLines = await this.fetchExternalLinesForWallet(walletRef, bal.accountRef, cutoff);
    const matcherResult = await this.flowMatcher.matchFlows({
      walletRef,
      externalLines,
      cutoff,
      decimals,
    });
    const orphanInternal = matcherResult.orphanInternal.length;
    const orphanExternal = matcherResult.orphanExternal.length;
    const mismatch = matcherResult.mismatch.length;

    // Round3: four-bucket classification — replaces the old binary
    // (balance-pass && no-flow-break) gate. In-transit flows explain part
    // of the delta before we decide whether the residual is a real break.
    const inTransitSigned = matcherResult.inTransit.reduce(
      (s, it) => s + (it.direction === 'IN' ? BigInt(it.amount) : -BigInt(it.amount)),
      0n,
    );
    // ④ 已被落账调账单解释的差异，不计入异常数。
    // 业主 2026-08-29 裁定「甲」：调账单只改余额，造成差额的那条流水本身还在，
    // 而桶规则是「残差=0 且 无在途 且 流水异常>0 → COMPENSATING」——COMPENSATING 不是
    // MATCHED，钱包仍在破口集合里，于是平了账的案子永远关不掉。把已解释的差异
    // 摘掉，案子才走得完最后一步。（差异行本身照写，只是标成 EXPLAINED，仍在
    // 案件页上看得见——「这条已被 ADJxxx 解释」是演示可见物。）
    const explained = await this.explainedDifferences.indexForWallet(walletRef);
    const isUnexplained = (a: { internalFlowId?: string; externalLineId?: string }) =>
      explainedBy(explained, a) === null;
    const anomalyCount =
      matcherResult.orphanInternal.filter(isUnexplained).length +
      matcherResult.orphanExternal.filter(isUnexplained).length +
      matcherResult.mismatch.filter(isUnexplained).length;
    const bucket = computeBucket({
      delta: balanceCheck.delta,
      inTransitSigned,
      inTransitCount: matcherResult.inTransit.length,
      anomalyCount,
    });

    let caseNo: string | null = null;
    let caseOutcome: 'CREATED' | 'REOBSERVED' | null = null;
    let breaking = false;
    // T2/Round3: one wallet-level Case per non-MATCHED wallet — upsert by
    // walletRef (cross-day unique, see upsertCaseForWallet). Whether the
    // break is balance, flow, or in-transit residual, we land on the same
    // Case row; line items reflect the current run's findings.
    if (bucket !== 'MATCHED') {
      const caseReason = !balanceCheck.pass && anomalyCount > 0
        ? 'wallet_balance_and_flow_break'
        : !balanceCheck.pass
          ? 'wallet_balance_mismatch'
          : 'wallet_flow_break';
      const { created, caseNo: openedCaseNo } = await this.upsertCaseForWallet({
        runId,
        businessDate,
        assetId,
        assetCode: currency,
        currency: assetCurrency,
        book: enriched.book,
        walletRef,
        coaCode: enriched.coaCode,
        ownerNo: enriched.ownerNo,
        delta: balanceCheck.delta,
        tbAmount: balanceCheck.internal.total,
        actualExternal: balanceCheck.external,
        inTransitSigned,
        bucket,
        matcherResult,
        explained,
        caseReason,
        slaDeadline,
        traceId,
      });
      caseOutcome = created ? 'CREATED' : 'REOBSERVED';
      breaking = true;
      caseNo = openedCaseNo;
    }

    const snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput = {
      runId,
      walletRef,
      assetCode: currency,
      book: enriched.book,
      coaCode: enriched.coaCode,
      ownerNo: enriched.ownerNo,
      bucket,
      internalTotal: new Prisma.Decimal(balanceCheck.internal.total.toString()),
      externalClosing: new Prisma.Decimal(balanceCheck.external.toString()),
      deltaAmount: new Prisma.Decimal(balanceCheck.delta.toString()),
      inTransitAmount: new Prisma.Decimal(inTransitSigned.toString()),
      matchedCount: matcherResult.matched.length,
      orphanInternal: matcherResult.orphanInternal.length,
      orphanExternal: matcherResult.orphanExternal.length,
      mismatchCount: matcherResult.mismatch.length,
      inTransitCount: matcherResult.inTransit.length,
      caseNo,
    };

    return {
      observed: true,
      snapshotRow,
      bucket,
      caseOutcome,
      breaking,
      orphanInternal,
      orphanExternal,
      mismatch,
    };
  }

  // ── 波三 T5：未归属外部头循环体（剪切粘贴自 run()，行为零差异）────────────
  private async processUnattributedHead(args: {
    bal: ExternalBalanceRow;
    runId: string;
    traceId: string | null;
    businessDate: string;
    slaDeadline: Date;
    assetCurrency: string;
  }): Promise<{
    observed: boolean;
    snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput | null;
    caseOutcome: 'CREATED' | 'REOBSERVED' | null;
  }> {
    const { bal, runId, traceId, businessDate, slaDeadline, assetCurrency } = args;
    const currency = bal.currency;
    const assetId = await this.resolveAssetId(currency);
    if (!assetId) {
      return { observed: false, snapshotRow: null, caseOutcome: null };
    }
    const closing = BigInt(bal.closingBalance.toString());
    const walletRef = bal.accountRef;

    const { created, caseNo } = await this.upsertCaseForWallet({
      runId,
      businessDate,
      assetId,
      assetCode: currency,
      currency: assetCurrency,
      book: 'FIRM',
      walletRef,
      coaCode: null,
      ownerNo: null,
      delta: closing,
      tbAmount: 0n,
      actualExternal: closing,
      inTransitSigned: 0n,
      bucket: 'BREAK',
      matcherResult: { matched: [], orphanInternal: [], orphanExternal: [], mismatch: [], inTransit: [] },
      // 未归属外部账户没有内部钱包、也就没有调账单挂得上去，空索引。
      explained: EMPTY_EXPLAINED_INDEX,
      caseReason: 'unattributed_external_account',
      slaDeadline,
      traceId,
    });

    const snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput = {
      runId,
      walletRef,
      assetCode: currency,
      book: 'FIRM',
      coaCode: null,
      ownerNo: null,
      bucket: 'BREAK',
      internalTotal: new Prisma.Decimal(0),
      externalClosing: new Prisma.Decimal(closing.toString()),
      deltaAmount: new Prisma.Decimal(closing.toString()),
      inTransitAmount: new Prisma.Decimal(0),
      matchedCount: 0,
      orphanInternal: 0,
      orphanExternal: 0,
      mismatchCount: 0,
      inTransitCount: 0,
      caseNo,
    };

    return {
      observed: true,
      snapshotRow,
      caseOutcome: created ? 'CREATED' : 'REOBSERVED',
    };
  }

  private bumpBucketCount(
    counts: { matched: number; inTransit: number; softFlag: number; break: number },
    bucket: ReconBucket,
  ): void {
    if (bucket === 'MATCHED') counts.matched += 1;
    else if (bucket === 'IN_TRANSIT') counts.inTransit += 1;
    else if (bucket === 'COMPENSATING') counts.softFlag += 1;
    else counts.break += 1;
  }

  // ── run row helpers ────────────────────────────────────────────────────────
  private async createRun(businessDate: string, manifest: unknown, triggerType: 'MANUAL' | 'SCHEDULED', cutoff: Date) {
    const prior = await this.prisma.reconciliationRun.count({
      where: { businessDate, layer: RUN_LAYER },
    });
    const seq = prior + 1;
    // Format: RUN{YYYYMMDD}-{seq} — single engine, so no engine tag in the
    // no. Sequence scoped to layer=WALLET per day.
    const runNo = `RUN${businessDate.replace(/-/g, '')}-${seq}`;
    return this.prisma.reconciliationRun.create({
      data: {
        runNo,
        businessDate,
        layer: RUN_LAYER,
        seq,
        triggerType,
        mode: 'APPLY',
        status: 'RUNNING',
        traceId: randomUUID(),
        demoManifest: manifest ? JSON.stringify(manifest) : null,
        cutoffAt: cutoff,
      },
    });
  }

  private async finishRun(
    runId: string,
    data: {
      status: WalletReconRunResult['status'];
      walletsChecked: number;
      casesOpened: number;
      casesReObserved: number;
      casesAutoHealed: number;
      bucketCounts: { matched: number; inTransit: number; softFlag: number; break: number };
    },
  ): Promise<void> {
    // T2: populate ReconciliationRun summary counters so the UI cockpit can
    // render meaningful totals (the old single-counter `openedCount` lumped
    // create+update together; here we split them and surface auto-heal).
    // Round3: also persist the four-bucket wallet counts (walletCount/
    // matchedCount/inTransitCount/softFlagCount/breakCount) — the run-detail
    // page (T6) reads these instead of recomputing from line items.
    await this.prisma.reconciliationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        // 波五 T6：invariantStatus 只反映内部恒等预门（computeInternalIdentity）
        // 破没破——普通 BREAK（每钱包比对跑过、发现破口）不是预门破裂，仍写
        // 'PASS'；只有 INTERNAL_BREAK（预门破裂、per-wallet 检查整体跳过）才
        // 写 'FAIL'，前端靠这个字段判断要不要拉红横幅、藏五卡与钱包表。
        invariantStatus: data.status === 'INTERNAL_BREAK' ? 'FAIL' : 'PASS',
        openedCount: data.casesOpened,
        reObservedCount: data.casesReObserved,
        closedCount: data.casesAutoHealed,
        completedAt: new Date(),
        walletCount: data.walletsChecked,
        matchedCount: data.bucketCounts.matched,
        inTransitCount: data.bucketCounts.inTransit,
        softFlagCount: data.bucketCounts.softFlag,
        breakCount: data.bucketCounts.break,
      },
    });
  }

  // ── Internal-identity pre-gate ────────────────────────────────────────────
  /**
   * Verify L sums equal A sums per ledger by reading TigerBeetle directly.
   * Mirror of `scripts/verify-realtime-coa.ts`: per-account balance =
   *   asset (debit-normal):    debits_posted − credits_posted
   *   L / E (credit-normal):   credits_posted − debits_posted
   * Then per ledger:
   *   sum(CLIENT_ASSET) == sum(CLIENT_PAYABLE+DEPOSIT_SUSPENSE)
   *   sum(FIRM_ASSET)   == sum(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER)
   *
   * `cutoff` is intentionally NOT honored here — TB doesn't expose historical
   * snapshots without account-history reads, and Phase B treats identity as
   * the *current* ledger state. (Per-wallet balance checks below still honor
   * cutoff via account_flows.)
   */
  protected async computeInternalIdentity(_cutoff: Date): Promise<InternalIdentityResult> {
    const registry = (await this.prisma.tbAccountRegistry.findMany({
      where: { status: 'ACTIVE' },
      select: { tbAccountId: true, code: true, ledger: true },
    })) as Array<{ tbAccountId: string; code: number; ledger: number }>;
    if (registry.length === 0) return { balanced: true, breaks: [] };

    const tbIds = registry.map((r) => BigInt('0x' + r.tbAccountId));
    let accounts: Array<{ id: bigint; code: number; debits_posted: bigint; credits_posted: bigint }> = [];
    try {
      accounts = await this.tigerBeetle.lookupAccounts(tbIds);
    } catch (err) {
      this.logger.warn(`[wallet-recon] TigerBeetle lookup failed (${(err as Error).message}) — treating identity as broken`);
      return {
        balanced: false,
        breaks: [{ ledger: -1, side: 'CLIENT', asset: 'TB_UNREACHABLE', liab: 'TB_UNREACHABLE', delta: 'TB_UNREACHABLE' }],
      };
    }

    const balById = new Map<string, bigint>();
    for (const a of accounts) {
      const isAsset = ASSET_TB_CODES.has(a.code);
      const bal = isAsset ? a.debits_posted - a.credits_posted : a.credits_posted - a.debits_posted;
      balById.set(a.id.toString(), bal);
    }

    interface LedgerSums {
      clientAsset: bigint;
      clientLiab: bigint;
      firmAsset: bigint;
      firmEquity: bigint;
    }
    const sums = new Map<number, LedgerSums>();
    for (const r of registry) {
      const key = BigInt('0x' + r.tbAccountId).toString();
      const bal = balById.get(key) ?? 0n;
      const s = sums.get(r.ledger) ?? { clientAsset: 0n, clientLiab: 0n, firmAsset: 0n, firmEquity: 0n };
      if (r.code === TB_ACCOUNT_CODES.CLIENT_ASSET) s.clientAsset += bal;
      else if (r.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || r.code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) s.clientLiab += bal;
      else if (r.code === TB_ACCOUNT_CODES.FIRM_ASSET) s.firmAsset += bal;
      else if (
        r.code === TB_ACCOUNT_CODES.FIRM_OPS ||
        r.code === TB_ACCOUNT_CODES.FIRM_SET ||
        r.code === TB_ACCOUNT_CODES.INCOME_SWAP_FEE ||
        r.code === TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE ||
        r.code === TB_ACCOUNT_CODES.INCOME_OTHER
      ) s.firmEquity += bal;
      sums.set(r.ledger, s);
    }

    const breaks: InternalIdentityResult['breaks'] = [];
    for (const [ledger, s] of sums) {
      if (s.clientAsset !== s.clientLiab) {
        breaks.push({
          ledger,
          side: 'CLIENT',
          asset: s.clientAsset.toString(),
          liab: s.clientLiab.toString(),
          delta: (s.clientAsset - s.clientLiab).toString(),
        });
      }
      if (s.firmAsset !== s.firmEquity) {
        breaks.push({
          ledger,
          side: 'FIRM',
          asset: s.firmAsset.toString(),
          liab: s.firmEquity.toString(),
          delta: (s.firmAsset - s.firmEquity).toString(),
        });
      }
    }
    return { balanced: breaks.length === 0, breaks };
  }

  // ── External-statement-line lookup per wallet ─────────────────────────────
  /**
   * Pull external_statement_lines that belong to this wallet up to cutoff.
   * Matching key:
   *   - subAccount == walletRef   (preferred; ZAND fills VirtualAccount/HEXTRUST custody id here)
   *   - OR accountRef == accountRef from this wallet's external balance row
   *     (legacy fall-through when subAccount is null on bank lines)
   *
   * Returns only the columns the matcher needs.
   */
  protected async fetchExternalLinesForWallet(
    walletRef: string,
    accountRef: string,
    cutoff: Date,
  ): Promise<ExternalStatementLineInput[]> {
    const lines = (await this.prisma.externalStatementLine.findMany({
      where: {
        OR: [{ subAccount: walletRef }, { subAccount: null, accountRef }],
        datetime: { lte: cutoff },
      },
      select: { id: true, direction: true, amount: true, externalRef: true, datetime: true },
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null; datetime: Date }>;
    return lines.map((l) => ({
      id: l.id,
      direction: l.direction as 'IN' | 'OUT',
      amount: l.amount,
      externalRef: l.externalRef,
      datetime: l.datetime,
    }));
  }

  protected async resolveAssetId(currency: string): Promise<string | null> {
    const asset = await this.prisma.asset.findFirst({
      where: { code: currency },
      select: { id: true },
    });
    return asset?.id ?? null;
  }

  // ── Case + line items (T2 wallet-keyed upsert) ────────────────────────────
  /**
   * T5 (Round3 §2.5): upsert one Case per walletRef — cross-day, not scoped
   * to businessDate. If a status=OPEN case already exists for the wallet
   * (from any prior day), refresh its snapshot fields
   * (delta / amounts / lastUpdatedRunId / severity) and replace its line items
   * with the current run's findings — do NOT bump firstSeenRunId. If absent,
   * create a fresh case with firstSeenRunId=lastUpdatedRunId=runId.
   *
   * Returns `{ caseId, created }` so the caller can split create vs re-observe
   * counters for the Run summary fields.
   *
   * Line-item strategy: delete-then-insert. The lineItems describe the *current*
   * run's findings, not historical accumulation — so each rerun overwrites the
   * prior set. (Audit trail of which run found what is recoverable via
   * lineItem.foundByRunId joined back to ReconciliationRun.)
   */

  /**
   * When balanceChecker returns walletKind=UNKNOWN (firm wallet whose flows
   * only landed on aggregate FIRM_ASSET legs, or a fresh wallet with no
   * activity), it can't classify the wallet — coaCode comes back '' and
   * ownerNo comes back null. Look up the wallet row and derive sensible
   * defaults from walletRole + ownerType + ownerNo so case rows aren't
   * written with empty strings.
   */
  private static readonly COA_BY_ROLE: Record<string, string> = {
    F_OPS:   'E.FIRM_OPS',
    F_SET:   'E.FIRM_SET',
    F_LIQ:   'E.FIRM_LIQ', // 退役科目,钱包仍在,期望恒 0
    F_FEE:   'E.INCOME_SWAP_FEE+E.INCOME_WITHDRAW_FEE+E.INCOME_OTHER',
    C_DEP:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_VIBAN: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_CMA:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
  };

  private async enrichIfUnknown(
    walletRef: string,
    balanceCheck: WalletBalanceCheckResult,
  ): Promise<{ book: 'CUSTOMER' | 'FIRM'; coaCode: string; ownerNo: string | null }> {
    if (balanceCheck.walletKind !== 'UNKNOWN') {
      return {
        book: balanceCheck.walletKind === 'FIRM' ? 'FIRM' : 'CUSTOMER',
        coaCode: balanceCheck.coaCode,
        ownerNo: balanceCheck.ownerNo,
      };
    }
    const wallet = (await this.prisma.wallet.findUnique({
      where: { id: walletRef },
      select: { walletRole: true, ownerType: true, ownerNo: true },
    })) as { walletRole: string | null; ownerType: string | null; ownerNo: string | null } | null;
    if (!wallet) {
      // Defensive: walletRef points at no wallet row — fall back to raw
      // balanceCheck values so the case still writes (shouldn't happen in
      // normal flow now that XREF synthetic refs are gone).
      return { book: 'CUSTOMER', coaCode: balanceCheck.coaCode, ownerNo: balanceCheck.ownerNo };
    }
    const isFirm = wallet.ownerType !== 'CUSTOMER';
    const role = wallet.walletRole ?? '';
    return {
      book: isFirm ? 'FIRM' : 'CUSTOMER',
      coaCode: WalletReconRunService.COA_BY_ROLE[role] ?? balanceCheck.coaCode,
      ownerNo: wallet.ownerNo ?? balanceCheck.ownerNo,
    };
  }

  protected async upsertCaseForWallet(input: {
    runId: string;
    businessDate: string;
    assetId: string;
    assetCode: string;
    currency: string;
    book: 'CUSTOMER' | 'FIRM';
    walletRef: string;
    coaCode: string | null;
    ownerNo: string | null;
    delta: bigint;
    tbAmount: bigint;
    actualExternal: bigint;
    inTransitSigned: bigint;
    bucket: ReconBucket;
    matcherResult: Awaited<ReturnType<WalletFlowMatcherService['matchFlows']>>;
    explained: ExplainedIndex;
    caseReason: string;
    slaDeadline: Date;
    traceId: string | null;
  }): Promise<{ caseId: string; caseNo: string; created: boolean }> {
    const deltaDecimal = new Prisma.Decimal(input.delta.toString());
    const tbDecimal = new Prisma.Decimal(input.tbAmount.toString());
    const externalDecimal = new Prisma.Decimal(input.actualExternal.toString());
    const inTransitDecimal = new Prisma.Decimal(input.inTransitSigned.toString());
    const expectedDecimal = externalDecimal.minus(deltaDecimal);
    const severity = computeSeverity(input.currency, input.delta);

    // Idempotency probe: cross-day unique — (walletRef, status:OPEN) only.
    // Round3 T5 Step③: businessDate intentionally dropped from the probe so
    // an OPEN case persists across reruns on later days (re-observation
    // refreshes the same row instead of forking a new one per day).
    // 第六幕波三 T2：探针与写点全部经 ReconciliationCaseService（唯一写点）。
    const existing = await this.caseService.findOpenByWallet(input.walletRef);

    let caseId: string;
    let caseNo: string;
    let created: boolean;
    if (existing) {
      await this.caseService.reObserve({
        caseId: existing.id,
        runId: input.runId,
        tbAmount: tbDecimal,
        inTransitAmount: inTransitDecimal,
        expectedExternal: expectedDecimal,
        actualExternal: externalDecimal,
        deltaAmount: deltaDecimal,
        severity,
        bucket: input.bucket,
        assetId: input.assetId,
        assetCode: input.assetCode,
        book: input.book,
        coaCode: input.coaCode,
        ownerNo: input.ownerNo,
      });
      caseId = existing.id;
      caseNo = existing.caseNo;
      created = false;
      // Replace line items: drop prior + insert current. ON DELETE CASCADE
      // is set on the FK so this is atomic to the lineItems table.
      // （行明细留在 recon-run 原地——它是 run 的证据写点，不是 Case 表。）
      await this.prisma.reconciliationLineItem.deleteMany({
        where: { caseId: existing.id },
      });
    } else {
      const opened = await this.caseService.openCase({
        runId: input.runId,
        businessDate: input.businessDate,
        assetId: input.assetId,
        assetCode: input.assetCode,
        layer: RUN_LAYER,
        book: input.book,
        walletRef: input.walletRef,
        coaCode: input.coaCode,
        ownerNo: input.ownerNo,
        tbAmount: tbDecimal,
        inTransitAmount: inTransitDecimal,
        expectedExternal: expectedDecimal,
        actualExternal: externalDecimal,
        deltaAmount: deltaDecimal,
        severity,
        bucket: input.bucket,
        slaDeadline: input.slaDeadline,
        traceId: input.traceId,
        delta: input.delta,
      });
      caseId = opened.caseId;
      caseNo = opened.caseNo;
      created = true;
    }

    await this.writeLineItems(caseId, input.runId, input.walletRef, input.matcherResult, input.explained);
    return { caseId, caseNo, created };
  }

  private async writeLineItems(
    caseId: string,
    runId: string,
    walletRef: string,
    matcherResult: Awaited<ReturnType<WalletFlowMatcherService['matchFlows']>>,
    explained: ExplainedIndex,
  ): Promise<void> {
    let lineNo = 0;
    // ④ 已被落账调账单解释的差异行照写不误——它是案子上的证据，要给人看
    // 「这条差异已经由 ADJxxx 解释了」；只是不再算进 anomalyCount（见 run()）。
    const disposition = (a: { internalFlowId?: string; externalLineId?: string }) => {
      const adjustmentNo = explainedBy(explained, a);
      return adjustmentNo
        ? { status: 'EXPLAINED', resolution: adjustmentNo }
        : { status: 'OPEN', resolution: null };
    };
    for (const oi of matcherResult.orphanInternal) {
      lineNo += 1;
      await this.prisma.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'ORPHAN_INTERNAL',
          internalSourceId: oi.internalFlowId,
          internalAmount: new Prisma.Decimal(oi.amount),
          internalDirection: oi.direction,
          walletRef,
          externalRef: oi.externalRef,
          ...disposition(oi),
        },
      });
    }
    for (const oe of matcherResult.orphanExternal) {
      lineNo += 1;
      await this.prisma.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'ORPHAN_EXTERNAL',
          externalTxId: oe.externalLineId,
          externalAmount: new Prisma.Decimal(oe.amount),
          externalDirection: oe.direction,
          walletRef,
          externalRef: oe.externalRef,
          ...disposition(oe),
        },
      });
    }
    for (const m of matcherResult.mismatch) {
      lineNo += 1;
      await this.prisma.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'AMOUNT_MISMATCH',
          internalSourceId: m.internalFlowId,
          internalAmount: new Prisma.Decimal(m.internalAmount),
          externalTxId: m.externalLineId,
          externalAmount: new Prisma.Decimal(m.externalAmount),
          walletRef,
          externalRef: m.ref,
          ...disposition(m),
        },
      });
    }
    for (const it of matcherResult.inTransit) {
      lineNo += 1;
      await this.prisma.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'IN_TRANSIT',
          internalSourceType: 'FUNDS_ORDER',
          internalSourceId: it.fundsOrderId,
          internalSourceNo: it.fundsOrderNo,
          externalTxId: it.externalLineId,
          externalAmount: new Prisma.Decimal(it.amount),
          externalDirection: it.direction,
          externalTimestamp: it.externalTimestamp,
          walletRef,
          externalRef: it.externalRef,
        },
      });
    }
  }

  /**
   * T5 auto-heal (Round3 §2.5)：本轮**查过**（walletRef ∈ observedWallets）
   * 且**没破口**（∉ currentBreakingWallets）的钱包，其 OPEN 案件视为已恢复，关掉。
   *
   * 「查过」这个前提是 2026-08-29 补上的（业主走查逮到）。此前判据只有「不在破口
   * 集合里」，于是一轮外部对账单一行都没取到的对账——破口集合空集、`notIn []`
   * 命中全部——把所有 OPEN 案件一次关光（实测 walletCount=0 / closedCount=8）。
   * 业务口径：**没收到对账单是一类异常（no-feed），不是「账平了」的证据。**
   *
   * 跨天仍然放行（案件开在 D 日、D+1 日查过且平了 → 自愈），这是 T5 Step③ 的原意；
   * 但只许往前走：`businessDate <= 本轮业务日`——不能拿 D−1 日的数据去关 D 日的
   * 案子（同一次走查里，业务日 8-27 的 run 关掉了业务日 8-28 的案件，时间倒着走）。
   *
   * Scoped to layer=WALLET so we never touch legacy V8_FORMULA cases that
   * sit alongside Phase B rows.
   */
  protected async autoHealCases(input: {
    runId: string;
    traceId: string | null;
    observedWallets: Set<string>;
    businessDate: string;
    currentBreakingWallets: Set<string>;
  }): Promise<number> {
    // 可愈合集合 = 本轮查过的钱包 − 本轮破口钱包。**不是**「所有 OPEN 案件 −
    // 破口钱包」——差别就是那次 0 钱包关 8 案件的事故。
    const healable = Array.from(input.observedWallets).filter(
      (w) => !input.currentBreakingWallets.has(w),
    );
    if (healable.length === 0) return 0;

    const stale = (await this.prisma.reconciliationCase.findMany({
      where: {
        status: 'OPEN',
        layer: RUN_LAYER,
        walletRef: { in: healable },
        businessDate: { lte: input.businessDate },
      },
      select: { id: true, caseNo: true, walletRef: true },
    })) as Array<{ id: string; caseNo: string; walletRef: string }>;

    if (stale.length === 0) return 0;
    const now = new Date();
    for (const c of stale) {
      await this.caseService.resolveAutoHealed({
        caseId: c.id,
        caseNo: c.caseNo,
        walletRef: c.walletRef,
        runId: input.runId,
        traceId: input.traceId,
        resolvedAt: now,
      });
    }
    return stale.length;
  }

  // ── Audit (DI — never `new AuditLogsService`) ─────────────────────────────
  // 第六幕波三 T2：RECON_CASE_OPENED / RECON_CASE_AUTO_HEALED 两条审计已随写点
  // 搬进 ReconciliationCaseService（openCase / resolveAutoHealed 内部发），
  // 本文件不再重复留痕。auditRunCompleted 是跑批级留痕，留在这里不动。
  private async auditRunCompleted(input: {
    runNo: string;
    traceId: string | null;
    actor?: AuditActorContext;
    status: WalletReconRunResult['status'];
    walletsChecked: number;
    casesOpened: number;
    casesReObserved: number;
    casesAutoHealed: number;
    bucketCounts: { matched: number; inTransit: number; softFlag: number; break: number };
    cutoffAt: Date;
  }): Promise<void> {
    // 双通道（同动作不因语境拆名）：cron 走系统通道，管理员触发记他名字——
    // 主对象号用业务跑批号 runNo，不漏内部 UUID。
    const envelope = {
      action: 'RECON_RUN_COMPLETED',
      actionDomain: 'RECON',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.RECONCILIATION_RUN_V8,
      primarySubjectNo: input.runNo,
      subjects: [
        { subjectType: AuditEntityTypes.RECONCILIATION_RUN_V8, subjectNo: input.runNo, subjectRole: AuditSubjectRole.PRIMARY },
      ],
      traceId: input.traceId ?? undefined,
      requestId: `RECON_RUN_COMPLETED_${input.runNo}_${randomUUID()}`,
      sourcePlatform: input.actor ? 'ADMIN_API' : 'SYSTEM',
      metadata: {
        status: input.status,
        walletsChecked: input.walletsChecked,
        matchedCount: input.bucketCounts.matched,
        inTransitCount: input.bucketCounts.inTransit,
        softFlagCount: input.bucketCounts.softFlag,
        breakCount: input.bucketCounts.break,
        casesOpened: input.casesOpened,
        casesReObserved: input.casesReObserved,
        casesAutoHealed: input.casesAutoHealed,
        cutoffAt: input.cutoffAt.toISOString(),
      },
    };
    if (input.actor) await this.auditLogs.recordByActor(envelope, input.actor);
    else await this.auditLogs.recordSystem(envelope);
  }

}

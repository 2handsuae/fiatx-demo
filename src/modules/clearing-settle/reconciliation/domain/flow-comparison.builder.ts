import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
  internalFlowWhere,
} from '../engine/v2/wallet-flow-matcher.service';
import { WalletBalanceCheckerService } from '../engine/v2/wallet-balance-checker.service';
import { ExplainedDifferenceService } from '../disposition/explained-difference.service';
import {
  FlowComparisonRow,
  FlowComparisonSummary,
} from '../dto/reconciliation.dto';

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
@Injectable()
export class FlowComparisonBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletFlowMatcher: WalletFlowMatcherService,
    private readonly explainedDifferences: ExplainedDifferenceService,
    // 取案子钱包的现金户——与对账引擎读的是同一个户（resolveCashAccount 是两边共用的唯一入口）。
    private readonly balanceChecker: WalletBalanceCheckerService,
  ) {}

  async build(
    kase: { walletRef: string; cutoff: Date; businessDate: string; assetCode: string },
  ): Promise<{ rows: FlowComparisonRow[]; summary: FlowComparisonSummary }> {
    // cutoff 由 getCase 决定（run.cutoffAt 优先，历史行回落日终），本函数不再自算。
    const cutoff = kase.cutoff;

    // 1. Source datasets.
    const accountRefs = (await this.prisma.externalBalance.findMany({
      where: { walletRef: kase.walletRef, cutoffDate: kase.businessDate },
      select: { accountRef: true },
    })) as Array<{ accountRef: string }>;

    const externalRowsRaw = (await this.prisma.externalStatementLine.findMany({
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

    // 内部侧 = 案子钱包现金户上已落账（POSTED）的行——取数条件与匹配器、余额检查器同一份（internalFlowWhere / 都按现金户
    // tbAccountId 取、只取 POSTED）：挂起未落账的转账还没穿越；两锚皆空的调账行只进余额、不进逐行对照；有锚的调账 / 记短缺行
    // 进来，由第 0 轮按锚配对（这里是配对结果的取行来源，几处口径不许各管各的）。
    // 案子的 walletRef 不是钱包行（未归属的外部账户）→ 没有现金户 → 内部侧为空，与匹配器的 null 路径一致。
    const cashAccount = await this.balanceChecker.resolveCashAccount(kase.walletRef);
    // ④ 案件页要看得见「这条差异已被 ADJxxx / ITRxxx 解释」——与对账引擎用的是同一份锚点清单
    // （explained-difference.service.ts），不各写一套判断。
    const explainedAnchors = await this.explainedDifferences.indexForWallet(kase.walletRef, cashAccount?.tbAccountId ?? null);
    const internalRows = (cashAccount
      ? await this.prisma.accountFlow.findMany({
        where: internalFlowWhere(cashAccount.tbAccountId, cutoff, explainedAnchors),
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
      })
      : []) as Array<{
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
    const assetForDecimals = (await this.prisma.asset.findUnique({
      where: { code: kase.assetCode },
      select: { decimals: true },
    })) as { decimals: number } | null;
    const matcher = await this.walletFlowMatcher.matchFlows({
      walletRef: kase.walletRef,
      cashTbAccountId: cashAccount?.tbAccountId ?? null,
      externalLines,
      explainedAnchors,
      cutoff,
      decimals: assetForDecimals?.decimals ?? 0,
    });

    // 第 0 轮配出的行"解释掉"多少：组内属于那张单自己落账的流水（= 锚点清单项的 flowId）的金额之和（绝对值）。
    // 不能用行两侧的金额——认损补缺时外部侧 750、内部原流水 1000，被解释的差额是记短缺那一条的 250。
    const anchorFlowIds = new Set(explainedAnchors.map((a) => a.flowId));
    const explainedAmountOf = (m: { internalFlowId: string; groupFlowIds?: string[] }): string => {
      let sum = new Prisma.Decimal(0);
      for (const id of m.groupFlowIds ?? [m.internalFlowId]) {
        if (anchorFlowIds.has(id)) sum = sum.plus(intById.get(id)?.amount ?? 0);
      }
      return sum.toString();
    };

    const rows: FlowComparisonRow[] = [];
    for (const m of matcher.matched) {
      const ext = m.externalLineId ? extById.get(m.externalLineId) : null;
      const intl = intById.get(m.internalFlowId);
      if (!intl || (m.externalLineId && !ext)) continue;
      rows.push({
        externalLine: ext
          ? {
            id: ext.id,
            externalRef: ext.externalRef,
            amount: ext.amount.toString(),
            direction: ext.direction as 'IN' | 'OUT',
            timestamp: ext.datetime.toISOString(),
            description: ext.description,
          }
          : null,
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
        // 第 0 轮锚配对配出来的行：解释它的调账单 / 认损补缺单号（Pass 1 / 2 配出来的行不挂注解）。
        ...(m.resolution ? { explainedByAdjustmentNo: m.resolution, explainedAmount: explainedAmountOf(m) } : {}),
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
        explainedByAdjustmentNo: null,
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
        explainedByAdjustmentNo: null,
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
        explainedByAdjustmentNo: null,
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

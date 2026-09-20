import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
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

    const internalRows = (await this.prisma.accountFlow.findMany({
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
    const assetForDecimals = (await this.prisma.asset.findUnique({
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

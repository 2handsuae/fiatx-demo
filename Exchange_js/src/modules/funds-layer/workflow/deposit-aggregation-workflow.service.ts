import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositAggregationSourceService } from '../domain/deposit-aggregation-source.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import {
  AGGREGATION_THRESHOLD,
  DUST_THRESHOLD,
} from '../constants/internal-transfer-paths.constant';

type AggregationCandidate = {
  toWalletId: string;
  assetId: string;
  ownerId: string;
  ownerType: string;
  depositIds: string[];
  anchorDepositId: string;
  totalAmount: Prisma.Decimal;
};

/**
 * V7 L3 deposit-aggregation sweep.
 *
 * For each C_DEP wallet whose unaggregated SUCCESS deposits clear the
 * AGGREGATE threshold, moves the funds to the platform C_MAIN wallet via the
 * universal internal-transfer workflow, then marks the source deposits
 * aggregated. Per-item failures are isolated so one bad wallet cannot abort the
 * whole sweep.
 */
@Injectable()
export class DepositAggregationWorkflowService {
  private readonly logger = new Logger(DepositAggregationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: DepositAggregationSourceService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  async runSweep(
    operatorId = 'SYSTEM',
  ): Promise<{ aggregated: number; skipped: number }> {
    const candidates = await this.deposits.findAggregationCandidates();
    let aggregated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      try {
        const didAggregate = await this.aggregateOne(candidate, operatorId);
        if (didAggregate) {
          aggregated += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        skipped += 1;
        this.logger.error(
          `Aggregation failed for wallet=${candidate.toWalletId} asset=${candidate.assetId}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return { aggregated, skipped };
  }

  private async aggregateOne(
    candidate: AggregationCandidate,
    operatorId: string,
  ): Promise<boolean> {
    const threshold = new Prisma.Decimal(AGGREGATION_THRESHOLD);
    const dust = new Prisma.Decimal(DUST_THRESHOLD);

    if (candidate.totalAmount.lt(dust)) {
      // dust：太小不动
      return false;
    }
    if (candidate.totalAmount.lt(threshold)) {
      // 未达归集阈值：等更多充值
      return false;
    }

    const sourceId = `${candidate.toWalletId}:${candidate.anchorDepositId}`;

    // Idempotency: a prior sweep may have already initiated this transfer (but
    // crashed before markAggregated). Re-find it instead of double-transferring.
    const existing = await (this.prisma as any).internalTransaction.findFirst({
      where: { sourceType: 'DEPOSIT_AGGREGATION', sourceId },
    });

    let transfer: { id: string };
    if (!existing) {
      const mainWallet = await this.systemWallets.resolve(
        candidate.assetId,
        'C_MAIN',
      );
      transfer = await this.transferWorkflow.initiate(
        {
          fromRole: 'C_DEP',
          toRole: 'C_MAIN',
          sourceType: 'DEPOSIT_AGGREGATION',
          sourceId,
          ownerType: 'PLATFORM',
          ownerId: 'PLATFORM',
          assetId: candidate.assetId,
          amount: candidate.totalAmount.toString(),
          fromWalletId: candidate.toWalletId,
          toWalletId: mainWallet.id,
          triggerSource: 'CRON',
        },
        operatorId,
      );
    } else {
      transfer = existing;
    }

    await this.deposits.markAggregated(candidate.depositIds, transfer.id);
    return true;
  }
}

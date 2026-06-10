import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { WithdrawTransactionStatus } from '../../trading/withdraw-transactions/dto/withdraw-transaction.dto';

const FEE_SOURCE_TYPE = 'FEE_COLLECTION';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
}

export interface RunFeeCollectionResult {
  batchNo: string | null;
  assetCount: number;
  collected: number;
}

interface FeeCandidate {
  assetId: string;
  currency: string;
  decimals: number;
  netDecimal: Prisma.Decimal;
}

/**
 * V7 Phase-4 L3 fee-collection workflow.
 *
 * Per-asset: 应归集 = Σ成功提现 feeAmount − Σ已归集(FEE_COLLECTION internalTransaction amount)。
 * 推导自不变量「客户池 − Σclaim = 未归集 fee」,无需任何挂账科目。
 * SUCCESS 是终态(RETURNED 在成功前分叉),差额口径自校正、中断重跑安全。
 *
 * 物理转账: C_MAIN→F_OPS (class B); TB 镜像由 funds-flow CLEAR 的
 * FEE_DECOMMINGLE 完成(Task 6); 不再读任何 TB 挂账余额。
 *
 * Layering: orchestrates domain services only; the sole direct Prisma use is the
 * asset query, the Prisma-derived fee net, and the read-only idempotency `findFirst`.
 */
@Injectable()
export class FeeCollectionWorkflowService {
  private readonly logger = new Logger(FeeCollectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  async runFeeCollection(operatorId = 'SYSTEM'): Promise<RunFeeCollectionResult> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE', type: 'CRYPTO' },
      select: { id: true, currency: true, decimals: true },
    });

    const candidates: FeeCandidate[] = [];
    for (const asset of assets) {
      // 应归集 = 成功提现累计 fee − 历史已归集(FEE_COLLECTION transfer 累计)。
      // 推导自不变量「客户池 − Σclaim = 未归集 fee」,无需任何挂账科目。
      // SUCCESS 是终态,不会回退(RETURNED 在成功前分叉),差额口径自校正、中断重跑安全。
      const accrued = await (this.prisma as any).withdrawTransaction.aggregate({
        where: { assetId: asset.id, status: WithdrawTransactionStatus.SUCCESS },
        _sum: { feeAmount: true },
      });
      const collected = await (this.prisma as any).internalTransaction.aggregate({
        // Terminally failed collect transfers never moved funds — excluding them
        // lets the next run re-collect the same fees instead of losing them.
        where: {
          assetId: asset.id,
          sourceType: FEE_SOURCE_TYPE,
          status: { notIn: ['FAILED', 'CANCELLED'] },
        },
        _sum: { amount: true },
      });
      const net = new Prisma.Decimal(accrued._sum.feeAmount ?? 0).sub(
        new Prisma.Decimal(collected._sum.amount ?? 0),
      );
      if (net.lte(0)) continue;

      candidates.push({ assetId: asset.id, currency: asset.currency, decimals: asset.decimals, netDecimal: net });
    }

    // No accrued fees → return without creating an empty batch.
    if (candidates.length === 0) {
      this.logger.log('Fee collection: no accrued fees (Prisma-derived) — no-op');
      return { batchNo: null, assetCount: 0, collected: 0 };
    }

    const batch = await this.batchService.createBatch({
      cutoffAt: new Date(),
      settlementType: 'FEE_COLLECT',
    });

    let collected = 0;

    for (const candidate of candidates) {
      const from = await this.systemWallets.resolve(candidate.assetId, 'C_MAIN');
      const ops = await this.systemWallets.resolve(candidate.assetId, 'F_OPS');

      const sourceId = `${batch.id}:${candidate.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: FEE_SOURCE_TYPE, sourceId },
      });

      if (!existing) {
        await this.transferWorkflow.initiate(
          {
            fromRole: 'C_MAIN',
            toRole: 'F_OPS',
            sourceType: FEE_SOURCE_TYPE,
            sourceId,
            sourceNo: batch.batchNo,
            ownerType: 'PLATFORM',
            ownerId: 'PLATFORM',
            assetId: candidate.assetId,
            amount: candidate.netDecimal.toString(),
            fromWalletId: from.id,
            toWalletId: ops.id,
            triggerSource: 'CRON',
            settlementBatchId: batch.id,
            grossInAmount: '0',
            grossOutAmount: candidate.netDecimal.toString(),
          },
          operatorId,
        );
      }
      collected += 1;
    }

    await this.batchService.recomputeBatch(batch.id);

    return { batchNo: batch.batchNo, assetCount: candidates.length, collected };
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent) {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      // Not one of ours — EOD / aggregation / fund-out are handled elsewhere.
      if (!transfer || transfer.sourceType !== FEE_SOURCE_TYPE) return;
      if (!transfer.settlementBatchId) return;

      await this.batchService.recomputeBatch(transfer.settlementBatchId);
    } catch (err) {
      this.logger.error(
        `Failed to recompute fee-collection batch for internalTransfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}

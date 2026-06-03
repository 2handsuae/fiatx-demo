import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';

const EOD_SOURCE_TYPE = 'EOD_SETTLEMENT';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
}

export interface RunEodSettlementResult {
  batchNo: string | null;
  assetCount: number;
  settledZero: number;
  spawned: number;
}

/**
 * V7 Phase-3 L3 EOD settlement workflow.
 *
 * Orchestrates the funds-layer domain services to settle the day's open crypto
 * outstandings: net per asset → create a settlement batch + per-asset items →
 * lock & link the consumed outstandings → for a non-zero net, spawn the
 * whitelisted INTERNAL_OUT/IN transfer (via the universal transfer workflow) →
 * recompute the batch rollup. When a spawned transfer's funds-flow clears
 * (fundsflow.status.changed → CLEAR), it settles the item's LOCKED outstandings,
 * closes the item, and recomputes the batch.
 *
 * Layering: orchestrates domain services only; the sole direct Prisma use is the
 * read-only idempotency `findFirst` and the `findUnique`/`findFirst` reads in the
 * event handler. All writes go through domain services.
 */
@Injectable()
export class EodSettlementWorkflowService {
  private readonly logger = new Logger(EodSettlementWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly consumer: OutstandingConsumerService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  async runEodSettlement(operatorId = 'SYSTEM'): Promise<RunEodSettlementResult> {
    const groups = await this.consumer.findOpenCryptoByAsset();

    // No open crypto outstandings → return early without creating an empty
    // batch (avoids littering the batch list with empty EOD runs).
    if (groups.length === 0) {
      this.logger.log('EOD settlement: no open crypto outstandings — no-op');
      return { batchNo: null, assetCount: 0, settledZero: 0, spawned: 0 };
    }

    const batch = await this.batchService.createBatch({ cutoffAt: new Date() });

    let settledZero = 0;
    let spawned = 0;

    for (const group of groups) {
      const dir = this.batchService.resolveCryptoDirection(group.net);

      const item = await this.batchService.createItem({
        settlementBatchId: batch.id,
        assetId: group.assetId,
        assetCode: group.assetCode,
        inAmount: group.inAmount,
        outAmount: group.outAmount,
        netAmount: group.net,
        direction: dir?.path ?? null,
        outstandingCount: group.outstandingIds.length,
      });

      await this.consumer.lock(group.outstandingIds, batch.id);
      await this.consumer.linkItem(group.outstandingIds, item.id);

      if (dir == null) {
        // net == 0: nothing to move, the consumed outstandings are settled here.
        await this.consumer.markNettedZero(item.id);
        settledZero += 1;
        continue;
      }

      const from = await this.systemWallets.resolve(group.assetId, dir.fromRole);
      const to = await this.systemWallets.resolve(group.assetId, dir.toRole);

      const sourceId = `${batch.id}:${group.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: EOD_SOURCE_TYPE, sourceId },
      });

      const transfer = existing
        ? existing
        : await this.transferWorkflow.initiate(
            {
              fromRole: dir.fromRole,
              toRole: dir.toRole,
              sourceType: EOD_SOURCE_TYPE,
              sourceId,
              sourceNo: batch.batchNo,
              ownerType: 'PLATFORM',
              ownerId: 'PLATFORM',
              assetId: group.assetId,
              amount: dir.amount.toString(),
              fromWalletId: from.id,
              toWalletId: to.id,
              triggerSource: 'EOD',
            },
            operatorId,
          );

      await this.batchService.linkItemTransfer(item.id, transfer.id);
      spawned += 1;
    }

    await this.batchService.recomputeBatch(batch.id);

    return {
      batchNo: batch.batchNo,
      assetCount: groups.length,
      settledZero,
      spawned,
    };
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent) {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      // Not one of ours — the universal transfer workflow handles its own audits.
      if (!transfer || transfer.sourceType !== EOD_SOURCE_TYPE) return;

      const item = await (this.prisma as any).settlementBatchItem.findFirst({
        where: { internalTransactionId: event.internalTransferId },
      });
      if (!item) {
        this.logger.warn(
          `EOD CLEAR: no settlement item for internalTransfer=${event.internalTransferId}`,
        );
        return;
      }

      // Mark the item's LOCKED outstandings SETTLED (closed by the funds flow),
      // close the item (terminal), then recompute the batch rollup.
      await this.consumer.settle(item.id, event.fundsFlowId);
      await this.batchService.closeItem(item.id, item.outstandingCount ?? 0);
      await this.batchService.recomputeBatch(item.settlementBatchId);
    } catch (err) {
      this.logger.error(
        `Failed to settle EOD item for internalTransfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}

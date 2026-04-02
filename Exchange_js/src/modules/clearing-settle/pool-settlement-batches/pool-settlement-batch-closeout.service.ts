import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { PoolSettlementBatchStatus } from './dto/pool-settlement-batch.dto';

type TxClient = Prisma.TransactionClient;

type InternalFundStatusChangedEvent = {
  internalFundId: string;
  internalTransactionId?: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
};

type PoolSettlementBatchItemSnapshot = {
  id: string;
  batchId: string;
  status: string;
};

type PoolSettlementBatchItemSourceRow = {
  id: string;
  batchItemId?: string | null;
  sourceFamily: string;
  sourceId: string;
};

@Injectable()
export class PoolSettlementBatchCloseoutService {
  private readonly logger = new Logger(PoolSettlementBatchCloseoutService.name);
  private static readonly FAILED_FUND_TERMINAL_STATUSES = new Set<string>([
    InternalFundStatus.FAILED,
    InternalFundStatus.TIMEOUT,
    InternalFundStatus.RETURNED,
    InternalFundStatus.CANCELLED,
  ]);
  private static readonly TERMINAL_ITEM_STATUSES = new Set<string>([
    'SUCCESS',
    'FAILED',
  ]);
  private static readonly TERMINAL_BATCH_STATUSES = new Set<string>([
    PoolSettlementBatchStatus.SUCCESS,
    PoolSettlementBatchStatus.PARTIAL_FAILED,
    PoolSettlementBatchStatus.FAILED,
    PoolSettlementBatchStatus.CANCELLED,
  ]);

  constructor(private readonly prisma: PrismaService) {}

  private isFundTerminalStatus(status: string) {
    return (
      status === InternalFundStatus.CLEAR ||
      PoolSettlementBatchCloseoutService.FAILED_FUND_TERMINAL_STATUSES.has(
        status,
      )
    );
  }

  private isFailedFundTerminalStatus(status: string) {
    return PoolSettlementBatchCloseoutService.FAILED_FUND_TERMINAL_STATUSES.has(
      status,
    );
  }

  private isTerminalItemStatus(status: string) {
    return PoolSettlementBatchCloseoutService.TERMINAL_ITEM_STATUSES.has(status);
  }

  private isTerminalBatchStatus(status: string) {
    return PoolSettlementBatchCloseoutService.TERMINAL_BATCH_STATUSES.has(
      status as PoolSettlementBatchStatus,
    );
  }

  private normalizeSourceFamily(sourceFamily?: string | null) {
    return String(sourceFamily || '')
      .trim()
      .toUpperCase();
  }

  private collectSourceIds(
    rows: PoolSettlementBatchItemSourceRow[],
    sourceFamily: string,
  ) {
    return rows
      .filter(
        (row) => this.normalizeSourceFamily(row.sourceFamily) === sourceFamily,
      )
      .map((row) => row.sourceId);
  }

  private deriveBatchTerminalStatus(itemStatuses: string[]) {
    if (!itemStatuses.length) {
      return null;
    }

    if (itemStatuses.some((status) => !this.isTerminalItemStatus(status))) {
      return null;
    }

    const successCount = itemStatuses.filter((status) => status === 'SUCCESS').length;
    const failedCount = itemStatuses.filter((status) => status === 'FAILED').length;

    if (successCount === itemStatuses.length) {
      return PoolSettlementBatchStatus.SUCCESS;
    }

    if (failedCount === itemStatuses.length) {
      return PoolSettlementBatchStatus.FAILED;
    }

    if (successCount > 0 && failedCount > 0) {
      return PoolSettlementBatchStatus.PARTIAL_FAILED;
    }

    return null;
  }

  private async settleSuccessfulSources(
    client: TxClient,
    item: PoolSettlementBatchItemSnapshot,
    internalTransactionId: string,
    internalFundId: string,
  ) {
    const sourceRows = await (client as any).poolSettlementBatchItemSource.findMany({
      where: {
        batchItemId: item.id,
        status: 'LINKED',
      },
      select: {
        id: true,
        sourceFamily: true,
        sourceId: true,
      },
    });

    if (!sourceRows.length) {
      return;
    }

    const now = new Date();
    const outstandingIds = this.collectSourceIds(sourceRows, 'OUTSTANDING');
    const reimbursementIds = this.collectSourceIds(
      sourceRows,
      'REIMBURSEMENT_OBLIGATION',
    );

    await (client as any).poolSettlementBatchItemSource.updateMany({
      where: {
        id: {
          in: sourceRows.map((row: PoolSettlementBatchItemSourceRow) => row.id),
        },
        status: 'LINKED',
      },
      data: {
        status: 'SETTLED',
        closeReason: 'EXECUTED',
      },
    });

    if (outstandingIds.length) {
      await (client as any).outstanding.updateMany({
        where: {
          id: {
            in: outstandingIds,
          },
          status: 'OPEN',
          lockedByPoolSettlementBatchId: item.batchId,
        },
        data: {
          status: 'CLOSED',
          lockedByPoolSettlementBatchId: null,
          lockedAt: null,
          closedAt: now,
          closedByInternalFundId: internalFundId,
        },
      });
    }

    if (reimbursementIds.length) {
      await (client as any).reimbursementObligation.updateMany({
        where: {
          id: {
            in: reimbursementIds,
          },
          status: 'OPEN',
          lockedByPoolSettlementBatchId: item.batchId,
        },
        data: {
          status: 'REIMBURSED',
          lockedByPoolSettlementBatchId: null,
          settlementInternalTransactionId: internalTransactionId,
          reimbursedAt: now,
        },
      });
    }
  }

  private async releaseFailedSources(
    client: TxClient,
    batchId: string,
    failedItemIds: string[],
  ) {
    if (!failedItemIds.length) {
      return;
    }

    const sourceRows = await (client as any).poolSettlementBatchItemSource.findMany({
      where: {
        batchId,
        batchItemId: {
          in: failedItemIds,
        },
        status: 'LINKED',
      },
      select: {
        id: true,
        batchItemId: true,
        sourceFamily: true,
        sourceId: true,
      },
    });

    if (!sourceRows.length) {
      return;
    }

    const outstandingIds = this.collectSourceIds(sourceRows, 'OUTSTANDING');
    const reimbursementIds = this.collectSourceIds(
      sourceRows,
      'REIMBURSEMENT_OBLIGATION',
    );

    await (client as any).poolSettlementBatchItemSource.updateMany({
      where: {
        id: {
          in: sourceRows.map((row: PoolSettlementBatchItemSourceRow) => row.id),
        },
        status: 'LINKED',
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });

    if (outstandingIds.length) {
      await (client as any).outstanding.updateMany({
        where: {
          id: {
            in: outstandingIds,
          },
          lockedByPoolSettlementBatchId: batchId,
        },
        data: {
          status: 'OPEN',
          lockedByPoolSettlementBatchId: null,
          lockedAt: null,
          closedAt: null,
          closedByInternalFundId: null,
        },
      });
    }

    if (reimbursementIds.length) {
      await (client as any).reimbursementObligation.updateMany({
        where: {
          id: {
            in: reimbursementIds,
          },
          lockedByPoolSettlementBatchId: batchId,
        },
        data: {
          status: 'OPEN',
          lockedByPoolSettlementBatchId: null,
          settlementInternalTransactionId: null,
          reimbursedAt: null,
        },
      });
    }
  }

  private async recomputeBatchTerminalState(client: TxClient, batchId: string) {
    const batch = await (client as any).poolSettlementBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        status: true,
      },
    });
    if (!batch) {
      return;
    }
    if (this.isTerminalBatchStatus(String(batch.status || ''))) {
      return;
    }

    const items = await (client as any).poolSettlementBatchItem.findMany({
      where: { batchId },
      select: {
        id: true,
        status: true,
      },
    });

    const batchStatus = this.deriveBatchTerminalStatus(
      items.map((item: { status: string }) => item.status),
    );

    if (!batchStatus) {
      return;
    }

    if (batchStatus !== PoolSettlementBatchStatus.SUCCESS) {
      await this.releaseFailedSources(
        client,
        batchId,
        items
          .filter((item: { status: string }) => item.status === 'FAILED')
          .map((item: { id: string }) => item.id),
      );
    }

    await (client as any).poolSettlementBatch.update({
      where: { id: batchId },
      data: {
        status: batchStatus,
        closedAt: new Date(),
      },
    });
  }

  @OnEvent('internal-fund.status.changed')
  async handleInternalFundStatusChanged(event: InternalFundStatusChangedEvent) {
    if (!event?.internalFundId || !event.internalTransactionId) return;
    if (!this.isFundTerminalStatus(String(event.newStatus || ''))) return;

    try {
      await (this.prisma as any).$transaction(async (client: TxClient) => {
        const internalTransaction = await (client as any).internalTransaction.findUnique({
          where: { id: event.internalTransactionId },
          select: {
            id: true,
            poolSettlementBatchItemId: true,
          },
        });
        if (!internalTransaction?.poolSettlementBatchItemId) {
          return;
        }

        const item = await (client as any).poolSettlementBatchItem.findUnique({
          where: { id: internalTransaction.poolSettlementBatchItemId },
          select: {
            id: true,
            batchId: true,
            status: true,
          },
        });
        if (!item || this.isTerminalItemStatus(String(item.status || ''))) {
          return;
        }

        const nextItemStatus =
          event.newStatus === InternalFundStatus.CLEAR ? 'SUCCESS' : 'FAILED';
        const transition = await (client as any).poolSettlementBatchItem.updateMany({
          where: {
            id: item.id,
            status: 'EXECUTING',
          },
          data: {
            status: nextItemStatus,
            failedReason:
              nextItemStatus === 'FAILED' && this.isFailedFundTerminalStatus(event.newStatus)
                ? event.newStatus
                : null,
          },
        });

        if (!transition?.count) {
          return;
        }

        if (nextItemStatus === 'SUCCESS') {
          await this.settleSuccessfulSources(
            client,
            item,
            internalTransaction.id,
            event.internalFundId,
          );
        }

        await this.recomputeBatchTerminalState(client, item.batchId);
      });
    } catch (error) {
      this.logger.error(
        `Failed to close out pool settlement batch for fund=${event.internalFundId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

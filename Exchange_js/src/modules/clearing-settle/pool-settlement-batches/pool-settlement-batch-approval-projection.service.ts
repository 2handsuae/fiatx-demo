import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { InternalFundsService } from '../../asset-treasury/internal-funds/internal-funds.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionSourceType,
  InternalTransactionStatus,
  InternalTransactionType,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../../asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { InternalTransactionsService } from '../../asset-treasury/internal-transactions/internal-transactions.service';
import {
  ApprovalActionTypes,
  ApprovalDecisionEvent,
  ApprovalEvents,
} from '../../governance/approvals/constants/approval.constants';
import { PoolSettlementBatchStatus } from './dto/pool-settlement-batch.dto';

type PoolSettlementBatchDispatchItem = {
  id: string;
  batchId: string;
  assetId: string;
  netAmount: Prisma.Decimal | string | number;
  netDirection: string;
  walletAId: string;
  walletBId: string;
  walletA: {
    id: string;
    walletRole?: string | null;
    address?: string | null;
    iban?: string | null;
  };
  walletB: {
    id: string;
    walletRole?: string | null;
    address?: string | null;
    iban?: string | null;
  };
  internalTransaction?: {
    id: string;
  } | null;
};

type PoolSettlementNettedSourceRow = {
  sourceFamily: string;
  sourceId: string;
};

type PoolSettlementApprovedBatchContext = {
  id: string;
  batchNo?: string | null;
};

type PoolSettlementLinkedSourceRow = {
  id: string;
  sourceFamily: string;
  sourceId: string;
};

@Injectable()
export class PoolSettlementBatchApprovalProjectionService {
  private readonly logger = new Logger(
    PoolSettlementBatchApprovalProjectionService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private isPoolSettlementBatchApproval(event: ApprovalDecisionEvent) {
    return (
      String(event.actionType || '').trim().toUpperCase() ===
      ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL
    );
  }

  private parseDecisionTime(value?: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private getInternalTransactionsService() {
    const service = this.moduleRef.get(InternalTransactionsService, {
      strict: false,
    });
    if (!service) {
      throw new InternalServerErrorException(
        'InternalTransactionsService is not available for pool settlement dispatch',
      );
    }
    return service;
  }

  private getInternalFundsService() {
    const service = this.moduleRef.get(InternalFundsService, {
      strict: false,
    });
    if (!service) {
      throw new InternalServerErrorException(
        'InternalFundsService is not available for pool settlement dispatch',
      );
    }
    return service;
  }

  private describeDispatchError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Pool settlement item dispatch failed';
    return String(message || 'Pool settlement item dispatch failed').slice(0, 500);
  }

  private normalizeSourceFamily(sourceFamily?: string | null) {
    return String(sourceFamily || '')
      .trim()
      .toUpperCase();
  }

  private collectSourceIds(
    rows: PoolSettlementNettedSourceRow[],
    sourceFamily: string,
  ) {
    return rows
      .filter(
        (row) => this.normalizeSourceFamily(row.sourceFamily) === sourceFamily,
      )
      .map((row) => row.sourceId);
  }

  private async settleNettedSources(tx: any, batchId: string, closedAt: Date) {
    const nettedSourceRows = await tx.poolSettlementBatchItemSource.findMany({
      where: {
        batchId,
        batchItemId: null,
        status: 'NETTED',
      },
      select: {
        sourceFamily: true,
        sourceId: true,
      },
    });

    if (!nettedSourceRows.length) {
      return;
    }

    const outstandingIds = this.collectSourceIds(nettedSourceRows, 'OUTSTANDING');
    const reimbursementIds = this.collectSourceIds(
      nettedSourceRows,
      'REIMBURSEMENT_OBLIGATION',
    );

    if (outstandingIds.length) {
      await tx.outstanding.updateMany({
        where: {
          id: {
            in: outstandingIds,
          },
          status: 'OPEN',
          lockedByPoolSettlementBatchId: batchId,
        },
        data: {
          status: 'CLOSED',
          lockedByPoolSettlementBatchId: null,
          lockedAt: null,
          closedAt,
          closedByInternalFundId: null,
        },
      });
    }

    if (reimbursementIds.length) {
      await tx.reimbursementObligation.updateMany({
        where: {
          id: {
            in: reimbursementIds,
          },
          status: 'OPEN',
          lockedByPoolSettlementBatchId: batchId,
        },
        data: {
          status: 'REIMBURSED',
          lockedByPoolSettlementBatchId: null,
          settlementInternalTransactionId: null,
          reimbursedAt: closedAt,
        },
      });
    }
  }

  private async releaseFailedSources(
    tx: any,
    batchId: string,
    failedItemIds: string[],
  ) {
    if (!failedItemIds.length) {
      return;
    }

    const sourceRows: PoolSettlementLinkedSourceRow[] =
      await tx.poolSettlementBatchItemSource.findMany({
        where: {
          batchId,
          batchItemId: {
            in: failedItemIds,
          },
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

    const outstandingIds = this.collectSourceIds(sourceRows, 'OUTSTANDING');
    const reimbursementIds = this.collectSourceIds(
      sourceRows,
      'REIMBURSEMENT_OBLIGATION',
    );

    await tx.poolSettlementBatchItemSource.updateMany({
      where: {
        id: {
          in: sourceRows.map((row) => row.id),
        },
        status: 'LINKED',
      },
      data: {
        status: 'RELEASED',
        closeReason: 'BATCH_RELEASED',
      },
    });

    if (outstandingIds.length) {
      await tx.outstanding.updateMany({
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
      await tx.reimbursementObligation.updateMany({
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

  private getNonZeroItemQuery(batchId: string) {
    return {
      where: {
        batchId,
        netAmount: {
          not: 0,
        },
      },
      include: {
        asset: {
          select: {
            id: true,
            type: true,
          },
        },
        walletA: {
          select: {
            id: true,
            walletRole: true,
            address: true,
            iban: true,
          },
        },
        walletB: {
          select: {
            id: true,
            walletRole: true,
            address: true,
            iban: true,
          },
        },
        internalTransaction: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    } as const;
  }

  private resolveWalletRole(wallet: { walletRole?: string | null }) {
    return String(wallet.walletRole || '')
      .trim()
      .toUpperCase();
  }

  private resolveItemDirection(item: PoolSettlementBatchDispatchItem) {
    if (item.netDirection !== 'A_TO_B' && item.netDirection !== 'B_TO_A') {
      throw new InternalServerErrorException(
        `Unsupported pool settlement netDirection: ${String(item.netDirection || '')}`,
      );
    }

    const fromWallet = item.netDirection === 'A_TO_B' ? item.walletA : item.walletB;
    const toWallet = item.netDirection === 'A_TO_B' ? item.walletB : item.walletA;
    const fromRole = this.resolveWalletRole(fromWallet);
    const toRole = this.resolveWalletRole(toWallet);

    let type: InternalTransactionType;
    if (fromRole === 'MASTER' && toRole === 'LIQ') {
      type = InternalTransactionType.MASTER_TO_LIQ;
    } else if (fromRole === 'LIQ' && toRole === 'MASTER') {
      type = InternalTransactionType.LIQ_TO_MASTER;
    } else if (fromRole === 'CUST_BANK' && toRole === 'LIQ_BANK') {
      type = InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK;
    } else if (fromRole === 'LIQ_BANK' && toRole === 'CUST_BANK') {
      type = InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK;
    } else {
      throw new InternalServerErrorException(
        `Unsupported pool settlement wallet route: ${fromRole} -> ${toRole}`,
      );
    }

    return {
      type,
      fromWallet,
      toWallet,
    };
  }

  private async findBatchForProjection(event: ApprovalDecisionEvent) {
    const batch = await (this.prisma as any).poolSettlementBatch.findUnique({
      where: { id: event.entityRef },
      select: {
        id: true,
        batchNo: true,
        approvalCaseId: true,
        status: true,
      },
    });

    if (!batch) {
      return null;
    }

    if (batch.approvalCaseId && batch.approvalCaseId !== event.approvalId) {
      return null;
    }

    if (batch.status !== PoolSettlementBatchStatus.APPROVAL_PENDING) {
      return null;
    }

    return batch;
  }

  private async releaseHeldSources(
    batchId: string,
    terminalStatus: PoolSettlementBatchStatus,
    approvalId?: string,
  ) {
    await (this.prisma as any).$transaction(async (tx: any) => {
      const transition = await tx.poolSettlementBatch.updateMany({
        where: {
          id: batchId,
          status: PoolSettlementBatchStatus.APPROVAL_PENDING,
          OR: approvalId
            ? [{ approvalCaseId: null }, { approvalCaseId: approvalId }]
            : [{ approvalCaseId: null }],
        },
        data: {
          status: terminalStatus,
        },
      });

      if (!transition?.count) {
        return;
      }

      await Promise.all([
        tx.outstanding.updateMany({
          where: {
            status: 'OPEN',
            lockedByPoolSettlementBatchId: batchId,
          },
          data: {
            lockedByPoolSettlementBatchId: null,
          },
        }),
        tx.reimbursementObligation.updateMany({
          where: {
            status: 'OPEN',
            lockedByPoolSettlementBatchId: batchId,
          },
          data: {
            lockedByPoolSettlementBatchId: null,
          },
        }),
        tx.poolSettlementBatchItemSource.updateMany({
          where: {
            batchId,
            status: {
              in: ['LINKED', 'NETTED'],
            },
          },
          data: {
            status: 'RELEASED',
            closeReason: 'BATCH_RELEASED',
          },
        }),
      ]);
    });
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const approvedAt = this.parseDecisionTime(event.decidedAt) || new Date();
    let approvedBatchLabel = event.entityRef;
    const approvalProjection = await (this.prisma as any).$transaction(
      async (tx: any) => {
      const approvalTransition = await tx.poolSettlementBatch.updateMany({
        where: {
          id: event.entityRef,
          status: PoolSettlementBatchStatus.APPROVAL_PENDING,
          OR: event.approvalId
            ? [{ approvalCaseId: null }, { approvalCaseId: event.approvalId }]
            : [{ approvalCaseId: null }],
        },
        data: {
          status: PoolSettlementBatchStatus.APPROVED,
          approvedAt,
        },
      });

      if (!approvalTransition?.count) {
        return {
          transitioned: false,
          batch: null,
          items: [] as PoolSettlementBatchDispatchItem[],
        };
      }

      const batch = await tx.poolSettlementBatch.findUnique({
        where: { id: event.entityRef },
        select: {
          id: true,
          batchNo: true,
          approvalCaseId: true,
          status: true,
        },
      });
      if (!batch) {
        return {
          transitioned: false,
          batch: null,
          items: [] as PoolSettlementBatchDispatchItem[],
        };
      }
      approvedBatchLabel = batch.batchNo || batch.id;

      const items = await tx.poolSettlementBatchItem.findMany(
        this.getNonZeroItemQuery(batch.id),
      );
      await this.settleNettedSources(tx, batch.id, approvedAt);

      if (!items.length) {
        await tx.poolSettlementBatch.update({
          where: { id: batch.id },
          data: {
            status: PoolSettlementBatchStatus.SUCCESS,
            closedAt: new Date(),
          },
        });
        return {
          transitioned: true,
          batch: {
            id: batch.id,
            batchNo: batch.batchNo,
          } satisfies PoolSettlementApprovedBatchContext,
          items: [] as PoolSettlementBatchDispatchItem[],
        };
      }
      return {
        transitioned: true,
        batch: {
          id: batch.id,
          batchNo: batch.batchNo,
        } satisfies PoolSettlementApprovedBatchContext,
        items: items as PoolSettlementBatchDispatchItem[],
      };
    });

    if (!approvalProjection?.transitioned) {
      return;
    }

    const batchContext = approvalProjection.batch;
    const items = approvalProjection.items;

    if (batchContext && items.length) {
      const internalTransactionsService = this.getInternalTransactionsService();
      const internalFundsService = this.getInternalFundsService();
      let executingCount = 0;
      const failedItemIds: string[] = [];

      for (const item of items as PoolSettlementBatchDispatchItem[]) {
        if (item.internalTransaction?.id) {
          executingCount += 1;
          continue;
        }

        try {
          const execution = this.resolveItemDirection(item);
          const dispatched = await (this.prisma as any).$transaction(
            async (tx: any) => {
              const currentItem = await tx.poolSettlementBatchItem.findUnique({
                where: { id: item.id },
                select: {
                  id: true,
                  status: true,
                },
              });

              if (!currentItem || currentItem.status !== 'READY') {
                return false;
              }

              const internalTx =
                await internalTransactionsService.createStandaloneTransaction(
                  {
                    type: execution.type,
                    purpose: TreasuryTransferPurpose.POOL_REBALANCING,
                    initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
                    status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
                    approvalStatus: InternalTransactionApprovalStatus.APPROVED,
                    sourceType:
                      InternalTransactionSourceType.POOL_SETTLEMENT_BATCH_ITEM,
                    sourceId: item.id,
                    sourceNo: batchContext.batchNo ?? batchContext.id,
                    ownerType: 'PLATFORM',
                    ownerId: 'PLATFORM',
                    ownerNo: 'PLATFORM',
                    assetId: item.assetId,
                    amount: item.netAmount as any,
                    feeAmount: new Prisma.Decimal(0),
                    netAmount: item.netAmount as any,
                    fromWalletId: execution.fromWallet.id,
                    fromAddress: execution.fromWallet.address ?? null,
                    fromIban: execution.fromWallet.iban ?? null,
                    toWalletId: execution.toWallet.id,
                    toAddress: execution.toWallet.address ?? null,
                    toIban: execution.toWallet.iban ?? null,
                    referenceNo: batchContext.batchNo ?? batchContext.id,
                  },
                  'SYSTEM',
                  tx,
                );

              await tx.internalTransaction.update({
                where: { id: internalTx.id },
                data: {
                  poolSettlementBatchItemId: item.id,
                },
              });

              await internalFundsService.createFromInternalTransaction(
                {
                  internalTransactionId: internalTx.id,
                  status: InternalFundStatus.CREATED,
                  referenceNo: batchContext.batchNo ?? batchContext.id,
                },
                'SYSTEM',
                tx,
              );

              await tx.poolSettlementBatchItem.update({
                where: { id: item.id },
                data: {
                  status: 'EXECUTING',
                  failedReason: null,
                },
              });

              return true;
            },
          );

          if (dispatched) {
            executingCount += 1;
          }
        } catch (error) {
          const failedReason = this.describeDispatchError(error);
          this.logger.error(
            `Failed to dispatch pool settlement batch item ${item.id} for batch ${batchContext.id}: ${failedReason}`,
            error instanceof Error ? error.stack : undefined,
          );

          const transition = await (this.prisma as any).poolSettlementBatchItem.updateMany({
            where: {
              id: item.id,
              status: 'READY',
            },
            data: {
              status: 'FAILED',
              failedReason,
            },
          });

          if (transition?.count) {
            failedItemIds.push(item.id);
          }
        }
      }

      if (executingCount > 0) {
        await (this.prisma as any).poolSettlementBatch.update({
          where: { id: batchContext.id },
          data: {
            status: PoolSettlementBatchStatus.EXECUTING,
          },
        });
      } else if (failedItemIds.length) {
        await (this.prisma as any).$transaction(async (tx: any) => {
          await this.releaseFailedSources(tx, batchContext.id, failedItemIds);
          await tx.poolSettlementBatch.update({
            where: { id: batchContext.id },
            data: {
              status: PoolSettlementBatchStatus.FAILED,
              closedAt: new Date(),
            },
          });
        });
      }
    }

    this.logger.log(`Pool settlement batch approved: ${approvedBatchLabel}`);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(
      batch.id,
      PoolSettlementBatchStatus.FAILED,
      event.approvalId,
    );
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(
      batch.id,
      PoolSettlementBatchStatus.CANCELLED,
      event.approvalId,
    );
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(
      batch.id,
      PoolSettlementBatchStatus.FAILED,
      event.approvalId,
    );
  }
}

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
  ) {
    await (this.prisma as any).$transaction(async (tx: any) => {
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

      await tx.poolSettlementBatch.update({
        where: { id: batchId },
        data: {
          status: terminalStatus,
        },
      });
    });
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    const approvedAt = this.parseDecisionTime(event.decidedAt) || new Date();

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.poolSettlementBatch.update({
        where: { id: batch.id },
        data: {
          status: PoolSettlementBatchStatus.APPROVED,
          approvedAt,
        },
      });

      const items = await tx.poolSettlementBatchItem.findMany(
        this.getNonZeroItemQuery(batch.id),
      );

      if (!items.length) {
        await tx.poolSettlementBatch.update({
          where: { id: batch.id },
          data: {
            status: PoolSettlementBatchStatus.SUCCESS,
            closedAt: new Date(),
          },
        });
        return;
      }

      const internalTransactionsService = this.getInternalTransactionsService();
      const internalFundsService = this.getInternalFundsService();

      for (const item of items as PoolSettlementBatchDispatchItem[]) {
        if (item.internalTransaction?.id) {
          continue;
        }

        const execution = this.resolveItemDirection(item);
        const internalTx =
          await internalTransactionsService.createStandaloneTransaction(
            {
              type: execution.type,
              purpose: TreasuryTransferPurpose.POOL_REBALANCING,
              initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
              status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
              approvalStatus: InternalTransactionApprovalStatus.APPROVED,
              sourceType: InternalTransactionSourceType.POOL_SETTLEMENT_BATCH_ITEM,
              sourceId: item.id,
              sourceNo: batch.batchNo,
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
              referenceNo: batch.batchNo,
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
            referenceNo: batch.batchNo,
          },
          'SYSTEM',
          tx,
        );

        await tx.poolSettlementBatchItem.update({
          where: { id: item.id },
          data: {
            status: 'PROCESSING',
          },
        });
      }
    });

    this.logger.log(`Pool settlement batch approved: ${batch.batchNo || batch.id}`);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.FAILED);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.CANCELLED);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (!this.isPoolSettlementBatchApproval(event)) return;

    const batch = await this.findBatchForProjection(event);
    if (!batch) return;

    await this.releaseHeldSources(batch.id, PoolSettlementBatchStatus.FAILED);
  }
}

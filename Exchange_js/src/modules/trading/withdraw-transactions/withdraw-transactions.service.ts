import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { 
  WithdrawTransactionQueryDto, 
  WithdrawTransactionStatus, 
  WithdrawTransactionAction,
  UpdateWithdrawTransactionStatusDto,
  CreateWithdrawTransactionDto 
} from './dto/withdraw-transaction.dto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WithdrawEvents } from './constants/withdraw-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { JournalsService } from '../../accounting/journals/journals.service';
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';
import {
  KytScreeningStage,
  TxSourceType,
} from '../../risk-engine/transaction-compliance/types/tx-compliance.types';

@Injectable()
export class WithdrawTransactionsService {
  private readonly logger = new Logger(WithdrawTransactionsService.name);

  private readonly txEventDisabledHint =
    'Transactional status update completed without emitting domain events';

  // Helper to generate withdraw number
  private generateWithdrawNo(): string {
    return generateReferenceNo('WD');
  }

  // Define state machine transitions
  private readonly transitions: Record<WithdrawTransactionStatus, Partial<Record<WithdrawTransactionAction, WithdrawTransactionStatus>>> = {
    [WithdrawTransactionStatus.CREATED]: {
      [WithdrawTransactionAction.CHECK]: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.PENDING_COMPLIANCE]: {
      [WithdrawTransactionAction.FLAG]: WithdrawTransactionStatus.UNDER_REVIEW,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.UNDER_REVIEW]: {
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.APPROVED]: {
      // Legacy transition, adding for compatibility if needed, though approve now goes to PAYOUT_PENDING
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
    },
    [WithdrawTransactionStatus.PAYOUT_PENDING]: {
      [WithdrawTransactionAction.SUCCESS]: WithdrawTransactionStatus.SUCCESS,
      [WithdrawTransactionAction.FAIL]: WithdrawTransactionStatus.FAILED,
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING, // Allow re-approval for logging
    },
    [WithdrawTransactionStatus.SUCCESS]: {
      [WithdrawTransactionAction.RETURN]: WithdrawTransactionStatus.RETURNED,
      [WithdrawTransactionAction.SUCCESS]: WithdrawTransactionStatus.SUCCESS, // For logging
    },
    [WithdrawTransactionStatus.FAILED]: {
      [WithdrawTransactionAction.FAIL]: WithdrawTransactionStatus.FAILED, // For logging
    },
    [WithdrawTransactionStatus.REJECTED]: {},
    [WithdrawTransactionStatus.CANCELLED]: {},
    [WithdrawTransactionStatus.RETURNED]: {},
    [WithdrawTransactionStatus.HELD]: {},
  };

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private journalsService: JournalsService,
    private transactionComplianceService: TransactionComplianceService,
  ) {}

  private createAccountingContext(withdrawal: {
    ownerId: string;
    ownerType: string;
    assetId: string;
    amount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    feeAmount: Prisma.Decimal;
    withdrawNo: string;
  }) {
    return {
      src: {
        ownerId: withdrawal.ownerId,
        ownerType: withdrawal.ownerType,
        assetId: withdrawal.assetId,
        amount: withdrawal.amount.toString(),
        netAmount: withdrawal.netAmount.toString(),
        feeAmount: withdrawal.feeAmount.toString(),
        withdrawNo: withdrawal.withdrawNo,
      },
    };
  }

  private assertComplianceGate(item: any, nextStatus: WithdrawTransactionStatus) {
    if (
      ![
        WithdrawTransactionStatus.PAYOUT_PENDING,
        WithdrawTransactionStatus.SUCCESS,
      ].includes(nextStatus)
    ) {
      return;
    }

    if (
      item.complianceStatus !== 'CLEAR' ||
      item.preKytStatus !== 'PASS' ||
      item.kytStatus !== 'PASS'
    ) {
      throw new BadRequestException({
        code: 'COMPLIANCE_NOT_CLEARED',
        message: `Withdrawal ${item.id} compliance not cleared for status ${nextStatus}`,
      });
    }

    if (
      item.travelRuleRequired === true &&
      item.travelRuleStatus !== 'ACCEPTED'
    ) {
      throw new BadRequestException({
        code: 'COMPLIANCE_NOT_CLEARED',
        message: `Withdrawal ${item.id} travel rule not accepted for status ${nextStatus}`,
      });
    }
  }

  async findAll(query: WithdrawTransactionQueryDto) {
    const {
      skip,
      take,
      withdrawNo,
      ownerId,
      ownerType,
      assetId,
      status,
      startDate,
      endDate,
    } = query;
    const where: any = {};

    if (withdrawNo) where.withdrawNo = { contains: withdrawNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (assetId) where.assetId = assetId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).withdrawTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          customer: true,
        },
      }),
      (this.prisma as any).withdrawTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        customer: true,
        payout: {
          include: {
            clearings: {
              include: {
                lines: true
              }
            }
          }
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const { kytCase, travelRuleCase } =
      await this.transactionComplianceService.getCaseSummaries(
        TxSourceType.WITHDRAW,
        id,
        KytScreeningStage.MAIN,
      );

    return {
      ...item,
      kytCase,
      travelRuleCase,
    };
  }

  async create(dto: CreateWithdrawTransactionDto, userId: string, ownerType: string = 'CUSTOMER') {
    const { assetId, amount, toWalletId, toAddress, toIban, parentType, parentId } = dto;

    // Verify asset
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const withdrawNo = this.generateWithdrawNo();
    
    // Fetch owner info if needed
    let ownerNo = null;
    if (ownerType === 'CUSTOMER') {
      const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: userId } });
      if (customer) ownerNo = customer.customerNo;
    }

    const amountDecimal = new Prisma.Decimal(amount);

    const created = await (this.prisma as any).$transaction(async (tx: any) => {
      const balances = await this.journalsService.getCustomerLiabilityBalance(
        {
          ownerId: userId,
          ownerType,
          assetId,
        },
        tx,
      );

      if (balances.availableBalance.lt(amountDecimal)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_AVAILABLE_BALANCE',
          message: `Insufficient available balance for asset ${assetId}`,
        });
      }

      const record = await tx.withdrawTransaction.create({
        data: {
          withdrawNo,
          ownerType,
          ownerId: userId,
          ownerNo,
          type: asset.type === 'FIAT' ? 'fiat' : 'crypto',
          status: WithdrawTransactionStatus.CREATED,
          assetId,
          amount: amountDecimal,
          netAmount: amountDecimal, // Initial netAmount = amount
          feeAmount: new Prisma.Decimal(0),
          toWalletId,
          toAddress,
          toIban,
          parentType,
          parentId,
          statusHistory: JSON.stringify([{
            status: WithdrawTransactionStatus.CREATED,
            timestamp: new Date().toISOString(),
            operator: 'SYSTEM',
            note: 'Withdrawal created'
          }]),
        },
      });

      // Create initial audit log
      await tx.withdrawAuditLog.create({
        data: {
          withdrawTransactionId: record.id,
          operatorId: userId,
          oldStatus: 'NONE',
          newStatus: WithdrawTransactionStatus.CREATED,
          reason: 'Customer initiated withdrawal',
        },
      });

      await this.journalsService.createJournal(
        {
          sourceType: 'WITHDRAW',
          sourceId: record.id,
          eventCode: WithdrawEvents.EVT_WITHDRAWAL_CREATED,
          context: this.createAccountingContext(record),
        },
        tx,
      );

      return record;
    });

    // Notification/observation only
    this.eventEmitter.emit(WithdrawEvents.EVT_WITHDRAWAL_CREATED, {
      withdrawId: created.id,
    });

    return created;
  }

  async updateStatus(
    id: string,
    dto: UpdateWithdrawTransactionStatusDto,
    tx?: Prisma.TransactionClient,
  ) {
    const { action, reason } = dto;

    const executeUpdate = async (client: Prisma.TransactionClient) => {
      const item = await (client as any).withdrawTransaction.findUnique({
        where: { id },
      });
      if (!item) {
        throw new NotFoundException('Withdraw transaction not found');
      }

      const currentStatus = item.status as WithdrawTransactionStatus;
      const nextStatus = this.transitions[currentStatus]?.[action];

      if (!nextStatus) {
        throw new BadRequestException(
          `Invalid action "${action}" for current status "${currentStatus}"`,
        );
      }

      this.assertComplianceGate(item, nextStatus);

      let history: any[] = [];
      try {
        if (item.statusHistory) {
          history = JSON.parse(item.statusHistory);
        }
      } catch {
        history = [];
      }

      history.push({
        status: nextStatus,
        timestamp: new Date().toISOString(),
        operator: 'SYSTEM',
        note: reason || `Status changed from ${currentStatus} to ${nextStatus}`,
      });

      const updated = await client.withdrawTransaction.update({
        where: { id },
        data: {
          status: nextStatus,
          approvedAt:
            (nextStatus === WithdrawTransactionStatus.APPROVED ||
              nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING) &&
            !item.approvedAt
              ? new Date()
              : item.approvedAt,
          payoutRequestedAt:
            nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING
              ? new Date()
              : item.payoutRequestedAt,
          completedAt: [
            WithdrawTransactionStatus.SUCCESS,
            WithdrawTransactionStatus.FAILED,
            WithdrawTransactionStatus.REJECTED,
            WithdrawTransactionStatus.CANCELLED,
            WithdrawTransactionStatus.RETURNED,
          ].includes(nextStatus)
            ? new Date()
            : item.completedAt,
          statusHistory: JSON.stringify(history),
        },
      });

      let eventSource = updated;

      if (
        currentStatus === WithdrawTransactionStatus.CREATED &&
        nextStatus === WithdrawTransactionStatus.PENDING_COMPLIANCE
      ) {
        await this.transactionComplianceService.ensureWithdrawComplianceCases(
          id,
          client,
        );
        const refreshed = await (client as any).withdrawTransaction.findUnique({
          where: { id },
        });
        if (!refreshed) {
          throw new NotFoundException('Withdraw transaction not found');
        }
        eventSource = refreshed;
      }

      await client.withdrawAuditLog.create({
        data: {
          withdrawTransactionId: id,
          operatorId: 'SYSTEM',
          oldStatus: currentStatus,
          newStatus: nextStatus,
          reason: reason || `Action: ${action}`,
        },
      });

      const postCommitEvents: Array<{ eventName: string; payload: any }> = [];

      if (nextStatus === WithdrawTransactionStatus.CANCELLED) {
        postCommitEvents.push({
          eventName: WithdrawEvents.EVT_WITHDRAWAL_CANCELLED,
          payload: { withdrawId: id },
        });
      } else if (nextStatus === WithdrawTransactionStatus.REJECTED) {
        postCommitEvents.push({
          eventName: WithdrawEvents.EVT_WITHDRAWAL_REJECTED,
          payload: { withdrawId: id },
        });
      } else if (
        nextStatus === WithdrawTransactionStatus.APPROVED ||
        nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING
      ) {
        if (
          currentStatus !== WithdrawTransactionStatus.APPROVED &&
          currentStatus !== WithdrawTransactionStatus.PAYOUT_PENDING
        ) {
          if (eventSource.type === 'crypto') {
            postCommitEvents.push({
              eventName: WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO,
              payload: { withdrawId: id },
            });
          } else if (eventSource.type === 'fiat') {
            postCommitEvents.push({
              eventName: WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT,
              payload: { withdrawId: id },
            });
          }
        }
      } else if (nextStatus === WithdrawTransactionStatus.SUCCESS) {
        const successEvent =
          eventSource.type === 'crypto'
            ? WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__CRYPTO
            : WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT;
        postCommitEvents.push({
          eventName: successEvent,
          payload: { withdrawId: id },
        });
      } else if (nextStatus === WithdrawTransactionStatus.FAILED) {
        const failedEvent =
          eventSource.type === 'crypto'
            ? WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO
            : WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT;
        postCommitEvents.push({
          eventName: failedEvent,
          payload: { withdrawId: id },
        });
      } else if (nextStatus === WithdrawTransactionStatus.RETURNED) {
        postCommitEvents.push({
          eventName: WithdrawEvents.EVT_WITHDRAWAL_RETURNED__FIAT,
          payload: { withdrawId: id },
        });
      }

      return { updated: eventSource, postCommitEvents };
    };

    if (tx) {
      const result = await executeUpdate(tx);
      this.logger.debug(this.txEventDisabledHint);
      return result.updated;
    }

    const result = await (this.prisma as any).$transaction(
      async (client: Prisma.TransactionClient) => executeUpdate(client),
    );
    for (const event of result.postCommitEvents) {
      this.eventEmitter.emit(event.eventName, event.payload);
    }
    return result.updated;
  }

  async createMockData() {
    const assets = await (this.prisma as any).asset.findMany();
    if (assets.length === 0) {
      throw new BadRequestException('No assets found. Please seed assets first.');
    }

    const records = [];
    for (let i = 0; i < 10; i++) {
      const asset = assets[Math.floor(Math.random() * assets.length)];
      const amount = (Math.random() * 1000 + 10).toFixed(2);
      
      const record = await (this.prisma as any).withdrawTransaction.create({
        data: {
          withdrawNo: `WDR-${Date.now()}-${i}`,
          ownerType: 'CUSTOMER',
          ownerId: `USER-${Math.floor(Math.random() * 1000)}`,
          type: asset.type === 'FIAT' ? 'fiat' : 'crypto',
          status: WithdrawTransactionStatus.CREATED,
          assetId: asset.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          toAddress: asset.type !== 'FIAT' ? '0x' + Math.random().toString(16).slice(2) : null,
          toIban: asset.type === 'FIAT' ? 'IBAN' + Math.random().toString().slice(2) : null,
          statusHistory: JSON.stringify([{
            from: 'NONE',
            to: WithdrawTransactionStatus.CREATED,
            action: 'CREATE',
            timestamp: new Date(),
          }]),
        },
      });
      records.push(record);

      // Initial audit log
      await (this.prisma as any).withdrawAuditLog.create({
        data: {
          withdrawTransactionId: record.id,
          operatorId: 'SYSTEM',
          oldStatus: 'NONE',
          newStatus: WithdrawTransactionStatus.CREATED,
          reason: 'Initial creation',
        },
      });
    }

    return records;
  }
}

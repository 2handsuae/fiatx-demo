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
  TxSourceType,
} from '../../risk-engine/transaction-compliance/types/tx-compliance.types';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { ComplianceAlertsService } from '../../risk-engine/compliance-alerts/compliance-alerts.service';
import { PricingCenterService } from '../pricing-center/pricing-center.service';

@Injectable()
export class WithdrawTransactionsService {
  private readonly logger = new Logger(WithdrawTransactionsService.name);
  private readonly auditLogsService: AuditLogsService;
  private readonly complianceAlertsService: ComplianceAlertsService;

  private readonly txEventDisabledHint =
    'Transactional status update completed without emitting domain events';

  private deriveWithdrawType(assetType?: string | null): 'crypto' | 'fiat' {
    return String(assetType || '').toUpperCase() === 'FIAT' ? 'fiat' : 'crypto';
  }

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
    private pricingCenterService: PricingCenterService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
    this.complianceAlertsService = new ComplianceAlertsService(prisma);
  }

  private createAccountingContext(withdrawal: {
    ownerId: string;
    ownerType: string;
    assetId: string;
    amount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    feeAmount: Prisma.Decimal;
    withdrawNo: string;
    fromWalletId?: string | null;
    fromWalletNo?: string | null;
    toWalletId?: string | null;
    toWalletNo?: string | null;
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
        fromWalletId: withdrawal.fromWalletId ?? null,
        fromWalletNo: withdrawal.fromWalletNo ?? null,
        toWalletId: withdrawal.toWalletId ?? null,
        toWalletNo: withdrawal.toWalletNo ?? null,
      },
    };
  }

  private async triggerComplianceGateBlockedAlert(
    item: any,
    reason: string,
    detail: Record<string, unknown>,
  ) {
    try {
      await this.complianceAlertsService.triggerSystemAlert({
        ruleCode: 'TX_COMPLIANCE_GATE_BLOCKED',
        sourceModule: AuditModules.WITHDRAW_TRANSACTIONS,
        sourceType: TxSourceType.WITHDRAW,
        sourceId: item.id,
        sourceNo: item.withdrawNo || null,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: item.id,
        entityNo: item.withdrawNo || null,
        ownerType: item.ownerType,
        ownerId: item.ownerId || null,
        ownerNo: item.ownerNo || null,
        customerId: item.ownerType === 'CUSTOMER' ? item.ownerId : null,
        customerNo: item.ownerType === 'CUSTOMER' ? item.ownerNo : null,
        title: 'Transaction Blocked by Compliance Gate',
        message: reason,
        metadata: detail,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write compliance gate alert for withdraw ${item.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async assertComplianceGate(item: any, nextStatus: WithdrawTransactionStatus) {
    if (
      ![
        WithdrawTransactionStatus.PAYOUT_PENDING,
        WithdrawTransactionStatus.SUCCESS,
      ].includes(nextStatus)
    ) {
      return;
    }

    const reasons: string[] = [];
    const assetType = String(item.asset?.type || '').toUpperCase();
    if (assetType === 'CRYPTO' && item.preKytStatus !== 'PASS') {
      reasons.push(`preKytStatus=${item.preKytStatus || 'UNKNOWN'} (expected PASS)`);
    }

    if (reasons.length > 0) {
      await this.triggerComplianceGateBlockedAlert(
        item,
        `Withdrawal ${item.id} compliance not cleared for status ${nextStatus}: ${reasons.join('; ')}`,
        {
          nextStatus,
          reasons,
          complianceStatus: item.complianceStatus || null,
          preKytStatus: item.preKytStatus || null,
          kytStatus: item.kytStatus || null,
          travelRuleRequired: item.travelRuleRequired ?? null,
          travelRuleStatus: item.travelRuleStatus || null,
        },
      );
      throw new BadRequestException({
        code: 'COMPLIANCE_NOT_CLEARED',
        message: `Withdrawal ${item.id} compliance not cleared for status ${nextStatus}: ${reasons.join('; ')}`,
        details: reasons,
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

    return {
      items: items.map((item: any) => ({
        ...item,
        type: this.deriveWithdrawType(item.asset?.type),
      })),
      total,
    };
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

    const caseAggregate =
      await this.transactionComplianceService.getTransactionCaseAggregate(
        TxSourceType.WITHDRAW,
        id,
        {
          includeReports: false,
          includePayload: false,
        },
      );

    return {
      ...item,
      type: this.deriveWithdrawType(item.asset?.type),
      preKytCase: caseAggregate.preKytCase,
      kytCase: caseAggregate.mainKytCase,
      travelRuleCase: caseAggregate.travelRuleCase,
      derivedComplianceStatus: caseAggregate.derivedComplianceStatus,
    };
  }

  async create(dto: CreateWithdrawTransactionDto, userId: string, ownerType: string = 'CUSTOMER') {
    const {
      assetId,
      amount,
      toWalletId,
      toAddress,
      toIban,
      parentType,
      parentId,
      quoteId,
    } = dto;

    // Verify asset
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const withdrawNo = this.generateWithdrawNo();
    
    // Fetch owner info if needed
    const ownerNo = await this.pricingCenterService.resolveOwnerNo(ownerType, userId);

    const amountDecimal = new Prisma.Decimal(amount);
    if (!quoteId) {
      throw new BadRequestException('quoteId is required for withdrawal');
    }

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

      let quoteFeeAmount = new Prisma.Decimal(0);
      let consumedQuoteId: string | null = null;
      const now = new Date();
      const activeQuote = await this.pricingCenterService.getActiveWithdrawQuoteOrThrow(
        quoteId,
        ownerType,
        userId,
        now,
        tx,
      );

      if (activeQuote.assetId !== assetId) {
        throw new BadRequestException('Withdrawal quote asset mismatch');
      }
      if (!new Prisma.Decimal(activeQuote.amount).eq(amountDecimal)) {
        throw new BadRequestException('Withdrawal quote amount mismatch');
      }

      const totals = activeQuote.totalsJson
        ? (JSON.parse(activeQuote.totalsJson) as Record<string, string>)
        : {};
      quoteFeeAmount = new Prisma.Decimal(totals[asset.code] || '0');
      consumedQuoteId = activeQuote.id;
      await this.pricingCenterService.consumeWithdrawQuoteForWithdraw(
        tx,
        quoteId,
        ownerType,
        userId,
        now,
      );

      const netAmount = amountDecimal.sub(quoteFeeAmount);
      if (netAmount.lt(0)) {
        throw new BadRequestException('Net amount must not be negative');
      }

      const record = await tx.withdrawTransaction.create({
        data: {
          withdrawNo,
          ownerType,
          ownerId: userId,
          ownerNo,
          status: WithdrawTransactionStatus.CREATED,
          assetId,
          amount: amountDecimal,
          netAmount,
          feeAmount: quoteFeeAmount,
          toWalletId,
          toAddress,
          toIban,
          parentType,
          parentId,
          pricingQuoteId: consumedQuoteId,
          statusHistory: JSON.stringify([{
            status: WithdrawTransactionStatus.CREATED,
            timestamp: new Date().toISOString(),
            operator: 'SYSTEM',
            note: 'Withdrawal created'
          }]),
        },
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.WITHDRAW_CREATED,
          module: AuditModules.WITHDRAW_TRANSACTIONS,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: record.id,
          entityNo: record.withdrawNo,
          entityOwnerType: record.ownerType,
          entityOwnerId: record.ownerId,
          reason: 'Customer initiated withdrawal',
          afterData: {
            status: record.status,
            amount: record.amount?.toString?.(),
            assetId: record.assetId,
            feeAmount: record.feeAmount?.toString?.(),
            pricingQuoteId: record.pricingQuoteId || null,
          },
          sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
        },
        {
          actorType: ownerType,
          actorId: userId,
          actorRole: ownerType,
        },
        tx,
      );

      await this.journalsService.createJournal(
        {
          sourceType: 'WITHDRAW',
          sourceId: record.id,
          eventCode: WithdrawEvents.EVT_WITHDRAWAL_CREATED,
          context: this.createAccountingContext(record),
        },
        tx,
      );

      await this.transactionComplianceService.ensureWithdrawPreKytCaseOnCreate(
        record.id,
        tx,
      );

      return record;
    });

    // Notification/observation only
    this.eventEmitter.emit(WithdrawEvents.EVT_WITHDRAWAL_CREATED, {
      withdrawId: created.id,
    });

    return {
      ...created,
      type: this.deriveWithdrawType(asset.type),
    };
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
        include: {
          asset: {
            select: {
              type: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Withdraw transaction not found');
      }

      const withdrawType = this.deriveWithdrawType(item.asset?.type);
      const currentStatus = item.status as WithdrawTransactionStatus;
      const nextStatus = this.transitions[currentStatus]?.[action];

      if (!nextStatus) {
        throw new BadRequestException(
          `Invalid action "${action}" for current status "${currentStatus}"`,
        );
      }

      await this.assertComplianceGate(item, nextStatus);

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

      const eventSource = updated;

      await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction('WITHDRAW', currentStatus, nextStatus),
          module: AuditModules.WITHDRAW_TRANSACTIONS,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.withdrawNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          statusFrom: currentStatus,
          statusTo: nextStatus,
          reason: reason || `Action: ${action}`,
          beforeData: { status: currentStatus },
          afterData: { status: nextStatus },
          sourcePlatform: 'SYSTEM',
        },
        client,
      );

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
          if (withdrawType === 'crypto') {
            postCommitEvents.push({
              eventName: WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO,
              payload: { withdrawId: id },
            });
          } else if (withdrawType === 'fiat') {
            postCommitEvents.push({
              eventName: WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT,
              payload: { withdrawId: id },
            });
          }
        }
      } else if (nextStatus === WithdrawTransactionStatus.SUCCESS) {
        const successEvent =
          withdrawType === 'crypto'
            ? WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__CRYPTO
            : WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT;
        postCommitEvents.push({
          eventName: successEvent,
          payload: { withdrawId: id },
        });
      } else if (nextStatus === WithdrawTransactionStatus.FAILED) {
        postCommitEvents.push({
          eventName: WithdrawEvents.EVT_WITHDRAWAL_FAILED,
          payload: { withdrawId: id },
        });
      } else if (nextStatus === WithdrawTransactionStatus.RETURNED) {
        postCommitEvents.push({
          eventName: WithdrawEvents.EVT_WITHDRAWAL_RETURNED__FIAT,
          payload: { withdrawId: id },
        });
      }

      return {
        updated: {
          ...eventSource,
          type: withdrawType,
        },
        postCommitEvents,
      };
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

    const customers = await (this.prisma as any).customerMain.findMany({
      take: 20,
      select: {
        id: true,
        customerNo: true,
      },
    });
    if (customers.length === 0) {
      throw new BadRequestException('No customers found. Please seed customers first.');
    }

    const records = [];
    for (let i = 0; i < 10; i++) {
      const asset = assets[Math.floor(Math.random() * assets.length)];
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const amount = (Math.random() * 1000 + 10).toFixed(2);
      
      const created = await (this.prisma as any).withdrawTransaction.create({
        data: {
          withdrawNo: `WDR-${Date.now()}-${i}`,
          ownerType: 'CUSTOMER',
          ownerId: customer.id,
          ownerNo: customer.customerNo,
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
      records.push({
        ...created,
        type: this.deriveWithdrawType(asset.type),
      });

      await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.WITHDRAW_CREATED,
        module: AuditModules.WITHDRAW_TRANSACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: created.id,
        entityNo: created.withdrawNo,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        reason: 'Initial creation',
        afterData: { status: created.status },
        sourcePlatform: 'SYSTEM',
      });
    }

    return records;
  }
}

import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
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
import { TransactionComplianceService } from '../../risk-engine/transaction-compliance/transaction-compliance.service';
import {
  TxSourceType,
} from '../../risk-engine/transaction-compliance/types/tx-compliance.types';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { PricingCenterService } from '../pricing-center/pricing-center.service';
import { randomUUID } from 'node:crypto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { DomainEventNames } from '../../../common/events/domain-events.constants';

export type WithdrawStatusUpdateSource = 'ADMIN_API' | 'WORKFLOW' | 'SYSTEM';

export interface WithdrawStatusUpdateContext {
  source: WithdrawStatusUpdateSource;
  actorType?: string;
  actorId?: string;
  actorRole?: string;
  sourcePlatform?: string;
}

@Injectable()
export class WithdrawTransactionsService {
  private readonly logger = new Logger(WithdrawTransactionsService.name);
  private readonly systemStatusUpdateContext: WithdrawStatusUpdateContext = {
    source: 'SYSTEM',
    actorType: 'SYSTEM',
    actorId: 'SYSTEM',
    actorRole: 'SYSTEM',
    sourcePlatform: 'SYSTEM',
  };

  private deriveWithdrawType(assetType?: string | null): 'crypto' | 'fiat' {
    return String(assetType || '').toUpperCase() === 'FIAT' ? 'fiat' : 'crypto';
  }

  // Helper to generate withdraw number
  private generateWithdrawNo(): string {
    return generateReferenceNo('WD');
  }

  // Define state machine transitions
  private readonly transitions: Record<WithdrawTransactionStatus, Partial<Record<WithdrawTransactionAction, WithdrawTransactionStatus>>> = {
    // Legacy compatibility branch: retained for historical replay/query readability only.
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
      // Legacy compatibility transition. New withdraw flows should not settle here.
      [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
    },
    [WithdrawTransactionStatus.PAYOUT_PENDING]: {
      [WithdrawTransactionAction.FLAG]: WithdrawTransactionStatus.UNDER_REVIEW,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
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
    // Legacy compatibility state only.
    [WithdrawTransactionStatus.HELD]: {},
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => TransactionComplianceService))
    private readonly transactionComplianceService: TransactionComplianceService,
    private readonly pricingCenterService: PricingCenterService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
  ) {}

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
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
    this.logger.debug(
      `Skip legacy tx compliance alert for withdraw ${item.id}: onboarding-only alert runtime active. reason=${reason} detail=${JSON.stringify(detail)}`,
    );
  }

  private async assertComplianceGate(item: any, nextStatus: WithdrawTransactionStatus) {
    void item;
    void nextStatus;
    return;
  }

  private normalizeStatusUpdateContext(
    context?: WithdrawStatusUpdateContext,
  ): Required<WithdrawStatusUpdateContext> {
    const normalized = context ?? this.systemStatusUpdateContext;
    const source = normalized.source || 'SYSTEM';
    if (source === 'ADMIN_API') {
      return {
        source,
        actorType: normalized.actorType || 'ADMIN',
        actorId: normalized.actorId || 'ADMIN_SYSTEM',
        actorRole: normalized.actorRole || 'ADMIN',
        sourcePlatform: normalized.sourcePlatform || 'ADMIN_API',
      };
    }
    return {
      source,
      actorType: normalized.actorType || 'SYSTEM',
      actorId: normalized.actorId || 'SYSTEM',
      actorRole: normalized.actorRole || 'SYSTEM',
      sourcePlatform: normalized.sourcePlatform || 'SYSTEM',
    };
  }

  private deriveWithdrawComplianceSnapshotFromStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'UNDER_REVIEW' | 'REJECTED' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
      return 'UNDER_REVIEW';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECTED';
    }

    if (
      current === WithdrawTransactionStatus.PAYOUT_PENDING ||
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private deriveWithdrawComplianceStatusFromStatus(
    status?: string | null,
  ): 'PENDING' | 'CLEAR' | 'HOLD' | 'REJECT' {
    const current = String(status || '').trim().toUpperCase();

    if (current === WithdrawTransactionStatus.UNDER_REVIEW) {
      return 'HOLD';
    }

    if (current === WithdrawTransactionStatus.REJECTED) {
      return 'REJECT';
    }

    if (
      current === WithdrawTransactionStatus.PAYOUT_PENDING ||
      current === WithdrawTransactionStatus.SUCCESS ||
      current === WithdrawTransactionStatus.FAILED ||
      current === WithdrawTransactionStatus.RETURNED
    ) {
      return 'CLEAR';
    }

    return 'PENDING';
  }

  private mapCanonicalAuditLogs(events: any[]) {
    return events.map((event: any) => ({
      id: event.id,
      action: event.action || null,
      statusFrom: event.statusFrom || null,
      statusTo: event.statusTo || null,
      actorType: event.actorType || null,
      actorId: event.actorId || null,
      actorNo: event.actorNo || null,
      reason: event.reason || null,
      occurredAt: event.occurredAt || event.createdAt || null,
      result: event.result || null,
      oldStatus: event.statusFrom || null,
      newStatus: event.statusTo || null,
      operatorId: event.actorId || null,
      createdAt: event.occurredAt || event.createdAt || null,
    }));
  }

  private async getCanonicalWithdrawAuditLogs(
    withdrawId: string,
    withdrawNo?: string | null,
  ) {
    const workflowNo = withdrawNo || null;
    const events = await (this.prisma as any).auditLogEvent.findMany({
      where: {
        OR: [
          {
            entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            entityId: withdrawId,
          },
          workflowNo
            ? {
                workflowType: AuditWorkflowTypes.WITHDRAW,
                workflowNo,
              }
            : undefined,
          {
            workflowType: AuditWorkflowTypes.WITHDRAW,
          },
          {
            traceId: `${AuditWorkflowTypes.WITHDRAW}:${withdrawId}`,
          },
        ].filter(Boolean),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return this.mapCanonicalAuditLogs(events);
  }

  private assertStatusUpdateSourceAllowed(
    nextStatus: WithdrawTransactionStatus,
    context: Required<WithdrawStatusUpdateContext>,
  ) {
    if (
      context.source === 'ADMIN_API' &&
      nextStatus === WithdrawTransactionStatus.PAYOUT_PENDING
    ) {
      throw new BadRequestException({
        code: 'WITHDRAW_APPROVE_WORKFLOW_ONLY',
        message:
          'Withdraw progression to payout pending is driven by risk workflow callback, not direct admin approval.',
        details: {
          source: context.source,
          nextStatus,
        },
      });
    }

    if (
      context.source === 'ADMIN_API' &&
      [
        WithdrawTransactionStatus.SUCCESS,
        WithdrawTransactionStatus.FAILED,
        WithdrawTransactionStatus.RETURNED,
      ].includes(nextStatus)
    ) {
      throw new BadRequestException({
        code: 'WITHDRAW_TERMINAL_ACTION_SYSTEM_ONLY',
        message:
          'Direct withdraw terminal actions are reserved for workflow/system execution.',
        details: {
          source: context.source,
          nextStatus,
        },
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
        derivedComplianceStatus: this.deriveWithdrawComplianceStatusFromStatus(
          item.status,
        ),
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
    const auditLogs = await this.getCanonicalWithdrawAuditLogs(
      item.id,
      item.withdrawNo,
    );
    const normalizedPreKytStatus = caseAggregate.preKytCase?.status
      ? caseAggregate.preKytCase.status
      : this.transactionComplianceService.normalizeKytLifecycleStatus(
          item.preKytStatus,
          { allowEmpty: true },
        );
    const normalizedKytStatus = caseAggregate.mainKytCase?.status
      ? caseAggregate.mainKytCase.status
      : this.transactionComplianceService.normalizeKytLifecycleStatus(
          item.kytStatus,
          { allowEmpty: true },
        );
    const normalizedTravelRuleStatus = caseAggregate.travelRuleCase?.status
      ? caseAggregate.travelRuleCase.status
      : this.transactionComplianceService.normalizeTravelRuleLifecycleStatus(
          item.travelRuleStatus,
          item.travelRuleRequired,
          { allowEmpty: true },
        );

    return {
      ...item,
      type: this.deriveWithdrawType(item.asset?.type),
      preKytStatus: normalizedPreKytStatus,
      kytStatus: normalizedKytStatus,
      travelRuleStatus: normalizedTravelRuleStatus,
      preKytCase: caseAggregate.preKytCase,
      kytCase: caseAggregate.mainKytCase,
      travelRuleCase: caseAggregate.travelRuleCase,
      derivedComplianceStatus: caseAggregate.derivedComplianceStatus,
      auditLogs,
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

    // Enforce compliance hold / restriction checks for customer transactions
    if (ownerType === 'CUSTOMER') {
      const customer = await (this.prisma as any).customerMain.findUnique({
        where: { id: userId },
      });
      ensureCustomerCanTransact(customer);
    }

    const withdrawNo = this.generateWithdrawNo();
    
    // Fetch owner info if needed
    const ownerNo = await this.pricingCenterService.resolveOwnerNo(ownerType, userId);
    await this.pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked({
      ownerType,
      ownerId: userId,
      ownerNo,
      assetId,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: `WITHDRAW_CREATE_RESTRICTION:${userId}:${assetId}`,
      sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
      auditActor: {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : 'ADMIN',
        actorId: userId,
        actorRole: ownerType,
      },
      surface: 'WITHDRAW_CREATE',
      action: 'WITHDRAW_CREATE',
    });

    const amountDecimal = new Prisma.Decimal(amount);
    if (!quoteId) {
      throw new BadRequestException('quoteId is required for withdrawal');
    }

    const created = await (this.prisma as any).$transaction(
      async (tx: any) => {
        // V2 balance check removed — migrated to TigerBeetle
        // TODO: re-wire balance guard via TigerBeetle adapter

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
        quoteFeeAmount = new Prisma.Decimal(totals[asset.currency] || '0');
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

        const traceId = randomUUID();

        const isCryptoWithdraw = this.deriveWithdrawType(asset.type) === 'crypto';

        const record = await tx.withdrawTransaction.create({
          data: {
            withdrawNo,
            ownerType,
            ownerId: userId,
            ownerNo,
            status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
            assetId,
            amount: amountDecimal,
            netAmount,
            feeAmount: quoteFeeAmount,
            toWalletId,
            toAddress,
            toIban,
            preKytStatus: isCryptoWithdraw ? 'FINAL' : '',
            kytStatus: '',
            travelRuleRequired: isCryptoWithdraw,
            travelRuleStatus: isCryptoWithdraw ? 'FINAL' : '',
            complianceStatus: 'PENDING',
            traceId,
            parentType,
            parentId,
            pricingQuoteId: consumedQuoteId,
            statusHistory: JSON.stringify([{
              status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
              timestamp: new Date().toISOString(),
              operator: 'SYSTEM',
              note: 'Withdrawal created and moved to compliance pending'
            }]),
          },
        });

        // TB: create 2 pending transfers — lock customer balance
        const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
        if (ledger && ownerType === 'CUSTOMER') {
          const clientCreditId = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: userId,
          });
          const custodyId = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.CUSTODY,
            ledger,
            ownerType: 'SYSTEM',
          });

          const netBigint = this.decimalToBigint(netAmount, asset.decimals);
          const feeBigint = this.decimalToBigint(quoteFeeAmount, asset.decimals);

          const evidenceBase = {
            sourceType: 'WITHDRAWAL',
            sourceNo: withdrawNo,
            debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
            assetCurrency: asset.currency,
            traceId,
            actorType: ownerType,
            actorId: userId,
          };

          // Pending #1: net amount CLIENT_CREDIT → CUSTODY
          const { tbTransferId: pendingNetId } = await this.accountingService.executePendingTransfer({
            debitAccountId: clientCreditId,
            creditAccountId: custodyId,
            amount: netBigint,
            ledger,
            code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_PENDING,
            timeout: 0,
            evidence: {
              ...evidenceBase,
              eventCode: 'WITHDRAW_LOCK_NET',
              creditCode: String(TB_ACCOUNT_CODES.CUSTODY),
              memo: 'Withdrawal pending lock: net amount',
            },
            tx,
          });

          // Pending #2: fee amount CLIENT_CREDIT → FEE_RECEIVABLE
          let pendingFeeId: bigint | undefined;
          if (feeBigint > 0n) {
            const feeReceivableId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
              ledger,
              ownerType: 'SYSTEM',
            });

            const result = await this.accountingService.executePendingTransfer({
              debitAccountId: clientCreditId,
              creditAccountId: feeReceivableId,
              amount: feeBigint,
              ledger,
              code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_FEE_PENDING,
              timeout: 0,
              evidence: {
                ...evidenceBase,
                eventCode: 'WITHDRAW_LOCK_FEE',
                creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE),
                memo: 'Withdrawal pending lock: fee amount',
              },
              tx,
            });
            pendingFeeId = result.tbTransferId;
          }

          // Store pending transfer IDs on the record
          await tx.withdrawTransaction.update({
            where: { id: record.id },
            data: {
              tbPendingNetId: bigintToHex(pendingNetId),
              tbPendingFeeId: pendingFeeId ? bigintToHex(pendingFeeId) : null,
            },
          });
        }

        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.WITHDRAW_REQUESTED,
            entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            entityId: record.id,
            entityNo: record.withdrawNo,
            entityOwnerType: record.ownerType,
            entityOwnerId: record.ownerId,
            traceId,
            workflowType: AuditWorkflowTypes.WITHDRAW,
            reason: 'Customer initiated withdrawal',
            sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
          },
          {
            actorType: ownerType,
            actorId: userId,
            actorRole: ownerType,
          },
          tx,
        );

        // V2 accounting removed — migrated to TigerBeetle

        return record;
      },
      {
        maxWait: 5000,
        timeout: 20000,
      },
    );

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_CREATED, {
      withdrawId: created.id,
      withdrawNo: created.withdrawNo,
      status: created.status,
      ownerType: created.ownerType,
      ownerId: created.ownerId,
      assetId: created.assetId,
      amount: created.amount.toString(),
      traceId: created.traceId,
    });

    // V5: compliance gate logic moved to WithdrawWorkflowService
    // await this.transactionComplianceService.ensureWithdrawPreKytCaseOnCreate(created.id);
    // await this.transactionComplianceService.initializeWithdrawFinalDecisionRecord(created.id);

    return {
      ...created,
      type: this.deriveWithdrawType(asset.type),
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateWithdrawTransactionStatusDto,
    context?: WithdrawStatusUpdateContext,
    tx?: Prisma.TransactionClient,
  ) {
    const { action, reason } = dto;
    const statusContext = this.normalizeStatusUpdateContext(context);

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

      this.assertStatusUpdateSourceAllowed(nextStatus, statusContext);
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
        operator: statusContext.actorId,
        note: reason || `Status changed from ${currentStatus} to ${nextStatus}`,
      });

      const updated = await client.withdrawTransaction.update({
        where: { id },
        data: {
          status: nextStatus,
          complianceStatus:
            this.deriveWithdrawComplianceSnapshotFromStatus(nextStatus),
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

      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('WITHDRAW', currentStatus, nextStatus),
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: updated.id,
          entityNo: updated.withdrawNo,
          entityOwnerType: updated.ownerType,
          entityOwnerId: updated.ownerId,
          reason: reason || `Action: ${action}`,
          sourcePlatform: statusContext.sourcePlatform,
        },
        {
          actorType: statusContext.actorType,
          actorId: statusContext.actorId,
          actorRole: statusContext.actorRole,
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

    const emitEvents = (events: Array<{ eventName: string; payload: any }>) => {
      for (const event of events) {
        this.eventEmitter.emit(event.eventName, event.payload);
      }
    };

    if (tx) {
      const result = await executeUpdate(tx);
      emitEvents(result.postCommitEvents);
      return result.updated;
    }

    const result = await (this.prisma as any).$transaction(
      async (client: Prisma.TransactionClient) => executeUpdate(client),
    );
    emitEvents(result.postCommitEvents);
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

        action: AuditActions.WITHDRAW_CREATED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: created.id,
        entityNo: created.withdrawNo,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        reason: 'Initial creation',
        sourcePlatform: 'SYSTEM',
      });
    }

    return records;
  }

  async updateKytStatus(
    id: string,
    kytStatus: string,
    kytScreeningId: string | null,
    kytRiskScore: number | null,
    phase: number,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        kytStatus,
        kytScreeningId: kytScreeningId ?? item.kytScreeningId,
        kytRiskScore: kytRiskScore ?? item.kytRiskScore,
        kytCheckedAt: new Date(),
      },
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_KYT_UPDATED, {
      withdrawId: id,
      kytStatus,
      phase,
    });

    return updated;
  }

  async updateTravelRuleStatus(
    id: string,
    travelRuleStatus: string,
    travelRuleTransferId: string | null,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        travelRuleStatus,
        travelRuleTransferId: travelRuleTransferId ?? item.travelRuleTransferId,
        travelRuleCheckedAt: new Date(),
      },
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_TRAVELRULE_UPDATED, {
      withdrawId: id,
      travelRuleStatus,
    });

    return updated;
  }

  async getOwnerComplianceStatus(withdrawId: string): Promise<string> {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      include: { customer: { select: { complianceStatus: true } } },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item.customer?.complianceStatus || 'UNKNOWN';
  }
}

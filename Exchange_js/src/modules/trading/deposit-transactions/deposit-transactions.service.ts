import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionQueryDto,
  DepositTransactionStatus,
  UpdateDepositTransactionStatusDto,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
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

type DepositWriteClient = Prisma.TransactionClient | PrismaService;

export interface DepositStatusUpdateActorContext {
  actorType: string;
  actorId: string;
  actorNo?: string;
  actorRole?: string;
  sourcePlatform?: string;
}

export interface DepositStatusUpdateOptions {
  tx?: Prisma.TransactionClient;
  actor?: DepositStatusUpdateActorContext;
  traceId?: string;
  workflowType?: string;
  workflowId?: string;
  workflowNo?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  statusHistoryContext?: Record<string, unknown>;
  sourcePlatform?: string;
}

@Injectable()
export class DepositTransactionsService {
  private readonly logger = new Logger(DepositTransactionsService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private transactionComplianceService: TransactionComplianceService,
    ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private getDb(tx?: Prisma.TransactionClient): DepositWriteClient {
    return tx ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private deriveDepositType(assetType?: string | null): 'crypto' | 'fiat' {
    return String(assetType || '').toUpperCase() === 'CRYPTO' ? 'crypto' : 'fiat';
  }

  private deriveDepositComplianceStatusFromStatus(
    status?: string | null,
  ): 'PENDING' | 'HOLD' | 'CLEAR' | 'REJECT' {
    const normalized = String(status || '').toUpperCase();
    if (normalized === DepositTransactionStatus.SUCCESS) {
      return 'CLEAR';
    }
    if (
      normalized === DepositTransactionStatus.UNDER_REVIEW ||
      normalized === DepositTransactionStatus.FROZEN
    ) {
      return 'HOLD';
    }
    if (normalized === DepositTransactionStatus.REJECTED) {
      return 'REJECT';
    }
    return 'PENDING';
  }

  private async recordAuditEvent(
    input: Record<string, unknown>,
    options?: DepositStatusUpdateOptions,
  ) {
    if (options?.actor) {
      return this.auditLogsService.recordByActor(
        input as any,
        {
          actorType: options.actor.actorType,
          actorId: options.actor.actorId,
          actorNo: options.actor.actorNo,
          actorRole: options.actor.actorRole,
        },
        options.tx,
      );
    }

    return this.auditLogsService.recordSystem(input as any, options?.tx);
  }

  private async recordComplianceGateBlockedAudit(
    item: any,
    reason: string,
    detail: Record<string, unknown>,
    options?: DepositStatusUpdateOptions,
  ) {
    await this.recordAuditEvent(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.TX_DEPOSIT_RELEASE_BLOCKED,
        module: AuditModules.DEPOSIT_TRANSACTIONS,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: item.id,
        entityNo: item.depositNo,
        entityOwnerType: item.ownerType,
        entityOwnerId: item.ownerId,
        traceId: options?.traceId || `TRANSACTION:${item.id}`,
        workflowType: options?.workflowType || 'TRANSACTION',
        workflowId: options?.workflowId || item.id,
        workflowNo: options?.workflowNo || item.depositNo || item.id,
        reason,
        metadata: {
          depositId: item.id,
          customerId: item.ownerId,
          blockedReason: reason,
          ...detail,
          ...(options?.metadata || {}),
        },
        sourcePlatform: options?.sourcePlatform || options?.actor?.sourcePlatform || 'SYSTEM',
      },
      options,
    );
  }

  private async assertComplianceBeforeSuccess(
    item: any,
    nextStatus: DepositTransactionStatus,
    options?: DepositStatusUpdateOptions,
  ) {
    if (nextStatus !== DepositTransactionStatus.SUCCESS) return;

    const reasons: string[] = [];
    const customer = item.customer || {};
    if (String(customer.onboardingStatus || '').toUpperCase() !== 'APPROVED') {
      reasons.push(
        `onboardingStatus=${customer.onboardingStatus || 'UNKNOWN'} (expected APPROVED)`,
      );
    }
    if (String(customer.operatingStatus || '').toUpperCase() !== 'ACTIVE') {
      reasons.push(
        `operatingStatus=${customer.operatingStatus || 'UNKNOWN'} (expected ACTIVE)`,
      );
    }
    if (String(customer.restrictionStatus || '').toUpperCase() !== 'CLEAR') {
      reasons.push(
        `restrictionStatus=${customer.restrictionStatus || 'UNKNOWN'} (expected CLEAR)`,
      );
    }
    if (String(customer.complianceHoldStatus || '').toUpperCase() !== 'ACTIVE') {
      reasons.push(
        `complianceHoldStatus=${customer.complianceHoldStatus || 'UNKNOWN'} (expected ACTIVE)`,
      );
    }

    const bypassTransactionComplianceChecks =
      options?.metadata?.transactionWorkflowClearanceApproved === true;
    const assetType = String(item.asset?.type || '').toUpperCase();
    if (assetType === 'CRYPTO' && !bypassTransactionComplianceChecks) {
      if (
        this.transactionComplianceService.normalizeKytLifecycleStatus(
          item.kytStatus,
          { allowEmpty: true },
        ) !== 'FINAL'
      ) {
        reasons.push(
          `kytStatus=${item.kytStatus || 'UNKNOWN'} (expected FINAL-compatible lifecycle)`,
        );
      }

      if (
        item.travelRuleRequired === true &&
        this.transactionComplianceService.normalizeTravelRuleLifecycleStatus(
          item.travelRuleStatus,
          true,
          { allowEmpty: true },
        )
          !== 'FINAL'
      ) {
        reasons.push(
          `travelRuleStatus=${item.travelRuleStatus || 'UNKNOWN'} (expected FINAL-compatible lifecycle when travelRuleRequired=true)`,
        );
      }
    }

    if (reasons.length > 0) {
      const blockedReason = `Deposit ${item.id} release blocked: ${reasons.join('; ')}`;
      await this.recordComplianceGateBlockedAudit(
        item,
        blockedReason,
        {
          nextStatus,
          reasons,
          onboardingStatus: customer.onboardingStatus || null,
          operatingStatus: customer.operatingStatus || null,
          restrictionStatus: customer.restrictionStatus || null,
          complianceHoldStatus: customer.complianceHoldStatus || null,
          kytStatus: item.kytStatus || null,
          travelRuleRequired: item.travelRuleRequired ?? null,
          travelRuleStatus: item.travelRuleStatus || null,
        },
        options,
      );
      throw new BadRequestException({
        code: 'DEPOSIT_RELEASE_BLOCKED',
        message: blockedReason,
        details: reasons,
        blockedReason,
      });
    }
  }

  private async getDepositForStatusUpdate(
    id: string,
    tx?: Prisma.TransactionClient,
  ) {
    const item = await (this.getDb(tx) as any).depositTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true,
        fromWallet: true,
        payin: true,
        customer: {
          select: {
            customerNo: true,
            firstName: true,
            lastName: true,
            email: true,
            onboardingStatus: true,
            operatingStatus: true,
            restrictionStatus: true,
            complianceHoldStatus: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deposit transaction not found');

    return item;
  }

  async findAll(query: DepositTransactionQueryDto) {
    const {
      skip,
      take,
      depositNo,
      ownerId,
      ownerType,
      assetId,
      toWalletId,
      status,
      startDate,
      endDate,
    } = query;
    const where: any = {};

    if (depositNo) where.depositNo = { contains: depositNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerType) where.ownerType = ownerType;
    if (assetId) where.assetId = assetId;
    if (toWalletId) where.toWalletId = toWalletId;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).depositTransaction.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          wallet: true,
          customer: {
            select: {
              customerNo: true,
              firstName: true,
              lastName: true,
              email: true,
              onboardingStatus: true,
              operatingStatus: true,
              restrictionStatus: true,
              complianceHoldStatus: true,
            },
          },
        },
      }),
      (this.prisma as any).depositTransaction.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        ownerNo:
          item.ownerNo ||
          (item.ownerType === 'CUSTOMER' ? item.customer?.customerNo || null : null),
        type: this.deriveDepositType(item.asset?.type),
        derivedComplianceStatus: this.deriveDepositComplianceStatusFromStatus(
          item.status,
        ),
      })),
      total,
    };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true, // toWallet
        fromWallet: true,
        payin: true,
        customer: {
          select: {
            customerNo: true,
            firstName: true,
            lastName: true,
            email: true,
            onboardingStatus: true,
            operatingStatus: true,
            restrictionStatus: true,
            complianceHoldStatus: true,
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException('Deposit transaction not found');

    // Manual mapping for fields not directly on the model or needing extraction
    const deposit = item as any;
    const inboundSignal = deposit.payin?.providerTxnId
      ? await (this.prisma as any).inboundTransferSignal.findUnique({
          where: { id: deposit.payin.providerTxnId },
          select: {
            id: true,
            signalNo: true,
            simulationRiskLevel: true,
            simulationRiskReason: true,
          },
        })
      : null;
    
    // Map ownerNo
    let ownerNo = deposit.ownerNo;
    if (!ownerNo && deposit.ownerType === 'CUSTOMER' && deposit.customer) {
        ownerNo = deposit.customer.customerNo;
    }

    const caseAggregate =
      await this.transactionComplianceService.getTransactionCaseAggregate(
        TxSourceType.DEPOSIT,
        id,
        {
          includeReports: false,
          includePayload: false,
        },
      );
    const [finalAlert, finalCase] = await Promise.all([
      (this.prisma as any).complianceAlert.findFirst({
        where: {
          sourceType: 'DEPOSIT',
          sourceId: id,
          stage: 'REVIEW_DEPOSIT_FINAL',
        },
        orderBy: { lastOccurredAt: 'desc' },
        select: {
          id: true,
          alertNo: true,
          status: true,
        },
      }),
      (this.prisma as any).complianceIncident.findFirst({
        where: {
          sourceType: 'DEPOSIT',
          entityId: id,
          stage: 'REVIEW_DEPOSIT_FINAL',
        },
        orderBy: { lastActionAt: 'desc' },
        select: {
          id: true,
          incidentNo: true,
          status: true,
        },
      }),
    ]);

    const normalizedKytStatus = caseAggregate.mainKytCase?.status
      ? caseAggregate.mainKytCase.status
      : this.transactionComplianceService.normalizeKytLifecycleStatus(
          deposit.kytStatus,
          { allowEmpty: true },
        );
    const normalizedTravelRuleStatus = caseAggregate.travelRuleCase?.status
      ? caseAggregate.travelRuleCase.status
      : this.transactionComplianceService.normalizeTravelRuleLifecycleStatus(
          deposit.travelRuleStatus,
          deposit.travelRuleRequired,
          { allowEmpty: true },
        );

    return {
        ...item,
        ownerNo,
        type: this.deriveDepositType(deposit.asset?.type),
        kytStatus: normalizedKytStatus,
        travelRuleStatus: normalizedTravelRuleStatus,
        payinNo: deposit.payin?.payinNo,
        payinStatus: deposit.payin?.status || null,
        payinType: deposit.payin?.type || null,
        toWalletNo: deposit.wallet?.walletNo,
        fromWalletNo: deposit.fromWallet?.walletNo,
        kytCase: caseAggregate.mainKytCase,
        travelRuleCase: caseAggregate.travelRuleCase,
        derivedComplianceStatus: caseAggregate.derivedComplianceStatus,
        simulationProfile: inboundSignal
          ? {
              signalId: inboundSignal.id,
              signalNo: inboundSignal.signalNo,
              riskLevel: inboundSignal.simulationRiskLevel || 'LOW',
              riskReason: inboundSignal.simulationRiskReason || null,
            }
          : null,
        finalAlert,
        finalCase: finalCase
          ? {
              id: finalCase.id,
              caseNo: finalCase.incidentNo,
              status: finalCase.status,
            }
          : null,
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateDepositTransactionStatusDto,
    options?: DepositStatusUpdateOptions,
  ) {
    const transaction = await this.getDepositForStatusUpdate(id, options?.tx);
    const currentStatus = transaction.status as DepositTransactionStatus;
    const action = dto.action;

    const nextStatus = this.getNextStatus(currentStatus, action);
    await this.assertComplianceBeforeSuccess(transaction, nextStatus, options);

    // Record status history
    const historyEntry = {
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operatorId:
        options?.actor?.actorId ||
        this.normalizeOptionalString(options?.sourcePlatform) ||
        'SYSTEM',
      actorType: options?.actor?.actorType || 'SYSTEM',
      actorRole: options?.actor?.actorRole || null,
      reason: options?.reason || dto.reason || action,
      context: options?.statusHistoryContext || null,
    };

    let currentHistory = [];
    try {
      currentHistory = transaction.statusHistory
        ? JSON.parse(transaction.statusHistory)
        : [];
    } catch (e) {
      currentHistory = [];
    }
    currentHistory.push(historyEntry);

    const updateData: any = {
      status: nextStatus,
      statusHistory: JSON.stringify(currentHistory),
    };

    if (
      nextStatus === DepositTransactionStatus.SUCCESS ||
      nextStatus === DepositTransactionStatus.FROZEN
    ) {
      updateData.completedAt = new Date();
    }

    const updated = await (this.getDb(options?.tx) as any).depositTransaction.update({
      where: { id },
      data: updateData,
    });

    await this.recordAuditEvent(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: buildStateTransitionAction('DEPOSIT', currentStatus, nextStatus),
        module: AuditModules.DEPOSIT_TRANSACTIONS,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: updated.id,
        entityNo: updated.depositNo,
        entityOwnerType: updated.ownerType,
        entityOwnerId: updated.ownerId,
        traceId: options?.traceId || undefined,
        workflowType: options?.workflowType || 'DEPOSIT',
        workflowId: options?.workflowId || undefined,
        workflowNo: options?.workflowNo || undefined,
        statusFrom: currentStatus,
        statusTo: nextStatus,
        reason: options?.reason || dto.reason || `Action: ${action}`,
        beforeData: { status: currentStatus },
        afterData: { status: nextStatus },
        metadata: options?.metadata || undefined,
        sourcePlatform: options?.sourcePlatform || options?.actor?.sourcePlatform || 'SYSTEM',
      },
      options,
    );

    this.eventEmitter.emit(
      'deposit.status.changed',
      new DepositStatusChangedEvent(
        updated.id,
        currentStatus,
        nextStatus,
        updated.ownerType,
        updated.ownerId,
        updated.assetId,
        updated.amount.toString(),
        updated.payinId,
      ),
    );

    return updated;
  }

  private getNextStatus(
    current: DepositTransactionStatus,
    action: DepositTransactionAction,
  ): DepositTransactionStatus {
    // State Machine
    // [*] --> PAYIN_PENDING
    // PAYIN_PENDING --> COMPLIANCE_PENDING: payin_confirmed
    // PAYIN_PENDING --> FAILED: fail
    // COMPLIANCE_PENDING --> SUCCESS: success
    // COMPLIANCE_PENDING --> UNDER_REVIEW: flag
    // COMPLIANCE_PENDING --> REJECTED: reject
    // COMPLIANCE_PENDING --> FAILED: fail
    // UNDER_REVIEW --> SUCCESS: success
    // UNDER_REVIEW --> REJECTED: reject
    // UNDER_REVIEW --> FAILED: fail
    // FAILED --> [*] (Terminal)

    const transitions: Record<
      string,
      Partial<Record<DepositTransactionAction, DepositTransactionStatus>>
    > = {
      [DepositTransactionStatus.PAYIN_PENDING]: {
        [DepositTransactionAction.PAYIN_CONFIRMED]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.COMPLIANCE_PENDING]: {
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.FLAG]: DepositTransactionStatus.UNDER_REVIEW,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.UNDER_REVIEW]: {
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.FROZEN]: {
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.FLAG]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.PAYIN_CONFIRMED]: DepositTransactionStatus.FROZEN,
      },
      [DepositTransactionStatus.FAILED]: {
        // Responds to any action by staying in FAILED (Terminal)
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.FLAG]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.PAYIN_CONFIRMED]: DepositTransactionStatus.FAILED,
      },
    };

    const nextStatus = transitions[current]?.[action];

    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid action '${action}' for status '${current}'`,
      );
    }

    return nextStatus;
  }

  async createFromPayin(
    amount: string,
    assetId: string,
    toWalletId: string,
    txHash?: string,
    fromAddress?: string,
    payinId?: string,
  ) {
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: toWalletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const depositNo = generateReferenceNo('DEP');
    const created = await (this.prisma as any).depositTransaction.create({
      data: {
        depositNo,
        ownerType: wallet.ownerType,
        ownerId: wallet.ownerId || 'UNKNOWN',
        status: DepositTransactionStatus.PAYIN_PENDING,
        statusHistory: JSON.stringify([
          {
            status: DepositTransactionStatus.PAYIN_PENDING,
            timestamp: new Date().toISOString(),
            operatorId: 'SYSTEM',
            reason: 'Created from Payin',
          },
        ]),
        assetId,
        toWalletId,
        payinId,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
        txHash,
        fromAddress,
        toAddress: wallet.address,
        toIban: wallet.iban,
      },
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_CREATE,
      action: AuditActions.DEPOSIT_CREATED_FROM_PAYIN,
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: created.id,
      entityNo: created.depositNo,
      entityOwnerType: created.ownerType,
      entityOwnerId: created.ownerId,
      workflowType: 'DEPOSIT',
      reason: 'Deposit created from payin detection',
      afterData: {
        status: created.status,
        amount: created.amount?.toString?.(),
        assetId: created.assetId,
        payinId: created.payinId,
      },
      sourcePlatform: 'SYSTEM',
    });

    return created;
  }

  async createRandom(): Promise<any> {
    const results = [];
    for (let i = 0; i < 10; i++) {
      // 1. Get a random asset
      const assets = await (this.prisma as any).asset.findMany({
        where: { status: 'ACTIVE' },
      });
      if (assets.length === 0)
        throw new NotFoundException('No active asset found for demo');
      const asset = assets[Math.floor(Math.random() * assets.length)];

      // 2. Get a random wallet or create one
      let wallet = await (this.prisma as any).wallet.findFirst({
        where: { assetId: asset.id },
      });
      if (!wallet) {
        // Create a demo wallet
        wallet = await (this.prisma as any).wallet.create({
          data: {
            ownerType: 'CUSTOMER',
            ownerId: 'U_DEMO_' + Math.floor(Math.random() * 10000),
            type: asset.type === 'CRYPTO' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
            direction: 'INBOUND',
            assetId: asset.id,
            status: 'ACTIVE',
            address: asset.type === 'CRYPTO' ? 'T_DEMO_' + Date.now() + i : null,
            iban: asset.type === 'FIAT' ? 'US_DEMO_' + Date.now() + i : null,
          },
        });
      }

      // 3. Generate random amount
      const amount = (Math.random() * 1000 + 10).toFixed(2);

      // 4. Generate deposit no
      const depositNo = generateReferenceNo('DEP');

      // 5. Create
      const deposit = await (this.prisma as any).depositTransaction.create({
        data: {
          depositNo,
          ownerType: 'CUSTOMER',
          ownerId: wallet.ownerId || 'UNKNOWN',
          status: DepositTransactionStatus.PAYIN_PENDING,
          statusHistory: JSON.stringify([
            {
              status: DepositTransactionStatus.PAYIN_PENDING,
              timestamp: new Date().toISOString(),
              operatorId: 'SYSTEM',
              reason: 'Initial creation',
            },
          ]),
          assetId: asset.id,
          toWalletId: wallet.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          fromAddress: asset.type === 'CRYPTO' ? 'T_SENDER_' + Date.now() + i : null,
          fromIban: asset.type === 'FIAT' ? 'US_SENDER_' + Date.now() + i : null,
          txHash:
            asset.type === 'CRYPTO'
              ? '0x' +
                Date.now().toString(16) +
                Math.random().toString(16).substr(2)
              : null,
          referenceNo: asset.type === 'FIAT' ? 'REF_' + Date.now() + i : null,
          toAddress: wallet.address,
          toIban: wallet.iban,
        },
      });
      results.push(deposit);
    }
    return results;
  }
}

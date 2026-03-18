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

  private async triggerComplianceGateBlockedAlert(
    item: any,
    reason: string,
    detail: Record<string, unknown>,
  ) {
    this.logger.debug(
      `Skip legacy tx compliance alert for deposit ${item.id}: onboarding-only alert runtime active. reason=${reason} detail=${JSON.stringify(detail)}`,
    );
  }

  private async assertComplianceBeforeSuccess(item: any, nextStatus: DepositTransactionStatus) {
    if (nextStatus !== DepositTransactionStatus.SUCCESS) return;
    const assetType = String(item.asset?.type || '').toUpperCase();
    if (assetType !== 'CRYPTO') return;

    const reasons: string[] = [];
    if (item.kytStatus !== 'PASS') {
      reasons.push(`kytStatus=${item.kytStatus || 'UNKNOWN'} (expected PASS)`);
    }

    if (item.travelRuleRequired === true && item.travelRuleStatus !== 'ACCEPTED') {
      reasons.push(
        `travelRuleStatus=${item.travelRuleStatus || 'UNKNOWN'} (expected ACCEPTED when travelRuleRequired=true)`,
      );
    }

    if (reasons.length > 0) {
      await this.triggerComplianceGateBlockedAlert(
        item,
        `Deposit ${item.id} compliance not cleared: ${reasons.join('; ')}`,
        {
          nextStatus,
          reasons,
          kytStatus: item.kytStatus || null,
          travelRuleRequired: item.travelRuleRequired ?? null,
          travelRuleStatus: item.travelRuleStatus || null,
        },
      );
      throw new BadRequestException({
        code: 'COMPLIANCE_NOT_CLEARED',
        message: `Deposit ${item.id} compliance not cleared: ${reasons.join('; ')}`,
        details: reasons,
      });
    }
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
            },
          },
        },
      }),
      (this.prisma as any).depositTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true, // toWallet
        fromWallet: true,
        payin: true,
        customer: { select: { customerNo: true, firstName: true, lastName: true, email: true } },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException('Deposit transaction not found');

    // Manual mapping for fields not directly on the model or needing extraction
    const deposit = item as any;
    
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

    return {
        ...item,
        ownerNo,
        payinNo: deposit.payin?.payinNo,
        toWalletNo: deposit.wallet?.walletNo,
        fromWalletNo: deposit.fromWallet?.walletNo,
        kytCase: caseAggregate.mainKytCase,
        travelRuleCase: caseAggregate.travelRuleCase,
        derivedComplianceStatus: caseAggregate.derivedComplianceStatus,
    };
  }

  async updateStatus(id: string, dto: UpdateDepositTransactionStatusDto) {
    const transaction = await this.findOne(id);
    const currentStatus = transaction.status as DepositTransactionStatus;
    const action = dto.action;

    const nextStatus = this.getNextStatus(currentStatus, action);
    await this.assertComplianceBeforeSuccess(transaction, nextStatus);

    // Record status history
    const historyEntry = {
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operatorId: 'SYSTEM',
      reason: dto.reason || action,
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

    if (nextStatus === DepositTransactionStatus.SUCCESS) {
      updateData.completedAt = new Date();
    }

    const updated = await (this.prisma as any).depositTransaction.update({
      where: { id },
      data: updateData,
    });

    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.STATE_TRANSITION,
      action: buildStateTransitionAction('DEPOSIT', currentStatus, nextStatus),
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: updated.id,
      entityNo: updated.depositNo,
      entityOwnerType: updated.ownerType,
      entityOwnerId: updated.ownerId,
      workflowType: 'DEPOSIT',
      statusFrom: currentStatus,
      statusTo: nextStatus,
      reason: dto.reason || `Action: ${action}`,
      beforeData: { status: currentStatus },
      afterData: { status: nextStatus },
      sourcePlatform: 'SYSTEM',
    });

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
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.UNDER_REVIEW]: {
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.FAILED]: {
        // Responds to any action by staying in FAILED (Terminal)
        [DepositTransactionAction.SUCCESS]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.FLAG]: DepositTransactionStatus.FAILED,
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
            type: asset.type === 'CRYPTO' ? 'CRYPTO_ADDRESS' : 'BANK_ACCOUNT',
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

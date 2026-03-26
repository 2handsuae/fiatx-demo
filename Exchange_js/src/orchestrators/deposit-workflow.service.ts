import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PayinStatusChangedEvent, PayinCreatedEvent } from '../modules/asset-treasury/payins/events/payin.events';
import {
  PayinStatus,
  PayinAction,
  PayinType,
  PayinSimulationMode,
} from '../modules/asset-treasury/payins/dto/payin.dto';
import { DepositTransactionsService } from '../modules/trading/deposit-transactions/deposit-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
  DepositOwnerType,
} from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { PayinsService } from '../modules/asset-treasury/payins/payins.service';
import { DepositStatusChangedEvent } from '../modules/trading/deposit-transactions/events/deposit-transaction.events';
import { PrismaService } from '../core/prisma/prisma.service';
import { TransactionComplianceService } from '../modules/risk-engine/transaction-compliance/transaction-compliance.service';
import { AuditLogsService } from '../modules/risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../modules/risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditTriggerType,
} from '../modules/risk-engine/audit-logs/dto/audit-log.dto';

interface OrchestrationResult {
  updated_payin_status?: string;
  updated_deposit_status?: string;
  emitted_events: string[];
  created_or_reversed_journal_entry_ids: string[];
  audit_log_id?: string;
}

interface DepositAccountingOutcome {
  eventCode: string | null;
  journal: any | null;
  journalId: string | null;
  blockedReason: string | null;
}

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(DepositWorkflowService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly journalService: JournalsService,
    private readonly payinsService: PayinsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
    private readonly transactionComplianceService: TransactionComplianceService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  onModuleInit() {
    this.logger.log(
      'DepositWorkflowOrchestrator initialized and listening for events.',
    );
  }

  @OnEvent('payin.created')
  async handlePayinCreated(event: PayinCreatedEvent): Promise<OrchestrationResult | null> {
    const { payinId, status } = event;
    this.logger.log(`Orchestrating new PayIn ${payinId} with status ${status}`);

    if (status === PayinStatus.DETECTED) {
      const result = await this.orchestratePayinDetected(payinId);
      this.logger.log(`Initial orchestration complete for PayIn ${payinId}: ${JSON.stringify(result)}`);
      return result;
    }
    return null;
  }

  @OnEvent('payin.status.changed')
  async handlePayinStatusChanged(event: PayinStatusChangedEvent): Promise<OrchestrationResult | null> {
    const { payinId, newStatus } = event;
    this.logger.log(`Orchestrating PayIn ${payinId} transition to ${newStatus}`);

    let result: OrchestrationResult | null = null;
    switch (newStatus) {
      case PayinStatus.DETECTED:
        result = await this.orchestratePayinDetected(payinId);
        break;
      case PayinStatus.FAILED:
        result = await this.orchestratePayinFailed(payinId);
        break;
      case PayinStatus.CONFIRMED:
        result = await this.orchestratePayinConfirmed(
          payinId,
          event.simulationMode || null,
        );
        break;
    }
    if (result) {
      this.logger.log(`Orchestration complete for PayIn ${payinId}: ${JSON.stringify(result)}`);
    }
    return result;
  }

  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent): Promise<OrchestrationResult | null> {
    const { depositId, oldStatus, newStatus, payinId } = event;
    this.logger.log(`Orchestrating Deposit ${depositId} transition to ${newStatus}`);

    let result: OrchestrationResult | null = null;
    switch (newStatus) {
      case DepositTransactionStatus.SUCCESS:
        result = await this.orchestrateDepositSuccess(depositId, oldStatus);
        break;
      case DepositTransactionStatus.REJECTED:
        result = await this.orchestrateDepositRejected(depositId, payinId);
        break;
    }
    if (result) {
      this.logger.log(`Orchestration complete for Deposit ${depositId}: ${JSON.stringify(result)}`);
    }
    return result;
  }

  private async orchestratePayinDetected(payinId: string): Promise<OrchestrationResult> {
    const result: OrchestrationResult = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
    
    // Ensure deposit exists
    let deposit = await this.findDepositByPayinId(payinId);
    if (!deposit) {
      const payin = await this.payinsService.findOne(payinId);
      deposit = await this.depositService.createFromPayin(
        payin.amount.toString(),
        payin.assetId,
        payin.toWalletId,
        payin.txHash || undefined,
        payin.fromAddress || undefined,
        payin.id,
      );
      await this.payinsService.linkDeposit(payinId, deposit.id);
      result.updated_deposit_status = deposit.status;
    } else {
      // If deposit exists, ensure it is in PAYIN_PENDING status
      if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING && 
          deposit.status !== DepositTransactionStatus.SUCCESS && 
          deposit.status !== DepositTransactionStatus.FROZEN &&
          deposit.status !== DepositTransactionStatus.FAILED && 
          deposit.status !== DepositTransactionStatus.REJECTED) {
         this.logger.debug(`Deposit ${deposit.id} already in status ${deposit.status}. Skipping reset to PAYIN_PENDING.`);
      }
    }

    return result;
  }

  private async orchestratePayinFailed(payinId: string): Promise<OrchestrationResult> {
    const result: OrchestrationResult = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
    const deposit = await this.findDepositByPayinId(payinId);
    
    if (
      deposit &&
      deposit.status !== DepositTransactionStatus.FAILED &&
      deposit.status !== DepositTransactionStatus.FROZEN &&
      deposit.status !== DepositTransactionStatus.REJECTED
    ) {
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.FAIL,
        reason: 'PayIn failed',
      });
      result.updated_deposit_status = updated.status;
    }
    return result;
  }

  private async orchestratePayinConfirmed(
    payinId: string,
    simulationMode?: PayinSimulationMode | null,
  ): Promise<OrchestrationResult> {
    const result: OrchestrationResult = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
    
    const deposit = await this.findDepositByPayinId(payinId);
    if (!deposit) return result;

    // Idempotency check: If PayIn is already CLEARED, skip
    const payin = await this.payinsService.findOne(payinId);
    if (payin.status === PayinStatus.CLEARED) {
      this.logger.debug(`PayIn ${payinId} already CLEARED. Skipping confirmed orchestration.`);
      return result;
    }

    // 1. Set Deposit to COMPLIANCE_PENDING
    const fromStatus = deposit.status as DepositTransactionStatus;
    let accountingToStatus: DepositTransactionStatus | null = null;
    if (deposit.status === DepositTransactionStatus.PAYIN_PENDING) {
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });
      result.updated_deposit_status = updated.status;
      accountingToStatus = DepositTransactionStatus.COMPLIANCE_PENDING;
    } else if (deposit.status === DepositTransactionStatus.COMPLIANCE_PENDING) {
      result.updated_deposit_status = deposit.status;
      accountingToStatus = DepositTransactionStatus.COMPLIANCE_PENDING;
    } else {
      this.logger.debug(
        `Deposit ${deposit.id} status ${deposit.status} is not eligible for confirmed accounting.`,
      );
    }

    if (accountingToStatus === DepositTransactionStatus.COMPLIANCE_PENDING) {
      const syncResult =
        simulationMode === PayinSimulationMode.INTERACTIVE
          ? await this.transactionComplianceService.ensureInteractiveDepositMainCasesOnPayinConfirmed(
              deposit.id,
              payin.id,
            )
          : await this.transactionComplianceService.ensureDepositMainCasesOnPayinConfirmed(
              deposit.id,
              payin.id,
            );

      await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.DEPOSIT_COMPLIANCE_EVIDENCE_SYNCED,
        module: AuditModules.DEPOSIT_TRANSACTIONS,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        workflowType: 'DEPOSIT',
        reason: 'Deposit compliance evidence synchronized after payin confirmed',
        metadata: {
          payinId: payin.id,
          payinNo: payin.payinNo || null,
          snapshot: syncResult,
        },
        sourcePlatform: 'SYSTEM',
      });
    }

    // 2. Emit Event
    const suffix = this.getSuffix(payin);
    const eventCode = `EVT_DEPOSIT_CONFIRMED__${suffix}`;
    this.eventEmitter.emit(eventCode, { depositId: deposit.id, payinId });
    result.emitted_events.push(eventCode);

    // 3. Journal Entry
    if (accountingToStatus && deposit.ownerType === DepositOwnerType.CUSTOMER) {
      const outcome = await this.triggerDepositAccounting({
        deposit,
        assetType: suffix,
        fromStatus,
        toStatus: accountingToStatus,
      });
      if (outcome.blockedReason) {
        await this.recordDepositAccountingBlocked({
          deposit,
          payin,
          eventCode: outcome.eventCode,
          fromStatus,
          toStatus: accountingToStatus,
          assetType: suffix,
          blockedReason: outcome.blockedReason,
        });
        return result;
      }

      if (outcome.journalId) {
        result.created_or_reversed_journal_entry_ids.push(outcome.journalId);
      }
      await this.recordDepositAccountingPosted({
        deposit,
        payin,
        eventCode: outcome.eventCode,
        journalId: outcome.journalId,
        fromStatus,
        toStatus: accountingToStatus,
        assetType: suffix,
        reason: 'Deposit accounting posted after payin confirmed',
      });
    }

    // 4. Set PayIn to CLEARED (Only after Event and JE)
    const updatedPayin = await this.payinsService.updateStatus(payinId, PayinAction.CLEAR);
    result.updated_payin_status = updatedPayin.status;

    return result;
  }

  private async orchestrateDepositSuccess(
    depositId: string,
    oldStatus?: DepositTransactionStatus,
  ): Promise<OrchestrationResult> {
    const result: OrchestrationResult = { emitted_events: [], created_or_reversed_journal_entry_ids: [] };
    
    const deposit = await this.depositService.findOne(depositId);
    const payin = deposit.payinId ? await this.payinsService.findOne(deposit.payinId) : null;
    
    const suffix = payin ? this.getSuffix(payin) : 'FIAT'; // Fallback
    const eventCode = `EVT_DEPOSIT_SUCCESS__${suffix}`;

    // Emit Event
    this.eventEmitter.emit(eventCode, { depositId });
    result.emitted_events.push(eventCode);

    // Journal Entry
    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      const outcome = await this.triggerDepositAccounting({
        deposit,
        assetType: suffix,
        fromStatus: oldStatus ?? null,
        toStatus: DepositTransactionStatus.SUCCESS,
      });
      if (outcome.blockedReason) {
        await this.recordDepositAccountingBlocked({
          deposit,
          payin,
          eventCode: outcome.eventCode,
          fromStatus: oldStatus ?? null,
          toStatus: DepositTransactionStatus.SUCCESS,
          assetType: suffix,
          blockedReason: outcome.blockedReason,
        });
        result.updated_deposit_status = deposit.status;
        return result;
      }

      if (outcome.journalId) {
        result.created_or_reversed_journal_entry_ids.push(outcome.journalId);
      }
      await this.recordDepositAccountingPosted({
        deposit,
        payin,
        eventCode: outcome.eventCode,
        journalId: outcome.journalId,
        fromStatus: oldStatus ?? null,
        toStatus: DepositTransactionStatus.SUCCESS,
        assetType: suffix,
        reason: 'Deposit success accounting posted',
      });
    }

    result.updated_deposit_status = deposit.status;
    return result;
  }

  private async orchestrateDepositRejected(depositId: string, payinId?: string | null): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      emitted_events: [],
      created_or_reversed_journal_entry_ids: [],
    };

    return this.prisma.$transaction(async (tx: any) => {
      const deposit = await tx.depositTransaction.findUnique({
        where: { id: depositId },
      });
      if (!deposit) {
        return result;
      }

      const targetPayinId = payinId || deposit.payinId;
      const payin = targetPayinId
        ? await tx.payin.findUnique({ where: { id: targetPayinId } })
        : null;

      if (payin && payin.status !== PayinStatus.CLEARED) {
        let history: any[] = [];
        try {
          history = payin.statusHistory ? JSON.parse(payin.statusHistory) : [];
          if (!Array.isArray(history)) history = [];
        } catch {
          history = [];
        }

        history.push({
          status: PayinStatus.CLEARED,
          changedAt: new Date(),
          reason: 'Deposit rejected: clearing payin',
          operatorId: 'SYSTEM',
        });

        const updatedPayin = await tx.payin.update({
          where: { id: payin.id },
          data: {
            status: PayinStatus.CLEARED,
            statusHistory: JSON.stringify(history),
          },
        });

        await this.auditLogsService.recordSystem(
          {
            triggerType: AuditTriggerType.STATE_TRANSITION,
            action: buildStateTransitionAction('PAYIN', payin.status, PayinStatus.CLEARED),
            module: AuditModules.PAYINS,
            entityType: AuditEntityTypes.PAYIN,
            entityId: payin.id,
            entityNo: payin.payinNo,
            entityOwnerType: payin.ownerId ? 'CUSTOMER' : undefined,
            entityOwnerId: payin.ownerId || undefined,
            workflowType: 'DEPOSIT',
            statusFrom: payin.status,
            statusTo: PayinStatus.CLEARED,
            reason: 'Deposit rejected orchestration',
            beforeData: { status: payin.status },
            afterData: { status: PayinStatus.CLEARED },
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );

        result.updated_payin_status = updatedPayin.status;
      } else if (payin) {
        result.updated_payin_status = payin.status;
      }

      result.updated_deposit_status = DepositTransactionStatus.REJECTED;
      return result;
    });
  }

  private async triggerDepositAccounting(params: {
    deposit: any;
    assetType: 'FIAT' | 'CRYPTO';
    fromStatus?: DepositTransactionStatus | null;
    toStatus: DepositTransactionStatus;
    tx?: any;
  }): Promise<DepositAccountingOutcome> {
    const { deposit, assetType, fromStatus, toStatus, tx } = params;
    const event = await this.resolveDepositAccountingEvent({
      assetType,
      fromStatus: fromStatus ?? null,
      toStatus,
      tx,
    });
    if (!event) {
      return {
        eventCode: null,
        journal: null,
        journalId: null,
        blockedReason: `No active accounting event found for DEPOSIT ${fromStatus ?? 'NULL'} -> ${toStatus} (${assetType})`,
      };
    }

    const context = {
      src: {
        ownerId: deposit.ownerId,
        ownerType: deposit.ownerType,
        assetId: deposit.assetId,
        depositId: deposit.id,
        amount: deposit.amount.toString(),
        depositNo: deposit.depositNo,
        walletId: deposit.toWalletId,
      },
    };

    try {
      const journal = await this.journalService.triggerEvent(
        {
          entityType: 'DEPOSIT',
          triggerKey: 'status',
          fromStatus: fromStatus ?? null,
          toStatus,
          assetType,
          context,
          sourceId: deposit.id,
        },
        tx,
      );
      if (!journal) {
        return {
          eventCode: event.eventCode,
          journal: null,
          journalId: null,
          blockedReason: `Accounting execution returned no journal for ${event.eventCode}`,
        };
      }

      return {
        eventCode: event.eventCode,
        journal,
        journalId: journal.id || null,
        blockedReason: null,
      };
    } catch (error: any) {
      return {
        eventCode: event.eventCode,
        journal: null,
        journalId: null,
        blockedReason: error?.message || `Accounting execution failed for ${event.eventCode}`,
      };
    }
  }

  private async resolveDepositAccountingEvent(params: {
    assetType: 'FIAT' | 'CRYPTO';
    fromStatus?: DepositTransactionStatus | null;
    toStatus: DepositTransactionStatus;
    tx?: any;
  }) {
    const client = params.tx || this.prisma;
    return (client as any).acctEvent?.findFirst?.({
      where: {
        entityType: 'DEPOSIT',
        triggerType: 'STATUS_TRANSITION',
        triggerKey: 'status',
        isActive: true,
        OR: [
          { fromStatus: params.fromStatus ?? null },
          { fromStatus: null },
        ],
        toStatus: params.toStatus,
        assetType: { in: [params.assetType, 'ALL'] },
      },
    });
  }

  private async recordDepositAccountingPosted(params: {
    deposit: any;
    payin?: any | null;
    eventCode: string | null;
    journalId: string | null;
    fromStatus: DepositTransactionStatus | null;
    toStatus: DepositTransactionStatus;
    assetType: 'FIAT' | 'CRYPTO';
    reason: string;
  }) {
    const { deposit, payin, eventCode, journalId, fromStatus, toStatus, assetType, reason } = params;
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_UPDATE,
      action: AuditActions.DEPOSIT_ACCOUNTING_POSTED,
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT',
      reason,
      metadata: {
        eventCode,
        journalId,
        fromStatus,
        toStatus,
        assetType,
        depositId: deposit.id,
        payinId: payin?.id || deposit.payinId || null,
      },
      sourcePlatform: 'SYSTEM',
    });
  }

  private async recordDepositAccountingBlocked(params: {
    deposit: any;
    payin?: any | null;
    eventCode: string | null;
    fromStatus: DepositTransactionStatus | null;
    toStatus: DepositTransactionStatus;
    assetType: 'FIAT' | 'CRYPTO';
    blockedReason: string;
  }) {
    const { deposit, payin, eventCode, fromStatus, toStatus, assetType, blockedReason } = params;
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_UPDATE,
      action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
      module: AuditModules.DEPOSIT_TRANSACTIONS,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT',
      result: AuditResult.FAILED,
      reason: blockedReason,
      metadata: {
        eventCode,
        journalId: null,
        fromStatus,
        toStatus,
        assetType,
        depositId: deposit.id,
        payinId: payin?.id || deposit.payinId || null,
        blockedReason,
      },
      sourcePlatform: 'SYSTEM',
    });
  }

  private getSuffix(payin: any): 'FIAT' | 'CRYPTO' {
    // suffix ∈ {FIAT, CRYPTO}, 由 payin.asset_class 或 payin.channel 决定。
    // Currently mapping from payin.type (crypto/fiat)
    return payin.type.toUpperCase() as 'FIAT' | 'CRYPTO';
  }

  private async findDepositByPayinId(payinId: string) {
    return (this.prisma as any).depositTransaction.findUnique({
      where: { payinId },
    });
  }
}

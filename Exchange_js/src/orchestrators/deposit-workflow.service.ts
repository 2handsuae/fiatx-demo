import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PayinStatusChangedEvent, PayinCreatedEvent } from '../modules/asset-treasury/payins/events/payin.events';
import { PayinStatus, PayinAction, PayinType } from '../modules/asset-treasury/payins/dto/payin.dto';
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

interface OrchestrationResult {
  updated_payin_status?: string;
  updated_deposit_status?: string;
  emitted_events: string[];
  created_or_reversed_journal_entry_ids: string[];
  audit_log_id?: string;
}

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly journalService: JournalsService,
    private readonly payinsService: PayinsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

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
        result = await this.orchestratePayinConfirmed(payinId);
        break;
    }
    if (result) {
      this.logger.log(`Orchestration complete for PayIn ${payinId}: ${JSON.stringify(result)}`);
    }
    return result;
  }

  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent): Promise<OrchestrationResult | null> {
    const { depositId, newStatus, payinId } = event;
    this.logger.log(`Orchestrating Deposit ${depositId} transition to ${newStatus}`);

    let result: OrchestrationResult | null = null;
    switch (newStatus) {
      case DepositTransactionStatus.SUCCESS:
        result = await this.orchestrateDepositSuccess(depositId);
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
    
    if (deposit && deposit.status !== DepositTransactionStatus.FAILED && deposit.status !== DepositTransactionStatus.REJECTED) {
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.FAIL,
        reason: 'PayIn failed',
      });
      result.updated_deposit_status = updated.status;
    }
    return result;
  }

  private async orchestratePayinConfirmed(payinId: string): Promise<OrchestrationResult> {
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
    if (deposit.status === DepositTransactionStatus.PAYIN_PENDING) {
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.PAYIN_CONFIRMED,
      });
      result.updated_deposit_status = updated.status;
    }

    // 2. Emit Event
    const suffix = this.getSuffix(payin);
    const eventCode = `EVT_DEPOSIT_CONFIRMED__${suffix}`;
    this.eventEmitter.emit(eventCode, { depositId: deposit.id, payinId });
    result.emitted_events.push(eventCode);

    // 3. Journal Entry (Idempotent inside triggerAccounting)
    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      const journal = await this.triggerAccounting(deposit, eventCode);
      if (journal) {
        result.created_or_reversed_journal_entry_ids.push(journal.id);
      }
    }

    // 4. Set PayIn to CLEARED (Only after Event and JE)
    const updatedPayin = await this.payinsService.updateStatus(payinId, PayinAction.CLEAR);
    result.updated_payin_status = updatedPayin.status;

    return result;
  }

  private async orchestrateDepositSuccess(depositId: string): Promise<OrchestrationResult> {
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
      const journal = await this.triggerAccounting(deposit, eventCode);
      if (journal) {
        result.created_or_reversed_journal_entry_ids.push(journal.id);
      }
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

      const suffix = payin ? this.getSuffix(payin) : 'FIAT';
      const confirmedEventCode = `EVT_DEPOSIT_CONFIRMED__${suffix}`;
      const reversalEventCode = `REV_${confirmedEventCode}`;

      const confirmedJournal = await tx.journal.findFirst({
        where: {
          sourceType: 'DEPOSIT',
          sourceId: depositId,
          eventCode: confirmedEventCode,
        },
      });

      if (confirmedJournal) {
        const existingReversal = await tx.journal.findFirst({
          where: {
            sourceType: 'DEPOSIT',
            sourceId: depositId,
            eventCode: reversalEventCode,
          },
        });

        if (!existingReversal) {
          const reversal = await this.journalService.reverseJournal(
            {
              sourceType: 'DEPOSIT',
              sourceId: depositId,
              reversalEventCode,
              targetEventCode: confirmedEventCode,
              context: {
                src: {
                  ownerId: deposit.ownerId,
                  ownerType: deposit.ownerType,
                  assetId: deposit.assetId,
                  depositId: deposit.id,
                  amount: deposit.amount.toString(),
                  depositNo: deposit.depositNo,
                  walletId: deposit.toWalletId,
                },
              },
            },
            tx,
          );
          if (reversal) {
            result.created_or_reversed_journal_entry_ids.push(reversal.id);
          }
        }
      }

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

        await tx.payinAuditLog.create({
          data: {
            payinId: payin.id,
            operatorId: 'SYSTEM',
            oldStatus: payin.status,
            newStatus: PayinStatus.CLEARED,
            reason: 'Deposit rejected orchestration',
          },
        });

        result.updated_payin_status = updatedPayin.status;
      } else if (payin) {
        result.updated_payin_status = payin.status;
      }

      result.updated_deposit_status = DepositTransactionStatus.REJECTED;
      return result;
    });
  }

  private async triggerAccounting(deposit: any, eventCode: string) {
    // Idempotency check: Check if journal already exists for this sourceId and eventCode
    const existingJournal = await (this.prisma as any).journal.findFirst({
      where: {
        sourceId: deposit.id,
        eventCode: eventCode,
      },
    });

    if (existingJournal) {
      this.logger.debug(`Accounting already processed for ${deposit.id} and ${eventCode}`);
      return existingJournal;
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

    return this.journalService.createJournal({
      sourceType: 'DEPOSIT',
      sourceId: deposit.id,
      eventCode: eventCode,
      context,
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

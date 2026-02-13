import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { WithdrawEvents } from '../modules/trading/withdraw-transactions/constants/withdraw-events.constant';
import { PayoutEvents } from '../modules/asset-treasury/payouts/constants/payout-events.constant';
import {
  WithdrawTransactionStatus,
  WithdrawTransactionAction,
} from '../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import {
  PayoutStatus,
  PayoutType,
  PayoutAction,
} from '../modules/asset-treasury/payouts/dto/payout.dto';

export interface OrchestrationResult {
  updated_withdrawal_status?: string;
  updated_payout_status?: string;
  payout_binding_status: 'created' | 'bound' | 'unchanged';
  emitted_events: string[];
  created_or_reversed_journal_entry_ids: string[];
  audit_log_id: string;
}

@Injectable()
export class WithdrawWorkflowOrchestrator {
  private readonly logger = new Logger(WithdrawWorkflowOrchestrator.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private withdrawalService: WithdrawTransactionsService,
    private payoutsService: PayoutsService,
    private journalsService: JournalsService,
    private clearingsService: ClearingsService,
  ) {}

  // --- Withdrawal Listeners ---

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_CREATED)
  async onWithdrawalCreated(payload: { withdrawId: string }) {
    return this.orchestrateWithdrawalEvent(payload.withdrawId, WithdrawEvents.EVT_WITHDRAWAL_CREATED);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_CANCELLED)
  async onWithdrawalCancelled(payload: { withdrawId: string }) {
    return this.orchestrateWithdrawalEvent(payload.withdrawId, WithdrawEvents.EVT_WITHDRAWAL_CANCELLED);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_REJECTED)
  async onWithdrawalRejected(payload: { withdrawId: string }) {
    return this.orchestrateWithdrawalEvent(payload.withdrawId, WithdrawEvents.EVT_WITHDRAWAL_REJECTED);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO)
  async onWithdrawalApprovedCrypto(payload: { withdrawId: string }) {
    return this.orchestrateWithdrawalEvent(payload.withdrawId, WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT)
  async onWithdrawalApprovedFiat(payload: { withdrawId: string }) {
    return this.orchestrateWithdrawalEvent(payload.withdrawId, WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT);
  }

  // --- Payout Listeners ---

  @OnEvent(PayoutEvents.EVT_PAYOUT_CONFIRMED)
  async onPayoutConfirmed(payload: { withdrawId: string; payoutId: string }) {
    return this.orchestrateSuccessPath(payload.withdrawId, payload.payoutId);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_FAILED__CRYPTO)
  async onWithdrawalFailedCrypto(payload: { withdrawId: string; payoutId: string; status: PayoutStatus }) {
    return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, payload.status);
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_FAILED__FIAT)
  async onWithdrawalFailedFiat(payload: { withdrawId: string; payoutId: string; status: PayoutStatus }) {
    return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, payload.status);
  }

  @OnEvent(PayoutEvents.EVT_PAYOUT_RETURNED)
  async onPayoutReturned(payload: { withdrawId: string; payoutId: string }) {
    return this.orchestratePayoutEvent(payload.withdrawId, payload.payoutId, PayoutStatus.RETURNED);
  }

  // --- Core Orchestration Logic ---

  private async orchestrateWithdrawalEvent(withdrawId: string, eventType: string): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Withdrawal Event: ${eventType} for ${withdrawId}`);

    // Idempotency Check
    if (await this.checkIdempotency(withdrawId, eventType)) {
      this.logger.warn(`Event ${eventType} for withdrawal ${withdrawId} already processed.`);
      return null;
    }

    const withdrawal = await this.withdrawalService.findOne(withdrawId);
    const suffix = this.getSuffix(withdrawal);
    const isCustomer = withdrawal.ownerType === 'CUSTOMER';
    const result: OrchestrationResult = {
      payout_binding_status: 'unchanged',
      emitted_events: [eventType],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
    };

    // 1) CREATED
    if (eventType === WithdrawEvents.EVT_WITHDRAWAL_CREATED) {
      if (isCustomer) {
        const je = await this.journalsService.triggerEvent({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: WithdrawTransactionStatus.CREATED,
          assetType: suffix,
          context: this.createAccountingContext(withdrawal),
          sourceId: withdrawal.id,
        });
        if (je) result.created_or_reversed_journal_entry_ids.push(je.id);
      }
      // Log for idempotency (self-transition if possible, or just audit log)
      await this.prisma.withdrawAuditLog.create({
        data: {
          withdrawTransactionId: withdrawId,
          operatorId: 'SYSTEM',
          oldStatus: withdrawal.status,
          newStatus: withdrawal.status,
          reason: `[${eventType}] Initial accounting processed`,
        },
      });
    }
    // 2) CANCELLED / 3) REJECTED
    else if (eventType === WithdrawEvents.EVT_WITHDRAWAL_CANCELLED || eventType === WithdrawEvents.EVT_WITHDRAWAL_REJECTED) {
      if (isCustomer) {
        const je = await this.journalsService.triggerEvent({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: withdrawal.status,
          assetType: suffix,
          context: this.createAccountingContext(withdrawal),
          sourceId: withdrawal.id,
        });
        if (je) result.created_or_reversed_journal_entry_ids.push(je.id);
      }
      // Log for idempotency
      await this.prisma.withdrawAuditLog.create({
        data: {
          withdrawTransactionId: withdrawId,
          operatorId: 'SYSTEM',
          oldStatus: withdrawal.status,
          newStatus: withdrawal.status,
          reason: `[${eventType}] Cancellation accounting processed`,
        },
      });
    }
    // 4) APPROVED (Entering PAYOUT_PENDING)
    else if (eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO || eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT) {
      await (this.prisma as any).$transaction(async (tx: any) => {
        // Trigger Clearing (Idempotent inside Service)
        await this.clearingsService.triggerClearing(
          {
            sourceType: 'WITHDRAWAL',
            sourceId: withdrawal.id,
            eventCode: eventType,
            context: this.createAccountingContext(withdrawal),
          },
          tx,
        );

        const updatedAfterClearing = await tx.withdrawTransaction.findUnique({
          where: { id: withdrawId },
        });

        if (!updatedAfterClearing) {
          throw new Error(`Withdrawal ${withdrawId} not found after clearing`);
        }

        // JE: Approved (Only if customer)
        if (isCustomer) {
          const je = await this.journalsService.triggerEvent(
            {
              entityType: 'WITHDRAW',
              triggerKey: 'status',
              toStatus: WithdrawTransactionStatus.PAYOUT_PENDING,
              assetType: suffix,
              context: this.createAccountingContext(updatedAfterClearing),
              sourceId: updatedAfterClearing.id,
            },
            tx,
          );
          if (je) result.created_or_reversed_journal_entry_ids.push(je.id);
        }

        // Create/Bind Payout
        const payout = await this.payoutsService.create(
          {
            withdrawId: updatedAfterClearing.id,
            type: suffix === 'CRYPTO' ? PayoutType.CRYPTO : PayoutType.FIAT,
            amount: updatedAfterClearing.netAmount.toString(),
            assetId: updatedAfterClearing.assetId,
            toAddress: updatedAfterClearing.toAddress || undefined,
            toIban: updatedAfterClearing.toIban || undefined,
            toWalletId: updatedAfterClearing.toWalletId || undefined,
          },
          'SYSTEM',
          tx,
        );
        result.payout_binding_status = 'created';

        const updatedStatus = await this.withdrawalService.updateStatus(
          withdrawId,
          {
            action: WithdrawTransactionAction.APPROVE,
            reason: `[${eventType}] Payout initiated: ${payout.id}`,
          },
          tx,
        );
        result.updated_withdrawal_status = updatedStatus.status;
      });
    }

    const latestLog = await this.getLatestAuditLog(withdrawId);
    result.audit_log_id = latestLog?.id || '';

    this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
    return result;
  }

  private async orchestrateSuccessPath(withdrawId: string, payoutId: string): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Atomic Success Path for Withdrawal ${withdrawId} and Payout ${payoutId}`);

    // Idempotency check: Use a specific success-path audit log marker
    const eventType = 'SUCCESS_PATH_ATOMIC';
    if (await this.checkIdempotency(withdrawId, eventType)) {
      this.logger.warn(`Success path for withdrawal ${withdrawId} already processed.`);
      return null;
    }

    const withdrawal = await this.withdrawalService.findOne(withdrawId);
    if (withdrawal.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping success path.`);
      return null;
    }

    const isCustomer = withdrawal.ownerType === 'CUSTOMER';
    const suffix = this.getSuffix(withdrawal);
    const result: OrchestrationResult = {
      payout_binding_status: 'unchanged',
      emitted_events: [],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
    };

    return await (this.prisma as any).$transaction(async (tx: any) => {
      // 1. Update Withdrawal to SUCCESS
      const updatedWithdrawal = await this.withdrawalService.updateStatus(withdrawId, {
        action: WithdrawTransactionAction.SUCCESS,
        reason: `[${eventType}] Payout confirmed. Setting withdrawal to SUCCESS.`,
      }, tx);
      result.updated_withdrawal_status = updatedWithdrawal.status;

      // 2. JE: Success (Only if customer)
      if (isCustomer) {
        const je = await this.journalsService.triggerEvent({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: WithdrawTransactionStatus.SUCCESS,
          assetType: suffix,
          context: this.createAccountingContext(updatedWithdrawal),
          sourceId: updatedWithdrawal.id,
        }, tx);
        if (je) result.created_or_reversed_journal_entry_ids.push(je.id);
      }

      // 3. Update Payout to CLEAR
      const updatedPayout = await this.payoutsService.updateStatus(payoutId, {
        action: PayoutAction.CLEAR,
        reason: `[${eventType}] Internal accounting completed successfully.`,
      }, 'SYSTEM', tx);
      result.updated_payout_status = updatedPayout.status;

      // 4. Final Audit Log for Orchestrator completion
      const log = await tx.withdrawAuditLog.create({
        data: {
          withdrawTransactionId: withdrawId,
          operatorId: 'SYSTEM',
          oldStatus: withdrawal.status,
          newStatus: updatedWithdrawal.status,
          reason: `[${eventType}] Atomic success path completed.`,
        },
      });
      result.audit_log_id = log.id;

      this.logger.log(`Atomic Success Path Result: ${JSON.stringify(result)}`);
      return result;
    });
  }

  private async orchestratePayoutEvent(withdrawId: string, payoutId: string, status: PayoutStatus): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Payout Result: ${status} for Withdrawal ${withdrawId}`);

    const withdrawal = await this.withdrawalService.findOne(withdrawId);
    if (withdrawal.status !== WithdrawTransactionStatus.PAYOUT_PENDING && status !== PayoutStatus.RETURNED) {
      this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping back-propagation.`);
      return null;
    }

    const isCustomer = withdrawal.ownerType === 'CUSTOMER';
    const suffix = this.getSuffix(withdrawal);
    const result: OrchestrationResult = {
      payout_binding_status: 'unchanged',
      emitted_events: [],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
    };

    // 5.2/5.3 Failure & Return Path (Full Rollback)
    if (status === PayoutStatus.FAILED || status === PayoutStatus.TIMEOUT || status === PayoutStatus.RETURNED) {
      const isReturn = status === PayoutStatus.RETURNED;
      const feedbackEvent = isReturn ? WithdrawEvents.EVT_WITHDRAWAL_RETURNED__FIAT : `EVT_WITHDRAWAL_FAILED__${suffix}`;

      await (this.prisma as any).$transaction(async (tx: any) => {
        // Update Withdrawal Status
        const updatedWithdrawal = await this.withdrawalService.updateStatus(
          withdrawId,
          {
            action: isReturn
              ? WithdrawTransactionAction.RETURN
              : WithdrawTransactionAction.FAIL,
            reason: `[${feedbackEvent}] Payout ${payoutId} ${status.toLowerCase()}. Performing full reversal.`,
          },
          tx,
        );
        result.updated_withdrawal_status = updatedWithdrawal.status;

        // Full JE Rollback (Only if customer)
        if (isCustomer) {
          const journals = await tx.journal.findMany({
            where: { sourceId: withdrawId, sourceType: 'WITHDRAW' },
          });

          for (const journal of journals) {
            if (journal.reversalOfJournalId) continue;

            const reversal = await this.journalsService.reverseJournal(
              {
                sourceType: 'WITHDRAW',
                sourceId: withdrawId,
                reversalEventCode: `REV_${journal.eventCode}`,
                targetEventCode: journal.eventCode,
                context: this.createAccountingContext(updatedWithdrawal),
              },
              tx,
            );
            if (reversal) result.created_or_reversed_journal_entry_ids.push(reversal.id);
          }
        }

        // Cancel Clearing
        await this.clearingsService.updateStatusBySource(withdrawId, 'CANCELLED', tx);
      });

      this.eventEmitter.emit(feedbackEvent, { withdrawId, payoutId, status });
      result.emitted_events.push(feedbackEvent);
    }

    const latestLog = await this.getLatestAuditLog(withdrawId);
    result.audit_log_id = latestLog?.id || '';

    this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
    return result;
  }

  // --- Helpers ---

  private getSuffix(withdrawal: any): 'CRYPTO' | 'FIAT' {
    return withdrawal.type.toUpperCase() as 'CRYPTO' | 'FIAT';
  }

  private async checkIdempotency(withdrawId: string, eventType: string): Promise<boolean> {
    const existingLog = await this.prisma.withdrawAuditLog.findFirst({
      where: {
        withdrawTransactionId: withdrawId,
        reason: { contains: eventType },
      },
    });
    return !!existingLog;
  }

  private async getLatestAuditLog(withdrawId: string) {
    return this.prisma.withdrawAuditLog.findFirst({
      where: { withdrawTransactionId: withdrawId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private createAccountingContext(withdrawal: any) {
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
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { WithdrawTransactionsService } from '../modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../modules/asset-treasury/payouts/payouts.service';
import { ClearingsService } from '../modules/clearing-settle/clearing/clearings.service';
import { WithdrawEvents } from '../modules/trading/withdraw-transactions/constants/withdraw-events.constant';
import { PayoutEvents } from '../modules/asset-treasury/payouts/constants/payout-events.constant';
import { TransactionComplianceService } from '../modules/risk-engine/transaction-compliance/transaction-compliance.service';
import {
  WithdrawTransactionStatus,
  WithdrawTransactionAction,
} from '../modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import {
  PayoutStatus,
  PayoutType,
  PayoutAction,
} from '../modules/asset-treasury/payouts/dto/payout.dto';
import {
  buildCryptoSystemWalletNo,
  buildFiatPoolWalletNo,
} from '../modules/asset-treasury/wallets/system-wallet.util';
import { AuditLogsService } from '../modules/audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../modules/audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../modules/audit-logging/dto/audit-log.dto';
import { AccountingEventExecutionService } from './accounting-event-execution.service';

export interface OrchestrationResult {
  updated_withdrawal_status?: string;
  updated_payout_status?: string;
  payout_binding_status: 'created' | 'bound' | 'unchanged';
  emitted_events: string[];
  created_or_reversed_journal_entry_ids: string[];
  audit_log_id: string;
  repairApplied?: boolean;
}

type WithdrawalAssetLike = {
  id?: string;
  code?: string;
  network?: string | null;
  type?: string | null;
};

type WithdrawalForOrchestration = {
  id: string;
  status: string;
  ownerType: string;
  ownerId: string;
  assetId: string;
  withdrawNo: string;
  amount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  fromWalletId?: string | null;
  fromWalletNo?: string | null;
  fromAddress?: string | null;
  fromIban?: string | null;
  toWalletId?: string | null;
  toWalletNo?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  payoutId?: string | null;
  payoutNo?: string | null;
  type?: string | null;
  asset?: WithdrawalAssetLike | null;
};

type SourceWalletProjection = {
  id: string;
  walletNo: string | null;
  address: string | null;
  iban: string | null;
};

type JournalPostingResult =
  | { id?: string | null }
  | Array<{ id?: string | null }>
  | null
  | undefined;

@Injectable()
export class WithdrawWorkflowOrchestrator {
  private readonly logger = new Logger(WithdrawWorkflowOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawalService: WithdrawTransactionsService,
    private readonly payoutsService: PayoutsService,
    private readonly accountingEventExecutionService: AccountingEventExecutionService,
    private readonly clearingsService: ClearingsService,
    private readonly transactionComplianceService: TransactionComplianceService,
    private readonly auditLogsService: AuditLogsService,
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

  @OnEvent(PayoutEvents.EVT_PAYOUT_FAILED)
  async onPayoutFailed(payload: { withdrawId: string; payoutId: string; status: PayoutStatus }) {
    return this.orchestratePayoutEvent(
      payload.withdrawId,
      payload.payoutId,
      payload.status || PayoutStatus.FAILED,
    );
  }

  @OnEvent(PayoutEvents.EVT_PAYOUT_TIMEOUT)
  async onPayoutTimeout(payload: { withdrawId: string; payoutId: string; status: PayoutStatus }) {
    return this.orchestratePayoutEvent(
      payload.withdrawId,
      payload.payoutId,
      payload.status || PayoutStatus.TIMEOUT,
    );
  }

  @OnEvent(PayoutEvents.EVT_PAYOUT_RETURNED)
  async onPayoutReturned(payload: { withdrawId: string; payoutId: string; status?: PayoutStatus }) {
    return this.orchestratePayoutEvent(
      payload.withdrawId,
      payload.payoutId,
      payload.status || PayoutStatus.RETURNED,
    );
  }

  // --- Core Orchestration Logic ---

  private async orchestrateWithdrawalEvent(withdrawId: string, eventType: string): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Withdrawal Event: ${eventType} for ${withdrawId}`);

    const marker =
      eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO ||
      eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT
        ? this.markerForWithdrawApproved(withdrawId)
        : this.markerForWithdrawalEvent(eventType, withdrawId);
    if (await this.checkIdempotency(withdrawId, marker)) {
      this.logger.warn(`Event ${eventType} for withdrawal ${withdrawId} already processed by marker.`);
      return null;
    }

    const withdrawal = await this.withdrawalService.findOne(withdrawId);
    if (
      (eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO ||
        eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT) &&
      withdrawal.status !== WithdrawTransactionStatus.PAYOUT_PENDING
    ) {
      this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping approve orchestration.`);
      return null;
    }

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
        const execution = await this.accountingEventExecutionService.execute({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: WithdrawTransactionStatus.CREATED,
          assetType: suffix,
          frozenContext: this.createAccountingContext(withdrawal),
          sourceId: withdrawal.id,
          journalSourceType: 'WITHDRAW',
          clearingSourceType: 'WITHDRAWAL',
        });
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );
      }
      const log = await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.SYSTEM_EVENT,
        action: AuditActions.SYSTEM_WITHDRAW_CREATED_ORCHESTRATED,
        module: AuditModules.WITHDRAW_WORKFLOW,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: withdrawId,
        entityNo: withdrawal.withdrawNo,
        entityOwnerType: withdrawal.ownerType,
        entityOwnerId: withdrawal.ownerId,
        reason: marker,
        metadata: { eventType },
        idempotencyKey: marker,
        sourcePlatform: 'SYSTEM',
      });
      result.audit_log_id = log.id;
    }
    // 2) CANCELLED / 3) REJECTED
    else if (eventType === WithdrawEvents.EVT_WITHDRAWAL_CANCELLED || eventType === WithdrawEvents.EVT_WITHDRAWAL_REJECTED) {
      if (isCustomer) {
        const execution = await this.accountingEventExecutionService.execute({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: withdrawal.status,
          assetType: suffix,
          frozenContext: this.createAccountingContext(withdrawal),
          sourceId: withdrawal.id,
          journalSourceType: 'WITHDRAW',
          clearingSourceType: 'WITHDRAWAL',
        });
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );
      }
      const log = await this.auditLogsService.recordSystem({
        triggerType: AuditTriggerType.SYSTEM_EVENT,
        action: AuditActions.SYSTEM_WITHDRAW_TERMINAL_ORCHESTRATED,
        module: AuditModules.WITHDRAW_WORKFLOW,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: withdrawId,
        entityNo: withdrawal.withdrawNo,
        entityOwnerType: withdrawal.ownerType,
        entityOwnerId: withdrawal.ownerId,
        reason: marker,
        metadata: { eventType },
        idempotencyKey: marker,
        sourcePlatform: 'SYSTEM',
      });
      result.audit_log_id = log.id;
    }
    // 4) APPROVED (Entering PAYOUT_PENDING)
    else if (eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO || eventType === WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT) {
      await this.prisma.$transaction(async (tx) => {
        const withdrawalForPosting = await tx.withdrawTransaction.findUnique({
          where: { id: withdrawId },
          include: {
            asset: {
              select: {
                id: true,
                code: true,
                network: true,
                type: true,
              },
            },
          },
        });
        if (!withdrawalForPosting) {
          throw new BadRequestException(`Withdrawal ${withdrawId} not found`);
        }

        const withdrawWithSourceWallet = await this.ensureSourceWalletBound(
          tx,
          withdrawalForPosting,
          suffix,
        );

        const execution = await this.accountingEventExecutionService.execute(
          {
            entityType: 'WITHDRAW',
            triggerKey: 'status',
            toStatus: WithdrawTransactionStatus.PAYOUT_PENDING,
            assetType: suffix,
            frozenContext: this.createAccountingContext(withdrawWithSourceWallet),
            sourceId: withdrawWithSourceWallet.id,
            journalSourceType: 'WITHDRAW',
            clearingSourceType: 'WITHDRAWAL',
          },
          tx,
        );
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );

        let payout = await tx.payout.findUnique({
          where: { withdrawId },
        });
        if (!payout) {
          payout = await this.payoutsService.create(
            {
              withdrawId: withdrawWithSourceWallet.id,
              type: suffix === 'CRYPTO' ? PayoutType.CRYPTO : PayoutType.FIAT,
              amount: Number(withdrawWithSourceWallet.netAmount),
              assetId: withdrawWithSourceWallet.assetId,
              toAddress: withdrawWithSourceWallet.toAddress || undefined,
              toIban: withdrawWithSourceWallet.toIban || undefined,
              toWalletId: withdrawWithSourceWallet.toWalletId || undefined,
            },
            'SYSTEM',
            tx,
          );
          result.payout_binding_status = 'created';
        } else {
          result.payout_binding_status = 'bound';
        }
        if (!payout) {
          throw new BadRequestException(
            `Failed to bind payout for withdrawal ${withdrawWithSourceWallet.id}`,
          );
        }
        const boundPayout = payout;

        await tx.withdrawTransaction.update({
          where: { id: withdrawWithSourceWallet.id },
          data: {
            payoutId: boundPayout.id,
            payoutNo: boundPayout.payoutNo,
          },
        });

        result.updated_withdrawal_status = withdrawWithSourceWallet.status;

        const log = await this.auditLogsService.recordSystem(
          {
            triggerType: AuditTriggerType.SYSTEM_EVENT,
            action: AuditActions.SYSTEM_WITHDRAW_APPROVED_ORCHESTRATED,
            module: AuditModules.WITHDRAW_WORKFLOW,
            entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            entityId: withdrawId,
            entityNo: withdrawWithSourceWallet.withdrawNo,
            entityOwnerType: withdrawWithSourceWallet.ownerType,
            entityOwnerId: withdrawWithSourceWallet.ownerId,
            statusFrom: withdrawal.status,
            statusTo: withdrawWithSourceWallet.status,
            reason: marker,
            beforeData: { status: withdrawal.status },
            afterData: {
              status: withdrawWithSourceWallet.status,
              payoutId: boundPayout.id,
            },
            idempotencyKey: marker,
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );
        result.audit_log_id = log.id;
      });
    }

    this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
    return result;
  }

  private async orchestrateSuccessPath(withdrawId: string, payoutId: string): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Atomic Success Path for Withdrawal ${withdrawId} and Payout ${payoutId}`);

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        withdrawId: true,
        status: true,
      },
    });
    if (!payout) {
      throw new BadRequestException(`Payout ${payoutId} not found`);
    }
    if (payout.withdrawId !== withdrawId) {
      throw new BadRequestException(
        `Payout ${payoutId} is not linked to withdrawal ${withdrawId}`,
      );
    }
    if (payout.status !== PayoutStatus.CONFIRMED) {
      this.logger.warn(`Payout ${payoutId} is not in CONFIRMED. Skipping success path.`);
      return null;
    }

    const marker = this.markerForSuccessPath(withdrawId, payoutId);
    if (await this.checkIdempotency(withdrawId, marker)) {
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

    return await this.prisma.$transaction(async (tx) => {
      const updatedWithdrawal = await this.withdrawalService.updateStatus(
        withdrawId,
        {
          action: WithdrawTransactionAction.SUCCESS,
          reason: `[${marker}] Payout confirmed. Setting withdrawal to SUCCESS.`,
        },
        {
          source: 'SYSTEM',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
      result.updated_withdrawal_status = updatedWithdrawal.status;

      let postingWithdrawal = updatedWithdrawal;
      if (!postingWithdrawal.fromWalletId) {
        const current = await tx.withdrawTransaction.findUnique({
          where: { id: withdrawId },
          include: {
            asset: {
              select: {
                id: true,
                code: true,
                network: true,
                type: true,
              },
            },
          },
        });
        if (!current) {
          throw new BadRequestException(
            `Withdrawal ${withdrawId} not found while binding source wallet`,
          );
        }
        postingWithdrawal = await this.ensureSourceWalletBound(
          tx,
          current,
          suffix,
        );
      }

      if (isCustomer) {
        const execution = await this.accountingEventExecutionService.execute({
          entityType: 'WITHDRAW',
          triggerKey: 'status',
          toStatus: WithdrawTransactionStatus.SUCCESS,
          assetType: suffix,
          frozenContext: this.createAccountingContext(postingWithdrawal),
          sourceId: postingWithdrawal.id,
          journalSourceType: 'WITHDRAW',
          clearingSourceType: 'WITHDRAWAL',
        }, tx);
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );
      }

      const updatedPayout = await this.payoutsService.updateStatus(payoutId, {
        action: PayoutAction.CLEAR,
        reason: `[${marker}] Internal accounting completed successfully.`,
      }, 'SYSTEM', tx);
      result.updated_payout_status = updatedPayout.status;

      const log = await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.STATE_TRANSITION,
          action: buildStateTransitionAction(
            'WITHDRAW',
            withdrawal.status,
            updatedWithdrawal.status,
          ),
          module: AuditModules.WITHDRAW_WORKFLOW,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: withdrawId,
          entityNo: updatedWithdrawal.withdrawNo,
          entityOwnerType: updatedWithdrawal.ownerType,
          entityOwnerId: updatedWithdrawal.ownerId,
          statusFrom: withdrawal.status,
          statusTo: updatedWithdrawal.status,
          reason: marker,
          beforeData: { status: withdrawal.status },
          afterData: { status: updatedWithdrawal.status },
          idempotencyKey: marker,
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
      result.audit_log_id = log.id;

      this.logger.log(`Atomic Success Path Result: ${JSON.stringify(result)}`);
      return result;
    });
  }

  private async orchestratePayoutEvent(withdrawId: string, payoutId: string, status: PayoutStatus): Promise<OrchestrationResult | null> {
    this.logger.log(`Orchestrating Payout Result: ${status} for Withdrawal ${withdrawId}`);

    if (
      status !== PayoutStatus.FAILED &&
      status !== PayoutStatus.TIMEOUT &&
      status !== PayoutStatus.RETURNED
    ) {
      this.logger.warn(`Unsupported payout status ${status} for orchestration.`);
      return null;
    }

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        withdrawId: true,
        status: true,
      },
    });
    if (!payout) {
      throw new BadRequestException(`Payout ${payoutId} not found`);
    }
    if (payout.withdrawId !== withdrawId) {
      throw new BadRequestException(
        `Payout ${payoutId} is not linked to withdrawal ${withdrawId}`,
      );
    }
    if (payout.status !== status) {
      this.logger.warn(
        `Payout ${payoutId} current status ${payout.status} does not match expected orchestration status ${status}. Skipping.`,
      );
      return null;
    }

    const result = await this.executeCompensationPath(withdrawId, payoutId, status);
    if (!result) return null;

    this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
    return result;
  }

  async reCloseoutPayout(payoutId: string): Promise<OrchestrationResult> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        withdrawId: true,
        status: true,
      },
    });
    if (!payout) {
      throw new BadRequestException(`Payout ${payoutId} not found`);
    }

    const withdrawal = await this.withdrawalService.findOne(payout.withdrawId);
    if (
      payout.status === PayoutStatus.CLEARED &&
      withdrawal.status === WithdrawTransactionStatus.SUCCESS
    ) {
      return this.buildNoopCloseoutResult(withdrawal.status, payout.status);
    }

    if (
      payout.status !== PayoutStatus.CONFIRMED ||
      withdrawal.status !== WithdrawTransactionStatus.PAYOUT_PENDING
    ) {
      throw new BadRequestException({
        code: 'PAYOUT_RECLOSEOUT_NOT_APPLICABLE',
        message:
          'Re-closeout is only available for CONFIRMED payout linked to PAYOUT_PENDING withdraw.',
        details: {
          payoutId,
          payoutStatus: payout.status,
          withdrawId: payout.withdrawId,
          withdrawStatus: withdrawal.status,
        },
      });
    }

    const result = await this.orchestrateSuccessPath(payout.withdrawId, payout.id);
    if (result) {
      return {
        ...result,
        repairApplied: true,
      };
    }

    const refreshedPayout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        status: true,
      },
    });
    const refreshedWithdrawal = await this.withdrawalService.findOne(payout.withdrawId);
    if (
      refreshedPayout?.status === PayoutStatus.CLEARED &&
      refreshedWithdrawal.status === WithdrawTransactionStatus.SUCCESS
    ) {
      return this.buildNoopCloseoutResult(
        refreshedWithdrawal.status,
        refreshedPayout.status,
      );
    }

    throw new BadRequestException({
      code: 'PAYOUT_RECLOSEOUT_FAILED',
      message: `Unable to re-run canonical closeout for payout ${payoutId}`,
    });
  }

  async reCompensatePayout(payoutId: string): Promise<OrchestrationResult> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        withdrawId: true,
        status: true,
      },
    });
    if (!payout) {
      throw new BadRequestException(`Payout ${payoutId} not found`);
    }
    if (!this.isCompensationPayoutStatus(payout.status as PayoutStatus)) {
      throw new BadRequestException({
        code: 'PAYOUT_RECOMPENSATE_NOT_APPLICABLE',
        message:
          'Re-compensate is only available for FAILED, TIMEOUT, or RETURNED payout.',
        details: {
          payoutId,
          payoutStatus: payout.status,
        },
      });
    }

    const withdrawal = await this.withdrawalService.findOne(payout.withdrawId);
    const payoutStatus = payout.status as PayoutStatus;
    if (await this.isCompensationSettled(withdrawal, payoutStatus)) {
      return this.buildNoopCompensationResult(withdrawal.status, payout.status);
    }

    if (!this.isCompensationRepairApplicable(withdrawal.status, payoutStatus)) {
      throw new BadRequestException({
        code: 'PAYOUT_RECOMPENSATE_NOT_APPLICABLE',
        message:
          'Re-compensate is only available when payout is terminal and withdraw still needs terminal compensation closeout.',
        details: {
          payoutId,
          payoutStatus: payout.status,
          withdrawId: payout.withdrawId,
          withdrawStatus: withdrawal.status,
        },
      });
    }

    const result = await this.executeCompensationPath(
      payout.withdrawId,
      payout.id,
      payoutStatus,
    );
    if (result) {
      return {
        ...result,
        repairApplied: true,
      };
    }

    const refreshedPayout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        status: true,
      },
    });
    const refreshedWithdrawal = await this.withdrawalService.findOne(payout.withdrawId);
    if (
      refreshedPayout &&
      this.isCompensationPayoutStatus(refreshedPayout.status as PayoutStatus) &&
      (await this.isCompensationSettled(
        refreshedWithdrawal,
        refreshedPayout.status as PayoutStatus,
      ))
    ) {
      return this.buildNoopCompensationResult(
        refreshedWithdrawal.status,
        refreshedPayout.status,
      );
    }

    throw new BadRequestException({
      code: 'PAYOUT_RECOMPENSATE_FAILED',
      message: `Unable to re-run canonical compensation for payout ${payoutId}`,
    });
  }

  // --- Helpers ---

  private getSuffix(withdrawal: WithdrawalForOrchestration): 'CRYPTO' | 'FIAT' {
    if (withdrawal?.asset?.type === 'CRYPTO' || withdrawal?.asset?.type === 'FIAT') {
      return withdrawal.asset.type;
    }
    if (typeof withdrawal?.type === 'string') {
      return withdrawal.type.toUpperCase() as 'CRYPTO' | 'FIAT';
    }
    return 'FIAT';
  }

  private async checkIdempotency(withdrawId: string, marker: string): Promise<boolean> {
    return this.auditLogsService.hasIdempotencyKey(marker);
  }

  private markerForWithdrawalEvent(eventType: string, withdrawId: string) {
    return `ORCH::WITHDRAW_EVENT::${eventType}::${withdrawId}::DONE`;
  }

  private markerForWithdrawApproved(withdrawId: string) {
    return `ORCH::WITHDRAW_APPROVED::${withdrawId}::DONE`;
  }

  private markerForSuccessPath(withdrawId: string, payoutId: string) {
    return `ORCH::WITHDRAW_SUCCESS_PATH::${withdrawId}::${payoutId}::DONE`;
  }

  private markerForPayoutResult(
    withdrawId: string,
    payoutId: string,
    status: PayoutStatus,
  ) {
    return `ORCH::WITHDRAW_PAYOUT_RESULT::${withdrawId}::${payoutId}::${status}::DONE`;
  }

  private isCompensationPayoutStatus(status: PayoutStatus): boolean {
    return (
      status === PayoutStatus.FAILED ||
      status === PayoutStatus.TIMEOUT ||
      status === PayoutStatus.RETURNED
    );
  }

  private mapCompensationWithdrawStatus(status: PayoutStatus): WithdrawTransactionStatus {
    return status === PayoutStatus.RETURNED
      ? WithdrawTransactionStatus.RETURNED
      : WithdrawTransactionStatus.FAILED;
  }

  private mapCompensationWithdrawAction(status: PayoutStatus): WithdrawTransactionAction {
    return status === PayoutStatus.RETURNED
      ? WithdrawTransactionAction.RETURN
      : WithdrawTransactionAction.FAIL;
  }

  private isCompensationRepairApplicable(
    withdrawStatus: string,
    payoutStatus: PayoutStatus,
  ): boolean {
    if (payoutStatus === PayoutStatus.RETURNED) {
      return (
        withdrawStatus === WithdrawTransactionStatus.SUCCESS ||
        withdrawStatus === WithdrawTransactionStatus.RETURNED
      );
    }
    return (
      withdrawStatus === WithdrawTransactionStatus.PAYOUT_PENDING ||
      withdrawStatus === WithdrawTransactionStatus.FAILED
    );
  }

  private async isCompensationSettled(
    withdrawal: WithdrawalForOrchestration,
    payoutStatus: PayoutStatus,
  ): Promise<boolean> {
    if (
      !this.isCompensationPayoutStatus(payoutStatus) ||
      withdrawal.status !== this.mapCompensationWithdrawStatus(payoutStatus)
    ) {
      return false;
    }

    if (withdrawal.ownerType !== 'CUSTOMER') {
      return true;
    }

    const originalJournals = await (this.prisma as any).journal.findMany({
      where: {
        sourceType: 'WITHDRAW',
        sourceId: withdrawal.id,
        reversalOfJournalId: null,
      },
      select: {
        id: true,
      },
    });
    if (!originalJournals.length) {
      return false;
    }

    const reversals = await (this.prisma as any).journal.findMany({
      where: {
        sourceType: 'WITHDRAW',
        sourceId: withdrawal.id,
        reversalOfJournalId: {
          in: originalJournals.map((journal: { id: string }) => journal.id),
        },
      },
      select: {
        reversalOfJournalId: true,
      },
    });
    const reversedSourceIds = new Set(
      reversals
        .map((journal: { reversalOfJournalId?: string | null }) => journal.reversalOfJournalId)
        .filter(
          (value: string | null | undefined): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    );
    if (originalJournals.some((journal: { id: string }) => !reversedSourceIds.has(journal.id))) {
      return false;
    }

    const clearings = await (this.prisma as any).clearing.findMany({
      where: {
        sourceType: 'WITHDRAWAL',
        sourceId: withdrawal.id,
      },
      select: {
        clearingStatus: true,
      },
    });
    if (!clearings.length) {
      return false;
    }

    return clearings.every(
      (clearing: { clearingStatus?: string | null }) =>
        clearing.clearingStatus === 'CANCELLED',
    );
  }

  private async executeCompensationPath(
    withdrawId: string,
    payoutId: string,
    payoutStatus: PayoutStatus,
  ): Promise<OrchestrationResult | null> {
    const marker = this.markerForPayoutResult(withdrawId, payoutId, payoutStatus);
    const withdrawal = await this.withdrawalService.findOne(withdrawId);

    if (await this.checkIdempotency(withdrawId, marker)) {
      if (await this.isCompensationSettled(withdrawal, payoutStatus)) {
        this.logger.warn(
          `Payout result ${payoutStatus} for ${withdrawId} already processed with settled compensation.`,
        );
        return null;
      }
      this.logger.warn(
        `Payout result ${payoutStatus} for ${withdrawId} already has marker but compensation artifacts are incomplete. Replaying compensation path.`,
      );
    }

    if (!this.isCompensationRepairApplicable(withdrawal.status, payoutStatus)) {
      this.logger.warn(
        `Withdrawal ${withdrawId} status ${withdrawal.status} is not eligible for payout compensation replay on ${payoutStatus}.`,
      );
      return null;
    }

    const isCustomer = withdrawal.ownerType === 'CUSTOMER';
    const suffix = this.getSuffix(withdrawal);
    const targetWithdrawStatus = this.mapCompensationWithdrawStatus(payoutStatus);
    const result: OrchestrationResult = {
      payout_binding_status: 'unchanged',
      emitted_events: [payoutStatus],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
      updated_payout_status: payoutStatus,
    };

    return this.prisma.$transaction(async (tx) => {
      const currentWithdrawal = await tx.withdrawTransaction.findUnique({
        where: { id: withdrawId },
        include: {
          asset: {
            select: {
              id: true,
              code: true,
              network: true,
              type: true,
            },
          },
        },
      });
      if (!currentWithdrawal) {
        throw new BadRequestException(`Withdrawal ${withdrawId} not found`);
      }

      let accountingWithdrawal = currentWithdrawal;
      if (currentWithdrawal.status !== targetWithdrawStatus) {
        accountingWithdrawal = await this.withdrawalService.updateStatus(
          withdrawId,
          {
            action: this.mapCompensationWithdrawAction(payoutStatus),
            reason: `[${marker}] Payout ${payoutId} ${payoutStatus.toLowerCase()}.`,
          },
          {
            source: 'SYSTEM',
            actorType: 'SYSTEM',
            actorId: 'SYSTEM',
            actorRole: 'SYSTEM',
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );
      }
      result.updated_withdrawal_status = accountingWithdrawal.status;

      if (isCustomer) {
        const execution = await this.accountingEventExecutionService.execute(
          {
            entityType: 'WITHDRAW',
            triggerKey: 'status',
            toStatus: targetWithdrawStatus,
            assetType: suffix,
            frozenContext: this.createAccountingContext(accountingWithdrawal),
            sourceId: accountingWithdrawal.id,
            journalSourceType: 'WITHDRAW',
            clearingSourceType: 'WITHDRAWAL',
          },
          tx,
        );
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );
      }

      await this.clearingsService.updateStatusBySource(
        'WITHDRAWAL',
        withdrawId,
        'CANCELLED',
        tx,
      );

      const log = await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.SYSTEM_EVENT,
          action: AuditActions.SYSTEM_WITHDRAW_TERMINAL_ORCHESTRATED,
          module: AuditModules.WITHDRAW_WORKFLOW,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: withdrawId,
          entityNo: accountingWithdrawal.withdrawNo,
          entityOwnerType: accountingWithdrawal.ownerType,
          entityOwnerId: accountingWithdrawal.ownerId,
          statusFrom: currentWithdrawal.status,
          statusTo: accountingWithdrawal.status,
          reason: marker,
          beforeData: { status: currentWithdrawal.status },
          afterData: {
            status: accountingWithdrawal.status,
            payoutStatus,
            payoutId,
            compensationTargetStatus: targetWithdrawStatus,
          },
          metadata: {
            payoutId,
            payoutStatus,
            compensationTargetStatus: targetWithdrawStatus,
            repairReplay: currentWithdrawal.status === targetWithdrawStatus,
          },
          idempotencyKey: marker,
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
      result.audit_log_id = log.id;

      return result;
    });
  }

  private buildNoopCloseoutResult(
    withdrawStatus?: string,
    payoutStatus?: string,
  ): OrchestrationResult {
    return {
      updated_withdrawal_status: withdrawStatus,
      updated_payout_status: payoutStatus,
      payout_binding_status: 'unchanged',
      emitted_events: [],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
      repairApplied: false,
    };
  }

  private buildNoopCompensationResult(
    withdrawStatus?: string,
    payoutStatus?: string,
  ): OrchestrationResult {
    return {
      updated_withdrawal_status: withdrawStatus,
      updated_payout_status: payoutStatus,
      payout_binding_status: 'unchanged',
      emitted_events: [],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
      repairApplied: false,
    };
  }

  private collectJournalIds(posting: JournalPostingResult): string[] {
    if (!posting) return [];
    if (Array.isArray(posting)) {
      return posting
        .filter((item): item is { id?: string | null } => Boolean(item))
        .flatMap((item) => (item.id ? [item.id] : []));
    }
    return posting.id ? [posting.id] : [];
  }

  private createAccountingContext(withdrawal: WithdrawalForOrchestration) {
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

  private async ensureSourceWalletBound(
    tx: Prisma.TransactionClient,
    withdrawal: WithdrawalForOrchestration,
    suffix: 'CRYPTO' | 'FIAT',
  ) {
    if (withdrawal.fromWalletId) {
      return withdrawal;
    }

    const asset = withdrawal.asset;
    if (!asset) {
      throw new BadRequestException(
        `Asset is missing for withdrawal ${withdrawal.id}`,
      );
    }
    if (!asset.code) {
      throw new BadRequestException(
        `Asset code is missing for withdrawal ${withdrawal.id}`,
      );
    }

    const walletNo =
      suffix === 'CRYPTO'
        ? buildCryptoSystemWalletNo('PAYOUT', asset.code, asset.network)
        : buildFiatPoolWalletNo('CUST_BANK', asset.code);
    const ownerType = 'CUSTOMER';

    const sourceWallet = (await tx.wallet.findFirst({
      where: {
        walletNo,
        ownerType,
        ownerId: null,
        assetId: withdrawal.assetId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        walletNo: true,
        address: true,
        iban: true,
      },
    })) as SourceWalletProjection | null;

    if (!sourceWallet) {
      throw new BadRequestException(
        `Source wallet ${walletNo} not found for withdrawal ${withdrawal.id}`,
      );
    }

    const updated = await tx.withdrawTransaction.update({
      where: { id: withdrawal.id },
      data: {
        fromWalletId: sourceWallet.id,
        fromWalletNo: sourceWallet.walletNo ?? walletNo,
        fromAddress: sourceWallet.address ?? null,
        fromIban: sourceWallet.iban ?? null,
      },
      include: {
        asset: {
          select: {
            type: true,
            code: true,
            network: true,
          },
        },
      },
    });

    return updated;
  }
}

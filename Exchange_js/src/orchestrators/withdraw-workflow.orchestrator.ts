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
import { AuditLogsService } from '../modules/risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../modules/risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../modules/risk-engine/audit-logs/dto/audit-log.dto';
import { AccountingEventExecutionService } from './accounting-event-execution.service';

export interface OrchestrationResult {
  updated_withdrawal_status?: string;
  updated_payout_status?: string;
  payout_binding_status: 'created' | 'bound' | 'unchanged';
  emitted_events: string[];
  created_or_reversed_journal_entry_ids: string[];
  audit_log_id: string;
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
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private prisma: PrismaService,
    private withdrawalService: WithdrawTransactionsService,
    private payoutsService: PayoutsService,
    private accountingEventExecutionService: AccountingEventExecutionService,
    private clearingsService: ClearingsService,
    private transactionComplianceService: TransactionComplianceService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

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
      await this.transactionComplianceService.ensureWithdrawMainCasesOnPayoutConfirmed(
        withdrawId,
        payoutId,
        tx,
      );

      const updatedWithdrawal = await this.withdrawalService.updateStatus(withdrawId, {
        action: WithdrawTransactionAction.SUCCESS,
        reason: `[${marker}] Payout confirmed. Setting withdrawal to SUCCESS.`,
      }, tx);
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

    const marker = this.markerForPayoutResult(withdrawId, payoutId, status);
    if (await this.checkIdempotency(withdrawId, marker)) {
      this.logger.warn(`Payout result ${status} for ${withdrawId} already processed.`);
      return null;
    }

    const withdrawal = await this.withdrawalService.findOne(withdrawId);
    if (status !== PayoutStatus.RETURNED && withdrawal.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(`Withdrawal ${withdrawId} is not in PAYOUT_PENDING. Skipping back-propagation.`);
      return null;
    }
    if (
      status === PayoutStatus.RETURNED &&
      withdrawal.status !== WithdrawTransactionStatus.SUCCESS &&
      withdrawal.status !== WithdrawTransactionStatus.RETURNED
    ) {
      this.logger.warn(`Withdrawal ${withdrawId} is not in SUCCESS/RETURNED for returned flow.`);
      return null;
    }
    if (status === PayoutStatus.RETURNED && withdrawal.status === WithdrawTransactionStatus.RETURNED) {
      this.logger.warn(`Withdrawal ${withdrawId} already RETURNED. Skip repeated return event.`);
      return null;
    }

    const isCustomer = withdrawal.ownerType === 'CUSTOMER';
    const suffix = this.getSuffix(withdrawal);
    const result: OrchestrationResult = {
      payout_binding_status: 'unchanged',
      emitted_events: [status],
      created_or_reversed_journal_entry_ids: [],
      audit_log_id: '',
    };

    const isReturn = status === PayoutStatus.RETURNED;
    await this.prisma.$transaction(async (tx) => {
      const updatedWithdrawal = await this.withdrawalService.updateStatus(
        withdrawId,
        {
          action: isReturn
            ? WithdrawTransactionAction.RETURN
            : WithdrawTransactionAction.FAIL,
          reason: `[${marker}] Payout ${payoutId} ${status.toLowerCase()}.`,
        },
        tx,
      );
      result.updated_withdrawal_status = updatedWithdrawal.status;

      if (isCustomer) {
        const execution = await this.accountingEventExecutionService.execute(
          {
            entityType: 'WITHDRAW',
            triggerKey: 'status',
            toStatus: updatedWithdrawal.status,
            assetType: suffix,
            frozenContext: this.createAccountingContext(updatedWithdrawal),
            sourceId: updatedWithdrawal.id,
            journalSourceType: 'WITHDRAW',
            clearingSourceType: 'WITHDRAWAL',
          },
          tx,
        );
        result.created_or_reversed_journal_entry_ids.push(
          ...this.collectJournalIds(execution.journalResult),
        );
      }

      await this.clearingsService.updateStatusBySource(withdrawId, 'CANCELLED', tx);
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
          afterData: { status: updatedWithdrawal.status, payoutStatus: status },
          idempotencyKey: marker,
          sourcePlatform: 'SYSTEM',
        },
        tx,
      );
      result.audit_log_id = log.id;
    });

    this.logger.log(`Orchestration Result: ${JSON.stringify(result)}`);
    return result;
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

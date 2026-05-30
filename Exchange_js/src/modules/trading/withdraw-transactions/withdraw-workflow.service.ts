import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { PayoutsService } from '../../asset-treasury/payouts/payouts.service';
import { PayoutAction } from '../../asset-treasury/payouts/dto/payout.dto';

@Injectable()
export class WithdrawWorkflowService implements OnModuleInit {
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);

  private readonly logger = new Logger(WithdrawWorkflowService.name);

  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    @Inject(forwardRef(() => PayoutsService))
    private readonly payoutsService: PayoutsService,
  ) {}

  onModuleInit() {
    this.logger.log('WithdrawWorkflowService initialized and listening for events.');
  }

  // ── Event Handlers ──

  @OnEvent(DomainEventNames.WITHDRAWAL_CREATED)
  async handleWithdrawalCreated(event: {
    withdrawId: string;
    withdrawNo: string;
    status: string;
    ownerType: string;
    ownerId: string;
    assetId: string;
    amount: string;
    traceId: string;
  }) {
    this.logger.log(`Orchestrating new withdrawal ${event.withdrawId}`);

    const gate0Pass = await this.runGate0(event.withdrawId);
    if (!gate0Pass) return;

    await this.initializeComplianceGates(event.withdrawId);
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_KYT_UPDATED)
  async handleKytUpdated(event: {
    withdrawId: string;
    kytStatus: string;
    phase: number;
  }) {
    this.logger.log(`KYT updated for withdrawal ${event.withdrawId}: phase=${event.phase} status=${event.kytStatus}`);

    if (event.phase === 1) {
      // Pre-broadcast KYT — check if pre-KYT + TR both pass → move to payout
      await this.checkAllGatesPass(event.withdrawId);
    } else if (event.phase === 2) {
      // Post-broadcast KYT — payout already in flight, just audit
      await this.handlePostBroadcastKyt(event.withdrawId, event.kytStatus);
    }
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_TRAVELRULE_UPDATED)
  async handleTravelRuleUpdated(event: {
    withdrawId: string;
    travelRuleStatus: string;
  }) {
    this.logger.log(`Travel Rule updated for withdrawal ${event.withdrawId}: status=${event.travelRuleStatus}`);
    await this.checkAllGatesPass(event.withdrawId);
  }

  @OnEvent(DomainEventNames.PAYOUT_STATUS_CONFIRMED)
  async handlePayoutConfirmed(event: {
    payoutId: string;
    withdrawId: string;
    txHash: string;
  }) {
    this.logger.log(`Payout confirmed for withdrawal ${event.withdrawId}`);
    await this.finalizeWithdrawal(event.withdrawId);
  }

  // ── Gate 0: Customer Compliance Status ──

  private async runGate0(withdrawId: string): Promise<boolean> {
    const complianceStatus = await this.withdrawService.getOwnerComplianceStatus(withdrawId);

    if (WithdrawWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(`Gate 0 FAIL: withdrawal ${withdrawId} — customer compliance: ${complianceStatus}`);
      return false;
    }

    this.logger.log(`Gate 0 PASS: withdrawal ${withdrawId}`);

    const w = await this.withdrawService.findOneInternal(withdrawId);
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_GATE0_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Customer compliance status: ${complianceStatus}`,
      sourcePlatform: 'SYSTEM',
    });

    return true;
  }

  // ── Gate 1 + Gate 2: Initialize Compliance Gates ──

  private async initializeComplianceGates(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    const isFiat = w.asset?.type === 'FIAT';

    if (isFiat) {
      // Fiat withdrawals skip KYT and Travel Rule — auto-pass both gates
      await this.withdrawService.updateKytStatus(withdrawId, 'PASSED', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'NOT_REQUIRED', null);
      this.logger.log(`Compliance gates auto-passed for fiat withdrawal ${withdrawId}`);
    } else {
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);
      this.logger.log(`Compliance gates initialized for withdrawal ${withdrawId} — awaiting KYT Phase 1 + Travel Rule`);
    }

    // Re-check gates — for fiat this will immediately pass and move to payout phase
    await this.checkAllGatesPass(withdrawId);
  }

  // ── Gate Convergence Check ──

  private async checkAllGatesPass(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    if (w.status !== WithdrawTransactionStatus.PENDING_COMPLIANCE) {
      this.logger.debug(`Skip gate check: withdrawal ${withdrawId} status is ${w.status}`);
      return;
    }

    const gate1Phase1Pass = w.preKytStatus === 'PASSED';
    const gate2Pass = w.travelRuleStatus === 'PASSED' || w.travelRuleStatus === 'NOT_REQUIRED';

    if (!gate1Phase1Pass || !gate2Pass) {
      this.logger.debug(
        `Gates not yet all passed for ${withdrawId}: preKyt=${w.preKytStatus} tr=${w.travelRuleStatus}`,
      );
      return;
    }

    this.logger.log(`Pre-broadcast gates PASSED for withdrawal ${withdrawId} — initiating payout phase`);

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_KYT_PHASE1_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Pre-KYT passed: score=${w.preKytRiskScore}`,
      sourcePlatform: 'SYSTEM',
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_TRAVEL_RULE_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Travel Rule status: ${w.travelRuleStatus}`,
      sourcePlatform: 'SYSTEM',
    });

    await this.initiatePayoutPhase(withdrawId);
  }

  // ── Payout Phase ──

  private async initiatePayoutPhase(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    await this.withdrawService.updateStatus(w.id, {
      action: WithdrawTransactionAction.APPROVE,
    }, {
      source: 'WORKFLOW',
      actorType: 'SYSTEM',
      actorId: 'WITHDRAW_WORKFLOW',
      sourcePlatform: 'SYSTEM',
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_COMPLIANCE_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'Pre-broadcast compliance gates passed, payout initiated',
      sourcePlatform: 'SYSTEM',
    });

    // Auto-create payout record and link back to withdrawal
    const payoutType = w.asset?.type === 'CRYPTO' ? 'CRYPTO' : 'FIAT';
    const payout = await this.payoutsService.create({
      withdrawId: w.id,
      type: payoutType as any,
      amount: Number(w.netAmount),
      assetId: w.assetId,
      toWalletId: w.toWalletId || undefined,
      toAddress: w.toAddress || undefined,
      toIban: w.toIban || undefined,
    }, 'SYSTEM');

    await this.withdrawService.linkPayout(w.id, payout.id, payout.payoutNo);

    this.logger.log(`Withdrawal ${withdrawId} now PAYOUT_PENDING — payout ${payout.payoutNo} created`);
  }

  // ── Post-Broadcast KYT (Phase 2): after payout is in-flight ──

  private async handlePostBroadcastKyt(withdrawId: string, kytStatus: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_KYT_PHASE1_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Post-broadcast KYT completed: status=${kytStatus} score=${w.kytRiskScore}`,
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Post-broadcast KYT recorded for withdrawal ${withdrawId}: ${kytStatus}`);
  }

  // ── Finalization: TB POST on chain confirmation ──

  private async finalizeWithdrawal(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(`Cannot finalize withdrawal ${withdrawId}: status is ${w.status}`);
      return;
    }

    const decimals = w.asset?.decimals ?? 8;

    // POST pending transfer #1: net amount
    if (w.tbPendingNetId) {
      const pendingNetBigint = hexToBigint(w.tbPendingNetId);
      const netBigint = this.decimalToBigint(w.netAmount, decimals);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingNetBigint,
        amount: netBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_POST_NET',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          creditCode: String(w.asset?.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY),
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: w.asset?.type === 'FIAT'
            ? 'Bank transfer confirmed: POST net pending transfer'
            : 'Chain confirmed: POST net pending transfer',
        },
      });
    }

    // POST pending transfer #2: fee amount
    if (w.tbPendingFeeId) {
      const pendingFeeBigint = hexToBigint(w.tbPendingFeeId);
      const feeBigint = this.decimalToBigint(w.feeAmount, decimals);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingFeeBigint,
        amount: feeBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_POST_FEE',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE),
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Chain confirmed: POST fee pending transfer',
        },
      });
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_ACCOUNTING_POSTED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: w.asset?.type === 'FIAT'
        ? 'TB pending transfers posted after bank confirmation'
        : 'TB pending transfers posted after chain confirmation',
      sourcePlatform: 'SYSTEM',
    });

    await this.withdrawService.updateStatus(w.id, {
      action: WithdrawTransactionAction.SUCCESS,
    }, {
      source: 'WORKFLOW',
      actorType: 'SYSTEM',
      actorId: 'WITHDRAW_WORKFLOW',
      sourcePlatform: 'SYSTEM',
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SUCCESS,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'Withdrawal completed successfully',
      sourcePlatform: 'SYSTEM',
    });

    // Clear the linked payout (internal accounting settled)
    if (w.payoutId) {
      try {
        await this.payoutsService.updateStatus(w.payoutId, {
          action: PayoutAction.CLEAR,
          reason: 'Internal accounting completed after chain confirmation',
        }, 'SYSTEM');
      } catch (err) {
        this.logger.warn(`Payout CLEAR failed for ${w.payoutId}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Withdrawal ${withdrawId} finalized: TB posted, status SUCCESS`);
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }
}

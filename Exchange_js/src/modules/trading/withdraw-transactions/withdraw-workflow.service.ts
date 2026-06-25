import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { PayoutsService } from '../../asset-treasury/payouts/payouts.service';
import { PayoutAction } from '../../asset-treasury/payouts/dto/payout.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import {
  shouldRequireApproval,
  SYSTEM_APPROVAL_ACTOR,
} from './constants/withdraw-approval.constant';
import { FundTransferWorkflowService } from '../../funds-layer/workflow/fund-transfer-workflow.service';

@Injectable()
export class WithdrawWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WithdrawWorkflowService.name);
  private readonly systemCtx = {
    source: 'WORKFLOW' as const,
    actorType: 'SYSTEM',
    actorId: 'WITHDRAW_WORKFLOW',
    sourcePlatform: 'SYSTEM',
  };

  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    @Inject(forwardRef(() => PayoutsService))
    private readonly payoutsService: PayoutsService,
    private readonly approvalsService: ApprovalsService,
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly fundTransferWorkflow: FundTransferWorkflowService,
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
    try {
      const w = await this.withdrawService.findOneInternal(event.withdrawId);
      if (w.status !== WithdrawTransactionStatus.CREATED) {
        this.logger.debug(`Skip branch: withdrawal ${event.withdrawId} already ${w.status}`);
        return;
      }

      const valuation = await this.valuateAed(w);
      await this.withdrawService.saveValuationSnapshot(w.id, valuation);

      if (shouldRequireApproval(valuation)) {
        await this.openApprovalGate(w, valuation);
      } else {
        this.logger.log(`Withdrawal ${event.withdrawId} below approval threshold — proceeding to compliance`);
        await this.withdrawService.updateStatus(
          w.id,
          { action: WithdrawTransactionAction.CHECK },
          this.systemCtx,
        );
        await this.initializeTransactionScreen(w.id);
      }
    } catch (err) {
      this.logger.error(`handleWithdrawalCreated failed for ${event.withdrawId}: ${(err as Error).message}`);
      throw err;
    }
  }

  private async valuateAed(w: {
    amount: Prisma.Decimal | string;
    asset?: { currency?: string | null } | null;
  }): Promise<{
    grossAedValue: Prisma.Decimal | null;
    aedRate: Prisma.Decimal | null;
    rateFetchedAt: Date | null;
    rateFetchFailed: boolean;
  }> {
    const currency = w.asset?.currency || '';
    try {
      const amount = new Prisma.Decimal(w.amount);
      const r = await this.binanceRateProvider.fetchRate(currency, 'AED');
      return {
        grossAedValue: amount.mul(r.rate),
        aedRate: r.rate,
        rateFetchedAt: r.fetchedAt,
        rateFetchFailed: false,
      };
    } catch (err) {
      this.logger.warn(`AED valuation failed for ${currency}: ${(err as Error).message} — fail-closed to approval`);
      return { grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: true };
    }
  }

  private async openApprovalGate(
    w: { id: string; withdrawNo: string; ownerType: string; ownerId: string; traceId: string | null },
    valuation: { grossAedValue: Prisma.Decimal | null; rateFetchFailed: boolean },
  ) {
    try {
      const approval = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL,
          entityRef: w.id,
          traceId: w.traceId || undefined,
          objectSnapshot: {
            withdrawNo: w.withdrawNo,
            ownerType: w.ownerType,
            ownerId: w.ownerId,
            grossAedValue: valuation.grossAedValue?.toString() || null,
            rateFetchFailed: valuation.rateFetchFailed,
          },
        },
        { reason: `Withdrawal ${w.withdrawNo} ≥ 200000 AED — senior management approval required`, traceId: w.traceId || undefined },
        SYSTEM_APPROVAL_ACTOR,
      );

      await this.withdrawService.linkApprovalCase(w.id, approval.id, approval.approvalNo);

      // Flip to PENDING_APPROVAL only AFTER the case exists and is linked, so a partial
      // failure leaves the withdrawal cleanly in CREATED (funds locked, retriable) and
      // never stuck in PENDING_APPROVAL with no approval case.
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.REQUIRE_APPROVAL },
        this.systemCtx,
      );

      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Large-value approval requested (case ${approval.approvalNo})`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Withdrawal ${w.id} now PENDING_APPROVAL — approval ${approval.approvalNo} opened`);
    } catch (err) {
      this.logger.error(`openApprovalGate failed for ${w.id} — left in CREATED for retry: ${(err as Error).message}`);
      throw err;
    }
  }

  @OnEvent('workflow.withdraw-large-value-approval.decided', { async: true })
  async onLargeValueApprovalDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    const w = await this.withdrawService.findOneInternal(payload.entityRef);
    if (w.status !== WithdrawTransactionStatus.PENDING_APPROVAL) {
      this.logger.debug(`Skip decided: withdrawal ${payload.entityRef} is ${w.status}, not PENDING_APPROVAL`);
      return;
    }

    if (payload.decision === 'APPROVED') {
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.GATE_APPROVE },
        this.systemCtx,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_APPROVAL_GRANTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Large-value approval granted (case ${payload.approvalNo}) — proceeding to compliance`,
        sourcePlatform: 'SYSTEM',
      });
      await this.initializeTransactionScreen(w.id);
    } else {
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.REJECT, reason: `Approval ${payload.decision}: ${payload.decisionReason || 'no reason'}` },
        this.systemCtx,
      );
      await this.voidWithdrawPending(w);
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_APPROVAL_DECLINED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Large-value approval ${payload.decision} (case ${payload.approvalNo}) — pending lock voided`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async voidWithdrawPending(w: {
    id: string;
    netAmount: Prisma.Decimal | string;
    feeAmount: Prisma.Decimal | string;
    tbPendingNetId: string | null;
    tbPendingFeeId: string | null;
    asset?: { decimals?: number | null } | null;
  }) {
    const decimals = w.asset?.decimals ?? 8;
    if (w.tbPendingNetId) {
      const voided = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingNetId),
        this.decimalToBigint(w.netAmount, decimals),
      );
      if (!voided) {
        this.logger.error(`CRITICAL: failed to void net pending transfer for withdrawal ${w.id} on rejection — funds may stay locked`);
      }
    }
    if (w.tbPendingFeeId) {
      const voided = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingFeeId),
        this.decimalToBigint(w.feeAmount, decimals),
      );
      if (!voided) {
        this.logger.error(`CRITICAL: failed to void fee pending transfer for withdrawal ${w.id} on rejection — funds may stay locked`);
      }
    }
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
      await this.checkScreenPass(event.withdrawId);
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
    await this.checkScreenPass(event.withdrawId);
  }

  @OnEvent(DomainEventNames.PAYOUT_STATUS_CONFIRMED)
  async handlePayoutConfirmed(event: {
    payoutId: string;
    withdrawId: string;
    txHash: string;
  }) {
    this.logger.log(`Payout confirmed for withdrawal ${event.withdrawId}`);
    await this.finalizeWithdrawal(event.withdrawId);

    // L3: Post-Tx Archive — fire-and-forget txHash archival (crypto only)
    const w = await this.withdrawService.findOneInternal(event.withdrawId);
    if (w.asset?.type !== 'FIAT' && w.txHash) {
      this.archivePostKyt(w).catch(err =>
        this.logger.warn(`Post-KYT archive failed for ${event.withdrawId}: ${(err as Error).message}`),
      );
    }
  }

  // ── L2: Transaction Screen — Initialize ──

  private async initializeTransactionScreen(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    const isFiat = w.asset?.type === 'FIAT';

    if (isFiat) {
      // Fiat: Pre-KYT screens IBAN + BIC + beneficiary; Travel Rule not applicable
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'NOT_REQUIRED', null);
      this.logger.log(`Transaction screen initialized for fiat withdrawal ${withdrawId} — awaiting Pre-KYT`);
    } else {
      // Crypto: Pre-KYT screens wallet address; Travel Rule screens VASP beneficiary
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);
      this.logger.log(`Transaction screen initialized for crypto withdrawal ${withdrawId} — awaiting Pre-KYT + Travel Rule`);
    }

    await this.checkScreenPass(withdrawId);
  }

  // ── L2: Transaction Screen — Convergence Check ──

  private async checkScreenPass(withdrawId: string) {
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

    // V7 Phase 2: 付款前 Main→Outbound 预归集（FUND_OUT，跟踪转账，crypto only，非阻塞）
    if (w.asset?.type === 'CRYPTO') {
      try {
        await this.fundTransferWorkflow.fundOut(
          { withdrawId: w.id, withdrawNo: w.withdrawNo, assetId: w.assetId, netAmount: String(w.netAmount) },
          'WITHDRAW_WORKFLOW',
        );
      } catch (err) {
        this.logger.error(
          `FUND_OUT failed for withdrawal ${w.id} (non-blocking)`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

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

    // POST pending transfer #1: net amount (CLIENT_PAYABLE → CLIENT_ASSET, real-time 1:1)
    if (w.tbPendingNetId) {
      const pendingNetBigint = hexToBigint(w.tbPendingNetId);
      const netBigint = this.decimalToBigint(w.netAmount, decimals);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingNetBigint,
        amount: netBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_NET_POST',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Payout confirmed: POST net pending transfer → CLIENT_ASSET',
        },
      });
    }

    // POST pending transfer #2: client-side fee (CLIENT_PAYABLE → CLIENT_ASSET, real-time 1:1)
    const feeBigint = this.decimalToBigint(w.feeAmount, decimals);
    if (w.tbPendingFeeId) {
      const pendingFeeBigint = hexToBigint(w.tbPendingFeeId);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingFeeBigint,
        amount: feeBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_FEE_POST',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Payout confirmed: POST fee pending transfer → CLIENT_ASSET',
        },
      });
    }

    // Firm-side fee collect: DR FIRM_ASSET / CR FIRM_FEE (direct transfer, same ledger as asset)
    if (feeBigint > 0n && w.asset?.currency) {
      const ledger = TB_LEDGERS[w.asset.currency as keyof typeof TB_LEDGERS];
      if (ledger) {
        const firmAssetId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.FIRM_ASSET,
          ledger,
          ownerType: 'SYSTEM',
        });
        const firmFeeId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.FIRM_FEE,
          ledger,
          ownerType: 'SYSTEM',
        });
        await this.accountingService.executeTransfer({
          debitAccountId: firmAssetId,
          creditAccountId: firmFeeId,
          amount: feeBigint,
          ledger,
          code: TB_TRANSFER_CODES.WITHDRAW_FEE_FIRM,
          evidence: {
            sourceType: 'WITHDRAWAL',
            sourceNo: w.withdrawNo,
            eventCode: 'WITHDRAW_FEE_FIRM',
            debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET],
            creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE],
            assetCurrency: w.asset.currency,
            traceId: w.traceId || w.id,
            actorType: 'SYSTEM',
            actorId: 'WITHDRAW_WORKFLOW',
            memo: 'Firm-side fee collect: FIRM_ASSET → FIRM_FEE',
          },
        });
      }
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

  // ── L3: Post-Tx Archive — fire-and-forget ──

  private async archivePostKyt(withdrawal: {
    id: string;
    withdrawNo: string;
    txHash: string | null;
  }): Promise<void> {
    // Stub: when Sumsub KYT is integrated, this becomes a PATCH /kyt/txns/{id}/data/info
    // to archive the txHash for on-chain tracing.
    this.logger.log(
      `Post-KYT archive stub: withdrawal ${withdrawal.withdrawNo} txHash=${withdrawal.txHash}`,
    );
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }
}

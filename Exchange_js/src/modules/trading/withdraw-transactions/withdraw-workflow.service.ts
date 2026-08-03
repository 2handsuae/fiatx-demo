import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import {
  CreateWithdrawTransactionDto,
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { bigintToHex, hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';
import { WalletRole } from '../../asset-treasury/wallets/dto/wallet.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import {
  shouldRequireApproval,
  SYSTEM_APPROVAL_ACTOR,
} from './constants/withdraw-approval.constant';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import {
  TransactionLimitGateService,
  GateValuation,
} from '../../asset-treasury/transaction-limits/transaction-limit-gate.service';
import { TransactionLimitRulesService } from '../../asset-treasury/transaction-limits/transaction-limit-rules.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import {
  FundsOrderAction,
  FundsOrderStatus,
} from '../../funds-orders/dto/funds-order.dto';

/**
 * Payload of `funds_order.status.changed` — emitted by FundsOrderService on
 * every create/advance. The withdraw workflow filters on
 * `parent.withdrawTransactionId` to react to its own payout / fee legs only.
 */
interface FundsOrderStatusChangedEvent {
  fundsOrderId: string;
  fundsOrderNo: string;
  parent: {
    depositTransactionId?: string;
    withdrawTransactionId?: string;
    swapTransactionId?: string;
  };
  legSeq: number;
  attempt: number;
  oldStatus: string | null;
  newStatus: string;
  traceId?: string;
  effectiveDate?: string; // 平账推单回填的业务归属日；普通实时流转恒为 undefined
}

// legSeq convention for a withdrawal's funds orders (spec §2):
//   1 = payout principal (net) leg, 2 = fee leg.
const PAYOUT_LEG_SEQ = 1;
const FEE_LEG_SEQ = 2;

/**
 * R4: Thrown when a withdrawal's source wallet does not satisfy the
 * "customer-owned source" invariant:
 *   FIAT  → walletRole = C_VIBAN, ownerType = CUSTOMER, ownerId = withdrawal.ownerId
 *   CRYPTO → walletRole = C_DEP,  ownerType = CUSTOMER, ownerId = withdrawal.ownerId
 *
 * Surfaces the seed/data gap explicitly instead of silently attaching the
 * customer's outflow to a platform pool wallet (the previous behaviour for
 * FIAT withdrawals — see git blame on this file for the C_CMA regression).
 * Extends BadRequestException so it serialises to a 400 over HTTP without any
 * additional handler wiring.
 */
export class IllegalSourceWalletError extends BadRequestException {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalSourceWalletError';
  }
}

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
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly withdrawQuoteService: WithdrawQuoteService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    private readonly fundsOrders: FundsOrderService,
    private readonly approvalsService: ApprovalsService,
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly systemWalletResolver: SystemWalletResolver,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly limitGateService: TransactionLimitGateService,
    private readonly limitRulesService: TransactionLimitRulesService,
  ) {}

  // Phase B helper: resolve the platform's F_FEE wallet id for an asset, used
  // as creditWalletRef on FIRM-side fee rows. Returns null on miss (best-effort
  // — the evidence row still records correctly, recon just can't pair by wallet).
  private async resolveFirmFeeWalletRef(assetId: string): Promise<string | null> {
    try {
      const wallet = await this.systemWalletResolver.resolve(assetId, 'F_FEE');
      return wallet?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `F_FEE wallet not found for asset ${assetId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  onModuleInit() {
    this.logger.log('WithdrawWorkflowService initialized and listening for events.');
  }

  // ── Atomic create + balance-lock (owned by the workflow) ──

  /**
   * Orchestrate withdrawal creation. Opens the Prisma $transaction that
   * atomically: inserts the row (via domain), locks the customer balance in TB
   * (2 pending transfers), and records the first audit (WITHDRAW_REQUESTED).
   * Emits WITHDRAWAL_CREATED after commit. TB pending transfers are voided
   * best-effort if the Prisma transaction rolls back (TB is a separate system).
   */
  async createWithdrawal(
    dto: CreateWithdrawTransactionDto,
    userId: string,
    ownerType: string = 'CUSTOMER',
  ) {
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

    // Resolve owner number inline (no PricingCenterService dependency)
    let ownerNo: string | null = null;
    if (ownerType === 'CUSTOMER') {
      const cust = await (this.prisma as any).customerMain.findUnique({ where: { id: userId }, select: { customerNo: true } });
      ownerNo = cust?.customerNo || null;
    }

    const amountDecimal = new Prisma.Decimal(amount);
    if (!quoteId) {
      throw new BadRequestException('quoteId is required for withdrawal');
    }

    // ── L1 Transaction Limit gate (A single min/max + B cumulative) ──
    // Rejects BEFORE order persist & quote consumption; returns AED valuation for the row.
    let gateValuation: GateValuation | null = null;
    if (ownerType === 'CUSTOMER') {
      gateValuation = await this.limitGateService.evaluate({
        operationType: 'WITHDRAWAL',
        customerId: userId,
        assetId,
        amount: amountDecimal,
      });
    }

    // Track TB pending transfer IDs in outer scope for compensation on failure.
    // If the Prisma transaction rolls back, we must void any TB transfers that
    // were already created (TB is a separate system, not part of the SQL tx).
    let tbPendingNetBigint: bigint | undefined;
    let tbPendingFeeBigint: bigint | undefined;
    let netBigintForVoid: bigint = 0n;
    let feeBigintForVoid: bigint = 0n;

    let created: any;
    try {
      created = await (this.prisma as any).$transaction(
        async (tx: any) => {

          let quoteFeeAmount = new Prisma.Decimal(0);
          let consumedQuoteId: string | null = null;
          const now = new Date();
          const activeQuote = await this.withdrawQuoteService.getActiveQuoteOrThrow(
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
          await this.withdrawQuoteService.consumeQuote(
            quoteId,
            ownerType,
            userId,
            amountDecimal,
            tx,
          );

          const netAmount = amountDecimal.sub(quoteFeeAmount);
          if (netAmount.lt(0)) {
            throw new BadRequestException('Net amount must not be negative');
          }

          const traceId = randomUUID();

          const isCryptoWithdraw = String(asset.type || '').toUpperCase() !== 'FIAT';
          // NOTE: isCryptoWithdraw is retained for compliance-field branching below;
          // TB accounting no longer branches by asset type (both use CLIENT_ASSET).

          const record = await this.withdrawService.insertRecord(tx, {
            withdrawNo,
            ownerType,
            ownerId: userId,
            ownerNo,
            // Birth state under the 10-state/20-edge rewrite (Task 1): PENDING_APPROVAL
            // has zero incoming edges, so a withdrawal is created directly on it.
            status: WithdrawTransactionStatus.PENDING_APPROVAL,
            assetId,
            amount: amountDecimal,
            netAmount,
            feeAmount: quoteFeeAmount,
            toWalletId,
            toAddress,
            toIban,
            preKytStatus: isCryptoWithdraw ? 'PENDING' : '',
            kytStatus: '',
            travelRuleRequired: isCryptoWithdraw,
            travelRuleStatus: isCryptoWithdraw ? 'PENDING' : '',
            complianceStatus: 'PENDING',
            traceId,
            grossAedValue: gateValuation?.grossAedValue ?? undefined,
            aedRate: gateValuation?.aedRate ?? undefined,
            rateFetchedAt: gateValuation?.rateFetchedAt ?? undefined,
            rateFetchFailed: gateValuation?.rateFetchFailed ?? undefined,
            parentType,
            parentId,
            pricingQuoteId: consumedQuoteId,
            statusHistory: JSON.stringify([{
              status: WithdrawTransactionStatus.PENDING_APPROVAL,
              timestamp: new Date().toISOString(),
              operator: 'SYSTEM',
              note: 'Withdrawal created — awaiting approval-gate valuation'
            }]),
          });

          // TB: create 2 pending transfers — lock customer balance
          // Real-time 1:1 model: both net and fee lock into CLIENT_ASSET (no crypto/fiat branch).
          const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
          if (ledger && ownerType === 'CUSTOMER') {
            const clientPayableId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
              ledger,
              ownerType: 'CUSTOMER',
              ownerUuid: userId,
            });
            const clientAssetId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.CLIENT_ASSET,
              ledger,
              ownerType: 'SYSTEM',
            });

            const netBigint = this.decimalToBigint(netAmount, asset.decimals);
            const feeBigint = this.decimalToBigint(quoteFeeAmount, asset.decimals);

            // Phase B per-physical-wallet recon: the customer's source wallet
            // (vIBAN / C_OUT crypto wallet) is on the withdrawal record. Both legs
            // of a pending lock sit on the same wallet — pending is a pre-occupation,
            // not yet a real external crossing (the crossing happens on POST). At
            // create-time fromWalletId is often null (orchestrator binds it later);
            // that's fine — LOCK rows simply carry null and don't fail recon.
            const walletRef: string | null = record.fromWalletId ?? null;

            const evidenceBase = {
              sourceType: 'WITHDRAWAL',
              sourceNo: withdrawNo,
              debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
              creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
              assetCurrency: asset.currency,
              traceId,
              actorType: ownerType,
              actorId: userId,
              // Phase B: LOCK rows are pure ledger pre-occupation — same wallet on
              // both legs, no external statement entry, not a real-world crossing.
              debitWalletRef: walletRef,
              creditWalletRef: walletRef,
              externalRef: null,
              isExternalCrossing: false,
            };

            // Pending #1: net amount CLIENT_PAYABLE → CLIENT_ASSET (pending)
            const { tbTransferId: pendingNetId } = await this.accountingService.executePendingTransfer({
              debitAccountId: clientPayableId,
              creditAccountId: clientAssetId,
              amount: netBigint,
              ledger,
              code: TB_TRANSFER_CODES.WITHDRAW_NET_PENDING,
              timeout: 0,
              evidence: {
                ...evidenceBase,
                eventCode: 'WITHDRAW_LOCK_NET',
                memo: 'Withdrawal pending lock: net amount',
              },
              tx,
            });
            tbPendingNetBigint = pendingNetId;
            netBigintForVoid = netBigint;

            // Pending #2: fee amount CLIENT_PAYABLE → CLIENT_ASSET (pending).
            // Posted on payout success (revenue recognised); voided on fail/cancel.
            // Firm-side fee collect (DR FIRM_ASSET / CR FIRM_FEE) fires separately on finalize.
            let pendingFeeId: bigint | undefined;
            if (feeBigint > 0n) {
              const result = await this.accountingService.executePendingTransfer({
                debitAccountId: clientPayableId,
                creditAccountId: clientAssetId,
                amount: feeBigint,
                ledger,
                code: TB_TRANSFER_CODES.WITHDRAW_FEE_PENDING,
                timeout: 0,
                evidence: {
                  ...evidenceBase,
                  eventCode: 'WITHDRAW_LOCK_FEE',
                  memo: 'Withdrawal pending lock: fee amount',
                },
                tx,
              });
              pendingFeeId = result.tbTransferId;
              tbPendingFeeBigint = pendingFeeId;
              feeBigintForVoid = feeBigint;
            }

            // Store pending transfer IDs on the record
            await this.withdrawService.setPendingIds(
              tx,
              record.id,
              bigintToHex(pendingNetId),
              pendingFeeId ? bigintToHex(pendingFeeId) : null,
            );
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

          return record;
        },
        {
          maxWait: 5000,
          timeout: 20000,
        },
      );
    } catch (err) {
      // Compensate: void any orphaned TB pending transfers that survived
      // the Prisma rollback. TB is a separate system so its writes persist.
      if (tbPendingNetBigint) {
        const voided = await this.accountingService.voidPendingTransferBestEffort(tbPendingNetBigint, netBigintForVoid);
        if (voided) {
          this.logger.warn(`Voided orphaned TB net pending transfer ${tbPendingNetBigint} after Prisma rollback`);
        } else {
          this.logger.error(`CRITICAL: Failed to void orphaned TB net pending transfer ${tbPendingNetBigint} — funds may be stuck`);
        }
      }
      if (tbPendingFeeBigint) {
        const voided = await this.accountingService.voidPendingTransferBestEffort(tbPendingFeeBigint, feeBigintForVoid);
        if (voided) {
          this.logger.warn(`Voided orphaned TB fee pending transfer ${tbPendingFeeBigint} after Prisma rollback`);
        } else {
          this.logger.error(`CRITICAL: Failed to void orphaned TB fee pending transfer ${tbPendingFeeBigint} — funds may be stuck`);
        }
      }
      throw err;
    }

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

    return {
      ...created,
      type: String(asset.type || '').toUpperCase() === 'FIAT' ? 'fiat' : 'crypto',
    };
  }

  private generateWithdrawNo(): string {
    return generateReferenceNo('WD');
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
      if (w.status !== WithdrawTransactionStatus.PENDING_APPROVAL) {
        this.logger.debug(`Skip branch: withdrawal ${event.withdrawId} already ${w.status}`);
        return;
      }

      const valuation = await this.valuateAed(w);
      await this.withdrawService.saveValuationSnapshot(w.id, valuation);

      const threshold = await this.limitRulesService.getLargeApprovalThreshold('WITHDRAWAL');
      if (shouldRequireApproval(valuation, threshold)) {
        await this.openApprovalGate(w, valuation, threshold);
      } else {
        this.logger.log(`Withdrawal ${event.withdrawId} below approval threshold — proceeding to compliance`);
        // TASK2-TODO: CHECK action removed by the 10-state/20-edge rewrite (Task 1).
        // There is no longer a compiling transition straight to COMPLIANCE_PENDING
        // here — Task 2 ("出生即着陆") rewrites handleWithdrawalCreated's birth-landing
        // logic against the new state machine (see .superpowers/sdd/task-1-brief.md).
        // await this.withdrawService.updateStatus(
        //   w.id,
        //   { action: WithdrawTransactionAction.CHECK },
        //   this.systemCtx,
        // );
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
    threshold: Prisma.Decimal | null,
  ) {
    const reason = threshold
      ? `Withdrawal ${w.withdrawNo} ≥ ${threshold} AED — senior management approval required`
      : `Withdrawal ${w.withdrawNo} — large-value approval required (fail-closed: threshold unavailable)`;
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
        { reason, traceId: w.traceId || undefined },
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
      await this.releaseLock(w, 'Large-value approval ' + payload.decision);
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

  // The single terminal-unlock primitive: voids the customer's TB pending locks
  // (net + fee) and audits the release. Reused by all terminal-unlock outcomes
  // (approval declined, payout FAILED/TIMEOUT); `reason` parameterizes the audit
  // and the CRITICAL log context.
  //
  // THE P6 FIX (do not weaken): before this existed, a failed payout only flipped
  // status + audited and never voided the pending locks → the customer's balance
  // stayed locked forever. Voiding both TB pending transfers here returns net+fee
  // to the customer's available balance. The fee funds_order (legSeq 2) is a pure
  // representation — no ledger of its own — so it needs no cancel here; the TB
  // void is the whole restitution.
  private async releaseLock(
    w: {
      id: string;
      withdrawNo: string;
      ownerType: string;
      ownerId: string;
      traceId: string | null;
      netAmount: Prisma.Decimal | string;
      feeAmount: Prisma.Decimal | string;
      tbPendingNetId: string | null;
      tbPendingFeeId: string | null;
      asset?: { decimals?: number | null } | null;
    },
    reason: string,
  ) {
    const decimals = w.asset?.decimals ?? 8;
    if (w.tbPendingNetId) {
      const voided = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingNetId),
        this.decimalToBigint(w.netAmount, decimals),
      );
      if (!voided) {
        this.logger.error(`CRITICAL: failed to void net pending transfer for withdrawal ${w.id} (${reason}) — funds may stay locked`);
      }
    }
    if (w.tbPendingFeeId) {
      const voided = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingFeeId),
        this.decimalToBigint(w.feeAmount, decimals),
      );
      if (!voided) {
        this.logger.error(`CRITICAL: failed to void fee pending transfer for withdrawal ${w.id} (${reason}) — funds may stay locked`);
      }
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_LOCK_RELEASED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Lock released: ${reason}`,
      sourcePlatform: 'SYSTEM',
    });
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

  /**
   * Unified funds-order listener (spec §5.2) — replaces the legacy
   * @OnEvent(PAYOUT_STATUS_CONFIRMED) + @OnEvent(EVT_PAYOUT_FAILED/TIMEOUT/RETURNED)
   * handlers. Reacts only to funds orders parented to a withdrawal (payout
   * principal leg = legSeq 1, fee leg = legSeq 2).
   *
   *   CONFIRMED (leg 1) → POST net pending → advance(CLEAR)
   *   CONFIRMED (leg 2) → POST fee pending + firm-fee collect → advance(CLEAR)
   *   CLEARED   (any)   → when ALL legs CLEARED, settle withdraw SUCCESS
   *   FAILED / TIMEOUT (leg 1) → withdraw FAILED + releaseLock (P6 restitution)
   */
  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.withdrawTransactionId) return; // only payout / fee legs
    const withdrawId = event.parent.withdrawTransactionId;
    this.logger.log(
      `Withdrawal ${withdrawId} funds order ${event.fundsOrderNo} (leg ${event.legSeq}) → ${event.newStatus}`,
    );

    switch (event.newStatus) {
      case FundsOrderStatus.CONFIRMED:
        if (event.legSeq === PAYOUT_LEG_SEQ) {
          await this.onPayoutLegConfirmed(withdrawId, event.fundsOrderId, event.effectiveDate);
        } else if (event.legSeq === FEE_LEG_SEQ) {
          await this.onFeeLegConfirmed(withdrawId, event.fundsOrderId, event.effectiveDate);
        }
        break;
      case FundsOrderStatus.CLEARED:
        await this.onLegCleared(withdrawId);
        break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        if (event.legSeq === PAYOUT_LEG_SEQ) {
          await this.onPayoutLegFailed(withdrawId, event.fundsOrderId, event.newStatus);
        }
        break;
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

    if (w.status !== WithdrawTransactionStatus.COMPLIANCE_PENDING) {
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
    let w = await this.withdrawService.findOneInternal(withdrawId);

    // Bind the source wallet on the withdrawal itself BEFORE creating the Payout
    // / fee fund. This was previously done by the (now-deleted) orchestrator on a
    // separate event channel, which race-lost against this workflow — leaving
    // fromWalletId null at fee-fund creation and at finalize. Binding here makes
    // the workflow the single owner and guarantees fromWalletId is populated.
    w = await this.ensureSourceWalletBound(w);

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

    // Real-time 1:1 model: at PAYOUT_PENDING the withdrawal materialises its fund
    // orders — the payout principal leg (legSeq 1) and, when a fee is charged, the
    // fee leg (legSeq 2). Created HERE (not at request) so a withdrawal rejected
    // during compliance/approval never spawns fund orders. Both TB pending locks
    // (net + fee) already exist from create-time; these funds orders are the
    // outbound representation, CLEARed as each leg confirms + posts.
    const payoutLeg = await this.fundsOrders.create({
      withdrawTransactionId: w.id,
      legSeq: PAYOUT_LEG_SEQ,
      initialStatus: FundsOrderStatus.CREATED,
      assetId: w.assetId,
      amount: String(w.netAmount),
      netAmount: String(w.netAmount),
      fromWalletId: w.fromWalletId ?? null,
      fromAddress: w.fromAddress ?? null,
      fromIban: w.fromIban ?? null,
      toWalletId: w.toWalletId ?? null,
      toAddress: w.toAddress ?? null,
      toIban: w.toIban ?? null,
      traceId: w.traceId || undefined,
    });

    if (Number(w.feeAmount) > 0) {
      // From = the CUSTOMER's own wallet (C_DEP for crypto / C_VIBAN for fiat).
      // System-wide invariant C_VIBAN → F_FEE: the withdrawal fee is debited from
      // the per-customer wallet, NOT the platform pool.
      const customerSourceRole = w.asset?.type === 'CRYPTO' ? 'C_DEP' : 'C_VIBAN';
      const customerSourceWallet = await this.withdrawService.findCustomerWallet(
        w.ownerId,
        w.assetId,
        customerSourceRole,
      );
      // To = firm's FIRM_FEE wallet for this asset.
      const feeWallet = await this.systemWalletResolver.resolve(w.assetId, 'F_FEE');
      await this.fundsOrders.create({
        withdrawTransactionId: w.id,
        legSeq: FEE_LEG_SEQ,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: w.assetId,
        amount: String(w.feeAmount),
        netAmount: String(w.feeAmount),
        fromWalletId: customerSourceWallet?.id ?? null,
        fromAddress: customerSourceWallet?.address ?? null,
        fromIban: customerSourceWallet?.iban ?? null,
        toWalletId: feeWallet?.id ?? null,
        toAddress: feeWallet?.address ?? null,
        toIban: feeWallet?.iban ?? null,
        traceId: w.traceId || undefined,
      });
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_PAYOUT_INITIATED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Payout initiated — principal leg ${payoutLeg.fundsOrderNo}` +
        (Number(w.feeAmount) > 0 ? ' + fee leg' : ''),
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(
      `Withdrawal ${withdrawId} now PAYOUT_PENDING — payout leg ${payoutLeg.fundsOrderNo}` +
        (Number(w.feeAmount) > 0 ? ' + fee leg created' : ''),
    );
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

  // ── Finalization: per-leg TB POST driven by funds_order.status.changed ──

  /**
   * Phase B per-physical-wallet recon reference pair, shared across POST_NET,
   * POST_FEE and FEE_FIRM evidence so the recon engine can match a withdrawal's
   * legs by wallet + external ref.
   *   walletRef    = the customer's source wallet (vIBAN / C_OUT) bound at payout.
   *   externalRef  = the real-world crossing identifier (chain txHash / bank ref),
   *                  owned by the funds_order (read via resolveExternalRef).
   */
  // walletRef 仍取客户源钱包;externalRef 归 funds_order(CONFIRMED 时按类型铸)。
  private recognitionRefs(w: any, fo: any): { walletRef: string | null; externalRef: string | null } {
    return {
      walletRef: w.fromWalletId ?? null,
      externalRef: fo ? this.fundsOrders.resolveExternalRef(fo) : null,
    };
  }

  /**
   * Payout principal leg CONFIRMED (legSeq 1) — the external payout was observed
   * confirmed. Audit WITHDRAW_PAYOUT_CONFIRMED, POST the net pending transfer
   * (CLIENT_PAYABLE → CLIENT_ASSET, real-time 1:1), then CLEAR the leg. SUCCESS is
   * settled later once ALL legs are CLEARED (onLegCleared).
   */
  private async onPayoutLegConfirmed(withdrawId: string, fundsOrderId: string, effectiveDate?: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(`Cannot post net for withdrawal ${withdrawId}: status is ${w.status}`);
      return;
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_PAYOUT_CONFIRMED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'Payout principal leg externally confirmed',
      sourcePlatform: 'SYSTEM',
    });

    const decimals = w.asset?.decimals ?? 8;
    const fo = await this.fundsOrders.findById(fundsOrderId);
    const { walletRef, externalRef } = this.recognitionRefs(w, fo);

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
          // Phase B: outbound real-world recognition. Both legs sit on the
          // customer's source wallet; the external crossing is the on-chain /
          // bank-statement entry identified by externalRef.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef,
          isExternalCrossing: true,
        },
      });
      // postPendingTransfer only flips transferType — it doesn't write a new evidence
      // row or carry Phase B fields. Enrich the LOCK row so it now records the POST
      // event semantics (new eventCode + walletRef/externalRef/crossing).
      await this.tbEvidenceService.enrichForPost(w.tbPendingNetId, {
        eventCode: 'WITHDRAW_NET_POST',
        memo: 'Payout confirmed: POST net pending transfer → CLIENT_ASSET',
        debitWalletRef: walletRef,
        creditWalletRef: walletRef,
        externalRef,
        isExternalCrossing: true,
        ...(effectiveDate && { effectiveDate }),
      });
    }

    await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');
    this.logger.log(`Withdrawal ${withdrawId} payout leg posted (NET) → CLEARED`);
  }

  /**
   * Fee leg CONFIRMED (legSeq 2). POST the client-side fee pending transfer
   * (CLIENT_PAYABLE → CLIENT_ASSET) AND collect the firm-side fee (FIRM_ASSET →
   * FIRM_FEE), then CLEAR the leg. Fail-closed: aborts BEFORE any post if the
   * firm-fee ledger cannot resolve — the leg stays CONFIRMED for operator repair,
   * so the customer is never charged a fee the firm can't book.
   */
  private async onFeeLegConfirmed(withdrawId: string, fundsOrderId: string, effectiveDate?: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    const decimals = w.asset?.decimals ?? 8;
    const feeBigint = this.decimalToBigint(w.feeAmount, decimals);
    if (feeBigint <= 0n) {
      // Nothing to post — CLEAR the (unexpected) zero-fee leg and return.
      await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');
      return;
    }

    const ledger = w.asset?.currency
      ? TB_LEDGERS[w.asset.currency as keyof typeof TB_LEDGERS]
      : undefined;
    if (!ledger) {
      throw new Error(
        `Withdraw ${w.withdrawNo}: cannot collect firm fee — no TB ledger for ` +
        `'${w.asset?.currency ?? 'UNKNOWN'}'. Refusing to post fee leg.`,
      );
    }

    const fo = await this.fundsOrders.findById(fundsOrderId);
    const { walletRef, externalRef } = this.recognitionRefs(w, fo);

    // POST pending transfer #2: client-side fee (CLIENT_PAYABLE → CLIENT_ASSET, real-time 1:1)
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
          // Phase B: client-side fee leg of the cross-wallet same-ref pair —
          // FEE_POST and FEE_FIRM share externalRef so recon can match them.
          debitWalletRef: walletRef,
          creditWalletRef: walletRef,
          externalRef,
          isExternalCrossing: true,
        },
      });
      // Same as NET_POST: enrich the LOCK_FEE row to record FEE_POST semantics.
      await this.tbEvidenceService.enrichForPost(w.tbPendingFeeId, {
        eventCode: 'WITHDRAW_FEE_POST',
        memo: 'Payout confirmed: POST fee pending transfer → CLIENT_ASSET',
        debitWalletRef: walletRef,
        creditWalletRef: walletRef,
        externalRef,
        isExternalCrossing: true,
        ...(effectiveDate && { effectiveDate }),
      });
    }

    // Firm-side fee collect: DR FIRM_ASSET / CR FIRM_FEE (direct transfer, same ledger as asset)
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

    // Phase B: FIRM_ASSET is the aggregate pool (no physical wallet);
    // FIRM_FEE is the platform's F_FEE wallet for this asset.
    const firmFeeWalletRef = await this.resolveFirmFeeWalletRef(w.assetId);

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
        assetCurrency: w.asset!.currency,
        traceId: w.traceId || w.id,
        actorType: 'SYSTEM',
        actorId: 'WITHDRAW_WORKFLOW',
        memo: 'Firm-side fee collect: FIRM_ASSET → FIRM_FEE',
        // Phase B firm-side fee leg of the cross-wallet same-ref pair.
        // debitWalletRef is null — FIRM_ASSET is aggregate, has no physical wallet.
        // creditWalletRef points at the platform's F_FEE wallet so recon can
        // tie this row to the matching FEE_POST row by externalRef.
        debitWalletRef: null,
        creditWalletRef: firmFeeWalletRef,
        externalRef,
        isExternalCrossing: true,
        ...(effectiveDate && { effectiveDate }),
      },
    });

    await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');
    this.logger.log(`Withdrawal ${withdrawId} fee leg posted (FEE_POST + FEE_FIRM) → CLEARED`);
  }

  /**
   * 乙 SUCCESS invariant. A withdrawal may only become SUCCESS when its WHOLE
   * settlement is on the books: the customer-side NET_POST AND (when a fee was
   * charged) FEE_POST + FEE_FIRM. Throws otherwise (fail-closed → the withdrawal
   * stays PAYOUT_PENDING for operator repair). The payout-status check is gone
   * (payouts no longer exist) — "all legs CLEARED" (asserted by the caller) plus
   * this TB-evidence check together prove the whole settlement crossed.
   */
  private async assertWithdrawSettled(w: any, feeBigint: bigint): Promise<void> {
    const required: string[] = [];
    if (w.tbPendingNetId) required.push('WITHDRAW_NET_POST');
    if (feeBigint > 0n) required.push('WITHDRAW_FEE_POST', 'WITHDRAW_FEE_FIRM');
    if (required.length > 0) {
      const rows = await (this.prisma as any).tbTransferEvidence.findMany({
        where: { sourceType: 'WITHDRAWAL', sourceNo: w.withdrawNo },
        select: { eventCode: true },
      });
      const codes = new Set(rows.map((r: any) => r.eventCode));
      const missing = required.filter((c) => !codes.has(c));
      if (missing.length > 0) {
        throw new Error(
          `Withdraw ${w.withdrawNo} cannot settle SUCCESS: settlement incomplete, ` +
          `missing TB legs [${missing.join(', ')}] — fee not fully collected.`,
        );
      }
    }
  }

  /**
   * A leg reached CLEARED. When ALL of the withdrawal's funds orders are CLEARED
   * (payout principal + fee when charged), the whole settlement is on the books:
   * audit WITHDRAW_ACCOUNTING_POSTED, assert settled (fail-closed), flip the
   * withdrawal to SUCCESS, audit WITHDRAW_SUCCESS. No-op until every leg CLEARs.
   */
  private async onLegCleared(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      // Already SUCCESS (idempotent replay) or terminal-failed — nothing to do.
      return;
    }

    const legs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, {});
    if (legs.length === 0) return;
    const allCleared = legs.every((l: any) => l.status === FundsOrderStatus.CLEARED);
    if (!allCleared) {
      this.logger.debug(
        `Withdrawal ${withdrawId}: ${legs.filter((l: any) => l.status === FundsOrderStatus.CLEARED).length}/${legs.length} legs CLEARED — awaiting the rest`,
      );
      return;
    }

    const decimals = w.asset?.decimals ?? 8;
    const feeBigint = this.decimalToBigint(w.feeAmount, decimals);

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

    // 乙 SUCCESS invariant: only settle when the whole settlement is on the books.
    await this.assertWithdrawSettled(w, feeBigint);

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

    // L3: Post-Tx Archive — fire-and-forget txHash archival (crypto only)
    if (w.asset?.type !== 'FIAT' && w.txHash) {
      this.archivePostKyt(w).catch(err =>
        this.logger.warn(`Post-KYT archive failed for ${withdrawId}: ${(err as Error).message}`),
      );
    }

    this.logger.log(`Withdrawal ${withdrawId} finalized: all legs CLEARED, status SUCCESS`);
  }

  // ── Source-wallet binding (absorbed from the deleted orchestrator) ──

  /**
   * Bind the withdrawal's source wallet (fromWalletId/No/Address/Iban) if not
   * already bound. R4 invariant: the source is ALWAYS a customer-owned wallet
   * — never the platform pool — regardless of asset type:
   *   FIAT  → walletRole = C_VIBAN, ownerType = CUSTOMER
   *   CRYPTO → walletRole = C_DEP,  ownerType = CUSTOMER
   *
   * Previously the FIAT branch resolved to walletRole = C_CMA + ownerType =
   * PLATFORM, which silently attached the customer's outflow to the platform
   * pool wallet (3/3 FIAT withdrawals in the demo seed were misrouted).
   *
   * Returns the (possibly re-read) withdrawal with the binding applied.
   * Idempotent: a no-op when fromWalletId is already set. Throws
   * IllegalSourceWalletError when the customer has no active wallet of the
   * required role for this asset.
   */
  private async ensureSourceWalletBound(w: any): Promise<any> {
    if (w.fromWalletId) {
      return w;
    }

    if (!w.asset?.currency) {
      throw new BadRequestException(
        `Asset currency is missing for withdrawal ${w.id}`,
      );
    }

    const isCrypto = w.asset?.type === 'CRYPTO';
    const walletRole = isCrypto ? WalletRole.C_DEP : WalletRole.C_VIBAN;

    const sourceWallet = await (this.prisma as any).wallet.findFirst({
      where: {
        walletRole,
        assetId: w.assetId,
        ownerType: 'CUSTOMER',
        ownerId: w.ownerId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, walletNo: true, address: true, iban: true },
    });

    if (!sourceWallet) {
      throw new IllegalSourceWalletError(
        `Withdrawal ${w.id}: customer ${w.ownerId} has no active ${walletRole} ` +
        `wallet for asset ${w.assetId} (${w.asset.currency}). R4 requires the ` +
        `source wallet to be customer-owned (FIAT→C_VIBAN, CRYPTO→C_DEP).`,
      );
    }

    await (this.prisma as any).withdrawTransaction.update({
      where: { id: w.id },
      data: {
        fromWalletId: sourceWallet.id,
        fromWalletNo: sourceWallet.walletNo ?? null,
        fromAddress: sourceWallet.address ?? null,
        fromIban: sourceWallet.iban ?? null,
      },
    });

    return {
      ...w,
      fromWalletId: sourceWallet.id,
      fromWalletNo: sourceWallet.walletNo ?? null,
      fromAddress: sourceWallet.address ?? null,
      fromIban: sourceWallet.iban ?? null,
    };
  }

  // ── Payout-failure compensation (P6 fix) ──

  /**
   * Payout principal leg FAILED / TIMEOUT (legSeq 1). Transitions the withdrawal
   * to FAILED and — THE P6 FIX (do not weaken) — releases the customer's TB
   * pending locks (net + fee) via releaseLock so the balance is returned. Before
   * this path existed a failed payout only flipped status + audited, leaving the
   * customer's balance locked forever.
   *
   * Audits WITHDRAW_PAYOUT_FAILED. Idempotent: if the withdrawal is already
   * FAILED we still run releaseLock (its void is best-effort/safe on replay) but
   * do not double-transition.
   */
  private async onPayoutLegFailed(
    withdrawId: string,
    fundsOrderId: string,
    newStatus: string,
  ) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    const reason = `Payout funds order ${fundsOrderId} ${newStatus}`;

    if (w.status !== WithdrawTransactionStatus.FAILED) {
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.FAIL, reason },
        this.systemCtx,
      );
    } else {
      this.logger.warn(
        `Withdrawal ${withdrawId} already FAILED — releasing lock idempotently without re-transition`,
      );
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_PAYOUT_FAILED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason,
      sourcePlatform: 'SYSTEM',
    });

    // P6: void the customer's pending net+fee TB lock so the balance is returned.
    await this.releaseLock(w, reason);
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

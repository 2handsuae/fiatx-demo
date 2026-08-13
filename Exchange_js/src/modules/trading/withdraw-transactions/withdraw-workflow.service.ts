import {
  BadRequestException,
  ConflictException,
  Inject,
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
import { AuditActorContext } from '../../audit-logging/dto/audit-log.dto';
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
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
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
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../../deposit-sumsub/sumsub-txn-client.interface';
import { resolveKytTxnType } from '../../deposit-sumsub/kyt-txn-type.resolver';
import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';

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

  // applyKytVerdict no-ops on these — every terminal state already answers "钱去哪了"
  // (spec §5) and must not be reopened by a late/replayed KYT webhook.
  private static readonly KYT_VERDICT_TERMINAL_STATUSES = new Set([
    WithdrawTransactionStatus.SUCCESS,
    WithdrawTransactionStatus.REJECTED,
    WithdrawTransactionStatus.FAILED,
    WithdrawTransactionStatus.RETURNED,
  ]);

  private static readonly ONHOLD_SLA_DAYS = 7;
  private static readonly ACTION_SLA_DAYS = 7;

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
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
    private readonly applicantActions: WithdrawApplicantActionsService,
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

    // ── Address-registration guard + VASP derivation (Task 3) ──
    // The withdrawal destination must already be a registered, ACTIVE
    // withdrawal address — crypto checks toAddress, fiat checks toIban. Runs
    // BEFORE the row is inserted (and before the quote is consumed) so an
    // unregistered destination never burns the quote or locks funds.
    const isCryptoWithdraw = String(asset.type || '').toUpperCase() !== 'FIAT';
    let counterpartyIsVasp: boolean | null = null;
    if (isCryptoWithdraw && toAddress) {
      const registeredAddress = await (this.prisma as any).withdrawalAddress.findFirst({
        where: { customerId: userId, address: toAddress, status: 'ACTIVE' },
      });
      if (!registeredAddress) {
        throw new BadRequestException({
          code: 'WITHDRAWAL_ADDRESS_NOT_REGISTERED',
          message: 'Withdrawal address is not registered or not active',
        });
      }
      counterpartyIsVasp = registeredAddress.addressType === 'VASP';
    } else if (!isCryptoWithdraw && toIban) {
      // NOTE: registered bank rows are stamped addressType='BANK' (network is
      // the generic asset-network value 'FIAT', not 'BANK') — see
      // WithdrawalAddressService#createBankAccount. Matches the addressType
      // filter used everywhere else in the codebase that checks for an active
      // bank account (e.g. onboarding.service.ts, withdrawal-address.service.ts).
      const registeredAddress = await (this.prisma as any).withdrawalAddress.findFirst({
        where: { customerId: userId, iban: toIban, status: 'ACTIVE', addressType: 'BANK' },
      });
      if (!registeredAddress) {
        throw new BadRequestException({
          code: 'WITHDRAWAL_ADDRESS_NOT_REGISTERED',
          message: 'Withdrawal address is not registered or not active',
        });
      }
      // counterpartyIsVasp stays null — VASP counterparty is a crypto-only concept.
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

          const record = await this.withdrawService.insertRecord(tx, {
            withdrawNo,
            ownerType,
            ownerId: userId,
            ownerNo,
            // Birth state (Task 2, "出生即着陆"): every withdrawal is created directly
            // on COMPLIANCE_PENDING. The WITHDRAWAL_CREATED cascade below (same event,
            // after commit) valuates it in AED and — fail-closed on a missing/failed
            // valuation — routes large-value ones up to PENDING_APPROVAL via
            // openApprovalGate's sanctioned birth-routing write; everything else stays
            // put in COMPLIANCE_PENDING.
            status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
            assetId,
            amount: amountDecimal,
            netAmount,
            feeAmount: quoteFeeAmount,
            toWalletId,
            toAddress,
            toIban,
            counterpartyIsVasp,
            traceId,
            grossAedValue: gateValuation?.grossAedValue ?? undefined,
            aedRate: gateValuation?.aedRate ?? undefined,
            rateFetchedAt: gateValuation?.rateFetchedAt ?? undefined,
            rateFetchFailed: gateValuation?.rateFetchFailed ?? undefined,
            parentType,
            parentId,
            pricingQuoteId: consumedQuoteId,
            statusHistory: JSON.stringify([{
              status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
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
            // Firm-side fee collect (DR FIRM_ASSET / CR INCOME_WITHDRAW_FEE) fires separately on finalize.
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
      if (w.status !== WithdrawTransactionStatus.COMPLIANCE_PENDING) {
        this.logger.debug(`Skip branch: withdrawal ${event.withdrawId} already ${w.status}`);
        return;
      }

      const valuation = await this.valuateAed(w);
      await this.withdrawService.saveValuationSnapshot(w.id, valuation);

      const threshold = await this.limitRulesService.getLargeApprovalThreshold('WITHDRAWAL');
      if (shouldRequireApproval(valuation, threshold)) {
        await this.openApprovalGate(w, valuation, threshold);
      } else {
        this.logger.log(`Withdrawal ${event.withdrawId} below approval threshold — remaining in compliance`);
        // Withdrawal is already BORN on COMPLIANCE_PENDING (Task 2) — no transition
        // needed here.
        await this.submitSumsubTxn(w.id);
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

      // Flip COMPLIANCE_PENDING → PENDING_APPROVAL only AFTER the case exists and is
      // linked, so a partial failure leaves the withdrawal cleanly in COMPLIANCE_PENDING
      // (funds locked, retriable) and never stuck in PENDING_APPROVAL with no approval
      // case. This is the ONE sanctioned "birth routing" write — the transitions table
      // deliberately has no edge for it (it isn't a business transition, it's where a
      // large-value withdrawal actually lands right after birth) — so it bypasses
      // updateStatus/transitions and goes straight to Prisma + statusHistory instead.
      await this.withdrawService.landOnPendingApproval(w.id);

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
      this.logger.error(`openApprovalGate failed for ${w.id} — left in COMPLIANCE_PENDING for retry: ${(err as Error).message}`);
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
      await this.submitSumsubTxn(w.id);
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
        } else if (event.legSeq === FEE_LEG_SEQ) {
          await this.onFeeLegFailed(withdrawId, event.fundsOrderId, event.newStatus);
        }
        break;
    }
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
      // To = firm's F_FEE wallet for this asset.
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

    // 回捞 (Task 6): the order guard at the top of onFeeLegConfirmed defers fee
    // settlement whenever the fee leg reaches CONFIRMED before the principal leg
    // does — that deferred fee leg never gets its own retriggering event once the
    // principal finally clears. Pick it up here: if a fee leg exists, is still
    // sitting CONFIRMED (not yet posted/CLEARED), settle it now that the
    // principal is CLEARED. Safe to call unconditionally on every principal
    // CLEAR (idempotent replay, catches concurrent re-entry) — the guard inside
    // onFeeLegConfirmed now checks if the fee leg is already terminal or gone,
    // skipping settlement and avoiding false "already terminal" increments.
    const feeLegs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, { legSeq: FEE_LEG_SEQ });
    const feeLeg = feeLegs[feeLegs.length - 1];
    if (feeLeg && feeLeg.status === FundsOrderStatus.CONFIRMED) {
      this.logger.log(
        `Withdrawal ${withdrawId}: principal leg CLEARED — picking up deferred fee leg ${feeLeg.fundsOrderNo}`,
      );
      await this.onFeeLegConfirmed(withdrawId, feeLeg.id, effectiveDate);
    }
  }

  /**
   * Fee leg CONFIRMED (legSeq 2). POST the client-side fee pending transfer
   * (CLIENT_PAYABLE → CLIENT_ASSET) AND collect the firm-side fee (FIRM_ASSET →
   * INCOME_WITHDRAW_FEE), then CLEAR the leg. Fail-closed: aborts BEFORE any post if the
   * firm-fee ledger cannot resolve — the leg stays CONFIRMED for operator repair,
   * so the customer is never charged a fee the firm can't book.
   *
   * Order guard (Task 6): the fee leg must never settle before the payout
   * principal leg (legSeq 1) does — reads as "fee before principal" if a fee
   * webhook races ahead of the principal's. Defers (log + return, no throw) when
   * the principal isn't at least CONFIRMED yet; the fee funds order stays
   * CONFIRMED and is picked up later by onPayoutLegConfirmed's 回捞.
   *
   * Concurrent re-entry guard (Task 6): re-checks the fee leg's own current
   * status after loading it (line 1061). If already terminal (CLEARED, FAILED, etc.)
   * or missing, logs idempotent skip and returns without entering the settlement
   * body — prevents concurrent double-invocations from both racing loser's
   * "already terminal" error and false incrementFeeSettleAttempts counters.
   *
   * Settle-failure retry (Task 6, three-rung ladder rung 1): the settlement body
   * (POST + firm-fee collect + CLEAR) is wrapped in try/catch. A transient TB
   * failure increments withdrawTransaction.feeSettleAttempts and returns without
   * throwing — the fee leg stays CONFIRMED, so the next redelivered webhook or an
   * admin re-advance naturally retries. At the 3rd failed attempt the withdrawal
   * is flagged needsReview + WITHDRAW_FEE_SETTLE_STUCK and stays PAYOUT_PENDING
   * (never touches withdraw status, never releases the lock). A successful
   * settle resets the counter to 0.
   */
  private async onFeeLegConfirmed(withdrawId: string, fundsOrderId: string, effectiveDate?: string) {
    const principalLegs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, { legSeq: PAYOUT_LEG_SEQ });
    const principalLeg = principalLegs[principalLegs.length - 1];
    const principalSettled =
      !!principalLeg &&
      (principalLeg.status === FundsOrderStatus.CONFIRMED || principalLeg.status === FundsOrderStatus.CLEARED);
    if (!principalSettled) {
      this.logger.log(
        `Withdrawal ${withdrawId}: fee leg ${fundsOrderId} CONFIRMED before principal leg ` +
        `(principal status=${principalLeg?.status ?? 'MISSING'}) — deferring fee settle until principal lands`,
      );
      return;
    }

    const w = await this.withdrawService.findOneInternal(withdrawId);
    const decimals = w.asset?.decimals ?? 8;
    const feeBigint = this.decimalToBigint(w.feeAmount, decimals);
    if (feeBigint <= 0n) {
      // Nothing to post — CLEAR the (unexpected) zero-fee leg and return.
      await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM');
      return;
    }

    try {
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

      // Concurrent re-entry guard (Task 6): if the fee leg is no longer CONFIRMED
      // (already CLEARED, FAILED, etc. or missing), skip settlement — prevents
      // concurrent double-invocation from both racing loser's "already terminal"
      // error and false incrementFeeSettleAttempts counters.
      if (!fo || fo.status !== FundsOrderStatus.CONFIRMED) {
        this.logger.debug(
          `Withdrawal ${withdrawId}: fee leg ${fundsOrderId} status is ${fo?.status ?? 'MISSING'}, not CONFIRMED — idempotent skip`,
        );
        return;
      }

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

      // Firm-side fee collect: DR FIRM_ASSET / CR INCOME_WITHDRAW_FEE (direct transfer, same ledger as asset)
      const firmAssetId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FIRM_ASSET,
        ledger,
        ownerType: 'SYSTEM',
      });
      const firmFeeId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE,
        ledger,
        ownerType: 'SYSTEM',
      });

      // Phase B: FIRM_ASSET is the aggregate pool (no physical wallet);
      // INCOME_WITHDRAW_FEE is the platform's F_FEE wallet for this asset.
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
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE],
          assetCurrency: w.asset!.currency,
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Firm-side fee collect: FIRM_ASSET → INCOME_WITHDRAW_FEE',
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

      // Rung 1 resolved: a prior transient failure (if any) is behind us.
      await this.withdrawService.resetFeeSettleAttempts(w.id);
    } catch (err) {
      const attempts = await this.withdrawService.incrementFeeSettleAttempts(w.id);
      if (attempts < 3) {
        this.logger.error(
          `Withdrawal ${withdrawId} fee settle attempt ${attempts}/3 failed: ${(err as Error).message} — ` +
          `fee leg stays CONFIRMED, will retry on redelivery/re-advance`,
        );
        return;
      }

      await this.withdrawService.markNeedsReview(w.id);
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_FEE_SETTLE_STUCK,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Fee settle failed ${attempts}/3 attempts: ${(err as Error).message} — manual intervention required (withdrawal stays PAYOUT_PENDING)`,
        sourcePlatform: 'SYSTEM',
      });
      this.logger.error(
        `Withdrawal ${withdrawId} fee settle STUCK after ${attempts} attempts: ${(err as Error).message}`,
      );
    }
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
   *
   * Task 12 e2e fix: `findByParent` with no filter returns EVERY attempt row of
   * a retried leg (Task 6's fee-leg rebuild-on-FAILED ladder creates a new
   * funds_order row per attempt, same legSeq). Checking `every()` over the raw
   * list meant a fee leg that ever failed even once — then successfully
   * rebuilt and CLEARed — could never reach "all cleared": the old FAILED
   * attempt row(s) are permanent, so the naive check would block SUCCESS
   * forever. Only the LATEST attempt per legSeq represents that leg's current
   * outcome (mirrors onPayoutLegConfirmed's own `feeLegs[feeLegs.length - 1]`
   * 回捞 pattern) — older attempts are retry history, not still-open legs.
   */
  private async onLegCleared(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      // Already SUCCESS (idempotent replay) or terminal-failed — nothing to do.
      return;
    }

    const legs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, {});
    if (legs.length === 0) return;
    const latestByLegSeq = new Map<number, any>();
    for (const leg of legs) {
      const existing = latestByLegSeq.get(leg.legSeq);
      if (!existing || leg.attempt > existing.attempt) latestByLegSeq.set(leg.legSeq, leg);
    }
    const latestLegs = Array.from(latestByLegSeq.values());
    const allCleared = latestLegs.every((l: any) => l.status === FundsOrderStatus.CLEARED);
    if (!allCleared) {
      this.logger.debug(
        `Withdrawal ${withdrawId}: ${latestLegs.filter((l: any) => l.status === FundsOrderStatus.CLEARED).length}/${latestLegs.length} legs CLEARED — awaiting the rest`,
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

    // Clear needsReview flag if set (ops-hygiene)
    if (w.needsReview) {
      await this.withdrawService.clearNeedsReview(w.id);
      this.logger.log(`Withdrawal ${withdrawId}: cleared needsReview flag on SUCCESS`);
    }

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

  /**
   * Fee leg FAILED / TIMEOUT (legSeq 2, Task 6 — closes the zero-handler gap:
   * before this existed a fee-leg failure had no handler at all and just sat
   * silently). Unlike a failed principal leg, a failed fee leg is NEVER fatal to
   * the withdrawal — the fee's TB pending lock stays put either way (it's posted
   * only at settle, never at CONFIRM), so there is nothing to void here. Whether
   * the principal has already CLEARED or is still in flight, the remedy is the
   * same: rebuild a fresh legSeq-2 attempt (mirrors deposit's
   * buildReturnLegInput/onReturnLegFailed rebuild-on-retry pattern) up to 3
   * attempts, WITHDRAW_FEE_LEG_REBUILT audited each time; once exhausted, flag
   * needsReview + audit WITHDRAW_FEE_SETTLE_STUCK. Never transitions withdraw
   * status, never calls releaseLock — the withdrawal stays PAYOUT_PENDING.
   */
  private async onFeeLegFailed(withdrawId: string, fundsOrderId: string, newStatus: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(
        `onFeeLegFailed no-op: withdrawal ${withdrawId} is ${w.status}, not PAYOUT_PENDING`,
      );
      return;
    }

    const fo = await this.fundsOrders.findById(fundsOrderId);
    const attempt = fo?.attempt ?? 1;
    const reason = `Fee funds order ${fundsOrderId} ${newStatus} (attempt ${attempt})`;
    const MAX_FEE_LEG_ATTEMPTS = 3;

    if (attempt < MAX_FEE_LEG_ATTEMPTS) {
      const nextAttempt = attempt + 1;
      const newLeg = await this.fundsOrders.create({
        withdrawTransactionId: w.id,
        legSeq: FEE_LEG_SEQ,
        attempt: nextAttempt,
        initialStatus: FundsOrderStatus.CREATED,
        assetId: w.assetId,
        amount: String(w.feeAmount),
        netAmount: String(w.feeAmount),
        fromWalletId: fo?.fromWalletId ?? null,
        fromAddress: fo?.fromAddress ?? null,
        fromIban: fo?.fromIban ?? null,
        toWalletId: fo?.toWalletId ?? null,
        toAddress: fo?.toAddress ?? null,
        toIban: fo?.toIban ?? null,
        traceId: w.traceId || undefined,
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_FEE_LEG_REBUILT,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `${reason} — rebuilt attempt ${nextAttempt} (${newLeg.fundsOrderNo})`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(
        `Withdrawal ${withdrawId}: fee leg attempt ${attempt} ${newStatus} — rebuilt attempt ${nextAttempt} (${newLeg.fundsOrderNo})`,
      );
      return;
    }

    // Attempts exhausted — flag for operator review, stay PAYOUT_PENDING.
    await this.withdrawService.markNeedsReview(w.id);
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_FEE_SETTLE_STUCK,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `${reason} — fee leg failed after ${attempt} attempts, manual intervention required (withdrawal stays PAYOUT_PENDING)`,
      sourcePlatform: 'SYSTEM',
    });
    this.logger.error(
      `Withdrawal ${withdrawId}: fee leg attempts exhausted (${attempt}) — flagged needsReview, STUCK`,
    );
  }

  // ── Bounce (RETURNED) — bank/network returned an already-POSTed payout ──

  /**
   * Admin-initiated bounce (Task 7): the payout net leg already POSTed (money
   * actually left) but the bank/network returned it afterwards (dead IBAN,
   * closed account, downstream sanctions hit, etc.). Reverses the net amount
   * back into the customer's balance — DR CLIENT_ASSET / CR CLIENT_PAYABLE —
   * then flips PAYOUT_PENDING → RETURNED (terminal).
   *
   * Guards:
   *   - status must be PAYOUT_PENDING. A payout that fails BEFORE it ever
   *     posted should go through the existing FAIL path instead.
   *   - the net leg must already carry WITHDRAW_NET_POST evidence — otherwise
   *     the money never left and there is nothing to bounce back.
   *
   * FEE IS NOT REFUNDED — bank-bounce fees stay with the firm; only the net
   * principal re-enters. The audit reason states this explicitly.
   *
   * Ordering (先账后状态): the reverse TB entry lands BEFORE the status flip,
   * so a crash in between leaves the withdrawal retriable at PAYOUT_PENDING
   * rather than silently losing the reversal. Idempotent: a second call after
   * RETURNED lands fails cleanly on the status guard above.
   */
  async onBounce(
    withdrawId: string,
    reason: string,
    actorCtx: AuditActorContext = { actorType: 'SYSTEM', actorId: 'SYSTEM', actorRole: 'SYSTEM' },
  ): Promise<void> {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      throw new BadRequestException({
        code: 'BOUNCE_REQUIRES_PAYOUT_PENDING',
        message: `Cannot bounce withdrawal ${w.withdrawNo}: status is ${w.status}, expected PAYOUT_PENDING`,
      });
    }

    const postedEvidence = await (this.prisma as any).tbTransferEvidence.findMany({
      where: { sourceType: 'WITHDRAWAL', sourceNo: w.withdrawNo, eventCode: 'WITHDRAW_NET_POST' },
    });
    if (postedEvidence.length === 0) {
      throw new BadRequestException({
        code: 'BOUNCE_REQUIRES_POSTED_PAYOUT',
        message: `Cannot bounce withdrawal ${w.withdrawNo}: payout net leg has not posted yet — use FAIL instead`,
      });
    }

    const decimals = w.asset?.decimals ?? 8;
    const netBigint = this.decimalToBigint(w.netAmount, decimals);
    const ledger = TB_LEDGERS[w.asset.currency as keyof typeof TB_LEDGERS];

    const clientAssetId = await this.accountingService.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CLIENT_ASSET,
      ledger,
      ownerType: 'SYSTEM',
    });
    const clientPayableId = await this.accountingService.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      ledger,
      ownerType: 'CUSTOMER',
      ownerUuid: w.ownerId,
    });

    const principalLegs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, { legSeq: PAYOUT_LEG_SEQ });
    const principalLeg = principalLegs[principalLegs.length - 1];
    const externalRef = principalLeg ? this.fundsOrders.resolveExternalRef(principalLeg) : null;
    const walletRef = w.fromWalletId ?? null;

    await this.accountingService.executeTransfer({
      debitAccountId: clientAssetId,
      creditAccountId: clientPayableId,
      amount: netBigint,
      ledger,
      code: TB_TRANSFER_CODES.WITHDRAW_BOUNCE_REENTRY,
      evidence: {
        sourceType: 'WITHDRAWAL',
        sourceNo: w.withdrawNo,
        eventCode: 'WITHDRAW_BOUNCE_REENTRY',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: w.asset?.currency || '',
        traceId: w.traceId || w.id,
        actorType: actorCtx.actorType,
        actorId: actorCtx.actorId,
        memo: `Payout bounced by bank/network — reason: ${reason}`,
        debitWalletRef: walletRef,
        creditWalletRef: walletRef,
        externalRef,
        isExternalCrossing: true,
      },
    });

    // Fix Round 1 (reviewer catch): principal-POSTed does NOT imply fee-POSTed —
    // Task 6's ordering guard settles the fee AFTER the principal, so "principal
    // POSTed, fee still pending" is a ROUTINE window, not a rare race. Bouncing
    // straight to RETURNED here would permanently orphan the fee's TB pending
    // lock (timeout:0, never expires) and falsely claim "fee retained" in the
    // audit when the fee was never actually collected. Resolve the fee's real
    // disposition before flipping the terminal status.
    let feeDisposition = 'fee retained (collected)';
    if (w.tbPendingFeeId) {
      const feePostedEvidence = await (this.prisma as any).tbTransferEvidence.findMany({
        where: { sourceType: 'WITHDRAWAL', sourceNo: w.withdrawNo, eventCode: 'WITHDRAW_FEE_POST' },
      });
      if (feePostedEvidence.length === 0) {
        // Fee never left the customer's balance — void the pending lock so it
        // isn't orphaned once the withdrawal lands on terminal RETURNED.
        // Mirrors releaseLock's fee half exactly, including the CRITICAL log.
        const feeBigint = this.decimalToBigint(w.feeAmount, decimals);
        const voided = await this.accountingService.voidPendingTransferBestEffort(
          hexToBigint(w.tbPendingFeeId),
          feeBigint,
        );
        if (!voided) {
          this.logger.error(
            `CRITICAL: failed to void fee pending transfer for withdrawal ${w.id} during bounce — funds may stay locked`,
          );
        }

        // Best-effort: FAIL the fee funds order too, for view consistency
        // (admin/recon read the funds order table). Swallow already-terminal /
        // invalid-transition — the money path (TB void above) must never be
        // blocked by a funds-order state-machine hiccup (mirrors
        // DepositWorkflowService#clearDispositionLeg's swallow rationale: a
        // lagging view must not roll back an already-completed money move).
        const feeLegs = await this.fundsOrders.findByParent({ withdrawTransactionId: withdrawId }, { legSeq: FEE_LEG_SEQ });
        const feeLeg = feeLegs[feeLegs.length - 1];
        if (feeLeg) {
          try {
            await this.fundsOrders.advance(feeLeg.id, FundsOrderAction.FAIL, 'SYSTEM');
          } catch (err: any) {
            this.logger.warn(
              `Bounce ${w.withdrawNo}: could not FAIL fee leg ${feeLeg.id} (${(err as Error).message}) — ` +
              `TB void already applied, funds order status merely lags`,
            );
          }
        }

        feeDisposition = 'uncollected fee lock voided — fee returned to customer';
      }
    }

    // 先账后状态: the reverse TB entry (+ fee disposition) above must land
    // before this terminal flip.
    await this.withdrawService.updateStatus(
      w.id,
      { action: WithdrawTransactionAction.RETURN, reason },
      this.systemCtx,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_BOUNCED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Payout bounced: ${reason} — ${feeDisposition}`,
        metadata: { reason },
        sourcePlatform: 'ADMIN_API',
      },
      actorCtx,
    );

    this.logger.log(`Withdrawal ${withdrawId} bounced by bank/network — reversed net leg, status RETURNED`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Task 8 — FROZEN maker-checker approval gates (initiate side only).
  // Mirrors DepositWorkflowService.initiateSeize/initiateUnfreeze exactly:
  // reads the withdrawal, checks FROZEN + an anti-dup open-PENDING guard,
  // opens the V1 approval case, audits the request — writes NOTHING to the
  // withdraw table (Rule 5: initiate reads only). The two out-edges FROZEN
  // already carries (resume→COMPLIANCE_PENDING, reject_refund→REJECTED) are
  // driven off the APPROVED decision in Task 9's decided-event listeners
  // (workflow.withdraw-unfreeze.decided / workflow.withdraw-sanction-refund.decided).
  // ═══════════════════════════════════════════════════════════════════════

  private toAuditActor(actor: ApprovalActorContext): AuditActorContext {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  /**
   * UNFREEZE disposition (initiate side, Task 8): ops proposes unfreezing a FROZEN
   * withdrawal under a delisting/unfreeze order (sanction list correction, MLRO
   * clearance, etc.). Routed through V1 maker-checker approval (single-step MLRO).
   * Only opens the approval case + audits the request; the actual resume→
   * COMPLIANCE_PENDING transition lands in Task 9's decided-event handler.
   */
  async initiateUnfreeze(
    withdrawId: string,
    dto: { orderRef: string; reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.orderRef?.trim()) {
      throw new BadRequestException('Delisting/unfreeze order reference is required');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Unfreeze reason is required');
    }

    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.FROZEN) {
      throw new BadRequestException('Withdrawal is not FROZEN, cannot open an unfreeze approval');
    }

    // Anti-dup: a withdrawal must not accrue two open unfreeze approvals.
    const openUnfreezes = await this.approvalsService.list({
      actionType: ApprovalActionTypes.WITHDRAW_UNFREEZE,
      entityRef: w.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openUnfreezes.total > 0) {
      throw new ConflictException(
        `Withdrawal ${w.withdrawNo} already has a pending unfreeze approval; resolve it before submitting another.`,
      );
    }

    const traceId = w.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.WITHDRAW_UNFREEZE,
        entityRef: w.id,
        traceId,
        objectSnapshot: {
          withdrawNo: w.withdrawNo,
          ownerType: w.ownerType,
          ownerId: w.ownerId,
          orderRef: dto.orderRef,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_UNFREEZE_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: dto.reason,
        metadata: { withdrawNo: w.withdrawNo, orderRef: dto.orderRef, approvalNo: approvalCase.approvalNo },
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      withdrawNo: w.withdrawNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /**
   * SANCTION REFUND disposition (initiate side, Task 8): ops proposes refunding a
   * FROZEN withdrawal back to its sender under a sanctions disposition (the
   * REJECT_REFUND tag arriving while a withdrawal was already FROZEN is ignored —
   * see applyKytRejected's WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED guard — so this is
   * the only legal path to that exit). Routed through V1 maker-checker approval
   * (single-step MLRO). Only opens the approval case + audits the request; the
   * actual reject_refund→REJECTED transition lands in Task 9's decided-event handler.
   */
  async initiateRefund(
    withdrawId: string,
    dto: { reason: string },
    actor: ApprovalActorContext,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Refund reason is required');
    }

    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.FROZEN) {
      throw new BadRequestException('Withdrawal is not FROZEN, cannot open a sanction-refund approval');
    }

    // Anti-dup: a withdrawal must not accrue two open sanction-refund approvals.
    const openRefunds = await this.approvalsService.list({
      actionType: ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
      entityRef: w.id,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openRefunds.total > 0) {
      throw new ConflictException(
        `Withdrawal ${w.withdrawNo} already has a pending sanction-refund approval; resolve it before submitting another.`,
      );
    }

    const traceId = w.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
        entityRef: w.id,
        traceId,
        objectSnapshot: {
          withdrawNo: w.withdrawNo,
          ownerType: w.ownerType,
          ownerId: w.ownerId,
          reason: dto.reason,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: dto.reason,
        metadata: { withdrawNo: w.withdrawNo, approvalNo: approvalCase.approvalNo },
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      withdrawNo: w.withdrawNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Task 9 — FROZEN maker-checker approval gates (execution side). Consumes
  // Task 8's decided events (workflow.withdraw-unfreeze.decided /
  // workflow.withdraw-sanction-refund.decided) and drives the two out-edges
  // FROZEN already carries (resume→COMPLIANCE_PENDING, reject_refund→REJECTED).
  // Mirrors DepositWorkflowService.onUnfreezeDecided/onUnfreezeApproved/
  // fetchUnfreezeOrderRef — see that file for the full A5 rationale.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * UNFREEZE decided: the V1 approval opened by initiateUnfreeze reached a
   * decision. APPROVED → delegate to onUnfreezeApproved. Any other outcome
   * (DECLINED/CANCELLED/EXPIRED) → log only, the withdrawal stays FROZEN
   * untouched (mirrors deposit's onUnfreezeDecided).
   */
  @OnEvent('workflow.withdraw-unfreeze.decided', { async: true })
  async onUnfreezeDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    if (payload.decision !== 'APPROVED') {
      this.logger.log(
        `Withdrawal ${payload.entityRef} unfreeze ${payload.decision} (case ${payload.approvalNo}) — original state intact, no unfreeze executed.`,
      );
      return;
    }
    await this.onUnfreezeApproved(payload.entityRef);
  }

  /**
   * Re-derive the delisting/unfreeze order reference (orderRef) from the most
   * recent APPROVED approval case's objectSnapshot for the given actionType.
   * `ApprovalDecidedEvent.metadata` is always `{}` (see `emitDecidedEvent` in
   * approval-handler.base.ts), so orderRef must be re-fetched here rather than
   * carried through the event payload — mirrors DepositWorkflowService's
   * fetchUnfreezeOrderRef. Throws rather than silently defaulting to an empty
   * string: initiateUnfreeze enforces orderRef non-empty at approval-open time,
   * so a missing orderRef here means data corruption, not a normal path — and
   * this fetch runs BEFORE any state mutation (guard-before-mutate ordering),
   * so a throw here leaves the withdrawal untouched (still FROZEN).
   */
  private async fetchApprovedOrderRef(withdrawId: string, actionType: string): Promise<string> {
    const { items } = await this.approvalsService.list({
      actionType,
      entityRef: withdrawId,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { orderRef?: string } | null;
    const orderRef = snapshot?.orderRef;
    if (!orderRef) {
      throw new Error(
        `Withdrawal ${withdrawId}: no APPROVED ${actionType} case with an orderRef found in objectSnapshot`,
      );
    }
    return orderRef;
  }

  /**
   * Best-effort Sumsub rescore of the withdrawal's KYT txn after it has resumed
   * into COMPLIANCE_PENDING — the whole point of the unfreeze arc (a fresh
   * verdict driving the state machine post-resume instead of sitting on a stale
   * pre-freeze one). rescore is an EXTERNAL HTTP call — MUST be try/catch'd: by
   * the time this runs, the withdrawal has already committed to
   * COMPLIANCE_PENDING with its WITHDRAW_UNFROZEN audit written, so a failed
   * rescore must only warn and let webhook/manual re-submit recover later; it
   * must NEVER crash or roll back the already-committed resume (I2: the same
   * external-HTTP-must-never-roll-back-committed-state lesson submitSumsubTxn's
   * own try/catch protects against).
   */
  private async triggerUnfreezeRescore(w: { id: string; sumsubTxnId?: string | null }): Promise<void> {
    if (!w.sumsubTxnId) {
      this.logger.warn(
        `Unfreeze rescore skip: withdrawal ${w.id} has no sumsubTxnId — never submitted to Sumsub`,
      );
      return;
    }

    try {
      await this.sumsubTxnClient.rescore(w.sumsubTxnId);
    } catch (err) {
      this.logger.warn(
        `Unfreeze rescore failed for withdrawal ${w.id}: ${(err as Error).message} — ` +
          `withdrawal remains COMPLIANCE_PENDING for webhook/manual re-submit`,
      );
    }
  }

  /**
   * UNFREEZE approved: resume the withdrawal back into the compliance flow.
   * 零记账 — the money never left its CLIENT_ASSET pending lock while FROZEN,
   * so there is no reverse leg to book (unlike a payout failure/return). Order
   * of operations:
   *   1. Guard: only runs from FROZEN — a replayed decided event arriving after
   *      the withdrawal already left FROZEN is a no-op rather than crashing.
   *   2. Fetch orderRef BEFORE mutating anything (fetchApprovedOrderRef) — if
   *      the APPROVED case has no orderRef, throw and leave the withdrawal
   *      untouched.
   *   3. RESUME → COMPLIANCE_PENDING (via withdrawService.updateStatus).
   *   4. Audit WITHDRAW_UNFROZEN with orderRef in the reason.
   *   5. Best-effort Sumsub rescore (triggerUnfreezeRescore) — never crashes.
   * ZERO accounting calls — money stays locked exactly as it was.
   */
  private async onUnfreezeApproved(withdrawId: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.FROZEN) {
      this.logger.warn(
        `onUnfreezeApproved no-op: withdrawal ${withdrawId} not in FROZEN (status=${w.status})`,
      );
      return;
    }

    const orderRef = await this.fetchApprovedOrderRef(w.id, ApprovalActionTypes.WITHDRAW_UNFREEZE);

    await this.withdrawService.updateStatus(
      w.id,
      {
        action: WithdrawTransactionAction.RESUME,
        reason: `Unfreeze approved (order ${orderRef}) — resumed into compliance flow`,
      },
      this.systemCtx,
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_UNFROZEN,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Unfreeze order ${orderRef} — withdrawal resumed to COMPLIANCE_PENDING`,
      sourcePlatform: 'SYSTEM',
    });

    await this.triggerUnfreezeRescore(w);
  }

  /**
   * SANCTION REFUND decided: the V1 approval opened by initiateRefund reached a
   * decision. APPROVED → delegate to onRefundApproved. Any other outcome → log
   * only, the withdrawal stays FROZEN untouched.
   */
  @OnEvent('workflow.withdraw-sanction-refund.decided', { async: true })
  async onRefundDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    if (payload.decision !== 'APPROVED') {
      this.logger.log(
        `Withdrawal ${payload.entityRef} sanction-refund ${payload.decision} (case ${payload.approvalNo}) — original state intact, no refund executed.`,
      );
      return;
    }
    await this.onRefundApproved(payload.entityRef, payload.approvalNo);
  }

  /**
   * SANCTION REFUND approved: reject the withdrawal and release the customer's
   * locked balance back to available. Order mirrors onLargeValueApprovalDecided's
   * rejected branch exactly: updateStatus first, then releaseLock (the P6
   * primitive — voids both net + fee pendings best-effort), then audit.
   * Customer-implication escalation (freezing the customer account itself) has
   * no V2 API yet (BACKLOG) — this is audit-only; the reason notes the
   * escalation is manual.
   */
  private async onRefundApproved(withdrawId: string, approvalNo?: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status !== WithdrawTransactionStatus.FROZEN) {
      this.logger.warn(
        `onRefundApproved no-op: withdrawal ${withdrawId} not in FROZEN (status=${w.status})`,
      );
      return;
    }

    await this.withdrawService.updateStatus(
      w.id,
      {
        action: WithdrawTransactionAction.REJECT_REFUND,
        reason: 'Sanction refund approved (WITHDRAW_SANCTION_REFUND)',
      },
      this.systemCtx,
    );

    await this.releaseLock(w, 'Sanction refund approved (WITHDRAW_SANCTION_REFUND)');

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SANCTION_REFUNDED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'Sanction refund approved — withdrawal rejected and lock released; ' +
        'customer-account escalation is manual (V2 freeze API not yet built, see BACKLOG)',
      metadata: approvalNo ? { approvalNo } : undefined,
      sourcePlatform: 'SYSTEM',
    });
  }

  // ── L3: Post-Tx Archive — fire-and-forget ──

  /**
   * Archives the withdrawal's on-chain txHash into Sumsub KYT (PATCH
   * /resources/kyt/txns/{txnId}/data/info) so the transaction record carries
   * the real crossing reference for future tracing. Guards on both
   * sumsubTxnId and txHash being present — a withdrawal never submitted to
   * Sumsub (no applicant / submit failure) or without a chain txHash (FIAT,
   * or crypto still pending) has nothing to archive yet.
   */
  private async archivePostKyt(withdrawal: {
    id: string;
    withdrawNo: string;
    txHash: string | null;
    sumsubTxnId?: string | null;
  }): Promise<void> {
    if (!withdrawal.sumsubTxnId || !withdrawal.txHash) {
      this.logger.warn(
        `Post-KYT archive skipped for withdrawal ${withdrawal.withdrawNo}: ` +
        `sumsubTxnId=${withdrawal.sumsubTxnId ?? 'MISSING'} txHash=${withdrawal.txHash ?? 'MISSING'}`,
      );
      return;
    }

    await this.sumsubTxnClient.archiveTxHash(withdrawal.sumsubTxnId, withdrawal.txHash);
    this.logger.log(
      `Post-KYT archive: withdrawal ${withdrawal.withdrawNo} txHash=${withdrawal.txHash} archived to Sumsub txn ${withdrawal.sumsubTxnId}`,
    );
  }

  // ── Sumsub single-txn submit (COMPLIANCE_PENDING entry) ──

  /**
   * Submits the withdrawal to Sumsub KYT so a verdict webhook (applyKytVerdict)
   * can later drive the state machine. One withdrawal → one txn; `type` is
   * decided by resolveKytTxnType (mirrors DepositWorkflowService.submitSumsubTxns,
   * direction='out'). Idempotent on sumsubTxnId. If the customer has no
   * sumsubApplicantId yet, warns and skips — the withdrawal stays
   * COMPLIANCE_PENDING awaiting manual handling rather than crashing.
   *
   * I2 (充值教训): the ENTIRE call is wrapped in try/catch — a submit failure
   * (Sumsub down, network error) must never strand the withdrawal; it just stays
   * in COMPLIANCE_PENDING for retry (there is no caller-side try/catch here, unlike
   * deposit's runGate0 wrapper).
   */
  private async submitSumsubTxn(withdrawId: string): Promise<void> {
    try {
      const w = await this.withdrawService.findOneInternal(withdrawId);
      if (w.status !== WithdrawTransactionStatus.COMPLIANCE_PENDING) {
        this.logger.debug(
          `submitSumsubTxn skip: withdrawal ${withdrawId} status is ${w.status}, not COMPLIANCE_PENDING`,
        );
        return;
      }
      if (w.sumsubTxnId) {
        this.logger.debug(
          `submitSumsubTxn skip: withdrawal ${withdrawId} already has sumsubTxnId (idempotent)`,
        );
        return;
      }

      const applicantId = w.customer?.sumsubApplicantId;
      if (!applicantId) {
        this.logger.warn(
          `submitSumsubTxn skip: withdrawal ${withdrawId} customer ${w.ownerId} has no sumsubApplicantId — staying in COMPLIANCE_PENDING for manual handling`,
        );
        return;
      }

      const amount = Number(w.amount);
      const decision = resolveKytTxnType({
        assetType: w.asset?.type,
        currency: w.asset?.currency,
        amount,
        counterpartyIsVasp: w.counterpartyIsVasp,
      });
      const SINGLE_TXN_SUBMIT_ENABLED =
        process.env.SUMSUB_SINGLE_TXN_SUBMIT === 'true' ||
        process.env.SUMSUB_MOCK_MODE === 'true';
      const submitType = SINGLE_TXN_SUBMIT_ENABLED ? decision.type : 'finance';

      const isCrypto = w.asset?.type === 'CRYPTO';
      const currencyType: 'fiat' | 'crypto' = isCrypto ? 'crypto' : 'fiat';

      const result = await this.sumsubTxnClient.submitTxn({
        applicantId,
        clientTxnId: w.withdrawNo,
        type: submitType,
        direction: 'out',
        amount,
        currencyCode: w.asset?.currency,
        currencyType,
      });

      await this.withdrawService.setSumsubTxn(w.id, {
        sumsubTxnId: result.txnId,
        sumsubTxnType: submitType,
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_SUMSUB_SUBMITTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: 'Withdrawal submitted to Sumsub KYT for transaction monitoring',
        metadata: { sumsubTxnId: result.txnId, txnType: submitType, reason: decision.reason },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(
        `Sumsub txn submitted for withdrawal ${w.id}: type=${submitType} txnId=${result.txnId} (decision=${decision.type}/${decision.reason})`,
      );
    } catch (err) {
      this.logger.error(
        `submitSumsubTxn failed for withdrawal ${withdrawId}: ${(err as Error).message} — staying in COMPLIANCE_PENDING for retry`,
      );
    }
  }

  // ── Sumsub KYT verdict application (drives the 20-edge state machine) ──

  /**
   * Sumsub KYT 裁决落地入口(WithdrawKytVerdictHandler 调用)。State-aware: 已终态
   * no-op;FROZEN 迟到 approved 整体 no-op(含存证跳过,保护制裁证据)。分支落 spec
   * §3/§5 的转移表(mirrors DepositWorkflowService.applyKytVerdict)。
   */
  async applyKytVerdict(
    withdrawId: string,
    input: {
      verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold';
      riskScore?: number | null;
      sceneTag?: 'SANCTION' | 'PEP';
      dispoTag?: 'FROZEN_BY_MLRO' | 'REJECT_REFUND';
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    const w = await this.withdrawService.findOneInternal(withdrawId);

    const status = w.status as WithdrawTransactionStatus;
    if (WithdrawWorkflowService.KYT_VERDICT_TERMINAL_STATUSES.has(status)) {
      this.logger.debug(
        `applyKytVerdict no-op: withdrawal ${withdrawId} already terminal (${status})`,
      );
      return;
    }

    // FROZEN 是制裁/MLRO 冻结态,不在 KYT_VERDICT_TERMINAL_STATUSES 里(出口走 §4 的
    // 双审批弧,不是 approve)。一笔迟到/重评的 approved verdict 会跑到这里——如果闸门
    // 回写/存证照常执行,就会用 approved 报文覆写既有的制裁报文,尽管状态机压根没推进。
    // 跳过写回/存证,别让一个必然 no-op 的 approved 静默损坏冻结单的制裁证据。
    // MANUAL_CHECKING 不受影响(它是 approved 的合法翻案路径,必须正常写回)。
    const approvedWillNoOpFrozen =
      input.verdict === 'approved' && status === WithdrawTransactionStatus.FROZEN;

    if (approvedWillNoOpFrozen) {
      this.logger.debug(
        `applyKytVerdict no-op: withdrawal ${withdrawId} is FROZEN, ignoring approved KYT verdict (requires unfreeze approval to resume)`,
      );
      return;
    }

    await this.withdrawService.saveSumsubVerdict(w.id, {
      verdict: input.verdict,
      score: input.riskScore ?? null,
      scoredAt: new Date(),
      ...(input.detailRaw !== undefined && { detailJson: JSON.stringify(input.detailRaw) }),
    });

    // Review Fix 2 (Important): PAYOUT_PENDING post-broadcast verdicts must not
    // dead-letter. PAYOUT_PENDING is deliberately NOT in KYT_VERDICT_TERMINAL_STATUSES
    // (the withdrawal is still active, not terminal) — but none of the four verdict
    // branches below have a legal transition from PAYOUT_PENDING (the payout already
    // broadcast; funds are in flight). Left to the switch, 'approved' would retry
    // initiatePayoutPhase's APPROVE action (no such edge from PAYOUT_PENDING) and
    // throw; 'awaitUser'/rejected's untagged branch would do the same. Evidence is
    // already saved above; just audit the post-broadcast verdict and, for a rejected
    // one, flag the withdrawal for operator review — no branch dispatch.
    if (status === WithdrawTransactionStatus.PAYOUT_PENDING) {
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_POST_BROADCAST_VERDICT,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `KYT verdict '${input.verdict}' received after payout broadcast — no state-machine action taken`,
        metadata: { verdict: input.verdict },
        sourcePlatform: 'SYSTEM',
      });
      if (input.verdict === 'rejected') {
        await this.withdrawService.markNeedsReview(w.id);
      }
      return;
    }

    switch (input.verdict) {
      case 'approved':
        await this.applyKytApproved(w);
        return;
      case 'awaitUser':
        await this.applyKytAwaitUser(w, input.sceneTag, input.applicantActions);
        return;
      case 'onHold':
        await this.applyKytOnHold(w);
        return;
      case 'rejected':
        await this.applyKytRejected(w, input.sceneTag, input.dispoTag);
        return;
    }
  }

  /**
   * approved (from COMPLIANCE_PENDING/ACTION_PENDING/MANUAL_CHECKING — all three
   * carry the APPROVE edge). FROZEN is already filtered out by applyKytVerdict's
   * no-op guard before this runs. MANUAL_CHECKING gets an extra "翻案" audit;
   * the status flip + funds-order creation stays owned by initiatePayoutPhase
   * (single place the APPROVE action fires — do not duplicate the updateStatus
   * call here).
   */
  private async applyKytApproved(w: any): Promise<void> {
    if (w.status === WithdrawTransactionStatus.MANUAL_CHECKING) {
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_MANUAL_APPROVED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: 'KYT verdict approved: manual checking overturned',
        sourcePlatform: 'SYSTEM',
      });
    }
    await this.initiatePayoutPhase(w.id);
  }

  /**
   * awaitUser: ACTION_PENDING (manualReason by sceneTag, slaDeadline+7d atomic
   * write via updateStatus's extraData). Mirrors
   * DepositWorkflowService.applyKytAwaitUser (集合同步 + 零未提交行 guard +
   * 同状态重入清缓存/REISSUED 审计 + 跨状态弧清缓存) — see that method's I1/I2
   * comments for the reasoning; kept identical here since the same two Sumsub
   * clients both return undefined when scoringResult.applicantActions is absent.
   */
  private async applyKytAwaitUser(
    w: any,
    sceneTag?: 'SANCTION' | 'PEP',
    applicantActions?: { applicantActionId: string; externalActionId: string }[],
  ): Promise<void> {
    const incoming = applicantActions ?? [];
    const slaDeadline = new Date(
      Date.now() + WithdrawWorkflowService.ACTION_SLA_DAYS * 24 * 60 * 60 * 1000,
    );

    // 集合同步先做:无论状态动不动,子表都必须与报文的**全量列表**对齐。
    const { added, retired } = await this.applicantActions.syncApplicantActions(
      w.id,
      incoming,
    );

    // I1(mirrors deposit):判据必须是"同步后是否还有未提交行"(hasOutstanding),
    // 不能只看 incoming 是否为空——报文也可能带的全是已经提交过的旧 id。
    const hasOutstanding = await this.applicantActions.hasOutstanding(w.id);

    if (w.status === WithdrawTransactionStatus.ACTION_PENDING) {
      if (!hasOutstanding) {
        // 同状态分支同款死角:"全删成空集"不能当正常的 reissue 处理——
        // 不清缓存、不推进,只记一条 warn 留痕,供排查上游报文异常。
        this.logger.warn(
          `applyKytAwaitUser: withdrawal ${w.id} synced to zero outstanding actions while already ACTION_PENDING, refusing to treat as reissue`,
        );
        await this.auditLogsService.recordSystem({
          action: AuditActions.WITHDRAW_AWAITUSER_EMPTY_ACTIONS,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: w.id,
          entityNo: w.withdrawNo,
          entityOwnerType: w.ownerType,
          entityOwnerId: w.ownerId,
          traceId: w.traceId || undefined,
          workflowType: AuditWorkflowTypes.WITHDRAW,
          reason:
            'Sumsub awaitUser synced to zero outstanding actions while already ACTION_PENDING — kept existing cache, not treated as reissue',
          metadata: { addedSeqs: added, retiredSeqs: retired },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }

      // I2(mirrors deposit):判据必须读持久状态(actionSubmittedAt 是否还残留旧的
      // "已交齐"值),不能用本次 syncApplicantActions 返回的 added/retired 是否为空
      // 来判断——webhook 重试场景下 syncOnce 可能已 no-op,但缓存仍需清。
      if (w.actionSubmittedAt == null) return; // 缓存本就干净,真 no-op

      await this.applicantActions.clearWithdrawCache(w.id, slaDeadline);
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_ACTION_REISSUED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: 'Sumsub changed the applicant-action set while already ACTION_PENDING',
        metadata: {
          addedSeqs: added,
          retiredSeqs: retired,
          // 审计是 operator 面,必须带真 id,否则运营对不上 Sumsub 后台。
          incomingActionIds: incoming.map((a) => a.applicantActionId),
        },
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    // FROZEN has no ACTION_PENDING edge (it exits only via RESUME / REJECT_REFUND —
    // and, per Fix 1, REJECT_REFUND itself is now gated behind Task 9's
    // double-approval). A stale/late awaitUser verdict arriving after the sanctions
    // freeze must not throw; treat it as an idempotent no-op. Sub-table is still
    // synced above (mirrors deposit's "无论状态动不动都同步" invariant) — only the
    // status transition itself is skipped.
    if (w.status === WithdrawTransactionStatus.FROZEN) {
      this.logger.debug(
        `applyKytAwaitUser no-op: withdrawal ${w.id} is FROZEN, ignoring awaitUser verdict`,
      );
      return;
    }

    if (!hasOutstanding) {
      // 跨状态弧(COMPLIANCE_PENDING/MANUAL_CHECKING → ACTION_PENDING)同款死角:
      // 同步之后没有任何未提交行,不能推进到 ACTION_PENDING——单子留在原状态,
      // 只记一条 warn 留痕。
      this.logger.warn(
        `applyKytAwaitUser: withdrawal ${w.id} received awaitUser verdict with zero outstanding actions after sync, keeping status ${w.status}`,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_AWAITUSER_EMPTY_ACTIONS,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason:
          'Sumsub sent awaitUser verdict with no outstanding applicant actions — refused to move into ACTION_PENDING with nothing for the customer to act on',
        metadata: { fromStatus: w.status, incomingCount: incoming.length },
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    const manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION';
    // actionSubmittedAt/slaBreached 必须在这条跨状态弧(常见于 MANUAL_CHECKING →
    // ACTION_PENDING,Sumsub officer 把已进人工复核的单又打回 awaitingUser)里
    // 一并清掉——它们是两个独立的持久字段,updateStatus 不会替你清,不显式写就会
    // 原样带过去,客户此前交过的材料让缓存留着旧值,客户端会一直显示"已收到,
    // 审核中",客户被永久卡死。single atomic updateStatus call(mirrors deposit)。
    await this.withdrawService.updateStatus(
      w.id,
      { action: WithdrawTransactionAction.ACTION_PENDING, reason: 'KYT verdict: awaitUser' },
      {
        ...this.systemCtx,
        extraData: { manualReason, slaDeadline, actionSubmittedAt: null, slaBreached: false },
      },
    );
  }

  /**
   * onHold: non-transitional — only refreshes slaDeadline + audits when the
   * withdrawal is currently COMPLIANCE_PENDING (spec §3: "非转移边"). A late
   * onHold webhook arriving after the withdrawal already moved on
   * (ACTION_PENDING/MANUAL_CHECKING/FROZEN/...) is a no-op.
   */
  private async applyKytOnHold(w: any): Promise<void> {
    if (w.status !== WithdrawTransactionStatus.COMPLIANCE_PENDING) {
      this.logger.debug(
        `applyKytOnHold no-op: withdrawal ${w.id} not in COMPLIANCE_PENDING (status=${w.status}), late onHold webhook ignored`,
      );
      return;
    }

    const slaDeadline = new Date(
      Date.now() + WithdrawWorkflowService.ONHOLD_SLA_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.withdrawService.setSlaDeadline(w.id, slaDeadline);

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_ONHOLD,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'KYT verdict: onHold, awaiting officer review',
      metadata: { slaDeadline: slaDeadline.toISOString() },
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * rejected: tag 三分支(spec §3)。
   *   SANCTION(场景) / FROZEN_BY_MLRO(处置) → FREEZE(免审批,收紧方向)
   *   REJECT_REFUND(处置)                  → REJECT_REFUND → REJECTED + releaseLock
   *   无 tag                                → KYT_REJECTED → MANUAL_CHECKING
   * All three idempotent when already in the target state (repeat webhook).
   */
  private async applyKytRejected(
    w: any,
    sceneTag?: 'SANCTION' | 'PEP',
    dispoTag?: 'FROZEN_BY_MLRO' | 'REJECT_REFUND',
  ): Promise<void> {
    if (sceneTag === 'SANCTION' || dispoTag === 'FROZEN_BY_MLRO') {
      if (w.status === WithdrawTransactionStatus.FROZEN) return; // already frozen — repeat webhook

      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.FREEZE, reason: 'KYT verdict: rejected' },
        this.systemCtx,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_FROZEN,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `KYT verdict rejected: ${sceneTag === 'SANCTION' ? 'SANCTION hit' : 'FROZEN_BY_MLRO disposition'}`,
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    if (dispoTag === 'REJECT_REFUND') {
      // Sanctioned free-of-approval path: an officer already tagged this case for
      // refund during manual compliance review — MANUAL_CHECKING carries the
      // REJECT_REFUND edge (Task 1's transitions table) for exactly this.
      if (w.status === WithdrawTransactionStatus.MANUAL_CHECKING) {
        await this.withdrawService.updateStatus(
          w.id,
          { action: WithdrawTransactionAction.REJECT_REFUND, reason: 'KYT verdict: rejected, officer refund tag' },
          this.systemCtx,
        );
        await this.releaseLock(w, 'Officer refund tag');
        await this.auditLogsService.recordSystem({
          action: AuditActions.WITHDRAW_REFUNDED_BY_TAG,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: w.id,
          entityNo: w.withdrawNo,
          entityOwnerType: w.ownerType,
          entityOwnerId: w.ownerId,
          traceId: w.traceId || undefined,
          workflowType: AuditWorkflowTypes.WITHDRAW,
          reason: 'KYT verdict rejected: officer REJECT_REFUND tag — void pending locks, refund to available balance',
          sourcePlatform: 'SYSTEM',
        });
        return;
      }

      // Review Fix 1 (Critical): FROZEN is a sanctions/MLRO hold. The transitions
      // table structurally also carries a FROZEN --REJECT_REFUND--> REJECTED edge
      // (added for the MANUAL_CHECKING case above, shared by the same action), but
      // letting this tag drive it here would let a single system-applied tag exit
      // a sanctions freeze with NO maker-checker — defeating the entire point of
      // freezing. A FROZEN withdrawal must exit ONLY via the WITHDRAW_UNFREEZE /
      // WITHDRAW_SANCTION_REFUND double-approval arcs (Task 8-9, not yet built).
      // Ignore the tag: no status change, no releaseLock — just an audit trail so
      // an officer can see the attempt and route it through the approval flow.
      if (w.status === WithdrawTransactionStatus.FROZEN) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED,
          entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
          entityId: w.id,
          entityNo: w.withdrawNo,
          entityOwnerType: w.ownerType,
          entityOwnerId: w.ownerId,
          traceId: w.traceId || undefined,
          workflowType: AuditWorkflowTypes.WITHDRAW,
          reason: 'KYT verdict rejected: officer REJECT_REFUND tag ignored — withdrawal is FROZEN, exits only via WITHDRAW_UNFREEZE / WITHDRAW_SANCTION_REFUND maker-checker approvals (Task 9)',
          sourcePlatform: 'SYSTEM',
        });
        return;
      }

      // Landing pad: REJECT_REFUND has no transition edge from COMPLIANCE_PENDING /
      // ACTION_PENDING (only MANUAL_CHECKING/FROZEN do). Land on KYT_REJECTED →
      // MANUAL_CHECKING instead of letting updateStatus throw on the missing edge;
      // keep the tag in the reason so an officer can re-drive the refund once the
      // case is in manual review.
      await this.withdrawService.updateStatus(
        w.id,
        {
          action: WithdrawTransactionAction.KYT_REJECTED,
          reason: `KYT verdict: rejected, officer refund tag arrived early (status=${w.status}) — landed in manual review for re-drive`,
        },
        this.systemCtx,
      );
      return;
    }

    // no tag → routed to manual compliance review
    if (w.status === WithdrawTransactionStatus.MANUAL_CHECKING) return; // already there — repeat webhook

    // FROZEN has no KYT_REJECTED edge (exits only via RESUME / REJECT_REFUND, and
    // REJECT_REFUND is now gated behind Task 9 per Fix 1 above). An untagged
    // rejected verdict arriving after the sanctions freeze is idempotent
    // confirmation of the existing hold — no-op rather than throw.
    if (w.status === WithdrawTransactionStatus.FROZEN) {
      this.logger.debug(
        `applyKytRejected no-op: withdrawal ${w.id} is FROZEN, ignoring untagged rejected verdict`,
      );
      return;
    }

    await this.withdrawService.updateStatus(
      w.id,
      { action: WithdrawTransactionAction.KYT_REJECTED, reason: 'KYT verdict: rejected, no disposition tag' },
      this.systemCtx,
    );
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }
}

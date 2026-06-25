import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FundsFlowService } from '../../funds-layer/domain/funds-flow.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes, AuditWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { buildSwapLegPlan, LegAccounting, SwapLegSpec } from '../../funds-layer/constants/swap-leg-plan.constant';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { deterministicTransferId } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { InternalFundAction, InternalFundStatus } from '../../funds-layer/dto/internal-fund.dto';
import { DomainEventNames } from '../../../common/events/domain-events.constants';

/** Terminal failure statuses that trigger void + FAILED */
const TERMINAL_FAIL = new Set<InternalFundStatus>([
  InternalFundStatus.FAILED,
  InternalFundStatus.TIMEOUT,
  InternalFundStatus.RETURNED,
]);

export interface SwapSettleCtx {
  swapId: string;
  swapNo: string;
  ownerId: string;
  fromIsFiat: boolean;
  fromAssetId: string;
  toAssetId: string;
  fromLedger: number;
  toLedger: number;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: Prisma.Decimal;
  grossToAmount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  fromDecimals: number;
  toDecimals: number;
}

@Injectable()
export class SwapSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
    private readonly swaps: SwapTransactionsService,
    private readonly auditLogs: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Amount helpers ──

  private amountDecimal(amountRef: string, ctx: SwapSettleCtx): Prisma.Decimal {
    if (amountRef === 'from') return ctx.fromAmount;
    if (amountRef === 'grossTo') return ctx.grossToAmount;
    if (amountRef === 'fee') return ctx.feeAmount;
    throw new Error(`Unknown amountRef: ${amountRef}`);
  }

  private amountBigint(amountRef: string, ctx: SwapSettleCtx): bigint {
    const dec = this.amountDecimal(amountRef, ctx);
    const decimals = amountRef === 'from' ? ctx.fromDecimals : ctx.toDecimals;
    return this.decimalToBigint(dec, decimals);
  }

  private decimalToBigint(value: Prisma.Decimal, decimals: number): bigint {
    const str = value.toFixed(decimals);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  private ledgerFor(side: string, ctx: SwapSettleCtx): number {
    return side === 'from' ? ctx.fromLedger : ctx.toLedger;
  }

  private currencyFor(side: string, ctx: SwapSettleCtx): string {
    return side === 'from' ? ctx.fromCurrency : ctx.toCurrency;
  }

  private legPrimaryAmountDecimal(spec: SwapLegSpec, ctx: SwapSettleCtx): Prisma.Decimal {
    return this.amountDecimal(spec.accounting[0].amountRef, ctx);
  }

  // ── Account resolution ──

  private async resolveAcct(
    code: number,
    ledger: number,
    ownerId: string,
  ): Promise<bigint> {
    if (code === TB_ACCOUNT_CODES.CLIENT_PAYABLE) {
      return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'CUSTOMER', ownerUuid: ownerId });
    }
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
  }

  // ── Evidence builder ──

  private evidence(ctx: SwapSettleCtx, a: LegAccounting) {
    return {
      sourceType: 'SWAP',
      sourceNo: ctx.swapNo,
      eventCode: a.eventCode,
      debitCode: TB_CODE_TO_COA[a.debitCode],
      creditCode: TB_CODE_TO_COA[a.creditCode],
      assetCurrency: this.currencyFor(a.side, ctx),
      traceId: ctx.swapNo,
      actorType: 'SYSTEM',
      actorId: 'SWAP_SETTLEMENT',
      memo: `swap leg ${a.eventCode}`,
    };
  }

  // ── Wallet resolution (best-effort, informational only) ──

  private async resolveWallet(assetId: string, role: string, ownerId: string): Promise<string | null> {
    try {
      const customerRoles = ['C_DEP', 'C_VIBAN'];
      if (customerRoles.includes(role)) {
        const w = await this.wallets.resolveCustomer(assetId, role, ownerId);
        return w?.id ?? null;
      }
      const w = await this.wallets.resolve(assetId, role);
      return w?.id ?? null;
    } catch {
      return null;
    }
  }

  // ── Load leg row inside transaction ──

  private async legRow(swapTransactionId: string, legSeq: number, client: any): Promise<any> {
    const row = await client.internalFund.findFirst({
      where: { swapTransactionId, legSeq },
    });
    if (!row) throw new NotFoundException(`Leg ${legSeq} not found for swap ${swapTransactionId}`);
    return row;
  }

  // ── Reconstruct ctx from swap row ──

  private ctxFromSwap(swap: any): SwapSettleCtx {
    const fromAsset = swap.fromAsset;
    const toAsset = swap.toAsset;
    const fromCurrency: string = fromAsset?.currency ?? '';
    const toCurrency: string = toAsset?.currency ?? '';

    // Fix D: throw if ledger is not resolvable — prevents silent 0-ledger posting
    const fromLedger = (TB_LEDGERS as Record<string, number>)[fromCurrency];
    if (!fromLedger) throw new BadRequestException(`SWAP_UNRESOLVABLE_LEDGER: cannot resolve ledger for currency "${fromCurrency}"`);
    const toLedger = (TB_LEDGERS as Record<string, number>)[toCurrency];
    if (!toLedger) throw new BadRequestException(`SWAP_UNRESOLVABLE_LEDGER: cannot resolve ledger for currency "${toCurrency}"`);

    return {
      swapId: swap.id,
      swapNo: swap.swapNo,
      ownerId: swap.ownerId,
      fromIsFiat: fromAsset?.type === 'FIAT',
      fromAssetId: swap.fromAssetId,
      toAssetId: swap.toAssetId,
      fromLedger,
      toLedger,
      fromCurrency,
      toCurrency,
      fromAmount: new Prisma.Decimal(swap.fromAmount),
      grossToAmount: new Prisma.Decimal(swap.toAmount), // toAmount = gross
      feeAmount: new Prisma.Decimal(swap.feeAmount ?? 0),
      fromDecimals: fromAsset?.decimals ?? 8,
      toDecimals: toAsset?.decimals ?? 8,
    };
  }

  // ── initiateLegPending: book pending TB transfers for a leg (no transition) ──

  /**
   * Books pending TB transfers for a leg's accounting entries (amount > 0).
   * Shared between start() (leg1) and advanceLeg() (legs 2-4 on first advance).
   * Does NOT call transitionSwapLeg — caller is responsible for the transition.
   */
  private async initiateLegPending(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const ledger = this.ledgerFor(a.side, ctx);
      const debitId = await this.resolveAcct(a.debitCode, ledger, ctx.ownerId);
      const creditId = await this.resolveAcct(a.creditCode, ledger, ctx.ownerId);
      await this.accounting.executePendingTransfer({
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: amt,
        ledger,
        code: a.code,
        timeout: 0,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
    }
  }

  // ── postLeg: post all pending transfers for a leg ──

  private async postLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const pendingId = deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, 0);
      await this.accounting.postPendingTransfer({
        pendingTransferId: pendingId,
        amount: amt,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
    }
  }

  // ── voidLeg: void all pending transfers for a leg ──

  private async voidLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const pendingId = deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, 0);
      await this.accounting.voidPendingTransfer({
        pendingTransferId: pendingId,
        amount: amt,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
    }
  }

  // ── Public: start ──

  /**
   * Called within an outer transaction when a swap first enters SETTLING.
   * Creates all 4 legs and initiates leg 1 (books pending + advances status).
   */
  async start(ctx: SwapSettleCtx, tx: Prisma.TransactionClient): Promise<void> {
    const legs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
    let leg1Id: string | undefined;

    for (const spec of legs) {
      const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
      const amount = this.legPrimaryAmountDecimal(spec, ctx);

      // Resolve wallets best-effort (informational)
      const fromWalletId = await this.resolveWallet(assetId, spec.fromRole, ctx.ownerId);
      const toWalletId = await this.resolveWallet(assetId, spec.toRole, ctx.ownerId);

      const created = await this.fundsFlow.createSwapLeg(
        { swapTransactionId: ctx.swapId, legSeq: spec.legSeq, assetId, amount, fromWalletId, toWalletId },
        'SYSTEM',
        tx,
      );
      if (spec.legSeq === 1) leg1Id = (created as any).id;
    }

    // Initiate leg 1 immediately: book pending transfers then transition out of CREATED
    await this.initiateLegPending(ctx, legs[0], tx);
    const leg1IsFiat = ctx.fromIsFiat; // leg1 side='from'
    const leg1Action = leg1IsFiat ? InternalFundAction.SUBMIT : InternalFundAction.SIGN;
    await this.fundsFlow.transitionSwapLeg(leg1Id!, leg1Action, 'SYSTEM', tx);
  }

  // ── Public: advanceLeg ──

  /**
   * Admin (or webhook) calls this to advance a specific leg.
   * Enforces sequence order, triggers post/void/SUCCESS/FAILED.
   *
   * Per-leg lazy initiation model (spec §6 step 2):
   *   - Legs 2-4 start in CREATED. Their pending is booked here, on FIRST advance.
   *   - CLEAR of a mid-leg does NOT auto-initiate the next leg (operator drives each leg).
   *   - CLEAR of the last leg marks swap SUCCESS (with audit).
   *   - Any terminal-fail voids the leg and marks swap FAILED (with audit).
   *   - Intermediate hops (not CLEAR, not terminal-fail) just advance status — no accounting.
   */
  async advanceLeg(
    swapNo: string,
    legSeq: number,
    action: InternalFundAction,
    operatorId: string,
  ): Promise<any> {
    let emitSuccess = false;
    let swapIdForEvent: string | undefined;
    let swapNoForEvent: string | undefined;
    let ownerIdForEvent: string | undefined;

    const result = await this.prisma.$transaction(async (client) => {
      const swap = await this.swaps.findByNoInternal(swapNo, client as any);
      if (swap.status !== 'SETTLING') {
        throw new BadRequestException('Swap is not in SETTLING status');
      }

      // Load all legs ordered by legSeq
      const legs = await (client as any).internalFund.findMany({
        where: { swapTransactionId: swap.id },
        orderBy: { legSeq: 'asc' },
        include: { asset: true },
      });

      const target = legs.find((l: any) => l.legSeq === legSeq);
      if (!target) throw new NotFoundException(`Leg ${legSeq} not found`);

      // Sequence guard: all prior legs must be CLEAR
      const priorNotClear = legs.some(
        (l: any) => (l.legSeq ?? 0) < legSeq && l.status !== 'CLEAR',
      );
      if (priorNotClear) {
        throw new BadRequestException('Previous leg is not yet cleared');
      }

      // Rebuild ctx from swap row
      const ctx = this.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
      const spec = allSpecs.find((s) => s.legSeq === legSeq);
      if (!spec) throw new Error(`Spec not found for legSeq ${legSeq}`);

      // Fix A: if this leg is still CREATED (first advance for legs 2-4),
      // book its pending BEFORE transitioning. Both ops are in the same tx:
      // if pending fails, leg stays CREATED and can be retried; deterministic
      // transfer ids make the booking idempotent.
      if (target.status === 'CREATED') {
        await this.initiateLegPending(ctx, spec, client);
      }

      // Transition the target leg
      const { nextStatus } = await this.fundsFlow.transitionSwapLeg(
        target.id,
        action,
        operatorId,
        client as any,
      );

      if (nextStatus === InternalFundStatus.CLEAR) {
        // Post this leg's pending transfers
        await this.postLeg(ctx, spec, client);

        const isLastLeg = !allSpecs.some((s) => s.legSeq === legSeq + 1);
        if (isLastLeg) {
          // All 4 legs cleared — mark SUCCESS + audit
          await this.swaps.markStatus(swap.id, 'SUCCESS', client as any);
          await this.auditLogs.recordSystem(
            {
              action: AuditActions.SWAP_SUCCEEDED,
              entityType: AuditEntityTypes.SWAP_TRANSACTION,
              entityId: swap.id,
              entityNo: swap.swapNo,
              traceId: swap.traceId ?? swap.swapNo,
              workflowType: AuditWorkflowTypes.SWAP,
              entityOwnerType: swap.ownerType,
              entityOwnerId: swap.ownerId,
              reason: 'Swap settlement completed — all 4 legs cleared',
              sourcePlatform: 'SYSTEM',
            },
            client as any,
          );
          emitSuccess = true;
          swapIdForEvent = swap.id;
          swapNoForEvent = swap.swapNo;
          ownerIdForEvent = swap.ownerId;
        }
        // Mid-leg CLEAR: operator will advance the next leg (still CREATED),
        // which will book its pending on that first advance call.
      } else if (TERMINAL_FAIL.has(nextStatus)) {
        // Void this leg's pending transfers + mark FAILED + audit
        await this.voidLeg(ctx, spec, client);
        await this.swaps.markStatus(swap.id, 'FAILED', client as any);
        await this.auditLogs.recordSystem(
          {
            action: AuditActions.SWAP_FAILED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo,
            traceId: swap.traceId ?? swap.swapNo,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            reason: `Swap settlement failed — leg ${legSeq} reached ${nextStatus}`,
            sourcePlatform: 'SYSTEM',
          },
          client as any,
        );
      }
      // Intermediate hops (e.g. SIGNING, BROADCASTED, CONFIRMING, CONFIRMED):
      // no accounting — the transition above already advanced the leg status.

      return this.legRow(swap.id, legSeq, client);
    });

    // Emit AFTER the transaction commits (so event handlers see committed state)
    if (emitSuccess) {
      this.eventEmitter.emit(DomainEventNames.SWAP_SUCCEEDED, {
        swapId: swapIdForEvent,
        swapNo: swapNoForEvent,
        ownerId: ownerIdForEvent,
      });
    }

    return result;
  }

  // ── Public: reverseSwap ──

  /**
   * Compensate (reverse) a FAILED swap: post a REVERSING direct transfer for each
   * accounting entry that was already posted (i.e. belongs to a CLEAR leg), swapping
   * debit/credit to undo the original movement. Marks the swap REVERSED.
   *
   * // TODO retry: deferred (deterministic-id reuse needs attempt counter)
   */
  async reverseSwap(swapNo: string, operatorId: string): Promise<any> {
    return this.prisma.$transaction(async (client) => {
      const swap = await this.swaps.findByNoInternal(swapNo, client as any);
      if (swap.status !== 'FAILED') {
        throw new BadRequestException('Swap must be in FAILED status to reverse');
      }

      // Load all legs for this swap
      const legs: any[] = await (client as any).internalFund.findMany({
        where: { swapTransactionId: swap.id },
        orderBy: { legSeq: 'asc' },
      });

      const ctx = this.ctxFromSwap(swap);
      const allSpecs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });

      // For each CLEAR (posted) leg, post reversing transfers (swapped dr/cr)
      for (const leg of legs) {
        if (leg.status !== 'CLEAR') continue;

        const spec = allSpecs.find((s) => s.legSeq === leg.legSeq);
        if (!spec) continue;

        for (const a of spec.accounting) {
          const amt = this.amountBigint(a.amountRef, ctx);
          if (amt <= 0n) continue;

          const ledger = this.ledgerFor(a.side, ctx);
          // Original: debit=a.debitCode, credit=a.creditCode
          // Reverse:  debit=a.creditCode, credit=a.debitCode
          const debitId = await this.resolveAcct(a.creditCode, ledger, ctx.ownerId);
          const creditId = await this.resolveAcct(a.debitCode, ledger, ctx.ownerId);

          await this.accounting.executeTransfer({
            debitAccountId: debitId,
            creditAccountId: creditId,
            amount: amt,
            ledger,
            code: a.code,
            evidence: {
              ...this.evidence(ctx, a),
              eventCode: a.eventCode + '_REVERSE',
              memo: 'reverse failed swap leg',
            },
            tx: client as any,
          });
        }
      }

      await this.swaps.markStatus(swap.id, 'REVERSED', client as any);

      await this.auditLogs.recordSystem(
        {
          action: AuditActions.SWAP_REVERSED,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          traceId: swap.traceId ?? swap.swapNo,
          workflowType: AuditWorkflowTypes.SWAP,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          reason: `Swap reversed by operator ${operatorId}`,
          sourcePlatform: 'SYSTEM',
        },
        client as any,
      );

      return swap;
    });
  }
}

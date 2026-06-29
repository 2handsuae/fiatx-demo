import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { buildSwapLegPlan, LegAccounting, SwapLegSpec } from '../../funds-layer/constants/swap-leg-plan.constant';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { deterministicTransferId } from '../../accounting/tigerbeetle/utils/tb-id.util';

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
  /**
   * Per-leg attempt count for self-heal retries (Swap-6). Defaults to 1 when
   * absent. Callers override via `{ ...ctx, attempt: N }` to produce distinct
   * deterministic TB transfer IDs and externalRefs across attempts.
   */
  attempt?: number;
}

@Injectable()
export class SwapLegAccounting {
  constructor(
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
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

  /**
   * Build the base evidence params for a leg-accounting entry, optionally
   * augmented with Phase B per-physical-wallet recon fields.
   *
   * Phase B fields:
   *   debit/creditWalletRef → physical wallet on each side (resolved per TB code).
   *   externalRef           → swap-internal reference `${swapNo}:${legSeq}:${phase}`.
   *                           Swaps don't broadcast on-chain, so the swap-internal
   *                           prefix IS the cross-validation key.
   *   isExternalCrossing    → true for all swap legs in this codebase (all are
   *                           genuine cross-wallet moves per swap-leg-plan).
   */
  private evidence(
    ctx: SwapSettleCtx,
    a: LegAccounting,
    extra?: {
      eventCodeOverride?: string;
      memoOverride?: string;
      debitWalletRef?: string | null;
      creditWalletRef?: string | null;
      externalRef?: string | null;
      isExternalCrossing?: boolean;
    },
  ) {
    return {
      sourceType: 'SWAP',
      sourceNo: ctx.swapNo,
      eventCode: extra?.eventCodeOverride ?? a.eventCode,
      debitCode: TB_CODE_TO_COA[a.debitCode],
      creditCode: TB_CODE_TO_COA[a.creditCode],
      assetCurrency: this.currencyFor(a.side, ctx),
      traceId: ctx.swapNo,
      actorType: 'SYSTEM',
      actorId: 'SWAP_SETTLEMENT',
      memo: extra?.memoOverride ?? `swap leg ${a.eventCode}`,
      // Phase B per-physical-wallet recon (forwarded by AccountingService to TbEvidenceService)
      debitWalletRef: extra?.debitWalletRef ?? null,
      creditWalletRef: extra?.creditWalletRef ?? null,
      externalRef: extra?.externalRef ?? null,
      isExternalCrossing: extra?.isExternalCrossing ?? false,
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

  // ── Phase B walletRef-by-TB-code helper ──

  /**
   * Phase B: resolve the physical wallet that a TB-code side of an accounting
   * entry sits on. Best-effort — returns null on miss so the evidence row is
   * still written (recon just can't pair this row by wallet).
   *
   * Mapping (per Phase B spec §4):
   *   CLIENT_PAYABLE       → customer's wallet for this leg's customer role
   *   CLIENT_ASSET (agg.)  → SAME customer wallet (carried for audit drill-down)
   *   FIRM_OPS             → platform's F_OPS wallet for this leg's asset
   *   FIRM_SET             → platform's F_SET wallet
   *   FIRM_FEE             → platform's F_FEE wallet
   *   FIRM_ASSET (agg.)    → matched to the OTHER side's firm role (the entry's
   *                          counterpart equity), so the aggregate row carries
   *                          the same firm wallet as its equity counterpart.
   */
  private async walletRefForCode(
    code: number,
    counterpartCode: number,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
  ): Promise<string | null> {
    const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;

    // Customer side: CLIENT_PAYABLE or its aggregate counterpart CLIENT_ASSET
    if (
      code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ||
      code === TB_ACCOUNT_CODES.CLIENT_ASSET
    ) {
      // Pick whichever of fromRole/toRole is the customer role on this leg
      const customerRole = spec.fromRole.startsWith('C_')
        ? spec.fromRole
        : spec.toRole.startsWith('C_')
        ? spec.toRole
        : null;
      if (!customerRole) return null;
      return this.resolveWallet(assetId, customerRole, ctx.ownerId);
    }

    // Firm equity side: direct mapping to the role
    const equityRoleMap: Record<number, string> = {
      [TB_ACCOUNT_CODES.FIRM_OPS]: 'F_OPS',
      [TB_ACCOUNT_CODES.FIRM_SET]: 'F_SET',
      [TB_ACCOUNT_CODES.FIRM_FEE]: 'F_FEE',
    };
    if (equityRoleMap[code]) {
      return this.resolveWallet(assetId, equityRoleMap[code], ctx.ownerId);
    }

    // FIRM_ASSET (aggregate): inherit the counterpart equity's wallet for audit
    if (code === TB_ACCOUNT_CODES.FIRM_ASSET && equityRoleMap[counterpartCode]) {
      return this.resolveWallet(assetId, equityRoleMap[counterpartCode], ctx.ownerId);
    }

    return null;
  }

  /** Phase B: resolve walletRef pair for a leg accounting entry. */
  private async resolveLegWalletRefs(
    a: LegAccounting,
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
  ): Promise<{ debitWalletRef: string | null; creditWalletRef: string | null }> {
    const debitWalletRef = await this.walletRefForCode(a.debitCode, a.creditCode, spec, ctx);
    const creditWalletRef = await this.walletRefForCode(a.creditCode, a.debitCode, spec, ctx);
    return { debitWalletRef, creditWalletRef };
  }

  // ── R1: per-leg from/to wallet resolution (workflow IF columns) ──
  //
  // The InternalFund row for a swap leg has two FK columns — fromWalletId,
  // toWalletId — that must be populated per R1 (verify-demo-data):
  //   • Customer-side leg (fromRole or toRole starts with 'C_'):
  //       at least one side is the customer's wallet; the firm side is the
  //       platform wallet for the leg's asset. Both sides are filled in
  //       practice — `fromRole→toRole` are both on the same asset.
  //   • Firm-only leg (no C_ role): both sides are platform wallets.
  //
  // Each leg lives on a single asset (`spec.side === 'from' ? fromAssetId :
  // toAssetId`). fromRole and toRole both resolve against that asset.

  /**
   * Resolve the (fromWalletId, toWalletId) pair for the InternalFund row of a
   * swap leg. Each leg lives on a single asset (fromRole and toRole both
   * resolve against `spec.side === 'from' ? fromAssetId : toAssetId`).
   * Customer roles (C_DEP/C_VIBAN) resolve to the customer's wallet for
   * ctx.ownerId; firm roles (F_OPS/F_SET/F_FEE/F_LIQ) resolve to the
   * platform wallet. Best-effort — returns null on miss so the caller can
   * apply R1 validation and throw a structured error.
   */
  async resolveLegWallets(
    spec: SwapLegSpec,
    ctx: SwapSettleCtx,
  ): Promise<{ fromWalletId: string | null; toWalletId: string | null }> {
    const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
    const fromWalletId = await this.resolveWallet(assetId, spec.fromRole, ctx.ownerId);
    const toWalletId = await this.resolveWallet(assetId, spec.toRole, ctx.ownerId);
    return { fromWalletId, toWalletId };
  }

  // ── Reconstruct ctx from swap row ──

  ctxFromSwap(swap: any): SwapSettleCtx {
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
      // attempt is per-leg, not per-swap — callers override via `{ ...ctx, attempt: N }`.
      attempt: 1,
    };
  }

  // ── initiateLegPending: book pending TB transfers for a leg (no transition) ──

  /**
   * Books pending TB transfers for a leg's accounting entries (amount > 0).
   * Shared between start() (leg1) and advanceLeg() (legs 2-4 on first advance).
   * Does NOT call transitionSwapLeg — caller is responsible for the transition.
   */
  async initiateLegPending(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    // Phase B: every swap leg is a real cross-wallet movement (per swap-leg-plan
    // there are no pure-bookkeeping legs). externalRef = `${swapNo}:${legSeq}:${attempt}:pending`
    // serves as the cross-validation key — swaps don't broadcast on-chain, so the
    // swap-internal reference IS sufficient for §8 recon. The attempt segment lets
    // the same swap+legSeq retain distinct refs across self-heal retries (Swap-6).
    const attempt = ctx.attempt ?? 1;
    const externalRef = `${ctx.swapNo}:${spec.legSeq}:${attempt}:pending`;
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const ledger = this.ledgerFor(a.side, ctx);
      const debitId = await this.resolveAcct(a.debitCode, ledger, ctx.ownerId);
      const creditId = await this.resolveAcct(a.creditCode, ledger, ctx.ownerId);
      const { debitWalletRef, creditWalletRef } = await this.resolveLegWalletRefs(a, spec, ctx);
      await this.accounting.executePendingTransfer({
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: amt,
        ledger,
        code: a.code,
        timeout: 0,
        evidence: this.evidence(ctx, a, {
          debitWalletRef,
          creditWalletRef,
          externalRef,
          isExternalCrossing: true,
        }),
        tx: client,
        // Self-heal: keep TB pending id aligned with post/void's deterministicTransferId
        // (`attempt` as the 4th arg). Without this, retried legs collide on attempt=0.
        legIndex: attempt,
      });
    }
  }

  // ── postLeg: post all pending transfers for a leg ──

  async postLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    // Phase B: postPendingTransfer flips transferType on the existing evidence
    // row (no new row, no field rewrite). The walletRef/externalRef/crossing
    // captured at initiateLegPending therefore survive POST untouched. The
    // pending ID is keyed by attempt (Swap-6) so retries reference distinct
    // TB transfers from the original attempt.
    const attempt = ctx.attempt ?? 1;
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const pendingId = deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, attempt);
      await this.accounting.postPendingTransfer({
        pendingTransferId: pendingId,
        amount: amt,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
    }
  }

  // ── voidLeg: void all pending transfers for a leg ──

  async voidLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> {
    // Phase B: same as POST — void flips transferType only, no new evidence row.
    // Pending ID is keyed by attempt (Swap-6) so self-heal voids the right
    // attempt's pending transfers without colliding with retries.
    const attempt = ctx.attempt ?? 1;
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const pendingId = deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, attempt);
      await this.accounting.voidPendingTransfer({
        pendingTransferId: pendingId,
        amount: amt,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
    }
  }
}

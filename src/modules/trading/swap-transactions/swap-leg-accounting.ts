import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { buildSwapLegPlan, cashSideRole, EntrySide, LegAccounting, SwapLegSpec } from '../../funds-layer/constants/swap-leg-plan.constant';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA, isCashCode } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { deterministicTransferId, bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';

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
 * ⚠️ 双胞胎引擎互认（站3-α，2026-08-27）：本引擎与 funds-orders/disposition.service.ts
 * （充值处置动词层）是同一「按次画圈→落笔/擦圈」模式的两套实现，刻意不合并；
 * 改任一侧的占位/编号语义时必须对照另一侧。
   * Per-leg attempt count for self-heal retries (Swap-6). Defaults to 1 when
   * absent. Callers override via `{ ...ctx, attempt: N }` to produce distinct
   * deterministic TB transfer IDs across attempts (each attempt is its own
   * funds_order, so its externalRef is distinct via the fundsOrderNo seed).
   */
  attempt?: number;
}

@Injectable()
export class SwapLegAccounting {
  constructor(
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
    private readonly tbEvidence: TbEvidenceService,
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

  // ── Account resolution ──

  /**
   * 戊波一:现金类(1 客户现金 / 50 公司现金)每个钱包一户——同一腿内,现金贷方 = 该腿 fromRole 的钱包、
   * 现金借方 = toRole 的钱包(cashSideRole);客户角色(C_*)按 ctx.ownerId 解析,平台角色按资产解析。
   * 现金户只经 resolveCashAccountId 取(没开户即抛,记账失败 = 流程失败);应付按客户;其余(权益 / 收入)按系统户。
   */
  private async resolveAcct(
    code: number,
    ledger: number,
    ctx: SwapSettleCtx,
    spec: SwapLegSpec,
    side: EntrySide,
    client?: any,
  ): Promise<bigint> {
    if (isCashCode(code)) {
      const role = cashSideRole(spec, side);
      const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
      const walletId = await this.resolveWallet(assetId, role, ctx.ownerId, client);
      if (!walletId) {
        throw new NotFoundException({
          code: 'SWAP_CASH_WALLET_NOT_FOUND',
          message: `Swap ${ctx.swapNo} leg ${spec.legSeq}: no ${role} wallet to hold the ${side} cash account`,
        });
      }
      return this.accounting.resolveCashAccountId(walletId, ledger, client);
    }
    if (code === TB_ACCOUNT_CODES.CLIENT_PAYABLE) {
      return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'CUSTOMER', ownerUuid: ctx.ownerId }, client);
    }
    return this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' }, client);
  }

  // ── Evidence builder ──

  /**
   * Build the base evidence params for a leg-accounting entry.
   *
   * 戊波一:钱包落点由账户本身表达(现金户一钱包一户),证据不再带 debit/creditWalletRef(钱包标签由投影器按注册表派生)。
   * externalRef 归该腿资金单所有(crypto→txHash / fiat→referenceNo,CONFIRMED 时铸号),
   * 由 postLeg → enrichForPost 盖到 POSTED 证据行上,这里不带。
   */
  private evidence(
    ctx: SwapSettleCtx,
    a: LegAccounting,
    extra?: {
      eventCodeOverride?: string;
      memoOverride?: string;
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
      externalRef: null,
    };
  }

  // ── Wallet resolution (miss → null; 现金户解析 / R1 校验各自按 null 抛错) ──

  private async resolveWallet(assetId: string, role: string, ownerId: string, client?: any): Promise<string | null> {
    try {
      const customerRoles = ['C_DEP', 'C_VIBAN'];
      if (customerRoles.includes(role)) {
        const w = await this.wallets.resolveCustomer(assetId, role, ownerId, client);
        return w?.id ?? null;
      }
      const w = await this.wallets.resolve(assetId, role, client);
      return w?.id ?? null;
    } catch {
      return null;
    }
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
    client?: any,
  ): Promise<{ fromWalletId: string | null; toWalletId: string | null }> {
    const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
    const fromWalletId = await this.resolveWallet(assetId, spec.fromRole, ctx.ownerId, client);
    const toWalletId = await this.resolveWallet(assetId, spec.toRole, ctx.ownerId, client);
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
    // 每条兑换腿都是真实跨钱包移动(swap-leg-plan 里没有纯记账腿)。
    // externalRef 归 funds_order 所有,在腿达到 CONFIRMED 时由 postLeg → enrichForPost 补写真实铸号;pending 行此刻不带 ref。
    const attempt = ctx.attempt ?? 1;
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const ledger = this.ledgerFor(a.side, ctx);
      const debitId = await this.resolveAcct(a.debitCode, ledger, ctx, spec, 'debit', client);
      const creditId = await this.resolveAcct(a.creditCode, ledger, ctx, spec, 'credit', client);
      await this.accounting.executePendingTransfer({
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: amt,
        ledger,
        code: a.code,
        timeout: 0,
        evidence: this.evidence(ctx, a),
        tx: client,
        // Self-heal: keep TB pending id aligned with post/void's deterministicTransferId
        // (`attempt` as the 4th arg). Without this, retried legs collide on attempt=0.
        legIndex: attempt,
      });
    }
  }

  // ── postLeg: post all pending transfers for a leg ──

  async postLeg(
    ctx: SwapSettleCtx,
    spec: SwapLegSpec,
    client: any,
    externalRef?: string | null,
  ): Promise<void> {
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
      // postPendingTransfer 只翻转 transferType,不重写字段。用 enrichForPost 把
      // funds_order 铸的真实 externalRef 盖进 POSTED evidence 并重投影 account_flows。
      if (externalRef) {
        await this.tbEvidence.enrichForPost(
          bigintToHex(pendingId),
          { externalRef },
          client,
        );
      }
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

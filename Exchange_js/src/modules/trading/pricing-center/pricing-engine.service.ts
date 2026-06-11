import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CalculatedFeeLine,
  FeeItem,
  RoundingMode,
  SwapPricingResult,
  SwapTier,
  WithdrawalPricingResult,
  WithdrawalTier,
} from './types/pricing.types';

interface SwapTierMatchInput {
  tiers: SwapTier[];
  amount: Prisma.Decimal;
}

interface WithdrawalTierMatchInput {
  tiers: WithdrawalTier[];
  amount: Prisma.Decimal;
}

interface SwapQuoteBuildInput {
  amount: Prisma.Decimal;
  baseRate: Prisma.Decimal;
  markupBps: number;
  roundingDp: number;
  roundingMode: RoundingMode;
  quoteLockSeconds: number;
  fees: FeeItem[];
  feeCurrency: string;
  feeDecimals: number;
  createdAt: Date;
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
  baseProvider: string;
  policyCode: string;
  policyId: string;
}

interface WithdrawalQuoteBuildInput {
  amount: Prisma.Decimal;
  fees: FeeItem[];
  feeCurrency: string;
  feeDecimals: number;
  createdAt: Date;
  quoteLockSeconds: number;
  policyCode: string;
  policyId: string;
  assetEntryId: string;
  assetId: string;
  tierId: string;
  tierName: string;
}

@Injectable()
export class PricingEngineService {
  private clampDp(dp: number): number {
    if (!Number.isFinite(dp)) return 8;
    if (dp < 0) return 0;
    if (dp > 18) return 18;
    return Math.floor(dp);
  }

  private toDecimal(value: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal {
    if (value === null || value === undefined || value === '') {
      return new Prisma.Decimal(0);
    }
    return new Prisma.Decimal(value);
  }

  roundDecimal(value: Prisma.Decimal, dp: number, mode: RoundingMode): Prisma.Decimal {
    const normalizedDp = this.clampDp(dp);
    const roundingMode =
      mode === 'FLOOR'
        ? Prisma.Decimal.ROUND_FLOOR
        : mode === 'CEIL'
          ? Prisma.Decimal.ROUND_CEIL
          : Prisma.Decimal.ROUND_HALF_UP;
    return value.toDecimalPlaces(normalizedDp, roundingMode);
  }

  private normalizeMin(value: string | null): Prisma.Decimal {
    return value === null || value === '' ? new Prisma.Decimal('-1e30') : this.toDecimal(value);
  }

  private normalizeMax(value: string | null): Prisma.Decimal {
    return value === null || value === '' ? new Prisma.Decimal('1e30') : this.toDecimal(value);
  }

  private compareAmountRange(
    a: { amountMin: string | null; amountMax: string | null },
    b: { amountMin: string | null; amountMax: string | null },
  ): number {
    const minCompare = this.normalizeMin(a.amountMin).cmp(this.normalizeMin(b.amountMin));
    if (minCompare !== 0) return minCompare;
    return this.normalizeMax(a.amountMax).cmp(this.normalizeMax(b.amountMax));
  }

  private matchAmountRange(
    amount: Prisma.Decimal,
    min: string | null,
    max: string | null,
  ): boolean {
    const minValue = min ? this.toDecimal(min) : null;
    const maxValue = max ? this.toDecimal(max) : null;
    if (minValue && amount.lt(minValue)) {
      return false;
    }
    if (maxValue && amount.gt(maxValue)) {
      return false;
    }
    return true;
  }

  findMatchedSwapTier(input: SwapTierMatchInput): SwapTier | null {
    const sorted = [...input.tiers]
      .filter((tier) => tier.enabled)
      .sort((a, b) => this.compareAmountRange(a.conditions, b.conditions));

    for (const tier of sorted) {
      if (this.matchAmountRange(input.amount, tier.conditions.amountMin, tier.conditions.amountMax)) {
        return tier;
      }
    }
    return null;
  }

  findMatchedWithdrawalTier(input: WithdrawalTierMatchInput): WithdrawalTier | null {
    const sorted = [...input.tiers]
      .filter((tier) => tier.enabled)
      .sort((a, b) => this.compareAmountRange(a.conditions, b.conditions));

    for (const tier of sorted) {
      if (this.matchAmountRange(input.amount, tier.conditions.amountMin, tier.conditions.amountMax)) {
        return tier;
      }
    }

    return null;
  }

  calculateFeeLines(
    amount: Prisma.Decimal,
    items: FeeItem[],
    feeCurrency: string,
    feeDecimals: number,
  ): {
    lines: CalculatedFeeLine[];
    totals: Record<string, string>;
  } {
    const totals = new Map<string, Prisma.Decimal>();
    const lines: CalculatedFeeLine[] = [];

    for (const item of items) {
      const baseValue = this.toDecimal(item.value);
      let fee =
        item.calcType === 'PERCENT'
          ? amount.mul(baseValue).div(100)
          : baseValue;

      if (item.min !== null) {
        const min = this.toDecimal(item.min);
        if (fee.lt(min)) {
          fee = min;
        }
      }

      if (item.max !== null) {
        const max = this.toDecimal(item.max);
        if (fee.gt(max)) {
          fee = max;
        }
      }

      fee = this.roundDecimal(fee, feeDecimals, item.roundingMode);

      const currency = String(feeCurrency || '').toUpperCase();
      lines.push({
        itemCode: item.itemCode,
        calcType: item.calcType,
        currency,
        amount: fee.toString(),
      });

      const previous = totals.get(currency) || new Prisma.Decimal(0);
      totals.set(currency, previous.add(fee));
    }

    const totalsObject: Record<string, string> = {};
    totals.forEach((value, key) => {
      totalsObject[key] = value.toString();
    });

    return {
      lines,
      totals: totalsObject,
    };
  }

  buildSwapQuote(input: SwapQuoteBuildInput): SwapPricingResult {
    const quoteLockSeconds = Math.max(1, Math.floor(input.quoteLockSeconds || 30));
    const expiresAt = new Date(input.createdAt.getTime() + quoteLockSeconds * 1000);
    // Spread is the platform margin: the customer receives a worse-than-market
    // rate, so the markup REDUCES the effective rate (less toCurrency out).
    const markupMultiplier = new Prisma.Decimal(1).sub(
      new Prisma.Decimal(input.markupBps).div(10000),
    );
    const quotedRate = this.roundDecimal(
      input.baseRate.mul(markupMultiplier),
      input.roundingDp,
      input.roundingMode,
    );
    // Amounts must land on the to-asset's minor units (feeDecimals = to-asset
    // decimals): the TB ledger stores integer minor units, so a sub-minor-unit
    // gross (e.g. 18,270.6875 AED) strands truncation dust between the order
    // amounts and the ledger. Only the RATE keeps full roundingDp precision.
    const grossAmountOut = this.roundDecimal(
      input.amount.mul(quotedRate),
      input.feeDecimals,
      input.roundingMode,
    );
    const { lines, totals } = this.calculateFeeLines(
      grossAmountOut,
      input.fees || [],
      input.feeCurrency,
      input.feeDecimals,
    );
    const feeCurrencies = Object.keys(totals);
    const feeCurrency = feeCurrencies.length > 0 ? feeCurrencies[0] : null;
    const feeTotal = feeCurrency ? this.toDecimal(totals[feeCurrency]) : new Prisma.Decimal(0);
    const netAmountOut = grossAmountOut.minus(feeTotal);

    return {
      createdAt: input.createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      matched: {
        pairId: input.pairId,
        pairName: input.pairName,
        tierId: input.tierId,
        tierName: input.tierName,
      },
      fx: {
        baseProvider: input.baseProvider,
        baseRate: input.baseRate.toString(),
        quotedRate: quotedRate.toString(),
        markupBps: input.markupBps,
      },
      fees: lines,
      totals: {
        ...totals,
        amountIn: input.amount.toString(),
        amountOutGross: grossAmountOut.toString(),
        amountOutNet: netAmountOut.toString(),
        feeTotal: feeTotal.toString(),
        feeCurrency: feeCurrency || '',
      },
      grossAmountOut: grossAmountOut.toString(),
      netAmountOut: netAmountOut.toString(),
      feeTotal: feeTotal.toString(),
      feeCurrency,
      policyRef: {
        policyCode: input.policyCode,
        policyId: input.policyId,
        business: 'SWAP',
        channel: 'ONLINE',
      },
    };
  }

  buildWithdrawalQuote(input: WithdrawalQuoteBuildInput): WithdrawalPricingResult {
    const quoteLockSeconds = Math.max(1, Math.floor(input.quoteLockSeconds || 30));
    const expiresAt = new Date(input.createdAt.getTime() + quoteLockSeconds * 1000);
    const { lines, totals } = this.calculateFeeLines(
      input.amount,
      input.fees || [],
      input.feeCurrency,
      input.feeDecimals,
    );

    return {
      createdAt: input.createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      matched: {
        assetEntryId: input.assetEntryId,
        assetId: input.assetId,
        tierId: input.tierId,
        tierName: input.tierName,
      },
      fees: lines,
      totals,
      policyRef: {
        policyCode: input.policyCode,
        policyId: input.policyId,
        business: 'WITHDRAWAL',
        channel: 'ONLINE',
      },
    };
  }
}

import { Prisma } from '@prisma/client';
import { PricingEngineService } from './pricing-engine.service';

describe('PricingEngineService', () => {
  let service: PricingEngineService;

  beforeEach(() => {
    service = new PricingEngineService();
  });

  it('should match swap tier by amount range', () => {
    const matched = service.findMatchedSwapTier({
      amount: new Prisma.Decimal('100'),
      tiers: [
        {
          id: 'tier-1',
          name: 'Tier1',
          enabled: true,
          rateMarkupBps: 50,
          conditions: {
            amountMin: '0',
            amountMax: '99.9999',
          },
          feeItems: [],
        },
        {
          id: 'tier-2',
          name: 'Tier2',
          enabled: true,
          rateMarkupBps: 10,
          conditions: {
            amountMin: '100',
            amountMax: '1000',
          },
          feeItems: [],
        },
      ],
    });

    expect(matched?.id).toBe('tier-2');
  });

  it('should calculate fee with min/max and rounding', () => {
    const result = service.calculateFeeLines(
      new Prisma.Decimal('123.456'),
      [
        {
          id: 'fee-1',
          itemCode: 'SWAP_SERVICE_FEE',
          calcType: 'PERCENT',
          value: '1.25',
          min: '0.50',
          max: '2.00',
          roundingMode: 'ROUND',
        },
        {
          id: 'fee-2',
          itemCode: 'COMPLIANCE_FEE',
          calcType: 'FLAT',
          value: '0.3333',
          min: null,
          max: null,
          roundingMode: 'CEIL',
        },
      ],
      'AED',
      2,
    );

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].amount).toBe('1.54');
    expect(result.lines[1].amount).toBe('0.34');
    expect(result.totals.AED).toBe('1.88');
  });

  it('should build swap quote with markup and lock expiry', () => {
    const quote = service.buildSwapQuote({
      amount: new Prisma.Decimal('10'),
      baseRate: new Prisma.Decimal('3.12345678'),
      markupBps: 100,
      roundingDp: 8,
      roundingMode: 'ROUND',
      quoteLockSeconds: 45,
      fees: [],
      feeCurrency: 'AED',
      feeDecimals: 8,
      createdAt: new Date('2026-02-23T00:00:00.000Z'),
      pairId: 'pair-1',
      pairName: 'BTC ↔ AED',
      tierId: 'tier-1',
      tierName: 'Default',
      baseProvider: 'BINANCE',
      policyCode: 'SWAP_PRICING',
      policyId: 'POL-SWAP-ONLINE',
    });

    // markup REDUCES the rate (platform spread): 3.12345678 × (1 − 100/10000)
    expect(quote.fx.quotedRate).toBe('3.09222221');
    expect(quote.expiresAt).toBe('2026-02-23T00:00:45.000Z');
  });

  it('rounds gross/net amounts to feeDecimals (asset minor units) while the rate keeps roundingDp precision', () => {
    // Acceptance regression: AED (2dp) quote produced 18,270.6875 — a value the
    // TB ledger (integer fils) cannot represent, stranding 0.01 truncation dust
    // across separately-truncated T1 legs (bridge sweep #0 / reval #0 artifacts).
    const quote = service.buildSwapQuote({
      amount: new Prisma.Decimal('5000'),
      baseRate: new Prisma.Decimal('3.6725'),
      markupBps: 50,
      roundingDp: 8,
      roundingMode: 'ROUND',
      quoteLockSeconds: 30,
      fees: [],
      feeCurrency: 'AED',
      feeDecimals: 2,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      pairId: 'pair-1',
      pairName: 'USDT ↔ AED',
      tierId: 'tier-1',
      tierName: 'Default',
      baseProvider: 'BINANCE',
      policyCode: 'SWAP_PRICING',
      policyId: 'POL-SWAP-ONLINE',
    });

    // rate keeps full precision: 3.6725 × 0.995 = 3.6541375
    expect(quote.fx.quotedRate).toBe('3.6541375');
    // amounts land on representable fils: 5000 × 3.6541375 = 18270.6875 → 18270.69
    expect(quote.grossAmountOut).toBe('18270.69');
    expect(quote.netAmountOut).toBe('18270.69');
  });

  it('should match withdrawal tier by amount range', () => {
    const tier = service.findMatchedWithdrawalTier({
      amount: new Prisma.Decimal('50'),
      tiers: [
        {
          id: 'tier-default',
          name: 'Default',
          enabled: true,
          conditions: {
            amountMin: '0',
            amountMax: '40',
          },
          feeItems: [],
        },
        {
          id: 'tier-amount',
          name: 'AmountTier',
          enabled: true,
          conditions: {
            amountMin: '41',
            amountMax: '100',
          },
          feeItems: [],
        },
      ],
    });

    expect(tier?.id).toBe('tier-amount');
  });

  it('should calculate withdrawal service/gas fees with percent minimum and flat', () => {
    const result = service.calculateFeeLines(
      new Prisma.Decimal('100'),
      [
        {
          id: 'service-fee',
          itemCode: 'WITHDRAW_SERVICE_FEE',
          calcType: 'PERCENT',
          value: '2',
          min: '5',
          max: null,
          roundingMode: 'ROUND',
        },
        {
          id: 'gas-fee',
          itemCode: 'NETWORK_FEE_EST',
          calcType: 'FLAT',
          value: '1.25',
          min: null,
          max: null,
          roundingMode: 'ROUND',
        },
      ],
      'AED',
      2,
    );

    expect(result.lines[0].amount).toBe('5');
    expect(result.lines[1].amount).toBe('1.25');
    expect(result.totals.AED).toBe('6.25');
  });
});

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
          priority: 20,
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
          priority: 10,
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

  it('should calculate fee with min/cap and rounding', () => {
    const result = service.calculateFeeLines(new Prisma.Decimal('123.456'), [
      {
        id: 'fee-1',
        itemCode: 'SWAP_SERVICE_FEE',
        calcType: 'PERCENT',
        value: '1.25',
        currency: 'AED',
        min: '0.50',
        cap: '2.00',
        roundingDp: 2,
        roundingMode: 'ROUND',
        adjustable: true,
      },
      {
        id: 'fee-2',
        itemCode: 'COMPLIANCE_FEE',
        calcType: 'FLAT',
        value: '0.3333',
        currency: 'AED',
        min: null,
        cap: null,
        roundingDp: 2,
        roundingMode: 'CEIL',
        adjustable: false,
      },
    ]);

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
      createdAt: new Date('2026-02-23T00:00:00.000Z'),
      pairId: 'pair-1',
      pairName: 'BTC ↔ AED',
      tierId: 'tier-1',
      tierName: 'Default',
      baseProvider: 'BINANCE',
      policyCode: 'SWAP_PRICING',
      policyId: 'POL-SWAP-ONLINE',
    });

    expect(quote.fx.quotedRate).toBe('3.15469135');
    expect(quote.expiresAt).toBe('2026-02-23T00:00:45.000Z');
  });

  it('should match withdrawal tier by amount range', () => {
    const tier = service.findMatchedWithdrawalTier({
      amount: new Prisma.Decimal('50'),
      tiers: [
        {
          id: 'tier-default',
          name: 'Default',
          priority: 100,
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
          priority: 10,
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
    const result = service.calculateFeeLines(new Prisma.Decimal('100'), [
      {
        id: 'service-fee',
        itemCode: 'WITHDRAW_SERVICE_FEE',
        calcType: 'PERCENT',
        value: '2',
        currency: 'AED',
        min: '5',
        cap: null,
        roundingDp: 2,
        roundingMode: 'ROUND',
        adjustable: false,
      },
      {
        id: 'gas-fee',
        itemCode: 'NETWORK_FEE_EST',
        calcType: 'FLAT',
        value: '1.25',
        currency: 'AED',
        min: null,
        cap: null,
        roundingDp: 2,
        roundingMode: 'ROUND',
        adjustable: false,
      },
    ]);

    expect(result.lines[0].amount).toBe('5');
    expect(result.lines[1].amount).toBe('1.25');
    expect(result.totals.AED).toBe('6.25');
  });
});

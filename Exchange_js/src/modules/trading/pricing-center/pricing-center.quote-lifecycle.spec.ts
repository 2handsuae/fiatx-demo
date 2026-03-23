import { Prisma } from '@prisma/client';
import { PricingCenterService } from './pricing-center.service';
import { PricingQuoteBusiness } from './dto/pricing-center.dto';

const mockPrisma = {
  swapQuote: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  withdrawPricingQuote: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  customerMain: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

describe('PricingCenterService - Quote lifecycle', () => {
  let service: PricingCenterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PricingCenterService(mockPrisma as any, {} as any, {} as any);
    jest
      .spyOn((service as any).auditLogsService, 'recordByActor')
      .mockResolvedValue(undefined);
  });

  it('creates swap quote through unified price center contract', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    jest.spyOn(service, 'resolveSwapQuoteForExecution').mockResolvedValue({
      fromAssetId: 'asset-btc',
      toAssetId: 'asset-aed',
      fromAssetCode: 'BTC',
      toAssetCode: 'AED',
      fromAssetDecimals: 8,
      toAssetDecimals: 2,
      quotedRate: new Prisma.Decimal('100000'),
      baseRate: new Prisma.Decimal('99800'),
      markupBps: 20,
      quoteLockSeconds: 30,
      baseProvider: 'BINANCE',
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + 30000),
      pairId: 'PAIR-0001',
      pairName: 'BTC -> AED',
      tierId: 'TIER-001',
      tierName: 'Default Tier',
      fees: [],
      totals: { AED: '0' },
      policyRef: {
        policyCode: 'SWAP_PRICING',
        policyId: 'POL-SWAP-ONLINE',
        business: 'SWAP',
        channel: 'ONLINE',
      },
      pricingSource: {
        provider: 'BINANCE',
        endpoint: 'api/v3/ticker/bookTicker',
        symbol: 'BTCAED',
        bid: '99800',
        ask: '100000',
        sideUsed: 'BID',
        aedPegApplied: false,
        aedPegRate: '3.6725',
        formula: 'baseRate = bid(BTCAED)',
        effectiveBaseRate: '99800',
        fetchedAt: now.toISOString(),
      },
    });
    jest.spyOn(service, 'resolveOwnerNo').mockResolvedValue('CU_0001');
    mockPrisma.swapQuote.create.mockResolvedValue({
      id: 'swap-quote-1',
      quoteNo: 'QUO_001',
      quoteType: 'FIRM',
      status: 'ACTIVE',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      fromAssetId: 'asset-btc',
      fromAssetCode: 'BTC',
      toAssetId: 'asset-aed',
      toAssetCode: 'AED',
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: new Prisma.Decimal('1'),
      currencyIn: 'BTC',
      amountOut: new Prisma.Decimal('100000'),
      currencyOut: 'AED',
      rateDisplay: new Prisma.Decimal('100000'),
      rateAllIn: new Prisma.Decimal('100000'),
      marketRate: new Prisma.Decimal('99800'),
      spreadPercent: new Prisma.Decimal('0.2'),
      spreadBps: 20,
      rateSource: 'BINANCE',
      fetchedAt: now,
      feeTotal: new Prisma.Decimal('0'),
      feeCurrency: 'AED',
      feeBreakdown: JSON.stringify([
        {
          policyRef: {
            policyCode: 'SWAP_PRICING',
          },
          matched: {
            pairId: 'PAIR-0001',
            tierId: 'TIER-001',
            tierName: 'Default Tier',
          },
          fx: {
            endpoint: 'api/v3/ticker/bookTicker',
            symbol: 'BTCAED',
            bid: '99800',
            ask: '100000',
            sideUsed: 'BID',
            effectiveBaseRate: '99800',
            fetchedAt: now.toISOString(),
          },
          fees: [],
          totals: { AED: '0' },
        },
      ]),
      totalsJson: JSON.stringify({ AED: '0' }),
      policyRef: JSON.stringify({
        policyCode: 'SWAP_PRICING',
        policyId: 'POL-SWAP-ONLINE',
      }),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30000),
      usedAt: null,
      cancelledAt: null,
    });

    const result = await service.createSwapQuote('CUSTOMER', 'customer-1', {
      fromAssetId: 'asset-btc',
      toAssetId: 'asset-aed',
      fromAmount: 1,
    });

    expect(result.business).toBe('SWAP');
    expect(result.policyRef).toEqual(
      expect.objectContaining({ policyCode: 'SWAP_PRICING' }),
    );
    expect(result.totals).toEqual({ AED: '0' });
    expect(mockPrisma.swapQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalsJson: JSON.stringify({ AED: '0' }),
          policyRef: expect.stringContaining('SWAP_PRICING'),
        }),
      }),
    );
  });

  it('creates withdrawal quote with real TTL instead of far expiry', async () => {
    const createdAt = new Date('2026-03-23T11:00:00.000Z');
    const expiresAt = new Date(createdAt.getTime() + 30000);

    jest.spyOn(service, 'resolveWithdrawalQuote').mockResolvedValue({
      assetId: 'asset-btc',
      assetCode: 'BTC',
      amount: new Prisma.Decimal('0.5'),
      matchedAssetEntryId: 'ASSET-0001',
      tierId: 'TIER-001',
      tierName: 'Default Tier',
      fees: [],
      totals: { BTC: '0.0002' },
      policyRef: {
        policyCode: 'WITHDRAWAL_PRICING',
        policyId: 'POL-WITHDRAW-ONLINE',
        business: 'WITHDRAWAL',
        channel: 'ONLINE',
      },
      createdAt,
      expiresAt,
    });
    mockPrisma.withdrawPricingQuote.create.mockResolvedValue({
      id: 'withdraw-quote-1',
      quoteNo: 'WQO_001',
      status: 'ACTIVE',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      assetId: 'asset-btc',
      assetCode: 'BTC',
      amount: new Prisma.Decimal('0.5'),
      segment: 'ANY',
      riskTier: 'ANY',
      matchedAssetId: 'ASSET-0001',
      matchedTierId: 'TIER-001',
      matchedTierName: 'Default Tier',
      feeBreakdown: '[]',
      totalsJson: JSON.stringify({ BTC: '0.0002' }),
      policyRef: JSON.stringify({ policyCode: 'WITHDRAWAL_PRICING' }),
      expiresAt,
      usedAt: null,
      cancelledAt: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.createWithdrawPricingQuote(
      'CUSTOMER',
      'customer-1',
      'CU_0001',
      {
        assetId: 'asset-btc',
        amount: 0.5,
      },
    );

    expect(result.business).toBe('WITHDRAWAL');
    expect(new Date(result.expiresAt).toISOString()).toBe(expiresAt.toISOString());
    expect(mockPrisma.withdrawPricingQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt,
        }),
      }),
    );
  });

  it('lists unified admin quotes for swap and withdrawal', async () => {
    const now = new Date('2026-03-23T12:00:00.000Z');
    mockPrisma.swapQuote.findMany.mockResolvedValue([
      {
        id: 'swap-quote-1',
        quoteNo: 'QUO_001',
        status: 'ACTIVE',
        ownerType: 'CUSTOMER',
        ownerNo: 'CU_0001',
        fromAssetCode: 'BTC',
        toAssetCode: 'AED',
        amountIn: new Prisma.Decimal('1'),
        amountOut: new Prisma.Decimal('100000'),
        rateAllIn: new Prisma.Decimal('100000'),
        feeTotal: new Prisma.Decimal('0'),
        feeCurrency: 'AED',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30000),
        usedAt: null,
        cancelledAt: null,
        swapTransaction: { swapNo: 'SWP_001' },
      },
    ]);
    mockPrisma.withdrawPricingQuote.findMany.mockResolvedValue([
      {
        id: 'withdraw-quote-1',
        quoteNo: 'WQO_001',
        status: 'ACTIVE',
        ownerType: 'CUSTOMER',
        ownerNo: 'CU_0001',
        assetCode: 'BTC',
        amount: new Prisma.Decimal('0.5'),
        feeBreakdown: '[]',
        totalsJson: JSON.stringify({ BTC: '0.0002' }),
        policyRef: '{}',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30000),
        usedAt: null,
        cancelledAt: null,
        withdrawals: [{ withdrawNo: 'WDR_001' }],
      },
    ]);

    const result = await service.listAdminPricingQuotes({});

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.business)).toEqual(
      expect.arrayContaining(['SWAP', 'WITHDRAWAL']),
    );
  });

  it('does not derive swap totals or policyRef from legacy feeBreakdown fallback', async () => {
    const now = new Date('2026-03-23T12:30:00.000Z');
    mockPrisma.swapQuote.findUnique.mockResolvedValue({
      id: 'swap-quote-legacy',
      quoteNo: 'QUO_OLD',
      status: 'USED',
      ownerType: 'CUSTOMER',
      ownerNo: 'CU_0001',
      fromAssetCode: 'BTC',
      toAssetCode: 'AED',
      fromAsset: { code: 'BTC', decimals: 8 },
      toAsset: { code: 'AED', decimals: 2 },
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: new Prisma.Decimal('1'),
      currencyIn: 'BTC',
      amountOut: new Prisma.Decimal('100000'),
      currencyOut: 'AED',
      rateDisplay: new Prisma.Decimal('100000'),
      rateAllIn: new Prisma.Decimal('100000'),
      marketRate: new Prisma.Decimal('99800'),
      spreadPercent: new Prisma.Decimal('0.2'),
      spreadBps: 20,
      rateSource: 'BINANCE',
      fetchedAt: now,
      feeBreakdown: JSON.stringify([
        {
          policyRef: { policyCode: 'SWAP_PRICING' },
          matched: { pairId: 'PAIR-0001' },
          fx: { effectiveBaseRate: '99800', fetchedAt: now.toISOString() },
          fees: [],
          totals: { AED: '0.15' },
        },
      ]),
      totalsJson: '{}',
      policyRef: '{}',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30000),
      usedAt: now,
      cancelledAt: null,
      swapTransaction: null,
    });

    const result = await service.getAdminPricingQuoteDetail(
      PricingQuoteBusiness.SWAP,
      'swap-quote-legacy',
    );

    expect(result.totals).toEqual({});
    expect(result.policyRef).toEqual({});
  });
});

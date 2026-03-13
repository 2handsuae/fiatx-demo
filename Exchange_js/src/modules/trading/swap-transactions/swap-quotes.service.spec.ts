import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapQuotesService } from './swap-quotes.service';

const mockPrismaService = {
  customerMain: {
    findUnique: jest.fn(),
  },
  swapQuote: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockSwapTransactionsService = {
  getExecutableRate: jest.fn(),
};

describe('SwapQuotesService', () => {
  let service: SwapQuotesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapQuotesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SwapTransactionsService, useValue: mockSwapTransactionsService },
      ],
    }).compile();

    service = module.get<SwapQuotesService>(SwapQuotesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create firm quote with rate snapshot', async () => {
    mockSwapTransactionsService.getExecutableRate.mockResolvedValue({
      fromAssetId: 'asset-1',
      toAssetId: 'asset-2',
      fromAssetCode: 'BTC',
      toAssetCode: 'ETH',
      fromAssetDecimals: 8,
      toAssetDecimals: 8,
      marketRate: 2,
      spreadPercent: 1.5,
      executableRate: 2.03,
      spreadBps: 150,
      rateSource: 'BINANCE',
      fetchedAt: new Date().toISOString(),
      quoteLockSeconds: 30,
      pairId: 'PAIR-0001',
      pairName: 'BTC ↔ ETH',
      tierId: 'TIER-001',
      tierName: 'Default Tier',
      matched: {
        pairId: 'PAIR-0001',
        pairName: 'BTC ↔ ETH',
        tierId: 'TIER-001',
        tierName: 'Default Tier',
      },
      pricingSource: {
        provider: 'BINANCE',
        endpoint: 'api/v3/ticker/bookTicker',
        symbol: 'BTCUSDT',
        bid: '100000',
        ask: '100100',
        sideUsed: 'BID',
        aedPegApplied: false,
        aedPegRate: '3.6725',
        formula: 'baseRate = bid(BTCUSDT)',
        effectiveBaseRate: '100000',
        fetchedAt: new Date().toISOString(),
      },
      feeBreakdown: [],
      feeTotals: { ETH: '0' },
      policyRef: {
        policyCode: 'SWAP_PRICING',
        policyId: 'POL-SWAP-ONLINE',
        business: 'SWAP',
        channel: 'ONLINE',
      },
    });

    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU_0001',
    });
    mockPrismaService.swapQuote.create.mockResolvedValue({
      id: 'quote-1',
      quoteNo: 'QUO_0001',
      quoteType: 'FIRM',
      status: 'ACTIVE',
      ownerNo: 'CU_0001',
      fromAssetCode: 'BTC',
      toAssetCode: 'ETH',
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: new Prisma.Decimal(10),
      amountOut: new Prisma.Decimal(20.3),
      currencyIn: 'BTC',
      currencyOut: 'ETH',
      rateDisplay: new Prisma.Decimal(2.03),
      rateAllIn: new Prisma.Decimal(2.03),
      marketRate: new Prisma.Decimal(2),
      spreadPercent: new Prisma.Decimal(1.5),
      spreadBps: 150,
      rateSource: 'BINANCE',
      fetchedAt: new Date(),
      feeTotal: new Prisma.Decimal(0),
      feeCurrency: 'ETH',
      feeBreakdown: JSON.stringify([
        {
          matched: {
            pairId: 'PAIR-0001',
            pairName: 'BTC ↔ ETH',
            tierId: 'TIER-001',
            tierName: 'Default Tier',
          },
          fx: {
            baseProvider: 'BINANCE',
            baseRate: '100000',
            quotedRate: '100000',
            markupBps: 0,
            endpoint: 'api/v3/ticker/bookTicker',
            symbol: 'BTCUSDT',
            bid: '100000',
            ask: '100100',
            sideUsed: 'BID',
            aedPegApplied: false,
            aedPegRate: '3.6725',
            formula: 'baseRate = bid(BTCUSDT)',
            effectiveBaseRate: '100000',
            fetchedAt: new Date().toISOString(),
          },
          fees: [],
          totals: { ETH: '0' },
        },
      ]),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30000),
      usedAt: null,
    });

    const result = await service.createFirmQuote('CUSTOMER', 'user-1', {
      fromAssetId: 'asset-1',
      toAssetId: 'asset-2',
      fromAmount: 10,
    });

    expect(result.quoteId).toBe('quote-1');
    expect(result.status).toBe('ACTIVE');
    expect(result.rateAllIn).toBe(2.03);
    expect(result.matched?.pairId).toBe('PAIR-0001');
    expect(result.pricingSource?.symbol).toBe('BTCUSDT');
    expect(mockPrismaService.swapQuote.create).toHaveBeenCalled();
  });

  it('should retry creating quote when quoteNo has unique conflict', async () => {
    mockSwapTransactionsService.getExecutableRate.mockResolvedValue({
      fromAssetId: 'asset-1',
      toAssetId: 'asset-2',
      fromAssetCode: 'BTC',
      toAssetCode: 'ETH',
      fromAssetDecimals: 8,
      toAssetDecimals: 8,
      marketRate: 2,
      spreadPercent: 1.5,
      executableRate: 2.03,
      spreadBps: 150,
      rateSource: 'BINANCE',
      fetchedAt: new Date().toISOString(),
      quoteLockSeconds: 30,
      pairId: 'PAIR-0001',
      pairName: 'BTC ↔ ETH',
      tierId: 'TIER-001',
      tierName: 'Default Tier',
      feeBreakdown: [],
      feeTotals: { ETH: '0' },
      policyRef: {
        policyCode: 'SWAP_PRICING',
        policyId: 'POL-SWAP-ONLINE',
        business: 'SWAP',
        channel: 'ONLINE',
      },
    });
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU_0001',
    });

    mockPrismaService.swapQuote.create
      .mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['quoteNo'] },
      })
      .mockResolvedValueOnce({
        id: 'quote-retry-1',
        quoteNo: 'QUO2501010001',
        quoteType: 'FIRM',
        status: 'ACTIVE',
        ownerNo: 'CU_0001',
        fromAssetCode: 'BTC',
        toAssetCode: 'ETH',
        side: 'SELL_BASE',
        amountType: 'EXACT_IN',
        amountIn: new Prisma.Decimal(10),
        amountOut: new Prisma.Decimal(20.3),
        currencyIn: 'BTC',
        currencyOut: 'ETH',
        rateDisplay: new Prisma.Decimal(2.03),
        rateAllIn: new Prisma.Decimal(2.03),
        marketRate: new Prisma.Decimal(2),
        spreadPercent: new Prisma.Decimal(1.5),
        spreadBps: 150,
        rateSource: 'BINANCE',
        fetchedAt: new Date(),
        feeTotal: new Prisma.Decimal(0),
        feeCurrency: 'ETH',
        feeBreakdown: '[]',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30000),
        usedAt: null,
      });

    const result = await service.createFirmQuote('CUSTOMER', 'user-1', {
      fromAssetId: 'asset-1',
      toAssetId: 'asset-2',
      fromAmount: 10,
    });

    expect(result.quoteId).toBe('quote-retry-1');
    expect(mockPrismaService.swapQuote.create).toHaveBeenCalledTimes(2);
  });

  it('should throw when quoteNo generation keeps conflicting', async () => {
    mockSwapTransactionsService.getExecutableRate.mockResolvedValue({
      fromAssetId: 'asset-1',
      toAssetId: 'asset-2',
      fromAssetCode: 'BTC',
      toAssetCode: 'ETH',
      fromAssetDecimals: 8,
      toAssetDecimals: 8,
      marketRate: 2,
      spreadPercent: 1.5,
      executableRate: 2.03,
      spreadBps: 150,
      rateSource: 'BINANCE',
      fetchedAt: new Date().toISOString(),
      quoteLockSeconds: 30,
      pairId: 'PAIR-0001',
      pairName: 'BTC ↔ ETH',
      tierId: 'TIER-001',
      tierName: 'Default Tier',
      feeBreakdown: [],
      feeTotals: { ETH: '0' },
      policyRef: {
        policyCode: 'SWAP_PRICING',
        policyId: 'POL-SWAP-ONLINE',
        business: 'SWAP',
        channel: 'ONLINE',
      },
    });
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      customerNo: 'CU_0001',
    });
    mockPrismaService.swapQuote.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['quoteNo'] },
    });

    await expect(
      service.createFirmQuote('CUSTOMER', 'user-1', {
        fromAssetId: 'asset-1',
        toAssetId: 'asset-2',
        fromAmount: 10,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(mockPrismaService.swapQuote.create).toHaveBeenCalledTimes(10);
  });

  it('should throw for owner mismatch', async () => {
    mockPrismaService.swapQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      ownerType: 'CUSTOMER',
      ownerId: 'other-user',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30000),
    });

    await expect(
      service.getActiveQuoteOrThrow('quote-1', 'CUSTOMER', 'user-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should mark quote expired and throw when quote is expired', async () => {
    mockPrismaService.swapQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000),
    });
    mockPrismaService.swapQuote.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.getActiveQuoteOrThrow('quote-1', 'CUSTOMER', 'user-1'),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrismaService.swapQuote.updateMany).toHaveBeenCalled();
  });

  it('should consume quote once for swap', async () => {
    jest.spyOn(service, 'getActiveQuoteOrThrow').mockResolvedValue({
      id: 'quote-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30000),
    } as any);

    const tx = {
      swapQuote: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'quote-1',
          status: 'USED',
          usedAt: new Date(),
        }),
      },
    } as any;

    const result = await service.consumeQuoteForSwap(
      tx,
      'quote-1',
      'CUSTOMER',
      'user-1',
    );

    expect(result.status).toBe('USED');
    expect(tx.swapQuote.updateMany).toHaveBeenCalled();
  });

  it('should cancel active quote', async () => {
    mockPrismaService.swapQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30000),
    });
    mockPrismaService.swapQuote.update.mockResolvedValue({
      id: 'quote-1',
      quoteType: 'FIRM',
      status: 'CANCELLED',
      fromAssetCode: 'BTC',
      toAssetCode: 'ETH',
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: new Prisma.Decimal(1),
      amountOut: new Prisma.Decimal(2),
      currencyIn: 'BTC',
      currencyOut: 'ETH',
      rateDisplay: new Prisma.Decimal(2),
      rateAllIn: new Prisma.Decimal(2),
      marketRate: new Prisma.Decimal(2),
      spreadPercent: new Prisma.Decimal(0),
      spreadBps: 0,
      rateSource: 'BINANCE',
      fetchedAt: new Date(),
      feeTotal: new Prisma.Decimal(0),
      feeCurrency: 'ETH',
      feeBreakdown: '[]',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30000),
      usedAt: null,
    });

    const result = await service.cancelQuote('quote-1', 'CUSTOMER', 'user-1');
    expect(result.status).toBe('CANCELLED');
  });

  it('should list quotes for admin with filters', async () => {
    mockPrismaService.swapQuote.findMany.mockResolvedValue([
      {
        id: 'quote-1',
        status: 'ACTIVE',
      },
    ]);
    mockPrismaService.swapQuote.count.mockResolvedValue(1);

    const result = await service.findAllForAdmin({
      status: 'ACTIVE' as any,
      ownerId: 'user-1',
      skip: 0,
      take: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockPrismaService.swapQuote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          ownerId: 'user-1',
        }),
      }),
    );
  });

  it('should return quote detail for admin', async () => {
    mockPrismaService.swapQuote.findUnique.mockResolvedValue({
      id: 'quote-1',
      status: 'USED',
    });

    const result = await service.findOneForAdmin('quote-1');
    expect(result.id).toBe('quote-1');
  });

  it('should throw when admin quote detail not found', async () => {
    mockPrismaService.swapQuote.findUnique.mockResolvedValue(null);

    await expect(service.findOneForAdmin('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

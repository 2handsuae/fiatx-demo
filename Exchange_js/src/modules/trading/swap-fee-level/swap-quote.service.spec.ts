import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SwapQuoteService } from './swap-quote.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';

describe('SwapQuoteService', () => {
  let service: SwapQuoteService;
  let prisma: PrismaService;
  let auditLogsService: AuditLogsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapQuoteService,
        {
          provide: PrismaService,
          useValue: {
            swapQuote: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            asset: {
              findUnique: jest.fn().mockResolvedValue({
                currency: 'USDT',
                decimals: 8,
              }),
            },
          },
        },
        {
          provide: SwapFeeLevelService,
          useValue: {
            findActiveByPair: jest.fn().mockResolvedValue([
              {
                id: 'lvl-1',
                levelCode: 'L1',
                isDefault: true,
                tiersJson: JSON.stringify({ tiers: [{ id: 't1', name: 'T1', rateMarkupBps: 10, feeItems: [] }] }),
              },
            ]),
          },
        },
        {
          provide: SwapFeeLevelBindingService,
          useValue: {
            findBoundLevelIds: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PricingEngineService,
          useValue: {
            findMatchedSwapTier: jest.fn().mockReturnValue({
              id: 't1',
              name: 'T1',
              rateMarkupBps: 10,
              feeItems: [],
            }),
            calculateFeeLines: jest.fn().mockReturnValue({
              lines: [],
              totals: {},
            }),
            buildSwapQuote: jest.fn().mockReturnValue({
              expiresAt: new Date(Date.now() + 30000).toISOString(),
              matched: {},
              fx: { baseRate: '1.0', quotedRate: '1.0' },
              fees: [],
              totals: {},
              grossAmountOut: '100',
              feeTotal: '0',
              feeCurrency: 'USDT',
              policyRef: {},
            }),
          },
        },
        {
          provide: BinanceRateProvider,
          useValue: {
            fetchRate: jest.fn().mockResolvedValue({
              rate: new Prisma.Decimal('1.0'),
              symbol: 'AEDUSDT',
              bid: '1.0',
              ask: '1.0',
              sideUsed: 'ASK',
              aedPegApplied: false,
              aedPegRate: null,
              formula: 'direct',
              fetchedAt: new Date(),
            }),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            recordByActor: jest.fn().mockResolvedValue({}),
            recordSystem: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<SwapQuoteService>(SwapQuoteService);
    prisma = module.get<PrismaService>(PrismaService);
    auditLogsService = module.get<AuditLogsService>(AuditLogsService);
  });

  describe('createQuote', () => {
    it('generates a UUID traceId, persists it on the quote row, and passes it to audit', async () => {
      const capturedCreate: any[] = [];
      const capturedAudit: any[] = [];

      (prisma as any).swapQuote.create = jest.fn((args: any) => {
        capturedCreate.push(args.data);
        return Promise.resolve({
          id: 'q1',
          quoteNo: 'QUO1',
          ownerType: args.data.ownerType,
          ownerId: args.data.ownerId,
          ownerNo: args.data.ownerNo,
          ...args.data,
        });
      });
      (auditLogsService as any).recordByActor = jest.fn((args: any) => {
        capturedAudit.push(args);
        return Promise.resolve();
      });

      await service.createQuote({
        ownerType: 'CUSTOMER',
        ownerId: 'c1',
        ownerNo: 'C1',
        fromAssetId: 'a-aed',
        fromAssetCode: 'AED',
        toAssetId: 'a-usdt',
        toAssetCode: 'USDT',
        amount: new Prisma.Decimal('100'),
        customerId: 'c1',
      });

      expect(capturedCreate).toHaveLength(1);
      expect(capturedCreate[0].traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      expect(capturedAudit).toHaveLength(1);
      expect(capturedAudit[0].traceId).toBe(capturedCreate[0].traceId);
    });
  });
});

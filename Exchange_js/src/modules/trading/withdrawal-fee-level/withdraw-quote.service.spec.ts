import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { WithdrawQuoteService } from './withdraw-quote.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { CustomerTagService } from '../../identity/customer-tags/customer-tag.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

describe('WithdrawQuoteService.resolveBestLevel (audience predicate)', () => {
  let service: WithdrawQuoteService;
  let prisma: PrismaService;
  let feeLevelService: WithdrawalFeeLevelService;
  let customerTagService: CustomerTagService;
  let auditMock: { recordByActor: jest.Mock };

  const defaultLevel = {
    id: 'lvl-default',
    levelCode: 'DEFAULT',
    isDefault: true,
    requiredTagsJson: '[]',
    validFrom: null,
    validTo: null,
    tiersJson: JSON.stringify({
      tiers: [{ id: 't-def', name: 'Default Tier', feeItems: [{ code: 'FEE', amount: '10' }] }],
    }),
  };

  const vipLevel = {
    id: 'lvl-vip',
    levelCode: 'VIP',
    isDefault: false,
    requiredTagsJson: '["VIP"]',
    validFrom: null,
    validTo: null,
    tiersJson: JSON.stringify({
      tiers: [{ id: 't-vip', name: 'VIP Tier', feeItems: [{ code: 'FEE', amount: '2' }] }],
    }),
  };

  const validInput = {
    ownerType: 'WITHDRAWAL',
    ownerId: 'wd-1',
    assetId: 'asset-1',
    assetCode: 'USDT',
    amount: new Prisma.Decimal('100'),
    customerId: 'cust-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawQuoteService,
        {
          provide: PrismaService,
          useValue: {
            asset: {
              findUnique: jest.fn().mockResolvedValue({ currency: 'USDT', decimals: 8 }),
            },
            withdrawPricingQuote: {
              create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
                Promise.resolve({ ...data, id: 'quote-test-id', createdAt: new Date() }),
              ),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: WithdrawalFeeLevelService,
          useValue: {
            findActiveByAsset: jest.fn().mockResolvedValue([defaultLevel, vipLevel]),
          },
        },
        {
          provide: CustomerTagService,
          useValue: {
            effectiveTags: jest.fn(),
          },
        },
        {
          provide: PricingEngineService,
          useValue: {
            findMatchedWithdrawalTier: jest.fn((args: { tiers: any[] }) => args.tiers[0]),
            calculateFeeLines: jest.fn((_amount: any, feeItems: any[], currency: string) => ({
              lines: feeItems.map((f) => ({ code: f.code, amount: f.amount, currency })),
              totals: {},
            })),
          },
        },
        {
          provide: AuditLogsService,
          useValue: { recordByActor: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WithdrawQuoteService>(WithdrawQuoteService);
    prisma = module.get<PrismaService>(PrismaService);
    feeLevelService = module.get<WithdrawalFeeLevelService>(WithdrawalFeeLevelService);
    customerTagService = module.get<CustomerTagService>(CustomerTagService);
    auditMock = module.get<AuditLogsService>(AuditLogsService) as any;
  });

  it('includes the VIP level as a candidate and picks it as cheapest when customer has the VIP tag', async () => {
    (customerTagService.effectiveTags as jest.Mock).mockResolvedValue(new Set(['VIP']));

    const resolved = await service.resolveBestLevel({
      assetId: 'asset-1',
      amount: new Prisma.Decimal('100'),
      customerId: 'cust-1',
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.feeLevelId).toBe('lvl-vip');
  });

  it('excludes the VIP level and falls back to the default level when customer has no tags', async () => {
    (customerTagService.effectiveTags as jest.Mock).mockResolvedValue(new Set());

    const resolved = await service.resolveBestLevel({
      assetId: 'asset-1',
      amount: new Prisma.Decimal('100'),
      customerId: 'cust-1',
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.feeLevelId).toBe('lvl-default');
    expect(feeLevelService.findActiveByAsset).toHaveBeenCalledWith('asset-1');
  });

  it('generates quoteNo via unified generator with WQT prefix', async () => {
    (customerTagService.effectiveTags as jest.Mock).mockResolvedValue(new Set());

    const quote = await service.createQuote(validInput);
    expect(quote.quoteNo).toMatch(/^WQT\d{12}$/); // WQT + yyMMdd + 6位随机
  });

  it('quote expires 300 seconds after creation', async () => {
    try {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      (customerTagService.effectiveTags as jest.Mock).mockResolvedValue(new Set());

      const quote = await service.createQuote(validInput);
      expect(quote.expiresAt.getTime() - quote.createdAt.getTime()).toBe(300_000);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('审计三码（波二 Task 4，对齐兑换侧 SWAP_QUOTE_{CREATED,USED,CANCELLED}）', () => {
    const activeQuote = {
      id: 'quote-active-1',
      quoteNo: 'WQT260909123456',
      status: 'ACTIVE',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      ownerNo: 'C0000001',
      assetId: 'asset-1',
      amount: new Prisma.Decimal('100'),
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('writes WITHDRAW_QUOTE_CREATED with explicit requestId on create', async () => {
      (customerTagService.effectiveTags as jest.Mock).mockResolvedValue(new Set());

      const quote = await service.createQuote(validInput);

      expect(auditMock.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAW_QUOTE_CREATED',
          primarySubjectNo: quote.quoteNo,
          requestId: expect.stringContaining(`WITHDRAW_QUOTE_CREATED_${quote.quoteNo}`),
        }),
        expect.anything(),
      );
    });

    it('writes WITHDRAW_QUOTE_USED with explicit requestId on consume', async () => {
      (prisma.withdrawPricingQuote.findUnique as jest.Mock).mockResolvedValue(activeQuote);
      (prisma.withdrawPricingQuote.update as jest.Mock).mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...activeQuote, ...data }),
      );

      const updated = await service.consumeQuote(
        activeQuote.id,
        activeQuote.ownerType,
        activeQuote.ownerId,
        activeQuote.amount,
      );

      expect(auditMock.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAW_QUOTE_USED',
          primarySubjectNo: updated.quoteNo,
          requestId: expect.stringContaining(`WITHDRAW_QUOTE_USED_${updated.quoteNo}`),
        }),
        expect.anything(),
      );
    });

    it('writes WITHDRAW_QUOTE_CANCELLED with explicit requestId on cancel', async () => {
      (prisma.withdrawPricingQuote.findUnique as jest.Mock).mockResolvedValue(activeQuote);
      (prisma.withdrawPricingQuote.update as jest.Mock).mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...activeQuote, ...data }),
      );

      const updated = await service.cancelQuote(
        activeQuote.id,
        activeQuote.ownerType,
        activeQuote.ownerId,
      );

      expect(auditMock.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAW_QUOTE_CANCELLED',
          primarySubjectNo: updated.quoteNo,
          requestId: expect.stringContaining(`WITHDRAW_QUOTE_CANCELLED_${updated.quoteNo}`),
        }),
        expect.anything(),
      );
    });
  });
});

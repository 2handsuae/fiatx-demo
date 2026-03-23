import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryService } from './treasury.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('TreasuryService', () => {
  let service: TreasuryService;
  const mockPrisma = {
    wallet: {
      findMany: jest.fn(),
    },
    walletBalanceSnapshot: {
      findMany: jest.fn(),
    },
    journalLine: {
      groupBy: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TreasuryService>(TreasuryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('includes ledger-only asset even when customer has no wallet for that asset', async () => {
    mockPrisma.wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-btc',
        assetId: 'asset-btc',
        asset: { id: 'asset-btc', code: 'BTC', type: 'CRYPTO' },
      },
    ]);
    mockPrisma.walletBalanceSnapshot.findMany.mockResolvedValue([
      {
        walletId: 'wallet-btc',
        availableBalance: '7',
        restrictedBalance: '1.5',
        updatedAt: new Date('2026-03-23T08:00:00.000Z'),
      },
    ]);
    mockPrisma.journalLine.groupBy.mockResolvedValue([
      {
        assetId: 'asset-btc',
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        _sum: { amount: 100 },
      },
      {
        assetId: 'asset-aed',
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        _sum: { amount: 2500.25 },
      },
    ]);
    mockPrisma.asset.findMany.mockResolvedValue([
      { id: 'asset-btc', code: 'BTC', type: 'CRYPTO' },
      { id: 'asset-aed', code: 'AED', type: 'FIAT' },
    ]);

    const result = await service.getCustomerAssets('cust-1');
    const aed = result.find((item) => item.assetCode === 'AED');
    const btc = result.find((item) => item.assetCode === 'BTC');

    expect(result).toHaveLength(2);
    expect(aed).toEqual(
      expect.objectContaining({
        assetCode: 'AED',
        clientCredit: 2500.25,
        walletId: null,
      }),
    );
    expect(btc).toEqual(
      expect.objectContaining({
        assetCode: 'BTC',
        clientCredit: 100,
        walletId: 'wallet-btc',
        walletBalance: 8.5,
        walletBalanceSource: 'SNAPSHOT',
      }),
    );
    expect(aed).toEqual(
      expect.objectContaining({
        walletBalance: null,
        walletBalanceSource: null,
      }),
    );
  });
});

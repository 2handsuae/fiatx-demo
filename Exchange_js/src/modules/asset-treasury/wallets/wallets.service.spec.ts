import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WalletsService } from './wallets.service';
import {
  CreateWalletDto,
  OwnerType,
  WalletDirection,
  WalletType,
} from './dto/wallet.dto';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: PrismaService;

  const prismaMock = {
    asset: { findUnique: jest.fn() },
    customerMain: { findUnique: jest.fn(), findMany: jest.fn() },
    liquidityProvider: { findUnique: jest.fn(), findMany: jest.fn() },
    wallet: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    walletBalanceSnapshot: { findMany: jest.fn(), findUnique: jest.fn() },
    assetValuationRate: { findMany: jest.fn(), findUnique: jest.fn() },
  };

  const customerInboundDto: CreateWalletDto = {
    ownerType: OwnerType.CUSTOMER,
    ownerId: 'cust-1',
    type: WalletType.CRYPTO_ADDRESS,
    direction: WalletDirection.INBOUND,
    assetId: 'asset-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    (prisma as any).asset.findUnique.mockResolvedValue({ id: 'asset-1' });
    (prisma as any).customerMain.findUnique.mockResolvedValue({ id: 'cust-1' });
    (prisma as any).customerMain.findMany.mockResolvedValue([]);
    (prisma as any).liquidityProvider.findUnique.mockResolvedValue({
      id: 'lp-1',
    });
    (prisma as any).liquidityProvider.findMany.mockResolvedValue([]);
    (prisma as any).wallet.findFirst.mockResolvedValue(null);
    (prisma as any).wallet.create.mockResolvedValue({ id: 'wallet-1' });
    (prisma as any).wallet.findMany.mockResolvedValue([]);
    (prisma as any).wallet.count.mockResolvedValue(0);
    (prisma as any).wallet.findUnique.mockResolvedValue(null);
    (prisma as any).walletBalanceSnapshot.findMany.mockResolvedValue([]);
    (prisma as any).walletBalanceSnapshot.findUnique.mockResolvedValue(null);
    (prisma as any).assetValuationRate.findMany.mockResolvedValue([]);
    (prisma as any).assetValuationRate.findUnique.mockResolvedValue(null);
  });

  it('should reject PLATFORM wallet with ownerId', async () => {
    await expect(
      service.create({
        ...customerInboundDto,
        ownerType: OwnerType.PLATFORM,
        ownerId: 'not-allowed',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject CUSTOMER wallet without ownerId', async () => {
    await expect(
      service.create({
        ...customerInboundDto,
        ownerId: undefined,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject LIQUIDITY_PROVIDER wallet with invalid ownerId', async () => {
    (prisma as any).liquidityProvider.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        ...customerInboundDto,
        ownerType: OwnerType.LIQUIDITY_PROVIDER,
        ownerId: 'lp-x',
        direction: WalletDirection.OUTBOUND,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should return existing CUSTOMER INBOUND wallet when duplicate creation requested', async () => {
    const existing = {
      id: 'wallet-existing',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      direction: WalletDirection.INBOUND,
    };
    (prisma as any).wallet.findFirst.mockResolvedValue(existing);

    const result = await service.create(customerInboundDto);

    expect(result).toEqual(existing);
    expect((prisma as any).wallet.create).not.toHaveBeenCalled();
  });

  it('should map unique constraint violation to friendly error', async () => {
    (prisma as any).wallet.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create(customerInboundDto)).rejects.toThrow(
      'Inbound customer wallet already exists for this asset and type',
    );
  });

  it('should generate DEPOSIT role walletNo for customer inbound wallet', async () => {
    await service.create(customerInboundDto);

    expect((prisma as any).wallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletRole: 'DEPOSIT',
          walletNo: expect.stringMatching(/^WA-DEP-\d{10}$/),
        }),
      }),
    );
  });

  it('should enrich CUSTOMER ownerNo and ownerName from customer profile', async () => {
    (prisma as any).wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-1',
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.INBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
    ]);
    (prisma as any).wallet.count.mockResolvedValue(1);
    (prisma as any).customerMain.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        customerNo: 'CUST-0001',
        customerType: 'CORPORATE',
        companyName: 'ACME Trading',
        firstName: 'Alice',
        lastName: 'Lee',
        email: 'alice@example.com',
      },
    ]);

    const result = await service.findAll({});

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerNo: 'CUST-0001',
        ownerName: 'ACME Trading',
      }),
    );
  });

  it('should fallback CUSTOMER ownerName to full name then email', async () => {
    (prisma as any).wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-1',
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-1',
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.INBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
      {
        id: 'wallet-2',
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-2',
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.INBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
    ]);
    (prisma as any).wallet.count.mockResolvedValue(2);
    (prisma as any).customerMain.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        customerNo: 'CUST-0001',
        customerType: 'INDIVIDUAL',
        companyName: null,
        firstName: 'Alice',
        lastName: 'Lee',
        email: 'alice@example.com',
      },
      {
        id: 'cust-2',
        customerNo: 'CUST-0002',
        customerType: 'INDIVIDUAL',
        companyName: null,
        firstName: null,
        lastName: null,
        email: 'fallback@example.com',
      },
    ]);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerName: 'Alice Lee',
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        ownerName: 'fallback@example.com',
      }),
    );
  });

  it('should enrich LIQUIDITY_PROVIDER ownerName from lp name', async () => {
    (prisma as any).wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-lp',
        ownerType: OwnerType.LIQUIDITY_PROVIDER,
        ownerId: 'lp-1',
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.OUTBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
    ]);
    (prisma as any).wallet.count.mockResolvedValue(1);
    (prisma as any).liquidityProvider.findMany.mockResolvedValue([
      {
        id: 'lp-1',
        name: 'LP One',
      },
    ]);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerName: 'LP One',
      }),
    );
  });

  it('should set PLATFORM ownerName as Platform', async () => {
    (prisma as any).wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-platform',
        ownerType: OwnerType.PLATFORM,
        ownerId: null,
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.OUTBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
    ]);
    (prisma as any).wallet.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerNo: null,
        ownerName: 'Platform',
      }),
    );
  });

  it('should keep ownerNo and ownerName null when owner profile is missing', async () => {
    (prisma as any).wallet.findMany.mockResolvedValue([
      {
        id: 'wallet-missing',
        ownerType: OwnerType.CUSTOMER,
        ownerId: 'cust-missing',
        ownerNo: null,
        type: WalletType.CRYPTO_ADDRESS,
        direction: WalletDirection.INBOUND,
        asset: { code: 'USDT', type: 'CRYPTO' },
      },
    ]);
    (prisma as any).wallet.count.mockResolvedValue(1);
    (prisma as any).customerMain.findMany.mockResolvedValue([]);

    const result = await service.findAll({});

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ownerNo: null,
        ownerName: null,
      }),
    );
  });

  it('should return snapshot balance and AED valuation in findBalance', async () => {
    (prisma as any).wallet.findUnique.mockResolvedValue({
      id: 'wallet-balance-1',
      walletNo: 'WA-LIQ-BTC-BITCOIN',
      ownerType: OwnerType.PLATFORM,
      ownerId: null,
      ownerNo: 'PLATFORM',
      assetId: 'asset-btc',
      balance: '4',
      lockedBalance: '0',
      asset: {
        id: 'asset-btc',
        code: 'BTC',
        type: 'CRYPTO',
        network: 'BITCOIN',
        decimals: 8,
      },
    });
    (prisma as any).walletBalanceSnapshot.findUnique.mockResolvedValue({
      walletId: 'wallet-balance-1',
      assetId: 'asset-btc',
      availableBalance: '4',
      restrictedBalance: '0',
      totalBalance: '4',
      updatedAt: new Date('2026-02-17T00:00:00.000Z'),
    });
    (prisma as any).assetValuationRate.findUnique.mockResolvedValue({
      price: '250000',
      quoteAssetCode: 'AED',
      status: 'ACTIVE',
      updatedAt: new Date('2026-02-17T00:00:00.000Z'),
    });

    const result = await service.findBalance('wallet-balance-1');

    expect(result).toEqual(
      expect.objectContaining({
        walletId: 'wallet-balance-1',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        quoteAssetCode: 'AED',
      }),
    );
    expect(result.availableBalance.toString()).toBe('4');
    expect(result.totalAedEquivalent?.toString()).toBe('1000000');
    expect(result).not.toHaveProperty('inTransitBalance');
  });
});

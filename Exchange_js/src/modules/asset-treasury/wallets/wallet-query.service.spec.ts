import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletSurfaceCategory } from './system-wallet.util';

describe('WalletQueryService', () => {
  let service: WalletQueryService;
  let prisma: any;

  const prismaMock = {
    wallet: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    customerMain: { findUnique: jest.fn() },
    liquidityProvider: { findUnique: jest.fn() },
  };

  const mockAsset = { id: 'asset-1', code: 'USDT', type: 'CRYPTO', decimals: 6 };

  const platformWallet = {
    id: 'wallet-plat-1',
    walletNo: 'WA0001',
    ownerType: 'PLATFORM',
    ownerId: null,
    walletRole: 'F_LIQ',
    mockBalance: '1000.00',
    asset: mockAsset,
  };

  const customerWallet = {
    id: 'wallet-cust-1',
    walletNo: 'WA0002',
    ownerType: 'CUSTOMER',
    ownerId: 'cust-1',
    walletRole: 'C_DEP',
    mockBalance: '500.50',
    asset: mockAsset,
  };

  const lpWallet = {
    id: 'wallet-lp-1',
    walletNo: 'WA0003',
    ownerType: 'LIQUIDITY_PROVIDER',
    ownerId: 'lp-1',
    walletRole: 'F_LIQ',
    mockBalance: '9999.00',
    asset: mockAsset,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletQueryService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<WalletQueryService>(WalletQueryService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  // ── findAll() ────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('should return enriched items with mockBalance as balance and surfaceCategory', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(1);

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: { createdAt: 'desc' } });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].balance).toBe(platformWallet.mockBalance);
      expect(result.items[0].surfaceCategory).toBeDefined();
    });

    it('should classify PLATFORM F_LIQ wallet as PLATFORM_POOL', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(1);

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: {} });

      expect(result.items[0].surfaceCategory).toBe(WalletSurfaceCategory.PLATFORM_POOL);
    });

    it('should return total count from prisma.wallet.count', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([customerWallet, platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(42);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: 'Acme Corp',
        customerNo: 'CUST-0001',
      });

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: {} });

      expect(result.total).toBe(42);
    });
  });

  // ── findOne() ────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('should return wallet with mockBalance as balance and surfaceCategory', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: 'Acme Corp',
        customerNo: 'CUST-0001',
      });

      const result = await service.findOne('wallet-cust-1');

      expect(result.balance).toBe(customerWallet.mockBalance);
      expect(result.surfaceCategory).toBeDefined();
      expect(result.ownerName).toBe('Acme Corp');
      expect(result.ownerNo).toBe('CUST-0001');
    });

    it('should classify CUSTOMER C_DEP wallet correctly', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: null,
        fullName: 'John Doe',
        customerNo: 'CUST-0002',
      });

      const result = await service.findOne('wallet-cust-1');

      expect(result.surfaceCategory).toBe(WalletSurfaceCategory.CUSTOMER_DEPOSIT);
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should include NotFoundException with WALLET_NOT_FOUND code', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toMatchObject(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'WALLET_NOT_FOUND' }),
        }),
      );
    });
  });

  // ── findBalance() ────────────────────────────────────────────────────

  describe('findBalance()', () => {
    it('should return wallet balance info with mockBalance', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);

      const result = await service.findBalance('wallet-cust-1');

      expect(result).toEqual({
        walletId: customerWallet.id,
        walletNo: customerWallet.walletNo,
        ownerType: customerWallet.ownerType,
        ownerId: customerWallet.ownerId,
        asset: customerWallet.asset,
        balance: customerWallet.mockBalance,
      });
    });

    it('should throw NotFoundException for missing wallet', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(null);

      await expect(service.findBalance('no-such-wallet')).rejects.toThrow(NotFoundException);
    });
  });

  // ── resolveOwnerInfo() — owner enrichment ────────────────────────────

  describe('owner enrichment', () => {
    it('PLATFORM wallet → ownerName is "Platform", ownerNo is null', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(platformWallet);

      const result = await service.findOne('wallet-plat-1');

      expect(result.ownerName).toBe('Platform');
      expect(result.ownerNo).toBeNull();
    });

    it('CUSTOMER wallet → resolves customer companyName', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: 'TechCo Ltd',
        fullName: null,
        email: 'test@example.com',
        customerNo: 'CUST-0010',
      });

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('TechCo Ltd');
      expect(result.ownerNo).toBe('CUST-0010');
    });

    it('CUSTOMER wallet with no companyName → falls back to fullName', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: null,
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        customerNo: 'CUST-0011',
      });

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('Jane Smith');
    });

    it('CUSTOMER wallet with no companyName/fullName → falls back to email', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'cust-1',
        companyName: null,
        fullName: null,
        email: 'fallback@example.com',
        customerNo: 'CUST-0012',
      });

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('fallback@example.com');
    });

    it('CUSTOMER wallet with missing profile → ownerName and ownerNo are null', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findUnique.mockResolvedValue(null);

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBeNull();
      expect(result.ownerNo).toBeNull();
    });

    it('LIQUIDITY_PROVIDER wallet → resolves LP name and providerNo', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(lpWallet);
      prismaMock.liquidityProvider.findUnique.mockResolvedValue({
        id: 'lp-1',
        name: 'LiquidCorp',
        providerNo: 'LP-001',
      });

      const result = await service.findOne('wallet-lp-1');

      expect(result.ownerName).toBe('LiquidCorp');
      expect(result.ownerNo).toBe('LP-001');
    });

    it('LIQUIDITY_PROVIDER wallet with missing LP record → ownerName and ownerNo are null', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(lpWallet);
      prismaMock.liquidityProvider.findUnique.mockResolvedValue(null);

      const result = await service.findOne('wallet-lp-1');

      expect(result.ownerName).toBeNull();
      expect(result.ownerNo).toBeNull();
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WalletQueryService } from './wallet-query.service';

describe('WalletQueryService', () => {
  let service: WalletQueryService;
  let prisma: any;

  const prismaMock = {
    wallet: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      aggregate: jest.fn(),
    },
    customerMain: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    liquidityProvider: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
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
    it('should return enriched items with mockBalance as balance, no surfaceCategory', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(1);
      prismaMock.customerMain.findMany.mockResolvedValue([]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: { createdAt: 'desc' } });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].balance).toBe(platformWallet.mockBalance);
      expect(result.items[0].surfaceCategory).toBeUndefined();
    });

    it('should NOT include surfaceCategory (formerly PLATFORM_POOL)', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(1);
      prismaMock.customerMain.findMany.mockResolvedValue([]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: {} });

      expect(result.items[0].surfaceCategory).toBeUndefined();
    });

    it('should return total count from prisma.wallet.count', async () => {
      prismaMock.wallet.findMany.mockResolvedValue([customerWallet, platformWallet]);
      prismaMock.wallet.count.mockResolvedValue(42);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0001', firstName: null, lastName: null, companyName: 'Acme Corp', email: 'x@x.com' },
      ]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);

      const result = await service.findAll({ skip: 0, take: 20, where: {}, orderBy: {} });

      expect(result.total).toBe(42);
    });

    it('CUSTOMER rows batch enrich ownerName(firstName+lastName, single IN), no surfaceCategory', async () => {
      prisma.wallet.findMany.mockResolvedValue([
        { id: 'w1', ownerType: 'CUSTOMER', ownerId: 'u1', mockBalance: 5, asset: {} },
        { id: 'w2', ownerType: 'CUSTOMER', ownerId: 'u2', mockBalance: 0, asset: {} },
        { id: 'w3', ownerType: 'PLATFORM', ownerId: null, ownerNo: 'PLATFORM', mockBalance: 0, asset: {} },
      ]);
      prisma.wallet.count.mockResolvedValue(3);
      prisma.customerMain.findMany.mockResolvedValue([
        { id: 'u1', customerNo: 'CU1', firstName: 'Alice', lastName: 'Happy', companyName: null, email: 'a@x.com' },
        { id: 'u2', customerNo: 'CU2', firstName: null, lastName: null, companyName: 'Acme Ltd', email: 'b@x.com' },
      ]);

      const result = await service.findAll({ skip: 0, take: 50, where: {}, orderBy: { createdAt: 'desc' } });
      expect(result.items[0].ownerName).toBe('Alice Happy');     // firstName+lastName 优先,不再 email
      expect(result.items[0].ownerNo).toBe('CU1');
      expect(result.items[1].ownerName).toBe('Acme Ltd');        // 公司名兜底
      expect(result.items[2].ownerName).toBe('Platform');
      expect(result.items[0].surfaceCategory).toBeUndefined();
      expect(prisma.customerMain.findMany).toHaveBeenCalledTimes(1); // 批量 IN,无 N+1
    });
  });

  // ── findOne() ────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('should return wallet with mockBalance as balance, no surfaceCategory', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0001', firstName: null, lastName: null, companyName: 'Acme Corp', email: 'x@x.com' },
      ]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.balance).toBe(customerWallet.mockBalance);
      expect(result.surfaceCategory).toBeUndefined();
      expect(result.ownerName).toBe('Acme Corp');
      expect(result.ownerNo).toBe('CUST-0001');
    });

    it('should NOT include surfaceCategory (formerly CUSTOMER_DEPOSIT)', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0002', firstName: null, lastName: null, companyName: null, email: 'x@x.com' },
      ]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.surfaceCategory).toBeUndefined();
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

  // ── C_CMA derived balance (Σ VIBAN) ──────────────────────────────────

  describe('C_CMA derived balance', () => {
    const cmaWallet = {
      id: 'wallet-cma-1',
      walletNo: 'WA-CMA',
      ownerType: 'PLATFORM',
      ownerId: null,
      walletRole: 'C_CMA',
      mockBalance: '0',
      assetId: 'asset-aed',
      asset: { id: 'asset-aed', code: 'AED', type: 'FIAT', decimals: 6 },
    };

    it('findOne C_CMA → balance = Σ C_VIBAN mockBalance for the asset', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(cmaWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);
      prismaMock.wallet.aggregate.mockResolvedValue({
        _sum: { mockBalance: '4150.75' },
      });

      const result = await service.findOne('wallet-cma-1');

      expect(prismaMock.wallet.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletRole: 'C_VIBAN', assetId: 'asset-aed' },
          _sum: { mockBalance: true },
        }),
      );
      expect(result.balance).toBe('4150.75');
    });

    it('findOne C_CMA with no VIBANs → balance 0', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(cmaWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);
      prismaMock.wallet.aggregate.mockResolvedValue({
        _sum: { mockBalance: null },
      });

      const result = await service.findOne('wallet-cma-1');

      expect(result.balance).toBe('0');
    });

    it('non-C_CMA wallet → reads own mockBalance, no aggregate call', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.balance).toBe(customerWallet.mockBalance);
      expect(prismaMock.wallet.aggregate).not.toHaveBeenCalled();
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

  // ── owner enrichment ────────────────────────────────────────────────

  describe('owner enrichment', () => {
    it('PLATFORM wallet → ownerName is "Platform"', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(platformWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([]);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);

      const result = await service.findOne('wallet-plat-1');

      expect(result.ownerName).toBe('Platform');
    });

    it('CUSTOMER wallet → resolves customer companyName when no firstName/lastName', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0010', firstName: null, lastName: null, companyName: 'TechCo Ltd', email: 'test@example.com' },
      ]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('TechCo Ltd');
      expect(result.ownerNo).toBe('CUST-0010');
    });

    it('CUSTOMER wallet with firstName+lastName → uses firstName+lastName (not email)', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0011', firstName: 'Jane', lastName: 'Smith', companyName: null, email: 'jane@example.com' },
      ]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('Jane Smith');
    });

    it('CUSTOMER wallet with no name fields → falls back to email', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([
        { id: 'cust-1', customerNo: 'CUST-0012', firstName: null, lastName: null, companyName: null, email: 'fallback@example.com' },
      ]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBe('fallback@example.com');
    });

    it('CUSTOMER wallet with missing profile → ownerName and ownerNo are null', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(customerWallet);
      prismaMock.customerMain.findMany.mockResolvedValue([]);

      const result = await service.findOne('wallet-cust-1');

      expect(result.ownerName).toBeNull();
      expect(result.ownerNo).toBeNull();
    });

    it('LIQUIDITY_PROVIDER wallet → resolves LP name and providerNo', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(lpWallet);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([
        { id: 'lp-1', name: 'LiquidCorp', providerNo: 'LP-001' },
      ]);

      const result = await service.findOne('wallet-lp-1');

      expect(result.ownerName).toBe('LiquidCorp');
      expect(result.ownerNo).toBe('LP-001');
    });

    it('LIQUIDITY_PROVIDER wallet with missing LP record → ownerName and ownerNo are null', async () => {
      prismaMock.wallet.findUnique.mockResolvedValue(lpWallet);
      prismaMock.liquidityProvider.findMany.mockResolvedValue([]);

      const result = await service.findOne('wallet-lp-1');

      expect(result.ownerName).toBeNull();
      expect(result.ownerNo).toBeNull();
    });
  });
});

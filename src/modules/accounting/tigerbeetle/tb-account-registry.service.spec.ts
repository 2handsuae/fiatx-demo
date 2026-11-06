// src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts
import { TbAccountRegistryService, postedBalanceForCode } from './tb-account-registry.service';

describe('TbAccountRegistryService', () => {
  let service: TbAccountRegistryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tbAccountRegistry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customerMain: { findMany: jest.fn() },
      wallet: { findMany: jest.fn().mockResolvedValue([]) },
      liquidityProvider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mockTbService: any = { lookupAccounts: jest.fn().mockResolvedValue([]) };
    service = new TbAccountRegistryService(mockPrisma, mockTbService);
  });

  describe('register', () => {
    it('should create a registry entry', async () => {
      mockPrisma.tbAccountRegistry.create.mockResolvedValue({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
      });

      const result = await service.register({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
        ownerNo: 'CUST-001',
        assetCurrency: 'AED',
      });

      expect(mockPrisma.tbAccountRegistry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbAccountId: 'abc123',
          code: 100,
          ledger: 1,
        }),
      });
      expect(result.tbAccountId).toBe('abc123');
    });
  });

  describe('resolve', () => {
    it('should find account by code+ledger+ownerType+ownerUuid', async () => {
      mockPrisma.tbAccountRegistry.findFirst.mockResolvedValue({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      const result = await service.resolve({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      expect(result?.tbAccountId).toBe('abc123');
    });

    it('should return null when not found', async () => {
      mockPrisma.tbAccountRegistry.findFirst.mockResolvedValue(null);

      const result = await service.resolve({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'nonexistent',
      });

      expect(result).toBeNull();
    });
  });

  describe('findByOwner', () => {
    it('should return all accounts for an owner UUID', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', code: 100, ledger: 1 },
        { tbAccountId: 'a2', code: 100, ledger: 2 },
      ]);

      const result = await service.findByOwner('uuid-1');
      expect(result).toHaveLength(2);
      expect(mockPrisma.tbAccountRegistry.findMany).toHaveBeenCalledWith({
        where: { ownerUuid: 'uuid-1', status: 'ACTIVE' },
      });
    });
  });

  describe('findAll q + ownerName enrich', () => {
    it('CUSTOMER 行批量附 ownerName,SYSTEM 行为 null(单次 IN 查询)', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', ownerType: 'CUSTOMER', ownerUuid: 'u1', ownerNo: 'CU1' },
        { tbAccountId: 'a2', ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null },
      ]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(2);
      mockPrisma.customerMain.findMany.mockResolvedValue([{ id: 'u1', firstName: 'Alice', lastName: 'Happy' }]);

      const { items } = await service.findAll({});
      expect(items[0].ownerName).toBe('Alice Happy');
      expect(items[1].ownerName).toBeNull();
      expect(mockPrisma.customerMain.findMany).toHaveBeenCalledTimes(1); // 无 N+1
    });

    it('LP 行(应收户 51)批量附 ownerName = LP 名称(一次 IN 联 liquidityProvider,无 N+1);无 LP 行时不查 LP 表;CUSTOMER / SYSTEM 行不受影响(戊波二)', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', code: 51, ownerType: 'LP', ownerUuid: 'lp1', ownerNo: 'LPP1' },
        { tbAccountId: 'a2', code: 51, ownerType: 'LP', ownerUuid: 'lp1', ownerNo: 'LPP1' },
        { tbAccountId: 'a3', code: 51, ownerType: 'LP', ownerUuid: 'lp2', ownerNo: 'LPP2' },
        { tbAccountId: 'a4', code: 100, ownerType: 'CUSTOMER', ownerUuid: 'u1', ownerNo: 'CU1' },
        { tbAccountId: 'a5', code: 200, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null },
      ]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(5);
      mockPrisma.customerMain.findMany.mockResolvedValue([{ id: 'u1', firstName: 'Alice', lastName: 'Happy' }]);
      // 行为化 mock:真按 where.id.in 过滤
      const lps = [{ id: 'lp1', name: 'Falcon Liquidity FZE' }, { id: 'lp2', name: 'Dune Markets Ltd' }, { id: 'lp3', name: 'Not Queried' }];
      mockPrisma.liquidityProvider.findMany.mockImplementation(async ({ where }: any) => lps.filter((l) => where.id.in.includes(l.id)));

      const { items } = await service.findAll({ ownerType: 'LP', code: 51 });

      expect(items.map((r: any) => r.ownerName)).toEqual(['Falcon Liquidity FZE', 'Falcon Liquidity FZE', 'Dune Markets Ltd', 'Alice Happy', null]);
      expect(mockPrisma.liquidityProvider.findMany).toHaveBeenCalledTimes(1); // 无 N+1
      expect(mockPrisma.liquidityProvider.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['lp1', 'lp2']); // 去重后只问用到的

      // 一页里没有 LP 行 → 不碰 LP 表
      mockPrisma.liquidityProvider.findMany.mockClear();
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([{ tbAccountId: 'a5', code: 200, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null }]);
      await service.findAll({});
      expect(mockPrisma.liquidityProvider.findMany).not.toHaveBeenCalled();
    });

    it('WALLET 行批量附 walletRole / walletNo(按 ownerUuid 一次 IN 联 wallets,无 N+1);非 WALLET 行两者为 null(戊波一 T8)', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', code: 50, ownerType: 'WALLET', ownerUuid: 'w-ops', ownerNo: 'WA-OPS' },
        { tbAccountId: 'a2', code: 50, ownerType: 'WALLET', ownerUuid: 'w-liq', ownerNo: 'WA-LIQ' },
        { tbAccountId: 'a3', code: 1, ownerType: 'WALLET', ownerUuid: 'w-cust', ownerNo: 'WA-CUST' },
        { tbAccountId: 'a4', code: 200, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null },
      ]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(4);
      // 行为化 mock:真按 where.id.in 过滤
      const wallets = [
        { id: 'w-ops', walletNo: 'WA-OPS', walletRole: 'F_OPS' },
        { id: 'w-liq', walletNo: 'WA-LIQ', walletRole: 'F_LIQ' },
        { id: 'w-cust', walletNo: 'WA-CUST', walletRole: 'C_DEP' },
        { id: 'w-other', walletNo: 'WA-OTHER', walletRole: 'F_SET' },
      ];
      mockPrisma.wallet.findMany.mockImplementation(async ({ where }: any) => wallets.filter((w) => where.id.in.includes(w.id)));

      const { items } = await service.findAll({});

      expect(items.map((r: any) => [r.walletRole, r.walletNo])).toEqual([
        ['F_OPS', 'WA-OPS'],
        ['F_LIQ', 'WA-LIQ'],
        ['C_DEP', 'WA-CUST'],
        [null, null],
      ]);
      expect(mockPrisma.wallet.findMany).toHaveBeenCalledTimes(1); // 无 N+1
      expect(mockPrisma.wallet.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['w-cust', 'w-liq', 'w-ops']);
      // 既有字段不动、不新增 UUID 字段
      expect(items[0].ownerUuid).toBe('w-ops');
    });

    it('accountName:现金户(WALLET)下发注册表户名 description,其余户照一码一名(戊波一 T12,spec §2.1)', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', code: 50, ownerType: 'WALLET', ownerUuid: 'w-ops', ownerNo: 'WA-OPS', description: 'Company Cash · Company Operations · AED_ZAND' },
        { tbAccountId: 'a2', code: 1, ownerType: 'WALLET', ownerUuid: 'w-cust', ownerNo: 'WA-CUST', description: 'Client Cash · CU2601012635 · vIBAN' },
        { tbAccountId: 'a3', code: 200, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null, description: 'whatever' },
        { tbAccountId: 'a4', code: 100, ownerType: 'CUSTOMER', ownerUuid: 'u1', ownerNo: 'CU1', description: null },
      ]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(4);
      mockPrisma.wallet.findMany.mockResolvedValue([]);
      mockPrisma.customerMain.findMany.mockResolvedValue([]);

      const { items } = await service.findAll({});

      expect(items.map((r: any) => r.accountName)).toEqual([
        'Company Cash · Company Operations · AED_ZAND',
        'Client Cash · CU2601012635 · vIBAN',
        'Company Equity',
        'Payable to Clients – Available Balance',
      ]);
    });

    it('页内没有 WALLET 行 → 不查 wallets', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a4', code: 200, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null },
      ]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(1);

      const { items } = await service.findAll({});

      expect(mockPrisma.wallet.findMany).not.toHaveBeenCalled();
      expect(items[0].walletRole).toBeNull();
      expect(items[0].walletNo).toBeNull();
    });

    it('q 命中 ownerNo/姓名/description 三路 OR', async () => {
      mockPrisma.customerMain.findMany
        .mockResolvedValueOnce([{ id: 'u9' }]) // 姓名反查
        .mockResolvedValueOnce([]);            // enrich 批量
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([]);
      mockPrisma.tbAccountRegistry.count.mockResolvedValue(0);

      await service.findAll({ q: 'ali' });
      const where = mockPrisma.tbAccountRegistry.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { ownerNo: { contains: 'ali' } },
        { description: { contains: 'ali' } },
        { ownerUuid: { in: ['u9'] } },
      ]);
    });
  });
});

describe('postedBalanceForCode', () => {
  it('asset code (1=CLIENT_CASH): debits − credits', () => {
    expect(postedBalanceForCode({ debits_posted: 500n, credits_posted: 200n }, 1)).toBe('300');
  });
  it('liability code (100=CLIENT_PAYABLE): credits − debits', () => {
    expect(postedBalanceForCode({ debits_posted: 200n, credits_posted: 500n }, 100)).toBe('300');
  });
  it('equity code (200=FIRM_EQUITY): credits − debits', () => {
    expect(postedBalanceForCode({ debits_posted: 0n, credits_posted: 700n }, 200)).toBe('700');
  });
});

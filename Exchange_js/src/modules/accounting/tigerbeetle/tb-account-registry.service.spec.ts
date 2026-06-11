// src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts
import { TbAccountRegistryService } from './tb-account-registry.service';

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
    };
    service = new TbAccountRegistryService(mockPrisma);
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

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
        create: jest.fn(),
        update: jest.fn(),
      },
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
        assetCode: 'AED',
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
});

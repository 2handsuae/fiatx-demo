import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('WithdrawalAddressService', () => {
  let service: WithdrawalAddressService;
  let prisma: any;

  const prismaMock = {
    withdrawalAddress: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockAsset = { id: 'asset-1', code: 'ETH', type: 'CRYPTO', network: 'ETH', status: 'ACTIVE', decimals: 18 };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalAddressService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(WithdrawalAddressService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('creates a withdrawal address with PENDING_ACTIVATION status', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      prismaMock.withdrawalAddress.create.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD2605130001', status: 'PENDING_ACTIVATION',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      });

      const result = await service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      });

      expect(result.status).toBe('PENDING_ACTIVATION');
      expect(prismaMock.withdrawalAddress.create).toHaveBeenCalledTimes(1);
    });

    it('rejects when address limit reached', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(3);
      await expect(service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid address format', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      await expect(service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: 'not-a-valid-address',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('activate', () => {
    it('activates an expired PENDING_ACTIVATION address', async () => {
      const pastDate = new Date(Date.now() - 86400001);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: pastDate,
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({
        id: 'wa-1', status: 'ACTIVE', activatedAt: expect.any(Date),
      });
      const result = await service.activate('WAD001');
      expect(result.status).toBe('ACTIVE');
    });

    it('returns existing ACTIVE address idempotently', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      const result = await service.activate('WAD001');
      expect(result.status).toBe('ACTIVE');
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects activation before cooling period expires', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: futureDate,
      });
      await expect(service.activate('WAD001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING_ACTIVATION address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'CANCELLED' });
      const result = await service.cancel('WAD001', 'cust-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects cancel from wrong customer', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-OTHER')).rejects.toThrow(ForbiddenException);
    });

    it('rejects cancel of non-PENDING address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('suspend', () => {
    it('suspends an ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'SUSPENDED' });
      const result = await service.suspend('WAD001', 'ADM001', 'Sanctioned address');
      expect(result.status).toBe('SUSPENDED');
    });

    it('rejects suspend of non-ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION',
      });
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('listAll', () => {
    it('q → OR[addressNo/address/iban contains],customerName 由 customer 关联铺平', async () => {
      prisma.withdrawalAddress.findMany.mockResolvedValue([
        { id: 'a1', addressNo: 'ADDR1', customerNo: 'CU1', label: 'My Binance',
          customer: { firstName: 'Alice', lastName: 'Happy' }, asset: { code: 'USDT-TRON' } },
        { id: 'a2', addressNo: 'ADDR2', customerNo: 'CU2', label: null,
          customer: { firstName: null, lastName: null }, asset: { code: 'AED' } },
      ]);
      prisma.withdrawalAddress.count.mockResolvedValue(2);

      const result = await service.listAll({ q: 'TVx9', take: 50, skip: 0 } as any);
      const where = prisma.withdrawalAddress.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { addressNo: { contains: 'TVx9' } },
        { address: { contains: 'TVx9' } },
        { iban: { contains: 'TVx9' } },
      ]);
      expect(result.items[0].customerName).toBe('Alice Happy');
      expect(result.items[1].customerName).toBeNull();
      expect(result.items[0].customer).toBeUndefined(); // 关联对象不泄给前端
    });
  });
});

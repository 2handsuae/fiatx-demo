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
    fundsOrder: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

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
        address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      });

      const result = await service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        network: 'TRON',
        address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
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
        network: 'TRON',
        address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', network: 'TRON', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
      });
    });

    it('rejects invalid address format', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      await expect(service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        network: 'TRON',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
    });

    it('rejects a bank-rail network for on-chain registration (NETWORK_NOT_CHAIN)', async () => {
      await expect(service.create({ customerId: 'cust-1', customerNo: 'CUS001', network: 'AED_ZAND', address: 'AE070860000000000000001', addressType: 'SELF_CUSTODY', traceId: 't', ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION' }))
        .rejects.toMatchObject({ response: { code: 'NETWORK_NOT_CHAIN' } });
    });
  });

  describe('createBankAccount', () => {
    const baseInput = {
      customerId: 'cust-1', customerNo: 'CUS001',
      iban: 'DE89370400440532013000',
      swiftBic: 'DEUTDEFF',
      bankName: 'Deutsche Bank',
      beneficiaryName: 'Alice Happy',
      ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      traceId: 'trace-1',
    };

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    });

    it('first bank address (count→0) auto-activates: status ACTIVE', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      prismaMock.withdrawalAddress.create.mockImplementation(async ({ data }: any) => ({
        id: 'wa-1', addressNo: data.addressNo, status: data.status, network: data.network,
        activatesAt: data.activatesAt, activatedAt: data.activatedAt,
      }));

      const result = await service.createBankAccount(baseInput as any);

      expect(result.status).toBe('ACTIVE');
      expect(result.activatedAt).toBeInstanceOf(Date);
      expect((result as any).network).toBe('AED_ZAND');
      expect(prismaMock.withdrawalAddress.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.withdrawalAddress.create.mock.calls[0][0].data.network).toBe('AED_ZAND');
    });

    it('second bank address (count→1) keeps PENDING_ACTIVATION with 24h cooling', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);
      prismaMock.withdrawalAddress.create.mockImplementation(async ({ data }: any) => ({
        id: 'wa-2', addressNo: data.addressNo, status: data.status,
        activatesAt: data.activatesAt, activatedAt: data.activatedAt,
      }));

      const result = await service.createBankAccount(baseInput as any);

      expect(result.status).toBe('PENDING_ACTIVATION');
      expect(result.activatedAt).toBeNull();
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

    it('rejects activating an ACTIVE address (409 Invalid transition)', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      await expect(service.activate('WAD001')).rejects.toBeInstanceOf(ConflictException);
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
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toThrow(/Invalid transition/);
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
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toThrow(/Invalid transition/);
    });
  });

  describe('unsuspend', () => {
    it('SUSPENDED → ACTIVE，清空三个 suspend 字段', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'SUSPENDED' });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      const r = await service.unsuspend('WAD1');
      expect(r.status).toBe('ACTIVE');
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'ACTIVE', suspendedAt: null, suspendedBy: null, suspendReason: null },
      }));
    });
    it('ACTIVE 不能 unsuspend → 409', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', status: 'ACTIVE' });
      await expect(service.unsuspend('WAD1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateDetails', () => {
    it('只改 label / beneficiaryName，地址本身不动', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'ACTIVE', label: 'old', beneficiaryName: null });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ addressNo: 'WAD1', label: 'Ledger' });
      await service.updateDetails('WAD1', 'cust-1', { label: 'Ledger' });
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({ where: { addressNo: 'WAD1' }, data: { label: 'Ledger' } });
    });
    it('终态（DEACTIVATED）不可改 → 409；别人的地址 → 403', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-1', status: 'DEACTIVATED' });
      await expect(service.updateDetails('WAD1', 'cust-1', { label: 'x' })).rejects.toBeInstanceOf(ConflictException);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ addressNo: 'WAD1', customerId: 'cust-2', status: 'ACTIVE' });
      await expect(service.updateDetails('WAD1', 'cust-1', { label: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
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

  describe('hasActiveFiatWithdrawalAddress', () => {
    it('returns true when customer has ≥1 active BANK address', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);
      const result = await service.hasActiveFiatWithdrawalAddress('cust-1');
      expect(result).toBe(true);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', status: 'ACTIVE', addressType: 'BANK' },
      });
    });

    it('returns false when customer has no active BANK address', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      const result = await service.hasActiveFiatWithdrawalAddress('cust-1');
      expect(result).toBe(false);
    });
  });

  describe('countActiveFiatAddresses', () => {
    it('returns the count of active BANK addresses', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(3);
      const result = await service.countActiveFiatAddresses('cust-1');
      expect(result).toBe(3);
      expect(prismaMock.withdrawalAddress.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', status: 'ACTIVE', addressType: 'BANK' },
      });
    });
  });

  describe('deactivate', () => {
    const activeBankAddr = {
      id: 'wa-1', addressNo: 'WAD001', customerId: 'cust-1',
      status: 'ACTIVE', addressType: 'BANK', iban: 'DE89370400440532013000', address: 'DE89370400440532013000',
    };
    const activeCryptoAddr = {
      id: 'wa-2', addressNo: 'WAD002', customerId: 'cust-1',
      status: 'ACTIVE', addressType: 'SELF_CUSTODY', iban: null, address: '0xabc123',
    };

    it('rejects deactivating the last active fiat (BANK) address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeBankAddr);
      prismaMock.withdrawalAddress.count.mockResolvedValue(1); // countActiveFiatAddresses <= 1

      await expect(service.deactivate('WAD001', 'cust-1')).rejects.toThrow(BadRequestException);
      await expect(service.deactivate('WAD001', 'cust-1')).rejects.toMatchObject({
        response: { code: 'LAST_ACTIVE_FIAT_ADDRESS' },
      });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects deactivating an address with an in-flight withdrawal', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeCryptoAddr);
      prismaMock.fundsOrder.count.mockResolvedValue(1);

      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(BadRequestException);
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toMatchObject({
        response: { code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL' },
      });
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('deactivates an ACTIVE non-last address with no in-flight withdrawal', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(activeCryptoAddr);
      prismaMock.fundsOrder.count.mockResolvedValue(0);
      prismaMock.withdrawalAddress.update.mockResolvedValue({
        id: 'wa-2', addressNo: 'WAD002', status: 'DEACTIVATED', deactivatedAt: new Date(), deactivatedBy: 'CUSTOMER',
      });

      const result = await service.deactivate('WAD002', 'cust-1');

      expect(result.status).toBe('DEACTIVATED');
      expect(result.deactivatedBy).toBe('CUSTOMER');
      expect(prismaMock.withdrawalAddress.update).toHaveBeenCalledWith({
        where: { id: 'wa-2' },
        data: { status: 'DEACTIVATED', deactivatedAt: expect.any(Date), deactivatedBy: 'CUSTOMER' },
      });
    });

    it('rejects deactivating a non-ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        ...activeCryptoAddr, status: 'PENDING_ACTIVATION',
      });

      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(/Invalid transition/);
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects when address not found or not owned by customer', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('WAD999', 'cust-1')).rejects.toThrow(NotFoundException);

      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({ ...activeCryptoAddr, customerId: 'cust-OTHER' });
      await expect(service.deactivate('WAD002', 'cust-1')).rejects.toThrow(NotFoundException);
    });
  });
});

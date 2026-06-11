import { NotFoundException } from '@nestjs/common';
import { TbAdminController } from './tb-admin.controller';

describe('TbAdminController', () => {
  let controller: TbAdminController;
  let registryService: any;
  let accountingService: any;
  let evidenceService: any;
  let tbManualAccountService: any;

  beforeEach(() => {
    registryService = {
      findByTbAccountId: jest.fn(),
      findAll: jest.fn(),
    };
    accountingService = {
      lookupBalance: jest.fn(),
    };
    evidenceService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };
    tbManualAccountService = {
      manualCreate: jest.fn(),
    };
    controller = new TbAdminController(
      registryService,
      evidenceService,
      accountingService,
      tbManualAccountService,
      {} as any,
    );
  });

  describe('findOneAccount', () => {
    const mockRegistry = {
      tbAccountId: 'abc123def456',
      code: 10,
      ledger: 2,
      ownerType: 'SYSTEM',
      ownerUuid: null,
      ownerNo: null,
      assetCode: 'USDT',
      status: 'ACTIVE',
      description: 'CUSTODY for USDT',
      flags: 0,
      createdAt: new Date('2026-05-12T00:00:00Z'),
    };

    it('returns registry + balance when TB is available', async () => {
      registryService.findByTbAccountId.mockResolvedValue(mockRegistry);
      accountingService.lookupBalance.mockResolvedValue({
        debitsPosted: 1000n,
        creditsPosted: 5000n,
        debitsPending: 200n,
        creditsPending: 0n,
      });

      const result = await controller.findOneAccount('abc123def456');

      expect(result.tbAccountId).toBe('abc123def456');
      expect(result.code).toBe(10);
      expect(result.debitsPosted).toBe('1000');
      expect(result.creditsPosted).toBe('5000');
      expect(result.debitsPending).toBe('200');
      expect(result.creditsPending).toBe('0');
      expect(result.netBalance).toBe('4000');
    });

    it('returns registry with null balance when TB is unavailable', async () => {
      registryService.findByTbAccountId.mockResolvedValue(mockRegistry);
      accountingService.lookupBalance.mockRejectedValue(new Error('TB connection refused'));

      const result = await controller.findOneAccount('abc123def456');

      expect(result.tbAccountId).toBe('abc123def456');
      expect(result.code).toBe(10);
      expect(result.debitsPosted).toBeNull();
      expect(result.creditsPosted).toBeNull();
      expect(result.netBalance).toBeNull();
    });

    it('throws 404 when registry entry not found', async () => {
      registryService.findByTbAccountId.mockResolvedValue(null);

      await expect(controller.findOneAccount('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneTransfer', () => {
    const mockEvidence = {
      tbTransferId: 'aabb00112233',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP2605120001',
      eventCode: 'EVT_DEPOSIT_SUCCESS',
      debitCode: 'L.CLIENT_PAYABLE',
      creditCode: 'A.CLIENT_CUSTODY',
      amount: '1000.00',
      assetCode: 'USDT',
      transferType: 'POSTED',
      traceId: '550e8400-e29b-41d4-a716-446655440000',
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      memo: null,
      pendingId: null,
      createdAt: new Date('2026-05-30T10:00:00Z'),
    };

    it('returns evidence when found', async () => {
      evidenceService.findOne.mockResolvedValue(mockEvidence);

      const result = await controller.findOneTransfer('aabb00112233');

      expect(result.tbTransferId).toBe('aabb00112233');
      expect(result.sourceType).toBe('DEPOSIT');
      expect(evidenceService.findOne).toHaveBeenCalledWith('aabb00112233');
    });

    it('throws 404 when evidence not found', async () => {
      evidenceService.findOne.mockResolvedValue(null);

      await expect(controller.findOneTransfer('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});

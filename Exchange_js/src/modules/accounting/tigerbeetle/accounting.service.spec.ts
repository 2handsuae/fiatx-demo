// src/modules/accounting/tigerbeetle/accounting.service.spec.ts
jest.mock('tigerbeetle-node', () => ({
  id: jest.fn().mockReturnValue(12345n),
  CreateTransferStatus: {
    exists: 'exists',
    created: 'created',
  },
  TransferFlags: {
    pending: 1,
    post_pending_transfer: 2,
    void_pending_transfer: 4,
  },
}));

import { AccountingService } from './accounting.service';
import { CreateTransferStatus } from 'tigerbeetle-node';

describe('AccountingService', () => {
  let service: AccountingService;
  let mockTbService: any;
  let mockRegistryService: any;
  let mockEvidenceService: any;

  beforeEach(() => {
    mockTbService = {
      createAccounts: jest.fn().mockResolvedValue([]),
      createTransfers: jest.fn().mockResolvedValue([]),
      lookupAccounts: jest.fn().mockResolvedValue([]),
      lookupTransfers: jest.fn().mockResolvedValue([]),
    };
    mockRegistryService = {
      register: jest.fn().mockResolvedValue({ tbAccountId: 'abc' }),
      resolve: jest.fn().mockResolvedValue({ tbAccountId: 'abc' }),
    };
    mockEvidenceService = {
      writeEvidence: jest.fn().mockResolvedValue(undefined),
    };

    service = new AccountingService(mockTbService, mockRegistryService, mockEvidenceService);
  });

  describe('createAccounts', () => {
    it('should create TB accounts and register them', async () => {
      await service.createAccounts([{
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
        ownerNo: 'CUST-001',
        assetCurrency: 'AED',
      }]);

      expect(mockTbService.createAccounts).toHaveBeenCalledTimes(1);
      expect(mockRegistryService.register).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeTransfer', () => {
    it('should create TB transfer and write evidence', async () => {
      const result = await service.executeTransfer({
        debitAccountId: 1n,
        creditAccountId: 2n,
        amount: 10000n,
        ledger: 1,
        code: 10,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP-001',
          eventCode: 'DEPOSIT_CREDIT',
          traceId: 'trace-1',
          debitCode: 'A.CLIENT_CUSTODY',
          creditCode: 'L.CLIENT_PAYABLE',
          assetCurrency: 'AED',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
        },
      });

      expect(mockTbService.createTransfers).toHaveBeenCalledTimes(1);
      expect(mockEvidenceService.writeEvidence).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('tbTransferId');
    });

    it('should throw when TB rejects the transfer', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { index: 0, result: 'exceeds_credits' },
      ]);

      await expect(
        service.executeTransfer({
          debitAccountId: 1n,
          creditAccountId: 2n,
          amount: 10000n,
          ledger: 1,
          code: 10,
          evidence: {
            sourceType: 'DEPOSIT',
            sourceNo: 'DEP-001',
            eventCode: 'DEPOSIT_CREDIT',
            traceId: 'trace-1',
            debitCode: 'A.CLIENT_CUSTODY',
            creditCode: 'L.CLIENT_PAYABLE',
            assetCurrency: 'AED',
            actorType: 'SYSTEM',
            actorId: 'SYSTEM',
          },
        }),
      ).rejects.toThrow();
    });

    it('idempotent replay: TB exists → skip writeEvidence, return transferId normally', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { status: CreateTransferStatus.exists },
      ]);

      const result = await service.executeTransfer({
        debitAccountId: 1n,
        creditAccountId: 2n,
        amount: 10000n,
        ledger: 1,
        code: 10,
        evidence: {
          sourceType: 'FIAT_SETTLEMENT',
          sourceNo: 'IT0001',
          eventCode: 'SETTLE_POOL_TO_FIRM',
          traceId: 'trace-2',
          debitCode: 'A.FIRM_TREASURY',
          creditCode: 'L.CLIENT_BANK',
          assetCurrency: 'AED',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
        },
      });

      // Evidence must NOT be written on idempotent replay
      expect(mockEvidenceService.writeEvidence).not.toHaveBeenCalled();
      // But a valid tbTransferId must still be returned
      expect(result).toHaveProperty('tbTransferId');
    });
  });

  describe('executePendingTransfer', () => {
    it('idempotent replay: TB exists → skip writeEvidence, return transferId normally', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { status: CreateTransferStatus.exists },
      ]);

      const result = await service.executePendingTransfer({
        debitAccountId: 1n,
        creditAccountId: 2n,
        amount: 5000n,
        ledger: 1,
        code: 20,
        timeout: 60,
        evidence: {
          sourceType: 'FIAT_SETTLEMENT',
          sourceNo: 'IT0002',
          eventCode: 'SETTLE_PENDING',
          traceId: 'trace-3',
          debitCode: 'A.FIRM_TREASURY',
          creditCode: 'L.CLIENT_BANK',
          assetCurrency: 'AED',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
        },
      });

      expect(mockEvidenceService.writeEvidence).not.toHaveBeenCalled();
      expect(result).toHaveProperty('tbTransferId');
    });
  });

  describe('lookupBalance', () => {
    it('should return balance from TB account', async () => {
      mockTbService.lookupAccounts.mockResolvedValue([{
        debits_posted: 500n,
        credits_posted: 1000n,
        debits_pending: 100n,
        credits_pending: 0n,
      }]);

      const result = await service.lookupBalance(1n);

      expect(result.debitsPosted).toBe(500n);
      expect(result.creditsPosted).toBe(1000n);
      expect(result.debitsPending).toBe(100n);
      expect(result.creditsPending).toBe(0n);
    });

    it('should throw when account not found', async () => {
      mockTbService.lookupAccounts.mockResolvedValue([]);

      await expect(service.lookupBalance(999n)).rejects.toThrow();
    });
  });

  describe('getCustomerAvailableBalance', () => {
    it('should compute available = credits_posted - debits_posted - debits_pending', async () => {
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'abc' });
      mockTbService.lookupAccounts.mockResolvedValue([{
        debits_posted: 200n,
        credits_posted: 1000n,
        debits_pending: 100n,
        credits_pending: 0n,
      }]);

      const result = await service.getCustomerAvailableBalance('uuid-1', 'AED');

      expect(result.available).toBe(700n);  // 1000 - 200 - 100
      expect(result.held).toBe(100n);
      expect(result.total).toBe(800n);      // 1000 - 200
    });
  });

  describe('resolveTbAccountId', () => {
    it('should return bigint account ID from registry', async () => {
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'ff' });

      const result = await service.resolveTbAccountId({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      expect(result).toBe(255n); // 0xff
    });

    it('should throw when registry entry not found', async () => {
      mockRegistryService.resolve.mockResolvedValue(null);

      await expect(
        service.resolveTbAccountId({
          code: 100,
          ledger: 1,
          ownerType: 'CUSTOMER',
          ownerUuid: 'nonexistent',
        }),
      ).rejects.toThrow();
    });
  });
});

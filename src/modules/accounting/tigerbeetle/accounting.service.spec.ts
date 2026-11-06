// src/modules/accounting/tigerbeetle/accounting.service.spec.ts
jest.mock('tigerbeetle-node', () => ({
  id: jest.fn().mockReturnValue(12345n),
  CreateTransferStatus: {
    exists: 'exists',
    created: 'created',
    pending_transfer_already_posted: 'pending_transfer_already_posted',
    pending_transfer_already_voided: 'pending_transfer_already_voided',
  },
  TransferFlags: {
    pending: 1,
    post_pending_transfer: 2,
    void_pending_transfer: 4,
  },
  // 标志位取真实枚举：accountFlagsFor 的默认值断言不能靠本 mock 自证
  AccountFlags: jest.requireActual('tigerbeetle-node').AccountFlags,
}));

import { NotFoundException } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { CreateTransferStatus } from 'tigerbeetle-node';

describe('AccountingService', () => {
  let service: AccountingService;
  let mockTbService: any;
  let mockRegistryService: any;
  let mockEvidenceService: any;
  let mockPrisma: any;

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
      updateTransferType: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = { wallet: { findUnique: jest.fn() } };

    service = new AccountingService(mockTbService, mockRegistryService, mockEvidenceService, mockPrisma);
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

    // 戊波一：账本不得为负。flags 按类别默认，TB 与注册表两处写同一个值。
    it('createAccounts defaults flags to 2 for code 100 (credit-normal: debits_must_not_exceed_credits)', async () => {
      await service.createAccounts([{ code: 100, ledger: 1, ownerType: 'CUSTOMER', ownerUuid: 'uuid-1', assetCurrency: 'AED' }]);
      expect(mockTbService.createAccounts.mock.calls[0][0][0].flags).toBe(2);
      expect(mockRegistryService.register.mock.calls[0][0].flags).toBe(2);
    });

    it('createAccounts defaults flags to 4 for code 1 (debit-normal: credits_must_not_exceed_debits)', async () => {
      await service.createAccounts([{ code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'wallet-uuid', assetCurrency: 'USDT' }]);
      expect(mockTbService.createAccounts.mock.calls[0][0][0].flags).toBe(4);
      expect(mockRegistryService.register.mock.calls[0][0].flags).toBe(4);
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

  describe('postPendingTransfer', () => {
    const params = { pendingTransferId: 999n, amount: 5000n };

    it('normal post: forwards to TB and flips evidence → POSTED', async () => {
      mockTbService.createTransfers.mockResolvedValue([]);
      await service.postPendingTransfer(params as any);
      expect(mockTbService.createTransfers).toHaveBeenCalledTimes(1);
      expect(mockEvidenceService.updateTransferType).toHaveBeenCalledTimes(1);
    });

    it('idempotent replay: pending already posted → no throw, skip evidence rewrite', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { status: CreateTransferStatus.pending_transfer_already_posted },
      ]);
      await expect(service.postPendingTransfer(params as any)).resolves.toBeUndefined();
      expect(mockEvidenceService.updateTransferType).not.toHaveBeenCalled();
    });

    it('genuine TB error still throws', async () => {
      mockTbService.createTransfers.mockResolvedValue([{ status: 'some_other_error' }]);
      await expect(service.postPendingTransfer(params as any)).rejects.toThrow();
    });
  });

  describe('voidPendingTransfer', () => {
    const params = { pendingTransferId: 888n, amount: 3000n };

    it('idempotent replay: pending already voided → no throw, skip evidence rewrite', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { status: CreateTransferStatus.pending_transfer_already_voided },
      ]);
      await expect(service.voidPendingTransfer(params as any)).resolves.toBeUndefined();
      expect(mockEvidenceService.updateTransferType).not.toHaveBeenCalled();
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

  // 现金户解析入口：所有记账调用点取钱包现金户只走这里（戊波一 §2.2）
  describe('resolveCashAccountId', () => {
    it('CUSTOMER wallet → code 1 on the given ledger, ownerType WALLET / ownerUuid = wallet id; tx is forwarded', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'CUSTOMER' });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'ff' });
      const tx: any = { wallet: { findUnique: jest.fn().mockResolvedValue({ ownerType: 'CUSTOMER' }) } };

      const id = await service.resolveCashAccountId('wallet-1', 2, tx);

      expect(id).toBe(255n);
      expect(tx.wallet.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(mockRegistryService.resolve).toHaveBeenCalledWith(
        { code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'wallet-1' },
        tx,
      );
    });

    it('PLATFORM wallet → code 50', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'PLATFORM' });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: '10' });

      const id = await service.resolveCashAccountId('wallet-2', 1);

      expect(id).toBe(16n);
      expect(mockRegistryService.resolve).toHaveBeenCalledWith(
        { code: 50, ledger: 1, ownerType: 'WALLET', ownerUuid: 'wallet-2' },
        undefined,
      );
    });

    it('resolveCashAccountId throws NotFoundException when wallet has no registry row', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'CUSTOMER' });
      mockRegistryService.resolve.mockResolvedValue(null);

      await expect(service.resolveCashAccountId('wallet-not-active', 2)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the wallet row itself does not exist (no registry lookup, no fallback)', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.resolveCashAccountId('ghost', 2)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockRegistryService.resolve).not.toHaveBeenCalled();
    });
  });
});

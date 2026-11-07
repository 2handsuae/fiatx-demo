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

  // 戊波二 T3：公司侧三张单（划转 / 付款 / LP 兑换，T5 起加调拨）共用的钱包余额闸，原来三个主体服务里各自一份同形的运营户余额闸，收成这一份。
  // 借方户口径：可用 = 借已过账 − 贷已过账 − 贷挂起（出款挂起是贷方挂起；借挂起 = 待入账，不可花、不抬高可用）。
  // mock 落在 TB 边界（lookupAccounts / 注册表），resolveCashAccountId 与 lookupBalance 走真代码。
  describe('assertWalletBalance', () => {
    const tbAccount = (debits_posted: bigint, credits_posted: bigint, credits_pending = 0n, debits_pending = 0n) => ({
      debits_posted, credits_posted, debits_pending, credits_pending,
    });
    const arrange = (acct: ReturnType<typeof tbAccount>, walletNo = 'WAL-OPS-AED') => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'PLATFORM', walletNo });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'a' });
      mockTbService.lookupAccounts.mockResolvedValue([acct]);
    };

    it('enough → resolves; reads the wallet cash account (code 50) on the given ledger — never a SYSTEM account', async () => {
      arrange(tbAccount(100_000_000_000n, 571_811_000n));
      await expect(service.assertWalletBalance('w-ops', 2, 7_500_000n)).resolves.toBeUndefined();
      expect(mockRegistryService.resolve).toHaveBeenCalledWith({ code: 50, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-ops' }, undefined);
      expect(mockTbService.lookupAccounts).toHaveBeenCalledWith([10n]);
    });

    it('exactly enough (available == need) → resolves', async () => {
      arrange(tbAccount(2_000n, 0n));
      await expect(service.assertWalletBalance('w-ops', 1, 2_000n)).resolves.toBeUndefined();
    });

    it('not enough → 400 INSUFFICIENT_FIRM_BALANCE; message carries currency, wallet number, available and need', async () => {
      arrange(tbAccount(1_000n, 0n));
      const err: any = await service.assertWalletBalance('w-ops', 1, 2_000n).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toMatchObject({ code: 'INSUFFICIENT_FIRM_BALANCE' });
      expect(err.message).toMatch(/Insufficient AED balance in wallet WAL-OPS-AED.*available 1000.*need 2000/);
      expect(err.message).not.toContain('w-ops');
    });

    it('outflow-locked amount (credits pending) already counts as committed', async () => {
      arrange(tbAccount(3_000n, 0n, 2_000n));
      await expect(service.assertWalletBalance('w-ops', 1, 1_500n)).rejects.toThrow(/Insufficient.*available 1000/);
    });

    it('credits posted reduce what is available', async () => {
      arrange(tbAccount(3_000n, 2_500n));
      await expect(service.assertWalletBalance('w-ops', 1, 600n)).rejects.toThrow(/Insufficient.*available 500/);
    });

    it('debits pending (inflow not yet posted) is not spendable and does not raise available', async () => {
      arrange(tbAccount(1_000n, 0n, 0n, 9_000n));
      await expect(service.assertWalletBalance('w-ops', 1, 2_000n)).rejects.toThrow(/Insufficient.*available 1000/);
    });

    it('a wallet without a cash account (not opened) fails loudly instead of passing', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'PLATFORM', walletNo: 'WAL-OPS-AED' });
      mockRegistryService.resolve.mockResolvedValue(null);
      await expect(service.assertWalletBalance('w-ops', 1, 1n)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // 戊波二 T7a：可用额算式只此一份——assertWalletBalance（公司钱包出款闸）与认损补缺单的客户钱包余量复查共用它。
  describe('getWalletCashAvailable', () => {
    const tbAccount = (debits_posted: bigint, credits_posted: bigint, credits_pending = 0n, debits_pending = 0n) => ({
      debits_posted, credits_posted, debits_pending, credits_pending,
    });

    it('available = debits posted − credits posted − credits pending; debits pending is not spendable', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'CUSTOMER', walletNo: 'WA-CUST' });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'a' });
      mockTbService.lookupAccounts.mockResolvedValue([tbAccount(10_000n, 2_500n, 1_500n, 9_999n)]);
      await expect(service.getWalletCashAvailable('w-cust', 2)).resolves.toBe(6_000n);
    });

    it('a CUSTOMER wallet reads its code-1 client cash account, never the company one', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'CUSTOMER', walletNo: 'WA-CUST' });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'a' });
      mockTbService.lookupAccounts.mockResolvedValue([tbAccount(100n, 0n)]);
      await service.getWalletCashAvailable('w-cust', 2);
      expect(mockRegistryService.resolve).toHaveBeenCalledWith({ code: 1, ledger: 2, ownerType: 'WALLET', ownerUuid: 'w-cust' }, undefined);
    });

    it('the pending withdrawal lock (a pending credit on the client cash account) shrinks it — the exact case that makes code 91 bounce', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ ownerType: 'CUSTOMER', walletNo: 'WA-CUST' });
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'a' });
      mockTbService.lookupAccounts.mockResolvedValue([tbAccount(300_000n, 0n, 250_000n)]);
      await expect(service.getWalletCashAvailable('w-cust', 1)).resolves.toBe(50_000n);
    });
  });
});

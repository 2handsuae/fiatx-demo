// src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
import { TbEvidenceService } from './tb-evidence.service';

describe('TbEvidenceService', () => {
  let service: TbEvidenceService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tbTransferEvidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      tbEvidenceBacklog: {
        create: jest.fn(),
      },
      accountFlow: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      tbAccountRegistry: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      customerMain: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      asset: {
        findFirst: jest.fn(),
      },
    };
    service = new TbEvidenceService(mockPrisma);
  });

  describe('writeEvidence', () => {
    const params = {
      tbTransferId: 'abc123',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP-001',
      eventCode: 'EVT_DEPOSIT_SUCCESS',
      debitCode: 'A.CLIENT_CUSTODY',
      creditCode: 'L.CLIENT_PAYABLE',
      amount: 100.00,
      assetCurrency: 'AED',
      traceId: 'trace-uuid-1',
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      transferType: 'POSTED',
    };

    it('should write evidence to TbTransferEvidence', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence(params);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP-001',
        }),
      });
    });

    it('should persist debitWalletRef/creditWalletRef/externalRef/isExternalCrossing when provided', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await service.writeEvidence({
        ...params,
        debitWalletRef: 'wallet-debit-001',
        creditWalletRef: 'wallet-credit-002',
        externalRef: '0xabcdef123456',
        isExternalCrossing: true,
      } as any);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitWalletRef: 'wallet-debit-001',
          creditWalletRef: 'wallet-credit-002',
          externalRef: '0xabcdef123456',
          isExternalCrossing: true,
        }),
      });
    });

    it('should default the new wallet/external fields to null/false when omitted', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await service.writeEvidence(params);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          debitWalletRef: null,
          creditWalletRef: null,
          externalRef: null,
          isExternalCrossing: false,
        }),
      });
    });

    it('should write to backlog on Prisma failure and rethrow the error', async () => {
      mockPrisma.tbTransferEvidence.create.mockRejectedValue(new Error('DB error'));
      mockPrisma.tbEvidenceBacklog.create.mockResolvedValue({});

      // Service rethrows after writing to backlog
      await expect(service.writeEvidence(params)).rejects.toThrow('DB error');

      expect(mockPrisma.tbEvidenceBacklog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          errorMessage: 'DB error',
          status: 'PENDING',
        }),
      });
    });

    it('Phase B / T3: when projector is wired, writeEvidence calls projector.persist on the same client (tx)', async () => {
      const projector = { persist: jest.fn().mockResolvedValue(undefined) } as any;
      const svc = new TbEvidenceService(mockPrisma, projector);
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await svc.writeEvidence(
        {
          ...params,
          debitTbAccountId: 'tb-debit',
          creditTbAccountId: 'tb-credit',
        } as any,
      );

      expect(projector.persist).toHaveBeenCalledTimes(1);
      // The projector receives the same evidence data that was written
      const [, evidenceArg] = projector.persist.mock.calls[0];
      expect(evidenceArg).toEqual(expect.objectContaining({
        tbTransferId: 'abc123',
        debitTbAccountId: 'tb-debit',
        creditTbAccountId: 'tb-credit',
      }));
    });

    it('Phase B / T3: writeEvidence with no projector (legacy DI) still succeeds', async () => {
      const svc = new TbEvidenceService(mockPrisma); // projector omitted
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await expect(svc.writeEvidence(params)).resolves.toBeUndefined();
      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalled();
    });
  });

  describe('enrichForPost — Phase B / T3 re-projection', () => {
    it('re-reads evidence after update and re-projects via projector', async () => {
      const projector = { persist: jest.fn().mockResolvedValue(undefined) } as any;
      mockPrisma.tbTransferEvidence.update = jest.fn().mockResolvedValue({});
      mockPrisma.tbTransferEvidence.findUnique.mockResolvedValue({
        tbTransferId: 'abc123',
        eventCode: 'EVT_WITHDRAW_SUCCESS',
        externalRef: '0xnew',
        isExternalCrossing: true,
      });
      const svc = new TbEvidenceService(mockPrisma, projector);

      await svc.enrichForPost('abc123', {
        eventCode: 'EVT_WITHDRAW_SUCCESS',
        externalRef: '0xnew',
        isExternalCrossing: true,
      });

      expect(mockPrisma.tbTransferEvidence.update).toHaveBeenCalled();
      expect(mockPrisma.tbTransferEvidence.findUnique).toHaveBeenCalledWith({
        where: { tbTransferId: 'abc123' },
      });
      expect(projector.persist).toHaveBeenCalledTimes(1);
    });

    it('no-op enrichForPost (empty fields) does not call projector', async () => {
      const projector = { persist: jest.fn() } as any;
      mockPrisma.tbTransferEvidence.update = jest.fn();
      const svc = new TbEvidenceService(mockPrisma, projector);

      await svc.enrichForPost('abc123', {});

      expect(mockPrisma.tbTransferEvidence.update).not.toHaveBeenCalled();
      expect(projector.persist).not.toHaveBeenCalled();
    });
  });

  describe('findBySource', () => {
    it('should query by sourceType and sourceNo', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findBySource('DEPOSIT', 'DEP-001');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'DEPOSIT', sourceNo: 'DEP-001' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findByTraceId', () => {
    it('should query by traceId', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findByTraceId('trace-uuid-1');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { traceId: 'trace-uuid-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findAll q + coa', () => {
    it('q → OR[tbTransferId 等值(去0x小写), sourceNo contains, traceId contains]', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      mockPrisma.tbTransferEvidence.count.mockResolvedValue(0);
      await service.findAll({ q: '0xAB12' });
      const where = mockPrisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [{ tbTransferId: 'ab12' }, { sourceNo: { contains: '0xAB12' } }, { traceId: { contains: '0xAB12' } }] },
      ]);
    });

    it('coa → 借/贷任一侧命中,且兼容历史数字串', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      mockPrisma.tbTransferEvidence.count.mockResolvedValue(0);
      await service.findAll({ coa: 'L.CLIENT_PAYABLE' });
      const where = mockPrisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [
          { debitCode: 'L.CLIENT_PAYABLE' }, { creditCode: 'L.CLIENT_PAYABLE' },
          { debitCode: '100' }, { creditCode: '100' },
        ] },
      ]);
    });
  });

  describe('getAccountStatement crossingOnly toggle (T4)', () => {
    it('crossingOnly=true adds isExternalCrossing filter to the where clause', async () => {
      mockPrisma.tbAccountRegistry.findUnique.mockResolvedValue({ code: 100 });
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      await service.getAccountStatement('acct-1', { crossingOnly: true });
      const where = mockPrisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.isExternalCrossing).toBe(true);
    });

    it('crossingOnly=false (default) does NOT add the filter', async () => {
      mockPrisma.tbAccountRegistry.findUnique.mockResolvedValue({ code: 100 });
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      await service.getAccountStatement('acct-1');
      const where = mockPrisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.isExternalCrossing).toBeUndefined();
    });

    it('items include isExternalCrossing + externalRef passthrough fields', async () => {
      mockPrisma.tbAccountRegistry.findUnique.mockResolvedValue({ code: 100 });
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([
        {
          tbTransferId: 'tx1',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          eventCode: 'EVT_X',
          creditTbAccountId: 'acct-1',
          debitTbAccountId: 'other',
          amount: 100,
          assetCode: 'AED',
          memo: null,
          isExternalCrossing: true,
          externalRef: '0xabc',
          createdAt: '2026-06-26T00:00:00Z',
        },
      ]);
      const out = await service.getAccountStatement('acct-1');
      expect(out.items[0].isExternalCrossing).toBe(true);
      expect(out.items[0].externalRef).toBe('0xabc');
    });
  });

  describe('getWalletStatement (T4)', () => {
    const wallet = {
      id: 'w-1',
      ownerType: 'CUSTOMER',
      ownerNo: 'CU001',
      asset: { currency: 'USDT-TRON' },
    };
    const payableReg = {
      tbAccountId: '00000000000000000000000000aacc11', // 32-char registry id
      code: 100,
      ownerType: 'CUSTOMER',
      ownerNo: 'CU001',
      ownerName: 'Alice',
      assetCode: 'USDT-TRON',
    };
    const suspenseReg = {
      tbAccountId: '00000000000000000000000000bbdd22',
      code: 101,
      ownerType: 'CUSTOMER',
      ownerNo: 'CU001',
      ownerName: 'Alice',
      assetCode: 'USDT-TRON',
    };
    const clientAssetReg = {
      tbAccountId: '00000000000000000000000000cceeff', // SYSTEM aggregate — should be DROPPED for a customer wallet
      code: 1,
      ownerType: 'SYSTEM',
      ownerNo: null,
      ownerName: null,
      assetCode: 'USDT-TRON',
    };

    beforeEach(() => {
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        payableReg,
        suspenseReg,
        clientAssetReg,
      ]);
      mockPrisma.customerMain.findFirst.mockResolvedValue({
        firstName: 'Alice',
        lastName: null,
      });
      mockPrisma.asset.findFirst.mockResolvedValue({ decimals: 6 });
    });

    it('combines SUSPENSE+PAYABLE flows for a customer wallet, drops aggregate-account legs, computes running balance', async () => {
      mockPrisma.accountFlow.findMany.mockResolvedValue([
        // Deposit step 1: DR FIRM_ASSET (SYSTEM, dropped), CR DEPOSIT_SUSPENSE (kept)
        {
          tbTransferId: 'tx1',
          tbAccountId: clientAssetReg.tbAccountId,
          walletRef: 'w-1',
          direction: 'OUT',
          amount: 100,
          isExternalCrossing: true,
          externalRef: '0xdep',
          eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          transferType: 'POSTED',
          assetCode: 'USDT-TRON',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          tbTransferId: 'tx1',
          tbAccountId: suspenseReg.tbAccountId,
          walletRef: 'w-1',
          direction: 'IN',
          amount: 100,
          isExternalCrossing: true,
          externalRef: '0xdep',
          eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          transferType: 'POSTED',
          assetCode: 'USDT-TRON',
          createdAt: new Date('2026-01-01T00:00:01Z'),
        },
        // Reclass: DR SUSPENSE, CR PAYABLE (both kept, both L-class)
        {
          tbTransferId: 'tx2',
          tbAccountId: suspenseReg.tbAccountId,
          walletRef: 'w-1',
          direction: 'OUT',
          amount: 100,
          isExternalCrossing: false,
          externalRef: null,
          eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          transferType: 'POSTED',
          assetCode: 'USDT-TRON',
          createdAt: new Date('2026-01-01T00:01:00Z'),
        },
        {
          tbTransferId: 'tx2',
          tbAccountId: payableReg.tbAccountId,
          walletRef: 'w-1',
          direction: 'IN',
          amount: 100,
          isExternalCrossing: false,
          externalRef: null,
          eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          transferType: 'POSTED',
          assetCode: 'USDT-TRON',
          createdAt: new Date('2026-01-01T00:01:01Z'),
        },
      ]);

      const result = await service.getWalletStatement('w-1');

      // FIRM_ASSET (SYSTEM) leg dropped → 3 rows remain.
      expect(result.items).toHaveLength(3);
      expect(result.items.map((i: any) => i.tbAccountId)).toEqual([
        suspenseReg.tbAccountId,
        suspenseReg.tbAccountId,
        payableReg.tbAccountId,
      ]);

      // Running balance on customer wallet:
      //   +100 (suspense IN) → 100
      //   −100 (suspense OUT) → 0
      //   +100 (payable IN) → 100
      expect(result.items[0].runningBalance).toBe(100);
      expect(result.items[1].runningBalance).toBe(0);
      expect(result.items[2].runningBalance).toBe(100);
      expect(result.currentBalance).toBe(100);

      // Owner header from wallet.
      expect(result.account.ownerNo).toBe('CU001');
      expect(result.account.ownerType).toBe('CUSTOMER');
      expect(result.account.assetCode).toBe('USDT-TRON');
      expect(result.assetCurrency).toBe('USDT-TRON');
      expect(result.crossingOnly).toBe(false);
    });

    it('crossingOnly=true filters out the SUSPENSE→PAYABLE reclass (isExternalCrossing=false)', async () => {
      mockPrisma.accountFlow.findMany.mockResolvedValue([]);
      await service.getWalletStatement('w-1', { crossingOnly: true });
      const where = mockPrisma.accountFlow.findMany.mock.calls[0][0].where;
      expect(where.isExternalCrossing).toBe(true);
      expect(where.walletRef).toBe('w-1');
      expect(where.transferType).toBe('POSTED');
    });

    it('asset-class row direction is flipped relative to the projector direction', async () => {
      // Construct a wallet whose owner is a SYSTEM aggregate so the asset leg
      // is kept. The projector's "OUT" (debit side) on an asset account =
      // balance UP under DEBIT-normal sign → user-facing direction "IN".
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'firm-wallet',
        ownerType: 'SYSTEM',
        ownerNo: null,
        asset: { currency: 'USDT-TRON' },
      });
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([clientAssetReg]);
      mockPrisma.accountFlow.findMany.mockResolvedValue([
        {
          tbTransferId: 'tx1',
          tbAccountId: clientAssetReg.tbAccountId,
          walletRef: 'firm-wallet',
          direction: 'OUT', // projector: debit side
          amount: 50,
          isExternalCrossing: true,
          externalRef: null,
          eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP1',
          transferType: 'POSTED',
          assetCode: 'USDT-TRON',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getWalletStatement('firm-wallet');
      expect(result.items).toHaveLength(1);
      // ASSET account: projector 'OUT' (debit) → user-facing 'IN' (balance up).
      expect(result.items[0].direction).toBe('IN');
      expect(result.items[0].runningBalance).toBe(50);
    });
  });

  describe('listWallets (T4)', () => {
    it('returns distinct walletRefs with owner info and asset codes', async () => {
      mockPrisma.accountFlow.groupBy
        .mockResolvedValueOnce([
          { walletRef: 'w-1', _count: { _all: 4 } },
          { walletRef: 'w-2', _count: { _all: 2 } },
        ])
        .mockResolvedValueOnce([
          { walletRef: 'w-1', assetCode: 'USDT-TRON' },
          { walletRef: 'w-2', assetCode: 'AED' },
        ]);
      mockPrisma.wallet.findMany.mockResolvedValue([
        {
          id: 'w-1',
          ownerType: 'CUSTOMER',
          ownerNo: 'CU001',
          walletRole: 'GENERAL',
          asset: { currency: 'USDT-TRON' },
        },
        {
          id: 'w-2',
          ownerType: 'SYSTEM',
          ownerNo: null,
          walletRole: 'FIRM_OPS',
          asset: { currency: 'AED' },
        },
      ]);
      mockPrisma.customerMain.findMany.mockResolvedValue([
        { customerNo: 'CU001', firstName: 'Alice', lastName: null },
      ]);

      const result = await service.listWallets();
      // CUSTOMER sorts before SYSTEM.
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        walletRef: 'w-1',
        ownerType: 'CUSTOMER',
        ownerNo: 'CU001',
        ownerName: 'Alice',
        assetCodes: ['USDT-TRON'],
        flowCount: 4,
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        walletRef: 'w-2',
        ownerType: 'SYSTEM',
        walletRole: 'FIRM_OPS',
      }));
    });
  });
});

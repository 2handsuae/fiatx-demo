// src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
import { TbEvidenceService } from './tb-evidence.service';
import { toBusinessDate } from './utils/business-date.util';

// 戊波一：「跨外部」标记已退役——用键名模式断言各处不再带它（不在源码里留退役字段的字面名）。
const retiredFlagKeys = (o: object) => Object.keys(o).filter((k) => /crossing/i.test(k));

describe('TbEvidenceService', () => {
  let service: TbEvidenceService;
  let mockPrisma: any;
  let mockTbService: any;

  beforeEach(() => {
    // T3: postedBalanceAfter calls tbService.lookupAccounts; return [] so it
    // resolves to null (TB balance unavailable in unit tests — not asserted).
    mockTbService = { lookupAccounts: jest.fn().mockResolvedValue([]) };
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
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
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
    service = new TbEvidenceService(mockPrisma, mockTbService);
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

    it('persists externalRef when provided, and writes no retired-flag field (the projector derives walletRef from the registry)', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await service.writeEvidence({
        ...params,
        externalRef: '0xabcdef123456',
      } as any);

      const data = mockPrisma.tbTransferEvidence.create.mock.calls[0][0].data;
      expect(data.externalRef).toBe('0xabcdef123456');
      expect(retiredFlagKeys(data)).toEqual([]);
    });

    it('should default externalRef to null when omitted', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await service.writeEvidence(params);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          externalRef: null,
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
      const svc = new TbEvidenceService(mockPrisma, mockTbService, projector);
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

    it('T3: threads class-aware balanceAfter into projector — asset=debits−credits, L/E=credits−debits', async () => {
      const projector = { persist: jest.fn().mockResolvedValue(undefined) } as any;
      // Both legs resolve to the same TB account balance {debits 1500, credits 600}.
      mockTbService.lookupAccounts.mockResolvedValue([{ debits_posted: 1500n, credits_posted: 600n }]);
      const svc = new TbEvidenceService(mockPrisma, mockTbService, projector);
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await svc.writeEvidence({
        ...params,
        debitCode: 'A.CLIENT_CASH', // 借方户(现金) → 1500 − 600 = 900
        creditCode: 'L.CLIENT_PAYABLE', // 贷方户(负债) → 600 − 1500 = -900
        // valid hex ids (hexToBigint would throw on non-hex → swallowed to null)
        debitTbAccountId: '0a1',
        creditTbAccountId: '0b2',
      } as any);

      const [, evidenceArg] = projector.persist.mock.calls[0];
      expect(evidenceArg.debitBalanceAfter).toBe('900');
      expect(evidenceArg.creditBalanceAfter).toBe('-900');
    });

    it('X. expense accounts are debit-normal: balanceAfter = debits − credits (T1 carry — the X. prefix fix)', async () => {
      const projector = { persist: jest.fn().mockResolvedValue(undefined) } as any;
      mockTbService.lookupAccounts.mockResolvedValue([{ debits_posted: 1500n, credits_posted: 600n }]);
      const svc = new TbEvidenceService(mockPrisma, mockTbService, projector);
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await svc.writeEvidence({
        ...params,
        debitCode: 'L.CLIENT_PAYABLE', // 贷方户 → 600 − 1500 = -900
        creditCode: 'X.EXPENSE_RECON_LOSS', // 借方户(开支) → 1500 − 600 = 900，不是 -900
        debitTbAccountId: '0a1',
        creditTbAccountId: '0b2',
      } as any);

      const [, evidenceArg] = projector.persist.mock.calls[0];
      expect(evidenceArg.debitBalanceAfter).toBe('-900');
      expect(evidenceArg.creditBalanceAfter).toBe('900');
    });

    it('Phase B / T3: writeEvidence with no projector (legacy DI) still succeeds', async () => {
      const svc = new TbEvidenceService(mockPrisma, mockTbService); // projector omitted
      mockPrisma.tbTransferEvidence.create.mockResolvedValue({});

      await expect(svc.writeEvidence(params)).resolves.toBeUndefined();
      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalled();
    });

    it('stamps effectiveDate = Dubai business date of the same instant as createdAt (act6 wave5 COB)', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence(params);

      const data = mockPrisma.tbTransferEvidence.create.mock.calls[0][0].data;
      // 波五业务日=迪拜午夜切：UTC 20:00-24:00 窗口内迪拜日期=UTC+1 天，
      // 旧断言（UTC 日期）在该四小时窗口每日必红——按服务同一换算函数断言。
      expect(data.effectiveDate).toBe(toBusinessDate(data.createdAt));
    });

    it('honors an explicit effectiveDate (back-value funnel) while createdAt stays now', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence({ ...params, effectiveDate: '2026-06-30' } as any);

      const data = mockPrisma.tbTransferEvidence.create.mock.calls[0][0].data;
      expect(data.effectiveDate).toBe('2026-06-30');
      expect(data.createdAt.toISOString().slice(0, 10)).not.toBe('2026-06-30');
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
      });
      const svc = new TbEvidenceService(mockPrisma, mockTbService, projector);

      await svc.enrichForPost('abc123', {
        eventCode: 'EVT_WITHDRAW_SUCCESS',
        externalRef: '0xnew',
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
      const svc = new TbEvidenceService(mockPrisma, mockTbService, projector);

      await svc.enrichForPost('abc123', {});

      expect(mockPrisma.tbTransferEvidence.update).not.toHaveBeenCalled();
      expect(projector.persist).not.toHaveBeenCalled();
    });

    it('enrichForPost with effectiveDate back-values the promoted evidence row', async () => {
      mockPrisma.tbTransferEvidence.update = jest.fn().mockResolvedValue({});
      mockPrisma.tbTransferEvidence.findUnique.mockResolvedValue({ tbTransferId: 'tid-1', effectiveDate: '2026-06-30' });

      await service.enrichForPost('tid-1', { eventCode: 'X', effectiveDate: '2026-06-30' } as any);

      const patch = mockPrisma.tbTransferEvidence.update.mock.calls[0][0].data;
      expect(patch.effectiveDate).toBe('2026-06-30');
    });

    it('enrichForPost without effectiveDate never touches the date (existing behavior)', async () => {
      mockPrisma.tbTransferEvidence.update = jest.fn().mockResolvedValue({});
      mockPrisma.tbTransferEvidence.findUnique.mockResolvedValue({ tbTransferId: 'tid-1' });

      await service.enrichForPost('tid-1', { eventCode: 'X' });

      const patch = mockPrisma.tbTransferEvidence.update.mock.calls[0][0].data;
      expect('effectiveDate' in patch).toBe(false);
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

  describe('getAccountStatement (T4)', () => {
    it('queries POSTED evidence on either side of the account, with no retired-flag filter', async () => {
      mockPrisma.tbAccountRegistry.findUnique.mockResolvedValue({ code: 100 });
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);
      await service.getAccountStatement('acct-1');
      const where = mockPrisma.tbTransferEvidence.findMany.mock.calls[0][0].where;
      expect(where.transferType).toBe('POSTED');
      expect(retiredFlagKeys(where)).toEqual([]);
    });

    it('items carry the externalRef passthrough and no retired-flag field', async () => {
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
          externalRef: '0xabc',
          createdAt: '2026-06-26T00:00:00Z',
        },
      ]);
      const out = await service.getAccountStatement('acct-1');
      expect(out.items[0].externalRef).toBe('0xabc');
      expect(retiredFlagKeys(out.items[0])).toEqual([]);
    });

    it('direction follows the account class: a debit on a debit-normal cash account is IN, a credit is OUT', async () => {
      mockPrisma.tbAccountRegistry.findUnique.mockResolvedValue({ code: 1 });
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([
        { tbTransferId: 'tx1', sourceType: 'DEPOSIT', sourceNo: 'D1', eventCode: 'E', debitTbAccountId: 'acct-1', creditTbAccountId: 'other', amount: 100, assetCode: 'AED', memo: null, externalRef: null, createdAt: '2026-06-26T00:00:00Z' },
        { tbTransferId: 'tx2', sourceType: 'WITHDRAWAL', sourceNo: 'W1', eventCode: 'E', debitTbAccountId: 'other', creditTbAccountId: 'acct-1', amount: 30, assetCode: 'AED', memo: null, externalRef: null, createdAt: '2026-06-26T00:01:00Z' },
      ]);
      const out = await service.getAccountStatement('acct-1');
      expect(out.items.map((i) => i.direction)).toEqual(['IN', 'OUT']);
      expect(out.currentBalance).toBe(70);
    });
  });

  describe('getWalletStatement (T4)', () => {
    // 戊波一：walletRef 只出现在 WALLET 归属的现金户流水上（一钱包一户），
    // 流水方向在入库时已是「钱进这个户 = IN」，读面不再翻转。
    const wallet = {
      id: 'w-1',
      ownerType: 'CUSTOMER',
      ownerNo: 'CU001',
      asset: { currency: 'USDT-TRON' },
    };
    const cashReg = {
      tbAccountId: '00000000000000000000000000aacc11', // 32-char registry id
      code: 1,
      ownerType: 'WALLET',
      ownerNo: 'WA001',
      ownerName: null,
      assetCode: 'USDT-TRON',
    };

    const flow = (over: Record<string, unknown>) => ({
      tbTransferId: 'tx1',
      tbAccountId: cashReg.tbAccountId,
      walletRef: 'w-1',
      direction: 'IN',
      amount: 100,
      externalRef: null,
      eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP1',
      transferType: 'POSTED',
      assetCode: 'USDT-TRON',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...over,
    });

    beforeEach(() => {
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([cashReg]);
      mockPrisma.customerMain.findFirst.mockResolvedValue({
        firstName: 'Alice',
        lastName: null,
      });
      mockPrisma.asset.findFirst.mockResolvedValue({ decimals: 6 });
    });

    it('reads the wallet cash-account flows and runs the balance from the stored direction (IN +, OUT −), no flip', async () => {
      mockPrisma.accountFlow.findMany.mockResolvedValue([
        flow({ tbTransferId: 'tx1', direction: 'IN', amount: 100, createdAt: new Date('2026-01-01T00:00:00Z') }),
        flow({ tbTransferId: 'tx2', direction: 'OUT', amount: 30, eventCode: 'WITHDRAW_NET_LOCK', sourceType: 'WITHDRAWAL', sourceNo: 'WD1', createdAt: new Date('2026-01-01T00:01:00Z') }),
      ]);

      const result = await service.getWalletStatement('w-1');

      expect(result.items.map((i: any) => i.direction)).toEqual(['IN', 'OUT']);
      expect(result.items.map((i: any) => i.runningBalance)).toEqual([100, 70]);
      expect(result.currentBalance).toBe(70);
      expect(result.items[0].accountCode).toBe(1);

      // Owner header from wallet.
      expect(result.account.ownerNo).toBe('CU001');
      expect(result.account.ownerType).toBe('CUSTOMER');
      expect(result.account.assetCode).toBe('USDT-TRON');
      expect(result.assetCurrency).toBe('USDT-TRON');
      expect(retiredFlagKeys(result)).toEqual([]);
    });

    it('queries POSTED flows of the walletRef only, with no retired-flag filter', async () => {
      mockPrisma.accountFlow.findMany.mockResolvedValue([]);
      await service.getWalletStatement('w-1');
      const where = mockPrisma.accountFlow.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ walletRef: 'w-1', transferType: 'POSTED' });
    });

    it('items carry externalRef and no retired-flag field', async () => {
      mockPrisma.accountFlow.findMany.mockResolvedValue([flow({ externalRef: '0xdep' })]);
      const result = await service.getWalletStatement('w-1');
      expect(result.items[0].externalRef).toBe('0xdep');
      expect(retiredFlagKeys(result.items[0])).toEqual([]);
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
          walletRole: 'FIRM_EQUITY',
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
        walletRole: 'FIRM_EQUITY',
      }));
    });
  });

  describe('findAllFlows (Task 5)', () => {
    it('findAllFlows filters by tbAccountId and returns items+total+singleAccount', async () => {
      const res = await service.findAllFlows({ tbAccountId: 'a1', take: 10, skip: 0 });
      expect(res).toHaveProperty('items');
      expect(res).toHaveProperty('total');
      expect(res.singleAccount).toBe(true);
    });
  });
});

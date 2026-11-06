// src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts
//
// 戊波一 T10：投影 = 一条凭证展开成两行流水，方向按账户类别（含义统一为「钱进这个户 = IN」），
// 钱包标签（walletRef）由注册表派生——该行账户若是 WALLET 归属则填钱包 id，否则 null。
// 借方户（现金 / 开支）借 = IN、贷 = OUT；贷方户（应付 / 权益 / 收入）贷 = IN、借 = OUT。

import { AccountFlowProjectorService } from './account-flow-projector.service';

// 戊波一：「跨外部」标记已退役——用键名模式断言行里不再带它。
const retiredFlagKeys = (o: object) => Object.keys(o).filter((k) => /crossing/i.test(k));

describe('AccountFlowProjectorService', () => {
  let service: AccountFlowProjectorService;

  beforeEach(() => {
    service = new AccountFlowProjectorService();
  });

  // 凭证形态：充值第一步——借 客户现金 / 贷 充值暂挂（两侧各自的类别不同）
  const baseEvidence = {
    tbTransferId: 'abc123',
    sourceType: 'DEPOSIT',
    sourceNo: 'DEP-001',
    eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
    debitCode: 'A.CLIENT_CASH',
    creditCode: 'L.DEPOSIT_SUSPENSE',
    debitTbAccountId: 'tb-debit-001',
    creditTbAccountId: 'tb-credit-002',
    amount: 100,
    assetCode: 'USD',
    traceId: 'trace-1',
    actorType: 'SYSTEM',
    actorId: 'SYSTEM',
    memo: null,
    pendingId: null,
    transferType: 'POSTED',
    externalRef: '0xdeadbeef',
    createdAt: new Date('2026-06-26T12:00:00Z'),
    effectiveDate: '2026-06-26',
  };

  const rowOn = (rows: ReturnType<AccountFlowProjectorService['projectEvidence']>, tbAccountId: string) =>
    rows.find((r) => r.tbAccountId === tbAccountId)!;

  describe('projectEvidence (pure) — 方向按账户类别', () => {
    it('debit on A.CLIENT_CASH projects direction IN', () => {
      const rows = service.projectEvidence(baseEvidence as any);
      expect(rowOn(rows, 'tb-debit-001').direction).toBe('IN');
    });

    it('credit on A.CLIENT_CASH projects direction OUT', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'L.CLIENT_PAYABLE',
        creditCode: 'A.CLIENT_CASH',
      } as any);
      expect(rowOn(rows, 'tb-credit-002').direction).toBe('OUT');
    });

    it('debit on L.CLIENT_PAYABLE projects direction OUT', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'L.CLIENT_PAYABLE',
        creditCode: 'A.CLIENT_CASH',
      } as any);
      expect(rowOn(rows, 'tb-debit-001').direction).toBe('OUT');
    });

    it('credit on credit-normal accounts (L / E) keeps today\'s rule: credit = IN', () => {
      const liability = service.projectEvidence(baseEvidence as any); // credit on L.DEPOSIT_SUSPENSE
      expect(rowOn(liability, 'tb-credit-002').direction).toBe('IN');

      const equity = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'A.FIRM_CASH',
        creditCode: 'E.FIRM_EQUITY',
      } as any);
      expect(rowOn(equity, 'tb-credit-002').direction).toBe('IN');
    });

    it('a pure cash-to-cash move (A.FIRM_CASH ← A.FIRM_CASH): debit side IN, credit side OUT', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'A.FIRM_CASH',
        creditCode: 'A.FIRM_CASH',
      } as any);
      expect(rowOn(rows, 'tb-debit-001').direction).toBe('IN');
      expect(rowOn(rows, 'tb-credit-002').direction).toBe('OUT');
    });

    it('expense accounts (X.*) are debit-normal: a debit on X.EXPENSE_BANK_CUSTODY projects IN', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'X.EXPENSE_BANK_CUSTODY',
        creditCode: 'A.FIRM_CASH',
      } as any);
      expect(rowOn(rows, 'tb-debit-001').direction).toBe('IN');
      expect(rowOn(rows, 'tb-credit-002').direction).toBe('OUT');
    });

    it('income accounts (E.INCOME_*) are credit-normal: a credit projects IN', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitCode: 'L.CLIENT_PAYABLE',
        creditCode: 'E.INCOME_WITHDRAW_FEE',
      } as any);
      expect(rowOn(rows, 'tb-debit-001').direction).toBe('OUT');
      expect(rowOn(rows, 'tb-credit-002').direction).toBe('IN');
    });
  });

  describe('projectEvidence (pure) — 其余形态', () => {
    it('both rows share transfer-level fields and carry no retired flag', () => {
      const rows = service.projectEvidence(baseEvidence as any);

      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.tbTransferId).toBe('abc123');
        expect(r.externalRef).toBe('0xdeadbeef');
        expect(r.eventCode).toBe('DEPOSIT_ASSET_TO_SUSPENSE');
        expect(r.sourceType).toBe('DEPOSIT');
        expect(r.sourceNo).toBe('DEP-001');
        expect(r.transferType).toBe('POSTED');
        expect(r.assetCode).toBe('USD');
        expect(r.createdAt).toEqual(new Date('2026-06-26T12:00:00Z'));
        expect(Number(r.amount)).toBe(100);
        expect(r.effectiveDate).toBe('2026-06-26');
        expect(retiredFlagKeys(r)).toEqual([]);
      }
    });

    it('externalRef falls back to null and walletRef is null when no wallet map is given', () => {
      const rows = service.projectEvidence({ ...baseEvidence, externalRef: null } as any);
      for (const r of rows) {
        expect(r.externalRef).toBeNull();
        expect(r.walletRef).toBeNull();
      }
    });

    it('walletRef comes from the supplied account→wallet map, null for unmapped accounts', () => {
      const rows = service.projectEvidence(
        baseEvidence as any,
        new Map([['tb-debit-001', 'wallet-w1']]),
      );
      expect(rowOn(rows, 'tb-debit-001').walletRef).toBe('wallet-w1');
      expect(rowOn(rows, 'tb-credit-002').walletRef).toBeNull();
    });

    it('skips rows whose account id is missing (legacy evidence with no debit/credit TB id)', () => {
      const rows = service.projectEvidence({
        ...baseEvidence,
        debitTbAccountId: null,
      } as any);
      expect(rows).toHaveLength(1);
      expect(rows[0].direction).toBe('IN'); // credit on L.DEPOSIT_SUSPENSE
      expect(rows[0].tbAccountId).toBe('tb-credit-002');
    });
  });

  describe('persist (upsert)', () => {
    let mockClient: any;

    // 注册表：借方 = 某钱包的现金户（WALLET 归属），贷方 = 客户的充值暂挂户（CUSTOMER 归属）
    const walletCashReg = { tbAccountId: 'tb-debit-001', code: 1, ownerType: 'WALLET', ownerUuid: 'wallet-w1', ownerNo: 'WA-001' };
    const suspenseReg = { tbAccountId: 'tb-credit-002', code: 101, ownerType: 'CUSTOMER', ownerUuid: 'cust-uuid-1', ownerNo: 'C0001' };

    beforeEach(() => {
      mockClient = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        tbAccountRegistry: { findMany: jest.fn().mockResolvedValue([walletCashReg, suspenseReg]) },
      };
    });

    const upsertCalls = (client: any) => client.accountFlow.upsert.mock.calls.map((c: any[]) => c[0]);
    const createOn = (client: any, tbAccountId: string) =>
      upsertCalls(client).find((c: any) => c.create.tbAccountId === tbAccountId).create;

    it('upserts 2 rows keyed by (tbTransferId, tbAccountId)', async () => {
      await service.persist(mockClient, baseEvidence as any);

      expect(mockClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      const wheres = upsertCalls(mockClient).map((c: any) => c.where.tbTransferId_tbAccountId);
      expect(wheres).toEqual(
        expect.arrayContaining([
          { tbTransferId: 'abc123', tbAccountId: 'tb-debit-001' },
          { tbTransferId: 'abc123', tbAccountId: 'tb-credit-002' },
        ]),
      );
    });

    it('walletRef derived from WALLET-owned registry row, null otherwise', async () => {
      await service.persist(mockClient, baseEvidence as any);

      // 一次批量查注册表（两侧账户 id），不逐行查
      expect(mockClient.tbAccountRegistry.findMany).toHaveBeenCalledTimes(1);
      const where = mockClient.tbAccountRegistry.findMany.mock.calls[0][0].where;
      expect(where.tbAccountId.in.sort()).toEqual(['tb-credit-002', 'tb-debit-001']);

      expect(createOn(mockClient, 'tb-debit-001').walletRef).toBe('wallet-w1'); // WALLET 归属 → ownerUuid
      expect(createOn(mockClient, 'tb-credit-002').walletRef).toBeNull(); // CUSTOMER 归属 → null
    });

    it('walletRef is null for SYSTEM-owned accounts and for accounts missing from the registry', async () => {
      mockClient.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'tb-debit-001', code: 200, ownerType: 'SYSTEM', ownerUuid: 'SYSTEM', ownerNo: null },
      ]);
      await service.persist(mockClient, baseEvidence as any);

      expect(createOn(mockClient, 'tb-debit-001').walletRef).toBeNull();
      expect(createOn(mockClient, 'tb-credit-002').walletRef).toBeNull();
    });

    it('the persisted rows carry class-aware direction and no retired flag', async () => {
      await service.persist(mockClient, baseEvidence as any);

      const debitRow = createOn(mockClient, 'tb-debit-001'); // debit on A.CLIENT_CASH
      const creditRow = createOn(mockClient, 'tb-credit-002'); // credit on L.DEPOSIT_SUSPENSE
      expect(debitRow.direction).toBe('IN');
      expect(creditRow.direction).toBe('IN');
      expect(retiredFlagKeys(debitRow)).toEqual([]);
      for (const call of upsertCalls(mockClient)) {
        expect(retiredFlagKeys(call.update)).toEqual([]);
      }
    });

    it('re-projection (second call with mutated evidence fields) updates the existing rows', async () => {
      await service.persist(mockClient, baseEvidence as any);

      // enrichForPost：eventCode / externalRef 变化
      const enriched = {
        ...baseEvidence,
        eventCode: 'WITHDRAW_NET_POST',
        externalRef: '0xnewhash',
      };
      mockClient.accountFlow.upsert.mockClear();
      await service.persist(mockClient, enriched as any);

      expect(mockClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      for (const args of upsertCalls(mockClient)) {
        expect(args.update.eventCode).toBe('WITHDRAW_NET_POST');
        expect(args.update.externalRef).toBe('0xnewhash');
      }
      // walletRef 在重投影时一并重算
      const walletRow = upsertCalls(mockClient).find((c: any) => c.create.tbAccountId === 'tb-debit-001');
      expect(walletRow.update.walletRef).toBe('wallet-w1');
    });

    it('passes through tx client (caller controls atomicity with writeEvidence)', async () => {
      const txClient = {
        accountFlow: { upsert: jest.fn().mockResolvedValue({}) },
        tbAccountRegistry: { findMany: jest.fn().mockResolvedValue([walletCashReg, suspenseReg]) },
      };
      await service.persist(txClient as any, baseEvidence as any);
      expect(txClient.accountFlow.upsert).toHaveBeenCalledTimes(2);
      expect(mockClient.accountFlow.upsert).not.toHaveBeenCalled();
    });
  });
});

describe('AccountFlowProjectorService balanceAfter', () => {
  const svc = new AccountFlowProjectorService();
  it('maps debit/credit balanceAfter onto the correct rows', () => {
    const rows = svc.projectEvidence({
      tbTransferId: 't1', sourceType: 'DEPOSIT', sourceNo: 'D1', eventCode: 'E',
      debitCode: 'A.CLIENT_CASH', creditCode: 'L.DEPOSIT_SUSPENSE',
      debitTbAccountId: 'a_debit', creditTbAccountId: 'a_credit',
      amount: '100', assetCode: 'AED', transferType: 'POSTED',
      createdAt: new Date('2026-07-07T00:00:00Z'), effectiveDate: '2026-07-07',
      debitBalanceAfter: '900', creditBalanceAfter: '1100',
    } as any);
    const debit = rows.find((r) => r.tbAccountId === 'a_debit');
    const credit = rows.find((r) => r.tbAccountId === 'a_credit');
    expect(debit?.balanceAfter).toBe('900');
    expect(credit?.balanceAfter).toBe('1100');
  });
});

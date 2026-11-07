// src/modules/asset-treasury/treasury/customer-statement.service.spec.ts
import { CustomerStatementService, StatementLeg } from './customer-statement.service';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';

describe('CustomerStatementService', () => {
  let service: CustomerStatementService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      swapTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CustomerStatementService(mockPrisma);
  });

  function leg(overrides: Partial<StatementLeg>): StatementLeg {
    return {
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP-0001',
      eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
      direction: 'IN',
      amount: 100000,
      runningBalance: 100000,
      createdAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  // ① same sourceNo, multiple legs merge into one row: net = signed sum,
  // feeAmount = sum of legs whose eventCode contains FEE, balanceAfter =
  // last leg's runningBalance.
  describe('① multi-leg merge (withdrawal net + fee)', () => {
    it('merges WITHDRAW_NET_POST + WITHDRAW_FEE_POST into one row', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'WITHDRAWAL', sourceNo: 'WD-0001', eventCode: 'WITHDRAW_NET_POST',
          direction: 'OUT', amount: 100000, runningBalance: 900000, createdAt: '2026-09-01T10:00:00.000Z',
        }),
        leg({
          sourceType: 'WITHDRAWAL', sourceNo: 'WD-0001', eventCode: 'WITHDRAW_FEE_POST',
          direction: 'OUT', amount: 2000, runningBalance: 898000, createdAt: '2026-09-01T10:00:00.500Z',
        }),
      ];

      const { items, total } = await service.buildStatement(legs, { isFiat: true });

      expect(total).toBe(1);
      expect(items).toHaveLength(1);
      const row = items[0];
      expect(row.kind).toBe('WITHDRAWAL');
      expect(row.title).toBe('Withdrawal to bank account');
      expect(row.subtitle).toBe('WD-0001');
      expect(row.amount).toBe('-102000');
      expect(row.feeAmount).toBe('2000');
      expect(row.balanceAfter).toBe('898000');
      expect(row.refs).toEqual([
        { sourceType: 'WITHDRAWAL', sourceNo: 'WD-0001' },
        { sourceType: 'WITHDRAWAL', sourceNo: 'WD-0001' },
      ]);
    });

    it('merges SWAP_BUY_CLIENT + SWAP_FEE_CLIENT into one row on the "to" currency account', async () => {
      mockPrisma.swapTransaction.findMany.mockResolvedValue([
        { swapNo: 'SWP-0001', fromAssetCode: 'AED', toAssetCode: 'USDT' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'SWAP', sourceNo: 'SWP-0001', eventCode: 'SWAP_BUY_CLIENT',
          direction: 'IN', amount: 50000, runningBalance: 150000, createdAt: '2026-09-02T08:00:00.000Z',
        }),
        leg({
          sourceType: 'SWAP', sourceNo: 'SWP-0001', eventCode: 'SWAP_FEE_CLIENT',
          direction: 'OUT', amount: 500, runningBalance: 149500, createdAt: '2026-09-02T08:00:00.100Z',
        }),
      ];

      const { items } = await service.buildStatement(legs, { isFiat: false });

      expect(items).toHaveLength(1);
      const row = items[0];
      expect(row.kind).toBe('SWAP');
      expect(row.title).toBe('Swap AED → USDT');
      expect(row.subtitle).toBe('SWP-0001');
      expect(row.amount).toBe('49500');
      expect(row.feeAmount).toBe('500');
      expect(row.balanceAfter).toBe('149500');
    });

    it('does NOT merge legs with different eventCode families sharing the same sourceNo (single unrelated deposit leg stays alone)', async () => {
      // Reverse-direction sanity check for ①: a lone, unpaired leg must stay
      // a single row with no phantom fee (guards against a merge-everything bug).
      const legs: StatementLeg[] = [
        leg({ eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', direction: 'IN', amount: 75000, runningBalance: 75000 }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items).toHaveLength(1);
      expect(items[0].amount).toBe('75000');
      expect(items[0].feeAmount).toBeNull();
    });
  });

  // ② RECON_ADJUSTMENT row: title is generated from the reason code alone
  // (REASON_SPECS.customerLabel), subtitle uses relatedOrderNo when present
  // (never the ADJ number), null otherwise.
  describe('② adjustment row', () => {
    it('shows "Original order {no}" when relatedOrderNo is present', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0001', reasonCode: 'AMT_MISBOOKED', relatedOrderNo: 'DEP-0777', direction: 'INCREASE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0001', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'IN', amount: 5000, runningBalance: 105000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].kind).toBe('ADJUSTMENT');
      // 单码制（spec §5）：AMT_MISBOOKED 的 customerLabel 是通用词「Balance correction」
      // （task-2-brief.md Step 3），与 title 前缀撞词——Task 12 记录时去重复守卫只护住
      // 了 'Balance adjustment' 一种回落值，没护住单码制新码这种，真实产出确是重复词
      // 「Balance correction · Balance correction」。Task 13 把守卫改成通用的
      // STANDALONE_ADJUSTMENT_TITLES 集合判断（customer-statement.service.ts），这里
      // 断言修好之后的产出：不重复拼接，主标题独立成句。
      expect(items[0].title).toBe('Balance correction');
      expect(items[0].subtitle).toBe('Original order DEP-0777');
      expect(items[0].amount).toBe('5000');
      // Never leaks the internal ADJ number in the subtitle.
      expect(items[0].subtitle).not.toContain('ADJ-0001');
    });

    it('shows null subtitle when relatedOrderNo is absent', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0002', reasonCode: 'DUP_BOOKING', relatedOrderNo: null, direction: 'REDUCE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0002', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 3000, runningBalance: 97000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance correction · Duplicate entry reversal');
      expect(items[0].subtitle).toBeNull();
    });

    it('hides subtitle for the rightful-owner (INCREASE) side of a reattribution, even when relatedOrderNo is present', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0003', reasonCode: 'CUSTOMER_REATTRIBUTION', relatedOrderNo: 'DEP-0555', direction: 'REATTRIBUTE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0003', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'IN', amount: 8000, runningBalance: 8000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance correction · Account correction');
      expect(items[0].subtitle).toBeNull();
    });

    it('shows "Original order {no}" for the misattributed-owner (REDUCE) side of the SAME reattribution', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0003', reasonCode: 'CUSTOMER_REATTRIBUTION', relatedOrderNo: 'DEP-0555', direction: 'REATTRIBUTE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0003', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 8000, runningBalance: 0,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].subtitle).toBe('Original order DEP-0555');
    });

    // The customer-facing title is generated from the reason code alone
    // (REASON_SPECS.customerLabel) — no operator-typed customer reason exists any more
    // (the reasonCustomer column was retired 2026-11-04).
    it('title is generated from the reason code alone (a live reason code → its controlled customerLabel)', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-PHANTOM', reasonCode: 'PHANTOM_BOOKING', relatedOrderNo: null, direction: 'REDUCE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-PHANTOM', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 4000, runningBalance: 96000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance correction · Deposit reversal');
    });

    // 戊波二 T7a：客户池认损不再是调账单——UNEXPLAINED_CLIENT_LOSS 已退出 REASON_SPECS，
    // 留在库里的老调账单（若有）按「查不到客户口径词」回落通用话术，不再有专属客户措辞。
    it('the retired client-pool loss code no longer has its own customer wording (falls back to the generic one)', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-OLD-LOSS', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', relatedOrderNo: null, direction: 'REDUCE' },
      ]);
      const { items } = await service.buildStatement([
        leg({ sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-OLD-LOSS', eventCode: 'RECON_ADJUSTMENT_POSTED', direction: 'OUT', amount: 4000, runningBalance: 96000 }),
      ], { isFiat: true });
      expect(items[0].title).toBe('Balance adjustment');
    });

    it('falls back to "Balance adjustment" when reasonCode is missing or unrecognized', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-UNKNOWN', reasonCode: 'SOME_FUTURE_CODE', relatedOrderNo: null, direction: 'REDUCE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-UNKNOWN', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 1000, runningBalance: 99000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance adjustment');
    });
  });

  // ③ internal transfer credit rows. Wave 2: the shortfall top-up (code 91 recognition + code 83 top-up
  // crediting the custody-shortfall account) never touches the client's CLIENT_PAYABLE account, which is the only
  // thing a statement reads — so it yields zero client statement rows. Only the advance still reaches the payable.
  describe('③ internal transfer credit rows', () => {
    it('CLIENT_ADVANCE → "advance" wording, no subtitle', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'INTERNAL_TRANSFER', sourceNo: 'IT-0002', eventCode: 'INTERNAL_TRANSFER_ADVANCE_IN',
          direction: 'IN', amount: 15000, runningBalance: 135000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Credit from FiatX · advance');
      expect(items[0].subtitle).toBeNull();
    });

    // 真正的过滤器在取数那一层：对账单只取「碰了客户应付户的凭证行」（TbEvidenceService.getAccountStatement 按借 / 贷账户 id 过滤），
    // buildStatement 本身不过滤、见腿就出行。所以这条把两层真代码接起来：一个按 where 真过滤的内存凭证库，里面放
    // 认损补缺单的两笔（91 / 83，按真实 eventCode / 科目形状）+ 82，外加一条垫款 83（同样是划转单、同样 sourceType，但它贷应付）
    // 和一笔充值作对照——证明「零行」来自账户形状，而不是过滤器把划转单 / 全部都吞了。
    it('a shortfall top-up produces no client statement row: 91 / 83 / 82 sit off the payable account and never reach the statement, while an advance 83 and a deposit (controls) do', async () => {
      const id = (n: number) => n.toString(16).padStart(32, '0');
      const PAYABLE = id(100), SUSPENSE = id(101), CASH = id(1), SHORTFALL = id(2), FIRM_CASH = id(50), RECON_LOSS = id(301);
      const row = (o: Record<string, unknown>) => ({
        transferType: 'POSTED', assetCode: 'USDT', memo: null, externalRef: null, amount: '7500000', effectiveDate: '2026-11-05', ...o,
      });
      const evidence = [
        // 对照①：充值进应付（贷应付）
        row({ tbTransferId: 't1', sourceType: 'DEPOSIT', sourceNo: 'DEP-A', eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', debitTbAccountId: SUSPENSE, creditTbAccountId: PAYABLE, amount: '100000000', createdAt: new Date('2026-11-01T00:00:00Z') }),
        // 认损补缺单 ITR-TOPUP：91 记短缺（借 2 / 贷 1）、82 公司放出（借 301 / 贷 公司现金）、83 补钱（借 1 / 贷 2）——都不碰应付
        row({ tbTransferId: 't2', sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR-TOPUP', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', debitTbAccountId: SHORTFALL, creditTbAccountId: CASH, createdAt: new Date('2026-11-02T00:00:00Z') }),
        row({ tbTransferId: 't3', sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR-TOPUP', eventCode: 'INTERNAL_TRANSFER_FIRM_OUT', debitTbAccountId: RECON_LOSS, creditTbAccountId: FIRM_CASH, createdAt: new Date('2026-11-03T00:00:00Z') }),
        row({ tbTransferId: 't4', sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR-TOPUP', eventCode: 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', debitTbAccountId: CASH, creditTbAccountId: SHORTFALL, createdAt: new Date('2026-11-03T00:00:01Z') }),
        // 对照②：垫款单 ITR-ADV 的 83——同为划转单、同 sourceType，但贷应付，所以进对账单
        row({ tbTransferId: 't5', sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR-ADV', eventCode: 'INTERNAL_TRANSFER_ADVANCE_IN', debitTbAccountId: CASH, creditTbAccountId: PAYABLE, amount: '90000', createdAt: new Date('2026-11-04T00:00:00Z') }),
      ];
      const matches = (r: any, where: any): boolean =>
        r.transferType === where.transferType && where.OR.some((c: any) => Object.entries(c).every(([k, v]) => r[k] === v));
      const evidenceService = new TbEvidenceService({
        tbAccountRegistry: { findUnique: jest.fn(async () => ({ code: 100 })) },
        tbTransferEvidence: { findMany: jest.fn(async ({ where }: any) => evidence.filter((r) => matches(r, where))) },
      } as any, {} as any);

      const { items: legs } = await evidenceService.getAccountStatement(PAYABLE);
      // 取数层:只有碰应付户的两行(充值 + 垫款 83),认损补缺的三笔一笔都没进来
      expect(legs.map((l: any) => l.eventCode).sort()).toEqual(['DEPOSIT_SUSPENSE_TO_PAYABLE', 'INTERNAL_TRANSFER_ADVANCE_IN']);
      const { items, total } = await service.buildStatement(legs as StatementLeg[], { isFiat: false });
      expect(total).toBe(2);
      expect(items.map((i) => i.title)).toEqual(['Credit from FiatX · advance', 'Deposit · crypto']); // 新 → 旧
      expect(JSON.stringify(items)).not.toMatch(/ITR-TOPUP|SHORTFALL|balance restoration|COMPENSATION/);

      // 反证过滤器不是全吞:从同一个凭证库查「客户现金户」,认损补缺的 91 / 83 就都在(它们确实记在客户钱包上,只是不在应付上)
      const cashLegs = (await evidenceService.getAccountStatement(CASH)).items.map((l: any) => l.eventCode).sort();
      expect(cashLegs).toEqual(['INTERNAL_TRANSFER_ADVANCE_IN', 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED', 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN']);
    });

    // 兜底：若有人把码 83 的客户侧事件误接到应付户，它不能再回落成旧的「balance restoration」措辞——
    // 白名单里已没有 COMPENSATION / SHORTFALL_TOPUP 的任何登记，落到 default-deny 通用话术，不吐 eventCode。
    it('the retired compensation event code and the top-up event codes are not on the whitelist (default-deny wording, never the raw code)', async () => {
      for (const eventCode of ['INTERNAL_TRANSFER_COMPENSATION_IN', 'INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN', 'INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED']) {
        const { items } = await service.buildStatement([
          leg({ sourceType: 'INTERNAL_TRANSFER', sourceNo: 'IT-0001', eventCode, direction: 'IN', amount: 20000, runningBalance: 120000 }),
        ], { isFiat: true });
        expect(items[0].title).toBe('Balance adjustment');
        expect(items[0].title).not.toMatch(/restoration/);
        expect(JSON.stringify(items[0])).not.toContain(eventCode);
      }
    });
  });

  // ④ CLAWED_BACK row is a SEPARATE row from the original deposit credit,
  // even though both share the same sourceNo — grouping must not merge
  // across event-code families.
  describe('④ deposit clawback stays a separate row from the original credit', () => {
    it('produces two rows for the same DEP number: credit then clawback', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'DEPOSIT', sourceNo: 'DEP-0500', eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          direction: 'IN', amount: 300000, runningBalance: 300000, createdAt: '2026-09-01T00:00:00.000Z',
        }),
        leg({
          sourceType: 'DEPOSIT', sourceNo: 'DEP-0500', eventCode: 'DEPOSIT_CLAWBACK',
          direction: 'OUT', amount: 300000, runningBalance: 0, createdAt: '2026-09-05T00:00:00.000Z',
        }),
      ];
      const { items, total } = await service.buildStatement(legs, { isFiat: true });

      expect(total).toBe(2);
      // Newest first: clawback comes before the original credit.
      expect(items[0].title).toBe('Deposit recalled by bank');
      expect(items[0].subtitle).toBe('DEP-0500');
      expect(items[0].amount).toBe('-300000');
      expect(items[0].balanceAfter).toBe('0');

      expect(items[1].title).toBe('Deposit · bank transfer');
      expect(items[1].subtitle).toBe('DEP-0500');
      expect(items[1].amount).toBe('300000');
      expect(items[1].balanceAfter).toBe('300000');
    });
  });

  // ⑤ date range filter + pagination total.
  describe('⑤ date range filter + pagination', () => {
    const legs: StatementLeg[] = [
      leg({ sourceType: 'DEPOSIT', sourceNo: 'DEP-A', direction: 'IN', amount: 1000, runningBalance: 1000, createdAt: '2026-09-01T00:00:00.000Z' }),
      leg({ sourceType: 'DEPOSIT', sourceNo: 'DEP-B', direction: 'IN', amount: 2000, runningBalance: 3000, createdAt: '2026-09-03T00:00:00.000Z' }),
      leg({ sourceType: 'DEPOSIT', sourceNo: 'DEP-C', direction: 'IN', amount: 3000, runningBalance: 6000, createdAt: '2026-09-05T00:00:00.000Z' }),
    ];

    it('filters by [from, to] inclusive range', async () => {
      const { items, total } = await service.buildStatement(legs, {
        isFiat: true,
        from: new Date('2026-09-02T00:00:00.000Z'),
        to: new Date('2026-09-04T00:00:00.000Z'),
      });
      expect(total).toBe(1);
      expect(items[0].subtitle).toBe('DEP-B');
    });

    it('paginates with skip/take while total reflects the full filtered set', async () => {
      const { items, total } = await service.buildStatement(legs, { isFiat: true, skip: 1, take: 1 });
      expect(total).toBe(3);
      expect(items).toHaveLength(1);
      // Newest-first ordering: skip 1 (DEP-C) lands on DEP-B.
      expect(items[0].subtitle).toBe('DEP-B');
    });

    it('an out-of-range window excludes everything (reverse-direction check)', async () => {
      const { items, total } = await service.buildStatement(legs, {
        isFiat: true,
        from: new Date('2026-10-01T00:00:00.000Z'),
      });
      expect(total).toBe(0);
      expect(items).toHaveLength(0);
    });
  });

  // ⑥ confiscation/seizure-family and any other unrecognized event code
  // falls back to a generic "Balance adjustment" row with no sensitive wording.
  describe('⑥ sensitive/unrecognized event codes fall back to a generic adjustment row', () => {
    it('CONFISCATE_INCOME_OTHER → Balance adjustment, no leaked wording', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'DEPOSIT', sourceNo: 'DEP-0999', eventCode: 'CONFISCATE_INCOME_OTHER',
          direction: 'OUT', amount: 1000, runningBalance: 99000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].kind).toBe('ADJUSTMENT');
      expect(items[0].title).toBe('Balance adjustment');
      expect(items[0].subtitle).toBeNull();
      const serialized = JSON.stringify(items).toLowerCase();
      expect(serialized).not.toContain('confiscate');
      expect(serialized).not.toContain('seize');
      expect(serialized).not.toContain('sanction');
      expect(serialized).not.toContain('surrender');
    });

    it('SEIZE_REVERSE_SUSPENSE → Balance adjustment, no leaked wording (reverse-direction: a different sensitive code, same fallback)', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'DEPOSIT', sourceNo: 'DEP-0998', eventCode: 'SEIZE_REVERSE_SUSPENSE',
          direction: 'OUT', amount: 2000, runningBalance: 97000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance adjustment');
      const serialized = JSON.stringify(items).toLowerCase();
      expect(serialized).not.toContain('seize');
      expect(serialized).not.toContain('confiscate');
    });

    it('a whitelisted code is NOT affected by the fallback (control case)', async () => {
      const legs: StatementLeg[] = [
        leg({ eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', direction: 'IN', amount: 4000, runningBalance: 4000 }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).not.toBe('Balance adjustment');
    });
  });

  // ⑦ withdrawal-returned wording (word table bonus coverage).
  describe('⑦ withdrawal bounce/return row', () => {
    it('WITHDRAW_BOUNCE_REENTRY → "Withdrawal returned"', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'WITHDRAWAL', sourceNo: 'WD-0777', eventCode: 'WITHDRAW_BOUNCE_REENTRY',
          direction: 'IN', amount: 50000, runningBalance: 150000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].kind).toBe('WITHDRAWAL');
      expect(items[0].title).toBe('Withdrawal returned');
      expect(items[0].subtitle).toBe('WD-0777');
    });
  });

  // Deposit/withdrawal title wording depends on isFiat.
  describe('deposit/withdrawal title varies by asset type', () => {
    it('crypto deposit uses "Deposit · crypto"', async () => {
      const legs: StatementLeg[] = [
        leg({ eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE', direction: 'IN', amount: 1000, runningBalance: 1000 }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: false });
      expect(items[0].title).toBe('Deposit · crypto');
    });

    it('crypto withdrawal uses "Withdrawal · crypto"', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'WITHDRAWAL', sourceNo: 'WD-0002', eventCode: 'WITHDRAW_NET_POST',
          direction: 'OUT', amount: 1000, runningBalance: 99000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: false });
      expect(items[0].title).toBe('Withdrawal · crypto');
    });
  });
});

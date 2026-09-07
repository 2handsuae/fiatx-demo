// src/modules/asset-treasury/treasury/customer-statement.service.spec.ts
import { CustomerStatementService, StatementLeg } from './customer-statement.service';

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

  // ② RECON_ADJUSTMENT row: title uses reasonCustomer, subtitle uses
  // relatedOrderNo when present (never the ADJ number), null otherwise.
  describe('② adjustment row', () => {
    it('shows "Original order {no}" when relatedOrderNo is present', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0001', reasonCode: 'DEPOSIT_AMOUNT_CORRECTION', relatedOrderNo: 'DEP-0777', direction: 'INCREASE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0001', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'IN', amount: 5000, runningBalance: 105000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].kind).toBe('ADJUSTMENT');
      expect(items[0].title).toBe('Balance correction · Deposit amount correction');
      expect(items[0].subtitle).toBe('Original order DEP-0777');
      expect(items[0].amount).toBe('5000');
      // Never leaks the internal ADJ number in the subtitle.
      expect(items[0].subtitle).not.toContain('ADJ-0001');
    });

    it('shows null subtitle when relatedOrderNo is absent', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        { adjustmentNo: 'ADJ-0002', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', relatedOrderNo: null, direction: 'REDUCE' },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-0002', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 3000, runningBalance: 97000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance correction · Duplicate deposit reversal');
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

    // Fix round (opus review Critical): reasonCustomer is operator-typed free
    // text with no controlled vocabulary — it must never reach the response.
    // The title is looked up from REASON_SPECS.customerLabel by reasonCode
    // instead. This reproduces the exact leak shape the reviewer found: a
    // Chinese sentence plus an English sanctions-adjacent word typed into
    // reasonCustomer by an operator.
    it('never leaks reasonCustomer free text (Chinese + sensitive word) into the response — controlled title comes from reasonCode', async () => {
      mockPrisma.reconciliationAdjustment.findMany.mockResolvedValue([
        {
          adjustmentNo: 'ADJ-EVIL',
          reasonCode: 'UNEXPLAINED_CLIENT_LOSS',
          // Present in the raw DB row (as it would be in production) but must
          // never be read by the presentation layer.
          reasonCustomer: '资金已被上缴 surrender',
          relatedOrderNo: null,
          direction: 'REDUCE',
        },
      ]);
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'RECON_ADJUSTMENT', sourceNo: 'ADJ-EVIL', eventCode: 'RECON_ADJUSTMENT_POSTED',
          direction: 'OUT', amount: 4000, runningBalance: 96000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].title).toBe('Balance adjustment');
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain('资金已被上缴');
      expect(serialized.toLowerCase()).not.toContain('surrender');
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

  // ③ internal transfer COMPENSATION/ADVANCE rows.
  describe('③ internal transfer credit rows', () => {
    it('CLIENT_COMPENSATION → "balance restoration" wording, no subtitle', async () => {
      const legs: StatementLeg[] = [
        leg({
          sourceType: 'INTERNAL_TRANSFER', sourceNo: 'IT-0001', eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN',
          direction: 'IN', amount: 20000, runningBalance: 120000,
        }),
      ];
      const { items } = await service.buildStatement(legs, { isFiat: true });
      expect(items[0].kind).toBe('TRANSFER');
      expect(items[0].title).toBe('Credit from FiatX · balance restoration');
      expect(items[0].subtitle).toBeNull();
    });

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

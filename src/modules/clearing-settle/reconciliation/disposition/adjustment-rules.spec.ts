import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  REASON_SPECS, assertReasonAllowed, resolvePostingLegs, requiresRelatedOrder, resolveReattributionLegs,
} from './adjustment-rules';

describe('resolvePostingLegs —— four combinations, cause plays no part in the calculation', () => {
  it('client book · reduce: debit client payable / credit client asset', () => {
    expect(resolvePostingLegs('CLIENT', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_CASH,
    });
  });

  it('client book · increase: debit client asset / credit client payable', () => {
    expect(resolvePostingLegs('CLIENT', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_CASH,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });

  it('firm book · reduce: debit firm ops / credit firm asset', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_EQUITY,
      creditCode: TB_ACCOUNT_CODES.FIRM_CASH,
    });
  });

  it('firm book · increase: debit firm asset / credit other income', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_CASH,
      creditCode: TB_ACCOUNT_CODES.INCOME_OTHER,
    });
  });
});

describe('requiresRelatedOrder —— §4 boundary-line guard', () => {
  it('adding funds to a client-book account requires an original order', () => {
    expect(requiresRelatedOrder('CLIENT', 'INCREASE')).toBe(true);
  });
  it('the other three combinations do not require it', () => {
    expect(requiresRelatedOrder('CLIENT', 'REDUCE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'INCREASE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'REDUCE')).toBe(false);
  });
});

describe('assertReasonAllowed —— cause × book × direction legal combinations are hard-coded', () => {
  it('deposit amount correction (AMT_MISBOOKED) is legal both ways on the client book', () => {
    expect(() => assertReasonAllowed('AMT_MISBOOKED', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('AMT_MISBOOKED', 'CLIENT', 'INCREASE')).not.toThrow();
  });

  it('amount causes (AMT_MISBOOKED / AMT_FEE_NETTED / AMT_ROUNDING) are legal both ways on BOTH books (2026-11-04: the firm mismatch cell corrects with the same three codes)', () => {
    (['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING'] as const).forEach((code) => {
      (['CLIENT', 'FIRM'] as const).forEach((book) => {
        (['REDUCE', 'INCREASE'] as const).forEach((direction) => {
          expect(() => assertReasonAllowed(code, book, direction)).not.toThrow();
        });
      });
    });
  });

  it('duplicate posting (DUP_BOOKING) is legal both ways on both books (a duplicated OUT row is reversed by INCREASE; the firm pool can hit either direction)', () => {
    (['CLIENT', 'FIRM'] as const).forEach((book) => {
      expect(() => assertReasonAllowed('DUP_BOOKING', book, 'REDUCE')).not.toThrow();
      expect(() => assertReasonAllowed('DUP_BOOKING', book, 'INCREASE')).not.toThrow();
    });
  });

  it('bank interest (BANK_INTEREST_UNBOOKED) can only land on the firm book, and can only increase', () => {
    expect(() => assertReasonAllowed('BANK_INTEREST_UNBOOKED', 'FIRM', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_INTEREST_UNBOOKED', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_INTEREST_UNBOOKED', 'FIRM', 'REDUCE')).toThrow(BadRequestException);
  });

  it('bank charges (BANK_CHARGE_UNBOOKED) can only land on the firm book, and can only reduce', () => {
    expect(() => assertReasonAllowed('BANK_CHARGE_UNBOOKED', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_CHARGE_UNBOOKED', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_CHARGE_UNBOOKED', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('deposit reversal (PHANTOM_BOOKING) can only reduce', () => {
    expect(() => assertReasonAllowed('PHANTOM_BOOKING', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('PHANTOM_BOOKING', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('withdrawal amount correction (PAYOUT_NOT_EXECUTED) can only increase', () => {
    expect(() => assertReasonAllowed('PAYOUT_NOT_EXECUTED', 'CLIENT', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('PAYOUT_NOT_EXECUTED', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });

  it('client-only causes still cannot land on the firm book', () => {
    expect(() => assertReasonAllowed('PHANTOM_BOOKING', 'FIRM', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('PAYOUT_NOT_EXECUTED', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('firm-only causes still cannot land on the client book (FIRM_MISBOOKED)', () => {
    expect(() => assertReasonAllowed('FIRM_MISBOOKED', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('FIRM_MISBOOKED', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });

  it('exactly thirteen reason codes (fourth-family reattribution + wave-2 client pool loss recognition + firm-pool write-off; plus single-code-system Task 2: nine cause-registry codes + OTHER — the eight old folded codes retired in Task 13, the two firm amount codes retired 2026-11-04), no catch-all beyond OTHER', () => {
    const codes = Object.keys(REASON_SPECS).sort();
    expect(codes).toEqual([
      'AMT_FEE_NETTED', 'AMT_MISBOOKED', 'AMT_ROUNDING',
      'BANK_CHARGE_UNBOOKED', 'BANK_INTEREST_UNBOOKED',
      'CUSTOMER_REATTRIBUTION',
      'DUP_BOOKING',
      'FIRM_MISBOOKED',
      'OTHER',
      'PAYOUT_NOT_EXECUTED', 'PHANTOM_BOOKING',
      'UNEXPLAINED_CLIENT_LOSS', 'UNEXPLAINED_WRITE_OFF',
    ]);
  });

  it('firm-book causes have no customer-facing label (customer cannot see firm-side adjustments)', () => {
    expect(REASON_SPECS.BANK_INTEREST_UNBOOKED.customerLabel).toBeNull();
    expect(REASON_SPECS.BANK_CHARGE_UNBOOKED.customerLabel).toBeNull();
    expect(REASON_SPECS.DUP_BOOKING.customerLabel).toBe('Duplicate entry reversal');
  });

  it('AMT_FEE_NETTED reads "Fee netted" internally (the firm pool nets LP swap fees, not bank fees)', () => {
    expect(REASON_SPECS.AMT_FEE_NETTED.internalLabel).toBe('Fee netted');
  });

  it("'ANY' book = exactly the codes both books use: OTHER, the three AMT_* and DUP_BOOKING", () => {
    const any = Object.entries(REASON_SPECS).filter(([, s]) => s.book === 'ANY').map(([code]) => code).sort();
    expect(any).toEqual(['AMT_FEE_NETTED', 'AMT_MISBOOKED', 'AMT_ROUNDING', 'DUP_BOOKING', 'OTHER']);
  });
});

describe('Fourth family REATTRIBUTE (spec §6)', () => {
  it('family assignment covers the existing four families with no gaps or overlaps (fifth family WRITE_OFF is covered by the resolveWriteOff cases in cause-registry.spec)', () => {
    const byFamily: Record<string, string[]> = {};
    for (const [code, spec] of Object.entries(REASON_SPECS)) {
      (byFamily[(spec as any).family] ??= []).push(code);
    }
    // Task 2（单码制）加了 cause-registry 同名码 + OTHER，都落进既有四族里，无第五族新增。
    // Task 13：旧 8 折叠码退役后，四族名单只剩单码制新码 + 第四族改记。
    // 2026-11-04：公司池两个金额码退役——公司池「金额不对」改走 CORRECT 族的 AMT_*，RECORD 族只剩两个银行码。
    expect(byFamily.CORRECT!.sort()).toEqual(['AMT_FEE_NETTED', 'AMT_MISBOOKED', 'AMT_ROUNDING', 'OTHER']);
    expect(byFamily.REVERSE!.sort()).toEqual(['DUP_BOOKING', 'FIRM_MISBOOKED', 'PAYOUT_NOT_EXECUTED', 'PHANTOM_BOOKING']);
    expect(byFamily.RECORD!.sort()).toEqual(['BANK_CHARGE_UNBOOKED', 'BANK_INTEREST_UNBOOKED']);
    expect(byFamily.REATTRIBUTE).toEqual(['CUSTOMER_REATTRIBUTION']);
  });
  it('reattribution entry: debit the misattributed party payable / credit the rightful owner payable — the asset leg does not move (fifth combination)', () => {
    expect(resolveReattributionLegs()).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });
  it('reattribution does not follow book×direction semantics: assertReasonAllowed rejects it for any direction', () => {
    expect(() => assertReasonAllowed('CUSTOMER_REATTRIBUTION' as any, 'CLIENT', 'REDUCE')).toThrow();
  });
});

describe('Recon batch A: new reason codes (spec §3.1 / §5)', () => {
  it('UNEXPLAINED_WRITE_OFF: firm book, both directions, write-off family; client book always rejected', () => {
    expect(REASON_SPECS.UNEXPLAINED_WRITE_OFF).toEqual({
      book: 'FIRM', directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Unexplained write-off', family: 'WRITE_OFF',
    });
    expect(() => assertReasonAllowed('UNEXPLAINED_WRITE_OFF', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });
  it('write-off entry legs pair with record entry: reduce = debit ops/credit firm asset, increase = debit firm asset/credit other income', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_EQUITY, creditCode: TB_ACCOUNT_CODES.FIRM_CASH });
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_CASH, creditCode: TB_ACCOUNT_CODES.INCOME_OTHER });
  });
});

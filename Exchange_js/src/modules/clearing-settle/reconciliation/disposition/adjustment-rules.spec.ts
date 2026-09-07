import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  REASON_SPECS, assertReasonAllowed, resolvePostingLegs, requiresRelatedOrder, resolveReattributionLegs,
} from './adjustment-rules';

describe('resolvePostingLegs —— four combinations, cause plays no part in the calculation', () => {
  it('client book · reduce: debit client payable / credit client asset', () => {
    expect(resolvePostingLegs('CLIENT', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
    });
  });

  it('client book · increase: debit client asset / credit client payable', () => {
    expect(resolvePostingLegs('CLIENT', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });

  it('firm book · reduce: debit firm ops / credit firm asset', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_OPS,
      creditCode: TB_ACCOUNT_CODES.FIRM_ASSET,
    });
  });

  it('firm book · increase: debit firm asset / credit other income', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_ASSET,
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
  it('deposit amount correction is legal both ways on the client book', () => {
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'INCREASE')).not.toThrow();
  });

  it('duplicate deposit reversal can only reduce', () => {
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('bank interest can only land on the firm book, and can only increase', () => {
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_INTEREST', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'REDUCE')).toThrow(BadRequestException);
  });

  it('bank charges can only land on the firm book, and can only reduce', () => {
    expect(() => assertReasonAllowed('BANK_CHARGE', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_CHARGE', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_CHARGE', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('deposit reversal can only reduce', () => {
    expect(() => assertReasonAllowed('DEPOSIT_SIGNAL_VOID', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_SIGNAL_VOID', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('withdrawal amount correction can only increase', () => {
    expect(() => assertReasonAllowed('WITHDRAW_AMOUNT_CORRECTION', 'CLIENT', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('WITHDRAW_AMOUNT_CORRECTION', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });

  it('withdrawal refund can only increase', () => {
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'CLIENT', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('client-side causes cannot land on the firm book', () => {
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('exactly eleven reason codes (fourth-family reattribution + two batch-A codes + wave-2 client pool loss recognition), no catch-all', () => {
    const codes = Object.keys(REASON_SPECS).sort();
    expect(codes).toEqual([
      'BANK_CHARGE', 'BANK_INTEREST',
      'CUSTOMER_REATTRIBUTION',
      'DEPOSIT_AMOUNT_CORRECTION', 'DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID',
      'FIRM_ENTRY_REVERSAL',
      'UNEXPLAINED_CLIENT_LOSS', 'UNEXPLAINED_WRITE_OFF',
      'WITHDRAW_AMOUNT_CORRECTION', 'WITHDRAW_VOID_REFUND',
    ]);
  });

  it('firm-book causes have no customer-facing label (customer cannot see firm-side adjustments)', () => {
    expect(REASON_SPECS.BANK_INTEREST.customerLabel).toBeNull();
    expect(REASON_SPECS.BANK_CHARGE.customerLabel).toBeNull();
    expect(REASON_SPECS.DEPOSIT_DUPLICATE_REVERSAL.customerLabel).toBe('Duplicate deposit reversal');
  });
});

describe('Fourth family REATTRIBUTE (spec §6)', () => {
  it('family assignment covers the existing four families with no gaps or overlaps (fifth family WRITE_OFF is covered by the resolveWriteOff cases in cause-registry.spec)', () => {
    const byFamily: Record<string, string[]> = {};
    for (const [code, spec] of Object.entries(REASON_SPECS)) {
      (byFamily[(spec as any).family] ??= []).push(code);
    }
    expect(byFamily.CORRECT!.sort()).toEqual(['DEPOSIT_AMOUNT_CORRECTION', 'WITHDRAW_AMOUNT_CORRECTION']);
    expect(byFamily.REVERSE!.sort()).toEqual(['DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID', 'FIRM_ENTRY_REVERSAL', 'WITHDRAW_VOID_REFUND']);
    expect(byFamily.RECORD!.sort()).toEqual(['BANK_CHARGE', 'BANK_INTEREST']);
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

describe('Recon batch A: two new reason codes (spec §3.1 / §5)', () => {
  it('FIRM_ENTRY_REVERSAL: firm book, both directions, reversal family', () => {
    expect(REASON_SPECS.FIRM_ENTRY_REVERSAL).toEqual({
      book: 'FIRM', directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Firm ledger reversal', family: 'REVERSE',
    });
    expect(() => assertReasonAllowed('FIRM_ENTRY_REVERSAL', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('FIRM_ENTRY_REVERSAL', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });
  it('UNEXPLAINED_WRITE_OFF: firm book, both directions, write-off family; client book always rejected', () => {
    expect(REASON_SPECS.UNEXPLAINED_WRITE_OFF).toEqual({
      book: 'FIRM', directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: 'Unexplained write-off', family: 'WRITE_OFF',
    });
    expect(() => assertReasonAllowed('UNEXPLAINED_WRITE_OFF', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });
  it('write-off entry legs pair with record entry: reduce = debit ops/credit firm asset, increase = debit firm asset/credit other income', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_OPS, creditCode: TB_ACCOUNT_CODES.FIRM_ASSET });
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_ASSET, creditCode: TB_ACCOUNT_CODES.INCOME_OTHER });
  });
});

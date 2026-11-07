import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  REASON_SPECS, assertReasonAllowed, resolvePostingLegs, requiresRelatedOrder, resolveReattributionLegs,
} from './adjustment-rules';

// 戊波一·附录 B「平账调账单」：现金腿 = 案子钱包的现金户（客户池 1 / 公司池 50），对手腿由「账簿 × 处置家族 × 方向」定。
// REDUCE = 借对手 / 贷现金；INCREASE = 借现金 / 贷对手。
describe('resolvePostingLegs —— cash side follows the book, counter side follows the disposition family (campaign E wave 1, appendix B)', () => {
  const C = TB_ACCOUNT_CODES;

  it('client book · reduce (AMT_MISBOOKED): debit client payable / credit client cash', () => {
    expect(resolvePostingLegs('CLIENT', 'REDUCE', 'AMT_MISBOOKED')).toEqual({ debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_CASH });
  });

  it('client book · increase (AMT_MISBOOKED): debit client cash / credit client payable', () => {
    expect(resolvePostingLegs('CLIENT', 'INCREASE', 'AMT_MISBOOKED')).toEqual({ debitCode: C.CLIENT_CASH, creditCode: C.CLIENT_PAYABLE });
  });

  // 戊波二 T7a：客户池认损改走划转单（认损补缺），客户余额不动——调账单写面不再接受这个成因码，
  // 它只作认损补缺的固定成因常量（cause-registry.ts CLIENT_SHORTFALL_CAUSE）。
  it('client-pool loss recognition (UNEXPLAINED_CLIENT_LOSS) is retired from the adjustment write path: not a REASON_SPECS key, assertReasonAllowed rejects it as unknown', () => {
    expect(Object.keys(REASON_SPECS)).not.toContain('UNEXPLAINED_CLIENT_LOSS');
    expect(() => assertReasonAllowed('UNEXPLAINED_CLIENT_LOSS' as any, 'CLIENT', 'REDUCE')).toThrow(/Unknown reason code/);
  });

  it('firm book · correct / reverse · reduce (AMT_MISBOOKED): debit company equity / credit company cash', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE', 'AMT_MISBOOKED')).toEqual({ debitCode: C.FIRM_EQUITY, creditCode: C.FIRM_CASH });
    expect(resolvePostingLegs('FIRM', 'REDUCE', 'FIRM_MISBOOKED')).toEqual({ debitCode: C.FIRM_EQUITY, creditCode: C.FIRM_CASH });
  });

  it('firm book · correct / reverse · increase: debit company cash / credit company equity (NOT other income — charter appendix B)', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE', 'AMT_MISBOOKED')).toEqual({ debitCode: C.FIRM_CASH, creditCode: C.FIRM_EQUITY });
    expect(resolvePostingLegs('FIRM', 'INCREASE', 'DUP_BOOKING')).toEqual({ debitCode: C.FIRM_CASH, creditCode: C.FIRM_EQUITY });
  });

  it('firm book · record · reduce (BANK_CHARGE_UNBOOKED): debit bank & custody expense / credit company cash', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE', 'BANK_CHARGE_UNBOOKED')).toEqual({ debitCode: C.EXPENSE_BANK_CUSTODY, creditCode: C.FIRM_CASH });
  });

  it('firm book · record · increase (BANK_INTEREST_UNBOOKED): debit company cash / credit other income', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE', 'BANK_INTEREST_UNBOOKED')).toEqual({ debitCode: C.FIRM_CASH, creditCode: C.INCOME_OTHER });
  });

  it('firm book · write-off · reduce (custody short, UNEXPLAINED_WRITE_OFF): debit reconciliation write-off loss / credit company cash', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE', 'UNEXPLAINED_WRITE_OFF')).toEqual({ debitCode: C.EXPENSE_RECON_LOSS, creditCode: C.FIRM_CASH });
  });

  it('firm book · write-off · increase (custody over, UNEXPLAINED_WRITE_OFF): debit company cash / credit other income (212 — a debit-normal 301 cannot be credited past its debits, charter §4 fork 7)', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE', 'UNEXPLAINED_WRITE_OFF')).toEqual({ debitCode: C.FIRM_CASH, creditCode: C.INCOME_OTHER });
  });

  // 全格扫：每个「处置家族 × 账簿 × 方向」格子对照一张手写总表。表里是字面数字，不从实现里推。
  it('every legal reason × book × direction cell matches the hand-written journal table (counter code only; cash code = book)', () => {
    const counterTable: Record<string, Record<string, Record<string, number>>> = {
      CORRECT:   { CLIENT: { REDUCE: 100, INCREASE: 100 }, FIRM: { REDUCE: 200, INCREASE: 200 } },
      REVERSE:   { CLIENT: { REDUCE: 100, INCREASE: 100 }, FIRM: { REDUCE: 200, INCREASE: 200 } },
      RECORD:    { CLIENT: { REDUCE: 100, INCREASE: 100 }, FIRM: { REDUCE: 300, INCREASE: 212 } },
      WRITE_OFF: { CLIENT: { REDUCE: 100, INCREASE: 100 }, FIRM: { REDUCE: 301, INCREASE: 212 } },
    };
    let cells = 0;
    for (const [code, spec] of Object.entries(REASON_SPECS)) {
      if (spec.family === 'REATTRIBUTE') continue; // 改记不走 book×direction
      for (const book of ['CLIENT', 'FIRM'] as const) {
        if (spec.book !== 'ANY' && spec.book !== book) continue;
        for (const direction of spec.directions) {
          const cash = book === 'CLIENT' ? 1 : 50;
          const counter = counterTable[spec.family][book][direction];
          const expected = direction === 'REDUCE' ? { debitCode: counter, creditCode: cash } : { debitCode: cash, creditCode: counter };
          expect({ cell: `${code}/${book}/${direction}`, legs: resolvePostingLegs(book, direction, code as any) })
            .toEqual({ cell: `${code}/${book}/${direction}`, legs: expected });
          cells++;
        }
      }
    }
    // 非改记的 11 个码在各自合法账簿 × 方向下共 28 格（WRITE_OFF 2 + AMT×3 12 + DUP 4 + PHANTOM 1 + PAYOUT 1 + FIRM_MISBOOKED 2 + INTEREST 1 + CHARGE 1 + OTHER 4）——
    // 戊波二 T7a：客户池认损（CLIENT_LOSS 1 格）退出调账单，29 → 28。钉死格数，防止循环空转。
    expect(cells).toBe(28);
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

  it('exactly twelve reason codes (fourth-family reattribution + firm-pool write-off — the client-pool loss recognition code left in wave 2 T7a; plus single-code-system Task 2: nine cause-registry codes + OTHER — the eight old folded codes retired in Task 13, the two firm amount codes retired 2026-11-04), no catch-all beyond OTHER', () => {
    const codes = Object.keys(REASON_SPECS).sort();
    expect(codes).toEqual([
      'AMT_FEE_NETTED', 'AMT_MISBOOKED', 'AMT_ROUNDING',
      'BANK_CHARGE_UNBOOKED', 'BANK_INTEREST_UNBOOKED',
      'CUSTOMER_REATTRIBUTION',
      'DUP_BOOKING',
      'FIRM_MISBOOKED',
      'OTHER',
      'PAYOUT_NOT_EXECUTED', 'PHANTOM_BOOKING',
      'UNEXPLAINED_WRITE_OFF',
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
  it('reattribution is a four-leg voucher (charter §4 fork 6): payable pair (debit misattributed party / credit rightful owner) + cash pair (debit rightful owner wallet / credit misattributed party wallet)', () => {
    expect(resolveReattributionLegs()).toEqual({
      payable: { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE },
      cash: { debitCode: TB_ACCOUNT_CODES.CLIENT_CASH, creditCode: TB_ACCOUNT_CODES.CLIENT_CASH },
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
});

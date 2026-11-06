// swap-leg-plan.constant.spec.ts
import { buildSwapLegPlan, cashSideRole } from './swap-leg-plan.constant';
import { TB_ACCOUNT_CODES as C, isCashCode } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES as T } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

describe('buildSwapLegPlan', () => {
  it('crypto→fiat (USDT→AED) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: false });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_DEP', 'F_OPS'], ['F_OPS', 'F_SET'], ['F_SET', 'C_VIBAN'], ['C_VIBAN', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
    expect(legs[0].accounting.map((a) => a.creditCode)).toEqual([C.CLIENT_CASH, C.FIRM_EQUITY]);
  });

  it('fiat→crypto (AED→USDT) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: true });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_VIBAN', 'F_SET'], ['F_SET', 'F_OPS'], ['F_OPS', 'C_DEP'], ['C_DEP', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
  });
});

// 戊波一·附录 B「兑换」: 每条分录的 [转账码, 借方科目, 贷方科目](码不变,只换科目)
describe('swap-leg-plan — 14 rows of the 戊波一 ledger (码不变,科目换成现金户 + 公司权益)', () => {
  const rows = (fromIsFiat: boolean) =>
    buildSwapLegPlan({ fromIsFiat }).flatMap((l) => l.accounting.map((a) => [a.code, a.debitCode, a.creditCode]));

  it('CRYPTO_TO_FIAT: 30 / 31 / 32 / 33 / 34 / 35 / 36', () => {
    expect(rows(false)).toEqual([
      [T.SWAP_SELL_CLIENT, C.CLIENT_PAYABLE, C.CLIENT_CASH],
      [T.SWAP_SELL_FIRM, C.FIRM_CASH, C.FIRM_EQUITY],
      [T.SWAP_BUY_OPS_TO_SET, C.FIRM_CASH, C.FIRM_CASH],
      [T.SWAP_BUY_SET_TO_ASSET, C.FIRM_EQUITY, C.FIRM_CASH],
      [T.SWAP_BUY_CLIENT, C.CLIENT_CASH, C.CLIENT_PAYABLE],
      [T.SWAP_FEE_CLIENT, C.CLIENT_PAYABLE, C.CLIENT_CASH],
      [T.SWAP_FEE_FIRM, C.FIRM_CASH, C.INCOME_SWAP_FEE],
    ]);
    expect(rows(false).map((r) => r[0])).toEqual([30, 31, 32, 33, 34, 35, 36]);
  });

  it('FIAT_TO_CRYPTO: 30 / 31 / 37 / 38 / 34 / 35 / 36', () => {
    expect(rows(true)).toEqual([
      [T.SWAP_SELL_CLIENT, C.CLIENT_PAYABLE, C.CLIENT_CASH],
      [T.SWAP_SELL_FIRM, C.FIRM_CASH, C.FIRM_EQUITY],
      [T.SWAP_SELL_SET_TO_OPS, C.FIRM_CASH, C.FIRM_CASH],
      [T.SWAP_BUY_OPS_TO_ASSET, C.FIRM_EQUITY, C.FIRM_CASH],
      [T.SWAP_BUY_CLIENT, C.CLIENT_CASH, C.CLIENT_PAYABLE],
      [T.SWAP_FEE_CLIENT, C.CLIENT_PAYABLE, C.CLIENT_CASH],
      [T.SWAP_FEE_FIRM, C.FIRM_CASH, C.INCOME_SWAP_FEE],
    ]);
    expect(rows(true).map((r) => r[0])).toEqual([30, 31, 37, 38, 34, 35, 36]);
  });

  it('no retired settlement/liquidity account (201 / 203) is referenced by any swap entry', () => {
    for (const fromIsFiat of [false, true]) {
      for (const a of buildSwapLegPlan({ fromIsFiat }).flatMap((l) => l.accounting)) {
        expect([a.debitCode, a.creditCode]).not.toContain(C.FIRM_SET);
        expect([a.debitCode, a.creditCode]).not.toContain(C.FIRM_LIQ);
      }
    }
  });
});

describe('swap-leg-plan — every cash side resolves to the leg\'s from/to role', () => {
  // 附录 B 逐条独立手写的期望(不从实现推):[转账码, 现金借方钱包角色 | null, 现金贷方钱包角色 | null]
  const expected: Record<'CRYPTO_TO_FIAT' | 'FIAT_TO_CRYPTO', Array<[number, string | null, string | null]>> = {
    CRYPTO_TO_FIAT: [
      [30, null, 'C_DEP'],
      [31, 'F_OPS', null],
      [32, 'F_SET', 'F_OPS'],
      [33, null, 'F_SET'],
      [34, 'C_VIBAN', null],
      [35, null, 'C_VIBAN'],
      [36, 'F_FEE', null],
    ],
    FIAT_TO_CRYPTO: [
      [30, null, 'C_VIBAN'],
      [31, 'F_SET', null],
      [37, 'F_OPS', 'F_SET'],
      [38, null, 'F_OPS'],
      [34, 'C_DEP', null],
      [35, null, 'C_DEP'],
      [36, 'F_FEE', null],
    ],
  };

  for (const [name, fromIsFiat] of [['CRYPTO_TO_FIAT', false], ['FIAT_TO_CRYPTO', true]] as const) {
    it(`${name}: cash debit = toRole wallet, cash credit = fromRole wallet (matches 附录 B)`, () => {
      const got: Array<[number, string | null, string | null]> = [];
      for (const spec of buildSwapLegPlan({ fromIsFiat })) {
        for (const a of spec.accounting) {
          got.push([
            a.code,
            isCashCode(a.debitCode) ? cashSideRole(spec, 'debit') : null,
            isCashCode(a.creditCode) ? cashSideRole(spec, 'credit') : null,
          ]);
        }
      }
      expect(got).toEqual(expected[name]);
    });

    it(`${name}: customer roles (C_*) land on 1 CLIENT_CASH, platform roles (F_*) land on 50 FIRM_CASH`, () => {
      for (const spec of buildSwapLegPlan({ fromIsFiat })) {
        for (const a of spec.accounting) {
          for (const [side, code] of [['debit', a.debitCode], ['credit', a.creditCode]] as const) {
            if (!isCashCode(code)) continue;
            const role = cashSideRole(spec, side);
            expect(code).toBe(role.startsWith('C_') ? C.CLIENT_CASH : C.FIRM_CASH);
          }
        }
      }
    });
  }
});

describe('swap-leg-plan — sell-first business invariant', () => {
  it('CRYPTO_TO_FIAT: leg1 is the customer SELL leg', () => {
    const plan = buildSwapLegPlan({ fromIsFiat: false });
    const leg1 = plan.find((s) => s.legSeq === 1)!;
    expect(leg1).toBeDefined();
    // leg1 must move customer's source asset (side === 'from') — never the destination
    expect(leg1.side).toBe('from');
    // and the customer wallet is the source role (C_DEP for crypto)
    expect(leg1.fromRole).toBe('C_DEP');
    // accounting entries must include SWAP_SELL_CLIENT (the customer-side debit)
    const eventCodes = leg1.accounting.map((a) => a.eventCode);
    expect(eventCodes).toContain('SWAP_SELL_CLIENT');
  });

  it('FIAT_TO_CRYPTO: leg1 is the customer SELL leg', () => {
    const plan = buildSwapLegPlan({ fromIsFiat: true });
    const leg1 = plan.find((s) => s.legSeq === 1)!;
    expect(leg1).toBeDefined();
    expect(leg1.side).toBe('from');
    // customer's fiat wallet is the source for fiat-to-crypto sell
    expect(leg1.fromRole).toBe('C_VIBAN');
    const eventCodes = leg1.accounting.map((a) => a.eventCode);
    expect(eventCodes).toContain('SWAP_SELL_CLIENT');
  });

  it('no leg before leg1 exists in either direction (sell is FIRST)', () => {
    for (const fromIsFiat of [false, true]) {
      const plan = buildSwapLegPlan({ fromIsFiat });
      const minLegSeq = Math.min(...plan.map((s) => s.legSeq));
      expect(minLegSeq).toBe(1);
    }
  });
});

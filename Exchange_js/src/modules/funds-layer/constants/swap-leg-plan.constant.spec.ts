// swap-leg-plan.constant.spec.ts
import { buildSwapLegPlan } from './swap-leg-plan.constant';
import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('buildSwapLegPlan', () => {
  it('crypto→fiat (USDT→AED) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: false });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_DEP', 'F_OPS'], ['F_OPS', 'F_SET'], ['F_SET', 'C_VIBAN'], ['C_VIBAN', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
    expect(legs[0].accounting.map((a) => a.creditCode)).toEqual([C.CLIENT_ASSET, C.FIRM_OPS]);
  });

  it('fiat→crypto (AED→USDT) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: true });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_VIBAN', 'F_SET'], ['F_SET', 'F_OPS'], ['F_OPS', 'C_DEP'], ['C_DEP', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
  });
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

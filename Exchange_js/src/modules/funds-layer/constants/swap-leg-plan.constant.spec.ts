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

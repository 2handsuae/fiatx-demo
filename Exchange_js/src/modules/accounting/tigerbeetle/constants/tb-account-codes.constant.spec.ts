// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
import { TB_ACCOUNT_CODES, COA_TO_TB_CODE, TB_CODE_TO_COA } from './tb-account-codes.constant';

describe('TB_ACCOUNT_CODES (real-time 1:1 COA)', () => {
  it('exposes exactly the 8 new codes', () => {
    expect(TB_ACCOUNT_CODES).toEqual({
      CLIENT_ASSET: 1,
      FIRM_ASSET: 50,
      CLIENT_PAYABLE: 100,
      DEPOSIT_SUSPENSE: 101,
      FIRM_OPS: 200,
      FIRM_SET: 201,
      FIRM_FEE: 202,
      FIRM_LIQ: 203,
    });
  });

  it('drops all legacy codes', () => {
    const names = Object.keys(TB_ACCOUNT_CODES);
    for (const dead of ['CLIENT_BANK','CLIENT_CUSTODY','TRADE_CLEARING','FIRM_TREASURY','FX_POSITION','PAID_IN_CAPITAL','RETAINED_EARNINGS','FEE_INCOME','SPREAD_INCOME','FX_UNREALIZED_PNL','FX_REALIZED_PNL']) {
      expect(names).not.toContain(dead);
    }
  });

  it('round-trips COA labels', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_ASSET']).toBe(1);
    expect(COA_TO_TB_CODE['E.FIRM_FEE']).toBe(202);
    expect(TB_CODE_TO_COA[201]).toBe('E.FIRM_SET');
  });
});

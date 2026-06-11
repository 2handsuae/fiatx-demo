import { TB_ACCOUNT_CODES, COA_TO_TB_CODE, TB_CODE_TO_COA } from './tb-account-codes.constant';

describe('TB_ACCOUNT_CODES (two-book COA)', () => {
  it('客户账本科目保留原编码', () => {
    expect(TB_ACCOUNT_CODES.CLIENT_BANK).toBe(1);
    expect(TB_ACCOUNT_CODES.CLIENT_CUSTODY).toBe(10);
    expect(TB_ACCOUNT_CODES.CLIENT_PAYABLE).toBe(100);
    expect(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE).toBe(101);
    expect(TB_ACCOUNT_CODES.TRADE_CLEARING).toBe(110);
  });
  it('公司账本科目按 class 编码段', () => {
    expect(TB_ACCOUNT_CODES.FIRM_TREASURY).toBe(50);
    expect(TB_ACCOUNT_CODES.FX_POSITION).toBe(60);
    expect(TB_ACCOUNT_CODES.PAID_IN_CAPITAL).toBe(200);
    expect(TB_ACCOUNT_CODES.RETAINED_EARNINGS).toBe(210);
    expect(TB_ACCOUNT_CODES.FEE_INCOME).toBe(300);
    expect(TB_ACCOUNT_CODES.SPREAD_INCOME).toBe(310);
    expect(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL).toBe(320);
    expect(TB_ACCOUNT_CODES.FX_REALIZED_PNL).toBe(330);
  });
  it('COA 字符串双向映射一致', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_BANK']).toBe(1);
    expect(COA_TO_TB_CODE['A.FIRM_TREASURY']).toBe(50);
    expect(COA_TO_TB_CODE['R.FEE_INCOME']).toBe(300);
    expect(TB_CODE_TO_COA[310]).toBe('R.SPREAD_INCOME');
    expect(TB_CODE_TO_COA[60]).toBe('A.FX_POSITION');
  });
});

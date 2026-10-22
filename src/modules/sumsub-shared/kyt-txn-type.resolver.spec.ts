import { resolveKytTxnType } from './kyt-txn-type.resolver';

describe('resolveKytTxnType', () => {
  it('法币 → finance / NOT_CRYPTO', () => {
    expect(resolveKytTxnType({ assetType: 'FIAT' })).toEqual({ type: 'finance', reason: 'NOT_CRYPTO' });
  });

  it('crypto 一律 travelRule / TR_REQUIRED —— 与币种、金额、对手方无关(含无阈值币种 BTC、低于旧阈值金额、旧自报 VASP=false)', () => {
    // 阈值与对手方归因另走 mock TR 规则(只管挂不挂起),不再左右提交类型。
    // 用旧形态的富输入(宽类型变量,绕过字面量多余属性检查)证明多余字段不再有任何影响。
    const legacyShaped: Array<Record<string, unknown>> = [
      { assetType: 'CRYPTO' },
      { assetType: 'CRYPTO', currency: 'BTC', amount: 1e9, counterpartyIsVasp: true },
      { assetType: 'CRYPTO', currency: 'USDT', amount: 0.01, counterpartyIsVasp: false },
      { assetType: 'CRYPTO', currency: 'AED', amount: 1, counterpartyIsVasp: null },
    ];
    for (const input of legacyShaped) {
      expect(resolveKytTxnType(input as any)).toEqual({ type: 'travelRule', reason: 'TR_REQUIRED' });
    }
  });

  it('assetType 大小写不敏感', () => {
    expect(resolveKytTxnType({ assetType: 'crypto' })).toEqual({ type: 'travelRule', reason: 'TR_REQUIRED' });
    expect(resolveKytTxnType({ assetType: 'Crypto' })).toEqual({ type: 'travelRule', reason: 'TR_REQUIRED' });
    expect(resolveKytTxnType({ assetType: 'fiat' })).toEqual({ type: 'finance', reason: 'NOT_CRYPTO' });
  });
});

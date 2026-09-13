import { resolveKytTxnType } from './kyt-txn-type.resolver';

describe('resolveKytTxnType', () => {
  const vasp = { assetType: 'CRYPTO', currency: 'USDT', counterpartyIsVasp: true };

  it.each([
    // [说明, 输入, 期望 type, 期望 reason]
    ['法币直接短路',            { assetType: 'FIAT', currency: 'AED', amount: 99999, counterpartyIsVasp: true }, 'finance', 'NOT_CRYPTO'],
    ['非 VASP 对手方',          { ...vasp, counterpartyIsVasp: false, amount: 99999 },                            'finance', 'COUNTERPARTY_NOT_VASP'],
    ['VASP 未知(null)',        { ...vasp, counterpartyIsVasp: null, amount: 99999 },                             'finance', 'COUNTERPARTY_NOT_VASP'],
    ['低于阈值',                { ...vasp, amount: 999.99 },                                                      'finance', 'BELOW_TR_THRESHOLD'],
    ['正好等于阈值 → TR',       { ...vasp, amount: 1000 },                                                        'travelRule', 'TR_REQUIRED'],
    ['高于阈值 → TR',           { ...vasp, amount: 1000.01 },                                                     'travelRule', 'TR_REQUIRED'],
    ['AED 阈值 3500 边界',      { assetType: 'CRYPTO', currency: 'AED', counterpartyIsVasp: true, amount: 3500 }, 'travelRule', 'TR_REQUIRED'],
    ['AED 低于 3500',           { assetType: 'CRYPTO', currency: 'AED', counterpartyIsVasp: true, amount: 3499 }, 'finance', 'BELOW_TR_THRESHOLD'],
    ['币种未配阈值 → 兜底',      { assetType: 'CRYPTO', currency: 'BTC', counterpartyIsVasp: true, amount: 1e9 },  'finance', 'NO_TR_THRESHOLD_CONFIGURED'],
  ])('%s', (_label, input, expectedType, expectedReason) => {
    const out = resolveKytTxnType(input as any);
    expect(out.type).toBe(expectedType);
    expect(out.reason).toBe(expectedReason);
  });
});

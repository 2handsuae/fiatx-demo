// admin-web/src/pages/companyFundsFormat.spec.ts
// 战役乙波二 T8 brief Step 3：独立实现的最小单位→展示层换算函数必须自测，禁止复发
// LedgerAccountList.tsx 的已知 decimals 键不一致缺口（BACKLOG §M）。
import {
  buildAssetLookup,
  formatMinorToMajor,
  isBelowThresholdMinor,
} from './companyFundsFormat';

describe('companyFundsFormat', () => {
  describe('formatMinorToMajor', () => {
    // brief 点名样例：USDT decimals=6，113,600.000000 USDT 的最小单位表示。
    it('113600000000 分（USDT，decimals=6）→ 113,600.000000', () => {
      expect(formatMinorToMajor('113600000000', 6)).toBe('113,600.000000');
    });

    it('95000000 分（AED，decimals=2）→ 950,000.00', () => {
      expect(formatMinorToMajor('95000000', 2)).toBe('950,000.00');
    });

    it('负数最小单位保留负号', () => {
      expect(formatMinorToMajor('-500', 2)).toBe('-5.00');
    });

    it('null/undefined 回退为 0', () => {
      expect(formatMinorToMajor(null, 2)).toBe('0.00');
      expect(formatMinorToMajor(undefined, 2)).toBe('0.00');
    });

    it('decimals=0 不产生小数点', () => {
      expect(formatMinorToMajor('123456', 0)).toBe('123,456');
    });
  });

  describe('buildAssetLookup', () => {
    // 实测坐实（T8 Step 4）：SYSTEM 账户（F_OPS/F_LIQ/F_SET/收入格）在种子阶段用
    // asset.code（'USDT-TRON'）登记 tbAccountRegistry.assetCode，不是 asset.currency
    // （'USDT'）——账本行下发的 assetCode 因而可能是 code 或 currency 两种形态之一。
    const assets = [
      { currency: 'AED', code: 'AED', decimals: 2 },
      { currency: 'USDT', code: 'USDT-TRON', decimals: 6 },
    ];

    it('currencyOf 把资产 code 形态收敛成 currency', () => {
      const { currencyOf } = buildAssetLookup(assets);
      expect(currencyOf('USDT-TRON')).toBe('USDT');
      expect(currencyOf('AED')).toBe('AED');
    });

    it('currencyOf 对已经是 currency 形态的值原样放行', () => {
      const { currencyOf } = buildAssetLookup(assets);
      expect(currencyOf('USDT')).toBe('USDT');
    });

    it('decimalsOf 认账本行的 code 形态（USDT-TRON）——不复发 BACKLOG §M 放大万倍的键不对齐', () => {
      const { decimalsOf } = buildAssetLookup(assets);
      expect(decimalsOf('USDT-TRON')).toBe(6);
      expect(decimalsOf('USDT')).toBe(6);
      expect(decimalsOf('AED')).toBe(2);
    });

    it('未知币种回退 2 位小数（同既有页面既定回退口径）', () => {
      const { decimalsOf } = buildAssetLookup(assets);
      expect(decimalsOf('XYZ')).toBe(2);
    });
  });

  describe('isBelowThresholdMinor', () => {
    it('余额低于阈值 → true', () => {
      // 899,999.99 AED < 900,000 AED 阈值
      expect(isBelowThresholdMinor('89999999', 900_000, 2)).toBe(true);
    });

    it('余额高于阈值 → false（950,000 AED 基线 vs 900,000 AED 候选线）', () => {
      expect(isBelowThresholdMinor('95000000', 900_000, 2)).toBe(false);
    });

    it('余额恰等于阈值 → false（不低于，闸值本身算安全）', () => {
      expect(isBelowThresholdMinor('90000000', 900_000, 2)).toBe(false);
    });
  });
});

import { MaterialPolicyLoader } from './material-policy';
import { materialLabel } from './dto/material-request.dto';

/**
 * 读的是仓库真实的 config/material-refresh-policy.json（jest 在仓库根跑，cwd 解析与线上一致）。
 * 对手方波二 Task 4：注册表第 6 型 SOURCE_OWNERSHIP_CLAIM = 表单型（无 Sumsub level，带 formKind）。
 */
describe('MaterialPolicyLoader — 真实注册表', () => {
  const loader = new MaterialPolicyLoader();

  it('SOURCE_OWNERSHIP_CLAIM 登记为表单型：带 formKind，没有 sumsubActionLevelName', () => {
    const cfg = loader.getMaterialConfig('SOURCE_OWNERSHIP_CLAIM');
    expect(cfg).toEqual({ formKind: 'OWNERSHIP_CLAIM' });
  });

  it('原有 5 个 Sumsub 型各自仍挂 level、不带 formKind', () => {
    for (const type of ['EMIRATES_ID', 'LIVENESS', 'PROOF_OF_ADDRESS', 'SOURCE_OF_FUNDS', 'SOURCE_OF_WEALTH']) {
      const cfg = loader.getMaterialConfig(type);
      expect(cfg?.sumsubActionLevelName).toEqual(expect.stringMatching(/^wave3-action-/));
      expect(cfg?.formKind).toBeUndefined();
    }
  });

  it('未登记的型 → null（issue() 据此拒 UNKNOWN_MATERIAL_TYPE）', () => {
    expect(loader.getMaterialConfig('NOPE')).toBeNull();
  });

  it('标签表：第 6 型有人话标签（运营/客户都看这个，不看枚举键）', () => {
    expect(materialLabel('SOURCE_OWNERSHIP_CLAIM')).toBe('来源认领/申报');
    expect(materialLabel('PROOF_OF_ADDRESS')).toBe('Proof of Address');
  });
});

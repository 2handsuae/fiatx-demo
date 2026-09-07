import { ONBOARDING_LEVELS, ONBOARDING_LEVEL_TEMPLATES } from './onboarding-level.constant';

describe('申请人级 level 常量（波三 +PREMIUM）', () => {
  it('三档齐且值不漂（sumsubCurrentLevelName 的合法值域）', () => {
    expect(ONBOARDING_LEVELS).toEqual({
      CDD: 'basic-cdd-level', EDD: 'edd-sof-sow-level', PREMIUM: 'premium-tier-level',
    });
  });
  it('PREMIUM 模板 = 两个上传槽（PoA + SoF），零存储只是形状', () => {
    expect(ONBOARDING_LEVEL_TEMPLATES[ONBOARDING_LEVELS.PREMIUM]).toEqual({
      kind: 'TIER_UPGRADE_UPLOAD',
      uploadSlots: [
        { code: 'PROOF_OF_ADDRESS', label: 'Proof of Address (PoA)' },
        { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
      ],
    });
  });
});

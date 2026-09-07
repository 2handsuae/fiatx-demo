/**
 * 申请人级认证等级（Sumsub applicant level，波二只两档；与材料请求的
 * 动作级 sumsubActionLevelName 不是一回事——那个在 material-policy.ts）。
 * 命名照 Sumsub level 风格；值存 CustomerMain.sumsubCurrentLevelName。
 */
export const ONBOARDING_LEVELS = {
  CDD: 'basic-cdd-level',
  EDD: 'edd-sof-sow-level',
} as const;
export type OnboardingLevelName = (typeof ONBOARDING_LEVELS)[keyof typeof ONBOARDING_LEVELS];

export interface OnboardingLevelTemplate {
  kind: 'CDD_FORM' | 'EDD_UPLOAD';
  uploadSlots?: Array<{ code: 'SOURCE_OF_FUNDS' | 'SOURCE_OF_WEALTH'; label: string }>;
}

/** 客户端会话端点下发的模板描述符（模拟分支按它渲染我方模板，spec §6）。 */
export const ONBOARDING_LEVEL_TEMPLATES: Record<OnboardingLevelName, OnboardingLevelTemplate> = {
  [ONBOARDING_LEVELS.CDD]: { kind: 'CDD_FORM' },
  [ONBOARDING_LEVELS.EDD]: {
    kind: 'EDD_UPLOAD',
    uploadSlots: [
      { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
      { code: 'SOURCE_OF_WEALTH', label: 'Source of Wealth (SoW)' },
    ],
  },
};

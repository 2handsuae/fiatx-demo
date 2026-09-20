// 对账案件 2 态迁移表（波三判据 4 本体）。照 adjustment-transitions.constant.ts
// 先例——只登记现存边：OPEN → RESOLVED（自愈 autoHealCases 唯一路径）。
export const CaseStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;

export const CASE_TRANSITIONS: Record<string, string[]> = {
  [CaseStatus.OPEN]: [CaseStatus.RESOLVED],
  [CaseStatus.RESOLVED]: [],
};

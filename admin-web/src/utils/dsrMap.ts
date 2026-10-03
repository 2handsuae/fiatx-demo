// admin-web/src/utils/dsrMap.ts
// 战役丙波四 Task 6：DSR（资料请求）——类型 / 状态 / 结局码 / 摘要三块的展示人话。
// 唯一真相在后端 dsr.constants.ts，这里只是展示词（惯例同 complaintMap.ts：admin-web 不能
// 直接 import 后端 src，只能手抄同构）。

export const DSR_TYPES = ['ACCESS', 'RECTIFICATION', 'ERASURE'] as const;

export const DSR_TYPE_LABEL: Record<string, string> = {
  ACCESS: 'Access',
  RECTIFICATION: 'Rectification',
  ERASURE: 'Erasure',
};

/** 一句话讲清每型请求是什么（详情页 Request 卡与列表筛选提示用）。 */
export const DSR_TYPE_HINT: Record<string, string> = {
  ACCESS: 'Customer asks for a copy of the data we hold on them',
  RECTIFICATION: 'Customer asks us to correct data that is wrong',
  ERASURE: 'Customer asks us to delete the data we hold on them',
};

export const DSR_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'RESOLVED'] as const;

export const DSR_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
};

/** 三态终盘——只有 RESOLVED 零出边（镜像 dsr.constants.ts DSR_STATUS_TRANSITIONS）。 */
export const DSR_TERMINAL_STATUS = 'RESOLVED';

export const DSR_RESOLUTION_LABEL: Record<string, string> = {
  ACCESS_SUMMARY_PROVIDED: 'Data summary provided',
  RECTIFICATION_REVERIFY: 'Re-verify identity documents',
  RECTIFICATION_SELF_SERVICE: 'Point to self-service edit',
  ERASURE_REFUSED_RETENTION: 'Refused — retention required',
};

/** 四个结局只对对应类型有效（镜像 dsr.constants.ts DSR_RESOLUTION_BY_TYPE）。 */
export const DSR_RESOLUTION_BY_TYPE: Record<string, string[]> = {
  ACCESS: ['ACCESS_SUMMARY_PROVIDED'],
  RECTIFICATION: ['RECTIFICATION_REVERIFY', 'RECTIFICATION_SELF_SERVICE'],
  ERASURE: ['ERASURE_REFUSED_RETENTION'],
};

/** 结局码一行说明——Resolve 弹层里下拉选中后显示，让 DPO 知道选这个会发生什么。 */
export const DSR_RESOLUTION_HINT: Record<string, string> = {
  ACCESS_SUMMARY_PROVIDED: 'The customer sees the data summary generated for this request.',
  RECTIFICATION_REVERIFY: 'The customer is asked to re-submit their identity documents; the profile is corrected after that check.',
  RECTIFICATION_SELF_SERVICE: 'The customer is pointed to the profile page where they can edit the data themselves.',
  ERASURE_REFUSED_RETENTION: 'Deletion is refused because the data must be retained; the reply cites the retention clause of the customer agreement.',
};

/** 摘要「材料」块里 materialType / status 的展示（只是美化下划线，不另造词表）。 */
export const humanizeCode = (code: string): string => {
  const text = code.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** 摘要档案块的字段顺序与展示名（键集合镜像 dsr.constants.ts DSR_SUMMARY_PROFILE_FIELDS）。 */
export const DSR_SUMMARY_PROFILE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'customerNo', label: 'Customer No.' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'companyName', label: 'Company Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'dateOfBirth', label: 'Date of Birth' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'idDocType', label: 'ID Document Type' },
  { key: 'idDocNumber', label: 'ID Document No.' },
  { key: 'residentialAddress', label: 'Residential Address' },
  { key: 'tradingTier', label: 'Trading Tier' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'onboardingApprovedAt', label: 'Onboarding Approved At' },
];

export interface DsrClockLike {
  status: string;
  dueAt: string;
}

export interface DsrClock {
  deadlineAt: string;
  overdue: boolean;
}

/** 单钟：RESOLVED 无钟（终态零出边，钟已停），其余按 dueAt（提交时刻 +30 自然日）。 */
export function activeDsrClock(row: DsrClockLike): DsrClock | null {
  if (row.status === DSR_TERMINAL_STATUS) return null;
  return { deadlineAt: row.dueAt, overdue: new Date(row.dueAt).getTime() < Date.now() };
}

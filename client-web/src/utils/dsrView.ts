// client-web/src/utils/dsrView.ts
// 战役丙波四 T7：资料请求（DSR）客户面展示词与纯函数。
// 唯一真相在后端 dsr.constants.ts；client-web 不跨端 import，这里只放展示用的人话词表（惯例同
// complaintStatusView.ts）。tipping-off 红线（decisions:65）：后端投影不下发 dueAt，客户面只说"30 天内答复"，
// 所以本文件没有任何倒计时 / 截止日相关函数——也不该有。

import type { StatusBadgeView } from '../components/StatusBadge';

export type DsrType = 'ACCESS' | 'RECTIFICATION' | 'ERASURE';

export const DSR_TYPES: DsrType[] = ['ACCESS', 'RECTIFICATION', 'ERASURE'];

export const DSR_TYPE_OPTION: Record<DsrType, { label: string; hint: string; placeholder: string }> = {
  ACCESS: {
    label: 'Access my data',
    hint: 'Get a copy of the personal data we hold about you.',
    placeholder: 'e.g. I would like a copy of everything you hold about me.',
  },
  RECTIFICATION: {
    label: 'Correct my data',
    hint: 'Tell us what is wrong and we will help you fix it.',
    placeholder: 'e.g. My residential address is out of date — it should read …',
  },
  ERASURE: {
    label: 'Delete my data',
    hint: 'Ask us to erase your data. Some records must be kept by law, so we may not be able to delete everything.',
    placeholder: 'e.g. I no longer wish to use FIATX and would like my data deleted.',
  },
};

export const DSR_TYPE_LABEL: Record<string, string> = {
  ACCESS: 'Access request',
  RECTIFICATION: 'Correction request',
  ERASURE: 'Deletion request',
};

const STATUS_VIEW: Record<string, StatusBadgeView> = {
  SUBMITTED: { label: 'Submitted', tone: 'neutral' },
  IN_REVIEW: { label: 'In review', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'positive' },
};

export function getDsrStatusView(status: string): StatusBadgeView {
  return STATUS_VIEW[status] ?? { label: 'Processing', tone: 'neutral' };
}

/** 办结答复的一句话标题（对应后端四个结局码）；正文是 DPO 写的 resolutionNote。 */
export const DSR_OUTCOME_HEADLINE: Record<string, string> = {
  ACCESS_SUMMARY_PROVIDED: 'Your data summary is ready',
  RECTIFICATION_REVERIFY: 'We need you to re-verify your documents',
  RECTIFICATION_SELF_SERVICE: 'You can update this yourself',
  ERASURE_REFUSED_RETENTION: 'We are not able to delete this data yet',
};

/** 条款引用卡里的固定摘录：协议 §VI（Privacy & Data Protection）里的原句片段，不是 DPO 自由文本。 */
export const ERASURE_CLAUSE_EXCERPT = 'erasure (subject to retention obligations)';

/** 摘要「档案」块：键顺序与展示名（键集合镜像后端 DSR_SUMMARY_PROFILE_FIELDS）。 */
export const DSR_PROFILE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'customerNo', label: 'Member ID' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'companyName', label: 'Company name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'idDocType', label: 'ID document type' },
  { key: 'idDocNumber', label: 'ID document number' },
  { key: 'residentialAddress', label: 'Residential address' },
  { key: 'tradingTier', label: 'Account tier' },
  { key: 'lifecycle', label: 'Account status' },
  { key: 'onboardingApprovedAt', label: 'Approved on' },
];

const PROFILE_TIMESTAMP_KEYS = new Set(['onboardingApprovedAt']);

/** 下划线码转人话（EMIRATES_ID → Emirates id）；不另造词表。 */
export function humanizeCode(code: string): string {
  const text = code.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 档案块转展示行：按固定顺序；缺值显示"—"；只有真时间戳列走本地日期（纯日期串 dateOfBirth 原样，不过 Date）。 */
export function profileRows(profile: Record<string, string | null | undefined>): Array<{ label: string; value: string }> {
  return DSR_PROFILE_LABELS.map(({ key, label }) => {
    const raw = profile[key];
    if (raw === null || raw === undefined || raw === '') return { label, value: '—' };
    if (PROFILE_TIMESTAMP_KEYS.has(key)) return { label, value: new Date(raw).toLocaleDateString() };
    return { label, value: String(raw) };
  });
}

/** 协议同意历史的人话动作。 */
export const CONSENT_DECISION_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};

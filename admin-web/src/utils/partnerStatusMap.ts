// admin-web/src/utils/partnerStatusMap.ts
// 甲波六 T5：LP 与服务商两条线共用的「状态 / 词表 → 员工可见文案」映射。
// 员工可见处（含下拉选项）一律经这里取词，不得露出 PENDING_ASSESSMENT 之类内部枚举（R11）。
// 色板与 StatusPill 的 Tailwind 100/800 同源，保证列表 / 详情徽章一个观感。服务商线（T8）原样复用。

export interface PartnerStatusMeta {
  label: string;
  badgeClass: string;
}

export const PARTNER_STATUS_META: Record<string, PartnerStatusMeta> = {
  PENDING_ASSESSMENT: { label: 'Pending assessment', badgeClass: 'bg-blue-100 text-blue-800' },
  RETURNED: { label: 'Returned for documents', badgeClass: 'bg-orange-100 text-orange-800' },
  PENDING_APPROVAL: { label: 'Pending approval', badgeClass: 'bg-amber-100 text-amber-800' },
  PENDING_NOTIFICATION: { label: 'Pending VARA notification', badgeClass: 'bg-purple-100 text-purple-800' },
  ACTIVE: { label: 'Active', badgeClass: 'bg-green-100 text-green-800' },
  SUSPENDED: { label: 'Suspended', badgeClass: 'bg-gray-200 text-gray-800' },
  REJECTED: { label: 'Rejected', badgeClass: 'bg-red-100 text-red-800' },
  TERMINATED: { label: 'Terminated', badgeClass: 'bg-gray-200 text-gray-800' },
};

/** LP 线的六个状态（列表筛选下拉用，顺序即流程顺序）。 */
export const LP_STATUS_FILTER_ORDER = [
  'PENDING_ASSESSMENT',
  'RETURNED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
];

/** 词表里查不到时的兜底：把 SNAKE_CASE 转成句子大小写，保证员工看到的永远不是裸枚举。 */
export const humanizeCode = (code: string): string => {
  const text = code.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const partnerStatusMeta = (status: string | null | undefined): PartnerStatusMeta => {
  if (!status) return { label: '—', badgeClass: 'bg-gray-100 text-gray-800' };
  return PARTNER_STATUS_META[status] ?? { label: humanizeCode(status), badgeClass: 'bg-gray-100 text-gray-800' };
};

/** 通用取词：map 命中取词，否则人话化兜底。 */
export const labelOf = (map: Record<string, string>, code: string | null | undefined): string => {
  if (!code) return '—';
  return map[code] ?? humanizeCode(code);
};

// ── 文件类别 ────────────────────────────────────────────────────────

/** LP 六份尽调文件（键序即页面展示序）。 */
export const LP_DOC_TYPE_LABELS: Record<string, string> = {
  INCORPORATION_CERT: 'Certificate of incorporation',
  UBO_REGISTER: 'Shareholder / UBO register',
  LICENCE_COPY: 'Licence copy',
  AML_POLICY: 'AML policy or questionnaire',
  FINANCIALS: 'Latest financial statements',
  AUTHORISED_SIGNATORIES: 'Authorised signatories list',
};

/** 服务商九类材料（T8 用）。 */
export const VENDOR_DOC_TYPE_LABELS: Record<string, string> = {
  INCORPORATION_CERT: 'Certificate of incorporation',
  CONTRACT: 'Service contract',
  LICENCE_COPY: 'Licence copy',
  UBO_REGISTER: 'Shareholder / UBO register',
  FINANCIALS: 'Latest financial statements',
  SOC2_ISO_CERT: 'SOC 2 / ISO 27001 certificate',
  DR_PLAN: 'Disaster recovery plan',
  SUBCONTRACTOR_LIST: 'Subcontractor list',
  INSURANCE: 'Insurance policy',
};

/** 词表 → DocumentsCard 要的 `{ code, label }[]`。 */
export const docTypeOptions = (labels: Record<string, string>): { code: string; label: string }[] =>
  Object.entries(labels).map(([code, label]) => ({ code, label }));

// ── 尽调评估词表（两线共用）──────────────────────────────────────────

/** 联合国 / OFAC / 欧盟 / 阿联酋本地 / PEP / 负面新闻（键序即勾选框展示序）。 */
export const SCREENING_LIST_LABELS: Record<string, string> = {
  UN: 'UN',
  OFAC: 'OFAC',
  EU: 'EU',
  UAE_LOCAL: 'UAE local',
  PEP: 'PEP',
  ADVERSE_MEDIA: 'Adverse media',
};

export const RISK_TIER_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const SCREENING_RESULT_META: Record<string, { label: string; dotClass: string }> = {
  GREEN: { label: 'Green', dotClass: 'bg-adm-green' },
  YELLOW: { label: 'Yellow', dotClass: 'bg-adm-yellow' },
  RED: { label: 'Red', dotClass: 'bg-adm-red' },
};

export const SCREENING_SUBJECT_KIND_LABELS: Record<string, string> = {
  COMPANY: 'Company',
  BENEFICIAL_OWNER: 'Beneficial owner',
};

/** 合规官落下的结论（评估只存最新一轮）。 */
export const DD_CONCLUSION_LABELS: Record<string, string> = {
  RETURNED: 'Returned for documents',
  REJECTED: 'Rejected',
  SENT_FOR_APPROVAL: 'Sent for approval',
};

/** CISO 证书核验：有 / 无 / 过期。 */
export const INFOSEC_CERT_LABELS: Record<string, string> = {
  HAS: 'Held',
  NONE: 'None',
  EXPIRED: 'Expired',
};

export const INFOSEC_VERDICT_LABELS: Record<string, string> = {
  ACCEPTABLE: 'Acceptable',
  UNACCEPTABLE: 'Not acceptable',
};

// ── LP 申请表 ────────────────────────────────────────────────────────

/** 申请表「交易类型」多选项（键序即展示序）；码值与种子 / 后端存的 CSV 一致。 */
export const LP_TRADING_TYPE_LABELS: Record<string, string> = {
  SPOT_EXCHANGE: 'Spot exchange',
  OTC_BLOCK: 'OTC block trade',
};

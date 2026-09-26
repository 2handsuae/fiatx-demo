// admin-web/src/utils/regulatoryFilingMap.ts
// 战役甲波二 · 报送台骨架（Task 9）：报送单状态 / 类型 / 受文机构 / 往来记录 / 时限展示词表。
// 唯一真相在后端 regulatory-filing.constants.ts / filing-type-registry.ts，这里只是展示词
// （admin-web 不能直接 import 后端 src，同 incidentStatusMap.ts 头注释的既有分工——手抄同构）。
//
// reportDeadlineDisplay / reportBasisClockText / REPORT_DEADLINE_TONE_CLASS 三个 helper 从
// incidentStatusMap.ts 迁移到本文件（spec §9：截止时间与超时红标的可视面统一在报送台，事故
// 页不再展示——新「Regulatory filings」表格改读报送单自己的 deadlineAt/overdueMarkedAt）。
// reportBasisClockText 仍被 IncidentDetailPage 的定损 Assessment 卡片 report-basis 复选列表
// 引用（该 UI 按 brief 要求不动），只是换了 import 源。
import { INCIDENT_REPORT_BASES } from './incidentStatusMap';

/** spec §3 六态；status 下拉/筛选用。 */
export const FILING_STATUSES = [
  'DRAFT',
  'PENDING_SIGNOFF',
  'SIGNED_OFF',
  'SUBMITTED',
  'CLOSED',
  'CANCELLED',
] as const;

export const FILING_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_SIGNOFF: 'Pending sign-off',
  SIGNED_OFF: 'Signed off — to submit',
  SUBMITTED: 'Submitted',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** 往来记录类型（spec §1 RegulatoryFilingEntry.kind 受控枚举，Ruling-14：前端下拉受控）。 */
export const FILING_ENTRY_KINDS = ['RECEIPT_ACK', 'REGULATOR_INQUIRY', 'OUR_SUPPLEMENT'] as const;

export const FILING_ENTRY_KIND_LABEL: Record<string, string> = {
  RECEIPT_ACK: 'Receipt acknowledged',
  REGULATOR_INQUIRY: 'Regulator inquiry',
  OUR_SUPPLEMENT: 'Our supplement',
};

/** 受文机构目录（regulatory-filing.constants.ts 的 RegulatoryAuthorities + 同文件
 * REGULATORY_AUTHORITY_LABELS 镜像，label 文案逐字照抄）。 */
export const REGULATORY_AUTHORITIES = ['VARA', 'UAE_FIU', 'EOCN', 'UAE_DATA_OFFICE', 'CBUAE'] as const;

export const AUTHORITY_LABEL: Record<string, string> = {
  VARA: 'VARA (Dubai Virtual Assets Regulatory Authority)',
  UAE_FIU: 'UAE Financial Intelligence Unit',
  EOCN: 'Executive Office for Control & Non-Proliferation',
  UAE_DATA_OFFICE: 'UAE Data Office',
  CBUAE: 'Central Bank of the UAE',
};

export interface FilingTypeMirrorRow {
  label: string;
  direction: 'OUTBOUND' | 'INBOUND';
  requiresIncident: boolean;
  defaultAuthority: string | null;
}

/** 类型目录镜像（filing-type-registry.ts 的 FILING_TYPE_REGISTRY 首发五行，仅取前端渲染
 * 需要的四格：label / direction / requiresIncident / defaultAuthority——开单弹窗按这四格
 * 决定显隐哪些字段，见 spec §9 行为合同）。 */
export const FILING_TYPE_MIRROR: Record<string, FilingTypeMirrorRow> = {
  INCIDENT_REPORT: { label: 'Incident report to regulator', direction: 'OUTBOUND', requiresIncident: true, defaultAuthority: null },
  REG_INFO_REQUEST_RESPONSE: { label: 'Regulator information request — response', direction: 'INBOUND', requiresIncident: false, defaultAuthority: null },
  MATERIAL_CHANGE_NOTIFICATION: { label: 'Material change notification', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA' },
  AUDITOR_APPOINTMENT_NOTICE: { label: 'External auditor appointment notice', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA' },
  MARKET_OFFENCE_DUAL_REPORT: { label: 'Market offence dual-headed report', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA' },
};

export const FILING_TYPES = Object.keys(FILING_TYPE_MIRROR) as Array<keyof typeof FILING_TYPE_MIRROR>;

export const FILING_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(FILING_TYPE_MIRROR).map(([k, v]) => [k, v.label]),
);

/** 迁移自 incidentStatusMap.ts（字面同行为，仅换了落脚文件）：依据码钟三态文案——数字钟 /
 * 即时义务（无小时钟）/ 未载明时限。手工开单弹窗的 basisCode 下拉、事故详情页 Assessment
 * 卡片的 report-basis 复选列表都用它标注每个码的钟。 */
export function reportBasisClockText(code: string): string {
  const b = INCIDENT_REPORT_BASES[code];
  if (!b) return '';
  if (b.immediate) return 'Immediate obligation (no hour clock)';
  if (b.hours == null) return 'No statutory deadline stated';
  const base = `Report within ${b.hours}h`;
  return b.chainStart === 'NOTICE' ? `${base} (clock starts at first notice)` : base;
}

export type ReportDeadlineTone = 'none' | 'normal' | 'breached' | 'done';

export const REPORT_DEADLINE_TONE_CLASS: Record<ReportDeadlineTone, string> = {
  none: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-800',
  breached: 'bg-red-100 text-red-800',
  done: 'bg-green-100 text-green-800',
};

/**
 * 报送单截止时间展示——迁移自 incidentStatusMap.ts，签名按报送单自己的字段改写：
 * ① submittedAt 非空 → 已提交，done 调；
 * ② overdueMarkedAt 非空（sweep 落的持久软标）→ 直接判 Overdue，不再现算一遍——列表红行判据
 *    用它，不用活的倒计时（sweep 每 30s 跑一次，界面刷新前后结论必须一致，不能一个页面
 *    倒计时显示"还剩 3 分钟"、另一页面已经标红）；
 * ③ 无 deadlineAt 但 basisCode 命中 immediate 依据码 → 显式「Immediate」（不是「未设时限」，
 *    spec §1：immediate 码是没有小时钟的即时义务，跟"依据条款压根没有法定时限"是两回事）；
 * ④ 其余同原逻辑倒计时。
 */
export function reportDeadlineDisplay(
  deadlineAt: string | null,
  submittedAt: string | null,
  overdueMarkedAt: string | null,
  basisCode: string | null,
): { text: string; tone: ReportDeadlineTone } {
  if (submittedAt) return { text: 'Submitted', tone: 'done' };
  if (overdueMarkedAt) return { text: 'Overdue', tone: 'breached' };
  if (!deadlineAt) {
    if (basisCode && INCIDENT_REPORT_BASES[basisCode]?.immediate) return { text: 'Immediate', tone: 'normal' };
    return { text: 'No deadline set', tone: 'none' };
  }
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return { text: 'Overdue', tone: 'breached' };
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return { text: `${days}d ${hours}h`, tone: 'normal' };
  if (hours > 0) return { text: `${hours}h ${minutes}m`, tone: 'normal' };
  return { text: totalMinutes <= 0 ? '<1m' : `${minutes}m`, tone: 'normal' };
}

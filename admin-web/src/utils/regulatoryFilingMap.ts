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

/** 往来记录类型（spec §1 RegulatoryFilingEntry.kind 受控枚举，Ruling-14：前端下拉受控）。
 * 波三 T3/T5：后两种（CUSTOMER_COMM/AUTHORITY_INSTRUCTION）仅 AML 族可用、非终态可追加
 * （GENERAL 族继续只用前三种、仅 SUBMITTED 可追加）——详情页按 family 过滤可选项，见
 * RegulatoryFilingDetailPage.tsx availableEntryKinds()。 */
export const FILING_ENTRY_KINDS = ['RECEIPT_ACK', 'REGULATOR_INQUIRY', 'OUR_SUPPLEMENT'] as const;

/** 波三新增两种 kind，仅 AML 族——单独导出，不并入上面的 FILING_ENTRY_KINDS 常量
 * （那是 GENERAL 族既有下拉的既定顺序，两族选项集不同，混进一个数组会让 GENERAL
 * 页面也看到 AML 专属选项）。 */
export const AML_FILING_ENTRY_KINDS = ['CUSTOMER_COMM', 'AUTHORITY_INSTRUCTION'] as const;

export const FILING_ENTRY_KIND_LABEL: Record<string, string> = {
  RECEIPT_ACK: 'Receipt acknowledged',
  REGULATOR_INQUIRY: 'Regulator inquiry',
  OUR_SUPPLEMENT: 'Our supplement',
  // spec §5：客户沟通预审登记本——「MLRO 亲录预审」，两签不装作两人（详情页渲染时
  // 另外拼出「拟稿 X · 放行 Y」一行，这里的标签只当受控枚举的通用 tag 用）。
  CUSTOMER_COMM: 'Customer communication (tipping-off pre-clearance)',
  AUTHORITY_INSTRUCTION: 'Authority instruction (EOCN/FIU)',
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

/** 触发来源六桶（filing-type-registry.ts FilingOrigin 镜像，整备波 spec §2.1；顺序=弹窗 optgroup /
 * 来源筛选的显示顺序）。来源=法定触发事由，非操作路径（自动/手工是开单方式，与来源正交）。 */
export type FilingOrigin =
  | 'INCIDENT' | 'PERIODIC_OBLIGATION' | 'REGULATOR_REQUEST'
  | 'SANCTIONS_HIT' | 'AML_MONITORING' | 'SELF_DISCLOSURE';

export const FILING_ORIGINS: readonly FilingOrigin[] = [
  'INCIDENT', 'PERIODIC_OBLIGATION', 'REGULATOR_REQUEST', 'SANCTIONS_HIT', 'AML_MONITORING', 'SELF_DISCLOSURE',
];

/** 来源界面词（后端 filing-type-registry.ts 头注释的六个界面词）。 */
export const FILING_ORIGIN_LABEL: Record<FilingOrigin, string> = {
  INCIDENT: 'Incident-driven',
  PERIODIC_OBLIGATION: 'Periodic obligation',
  REGULATOR_REQUEST: 'Regulator request',
  SANCTIONS_HIT: 'Sanctions hit',
  AML_MONITORING: 'AML monitoring',
  SELF_DISCLOSURE: 'Company disclosure',
};

export interface FilingTypeMirrorRow {
  label: string;
  /** 整备波：触发来源（唯一，由 type 推导，不落库）——弹窗分组与列表来源筛选的依据。 */
  origin: FilingOrigin;
  direction: 'OUTBOUND' | 'INBOUND';
  requiresIncident: boolean;
  defaultAuthority: string | null;
  /** 波三 T1：服务层按族独占的判据镜像（filing-type-registry.ts FilingTypeConfig.family）——
   * 详情页按这一格决定送签链/往来记录 kind 集/结案动作怎么渲染（spec §3 点 2、§5）。
   * 首发五行全 GENERAL，波三六行全 AML。 */
  family: 'GENERAL' | 'AML';
  /** 仅该类型允许「决定不报」DRAFT→CLOSED 新边（T3 closeNoFiling，仅 STR/SAR true）。 */
  allowNoFilingClose?: boolean;
  /** 开单时 externalCaseRef 必填（Sumsub 案件引用 / EOCN 名单条目引用，仅
   * STR/SAR/CNMR/PNMR true）——手工开单弹窗按这一格决定要不要显示该输入框。 */
  requiresExternalCaseRef?: boolean;
}

/** 类型目录镜像（filing-type-registry.ts 的 FILING_TYPE_REGISTRY，仅取前端渲染需要的
 * 八格：label / origin / direction / requiresIncident / defaultAuthority / family /
 * allowNoFilingClose / requiresExternalCaseRef——开单弹窗与详情页按这几格决定显隐哪些
 * 字段/动作，见 spec §9 行为合同、波三 spec §3）。label 与后端逐字一致（整备波 Task 1 定稿：
 * AML 六型「缩写 — 全称」、HRCA 官方全称、INFO_REQUEST_RESPONSE 改名）。 */
export const FILING_TYPE_MIRROR: Record<string, FilingTypeMirrorRow> = {
  INCIDENT_REPORT: { label: 'Incident report to regulator', origin: 'INCIDENT', direction: 'OUTBOUND', requiresIncident: true, defaultAuthority: null, family: 'GENERAL' },
  INFO_REQUEST_RESPONSE: { label: 'Information request response', origin: 'REGULATOR_REQUEST', direction: 'INBOUND', requiresIncident: false, defaultAuthority: null, family: 'GENERAL' },
  MATERIAL_CHANGE_NOTIFICATION: { label: 'Material change notification', origin: 'SELF_DISCLOSURE', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA', family: 'GENERAL' },
  AUDITOR_APPOINTMENT_NOTICE: { label: 'External auditor appointment notice', origin: 'SELF_DISCLOSURE', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA', family: 'GENERAL' },
  MARKET_OFFENCE_DUAL_REPORT: { label: 'Market offence report (dual-filed)', origin: 'SELF_DISCLOSURE', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'VARA', family: 'GENERAL' },

  // --- 波三 AML 族六行（spec §1③⑤⑥、§3 点 1；照 filing-type-registry.ts 逐字镜像 label）。
  STR: { label: 'STR — Suspicious Transaction Report', origin: 'AML_MONITORING', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'UAE_FIU', family: 'AML', allowNoFilingClose: true, requiresExternalCaseRef: true },
  SAR: { label: 'SAR — Suspicious Activity Report', origin: 'AML_MONITORING', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'UAE_FIU', family: 'AML', allowNoFilingClose: true, requiresExternalCaseRef: true },
  CNMR: { label: 'CNMR — Confirmed Name Match Report', origin: 'SANCTIONS_HIT', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'EOCN', family: 'AML', requiresExternalCaseRef: true },
  PNMR: { label: 'PNMR — Partial Name Match Report', origin: 'SANCTIONS_HIT', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'EOCN', family: 'AML', requiresExternalCaseRef: true },
  HRC: { label: 'HRC — High Risk Country Transaction Report', origin: 'AML_MONITORING', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'UAE_FIU', family: 'AML' },
  HRCA: { label: 'HRCA — High Risk Country Activity Report', origin: 'AML_MONITORING', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: 'UAE_FIU', family: 'AML' },

  // --- 波四周期义务报送：系统到期自动开单（title=`<义务名> — due <日期>`）；手工补报走弹窗
  // PERIODIC_OBLIGATION 组（选义务行预填标题/机构，不带 obligationNo）。无默认机构，开单必选。
  PERIODIC_RETURN: { label: 'Periodic regulatory return', origin: 'PERIODIC_OBLIGATION', direction: 'OUTBOUND', requiresIncident: false, defaultAuthority: null, family: 'GENERAL' },
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

/** 依据码钟短文案（列表下钻括号里用，由 hours/immediate/chainStart 推导，口径同 reportBasisClockText）：
 * `72h` / `24h from first notice` / `immediate` / `no stated deadline`。 */
export function reportBasisClockBrief(code: string): string {
  const b = INCIDENT_REPORT_BASES[code];
  if (!b) return '';
  if (b.immediate) return 'immediate';
  if (b.hours == null) return 'no stated deadline';
  return b.chainStart === 'NOTICE' ? `${b.hours}h from first notice` : `${b.hours}h`;
}

/** 报送台列表 Type 列的容器型下钻（整备波 spec §2.4）：事故通报行 `Incident report — <材料名> (<钟>)`
 * （读 basisCode 的新名）；周期申报行 `Periodic return — <标题期别>`（标题自带义务名与期别，如
 * `… — due 2026-10-31`）；其余类型显示界面词。 */
export function filingTypeDisplay(type: string, basisCode: string | null, title: string): string {
  if (type === 'INCIDENT_REPORT' && basisCode && INCIDENT_REPORT_BASES[basisCode]) {
    return `Incident report — ${INCIDENT_REPORT_BASES[basisCode].label} (${reportBasisClockBrief(basisCode)})`;
  }
  if (type === 'PERIODIC_RETURN') return `Periodic return — ${title}`;
  return FILING_TYPE_LABEL[type] ?? type;
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

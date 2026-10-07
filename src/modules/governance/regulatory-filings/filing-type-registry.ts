// 战役甲波二 Task 1：报送类型注册表（spec §2 类型目录五行）。
// 战役甲波三 Task 1：族字段回填（GENERAL/AML）＋六行 AML 新类型（spec §1③⑤⑥、§3 点 1）。
// 整备波 Task 1：每行加 origin 来源列（六桶封闭，类型→唯一来源，不落库——可从 type 唯一推导）。
// **来源定义（写死）：来源=法定触发事由，非操作路径——自动/手工是开单方式，与来源正交。**
// 例：RI 换人自动开的重大变更告知单与合规官手工开的，同属 SELF_DISCLOSURE；归桶问"法律上为什么要报"，不问"谁点的开单"。
// 员工可见的第二层是"材料"：INCIDENT 桶下挂依据码、PERIODIC_OBLIGATION 桶下挂义务台账行，
// INCIDENT_REPORT / PERIODIC_RETURN 两个枚举只是幕后工作流路由键，不进任何员工可见的选择面。
// 本文件不 import regulatory-filing.constants.ts（防环，照 incident 两文件分工先例）。
// establishedBy 是注记级出处说明，不杜撰条款号——spec §2/§1 原话照抄。
import { BadRequestException } from '@nestjs/common';

/** 触发来源六桶（spec §2.1）。界面词：Incident-driven｜Periodic obligation｜Regulator request｜
 *  Sanctions hit｜AML monitoring｜Company disclosure。admin-web 镜像照抄这六值。 */
export type FilingOrigin =
  | 'INCIDENT' | 'PERIODIC_OBLIGATION' | 'REGULATOR_REQUEST'
  | 'SANCTIONS_HIT' | 'AML_MONITORING' | 'SELF_DISCLOSURE';

export interface FilingTypeConfig {
  direction: 'OUTBOUND' | 'INBOUND'; label: string; establishedBy: string;
  defaultAuthority: string | null; defaultCcAuthorities: readonly string[];
  defaultHours: number | null; requiresIncident: boolean; enabled: boolean;
  /** 触发来源（法定触发事由，非操作路径）——每类型恰有一个。 */
  origin: FilingOrigin;
  /** 服务层按族独占的判据（T3 接管迁移守卫）。 */
  family: 'GENERAL' | 'AML';
  /** 钟的起算点：BASIS=依据码事故创建时刻｜RECEIVED_AT=收件时刻（现状默认到当前时刻）｜
   *  EXTERNAL=编排方显式外传 anchorAt（CNMR/PNMR/PERIODIC_RETURN）｜NONE=无钟，不杜撰时限。 */
  anchorKind: 'BASIS' | 'RECEIVED_AT' | 'EXTERNAL' | 'NONE';
  /** 工作日钟（周一至五，UAE 联邦周末周六日）；与 defaultHours 互斥，两者不得同时设值。 */
  deadlineBusinessDays?: number;
  /** 仅该类型允许 DRAFT→CLOSED「决定不报」边（必填 noFilingReason，T3 落地）。 */
  allowNoFilingClose?: boolean;
  /** 开单时 externalCaseRef 必填（Sumsub 案件引用 / EOCN 名单条目引用）。 */
  requiresExternalCaseRef?: boolean;
}

export const FILING_TYPE_REGISTRY: Record<string, FilingTypeConfig> = {
  INCIDENT_REPORT: { direction: 'OUTBOUND', label: 'Incident report to regulator', establishedBy: 'Per basis code (INCIDENT_REPORT_BASES)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null, requiresIncident: true, enabled: true, family: 'GENERAL', anchorKind: 'BASIS', origin: 'INCIDENT' },
  INFO_REQUEST_RESPONSE: { direction: 'INBOUND', label: 'Information request response', establishedBy: 'Regulator information request (48h response duty)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: 48, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'RECEIVED_AT', origin: 'REGULATOR_REQUEST' },
  MATERIAL_CHANGE_NOTIFICATION: { direction: 'OUTBOUND', label: 'Material change notification', establishedBy: 'Company Rulebook — material change notification', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE', origin: 'SELF_DISCLOSURE' },
  AUDITOR_APPOINTMENT_NOTICE: { direction: 'OUTBOUND', label: 'External auditor appointment notice', establishedBy: 'Company Rulebook — auditor appointment notice', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE', origin: 'SELF_DISCLOSURE' },
  MARKET_OFFENCE_DUAL_REPORT: { direction: 'OUTBOUND', label: 'Market offence report (dual-filed)', establishedBy: 'Market Conduct Rulebook — dual-headed reporting', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE', origin: 'SELF_DISCLOSURE' },

  // --- 波三 AML 族六行（spec §1③⑤⑥、§3 点 1）：全 OUTBOUND、requiresIncident=false。
  // STR 锚交易单号、SAR 锚客户号——两者字段形状相同，差异只在开单时的叙事与填法（body/title），不另加列。
  STR: { direction: 'OUTBOUND', label: 'STR — Suspicious Transaction Report', establishedBy: 'FDL 20/2018 — suspicious transaction report, filed without delay on formed suspicion (no statutory deadline; not fabricated)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', allowNoFilingClose: true, requiresExternalCaseRef: true, origin: 'AML_MONITORING' },
  SAR: { direction: 'OUTBOUND', label: 'SAR — Suspicious Activity Report', establishedBy: 'FDL 20/2018 — suspicious activity report, no transaction anchor, filed without delay on formed suspicion (no statutory deadline; not fabricated)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', allowNoFilingClose: true, requiresExternalCaseRef: true, origin: 'AML_MONITORING' },
  CNMR: { direction: 'OUTBOUND', label: 'CNMR — Confirmed Name Match Report', establishedBy: 'EOCN TFS Guidelines 2025 — confirmed name match / funds freeze report (formerly FFR); 5 business days from freeze', defaultAuthority: 'EOCN', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'EXTERNAL', deadlineBusinessDays: 5, requiresExternalCaseRef: true, origin: 'SANCTIONS_HIT' },
  PNMR: { direction: 'OUTBOUND', label: 'PNMR — Partial Name Match Report', establishedBy: 'EOCN TFS Guidelines 2025 — partial name match / transaction suspension report; 5 business days from suspension (10-business-day evidence window runs in parallel, not a filing deadline)', defaultAuthority: 'EOCN', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'EXTERNAL', deadlineBusinessDays: 5, requiresExternalCaseRef: true, origin: 'SANCTIONS_HIT' },
  // 报后 3 工作日 FIU 不反对方可执行——交易 HOLD 边移交三域细化，本台账只记报了没有，不建钟。
  HRC: { direction: 'OUTBOUND', label: 'HRC — High Risk Country Transaction Report', establishedBy: 'UAE FIU goAML — high-risk country/transaction report (post-filing 3 business-day FIU non-objection hold governs the transaction HOLD edge, tracked outside this ledger)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', origin: 'AML_MONITORING' },
  // 整备波订正（spec §6）：HRCA＝活动型（非交易），与 HRC 的交易型二分、平行于 STR/SAR——
  // 不是"交易属性不全时的替代报文"。官方定义见 UAE FIU goAML Web Submission Guide v2.2 p5（术语表 p2、目录 p3）；
  // 3 工作日不反对窗同 HRC。
  HRCA: { direction: 'OUTBOUND', label: 'HRCA — High Risk Country Activity Report', establishedBy: 'UAE FIU goAML Web Submission Guide v2.2 (p5) — High Risk Country Activity Report: activity-based (non-transaction) report, the activity-type counterpart to the transaction-type HRC (same post-filing 3 business-day FIU non-objection hold)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', origin: 'AML_MONITORING' },

  // --- 波四 Task 1：合规办公室周期义务报送（spec §3.1/§4.1/§4.2）。锚=义务下一到期日
  // （编排方外传 anchorAt），0 工作日=期末即截止（无宽限期，不杜撰宽限天数）。
  PERIODIC_RETURN: { direction: 'OUTBOUND', label: 'Periodic regulatory return',
    establishedBy: 'Per obligation registry (compliance_obligations.basisNote)',
    defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null,
    requiresIncident: false, enabled: true, family: 'GENERAL', origin: 'PERIODIC_OBLIGATION',
    anchorKind: 'EXTERNAL', deadlineBusinessDays: 0 },
};

export function getFilingTypeConfig(type: string): FilingTypeConfig {
  const c = FILING_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown filing type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Filing type ${type} is disabled (reserved for a later wave)`);
  return c;
}

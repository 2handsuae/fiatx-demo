// 战役甲波二 Task 1：报送类型注册表（spec §2 类型目录五行）。
// 战役甲波三 Task 1：族字段回填（GENERAL/AML）＋六行 AML 新类型（spec §1③⑤⑥、§3 点 1）。
// 本文件不 import regulatory-filing.constants.ts（防环，照 incident 两文件分工先例）。
// establishedBy 是注记级出处说明，不杜撰条款号——spec §2/§1 原话照抄。
import { BadRequestException } from '@nestjs/common';

export interface FilingTypeConfig {
  direction: 'OUTBOUND' | 'INBOUND'; label: string; establishedBy: string;
  defaultAuthority: string | null; defaultCcAuthorities: readonly string[];
  defaultHours: number | null; requiresIncident: boolean; enabled: boolean;
  /** 服务层按族独占的判据（T3 接管迁移守卫）。 */
  family: 'GENERAL' | 'AML';
  /** 钟的起算点：BASIS=依据码事故创建时刻｜RECEIVED_AT=收件时刻（现状默认到当前时刻）｜
   *  EXTERNAL=workflow 外传 anchorAt（如制裁便签 openedAt）｜NONE=无钟，不杜撰时限。 */
  anchorKind: 'BASIS' | 'RECEIVED_AT' | 'EXTERNAL' | 'NONE';
  /** 工作日钟（周一至五，UAE 联邦周末周六日）；与 defaultHours 互斥，两者不得同时设值。 */
  deadlineBusinessDays?: number;
  /** 仅该类型允许 DRAFT→CLOSED「决定不报」边（必填 noFilingReason，T3 落地）。 */
  allowNoFilingClose?: boolean;
  /** 开单时 externalCaseRef 必填（Sumsub 案件引用 / EOCN 名单条目引用）。 */
  requiresExternalCaseRef?: boolean;
}

export const FILING_TYPE_REGISTRY: Record<string, FilingTypeConfig> = {
  INCIDENT_REPORT: { direction: 'OUTBOUND', label: 'Incident report to regulator', establishedBy: 'Per basis code (INCIDENT_REPORT_BASES)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null, requiresIncident: true, enabled: true, family: 'GENERAL', anchorKind: 'BASIS' },
  REG_INFO_REQUEST_RESPONSE: { direction: 'INBOUND', label: 'Regulator information request — response', establishedBy: 'Regulator information request (48h response duty)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: 48, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'RECEIVED_AT' },
  MATERIAL_CHANGE_NOTIFICATION: { direction: 'OUTBOUND', label: 'Material change notification', establishedBy: 'Company Rulebook — material change notification', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE' },
  AUDITOR_APPOINTMENT_NOTICE: { direction: 'OUTBOUND', label: 'External auditor appointment notice', establishedBy: 'Company Rulebook — auditor appointment notice', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE' },
  MARKET_OFFENCE_DUAL_REPORT: { direction: 'OUTBOUND', label: 'Market offence dual-headed report', establishedBy: 'Market Conduct Rulebook — dual-headed reporting', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'GENERAL', anchorKind: 'NONE' },

  // --- 波三 AML 族六行（spec §1③⑤⑥、§3 点 1）：全 OUTBOUND、requiresIncident=false。
  // STR 锚交易单号、SAR 锚客户号——两者字段形状相同，差异只在开单时的叙事与填法（body/title），不另加列。
  STR: { direction: 'OUTBOUND', label: 'Suspicious Transaction Report (STR)', establishedBy: 'FDL 20/2018 — suspicious transaction report, filed without delay on formed suspicion (no statutory deadline; not fabricated)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', allowNoFilingClose: true, requiresExternalCaseRef: true },
  SAR: { direction: 'OUTBOUND', label: 'Suspicious Activity Report (SAR)', establishedBy: 'FDL 20/2018 — suspicious activity report, no transaction anchor, filed without delay on formed suspicion (no statutory deadline; not fabricated)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE', allowNoFilingClose: true, requiresExternalCaseRef: true },
  CNMR: { direction: 'OUTBOUND', label: 'Confirmed Name Match Report (CNMR)', establishedBy: 'EOCN TFS Guidelines 2025 — confirmed name match / funds freeze report (formerly FFR); 5 business days from freeze', defaultAuthority: 'EOCN', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'EXTERNAL', deadlineBusinessDays: 5, requiresExternalCaseRef: true },
  PNMR: { direction: 'OUTBOUND', label: 'Partial Name Match Report (PNMR)', establishedBy: 'EOCN TFS Guidelines 2025 — partial name match / transaction suspension report; 5 business days from suspension (10-business-day evidence window runs in parallel, not a filing deadline)', defaultAuthority: 'EOCN', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'EXTERNAL', deadlineBusinessDays: 5, requiresExternalCaseRef: true },
  // 报后 3 工作日 FIU 不反对方可执行——交易 HOLD 边移交三域细化，本台账只记报了没有，不建钟。
  HRC: { direction: 'OUTBOUND', label: 'High-Risk Country/Transaction Report (HRC)', establishedBy: 'UAE FIU goAML — high-risk country/transaction report (post-filing 3 business-day FIU non-objection hold governs the transaction HOLD edge, tracked outside this ledger)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE' },
  HRCA: { direction: 'OUTBOUND', label: 'High-Risk Country/Transaction Report — Alternative (HRCA)', establishedBy: 'UAE FIU goAML — alternative filing when transaction attributes are incomplete (same post-filing 3 business-day FIU non-objection hold)', defaultAuthority: 'UAE_FIU', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true, family: 'AML', anchorKind: 'NONE' },
};

export function getFilingTypeConfig(type: string): FilingTypeConfig {
  const c = FILING_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown filing type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Filing type ${type} is disabled (reserved for a later wave)`);
  return c;
}

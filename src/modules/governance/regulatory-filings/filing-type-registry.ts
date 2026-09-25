// 战役甲波二 Task 1：报送类型注册表（spec §2 类型目录五行）。
// 本文件不 import regulatory-filing.constants.ts（防环，照 incident 两文件分工先例）。
// establishedBy 是注记级出处说明，不杜撰条款号——spec §2 原话照抄。
import { BadRequestException } from '@nestjs/common';

export interface FilingTypeConfig {
  direction: 'OUTBOUND' | 'INBOUND'; label: string; establishedBy: string;
  defaultAuthority: string | null; defaultCcAuthorities: readonly string[];
  defaultHours: number | null; requiresIncident: boolean; enabled: boolean;
}

export const FILING_TYPE_REGISTRY: Record<string, FilingTypeConfig> = {
  INCIDENT_REPORT: { direction: 'OUTBOUND', label: 'Incident report to regulator', establishedBy: 'Per basis code (INCIDENT_REPORT_BASES)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null, requiresIncident: true, enabled: true },
  REG_INFO_REQUEST_RESPONSE: { direction: 'INBOUND', label: 'Regulator information request — response', establishedBy: 'Regulator information request (48h response duty)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: 48, requiresIncident: false, enabled: true },
  MATERIAL_CHANGE_NOTIFICATION: { direction: 'OUTBOUND', label: 'Material change notification', establishedBy: 'Company Rulebook — material change notification', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
  AUDITOR_APPOINTMENT_NOTICE: { direction: 'OUTBOUND', label: 'External auditor appointment notice', establishedBy: 'Company Rulebook — auditor appointment notice', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
  MARKET_OFFENCE_DUAL_REPORT: { direction: 'OUTBOUND', label: 'Market offence dual-headed report', establishedBy: 'Market Conduct Rulebook — dual-headed reporting', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
};

export function getFilingTypeConfig(type: string): FilingTypeConfig {
  const c = FILING_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown filing type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Filing type ${type} is disabled (reserved for a later wave)`);
  return c;
}

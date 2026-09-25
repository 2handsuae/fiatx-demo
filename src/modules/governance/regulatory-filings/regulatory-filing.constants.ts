// 战役甲波二 · 报送台骨架（spec §3/§4/§5）：主体 RegulatoryFiling 的状态、显式迁移表、
// 往来记录类型、监管机构目录、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖。

export const FilingStatus = {
  DRAFT: 'DRAFT', PENDING_SIGNOFF: 'PENDING_SIGNOFF', SIGNED_OFF: 'SIGNED_OFF',
  SUBMITTED: 'SUBMITTED', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED',
} as const;

/** spec §3 六态六边；终态零出边。 */
export const FILING_TRANSITIONS: Record<string, readonly string[]> = {
  [FilingStatus.DRAFT]: [FilingStatus.PENDING_SIGNOFF, FilingStatus.CANCELLED],
  [FilingStatus.PENDING_SIGNOFF]: [FilingStatus.SIGNED_OFF, FilingStatus.DRAFT],
  [FilingStatus.SIGNED_OFF]: [FilingStatus.SUBMITTED],
  [FilingStatus.SUBMITTED]: [FilingStatus.CLOSED],
  [FilingStatus.CLOSED]: [], [FilingStatus.CANCELLED]: [],
};

export const FilingDirections = { OUTBOUND: 'OUTBOUND', INBOUND: 'INBOUND' } as const;
export const FilingEntryKinds = { RECEIPT_ACK: 'RECEIPT_ACK', REGULATOR_INQUIRY: 'REGULATOR_INQUIRY', OUR_SUPPLEMENT: 'OUR_SUPPLEMENT' } as const;
export const RegulatoryAuthorities = { VARA: 'VARA', UAE_FIU: 'UAE_FIU', EOCN: 'EOCN', UAE_DATA_OFFICE: 'UAE_DATA_OFFICE', CBUAE: 'CBUAE' } as const;
export const REGULATORY_AUTHORITY_LABELS: Record<string, string> = {
  VARA: 'VARA (Dubai Virtual Assets Regulatory Authority)', UAE_FIU: 'UAE Financial Intelligence Unit',
  EOCN: 'Executive Office for Control & Non-Proliferation', UAE_DATA_OFFICE: 'UAE Data Office',
  CBUAE: 'Central Bank of the UAE',
};

export interface OpenFilingDto { type: string; authority?: string; ccAuthorities?: string[]; incidentNo?: string; basisCode?: string; title?: string; receivedAt?: string; }
export interface FilingEntryDto { kind: string; body: string; externalRef?: string; }
export interface MarkFilingSubmittedDto { externalRef: string; }

// 战役甲波二 · 报送台骨架（spec §3/§4/§5）：主体 RegulatoryFiling 的状态、显式迁移表、
// 往来记录类型、监管机构目录、方法入参形状。
// 战役甲波三 Task 1：迁移表按族拆分（spec §3 点 2）＋两种新往来记录 kind（spec §5）。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖。

export const FilingStatus = {
  DRAFT: 'DRAFT', PENDING_SIGNOFF: 'PENDING_SIGNOFF', SIGNED_OFF: 'SIGNED_OFF',
  SUBMITTED: 'SUBMITTED', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED',
} as const;

/** spec §3 点 2：族内合法边集，显式迁移表按 family 分列（铁律④）。
 *  GENERAL＝波二六态六边原样；AML＝仅四边（不经过 PENDING_SIGNOFF/SIGNED_OFF 两态，
 *  送签即非法跃迁显式拒），终态零出边。两族键集同覆盖 FilingStatus 六态，便于穷举断言。 */
export const FILING_TRANSITIONS_BY_FAMILY: Record<'GENERAL' | 'AML', Record<string, readonly string[]>> = {
  GENERAL: {
    [FilingStatus.DRAFT]: [FilingStatus.PENDING_SIGNOFF, FilingStatus.CANCELLED],
    [FilingStatus.PENDING_SIGNOFF]: [FilingStatus.SIGNED_OFF, FilingStatus.DRAFT],
    [FilingStatus.SIGNED_OFF]: [FilingStatus.SUBMITTED],
    [FilingStatus.SUBMITTED]: [FilingStatus.CLOSED],
    [FilingStatus.CLOSED]: [], [FilingStatus.CANCELLED]: [],
  },
  AML: {
    [FilingStatus.DRAFT]: [FilingStatus.SUBMITTED, FilingStatus.CLOSED, FilingStatus.CANCELLED],
    [FilingStatus.PENDING_SIGNOFF]: [], [FilingStatus.SIGNED_OFF]: [],
    [FilingStatus.SUBMITTED]: [FilingStatus.CLOSED],
    [FilingStatus.CLOSED]: [], [FilingStatus.CANCELLED]: [],
  },
};

/** 既有导出保留为 GENERAL 表的别名引用——服务层迁移守卫本任务不改（T3 才接管按族读表），
 *  这样闸①逐任务保持绿；这是任务分期，不是兼容层（族拆分已在 FILING_TRANSITIONS_BY_FAMILY 落地）。 */
export const FILING_TRANSITIONS: Record<string, readonly string[]> = FILING_TRANSITIONS_BY_FAMILY.GENERAL;

export const FilingDirections = { OUTBOUND: 'OUTBOUND', INBOUND: 'INBOUND' } as const;
export const FilingEntryKinds = {
  RECEIPT_ACK: 'RECEIPT_ACK', REGULATOR_INQUIRY: 'REGULATOR_INQUIRY', OUR_SUPPLEMENT: 'OUR_SUPPLEMENT',
  /** spec §5：tipping-off 登记本，均仅 AML 族、非终态可追加。 */
  CUSTOMER_COMM: 'CUSTOMER_COMM', AUTHORITY_INSTRUCTION: 'AUTHORITY_INSTRUCTION',
} as const;
export const RegulatoryAuthorities = { VARA: 'VARA', UAE_FIU: 'UAE_FIU', EOCN: 'EOCN', UAE_DATA_OFFICE: 'UAE_DATA_OFFICE', CBUAE: 'CBUAE' } as const;
export const REGULATORY_AUTHORITY_LABELS: Record<string, string> = {
  VARA: 'VARA (Dubai Virtual Assets Regulatory Authority)', UAE_FIU: 'UAE Financial Intelligence Unit',
  EOCN: 'Executive Office for Control & Non-Proliferation', UAE_DATA_OFFICE: 'UAE Data Office',
  CBUAE: 'Central Bank of the UAE',
};

export interface OpenFilingDto { type: string; authority?: string; ccAuthorities?: string[]; incidentNo?: string; basisCode?: string; title?: string; receivedAt?: string; }
export interface FilingEntryDto { kind: string; body: string; externalRef?: string; }
export interface MarkFilingSubmittedDto { externalRef: string; }

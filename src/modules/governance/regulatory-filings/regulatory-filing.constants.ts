// 战役甲波二 · 报送台骨架（spec §3/§4/§5）：主体 RegulatoryFiling 的状态、显式迁移表、
// 往来记录类型、监管机构目录、方法入参形状。
// 战役甲波三 Task 1：迁移表按族拆分（spec §3 点 2）＋两种新往来记录 kind（spec §5）。
// 战役甲波三 Task 3：GENERAL 表别名导出 FILING_TRANSITIONS 已删（迁移守卫改读
// FILING_TRANSITIONS_BY_FAMILY，见 regulatory-filing.service.ts）——留着就是兼容层，
// 有人拿它判 AML 单会按 GENERAL 放行（T1 评审白3）。
// 战役甲波三 Task 5（spec §5）：addEntry 分 kind 规则表 FILING_ENTRY_KIND_RULES——五种
// kind 的「哪族能用／态限」显式列成表，服务层按表查、不写散 if（旧三 kind 两族皆可、
// 仅 SUBMITTED；新两 kind 仅 AML 族、非终态皆可）。
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

/** T3：服务层按族独占的能力码（cap.filing.*，照 incidents 的 cap.incident.* 先例，
 *  Ruling-6）——路由 OR 两组（REG_FILING_WRITE/REG_FILING_AML_WRITE）只是粗门，这里才是
 *  真把关：合规官只推得动 GENERAL 族、MLRO 只推得动 AML 族，跨族一律 403。rbac.catalog.ts
 *  的标记码登记与分组绑定随 T6（不在本任务改动范围，本任务只把判据钉死在服务层）。 */
export const FILING_FAMILY_CAPABILITY_CODE: Record<'GENERAL' | 'AML', string> = {
  GENERAL: 'cap.filing.general',
  AML: 'cap.filing.aml',
};

export const FilingDirections = { OUTBOUND: 'OUTBOUND', INBOUND: 'INBOUND' } as const;
export const FilingEntryKinds = {
  RECEIPT_ACK: 'RECEIPT_ACK', REGULATOR_INQUIRY: 'REGULATOR_INQUIRY', OUR_SUPPLEMENT: 'OUR_SUPPLEMENT',
  /** spec §5：tipping-off 登记本，均仅 AML 族、非终态可追加。 */
  CUSTOMER_COMM: 'CUSTOMER_COMM', AUTHORITY_INSTRUCTION: 'AUTHORITY_INSTRUCTION',
} as const;

/** 两族共同的终态集合（两族的 FILING_TRANSITIONS_BY_FAMILY 里 CLOSED/CANCELLED 都是零
 *  出边，见上表与 filing-type-registry.spec.ts「两族终态零出边」断言）——addEntry 的
 *  NON_TERMINAL 态限规则据此判。 */
export const FILING_TERMINAL_STATUSES: readonly string[] = [FilingStatus.CLOSED, FilingStatus.CANCELLED];

/** 战役甲波四 T5（spec §2）：闹钟墙在墙状态集——deadlineAt 生效中的三态。三处消费者共用
 *  同一份常量，不各自另起字面量（找齐同款，纪律五）：clock-wall 聚合的 FILING 行集判据、
 *  simulate-deadline-timeout 的"仅墙上状态可拨"判据、既有 sweep 的扫描状态集
 *  （regulatory-filing-sweep.service.ts，本次未改，逐字对齐）。 */
export const FILING_CLOCK_WALL_STATUSES: readonly string[] = [
  FilingStatus.DRAFT, FilingStatus.PENDING_SIGNOFF, FilingStatus.SIGNED_OFF,
];

/** spec §5：addEntry 分 kind 规则表——显式列出「哪些族能打这个 kind／态限是什么／要不要
 *  commDraftedBy」，服务层按表查（T5，替代散 if）。
 *  - 旧三 kind（RECEIPT_ACK/REGULATOR_INQUIRY/OUR_SUPPLEMENT）：两族皆可、仅 SUBMITTED
 *    可追加（行为原样——AML 单的 goAML 回执就靠 RECEIPT_ACK）。
 *  - 新两 kind（CUSTOMER_COMM/AUTHORITY_INSTRUCTION）：仅 AML 族；GENERAL 族监管指令维持
 *    既有 REGULATOR_INQUIRY（评审白项定口径，见 spec §5）；非终态（DRAFT/PENDING_SIGNOFF/
 *    SIGNED_OFF/SUBMITTED）均可追加，CLOSED/CANCELLED 拒。
 *  - CUSTOMER_COMM 必填 commDraftedBy（自由文本拟稿人，MLRO 代录；放行人＝
 *    recordedByUserId＝actor，即 MLRO 本人——「MLRO 亲录预审」两签不装两人）；其余四种
 *    kind 一律不许带 commDraftedBy，显式拒绝，防字段串味到不该有它的往来记录上。 */
export type FilingEntryStateRule = 'SUBMITTED_ONLY' | 'NON_TERMINAL';
export interface FilingEntryKindRule {
  families: readonly ('GENERAL' | 'AML')[];
  stateRule: FilingEntryStateRule;
  requiresCommDraftedBy: boolean;
}
export const FILING_ENTRY_KIND_RULES: Record<string, FilingEntryKindRule> = {
  [FilingEntryKinds.RECEIPT_ACK]: { families: ['GENERAL', 'AML'], stateRule: 'SUBMITTED_ONLY', requiresCommDraftedBy: false },
  [FilingEntryKinds.REGULATOR_INQUIRY]: { families: ['GENERAL', 'AML'], stateRule: 'SUBMITTED_ONLY', requiresCommDraftedBy: false },
  [FilingEntryKinds.OUR_SUPPLEMENT]: { families: ['GENERAL', 'AML'], stateRule: 'SUBMITTED_ONLY', requiresCommDraftedBy: false },
  [FilingEntryKinds.CUSTOMER_COMM]: { families: ['AML'], stateRule: 'NON_TERMINAL', requiresCommDraftedBy: true },
  [FilingEntryKinds.AUTHORITY_INSTRUCTION]: { families: ['AML'], stateRule: 'NON_TERMINAL', requiresCommDraftedBy: false },
};
export const RegulatoryAuthorities = { VARA: 'VARA', UAE_FIU: 'UAE_FIU', EOCN: 'EOCN', UAE_DATA_OFFICE: 'UAE_DATA_OFFICE', CBUAE: 'CBUAE' } as const;
export const REGULATORY_AUTHORITY_LABELS: Record<string, string> = {
  VARA: 'VARA (Dubai Virtual Assets Regulatory Authority)', UAE_FIU: 'UAE Financial Intelligence Unit',
  EOCN: 'Executive Office for Control & Non-Proliferation', UAE_DATA_OFFICE: 'UAE Data Office',
  CBUAE: 'Central Bank of the UAE',
};

export interface OpenFilingDto { type: string; authority?: string; ccAuthorities?: string[]; incidentNo?: string; basisCode?: string; title?: string; receivedAt?: string; externalCaseRef?: string; }
export interface FilingEntryDto { kind: string; body: string; externalRef?: string; commDraftedBy?: string; }
export interface MarkFilingSubmittedDto { externalRef: string; }

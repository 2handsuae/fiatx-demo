// 战役甲波五 T2 · 投诉主体（spec §2.2 Market Conduct III.A）：状态、类别、结论枚举、显式
// 迁移表、双钟期限常量、方法入参形状。本文件只放常量与纯类型——不含任何 Prisma /
// NestJS 依赖（同 incident.constants.ts / regulatory-filing.constants.ts 先例）。

/** 六态（spec 六裁定）。 */
export const ComplaintStatus = {
  RECEIVED: 'RECEIVED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  INVESTIGATING: 'INVESTIGATING',
  INVESTIGATING_EXTENDED: 'INVESTIGATING_EXTENDED',
  RESOLUTION_PENDING: 'RESOLUTION_PENDING',
  RESOLVED: 'RESOLVED',
} as const;

/**
 * 显式迁移表（铁律④，task-2-brief.md 原文逐字）：状态 → 允许直达的下一状态集合。
 * RESOLUTION_PENDING 的两条回退边（→INVESTIGATING / →INVESTIGATING_EXTENDED）供
 * rejectResolution 按 extendedAt 有无二选一走；RESOLVED 终态零出边。
 */
export const COMPLAINT_TRANSITIONS: Record<string, readonly string[]> = {
  [ComplaintStatus.RECEIVED]: [ComplaintStatus.ACKNOWLEDGED],
  [ComplaintStatus.ACKNOWLEDGED]: [ComplaintStatus.INVESTIGATING],
  [ComplaintStatus.INVESTIGATING]: [ComplaintStatus.INVESTIGATING_EXTENDED, ComplaintStatus.RESOLUTION_PENDING],
  [ComplaintStatus.INVESTIGATING_EXTENDED]: [ComplaintStatus.RESOLUTION_PENDING],
  [ComplaintStatus.RESOLUTION_PENDING]: [ComplaintStatus.RESOLVED, ComplaintStatus.INVESTIGATING, ComplaintStatus.INVESTIGATING_EXTENDED],
  [ComplaintStatus.RESOLVED]: [],
};

/** 终态集合（addNote/simulateTimeout 的非终态守卫用）——只有 RESOLVED 零出边。 */
export const COMPLAINT_TERMINAL_STATUSES: readonly string[] = [ComplaintStatus.RESOLVED];

/** 两调查态（markEscalated 守卫用）。 */
export const COMPLAINT_INVESTIGATING_STATUSES: readonly string[] = [
  ComplaintStatus.INVESTIGATING,
  ComplaintStatus.INVESTIGATING_EXTENDED,
];

/** 双钟期限常量（task-2-brief.md 原文逐字，条款引自 Market Conduct Module III.A.1）。 */
export const ACK_DEADLINE_DAYS = 7; // MC III.A.1.a
export const RESOLVE_DEADLINE_DAYS = 28; // MC III.A.1.b
export const EXTENDED_DEADLINE_DAYS = 56; // MC III.A.1.b.ii

/** 投诉类别（Complaint.category 列，schema 注释原样收窄）。 */
export const ComplaintCategories = {
  SERVICE: 'SERVICE',
  FEES: 'FEES',
  ORDER_EXECUTION: 'ORDER_EXECUTION',
  FROZEN_FUNDS_APPEAL: 'FROZEN_FUNDS_APPEAL',
  OTHER: 'OTHER',
} as const;
export type ComplaintCategory = (typeof ComplaintCategories)[keyof typeof ComplaintCategories];

/** 处置结论（Complaint.resolutionOutcome 列，schema 注释原样收窄）。 */
export const ComplaintResolutionOutcomes = {
  UPHELD: 'UPHELD',
  PARTIALLY_UPHELD: 'PARTIALLY_UPHELD',
  REJECTED: 'REJECTED',
} as const;
export type ComplaintResolutionOutcome = (typeof ComplaintResolutionOutcomes)[keyof typeof ComplaintResolutionOutcomes];

/** 往来记录类型（ComplaintEntry.kind 列）。 */
export const ComplaintEntryKinds = {
  INTERNAL_NOTE: 'INTERNAL_NOTE',
  CLIENT_MESSAGE: 'CLIENT_MESSAGE',
} as const;

/** CLIENT_MESSAGE 专用子类型（ComplaintEntry.messageType 列）。 */
export const ComplaintClientMessageTypes = {
  ACK: 'ACK',
  EXTENSION_NOTICE: 'EXTENSION_NOTICE',
  FINAL_RESPONSE: 'FINAL_RESPONSE',
} as const;

// ── 方法入参形状（brief Interfaces 逐字）───────────────────────────────

export interface SubmitComplaintDto {
  category: ComplaintCategory;
  subject: string;
  description: string;
  relatedOrderNo?: string;
}

export interface AcknowledgeComplaintDto {
  message: string;
}

export interface ExtendComplaintDto {
  explanation: string;
}

/** proposeResolution / applyResolution 共用形状——proposeResolution 不落 outcome/text
 *  本表（值住审批载荷），applyResolution 才真正落库（brief 原文）。 */
export interface ResolutionDto {
  outcome: ComplaintResolutionOutcome;
  resolutionText: string;
}

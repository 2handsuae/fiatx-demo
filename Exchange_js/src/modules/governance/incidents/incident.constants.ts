// 平账三期 · 事故登记（spec §2/§5）：主体 Incident 的类型、状态、显式迁移表、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖。

/** 首批四类（spec §5）。 */
export const IncidentTypes = {
  UNAUTHORIZED_OUTFLOW: 'UNAUTHORIZED_OUTFLOW',
  LARGE_UNEXPLAINED: 'LARGE_UNEXPLAINED',
  CLIENT_SHORTFALL: 'CLIENT_SHORTFALL',
  MANUAL: 'MANUAL',
} as const;
export type IncidentType = (typeof IncidentTypes)[keyof typeof IncidentTypes];

/** 五态 + 旁支 WITHDRAWN（spec §2）。 */
export const IncidentStatus = {
  REGISTERED: 'REGISTERED',
  INVESTIGATING: 'INVESTIGATING',
  ASSESSED: 'ASSESSED',
  RESOLVING: 'RESOLVING',
  CLOSED: 'CLOSED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type IncidentStatusType = (typeof IncidentStatus)[keyof typeof IncidentStatus];

/**
 * 显式迁移表（spec §2）：状态 → 允许直达的下一状态集合。终态零出边。
 * `ASSESSED → RESOLVING`（START_RESOLUTION，Task 6/7 落方法）、`ASSESSED → CLOSED`
 * （CLOSE_NO_ACTION，Task 7 落方法）、`RESOLVING → CLOSED`（CLOSE，Task 7 落方法）
 * 三条边按 brief 要求先登记在表里——本任务只实现 REGISTERED/INVESTIGATING 两段的方法。
 */
export const INCIDENT_TRANSITIONS: Record<string, readonly string[]> = {
  [IncidentStatus.REGISTERED]: [IncidentStatus.INVESTIGATING, IncidentStatus.WITHDRAWN],
  [IncidentStatus.INVESTIGATING]: [IncidentStatus.ASSESSED],
  [IncidentStatus.ASSESSED]: [IncidentStatus.RESOLVING, IncidentStatus.CLOSED],
  [IncidentStatus.RESOLVING]: [IncidentStatus.CLOSED],
  [IncidentStatus.CLOSED]: [],
  [IncidentStatus.WITHDRAWN]: [],
};

/** 升级去向（IncidentNote.escalatedTo 同款枚举，spec §7）。 */
export const IncidentEscalationTargets = {
  MLRO: 'MLRO',
  CFO: 'CFO',
  SENIOR_MANAGEMENT: 'SENIOR_MANAGEMENT',
} as const;
export type IncidentEscalationTarget = (typeof IncidentEscalationTargets)[keyof typeof IncidentEscalationTargets];

/** 善后单类型（IncidentRemediation.kind，spec §5）。 */
export const IncidentRemediationKinds = {
  SUPPLEMENT: 'SUPPLEMENT',
  CLAIM: 'CLAIM',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
} as const;
export type IncidentRemediationKind = (typeof IncidentRemediationKinds)[keyof typeof IncidentRemediationKinds];

/** 登记入参（dto，plan Task 5 Interfaces）。按类型的额外必填见 incident.service.ts 的校验。 */
export interface RegisterIncidentDto {
  type: IncidentType;
  title: string;
  description: string;
  sourceCaseNo?: string;
  sourceDispositionNo?: string;
  sourceAdvanceTransferNo?: string;
  walletRef?: string;
  customerNo?: string;
  assetCode?: string;
  amount?: string; // 元，字符串（对齐 CreateInternalTransferInput.amountMajor 口径）
}

export interface EscalateIncidentDto {
  to: IncidentEscalationTarget;
  note: string;
}

export interface LinkRemediationDto {
  kind: IncidentRemediationKind;
  referenceNo: string;
}

/** 依据条款目录（spec §4）。hours=null 的依据没有法定钟——界面显式「未设时限」，不杜撰。 */
export const INCIDENT_REPORT_BASES = {
  TIR_K_H:    { label: 'TIR Rulebook Section K + H — 网安 / BCDR 事件报 VARA', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Client Money 重大未平差异', hours: null },
  CRM_V_D_2:  { label: 'CRM V.D.2 — Client VAs 重大未平差异', hours: null },
} as const;

export interface AssessIncidentDto {
  assessedAmount: string;
  assessmentBasis: 'RECOVERED' | 'FIRM_LOSS' | 'CLIENT_COLLECTION' | 'NO_LOSS';
  reportRequired: boolean;
  reportBasisCodes?: string[];
}

export interface MarkReportedDto {
  reference?: string;
}

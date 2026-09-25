// 平账三期 · 事故登记（spec §2/§5）：主体 Incident 的类型、状态、显式迁移表、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖。

/** 首批四类（spec §5）。 */
export const IncidentTypes = {
  UNAUTHORIZED_OUTFLOW: 'UNAUTHORIZED_OUTFLOW',
  LARGE_UNEXPLAINED: 'LARGE_UNEXPLAINED',
  CLIENT_SHORTFALL: 'CLIENT_SHORTFALL',
  MANUAL: 'MANUAL',
} as const;
type IncidentType = (typeof IncidentTypes)[keyof typeof IncidentTypes];

/** 五态 + 旁支 WITHDRAWN（spec §2）。 */
export const IncidentStatus = {
  REGISTERED: 'REGISTERED',
  INVESTIGATING: 'INVESTIGATING',
  ASSESSED: 'ASSESSED',
  RESOLVING: 'RESOLVING',
  CLOSED: 'CLOSED',
  WITHDRAWN: 'WITHDRAWN',
} as const;

/**
 * 显式迁移表（spec §2）：状态 → 允许直达的下一状态集合。终态零出边。
 * `ASSESSED → RESOLVING`（十一码审计合同没有独立"开始处置"码位，裁决改搭在
 * `IncidentService.linkRemediation` 首次善后挂载上触发，Task 7 修复）、`ASSESSED → CLOSED`
 * （CLOSE_NO_ACTION）、`RESOLVING → CLOSED`（CLOSE）三条边均已落方法
 * （`IncidentCloseWorkflowService.requestClose`/`IncidentService.close`，Task 7）。
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
type IncidentEscalationTarget = (typeof IncidentEscalationTargets)[keyof typeof IncidentEscalationTargets];

/** 善后单类型（IncidentRemediation.kind，spec §5）。 */
export const IncidentRemediationKinds = {
  SUPPLEMENT: 'SUPPLEMENT',
  CLAIM: 'CLAIM',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
} as const;
type IncidentRemediationKind = (typeof IncidentRemediationKinds)[keyof typeof IncidentRemediationKinds];

/** 登记入参（dto，plan Task 5 Interfaces）。按类型的额外必填见 incident.service.ts 的校验。 */
export interface RegisterIncidentDto {
  type: IncidentType;
  title: string;
  description: string;
  sourceCaseNo?: string;
  sourceDispositionNo?: string;
  sourceAdvanceTransferNo?: string;
  customerNo?: string;
  assetCode?: string;
  amount?: string; // 元，字符串（对齐 CreateInternalTransferInput.amountMajor 口径）
  // 平账三期 Task 3 续作（事故路原子落定性）：UNAUTHORIZED_OUTFLOW 未带 sourceDispositionNo
  // 时的替代锚——workflow 拿这两个字段先调 DispositionService.record() 落定性，
  // 见 incident-registration-workflow.service.ts。
  explainedExternalLineId?: string;
  findingNote?: string;
}

export interface EscalateIncidentDto {
  to: IncidentEscalationTarget;
  note: string;
}

export interface LinkRemediationDto {
  kind: IncidentRemediationKind;
  referenceNo: string;
}

/** 依据条款目录（spec §4/波一 §5）。一码=一项通报义务（一只钟+一个受文机构）。
 * hours=null 且无 immediate → 条款未载明时限（不杜撰）；immediate=true → 即时义务（无小时钟）。 */
export const INCIDENT_REPORT_BASES: Record<string, { label: string; hours: number | null; immediate?: true }> = {
  TIR_K_H: { label: 'TIR Rulebook Section K + H — material incident (cyber/BCDR, major stuck-transaction) reporting to VARA within 72 hours', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Material Client Money discrepancy', hours: null },
  CRM_V_D_2: { label: 'CRM V.D.2 — Material Client VA discrepancy', hours: null },
  PDPL_ART_9: { label: 'PDPL (Federal Decree-Law 45/2021) Art.9 — personal data breach report to UAE Data Office (statute states no hour clock)', hours: null },
  TIR_II_C_24H: { label: 'VARA TIR Part II Section C + CRM I.1.4 — re-report to VARA within 24 hours AFTER the breach notice is issued (clock starts at first notice, not detection)', hours: 24 },
  COMPANY_IV_H_1: { label: 'Company Rulebook IV.H.1 — material outsourcing failure, notify VARA immediately', hours: null, immediate: true },
  COMPANY_VI_C_F: { label: 'Company Rulebook VI.C / VI.F — NLA prudential breach, notify VARA immediately; daily updates until VARA is satisfied (calendar duty → wave 4)', hours: null, immediate: true },
};

export interface AssessIncidentDto {
  assessedAmount: string;
  assessmentBasis: 'RECOVERED' | 'FIRM_LOSS' | 'CLIENT_COLLECTION' | 'NO_LOSS';
  reportRequired: boolean;
  reportBasisCodes?: string[];
}

export interface MarkReportedDto {
  reference?: string;
}

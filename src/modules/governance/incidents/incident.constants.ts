// 平账三期 · 事故登记（spec §2/§5）：主体 Incident 的类型、状态、显式迁移表、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖。

/**
 * 十类终盘（战役甲波一 spec §1，MANUAL 已退役）——键集由 incident-type-registry.ts
 * 的 INCIDENT_TYPE_REGISTRY 手写同构派生（本文件不 import 该文件，防环；键集一致性由
 * incident-type-registry.spec.ts 的第一条测试钉死）。
 */
export const IncidentTypes = {
  UNAUTHORIZED_OUTFLOW: 'UNAUTHORIZED_OUTFLOW',
  LARGE_UNEXPLAINED: 'LARGE_UNEXPLAINED',
  CLIENT_SHORTFALL: 'CLIENT_SHORTFALL',
  CYBER_BCDR: 'CYBER_BCDR',
  DATA_BREACH: 'DATA_BREACH',
  OUTSOURCING_FAILURE: 'OUTSOURCING_FAILURE',
  ASSET_NONCOMPLIANCE: 'ASSET_NONCOMPLIANCE',
  STUCK_TRANSACTION_MAJOR: 'STUCK_TRANSACTION_MAJOR',
  PRUDENTIAL_BREACH: 'PRUDENTIAL_BREACH',
  COMPLAINT_ESCALATION: 'COMPLAINT_ESCALATION',
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

/** 善后单类型（IncidentRemediation.kind，spec §5）。战役甲波一 Task 7 +2：
 * `ASSET_SUSPENSION_REF`——referenceNo 是既有资产暂停审批单号，本服务只登记引用，不校验
 * 该单号存在（事件侧不代办不越域查询审批主体，铁律③；见 IncidentService.
 * assertRemediationReferenceExists）；`CUSTOMER_NOTICE_LOGGED`——referenceNo 是自由留痕串
 * （如 `NOTICE-2026-09-25`），通知本体是死码，丙战役后升级为真发送。两值按类型收窄的白名单
 * 见 incident-type-registry.ts 的 allowedRemediationKinds。 */
export const IncidentRemediationKinds = {
  SUPPLEMENT: 'SUPPLEMENT',
  CLAIM: 'CLAIM',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
  ASSET_SUSPENSION_REF: 'ASSET_SUSPENSION_REF',
  CUSTOMER_NOTICE_LOGGED: 'CUSTOMER_NOTICE_LOGGED',
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
  // 战役甲波一 Task 5：新七类锚键值（INCIDENT_TYPE_REGISTRY.requiredAnchors 按类型点名的
  // 键集）——服务层 JSON.stringify 存入 Incident.subjectRefs（T3 新列）；存量三类不使用。
  subjectRefs?: Record<string, string | number | boolean>;
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
 * hours=null 且无 immediate → 条款未载明时限（不杜撰）；immediate=true → 即时义务（无小时钟）。
 * chainStart='NOTICE'（战役甲波一 Task 6）：钟链起点是另一码触发的"通知发出"时刻，不是定损/
 * 登记时刻——本码即便带 hours，也不参与钟锚计算（甲波二 T6：该计算已迁到
 * RegulatoryFilingService.computeDeadline，见 regulatory-filing.service.ts；本码到期即便带
 * hours 也不入首次开单的 deadlineAt，起算改由兄弟单提交时补落，见 markSubmitted 的钟链回填）。 */
export const INCIDENT_REPORT_BASES: Record<string, { label: string; hours: number | null; immediate?: true; chainStart?: 'NOTICE'; authority: string }> = {
  TIR_K_H: { label: 'TIR Rulebook Section K + H — material incident (cyber/BCDR, major stuck-transaction) reporting to VARA within 72 hours', hours: 72, authority: 'VARA' },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Material Client Money discrepancy', hours: null, authority: 'VARA' },
  CRM_V_D_2: { label: 'CRM V.D.2 — Material Client VA discrepancy', hours: null, authority: 'VARA' },
  PDPL_ART_9: { label: 'PDPL (Federal Decree-Law 45/2021) Art.9 — personal data breach report to UAE Data Office (statute states no hour clock)', hours: null, authority: 'UAE_DATA_OFFICE' },
  TIR_II_C_24H: { label: 'VARA TIR Part II Section C + CRM I.1.4 — re-report to VARA within 24 hours AFTER the breach notice is issued (clock starts at first notice, not detection)', hours: 24, chainStart: 'NOTICE', authority: 'VARA' },
  COMPANY_IV_H_1: { label: 'Company Rulebook IV.H.1 — material outsourcing failure, notify VARA immediately', hours: null, immediate: true, authority: 'VARA' },
  COMPANY_VI_C_F: { label: 'Company Rulebook VI.C / VI.F — NLA prudential breach, notify VARA immediately; daily updates until VARA is satisfied (calendar duty → wave 4)', hours: null, immediate: true, authority: 'VARA' },
};

/** 定损入参（战役甲波一 Task 6，brief Interfaces）。三档口径（MONETARY/IMPACT/SHORTFALL）
 * 共用一个入口——assessmentBasis 的合法子集按类型的 assessmentScheme 收窄，见
 * incident-type-registry.ts 的 ASSESSMENT_BASIS_BY_SCHEME；哪些附加字段必填（assessedAmount
 * vs impactSummary）由 IncidentService.assess 按 scheme 校验（brief 行为合同④）。 */
export interface AssessIncidentDto {
  assessmentBasis: 'RECOVERED' | 'FIRM_LOSS' | 'CLIENT_COLLECTION' | 'NO_LOSS'   // MONETARY
                 | 'SERVICE_IMPACT' | 'DATA_IMPACT'                              // IMPACT
                 | 'SHORTFALL';                                                  // SHORTFALL
  assessedAmount?: string;   // MONETARY/SHORTFALL 必填；IMPACT 可选
  impactSummary?: string;    // IMPACT 必填
  impactCount?: number;      // 可选（如波及客户数）
  reportRequired: boolean;
  reportBasisCodes?: string[];
}


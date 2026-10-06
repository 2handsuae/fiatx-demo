// 平账三期 · 事故登记：状态 / 类型 / 定损口径 / 升级去向 / 善后类型 / 通报依据的展示人话。
// 唯一真相在后端 incident.constants.ts / incident-type-registry.ts，这里只是展示词
// （惯例同 internalTransferStatusMap.ts）。
//
// 战役甲波一 T10：类型 4→10（−MANUAL）+ 类型注册表镜像（requiredAnchors 渲染规格 /
// assessmentScheme / reportBasisCandidates / allowedRemediationKinds / operatorCapCode）。
// 镜像来源：incident.constants.ts 的 INCIDENT_REPORT_BASES、incident-type-registry.ts 的
// INCIDENT_TYPE_REGISTRY + ASSESSMENT_BASIS_BY_SCHEME + TOP_LEVEL_ANCHOR_KEYS——admin-web
// 不能直接 import 后端 src（两个构建产物），只能手抄同构；选手抄不改建共享包，是这次改动
// 最小的选项（另一选项是抽一个前后端都能 import 的类型化常量文件，改动面更大，报告注明）。
export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  REGISTERED: 'Registered',
  INVESTIGATING: 'Investigating',
  ASSESSED: 'Assessed',
  RESOLVING: 'Resolving',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

export const INCIDENT_STATUSES = [
  'REGISTERED',
  'INVESTIGATING',
  'ASSESSED',
  'RESOLVING',
  'CLOSED',
  'WITHDRAWN',
] as const;

/** 十类终盘 − MANUAL（战役甲波五 Task 9，承接项G：COMPLAINT_ESCALATION 已在
 * incident-type-registry.ts 通电 enabled:true——不再是不可达占位，升级事件会以这个 type
 * 落库并出现在事故登记列表/详情。人工登记下拉（INCIDENT_TYPES，下方）仍不含它——手工
 * 登记入口后端显式拒绝（incident.service.ts MANUAL_REGISTRATION_BLOCKED_TYPES），只是
 * "不可手工创建"，不是"不可见"，展示标签必须有，否则升级事件在列表/详情显示原始码）。 */
export const INCIDENT_TYPE_LABEL: Record<string, string> = {
  UNAUTHORIZED_OUTFLOW: 'Unauthorized outflow',
  LARGE_UNEXPLAINED: 'Large unexplained discrepancy',
  CLIENT_SHORTFALL: 'Client shortfall',
  CYBER_BCDR: 'Cyber / BCDR incident',
  DATA_BREACH: 'Personal data breach',
  OUTSOURCING_FAILURE: 'Outsourcing failure',
  ASSET_NONCOMPLIANCE: 'Asset non-compliance',
  STUCK_TRANSACTION_MAJOR: 'Major stuck transaction',
  PRUDENTIAL_BREACH: 'Prudential (NLA) breach',
  COMPLAINT_ESCALATION: 'Complaint escalation',
};

export const INCIDENT_TYPES = [
  'UNAUTHORIZED_OUTFLOW',
  'LARGE_UNEXPLAINED',
  'CLIENT_SHORTFALL',
  'CYBER_BCDR',
  'DATA_BREACH',
  'OUTSOURCING_FAILURE',
  'ASSET_NONCOMPLIANCE',
  'STUCK_TRANSACTION_MAJOR',
  'PRUDENTIAL_BREACH',
] as const;

export const ASSESSMENT_BASIS_LABEL: Record<string, string> = {
  RECOVERED: 'Recovered',
  FIRM_LOSS: 'Loss recognized',
  CLIENT_COLLECTION: 'Pursuing collection',
  NO_LOSS: 'No loss',
  SERVICE_IMPACT: 'Service impact assessed',
  DATA_IMPACT: 'Data impact assessed',
  SHORTFALL: 'Shortfall assessed',
};

export type AssessmentScheme = 'MONETARY' | 'IMPACT' | 'SHORTFALL';

/** 定损口径按类型收窄的合法取值集（战役甲波一 Task 6 服务层同名常量镜像）。 */
export const ASSESSMENT_BASIS_BY_SCHEME: Record<AssessmentScheme, readonly string[]> = {
  MONETARY: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
  IMPACT: ['SERVICE_IMPACT', 'DATA_IMPACT'],
  SHORTFALL: ['SHORTFALL'],
};

export const ESCALATION_TARGET_LABEL: Record<string, string> = {
  MLRO: 'MLRO',
  CFO: 'CFO',
  SENIOR_MANAGEMENT: 'Senior management',
};

export const ESCALATION_TARGETS = ['MLRO', 'CFO', 'SENIOR_MANAGEMENT'] as const;

/** 善后单类型全集（IsIn 校验用词表，展示词）——处置下拉本身按类型 allowedRemediationKinds 过滤，见 INCIDENT_TYPE_REGISTRY_MIRROR。 */
export const REMEDIATION_KIND_LABEL: Record<string, string> = {
  SUPPLEMENT: 'Supplement',
  CLAIM: 'Claim',
  ADJUSTMENT: 'Adjustment',
  TRANSFER: 'Transfer',
  ASSET_SUSPENSION_REF: 'Asset suspension reference',
  CUSTOMER_NOTICE_LOGGED: 'Customer notice logged',
};

/**
 * 依据条款目录（spec §5）——镜像后端 incident.constants.ts 的 INCIDENT_REPORT_BASES。
 * hours=null 且无 immediate → 条款未载明时限（不杜撰）；immediate=true → 即时义务（无小时
 * 钟）；chainStart='NOTICE' → 钟链起点是另一码触发的"通知发出"时刻，界面显式加注，不
 * 暗示本码自己起钟。
 */
export const INCIDENT_REPORT_BASES: Record<string, { label: string; hours: number | null; immediate?: true; chainStart?: 'NOTICE' }> = {
  TIR_K_H: { label: 'TIR Rulebook Section K + H — material incident (cyber/BCDR, major stuck-transaction) reporting to VARA within 72 hours', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Material Client Money discrepancy', hours: null },
  CRM_V_D_2: { label: 'CRM V.D.2 — Material Client VA discrepancy', hours: null },
  PDPL_ART_9: { label: 'PDPL (Federal Decree-Law 45/2021) Art.9 — personal data breach report to UAE Data Office (statute states no hour clock)', hours: null },
  TIR_II_C_24H: { label: 'VARA TIR Part II Section C + CRM I.1.4 — re-report to VARA within 24 hours AFTER the breach notice is issued (clock starts at first notice, not detection)', hours: 24, chainStart: 'NOTICE' },
  COMPANY_IV_H_1: { label: 'Company Rulebook IV.H.1 — material outsourcing failure, notify VARA immediately', hours: null, immediate: true },
  COMPANY_VI_C_F: { label: 'Company Rulebook VI.C / VI.F — NLA prudential breach, notify VARA immediately; daily updates until VARA is satisfied (calendar duty → wave 4)', hours: null, immediate: true },
};

/** 零候选依据码类型（reportBasisCandidates 为空集）的定损页通报区静态说明——替换原来置灰的
 * "Regulatory report required" 勾选框；其余类型有候选码，不渲染该行（spec §4.5）。 */
export const NO_REPORTING_NOTE: Record<string, string> = {
  ASSET_NONCOMPLIANCE: 'No reporting obligation — the duty is immediate asset suspension, not reporting',
  COMPLAINT_ESCALATION: 'No complaint-specific reporting obligation under VARA Market Conduct',
};

/** 事故经办桶族独占能力码（rbac.catalog.ts 的 cap.incident.* 五行镜像）——详情页/案子页
 * 登记入口按"所视事故类型所属族"门控写按钮，不再用被五组共享而失去区分力的路由级码
 * （`api.post.admin_incidents`：route() 把这一个 code 同时挂给 INCIDENT_WRITE/
 * INCIDENT_TECH_WRITE/INCIDENT_DATA_WRITE/INCIDENT_OPS_WRITE/INCIDENT_FIN_WRITE 五个组，
 * 持有人被一并抬进所有共享组，同 access-control.service.ts assertOperator 头注释的诊断）。 */
export const INCIDENT_OPERATOR_CAP_CODE: Record<string, string> = {
  UNAUTHORIZED_OUTFLOW: 'cap.incident.funds',
  LARGE_UNEXPLAINED: 'cap.incident.funds',
  CLIENT_SHORTFALL: 'cap.incident.funds',
  CYBER_BCDR: 'cap.incident.tech',
  DATA_BREACH: 'cap.incident.data',
  OUTSOURCING_FAILURE: 'cap.incident.tech',
  ASSET_NONCOMPLIANCE: 'cap.incident.ops',
  STUCK_TRANSACTION_MAJOR: 'cap.incident.ops',
  PRUDENTIAL_BREACH: 'cap.incident.fin',
};

/** FUNDS 族所有能力码任一持有即可（案子页登记入口只会创建 FUNDS 族类型：LARGE_UNEXPLAINED / CLIENT_SHORTFALL）。 */
export const INCIDENT_CAP_FUNDS = 'cap.incident.funds';

/** 顶层锚分流（incident-type-registry.ts 的 TOP_LEVEL_ANCHOR_KEYS 镜像）：这三个键渲染为
 * 顶层字段（复用登记表单既有的 Customer No / Asset / Amount 输入位），不进动态锚区块。 */
export const TOP_LEVEL_ANCHOR_KEYS: ReadonlySet<string> = new Set(['assetCode', 'customerNo', 'amount']);

export type IncidentAnchorFieldKind = 'text' | 'checkbox' | 'select' | 'multiselect';

export interface IncidentAnchorOption {
  value: string;
  label: string;
}

export interface IncidentAnchorFieldSpec {
  key: string;
  label: string;
  kind: IncidentAnchorFieldKind;
  options?: readonly IncidentAnchorOption[];
}

export const DATA_CATEGORY_OPTIONS: readonly IncidentAnchorOption[] = [
  { value: 'ID_DOCUMENT', label: 'ID document' },
  { value: 'CONTACT', label: 'Contact info' },
  { value: 'TRANSACTION_HISTORY', label: 'Transaction history' },
  { value: 'COMPLIANCE_FILE', label: 'Compliance file' },
  { value: 'CREDENTIALS', label: 'Credentials' },
];

export const OUTSOURCING_VENDOR_OPTIONS: readonly IncidentAnchorOption[] = [
  { value: 'SUMSUB', label: 'Sumsub' },
  { value: 'HEXTRUST', label: 'HexTrust' },
  { value: 'BANKING_PARTNER', label: 'Banking partner' },
  { value: 'OTHER', label: 'Other' },
];

/** Ruling-14（终审）：受影响系统改回受控枚举+OTHER（spec §1 格值），不许静默降级成自由文本。 */
export const AFFECTED_SYSTEM_OPTIONS: readonly IncidentAnchorOption[] = [
  { value: 'BACKEND_API', label: 'Backend API' },
  { value: 'ADMIN_PORTAL', label: 'Admin portal' },
  { value: 'CLIENT_PORTAL', label: 'Client portal' },
  { value: 'LEDGER', label: 'Ledger' },
  { value: 'DATABASE', label: 'Database' },
  { value: 'CLOUD_INFRA', label: 'Cloud infrastructure' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * 动态锚字段渲染规格——键=类型，值=该类型除顶层锚（assetCode/customerNo/amount）外，需要
 * 落进 subjectRefs 的字段清单（brief 行为合同①逐字段写死；ASSET_NONCOMPLIANCE 的唯一锚
 * assetCode 是顶层键，本表不出现；STUCK_TRANSACTION_MAJOR 的 customerNo/amount 同理只留
 * orderNo）。DATA_BREACH 的 affectedCustomerCount 与 OUTSOURCING_FAILURE 的 serviceImpact
 * 是 plan 原清单漏列、按 incident-type-registry.ts requiredAnchors 实际口径补齐的两个键
 * （后者已在 T10 累积移交清单里点名；前者同款漏项，同一原因一并补）。
 *
 * dataCategories 是唯一的"多选"字段：RegisterIncidentDto.subjectRefs 的值类型是单个
 * `string | number | boolean`（不支持数组），故多选在界面上仍是复选框组，提交时 join(',')
 * 成单个字符串（后端 assertAnchors 只判"非空"，逗号串满足这条，不需要后端跟着改）。
 */
export const INCIDENT_SUBJECT_REF_FIELDS: Record<string, readonly IncidentAnchorFieldSpec[]> = {
  UNAUTHORIZED_OUTFLOW: [],
  LARGE_UNEXPLAINED: [],
  CLIENT_SHORTFALL: [],
  CYBER_BCDR: [
    { key: 'affectedSystem', label: 'Affected system', kind: 'select', options: AFFECTED_SYSTEM_OPTIONS },
    { key: 'bcdrTriggered', label: 'BCDR triggered', kind: 'checkbox' },
  ],
  DATA_BREACH: [
    { key: 'affectedCustomerCount', label: 'Affected customer count', kind: 'text' },
    { key: 'dataCategories', label: 'Data categories', kind: 'multiselect', options: DATA_CATEGORY_OPTIONS },
  ],
  OUTSOURCING_FAILURE: [
    { key: 'vendor', label: 'Vendor', kind: 'select', options: OUTSOURCING_VENDOR_OPTIONS },
    { key: 'serviceImpact', label: 'Service impact', kind: 'text' },
  ],
  ASSET_NONCOMPLIANCE: [],
  STUCK_TRANSACTION_MAJOR: [
    { key: 'orderNo', label: 'Order No', kind: 'text' },
  ],
  PRUDENTIAL_BREACH: [
    { key: 'metric', label: 'Metric (NLA)', kind: 'text' },
    { key: 'shortfallAmount', label: 'Shortfall amount', kind: 'text' },
  ],
};

/** 锚键 → 人话标签的扁平查表（详情页 subjectRefs 区块渲染用），从上表派生，单一来源。
 * +1 手动键（战役甲波五 Task 9，承接项H）：complaintNo——COMPLAINT_ESCALATION 的
 * requiredAnchors 两键之一（incident-type-registry.ts 119-124 行），落 incident 行的
 * subjectRefs（另一键 ownerCustomerNo 落顶层 customerNo 列，走 Basic Info 卡既有
 * "Customer" 字段，不进这张表——见 incident.service.ts registerFromComplaint 注释）。
 * 该类型不进 INCIDENT_SUBJECT_REF_FIELDS（那张表只服务人工登记表单，COMPLAINT_ESCALATION
 * 走 registerFromComplaint 专用入口、无人工登记表单），故这一键单独补一行，不从上表派生。 */
export const ANCHOR_FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.values(INCIDENT_SUBJECT_REF_FIELDS).flat().map((f) => [f.key, f.label])),
  complaintNo: 'Complaint No',
};

const ANCHOR_FIELD_BY_KEY: Record<string, IncidentAnchorFieldSpec> = Object.fromEntries(
  Object.values(INCIDENT_SUBJECT_REF_FIELDS).flat().map((f) => [f.key, f]),
);

/** subjectRefs 详情区块的值格式化——布尔转 Yes/No，受控枚举（多选/单选）值转人话标签。 */
export function formatSubjectRefValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const spec = ANCHOR_FIELD_BY_KEY[key];
  if (spec?.kind === 'multiselect' && typeof value === 'string') {
    const optionLabel = new Map((spec.options ?? []).map((o) => [o.value, o.label]));
    return value.split(',').filter(Boolean).map((v) => optionLabel.get(v) ?? v).join(', ');
  }
  if (spec?.kind === 'select' && typeof value === 'string') {
    const optionLabel = new Map((spec.options ?? []).map((o) => [o.value, o.label]));
    return optionLabel.get(value) ?? value;
  }
  return String(value);
}

export interface IncidentTypeMirror {
  assessmentScheme: AssessmentScheme;
  /** 定损结论合法集（后端 allowedAssessmentBases 镜像，是 assessmentScheme 合法集的子集）——
   * 只有 1 个值的类型，定损表单渲染为固定文本、不渲染下拉。真门在后端 assess()。 */
  allowedAssessmentBases: readonly string[];
  reportBasisCandidates: readonly string[];
  allowedRemediationKinds: readonly string[];
  /** 全量必填锚键（含顶层键），登记表单前端提交前校验、详情页判断必填星号用。 */
  requiredAnchors: readonly string[];
}

/** 类型注册表镜像（incident-type-registry.ts 的 INCIDENT_TYPE_REGISTRY 同构手抄，仅取前端
 * 渲染需要的五格：口径集、定损结论合法集、依据码候选集、善后白名单、必填锚键）。战役甲波五 Task 9
 * （承接项G自查）：COMPLAINT_ESCALATION 现已通电（enabled:true）补入本表——此前的
 * "enabled:false 不出现在任何下拉"已不成立：不入表会让详情页/事件资产页 assess 环节
 * 的 `cfg = INCIDENT_TYPE_REGISTRY_MIRROR[detail.type]` 落空，按错误的 MONETARY 口径
 * （而非注册表实际的 IMPACT）渲染定损依据下拉——它仍然不出现在人工登记下拉
 * （INCIDENT_TYPES，见上）里，因为手工登记入口本就被后端拒绝
 * （incident.service.ts MANUAL_REGISTRATION_BLOCKED_TYPES），"入镜像表"与"入登记下拉"
 * 是两件事。 */
export const INCIDENT_TYPE_REGISTRY_MIRROR: Record<string, IncidentTypeMirror> = {
  UNAUTHORIZED_OUTFLOW: {
    assessmentScheme: 'MONETARY', reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], requiredAnchors: [],
  },
  LARGE_UNEXPLAINED: {
    assessmentScheme: 'MONETARY', reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], requiredAnchors: [],
  },
  CLIENT_SHORTFALL: {
    assessmentScheme: 'MONETARY', reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], requiredAnchors: [],
  },
  CYBER_BCDR: {
    assessmentScheme: 'IMPACT', reportBasisCandidates: ['TIR_K_H'],
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], requiredAnchors: ['affectedSystem', 'bcdrTriggered'],
  },
  DATA_BREACH: {
    assessmentScheme: 'IMPACT', reportBasisCandidates: ['PDPL_ART_9', 'TIR_II_C_24H'],
    allowedAssessmentBases: ['DATA_IMPACT'],
    allowedRemediationKinds: ['CUSTOMER_NOTICE_LOGGED'], requiredAnchors: ['affectedCustomerCount', 'dataCategories'],
  },
  OUTSOURCING_FAILURE: {
    assessmentScheme: 'IMPACT', reportBasisCandidates: ['COMPANY_IV_H_1'],
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], requiredAnchors: ['vendor', 'serviceImpact'],
  },
  ASSET_NONCOMPLIANCE: {
    assessmentScheme: 'IMPACT', reportBasisCandidates: [],
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: ['ASSET_SUSPENSION_REF'], requiredAnchors: ['assetCode'],
  },
  STUCK_TRANSACTION_MAJOR: {
    assessmentScheme: 'MONETARY', reportBasisCandidates: ['TIR_K_H'],
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: [], requiredAnchors: ['orderNo', 'customerNo', 'amount'],
  },
  PRUDENTIAL_BREACH: {
    assessmentScheme: 'SHORTFALL', reportBasisCandidates: ['COMPANY_VI_C_F'],
    allowedAssessmentBases: ['SHORTFALL'],
    allowedRemediationKinds: [], requiredAnchors: ['metric', 'shortfallAmount'],
  },
  // 战役甲波五 Task 9：逐字镜像 incident-type-registry.ts 119-124 行（assessmentScheme:
  // 'IMPACT'、reportBasisCandidates: []、allowedRemediationKinds: []、
  // requiredAnchors: ['complaintNo', 'ownerCustomerNo']）。
  COMPLAINT_ESCALATION: {
    assessmentScheme: 'IMPACT', reportBasisCandidates: [],
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], requiredAnchors: ['complaintNo', 'ownerCustomerNo'],
  },
};

// reportStatusLabel / ReportDeadlineTone / reportDeadlineDisplay / REPORT_DEADLINE_TONE_CLASS
// 随单槽退役迁到 regulatoryFilingMap.ts（战役甲波二 T9，spec §9）——事故页不再自己算/显示
// 通报时限，改读报送单自己的 deadlineAt/overdueMarkedAt（见 IncidentDetailPage.tsx 的
// 「Regulatory Filings」表）；reportStatusLabel 随其唯一调用方（IncidentListPage.tsx 的
// Report Status 列，评审黄1 已退役换单列 reportRequired）一并删除，不留孤儿。

/** spec §2：登记弹窗 Type-specific 段的来路字段与顶层锚显隐/必填规格（展示层；后端校验不变仍是真门）。
 * topLevel 的键序即渲染序（spec §2 表的字段顺序）。 */
export interface IncidentRegistrationFormSpec {
  sourceFields: readonly ('sourceCaseNo' | 'sourceDispositionNo' | 'sourceAdvanceTransferNo')[];
  requiredSources: readonly string[];
  topLevel: Partial<Record<'customerNo' | 'assetCode' | 'amount', 'required' | 'optional'>>;
}
export const INCIDENT_REGISTRATION_FORM: Record<string, IncidentRegistrationFormSpec> = {
  UNAUTHORIZED_OUTFLOW:    { sourceFields: ['sourceCaseNo', 'sourceDispositionNo'], requiredSources: ['sourceCaseNo', 'sourceDispositionNo'], topLevel: { assetCode: 'optional', amount: 'optional' } },
  LARGE_UNEXPLAINED:       { sourceFields: ['sourceCaseNo'], requiredSources: ['sourceCaseNo'], topLevel: { assetCode: 'optional', amount: 'optional' } },
  CLIENT_SHORTFALL:        { sourceFields: ['sourceAdvanceTransferNo'], requiredSources: [], topLevel: { customerNo: 'required', amount: 'required', assetCode: 'optional' } },
  CYBER_BCDR:              { sourceFields: [], requiredSources: [], topLevel: {} },
  DATA_BREACH:             { sourceFields: [], requiredSources: [], topLevel: {} },
  OUTSOURCING_FAILURE:     { sourceFields: [], requiredSources: [], topLevel: {} },
  ASSET_NONCOMPLIANCE:     { sourceFields: [], requiredSources: [], topLevel: { assetCode: 'required' } },
  STUCK_TRANSACTION_MAJOR: { sourceFields: [], requiredSources: [], topLevel: { customerNo: 'required', amount: 'required', assetCode: 'optional' } },
  PRUDENTIAL_BREACH:       { sourceFields: [], requiredSources: [], topLevel: {} },
};

/** spec §3：通用下拉只给 7 类；对账族两类唯案件页 prefill 可达。 */
export const MANUAL_DROPDOWN_TYPES = INCIDENT_TYPES.filter((t) => t !== 'UNAUTHORIZED_OUTFLOW' && t !== 'LARGE_UNEXPLAINED');

// 战役甲波一 Task 2：事故类型注册表（spec §1 十类终盘）。
// 本文件不 import incident.constants.ts（防环）——incident.constants.ts 的 IncidentTypes
// 改为从本文件的键集派生。operatorGroup 用 string（不是 rbac 的 PermissionGroup 联合类型）：
// 四个新经办组名（INCIDENT_TECH_WRITE / INCIDENT_DATA_WRITE / INCIDENT_OPS_WRITE /
// INCIDENT_FIN_WRITE）要到 Task 9 才会加进那个联合类型，提前引用会编译红（波一 T2 裁决）。
import { BadRequestException } from '@nestjs/common';

export type IncidentFamily = 'FUNDS' | 'TECH_SECURITY' | 'DATA' | 'OPERATIONS' | 'FINANCIAL' | 'CUSTOMER';
export type AssessmentScheme = 'MONETARY' | 'IMPACT' | 'SHORTFALL';

export interface IncidentTypeConfig {
  family: IncidentFamily;
  label: string;
  establishedBy: string; // 设立出处（注记级，非依据码）
  operatorGroup: string; // 经办桶（Task 9 路由五桶 OR / 角色绑定用的组名——文档性字段，
  // 甲波一 T5 修1 起服务层断言不再读它，见 operatorMarkerCode）
  closeActionType: string; // ApprovalActionTypes.* 键
  reportBasisCandidates: readonly string[]; // INCIDENT_REPORT_BASES 键，空集=不可勾通报
  requiredAnchors: readonly string[]; // 锚键：存量列名或 subjectRefs 内键
  assessmentScheme: AssessmentScheme;
  allowedAssessmentBases: readonly string[]; // spec §4.1：按类型收窄的定损结论合法集，是 assessmentScheme 合法集的子集
  allowedRemediationKinds: readonly string[];
  enabled: boolean;
  // 甲波一 T5 修1（Ruling-6，C1 修复）：族独占能力码——rbac.catalog.ts 里 RBAC_PERMISSION_
  // DEFINITIONS 新增的五个 cap.incident.* 标记码之一，每码只挂一个组，IncidentService.
  // assertOperator 用 accessControl.hasPermission(userId, operatorMarkerCode) 精确判定，
  // 不走"权限码反查所属组"（该反查在码被多组共享时会把持有人一并抬进所有共享组）。
  operatorMarkerCode: string;
}

// 甲波一 T5 修2（小修 a）：顶层锚分流规则从 incident.service.ts 挪到这里导出——requiredAnchors
// 里凡是命中这个集合的键，语义上是存量列（assetCode/customerNo/amount，审计主体挂载与按客户
// 筛选靠它们），必须从 DTO 顶层取、落存量列，不许塞进 subjectRefs（Ruling-8，I2 修复）。
// service 端引用它做校验；T10 前端渲染动态锚字段时也要按这份口径决定字段画在表单顶层还是
// subjectRefs 区块，故挪成注册表的公共导出，不留在 service 私有实现里。
export const TOP_LEVEL_ANCHOR_KEYS: ReadonlySet<string> = new Set(['assetCode', 'customerNo', 'amount']);

// 战役甲波一 Task 6：定损口径按类型的 assessmentScheme 收窄——assess() 的
// AssessIncidentDto.assessmentBasis 不再是全类型共用的四选一，而是按类型所属口径集
// 合法取值（brief 行为合同①）。三档口径与 incident.constants.ts 的
// AssessIncidentDto.assessmentBasis 联合类型逐字对应。（字面集见各行 allowedAssessmentBases，按类型收窄。）
export const ASSESSMENT_BASIS_BY_SCHEME: Record<AssessmentScheme, readonly string[]> = {
  MONETARY: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
  IMPACT: ['SERVICE_IMPACT', 'DATA_IMPACT'],
  SHORTFALL: ['SHORTFALL'],
};

export const INCIDENT_TYPE_REGISTRY: Record<string, IncidentTypeConfig> = {
  UNAUTHORIZED_OUTFLOW: {
    family: 'FUNDS', label: 'Unauthorized outflow', establishedBy: 'CRM IV.E.5 / V.D.2',
    operatorGroup: 'INCIDENT_WRITE', operatorMarkerCode: 'cap.incident.funds', closeActionType: 'INCIDENT_CLOSE_SECURITY',
    reportBasisCandidates: ['CLIENT_MONEY_DISCREPANCY', 'CLIENT_VA_DISCREPANCY'],
    requiredAnchors: [], // 存量：现有 service 校验原样保留（Task 5），锚声明空=沿用旧校验
    assessmentScheme: 'MONETARY',
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  LARGE_UNEXPLAINED: {
    family: 'FUNDS', label: 'Large unexplained discrepancy', establishedBy: 'CRM IV.E.5 / V.D.2',
    operatorGroup: 'INCIDENT_WRITE', operatorMarkerCode: 'cap.incident.funds', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['CLIENT_MONEY_DISCREPANCY', 'CLIENT_VA_DISCREPANCY'],
    requiredAnchors: [],
    assessmentScheme: 'MONETARY',
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  CLIENT_SHORTFALL: {
    family: 'FUNDS', label: 'Client shortfall', establishedBy: 'CRM Client Money',
    operatorGroup: 'INCIDENT_WRITE', operatorMarkerCode: 'cap.incident.funds', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['CLIENT_MONEY_DISCREPANCY', 'CLIENT_VA_DISCREPANCY'],
    requiredAnchors: [],
    assessmentScheme: 'MONETARY',
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  CYBER_BCDR: {
    family: 'TECH_SECURITY', label: 'Cyber / BCDR incident', establishedBy: 'TIR Rulebook K + H',
    operatorGroup: 'INCIDENT_TECH_WRITE', operatorMarkerCode: 'cap.incident.tech', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['MAJOR_INCIDENT_72H'],
    requiredAnchors: ['affectedSystem', 'bcdrTriggered'], assessmentScheme: 'IMPACT',
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], enabled: true,
  },
  DATA_BREACH: {
    family: 'DATA', label: 'Personal data breach', establishedBy: 'PDPL 45/2021 Art.9 + TIR II.C',
    operatorGroup: 'INCIDENT_DATA_WRITE', operatorMarkerCode: 'cap.incident.data', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['DATA_BREACH_REPORT', 'DATA_BREACH_RE_REPORT_24H'],
    requiredAnchors: ['affectedCustomerCount', 'dataCategories'], assessmentScheme: 'IMPACT',
    allowedAssessmentBases: ['DATA_IMPACT'],
    allowedRemediationKinds: ['CUSTOMER_NOTICE_LOGGED'], enabled: true,
  },
  OUTSOURCING_FAILURE: {
    family: 'TECH_SECURITY', label: 'Outsourcing failure', establishedBy: 'Company IV.H.1',
    operatorGroup: 'INCIDENT_TECH_WRITE', operatorMarkerCode: 'cap.incident.tech', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['OUTSOURCING_FAILURE_NOTICE'],
    requiredAnchors: ['vendor', 'serviceImpact'], assessmentScheme: 'IMPACT',
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], enabled: true,
  },
  ASSET_NONCOMPLIANCE: {
    family: 'OPERATIONS', label: 'Asset non-compliance', establishedBy: 'BD IV.E (duty = immediate suspension, not reporting)',
    operatorGroup: 'INCIDENT_OPS_WRITE', operatorMarkerCode: 'cap.incident.ops', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: [], requiredAnchors: ['assetCode'], assessmentScheme: 'IMPACT',
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: ['ASSET_SUSPENSION_REF'], enabled: true,
  },
  STUCK_TRANSACTION_MAJOR: {
    family: 'OPERATIONS', label: 'Major stuck transaction', establishedBy: 'TIR K.1 + I.H.1 + CRM I.E.4',
    operatorGroup: 'INCIDENT_OPS_WRITE', operatorMarkerCode: 'cap.incident.ops', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['MAJOR_INCIDENT_72H'],
    requiredAnchors: ['orderNo', 'customerNo', 'amount'], assessmentScheme: 'MONETARY',
    allowedAssessmentBases: ['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS'],
    allowedRemediationKinds: [], enabled: true,
  },
  PRUDENTIAL_BREACH: {
    family: 'FINANCIAL', label: 'Prudential (NLA) breach', establishedBy: 'Company VI.C / VI.F',
    operatorGroup: 'INCIDENT_FIN_WRITE', operatorMarkerCode: 'cap.incident.fin', closeActionType: 'INCIDENT_CLOSE_PRUDENTIAL',
    reportBasisCandidates: ['PRUDENTIAL_BREACH_NOTICE'],
    requiredAnchors: ['metric', 'shortfallAmount'], assessmentScheme: 'SHORTFALL',
    allowedAssessmentBases: ['SHORTFALL'],
    allowedRemediationKinds: [], enabled: true,
  },
  // 战役甲波五 T4：通电——CUSTOMER 族只能经 IncidentService.registerFromComplaint
  // （投诉升级 workflow 编排）落地，人工登记入口显式拒绝（见 incident.service.ts
  // MANUAL_REGISTRATION_BLOCKED_TYPES）。结案改走合规官单步的 INCIDENT_CLOSE_CUSTOMER
  // 链（T3 已注册）。requiredAnchors 两键取自投诉主体自己的业务号
  // （Complaint.complaintNo/ownerCustomerNo），不是存量 TOP_LEVEL_ANCHOR_KEYS 里的
  // customerNo——registerFromComplaint 显式必填两个字段，不复用通用 assertAnchors。
  COMPLAINT_ESCALATION: {
    family: 'CUSTOMER', label: 'Complaint escalation', establishedBy: 'Market Conduct III.A',
    operatorGroup: 'INCIDENT_OPS_WRITE', operatorMarkerCode: 'cap.incident.ops', closeActionType: 'INCIDENT_CLOSE_CUSTOMER',
    reportBasisCandidates: [], requiredAnchors: ['complaintNo', 'ownerCustomerNo'], assessmentScheme: 'IMPACT',
    allowedAssessmentBases: ['SERVICE_IMPACT'],
    allowedRemediationKinds: [], enabled: true,
  },
};

export function getIncidentTypeConfig(type: string): IncidentTypeConfig {
  const c = INCIDENT_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown incident type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Incident type ${type} is disabled (reserved for a later wave)`);
  return c;
}

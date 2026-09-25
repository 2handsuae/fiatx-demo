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
  operatorGroup: string; // 经办桶（Task 9 的组名）
  closeActionType: string; // ApprovalActionTypes.* 键
  reportBasisCandidates: readonly string[]; // INCIDENT_REPORT_BASES 键，空集=不可勾通报
  requiredAnchors: readonly string[]; // 锚键：存量列名或 subjectRefs 内键
  assessmentScheme: AssessmentScheme;
  allowedRemediationKinds: readonly string[];
  enabled: boolean;
}

export const INCIDENT_TYPE_REGISTRY: Record<string, IncidentTypeConfig> = {
  UNAUTHORIZED_OUTFLOW: {
    family: 'FUNDS', label: 'Unauthorized outflow', establishedBy: 'CRM IV.E.5 / V.D.2',
    operatorGroup: 'INCIDENT_WRITE', closeActionType: 'INCIDENT_CLOSE_SECURITY',
    reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    requiredAnchors: [], // 存量：现有 service 校验原样保留（Task 5），锚声明空=沿用旧校验
    assessmentScheme: 'MONETARY',
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  LARGE_UNEXPLAINED: {
    family: 'FUNDS', label: 'Large unexplained discrepancy', establishedBy: 'CRM IV.E.5 / V.D.2',
    operatorGroup: 'INCIDENT_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    requiredAnchors: [],
    assessmentScheme: 'MONETARY',
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  CLIENT_SHORTFALL: {
    family: 'FUNDS', label: 'Client shortfall', establishedBy: 'CRM Client Money',
    operatorGroup: 'INCIDENT_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    requiredAnchors: [],
    assessmentScheme: 'MONETARY',
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  CYBER_BCDR: {
    family: 'TECH_SECURITY', label: 'Cyber / BCDR incident', establishedBy: 'TIR Rulebook K + H',
    operatorGroup: 'INCIDENT_TECH_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['TIR_K_H'],
    requiredAnchors: ['affectedSystem', 'bcdrTriggered'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: true,
  },
  DATA_BREACH: {
    family: 'DATA', label: 'Personal data breach', establishedBy: 'PDPL 45/2021 Art.9 + TIR II.C',
    operatorGroup: 'INCIDENT_DATA_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['PDPL_ART_9', 'TIR_II_C_24H'],
    requiredAnchors: ['affectedCustomerCount', 'dataCategories'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: ['CUSTOMER_NOTICE_LOGGED'], enabled: true,
  },
  OUTSOURCING_FAILURE: {
    family: 'TECH_SECURITY', label: 'Outsourcing failure', establishedBy: 'Company IV.H.1',
    operatorGroup: 'INCIDENT_TECH_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['COMPANY_IV_H_1'],
    requiredAnchors: ['vendor', 'serviceImpact'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: true,
  },
  ASSET_NONCOMPLIANCE: {
    family: 'OPERATIONS', label: 'Asset non-compliance', establishedBy: 'BD IV.E (duty = immediate suspension, not reporting)',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: [], requiredAnchors: ['assetCode'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: ['ASSET_SUSPENSION_REF'], enabled: true,
  },
  STUCK_TRANSACTION_MAJOR: {
    family: 'OPERATIONS', label: 'Major stuck transaction', establishedBy: 'TIR K.1 + I.H.1 + CRM I.E.4',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['TIR_K_H'],
    requiredAnchors: ['orderNo', 'customerNo', 'amount'], assessmentScheme: 'MONETARY',
    allowedRemediationKinds: [], enabled: true,
  },
  PRUDENTIAL_BREACH: {
    family: 'FINANCIAL', label: 'Prudential (NLA) breach', establishedBy: 'Company VI.C / VI.F',
    operatorGroup: 'INCIDENT_FIN_WRITE', closeActionType: 'INCIDENT_CLOSE_PRUDENTIAL',
    reportBasisCandidates: ['COMPANY_VI_C_F'],
    requiredAnchors: ['metric', 'shortfallAmount'], assessmentScheme: 'SHORTFALL',
    allowedRemediationKinds: [], enabled: true,
  },
  COMPLAINT_ESCALATION: {
    family: 'CUSTOMER', label: 'Complaint escalation (wave-5 placeholder)', establishedBy: 'Market Conduct III.A',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL', // 占位值，enabled=false 使其不可达；波五改
    reportBasisCandidates: [], requiredAnchors: [], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: false,
  },
};

export function getIncidentTypeConfig(type: string): IncidentTypeConfig {
  const c = INCIDENT_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown incident type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Incident type ${type} is disabled (reserved for a later wave)`);
  return c;
}

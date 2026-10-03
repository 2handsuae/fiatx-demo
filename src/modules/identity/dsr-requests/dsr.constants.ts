// 战役丙波四 T5 · DSR（资料请求）常量。spec §3：三型 / 三态两边 / 四结局 / 30 自然日单钟。
// 前端不跨端 import 本文件——admin-web 用本地镜像 dsrMap.ts（complaintMap 先例，T6）。

export const DsrStatus = {
  SUBMITTED: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
} as const;
export type DsrStatusValue = (typeof DsrStatus)[keyof typeof DsrStatus];

export const DsrType = {
  ACCESS: 'ACCESS',
  RECTIFICATION: 'RECTIFICATION',
  ERASURE: 'ERASURE',
} as const;
export type DsrTypeValue = (typeof DsrType)[keyof typeof DsrType];

export const DsrResolutionCode = {
  ACCESS_SUMMARY_PROVIDED: 'ACCESS_SUMMARY_PROVIDED',
  RECTIFICATION_REVERIFY: 'RECTIFICATION_REVERIFY',
  RECTIFICATION_SELF_SERVICE: 'RECTIFICATION_SELF_SERVICE',
  ERASURE_REFUSED_RETENTION: 'ERASURE_REFUSED_RETENTION',
} as const;
export type DsrResolutionCodeValue = (typeof DsrResolutionCode)[keyof typeof DsrResolutionCode];

/** 铁律④：显式迁移表，RESOLVED 终态。 */
export const DSR_STATUS_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['IN_REVIEW'], IN_REVIEW: ['RESOLVED'], RESOLVED: [],
};

/** 四个结局只对对应的类型有效（resolutionCode × type 匹配校验）。 */
export const DSR_RESOLUTION_BY_TYPE: Record<string, string[]> = {
  ACCESS: ['ACCESS_SUMMARY_PROVIDED'],
  RECTIFICATION: ['RECTIFICATION_REVERIFY', 'RECTIFICATION_SELF_SERVICE'],
  ERASURE: ['ERASURE_REFUSED_RETENTION'],
};

export const DSR_DUE_DAYS = 30; // 自然日，锚提交时刻（裁定 13）

/** ERASURE_REFUSED_RETENTION 的条款引用固定指向协议 §VI（留存与删除）。 */
export const DSR_CLAUSE_SECTION = 'VI';

/** 资料摘要的档案块白名单：显式枚举，riskRating/eddRequired/hardLineDispositionedAt/限制/标签一律不入
 *  （tipping-off 红线，decisions:65）。 */
export const DSR_SUMMARY_PROFILE_FIELDS = ['customerNo','firstName','lastName','companyName','email','phone','dateOfBirth','nationality','idDocType','idDocNumber','residentialAddress','tradingTier','lifecycle','onboardingApprovedAt'] as const;

/** 摘要快照三块（只写一次，JSON 落 data_subject_requests.summary）：
 *  profile=白名单档案字段；agreementConsents=协议同意历史全量；kycMaterials=该客户材料请求清单。 */
export interface DsrSummarySnapshot {
  generatedAt: string;
  profile: Record<(typeof DSR_SUMMARY_PROFILE_FIELDS)[number], string | null>;
  agreementConsents: Array<{ versionKey: string; actedAt: string; decision: string }>;
  kycMaterials: Array<{ materialType: string; status: string; issuedAt: string }>;
}

export interface DsrClauseRef {
  versionKey: string;
  section: string;
}

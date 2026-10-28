// 甲波六 T3（2026-10-29）：尽调评估主体（DDA / SCR）的封闭枚举。LP 线（T4）与服务商线（T6）共用，
// DTO 的 IsIn 与 workflow 的字面比较都读这里。数组故意不加 `as const`：下游 `.includes(someString)` 免类型体操。

/** 被评估对象的类型；值与审计 AuditEntityTypes 同名同值（审计里目标作 RELATED 子主体直接用它）。 */
export const DD_TARGET_TYPES = {
  LIQUIDITY_PROVIDER: 'LIQUIDITY_PROVIDER',
  OUTSOURCING_VENDOR: 'OUTSOURCING_VENDOR',
} as const;
export type DdTargetType = (typeof DD_TARGET_TYPES)[keyof typeof DD_TARGET_TYPES];

export const RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH'];
export const SCREENING_RESULTS = ['GREEN', 'YELLOW', 'RED'];
/** 联合国 / OFAC / 欧盟 / 阿联酋本地 / PEP / 负面新闻。 */
export const SCREENING_LISTS = ['UN', 'OFAC', 'EU', 'UAE_LOCAL', 'PEP', 'ADVERSE_MEDIA'];
export const SUBJECT_KINDS = ['COMPANY', 'BENEFICIAL_OWNER'];
/** 合规官的三选一动作写入的结论。 */
export const DD_CONCLUSIONS = ['RETURNED', 'REJECTED', 'SENT_FOR_APPROVAL'];
/** CISO 证书核验：有 / 无 / 过期。 */
export const INFOSEC_CERT_STATES = ['HAS', 'NONE', 'EXPIRED'];
export const INFOSEC_VERDICTS = ['ACCEPTABLE', 'UNACCEPTABLE'];

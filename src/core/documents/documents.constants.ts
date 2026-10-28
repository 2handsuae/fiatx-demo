// 甲波六 T2（2026-10-29）：文件存储横切件的常量。文件类别枚举对应 spec §4.1（LP）/ §5.1（服务商）/ §4.2（筛查证据）。

/** 文件归属的三类主体；值与审计 AuditEntityTypes 同名同值（审计里 owner 作 RELATED 子主体直接用它）。 */
export const DOCUMENT_OWNER_TYPES = {
  LIQUIDITY_PROVIDER: 'LIQUIDITY_PROVIDER',
  OUTSOURCING_VENDOR: 'OUTSOURCING_VENDOR',
  SCREENING_RECORD: 'SCREENING_RECORD',
} as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[keyof typeof DOCUMENT_OWNER_TYPES];

/** 单文件 ≤ 10 MB，只收 PDF / PNG / JPG；超限直接报错，不做分片。 */
export const DOCUMENT_LIMITS: { maxBytes: number; mimeTypes: readonly string[] } = {
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
};

/** 落盘扩展名跟已校验的 MIME 走（不信客户端文件名里的扩展名）。 */
export const DOCUMENT_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

/** LP 六份尽调文件（spec §4.1）。 */
export const LP_DOC_TYPES = ['INCORPORATION_CERT', 'UBO_REGISTER', 'LICENCE_COPY', 'AML_POLICY', 'FINANCIALS', 'AUTHORISED_SIGNATORIES'];

/** 服务商九类材料（spec §5.1）。 */
export const VENDOR_DOC_TYPES = ['INCORPORATION_CERT', 'CONTRACT', 'LICENCE_COPY', 'UBO_REGISTER', 'FINANCIALS', 'SOC2_ISO_CERT', 'DR_PLAN', 'SUBCONTRACTOR_LIST', 'INSURANCE'];

/** 筛查记录的证据文件（spec §4.2）。 */
export const SCREENING_DOC_TYPES = ['SCREENING_EVIDENCE'];

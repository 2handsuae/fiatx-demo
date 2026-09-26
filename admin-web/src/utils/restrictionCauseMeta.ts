// admin-web/src/utils/restrictionCauseMeta.ts
//
// 与 src/modules/identity/customers/constants/restriction-cause.constant.ts 同步。
// 后端常量是唯一真相源（贴便签时 scope/可见性/解除方式由后端按 cause 定死，
// 前端传了 visibility / releasePolicy 一律 400）；这份镜像只用于弹窗里
// 「选了 cause 之后的只读回显」，让操作员在提交前看清这一贴会带来什么。
// 漂移由 restrictionCauseMeta.spec.ts 拦截：它直接 import 后端常量逐字段比对。

export type RestrictionScope = 'ALL' | 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export type RestrictionCause =
  | 'SANCTION'
  | 'ADMIN_SUSPENSION'
  | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING'
  | 'KYT_REJECTED_SOFT'
  | 'KYT_REJECTED_HARD'
  | 'PENDING_DOCUMENT'
  | 'SANCTION_CONFIRMED';

export type RestrictionVisibility = 'SILENT' | 'DISCLOSED';
export type RestrictionReleasePolicy = 'MLRO_APPROVAL' | 'OPS_APPROVAL';

export interface RestrictionCausePolicy {
  defaultScopes: RestrictionScope[];
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  scopeSelectable: boolean;
  customerLabel: string;
  /** 前端不展示、不参与任何逻辑 —— 只为让防漂移测试的逐字段比对成立。 */
  customerLevel: boolean;
}

export const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy> = {
  SANCTION: {
    defaultScopes: ['ALL'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLevel: true,
    customerLabel: '',
  },
  ADMIN_SUSPENSION: {
    defaultScopes: ['ALL'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLevel: false,
    customerLabel: 'Account suspended',
  },
  MATERIAL_EXPIRED: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLevel: false,
    customerLabel: 'Document expired',
  },
  TIER_UPGRADE_PENDING: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLevel: false,
    customerLabel: 'Additional review in progress',
  },
  KYT_REJECTED_SOFT: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLevel: false,
    customerLabel: 'Verification required',
  },
  KYT_REJECTED_HARD: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLevel: false,
    customerLabel: '',
  },
  PENDING_DOCUMENT: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: true,
    customerLevel: false,
    customerLabel: 'Document required',
  },
  // 战役甲波三 T4：制裁定性 CONFIRMED 出口的落地便签——SILENT 的 SANCTION 便签解列后
  // 开的新便签，DISCLOSED 是刻意的（spec §2 B 线：确认后横幅可见即依据）。逐字段镜像
  // restriction-cause.constant.ts（防漂移测试 restrictionCauseMeta.spec.ts 逐字段比对）。
  SANCTION_CONFIRMED: {
    defaultScopes: ['ALL'],
    visibility: 'DISCLOSED',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLevel: true,
    customerLabel: 'Account restricted — confirmed sanctions match',
  },
};

/** 下拉顺序 = 常量声明顺序（制裁在最前，最常用的人工挂起紧随其后）。 */
export const RESTRICTION_CAUSES = Object.keys(
  RESTRICTION_CAUSE_POLICY,
) as RestrictionCause[];

/** 人工可勾的只有三个能力位；`ALL` 由 cause 带出，永不让操作员手选。 */
export const SELECTABLE_SCOPES: RestrictionScope[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

export const scopeLabel = (scopes: RestrictionScope[]): string =>
  scopes.length > 0 ? scopes.join('·') : '—';

/* ── Admin wire row（GET /admin/customers/:customerNo/restrictions 的元素） ──
   与后端 RestrictionRow 同形，两处差别：
   ① 日期上线后是 ISO string；
   ② 没有 customerId —— 控制器故意剥掉了（调用方给的就是 customerNo，
      回一个 UUID 只是把原始 ID 递到前端手上）。
   一个 restrictionNo 一行，多能力已在后端聚合进 scopes 数组。 */
export interface AdminRestrictionRow {
  restrictionNo: string;
  scopes: RestrictionScope[];
  cause: RestrictionCause;
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  status: 'OPEN' | 'RELEASED';
  reason: string;
  caseRef: string | null;
  releaseOrderRef: string | null;
  openedAt: string;
  openedBy: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseApprovalNo: string | null;
  releaseMode: 'AUTO' | 'MANUAL' | null;
  traceId: string;
}

/**
 * 限制原因注册表（闭集）—— 设计稿 2026-08-15 §3.3。
 *
 * R1：visibility / releasePolicy 是 cause 的函数。运营选不了、API 不接受这两个入参；
 *     贴便签时由服务端查本表**落库**（而非每次现算），保证历史行不因本表日后改动而变义。
 * R2：scope 仅 PENDING_DOCUMENT 允许运营指定（scopeSelectable），其余一律用 defaultScopes。
 * R3：customerLabel 只服务 DISCLOSED；SILENT 恒为空串——客户面没有任何字段可承载它。
 */

export type RestrictionScope = 'ALL' | 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export type RestrictionCause =
  | 'SANCTION'
  | 'ADMIN_SUSPENSION'
  | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING'
  | 'KYT_REJECTED_SOFT'
  | 'KYT_REJECTED_HARD'
  | 'PENDING_DOCUMENT';

export type RestrictionVisibility = 'SILENT' | 'DISCLOSED';

export type RestrictionReleasePolicy = 'MLRO_APPROVAL' | 'OPS_APPROVAL';

export interface RestrictionCausePolicy {
  /** 贴便签时默认卡住的能力；一个 scope 一行，同一 restrictionNo 下多行 */
  defaultScopes: RestrictionScope[];
  visibility: RestrictionVisibility;
  /** 人工解除走哪级审批 */
  releasePolicy: RestrictionReleasePolicy;
  /** 仅 PENDING_DOCUMENT 为 true */
  scopeSelectable: boolean;
  /** DISCLOSED 给客户看的标题；SILENT 一律 '' */
  customerLabel: string;
}

export const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy> = {
  SANCTION: {
    defaultScopes: ['ALL'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  ADMIN_SUSPENSION: {
    defaultScopes: ['ALL'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Account suspended',
  },
  MATERIAL_EXPIRED: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Document expired',
  },
  TIER_UPGRADE_PENDING: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Additional review in progress',
  },
  KYT_REJECTED_SOFT: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Verification required',
  },
  KYT_REJECTED_HARD: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  PENDING_DOCUMENT: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: true,
    customerLabel: 'Document required',
  },
};

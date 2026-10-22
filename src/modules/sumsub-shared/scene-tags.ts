/**
 * 场景 tag —— Sumsub 规则引擎自动打的，说的是「命中了什么」。
 *
 * 2026-08-29：PEP 分主体，补上 2026-08-20「制裁命中分主体」漏掉的对称性
 * （当时把 SANCTION 拆成 APPLICANT/COUNTERPARTY，PEP 没跟上）。
 */
export type SceneTag =
  | 'SANCTION_APPLICANT'
  | 'SANCTION_COUNTERPARTY'
  | 'PEP_APPLICANT'
  | 'PEP_COUNTERPARTY';

export const SCENE_TAGS = new Set<SceneTag>([
  'SANCTION_APPLICANT',
  'SANCTION_COUNTERPARTY',
  'PEP_APPLICANT',
  'PEP_COUNTERPARTY',
]);

/**
 * 显式优先序。sceneTag 是标量、循环里后写覆盖先写，不定优先级的话哪个生效
 * 取决于 Sumsub 报文里 typedTags 的先后顺序 —— 同一笔「对手方受制裁 + 客户是
 * PEP」的交易会时而冻单时而落人工复核，且无任何日志。
 * 收紧方向优先：漏冻的代价远大于多冻一次。
 */
export const SCENE_TAG_PRIORITY: Record<SceneTag, number> = {
  SANCTION_APPLICANT: 4,
  SANCTION_COUNTERPARTY: 3,
  PEP_APPLICANT: 2,
  PEP_COUNTERPARTY: 1,
};

/**
 * 处置 tag —— 合规官/MLRO 在 Sumsub 审核台上手工打的，说的是「该怎么办」。
 *
 * 对手方波二加 VASP_UNQUALIFIED：Sumsub 侧判对手方 VASP 不合格时打的拒绝标签，落点是
 * 人工复核台并标明原因（不是处置指令——出口仍由运营在复核台选，走既有退回/退款弧）。
 * 充值/提现两域共有（兑换域无外部对手方，不识别——swap handler 自带词表）。
 */
export type DispoTag =
  | 'FROZEN_BY_MLRO'
  | 'RETURN_TO_SENDER'
  | 'FINAL_REJECTED'
  | 'VASP_UNQUALIFIED';

export const DISPO_TAGS_BY_DOMAIN: Record<'DEPOSIT' | 'WITHDRAW', ReadonlySet<DispoTag>> = {
  DEPOSIT: new Set<DispoTag>(['FROZEN_BY_MLRO', 'RETURN_TO_SENDER', 'VASP_UNQUALIFIED']),
  WITHDRAW: new Set<DispoTag>(['FROZEN_BY_MLRO', 'FINAL_REJECTED', 'VASP_UNQUALIFIED']),
};

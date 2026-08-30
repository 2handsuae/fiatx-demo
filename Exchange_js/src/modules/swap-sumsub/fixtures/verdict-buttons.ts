import { buildOrderVerdictButtons, type OrderVerdictButton } from '../../sumsub-shared/verdict-buttons.shared';

export type SwapVerdictButton = OrderVerdictButton;

/**
 * 兑换域裁决按钮 —— 取充值域同一张表的 8 个子集（同码同义）。
 *
 * 缺的三个各有真实理由，不得为了凑数补：
 *   ④ PEP 对手方 / ⑧ Sanctions 对手方 —— 兑换是客户账内换币，没有对手方；
 *   ⑩ 处置标签 —— 兑换的 FROZEN 是零出边终态，没有没收/退回/上缴那类弧。
 *
 * 2026-08-29 删掉旧的「⑦认证通过 / ⑧认证不通过」：材料审核是另一个 webhook
 * （applicantActionReviewed），入口在客户详情页 Verification Requests 区块的
 * MaterialRequestPanel，不属交易面板。见 spec §2.1。
 */
const ALL = buildOrderVerdictButtons('DEPOSIT');
const SWAP_KEYS = [
  'V1_APPROVED',
  'V2_AWAIT_USER',
  'V3_AWAIT_USER_PEP_APPLICANT',
  'V5_AWAIT_USER_MULTI',
  'V6_ONHOLD',
  'V7_REJECTED_SANCTION_APPLICANT',
  'V9_REJECTED_MLRO_FREEZE',
  'V11_REJECTED_NO_TAG',
] as const;

export const SWAP_VERDICT_BUTTONS: Record<string, SwapVerdictButton> =
  Object.fromEntries(SWAP_KEYS.map((k) => [k, ALL[k]]));

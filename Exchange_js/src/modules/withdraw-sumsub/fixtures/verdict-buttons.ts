import { buildOrderVerdictButtons, type OrderVerdictButton } from '../../sumsub-shared/verdict-buttons.shared';

/**
 * 提现域裁决按钮 —— 表本身住在 sumsub-shared（2026-08-29 合并，此前充值与提现
 * 各一份 195 行，去注释去 import 后实质只差 ⑩ 一个按钮）。
 * 本域与充值域的唯一差异：⑩ 的处置 tag = FINAL_REJECTED（充值是 RETURN_TO_SENDER）。
 */
export type WithdrawVerdictButton = OrderVerdictButton;
export const WITHDRAW_VERDICT_BUTTONS = buildOrderVerdictButtons('WITHDRAW');

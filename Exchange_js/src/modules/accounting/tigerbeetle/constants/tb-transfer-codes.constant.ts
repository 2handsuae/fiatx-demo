// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
/** TB transfer type codes (u16). Immutable once assigned. 实时 1:1 模型。 */
export const TB_TRANSFER_CODES = {
  // ── 充值(1–9)──
  DEPOSIT_ASSET_TO_SUSPENSE: 1,   // DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE
  DEPOSIT_SUSPENSE_TO_PAYABLE: 2, // DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE
  // 没收(below-min 充值当 T&C 手续费没收，两腿)：leg1 精确反冲 STEP_1 归零客户暂扣，
  // leg2 公司侧确认手续费收入。两腿各保客户/公司恒等式两边同增减。
  DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET: 3, // DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET（反冲 STEP_1）
  DEPOSIT_CONFISCATE_FIRM_FEE: 4,          // DR FIRM_ASSET / CR FIRM_FEE（确认公司手续费收入）
  // 退回(RETURNING→RETURNED)：pending/post/void 三段式，模仿提现净额腿
  DEPOSIT_RETURN_PENDING: 5, // 客户侧锁定(pending)
  DEPOSIT_RETURN_POST: 6,    // 外部确认:post
  DEPOSIT_RETURN_VOID: 7,    // 取消/失败:void
  // 上缴(SEIZING→SEIZED)：单腿(终审纠偏 2026-07-28)——反冲客户暂扣(销负债+托管资产
  // 收缩，钱离场)，贷方记 CLIENT_ASSET（此前误记 FIRM_SEIZED 导致 COA 恒等式破坏，
  // 已改回；结构与退回弧一致）。pending/post 两段，void 见下方 20 段。
  DEPOSIT_SEIZE_PENDING: 8, // 客户侧锁定(pending)：DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET
  DEPOSIT_SEIZE_POST: 9,    // 落地确认:post

  // ── 提现(10–19)──
  WITHDRAW_NET_PENDING: 10, // 客户侧锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_NET_POST: 11,    // 外部确认:post
  WITHDRAW_NET_VOID: 12,    // 取消/失败:void
  WITHDRAW_FEE_PENDING: 13, // 客户侧费锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_FEE_POST: 14,    // post
  WITHDRAW_FEE_VOID: 15,    // void
  WITHDRAW_FEE_FIRM: 16,    // 公司侧收费:DR FIRM_ASSET / CR FIRM_FEE
  // 退汇(PAYOUT_PENDING→RETURNED，Task 7)：净额腿已 POST 后银行/链上退回,重入账反向单腿
  // (DR CLIENT_ASSET / CR CLIENT_PAYABLE)。手续费不退(留归公司)。
  WITHDRAW_BOUNCE_REENTRY: 17,

  // ── 充值·上缴续段(20–29)：充值段 5–9 已满,续挪此──
  DEPOSIT_SEIZE_VOID: 20, // 上缴取消/失败:void

  // ── 兑换(30–49)──
  SWAP_SELL_CLIENT: 30,        // 客户卖出(from):DR CLIENT_PAYABLE / CR CLIENT_ASSET
  SWAP_SELL_FIRM: 31,          // 公司收入(from):DR FIRM_ASSET / CR FIRM_OPS
  SWAP_BUY_OPS_TO_SET: 32,     // 法币公司内:DR FIRM_OPS / CR FIRM_SET (仅 fiat 腿)
  SWAP_BUY_SET_TO_ASSET: 33,   // 公司放出(to):DR FIRM_SET / CR FIRM_ASSET (fiat) | DR FIRM_OPS / CR FIRM_ASSET (crypto)
  SWAP_BUY_CLIENT: 34,         // 客户收到(to,毛):DR CLIENT_ASSET / CR CLIENT_PAYABLE
  SWAP_FEE_CLIENT: 35,         // 客户付费(to):DR CLIENT_PAYABLE / CR CLIENT_ASSET
  SWAP_FEE_FIRM: 36,           // 公司收费(to):DR FIRM_ASSET / CR FIRM_FEE
  SWAP_SELL_SET_TO_OPS: 37,    // 法币卖出公司内:DR FIRM_SET / CR FIRM_OPS (fiat-sell only)
  SWAP_BUY_OPS_TO_ASSET: 38,  // 币买公司放出:DR FIRM_OPS / CR FIRM_ASSET (crypto-buy only)

  // ── Bootstrap(70)──
  CAPITAL_INJECTION: 70, // 资本注入:DR FIRM_ASSET / CR FIRM_OPS
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];

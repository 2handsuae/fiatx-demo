// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
/** TB transfer type codes (u16). Immutable once assigned. 实时 1:1 模型。 */
export const TB_TRANSFER_CODES = {
  // ── 充值(1–9)──
  DEPOSIT_ASSET_TO_SUSPENSE: 1,   // DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE
  DEPOSIT_SUSPENSE_TO_PAYABLE: 2, // DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE

  // ── 提现(10–19)──
  WITHDRAW_NET_PENDING: 10, // 客户侧锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_NET_POST: 11,    // 外部确认:post
  WITHDRAW_NET_VOID: 12,    // 取消/失败:void
  WITHDRAW_FEE_PENDING: 13, // 客户侧费锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_FEE_POST: 14,    // post
  WITHDRAW_FEE_VOID: 15,    // void
  WITHDRAW_FEE_FIRM: 16,    // 公司侧收费:DR FIRM_ASSET / CR FIRM_FEE

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

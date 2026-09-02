// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
/** TB transfer type codes (u16). Immutable once assigned. 实时 1:1 模型。 */
export const TB_TRANSFER_CODES = {
  // ── 充值(1–9)──
  DEPOSIT_ASSET_TO_SUSPENSE: 1,   // DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE
  DEPOSIT_SUSPENSE_TO_PAYABLE: 2, // DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE
  // 没收(below-min 充值当 T&C 手续费没收，两腿)：leg1 精确反冲 STEP_1 归零客户暂扣，
  // leg2 公司侧确认收入(COA v2 起入 INCOME_OTHER，与服务费收入隔离)。两腿各保客户/公司恒等式两边同增减。
  DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET: 3, // DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET（反冲 STEP_1）
  // 2026-08-13 COA v2 随科目改名(原 DEPOSIT_CONFISCATE_FIRM_FEE —— 名字里直接写着已退役的
  // FIRM_FEE)。⚠️ 下游 eventCode 字符串 'CONFISCATE_INCOME_OTHER' 喂 deterministicTransferId
  // 复现 pending id,**startConfiscation(下锁) 与 settleConfiscation(结算) 两处必须成对改**,
  // 只改一处则 post 找不到 pending;且改名后在途单的旧 pending 锁 post 不回来 —— 按
  // CLAUDE.md「Demo 数据约定」(不留迁移兼容层、改完即重置重铺)处理,部署后重置即可。
  DEPOSIT_CONFISCATE_INCOME_OTHER: 4,      // DR FIRM_ASSET / CR INCOME_OTHER(212)（below-min 没收确认其他收入）
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
  // 名字保留:'FEE_FIRM' 表达的是「费→公司侧」这个动作,不指向任何科目名,COA v2 后依然准确
  // (对比码 4 原名 DEPOSIT_CONFISCATE_FIRM_FEE 直接写死了退役科目名,故随科目改名)。
  WITHDRAW_FEE_FIRM: 16,    // 公司侧收费:DR FIRM_ASSET / CR INCOME_WITHDRAW_FEE(211)
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
  SWAP_FEE_FIRM: 36,           // 公司收费(to):DR FIRM_ASSET / CR INCOME_SWAP_FEE(210)（名字保留,同码 16）
  SWAP_SELL_SET_TO_OPS: 37,    // 法币卖出公司内:DR FIRM_SET / CR FIRM_OPS (fiat-sell only)
  SWAP_BUY_OPS_TO_ASSET: 38,  // 币买公司放出:DR FIRM_OPS / CR FIRM_ASSET (crypto-buy only)

  // ── Bootstrap(70)──
  CAPITAL_INJECTION: 70, // 资本注入:DR FIRM_ASSET / CR FIRM_OPS

  // ── 平账·调账(80)──
  // 五种分录组合共用这一个码:前四种随 book×direction 推导(resolvePostingLegs);
  // 第五种是改记(direction='REATTRIBUTE',成因 CUSTOMER_REATTRIBUTION)——两腿都是
  // CLIENT_PAYABLE、只换 ownerUuid,不由 book×direction 决定(resolveReattributionLegs)。
  RECON_ADJUSTMENT: 80, // 调账单落账(disposition/adjustment-rules.ts)
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];

// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
/** TB transfer type codes (u16). Immutable once assigned. 实时 1:1 模型。 */
export const TB_TRANSFER_CODES = {
  // ── 充值(1–9)──
  // 戊波一(附录 B):现金类一钱包一户。「现金·落地钱包」= 这笔充值落进的那只钱包的客户现金户(A.CLIENT_CASH),
  // 没收 / 退回 / 上缴都是反冲它,取户同一个入口(resolveCashAccountId)。
  DEPOSIT_ASSET_TO_SUSPENSE: 1,   // 钱到账:DR 现金·落地钱包(A.CLIENT_CASH) / CR 暂扣(L.DEPOSIT_SUSPENSE)
  DEPOSIT_SUSPENSE_TO_PAYABLE: 2, // 合规放行:DR 暂扣(L.DEPOSIT_SUSPENSE) / CR 应付(L.CLIENT_PAYABLE),不碰现金
  // 没收(below-min 充值当 T&C 手续费没收,两腿):
  // 腿 1(码 3)精确反冲码 1,客户暂扣归零、客户现金户退回;腿 2(码 4)在公司手续费钱包记收入。两腿各保客户 / 公司两本账各自平。
  DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET: 3, // DR 暂扣(L.DEPOSIT_SUSPENSE) / CR 现金·落地钱包(A.CLIENT_CASH)
  DEPOSIT_CONFISCATE_INCOME_OTHER: 4,      // DR 现金·公司 F_FEE 钱包(A.FIRM_CASH) / CR 其他收入(E.INCOME_OTHER,212)
  // 退回(RETURNING→RETURNED):pending / post / void 三段式,同一对账户:
  DEPOSIT_RETURN_PENDING: 5, // 锁定(pending):DR 暂扣(L.DEPOSIT_SUSPENSE) / CR 现金·落地钱包(A.CLIENT_CASH)
  DEPOSIT_RETURN_POST: 6,    // 确认落账(post):同上
  DEPOSIT_RETURN_VOID: 7,    // 失败作废(void):同上
  // 上缴(SEIZING→SEIZED):单腿,同退回,对方栏是当局(不建模、不开户);pending / post 两段,void 见下方 20 段
  DEPOSIT_SEIZE_PENDING: 8, // 锁定(pending):DR 暂扣(L.DEPOSIT_SUSPENSE) / CR 现金·落地钱包(A.CLIENT_CASH)
  DEPOSIT_SEIZE_POST: 9,    // 落账(post):同上

  // ── 提现(10–19)──
  WITHDRAW_NET_PENDING: 10, // 客户侧锁定:DR CLIENT_PAYABLE / CR CLIENT_CASH (pending)
  WITHDRAW_NET_POST: 11,    // 外部确认:post
  WITHDRAW_NET_VOID: 12,    // 取消/失败:void
  WITHDRAW_FEE_PENDING: 13, // 客户侧费锁定:DR CLIENT_PAYABLE / CR CLIENT_CASH (pending)
  WITHDRAW_FEE_POST: 14,    // post
  WITHDRAW_FEE_VOID: 15,    // void
  // 名字保留:'FEE_FIRM' 表达的是「费→公司侧」这个动作,不指向任何科目名,COA v2 后依然准确
  // (对比码 4 原名 DEPOSIT_CONFISCATE_FIRM_FEE 直接写死了退役科目名,故随科目改名)。
  WITHDRAW_FEE_FIRM: 16,    // 公司侧收费:DR FIRM_CASH / CR INCOME_WITHDRAW_FEE(211)
  // 退汇(PAYOUT_PENDING→RETURNED，Task 7)：净额腿已 POST 后银行/链上退回,重入账反向单腿
  // (DR CLIENT_CASH / CR CLIENT_PAYABLE)。手续费不退(留归公司)。
  WITHDRAW_BOUNCE_REENTRY: 17,

  // ── 充值·上缴续段(20–29)：充值段 5–9 已满,续挪此──
  DEPOSIT_SEIZE_VOID: 20, // 上缴失败作废(void):DR 暂扣(L.DEPOSIT_SUSPENSE) / CR 现金·落地钱包(A.CLIENT_CASH)
  // 平账 B 批②:入账后被银行/托管方退汇(SUCCESS→CLAWED_BACK),单腿反向:
  // DR 应付(L.CLIENT_PAYABLE,客户) / CR 现金·落地钱包(A.CLIENT_CASH)。不建资金单(decisions 2026-08-28)。UI 挂起(附录 B「挂起」)。
  DEPOSIT_CLAWBACK: 21,

  // ── 兑换(30–49)──
  // 戊波一:现金类科目一钱包一户。同一腿内,现金贷方 = 该腿 fromRole 钱包、现金借方 = toRole 钱包;结算户并入 FIRM_CASH(「公司现金·结算」)。
  SWAP_SELL_CLIENT: 30,        // 客户卖出(腿 1):DR CLIENT_PAYABLE / CR CLIENT_CASH·客户钱包(两阶段:建单挂起,腿 1 确认落账)
  SWAP_SELL_FIRM: 31,          // 公司收入(腿 1):DR FIRM_CASH·toRole 钱包(卖币=运营 / 卖法币=结算) / CR FIRM_EQUITY
  SWAP_BUY_OPS_TO_SET: 32,     // 卖币买法币·腿 2 运营→结算:DR FIRM_CASH·F_SET / CR FIRM_CASH·F_OPS
  SWAP_BUY_SET_TO_ASSET: 33,   // 卖币买法币·腿 3 放出:DR FIRM_EQUITY / CR FIRM_CASH·F_SET
  SWAP_BUY_CLIENT: 34,         // 客户收到(腿 3,毛):DR CLIENT_CASH·客户钱包 / CR CLIENT_PAYABLE
  SWAP_FEE_CLIENT: 35,         // 客户付费(腿 4):DR CLIENT_PAYABLE / CR CLIENT_CASH·客户钱包
  SWAP_FEE_FIRM: 36,           // 公司收费(腿 4):DR FIRM_CASH·F_FEE / CR INCOME_SWAP_FEE(210)（名字保留,同码 16）
  SWAP_SELL_SET_TO_OPS: 37,    // 卖法币买币·腿 2 结算→运营:DR FIRM_CASH·F_OPS / CR FIRM_CASH·F_SET
  SWAP_BUY_OPS_TO_ASSET: 38,  // 卖法币买币·腿 3 放出:DR FIRM_EQUITY / CR FIRM_CASH·F_OPS

  // ── Bootstrap(70)──
  CAPITAL_INJECTION: 70, // 资本注入:DR FIRM_CASH / CR FIRM_EQUITY

  // ── 平账·调账(80)──
  // 五种分录组合共用这一个码:前四种随 book×direction 推导(resolvePostingLegs);
  // 第五种是改记(direction='REATTRIBUTE',成因 CUSTOMER_REATTRIBUTION)——两腿都是
  // CLIENT_PAYABLE、只换 ownerUuid,不由 book×direction 决定(resolveReattributionLegs)。
  RECON_ADJUSTMENT: 80, // 调账单落账(disposition/adjustment-rules.ts)

  // ── 平账·划转(81–83)（二期，2026-09-05）：内部划转单（公司 → 客户）三种腿分录。
  // 形状与兑换买入腿同源（32 OPS_TO_SET / 33 SET_TO_ASSET / 34 BUY_CLIENT），父单换成划转单：
  //   法币腿 1：运营户 → 结算户；法币腿 2 / 加密币腿 1：公司放出 + 客户收到（一步两笔，任一失败整步失败）。
  INTERNAL_TRANSFER_OPS_TO_SET: 81, // DR FIRM_EQUITY / CR FIRM_SET（法币腿 1）
  INTERNAL_TRANSFER_FIRM_OUT: 82,   // DR FIRM_SET(法币腿 2) 或 FIRM_EQUITY(加密币腿 1) / CR FIRM_CASH
  INTERNAL_TRANSFER_CLIENT_IN: 83,  // DR CLIENT_CASH / CR CLIENT_PAYABLE(客户)

  // ── 战役乙波一（2026-09-29）：LP 兑换（84–86）。先款后货：卖出直出、买入落前厅、验收入库 ──
  LP_EXCHANGE_PAY: 84,     // 卖出腿：DR FIRM_EQUITY / CR FIRM_CASH（卖出币 ledger，付给 LP，外穿）
  LP_EXCHANGE_RECEIVE: 85, // 买入腿：DR FIRM_CASH / CR FIRM_LIQ（买入币 ledger，LP 打来落前厅，外穿）
  LP_EXCHANGE_ACCEPT: 86,  // 验收转腿：DR FIRM_LIQ / CR FIRM_EQUITY（买入币 ledger，验收入库，内转）

  // ── 战役乙波二（2026-09-29）：供应商付款（87）。单腿出：运营户直出到收款坐标；注资复用 70 ──
  VENDOR_PAYMENT: 87, // 付款腿：DR FIRM_EQUITY / CR FIRM_CASH（付款币 ledger，付给在册外包商，外穿）
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];

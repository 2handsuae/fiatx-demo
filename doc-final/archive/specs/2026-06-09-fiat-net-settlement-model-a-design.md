# 法币结算 Model A:净额交割 + gross 记账 Design

> 状态:设计收口(pre-implementation)
> 适用:`fiat-settlement-workflow.service.ts`、`fiat-fee-collection-workflow.service.ts`
> 取代:`2026-06-08-v7-fiat-fee-collection-design.md` 中"IN 交割 gross + VIBAN→F_FEE 抽费"的部分(Model B)。
> **⚠️ 钱包漂移修正(2026-06-21,以 live code 为准)**:本文所有结算/费用路由里的 `F_LIQ` 已改 **`F_OPS`**——`C_VIBAN↔F_SET↔F_OPS`(本金)、`F_OPS→F_FEE`(swap 费/点差);`F_LIQ` 退出结算路径(仍是 FIRM_TREASURY 名下钱包)。源 `internal-transfer-paths.constant.ts`。Model A 的 net 交割 + 公司侧收费逻辑不变,仅落地钱包角色 F_LIQ→F_OPS。

## 背景 / 决策

客户资产隔离(ZandBank)下,**手续费不应在客户 VIBAN 里来回穿过**。早先实现(Model B)为了让"客户付了手续费"在账面体现,IN 方向把 **gross**(net+fee)打进 VIBAN,再 `VIBAN→F_FEE` 把 fee 抽回。本轮改为 **Model A**:

1. **记账 = gross**(不变):客户记账的 gross/net/fee 在 swap **成交时**就记进 TRADE_CLEARING + FEE_RECEIVABLE。结算 drain(`applyAccounting`)是**按 TB 余额驱动**的,不读转账金额 → 交割改 net,记账纹丝不动。
2. **真实资金 = net**:`F_LIQ→F_SET→VIBAN` 只搬 **net**;服务费在**公司侧**确认 `F_LIQ→F_FEE`,永不进客户 VIBAN。
3. **Outstanding = net**(不变):IN Outstanding 金额 = `swap.netToAmount ?? toAmount` = net。

## 对账不变量(本轮要守住的根)

> **跟银行对账的层 = Settlement / internal-transfer 层,必须等于真实银行划转。客户记账层(gross+fee)对的是 Trade,不跟银行逐笔对。**
>
> **每一笔 fee 收入 ⟺ 一条 funds-layer 资金腿 ⟺ 一笔真实账户划转**(fee 不能只记账而无资金腿,否则收入悬空)。

资金平账(IN swap):`F_LIQ` 付出 = net(→VIBAN) + fee(→F_FEE) + spread(→F_FEE) = gross;F_LIQ 收到 gross 等值 → 净额 ≈ 0 ✓。

## 改动

| 文件 | 改动 |
|---|---|
| `fiat-settlement-workflow.service.ts` | `onSwapSucceeded`:IN/OUT 均交割 `o.amount`(net);删除 swapFee 查询与 `net.plus(swapFee)`;更新注释 |
| `fiat-fee-collection-workflow.service.ts` | `collectSwapFees`:服务费腿 `C_VIBAN→F_FEE` 改为 `F_LIQ→F_FEE`(与 spread 同为公司侧);**提现费腿不变**(`C_VIBAN→F_FEE`,物理上确实从客户 VIBAN 扣) |
| `internal-transfer-paths.constant.ts` | `FIAT_FEE_COLLECT` 的 `trigger` 由 `['SWAP','WITHDRAW']` 改为 `['WITHDRAW']`(swap 不再走它) |

**标签说明:** 白名单按角色对索引,`F_LIQ→F_FEE` 唯一对应 `FIAT_SPREAD_COLLECT`。故 swap 服务费与 spread **共用 pathLabel `FIAT_SPREAD_COLLECT`**,靠 `sourceId`(`:FEE` / `:SPREAD`)+ `sourceType`(`FIAT_FEE_COLLECTION`)区分。不重命名 enum(避免孤立旧 pathLabel 行)。

## 不变量速查
- 仅改资金腿金额/来源 + 一处 trigger;**不动** accounting service、Outstanding producer、记账(gross)。
- 提现费仍 `C_VIBAN→F_FEE`(客户侧,正确);仅 swap 服务费改公司侧。
- TDD:先改 2 个 spec 断言 Model A(net 交割 + 服务费走 F_LIQ),红 → 改代码 → 绿。

# 设计 · 法币地址门改为 onboarding 式大拦截（交易起始前置门 iteration 2）

Date: 2026-07-11 ｜ Status: Draft（待评审）｜ 来源: iteration 1 验收反馈（甲方）+ brainstorming（本会话）

> iteration 1（[`2026-07-11-trading-start-preconditions-design.md`](2026-07-11-trading-start-preconditions-design.md)）已实现并验收。验收发现 3 点，据此把前端门形态从「逐动作弹窗」收敛为「onboarding 式路由级大拦截」。

---

## 1. 背景：验收发现的三点

1. **crypto 提现地址门缺口**：`withdrawal-address-workflow.service.ts → registerAddress`（crypto）只校验 `onboardingStatus==='APPROVED'`，**不看法币地址就绪**。故无 active 法币地址的客户仍能登记 crypto 提现地址。
2. **兑换 R4 预检 CTA 路由错**：`Swap.tsx` 的"创建收款账户"CTA 现 `navigate('/wallet')`，应改 `/deposit`（收款账户=充值地址，Deposit 页是更自然的落点）。
3. **门形态决策**：iteration 1 用逐动作 `TradingGateModal`（4 处 wiring），门散落易漏（点 1 即活证据）。改为 **onboarding 式大拦截**——和 onboarding 同一层、同一心智（认证引导 vs 业务配置引导）。

## 2. 锁定决策（brainstorm）

| # | 决策 | 选择 |
|---|---|---|
| E1 | 门形态 | **onboarding 式路由级大拦截**（扩 AuthGuard），取代逐动作弹窗 |
| E2 | 引导落点 | **复用 `/withdrawal-addresses` + 首次引导态**（不新建页）|
| E3 | crypto 地址门 | 设置页引导 + **后端 `registerAddress` 加 `assertTradingReady` 硬门兜底**；`registerBankAccount`(fiat) 不设门（引导起点）|
| E4 | R4 swap 逐币预检 | **保留**（细门，与法币大门是两回事），仅改 CTA 路由 → `/deposit` |
| E5 | 后端硬门 | 全部**保留**（UI 非唯一边界）|

## 3. 设计

### 3.1 前端 readiness 路由门（扩 `AuthGuard`）
`AuthGuard.tsx` 现已为未认证客户硬拦业务路径（`blockedPaths = ['/deposit','/withdraw','/swap','/wallet/send']`）并引导 `/verification`。加**第二级**：
- 已认证（onboardingStatus=APPROVED）但 `!tradingReady`（无 active 法币地址，读 `useTradingReadiness`）→ 拦业务路径 → **重定向到 `/withdrawal-addresses`**。
- **readiness 门拦截路径集**（与 onboarding 门的 `/wallet/send` 略不同）：`/deposit`、`/swap`、`/withdraw`、`/wallet`（建收款账户 C_DEP/C_VIBAN 也需就绪，故拦整个 WalletManagement 的创建入口，不止 `/wallet/send`）。
- 三态链：`未认证 → /verification`｜`已认证无法币地址 → /withdrawal-addresses`｜`都齐 → 业务放行`。
- 顺序：先过 onboarding 级（现有），再过 readiness 级。`/profile`、Overview 不拦；`/withdrawal-addresses` 是落点不拦。
- readiness 加载中不误拦（loading 时放行/占位，同 iteration 1 的 `!loading && !ready` 语义）。
- 锚点：`client-web/src/components/AuthGuard.tsx`（新增 readiness 分支）｜ `hooks/useTradingReadiness.ts`（复用）。

### 3.2 `/withdrawal-addresses` 首次引导态 + crypto 入口门
- 无 active 法币地址时，页顶引导条/空态：「先添加一个法币提现地址，才能开始充值 / 兑换 / 提现」+ 高亮"添加银行账户"入口。
- **crypto 提现地址添加入口**：无 active 法币地址时禁用 + 提示"请先添加法币提现地址"。
- 后端 `registerAddress`（crypto）入口前置 `assertTradingReady`（无 active 法币地址 → `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`）兜底。
- 锚点：`client-web/src/pages/WithdrawalAddresses.tsx`｜ `withdrawal-address-workflow.service.ts → registerAddress()`。

### 3.3 拆逐动作弹窗（回退 iteration 1 Task 11）
- 从 `Deposit.tsx`/`Withdraw.tsx`/`Swap.tsx`/`WalletManagement.tsx` **移除** `TradingGateModal` 的 4 处 wiring（被路由门取代）。
- **删除** `components/TradingGateModal.tsx`（不再有消费方）。
- **保留** `hooks/useTradingReadiness.ts`（路由门 + swap 预检消费）。
- 后端硬门（`assertTradingReady` on WITHDRAW/SWAP + `createOrReturn` + 新增 crypto 地址门）**全留**。

### 3.4 点 2：R4 swap CTA 改路由
- `Swap.tsx` 逐币预检（Task 12）保留；仅 `navigate('/wallet')` → `navigate('/deposit')`。
- 锚点：`client-web/src/pages/Swap.tsx`（CTA onClick）。

## 4. 影响面
改：`AuthGuard.tsx`（+readiness 级）、`WithdrawalAddresses.tsx`（引导态 + crypto 入口门）、`Deposit/Withdraw/Swap/WalletManagement.tsx`（删 modal wiring）、`Swap.tsx`（CTA 路由）、`withdrawal-address-workflow.service.ts`（registerAddress 加门）。删：`TradingGateModal.tsx`。文档：truth v3/v5（提现地址门）同步。

## 5. 边界 case
- **循环重定向防护**：readiness 门重定向到 `/withdrawal-addresses`，该路径**绝不**被 readiness 门拦（否则死循环）。同理 `/verification` 不被拦。
- **刚加完法币地址**：加成功（首地址即 ACTIVE）后 readiness 立即 true → 客户可回业务页（前端 refetch readiness 或跳转触发重判）。
- **crypto-only 客户**：即便客户只想提 crypto，也须先有一个法币地址（甲方明确）——引导态说明"法币提现地址是所有业务的前置"。
- **readiness 接口失败**：fail-safe——加载失败时倾向"不误拦"（放行 + 让后端硬门兜底），避免接口抖动把客户锁死在设置页。

## 6. 非目标
1）后端 gate 逻辑重写 —— iteration 1 已实现，本轮只加 crypto 地址门一处。
2）R4 逐币预检逻辑改动 —— 只改 CTA 路由。
3）充值挂起重驱、在途守卫 FK —— 仍在 BACKLOG，不在本轮。

## 7. 验收标准
□ 已认证但无 active 法币地址的客户，直接访问 /deposit /swap /withdraw /wallet → 被重定向到 /withdrawal-addresses（不再是逐动作弹窗）
□ /withdrawal-addresses 无地址时显示引导态；crypto 地址添加入口禁用+提示；加法币地址入口高亮
□ crypto 提现地址创建后端被 `assertTradingReady` 拦（无 active 法币地址 → NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS）；fiat 地址创建不被拦
□ 加第一个法币地址（即 ACTIVE）后，业务路径全部放行
□ `TradingGateModal` 已删、4 业务页无残留 wiring；`useTradingReadiness` 保留
□ swap 逐币预检 CTA 跳 /deposit（非 /wallet）
□ /withdrawal-addresses 与 /verification 不被 readiness 门拦（无重定向死循环）
□ 后端硬门（WITHDRAW/SWAP/建收款账户/crypto 地址）全部仍生效

## 8. 关键锚点
`client-web/src/components/AuthGuard.tsx` ｜ `client-web/src/hooks/useTradingReadiness.ts` ｜ `client-web/src/pages/{WithdrawalAddresses,Deposit,Withdraw,Swap,WalletManagement}.tsx` ｜ `client-web/src/components/TradingGateModal.tsx`（删）｜ `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts → registerAddress()`

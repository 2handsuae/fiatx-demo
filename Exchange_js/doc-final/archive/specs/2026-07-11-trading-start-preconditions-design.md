# 设计 · 交易起始前置门（法币提现地址 + 收款账户就绪化）

Date: 2026-07-11 ｜ Status: Draft（待评审）｜ 来源: brainstorming（本会话）

> 优化提现地址与托管钱包的**起始流程**。因 Zand Bank（法币托管方）约束：客户开展任何业务前，必须先有一个可用的法币出金落点（银行账户）。

---

## 1. 背景与动机

现状：交易资格门 `assertTradingEligibility(customerId, action)`（`onboarding.service.ts:1342`，action ∈ DEPOSIT/WITHDRAW/SWAP）只校验三轴态（onboarding=APPROVED、adminStatus=ACTIVE、complianceStatus≠FROZEN + restrictions），**不看提现地址、不看收款账户**。三处调用：充值信号（`inbound-transfer-signals.service.ts`）、提现创建+报价、兑换下单+成交。

要解决四件事（甲方 2026-07-11 定）：
- **R1/R2** — 客户没有 ≥1 个 **ACTIVE 法币提现地址**时，**任何业务不得开启**（充值/提现/兑换全拦）；客户端在业务触发点用弹窗拦截。
- **R3** — 完善提现地址的**客户侧停用**（软删归档）；admin 侧本次不加。
- **R4** — 兑换窗：客户没有该币种的 `C_DEP`/`C_VIBAN` 收款账户时，提示去创建、不能直接兑换（**买入+卖出两侧都校**）。

## 2. 核心模型：两个不同实体 + 依赖链

必须分清（易混）：

| 概念 | 是什么 | 实体 | 方向 |
|---|---|---|---|
| **法币提现地址**（R1/R2） | 客户的外部银行账户 | `WithdrawalAddress`（addressType=BANK，`registerBankAccount`） | 法币**出金**落点 |
| **收款账户 C_DEP / C_VIBAN**（R4） | 客户的托管收款钱包 | `Wallet`（walletRole=C_DEP/C_VIBAN，`customer-deposit-wallet`） | 资金**进来**/余额持有 |

新依赖链（onboarding 之后）：

```
onboarding APPROVED
  └─▶ ① 登记法币提现地址(银行账户) — 第一个免冷却即 ACTIVE     ← R1/R2 总闸
         └─▶ ② 有 active 法币地址 = "可交易"，才能创建 C_DEP/C_VIBAN 收款账户   ← 依赖链②
                └─▶ ③ 充值 / 提现 / 兑换（兑换另需两侧收款账户，R4）
```

## 3. 锁定决策

| # | 决策 | 选择 |
|---|---|---|
| D1 | 法币地址门拦哪些业务 | **全部**（充值 crypto+fiat / 提现 / 兑换） |
| D2 | 首个法币地址冷启动 | **第一个免冷却**（登记即 ACTIVE）；之后新增照常 24h |
| D3 | 兑换收款账户校验侧 | **买入 + 卖出 两侧都校** |
| D4 | 删最后一个 active 法币地址 | **硬拦**，不允许 |
| D5 | 架构 | **甲**：通用闸并入 `assertTradingEligibility` + 只读就绪接口 + 前端拦截；兑换逐币校验放兑换流专属闸 |
| D6 | 依赖链② | **是**：无 active 法币地址不能建 C_DEP/C_VIBAN |
| D7 | R3 范围 | **仅客户侧停用**；admin suspend/reactivate 本次不动 |

## 4. 设计（6 件）

### 4.1 法币地址总闸（R1/R2）— 后端
`assertTradingEligibility` 增一条校验：该客户存在 ≥1 个 `status=ACTIVE` 且 `addressType=BANK` 的 `WithdrawalAddress`。缺 → 抛 `TRADING_NOT_READY / NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`。三业务全覆盖（改一处、全域生效）。
- **依赖链②落点（充值的实际拦截点）**：创建 C_DEP/C_VIBAN 的 `customer-deposit-wallet.createOrReturn` 入口前置同一条法币地址校验——无 active 法币地址则**拒建收款账户**。因充值靠 C_DEP/C_VIBAN 收款，这一步就把充值挡在"钱没动"之前。
- **到账信号阶段**（客户绕过前端、钱已进）：见 §6 边界 case（挂 suspense 待补）。
- 锚点：`onboarding.service.ts → assertTradingEligibility()`（抽一个共享 `assertTradingReady(customerId)` 供 createOrReturn 复用）。

### 4.2 首地址免冷却（D2）— 后端
`registerBankAccount`：若该客户当前**无**任何 `addressType=BANK` 且 status ∈ {PENDING_ACTIVATION, ACTIVE} 的地址 → 登记即置 `ACTIVE`（跳 24h 冷却）；否则照常 `PENDING_ACTIVATION` + `activatesAt = now + 24h`。审计记 `skipCooling=firstFiatAddress`。
- 理由：此时账户无余额、无盗提风险；且 D4 硬拦保证客户不会再跌回"零 active 法币地址"（除非 admin suspend），故"首个"= onboarding 期首次登记。
- 锚点：`withdrawal-address-workflow.service.ts → registerBankAccount()` ｜ `withdrawal-address.service.ts`（`COOLING_PERIOD_HOURS`、`createBankAccount`）。

### 4.3 交易就绪只读接口 — 后端 + 前端契约
`GET /me/trading-readiness` → `{ tradingReady: boolean, hasActiveFiatWithdrawalAddress: boolean }`。
`GET /me/receiving-accounts?assets=<A,B>` →（兑换窗用）`{ [assetCode]: { hasReceivingAccount: boolean } }`。
前端据此决定弹窗，**不靠"点了才报错"**。

### 4.4 兑换逐币闸（R4，D3）— 后端 + 前端
- **后端**（硬闸）：兑换流在 `assertTradingEligibility(SWAP)` 之后，校验**买入侧 + 卖出侧**币种各自都有该客户 `status=ACTIVE` 的 `C_DEP`(crypto)/`C_VIBAN`(fiat) 钱包；缺 → 抛 `RECEIVING_ACCOUNT_REQUIRED`（带缺哪个 assetCode）。锚点：`swap-workflow.service.ts → executeSwap()`（`:185` 门后）。
- **前端**（兑换窗）：预检 `receiving-accounts` → 缺则**提示去创建**（跳收款账户创建流），禁止提交；**不静默自动建**（建 C_VIBAN/C_DEP 会真在 Zand/HexTrust 开户，须客户显式动作）。

### 4.5 客户侧地址停用（R3，D4，D7）— 后端 + 前端
- 新客户端端点 `POST /withdrawal-addresses/:addressNo/deactivate`：ACTIVE → 新终态 `DEACTIVATED`（软删归档，**留存 8 年不物理删**，`deactivatedBy=CUSTOMER`）。
- **守卫**：① 若这是该客户**最后一个 ACTIVE 法币地址** → 拒（`LAST_ACTIVE_FIAT_ADDRESS`，要换先加新的顶上）；② 该地址有**在途提现**（非终态 funds_order 引用）→ 拒。
- admin `suspend`/`skip-cooling` 现状**不动**；不加 reactivate。
- 锚点：`withdrawal-address-workflow.service.ts`（新增 `deactivateAddress`）｜ `withdrawal-address.controller.ts`（新端点）｜ `withdrawal-address.service.ts`。

### 4.6 前端拦截点（R1 客户端）— 前端
未 `tradingReady` 时，在业务入口弹窗拦截 + CTA「去创建法币提现地址」：
- `Deposit.tsx`（含查看/生成收款地址前）｜ `Swap.tsx` ｜ `Withdraw.tsx` ｜ `WalletManagement.tsx`（创建 C_DEP/C_VIBAN 入口）。
- 弹窗走 AuthGuard 式"受阻但有引导"风格（`frontend-client.md`）；不作为唯一权限边界（后端硬闸兜底）。

## 5. 数据模型影响

- `WithdrawalAddress`：新增终态 `DEACTIVATED` + 字段 `deactivatedAt` / `deactivatedBy`（沿用 SUSPENDED 的字段风格）。状态全集：`PENDING_ACTIVATION / ACTIVE / CANCELLED / SUSPENDED / DEACTIVATED`。
- `Wallet`：无 schema 变更（C_DEP/C_VIBAN 已存在）。
- 审计：`WITHDRAWAL_ADDRESS_REGISTRATION` 增 `ADDRESS_DEACTIVATED`（客户停用）；`registerBankAccount` 首地址 skip-cooling 走既有 `ADDRESS_REGISTERED` + metadata 标记。

## 6. 边界 case（spec 已定，实施照此）

- **充值到账信号阶段客户不就绪**（绕过前端直转、钱已进）：**不入账，挂 DEPOSIT_SUSPENSE 待补齐**（客户补齐 active 法币地址后放行）；不退回（法币退汇复杂、crypto 到账不可逆）。`inbound-transfer-signals` 的 `assertTradingEligibility(DEPOSIT)` 保留作兜底，命中改为"挂起待补"而非直接拒。
- **"首个法币地址"判定**：以 `count(addressType=BANK, status∈{PENDING_ACTIVATION,ACTIVE}) == 0` 为准。
- **并发登记两个法币地址**：仅第一个落库的免冷却（事务内取计数）；第二个 24h。
- **D4 与 admin suspend 交互**：admin 若 suspend 掉客户最后一个 active 法币地址（治理越权，允许）→ 客户随即掉出就绪、业务被 R1 拦，符合预期。

## 7. 非目标（Not In Scope）

1）admin 侧提现地址 suspend 增强 / reactivate —— 本次不做（D7）。
2）系统级托管钱包（平台自有收款账户）的审批式开立（路径A）—— 另行定义。
3）提现流程本身的记账/合规链路 —— 见 V5 提现，不在本设计。
4）自动建收款账户 —— 明确不做，客户显式创建（D3）。

## 8. 验收标准

□ 无 active 法币提现地址时，充值/提现/兑换后端全部被 `assertTradingEligibility` 拦（三业务各验一次）
□ 客户端 Deposit/Swap/Withdraw/WalletManagement 入口未就绪时弹窗拦截 + CTA 去创建
□ 首个法币提现地址登记即 ACTIVE（无 24h 等待）；第二个及以后 24h 冷却
□ 依赖链②：无 active 法币地址时创建 C_DEP/C_VIBAN 被拒
□ 兑换买入+卖出任一侧缺 C_DEP/C_VIBAN → 后端拒（RECEIVING_ACCOUNT_REQUIRED）+ 前端提示去创建、禁提交
□ 客户可停用（软删归档）自己的 ACTIVE 地址；删最后一个 active 法币地址被硬拦；有在途提现的地址不可停用
□ 停用为归档（DEACTIVATED），8 年留存不物理删；有审计（ADDRESS_DEACTIVATED）
□ 充值绕过前端、钱已进但不就绪 → 挂 suspense 待补，不入账、不静默丢失
□ admin suspend/skip-cooling 行为不变（本次未动）

## 9. 关键锚点（供 plan 定位）

`identity/onboarding/onboarding.service.ts → assertTradingEligibility()` ｜ `trading/deposit-transactions/inbound-transfer-signals.service.ts` ｜ `asset-treasury/wallets/customer-deposit-wallet.service.ts → createOrReturn()` ｜ `asset-treasury/withdrawal-addresses/{withdrawal-address-workflow,withdrawal-address}.service.ts` + `withdrawal-address.controller.ts` ｜ `trading/swap-transactions/swap-workflow.service.ts → executeSwap()` + `swap-transactions-customer.controller.ts` ｜ `audit-logging/constants/audit-actions.constant.ts`（WITHDRAWAL_ADDRESS_REGISTRATION）｜ 前端 `client-web/src/pages/{Deposit,Swap,Withdraw,WalletManagement,WithdrawalAddresses}.tsx`

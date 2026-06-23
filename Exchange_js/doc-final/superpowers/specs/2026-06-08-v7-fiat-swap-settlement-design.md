# V7 法币 Swap 交割（Fiat Settlement）— Design

> 状态：设计收口（pre-implementation）
> 关联：[[2026-06-03-v7-internal-transfer-crypto-mvp-design]]（crypto EOD 结算）、`reference/v7-funds-layer-baseline.md`
> 适用：V6 swap 成交后，法币（FIAT）那一腿的真实银行交割。Crypto 腿仍走 EOD 轧差，不受影响。
> **⚠️ 钱包漂移修正（2026-06-21，以 live code 为准）**：本文 §中所有 `F_LIQ`（FIAT_SETTLE_OUT/IN 的 `route` 端点、`F_SET`/`F_LIQ` 平台账户）已改 **`F_OPS`**——`FIAT_SETTLE_OUT route=['C_VIBAN','F_SET','F_OPS']`、`FIAT_SETTLE_IN=['F_OPS','F_SET','C_VIBAN']`；`F_LIQ` 退出结算路径，seed 系统钱包仍含 F_LIQ（流动性，不入路由）。源 `internal-transfer-paths.constant.ts`。两跳结构（经 F_SET）与 drain→**两本账 mirror** 取代逻辑见 `2026-06-10-two-book-accounting-design.md`。

---

## 1. 目标与核心决策

V6 swap 每笔成交都会为两腿各建一个 Outstanding（`OUT/fromAsset`、`IN/toAsset`，owner=客户）。
其中 **FIAT 腿**因 ZandBank 的**客户资产隔离**政策，无法像 crypto 那样在 EOD 跨客户池级轧差——
每个客户的法币物理停在各自的 VIBAN 里，必须**逐笔、逐 VIBAN** 交割。本设计交付这条法币交割链路。

| # | 决策 | 选择 |
|---|---|---|
| D1 | 结算节奏 | **Per-swap 即时**（非 EOD 轧差）。swap 成交即结算该笔 FIAT outstanding |
| D2 | 触发方式 | **事件驱动**：swap 事务提交后 emit `SWAP_SUCCEEDED` → `FiatSettlementWorkflowService` 监听即时结算。OPEN fiat outstanding 为持久兜底工作项 |
| D3 | 物理路径 | **两跳**，经 settlement 账户中转（隔离边界）：见 §2 |
| D4 | 数据建模 | per-swap **1 SettlementBatch**；常见单法币腿 = `1 batch ↔ 1 Outstanding ↔ 1 InternalTransaction → 2 InternalFund`（复用 1:N transfer→fund 容器）。双法币腿见 §4 |
| D5 | TB 记账 | F_SET **不进 TB**；`TRADE_CLEARING↔BANK` 在 transfer SUCCESS 时 drain **一次**（非 initiate 时）|
| D6 | fund 状态机 | 复用 Payout 的 `FIAT_TRANSITIONS` 模式，按 `asset.type` 选择，**零 enum/migration 改动** |

**本轮范围**：仅**交割**（`FIAT_SETTLE_IN/OUT`）。手续费归集（`F_FEE`）不做，`F_FEE` 仅 seed 占位。

---

## 2. 钱包角色与物理路径

### 2.1 角色（复用既有 `WalletRole` 分类，仅新增两个）

| 角色 | 归属 | 说明 | 状态 |
|---|---|---|---|
| `C_CMA` | PLATFORM/FIAT | 法币客户资金主账号（VIBAN 之上的汇总，**查询用，不入路径**）| 复用 |
| `C_VIBAN` | CUSTOMER/FIAT | 客户虚拟资金账号，负责入/出金（交割源/目标）| 复用（V4 已建）|
| `F_LIQ` | PLATFORM | 公司流动性账号 | 复用 |
| `F_OPS` | PLATFORM | 运营资金账号 | 复用 |
| `F_SET` | PLATFORM/FIAT | **settlement 中转账户**（隔离边界 pivot）| **新增** |
| `F_FEE` | PLATFORM/FIAT | 手续费归集账号 | **新增（仅 seed 占位）** |

> `C_CMA` 即用户口述的「C_MAIN 法币主账号」；为避免与 crypto 的 `C_MAIN` 语义重载，复用既有 `C_CMA` 名。

### 2.2 方向 → 两跳路由（`C_CMA` 永不参与）

| Outstanding 方向 | 语义 | 路由 | pathLabel |
|---|---|---|---|
| `OUT` | 客户**卖出**法币 | `C_VIBAN(客户) → F_SET → F_LIQ` | `FIAT_SETTLE_OUT` |
| `IN` | 客户**买入**法币 | `F_LIQ → F_SET → C_VIBAN(客户)` | `FIAT_SETTLE_IN` |

`C_VIBAN` 按 outstanding 的 `ownerId`（客户）解析；`F_SET`/`F_LIQ` 为平台账户。

---

## 3. 结算流程与时序

```
[swap 事务提交] ──emit SWAP_SUCCEEDED(swapId, ownerId)
      │
FiatSettlementWorkflowService.@OnEvent
      │  取该 swap 的 OPEN 且 asset.type=FIAT 的 outstanding（幂等：已 LOCKED/SETTLED 跳过）
      ▼
  创建 SettlementBatch(settlementType='FIAT_SWAP')
  创建 InternalTransaction(pathLabel=FIAT_SETTLE_IN/OUT, class B, medium BANK, settlementBatchId)
  一次性创建 2 个 InternalFund：
      hop1 (CREATED, 可执行)        hop2 (CREATED, 挂起 —— 不发 SUBMIT)
  lock outstanding → LOCKED(settledByTransferId=transfer)
      ▼
  驱动 hop1: CREATED ─SUBMIT→ CONFIRMING ─CONFIRM→ CONFIRMED   (钱到 F_SET)
      │
   监听 fundsflow.status.changed: hop1==CONFIRMED → 放行 hop2 SUBMIT
      ▼
  驱动 hop2: CREATED ─SUBMIT→ CONFIRMING ─CONFIRM→ CONFIRMED
      │
   两 fund 均 CONFIRMED → syncStatusFromFunds: every(CONFIRMED/CLEAR) → transfer SUCCESS
                        → autoClearConfirmedFunds: 两 fund CONFIRMED→CLEAR
      ▼  (transfer 进入 SUCCESS, 两 CLEAR 事件触发收尾, 幂等一次)
  (a) TB drain  TRADE_CLEARING(ccy) ↔ BANK(ccy)  一次
  (b) Outstanding → SETTLED (closedByInternalFundId = hop2)
  (c) recomputeBatch → batch SUCCESS
```

**顺序保证**：hop2 在 `CREATED` 挂起，aggregation `every(CONFIRMED/CLEAR)` 因 hop2=CREATED 恒为 false → transfer 不会提前 SUCCESS。workflow 仅在 hop1 `CONFIRMED` 后才对 hop2 发 `SUBMIT`。

---

## 4. 数据模型（每个法币 swap 腿）

`1 SettlementBatch ↔ 1 Outstanding ↔ 1 InternalTransaction → 2 InternalFund`

- 复用既有 1:N `InternalTransaction.funds InternalFund[]` 容器（此前一直 1:1 未用到 N）。
- `recomputeBatch` 已支持 N transfer / N outstanding，可正确计 1 transfer · 1 outstanding。
- **双法币腿 swap**（如 AED↔USD）：同 1 batch 挂 2 transfer，每 transfer 各自两跳，天然支持。

---

## 5. Fund 状态机（FIAT_TRANSITIONS）

参照 `PayoutsService` 的 `FIAT_TRANSITIONS` 模式：**一套状态枚举 + 按 `asset.type` 选 transition map**。
`InternalFundAction` 已含 `SUBMIT`/`RETURN`，`InternalFundStatus` 已含全部状态 → **零 DTO/migration 改动**。

```
FIAT_TRANSITIONS (InternalFund):
  CREATED    : { SUBMIT  → CONFIRMING, CANCEL → CANCELLED }
  CONFIRMING : { CONFIRM → CONFIRMED,  FAIL → FAILED, TIMEOUT → TIMEOUT }
  CONFIRMED  : { CLEAR   → CLEAR,      RETURN → RETURNED }
  CLEAR      : { RETURN  → RETURNED }            // 结算后银行退回 (bounce)
  FAILED / TIMEOUT / RETURNED / CANCELLED : {}   // terminal
```

`FundsFlowService.getTransitionMap(assetType)` 已接受 `assetType`（现忽略）→ 改为
`assetType==='FIAT' ? FIAT_TRANSITIONS : CRYPTO_TRANSITIONS`。`updateStatus` 已传 `item.asset?.type`。

---

## 6. TB 记账

- **Swap 本身不动**：AED 腿在 V6 已记 `CLIENT_CREDIT/TRADE_CLEARING/FEE_RECEIVABLE`。
- **Drain 时点**：transfer 进入 `SUCCESS`（两 fund CLEAR）时，由 `FiatSettlementWorkflowService` 调用，
  **非** crypto 那样在 `initiate` 时。crypto 路径保持 initiate 调用不变。
- **Drain 对手账户**：⚠️ `FundsAccountingService.applyAccounting` 现把对手方**硬编码为 `CUSTODY`(10)**；
  法币资产只有 `BANK`(1) 系统账户、**无 CUSTODY** → 现状对 FIAT 会直接 throw。
  必改为 `asset.type==='FIAT' ? BANK : CUSTODY`。方向仍由 `TRADE_CLEARING` 余额符号自驱。
- **幂等**：两 CLEAR 事件并发到达 → 收尾须幂等（outstanding 已 `SETTLED` 则跳过 drain/settle；
  或检查该 transfer 是否已有 drain 凭证）。

---

## 7. 白名单 / 路径常量

- 新增 `TransferMedium.BANK`。
- `TRANSFER_PATH_WHITELIST` 加两条**多跳路由**（`route: string[]` 取代单一 from/to）：
  - `FIAT_SETTLE_OUT`: `route=['C_VIBAN','F_SET','F_LIQ']`, class B, drain `TRADE_CLEARING`, medium BANK, trigger `['SWAP']`
  - `FIAT_SETTLE_IN` : `route=['F_LIQ','F_SET','C_VIBAN']`, class B, drain `TRADE_CLEARING`, medium BANK, trigger `['SWAP']`
- `WhitelistGuard` 扩展：按 route 逐跳校验相邻对；非白名单立即拒绝、不建 fund。
- 2 个 fund 的 per-hop `fromWalletId/toWalletId` 由 route 相邻项推出。

---

## 8. 三层归属（backend-platform 规则）

| 层 | 组件 | 职责 |
|---|---|---|
| L1 domain | `InternalTransferService` / `FundsFlowService` / `SettlementBatchService` / `OutstandingConsumerService`(+fiat 方法) | 单表数据 ops，写方法接 `tx`；不写业务/journey 审计 |
| L3 workflow | **新** `FiatSettlementWorkflowService` | 监听 `SWAP_SUCCEEDED` + 顺序两跳编排 + 完成时 drain/settle/recompute；写 journey 审计 |
| 触发 | `SwapWorkflowService` | 提交后 emit `SWAP_SUCCEEDED`（注入 `EventEmitter2`）|

> 不变量（CLAUDE.md 规则 5）：workflow 不直接写 domain 表，全走 L1 service 方法。

---

## 9. Seed 改动

- **修复既有漂移**：`seed.business.ts` 现对 FIAT 资产建系统钱包用 `[C_MAIN, C_OUT, F_LIQ, F_OPS]`，
  与模块自身分类矛盾（`C_MAIN/C_OUT` 为 crypto-only）。改为 **`[C_CMA, F_SET, F_FEE, F_OPS, F_LIQ]`**（`FIAT_BANK` 型 + IBAN）。crypto 不动。
- `WalletRole` enum / `WALLET_ROLE_POLICIES` / `FIAT_SYSTEM_WALLET_ROLES` / `PLATFORM_POOL_ROLES`：加 `F_SET`、`F_FEE`（PLATFORM, FIAT）。
- `walletRole`、`settlementType` 在 schema 中均为 `String` → **加角色/类型无需 migration**。
- **Demo seed**：一个带 AED `C_VIBAN`(+余额) 的客户 + 一笔 OPEN FIAT outstanding，供 live demo（仿 `seed-eod-demo.ts`）。

---

## 10. 错误与边界

- **hop1 FAIL/TIMEOUT**：transfer FAILED，outstanding 回 OPEN（解锁）→ repair surface / 重试；钱未离开 VIBAN。
- **hop2 FAIL/TIMEOUT**：钱卡在 F_SET → transfer FAILED + repair surface（人工把 F_SET 资金推进或退回 VIBAN）。
- **RETURN（结算后银行退回）**：fund `CLEAR→RETURNED`；偿付/追偿归 V8 对账，本轮仅状态可达 + 审计留痕。
- **事件丢失**：OPEN fiat outstanding 持久 → 低频 cron sweep 兜底（本轮可只留接口，不接 cron）。
- **幂等**：`sourceType=FIAT_SETTLEMENT` + `sourceId=swapId:outstandingId` 去重；重跑已 SETTLED 跳过。

---

## 11. Out of Scope（本轮不做）

- 法币**手续费归集**（`FEE_COLLECT` / `F_FEE` drain `FEE_RECEIVABLE`）——`F_FEE` 仅 seed。
- 法币**归集**（VIBAN→集中账户）——银行自理，不在平台。
- 偿付义务（RETURN 后的追偿结清）——归 V8。
- 低频兜底 cron 的实际接线（留接口）。

---

## 12. 交付清单（改动面）

| 文件 | 改动 |
|---|---|
| `trading/swap-transactions/swap-workflow.service.ts` | 提交后 emit `SWAP_SUCCEEDED` |
| `common/events/domain-events.constants.ts` | 加 `SWAP_SUCCEEDED` 事件名 |
| **新** `funds-layer/workflow/fiat-settlement-workflow.service.ts` | 监听 + 两跳编排 + 完成收尾 |
| `funds-layer/domain/outstanding-consumer.service.ts` | 加 fiat 方法：按 swap 找 OPEN FIAT outstanding / lock / settle |
| `funds-layer/constants/internal-transfer-paths.constant.ts` | `TransferMedium.BANK` + 2 条 route 路径 |
| `funds-layer/guards/whitelist.guard.ts` | route 逐跳校验 |
| `funds-layer/accounting/funds-accounting.service.ts` | FIAT→drain 对手用 `BANK`；改由 fiat workflow 完成时调用 |
| `funds-layer/domain/funds-flow.service.ts` | `FIAT_TRANSITIONS` + `getTransitionMap` 按 type 分支；fiat 模拟推进端点 |
| `funds-layer/domain/system-wallet-resolver.service.ts` | 客户 `C_VIBAN` 解析（ownerId+assetId+CUSTOMER）|
| `asset-treasury/wallets/dto/wallet.dto.ts` + `wallet-role-policies.constant.ts` + `system-wallet.util.ts` | 加 `F_SET`/`F_FEE` |
| `prisma/seed.business.ts` | 修复 FIAT 系统钱包角色集 |
| `scripts/seed-fiat-settle-demo.ts` | live demo 铺底 |

---

## 13. 不变量速查

- 法币交割 = `1 batch · 1 outstanding · 1 transfer · 2 fund`，per-swap 即时，**不跨客户轧差**。
- `C_CMA` 查询用，永不入路径；交割实际动 `C_VIBAN ↔ F_SET ↔ F_LIQ`。
- TB 只认 `BANK(=VIBAN/C_CMA)`、`TRADE_CLEARING`、`FEE_RECEIVABLE`；`F_SET`/`F_LIQ` 在托管边界外。
- drain `TRADE_CLEARING↔BANK` 在 transfer SUCCESS 时一次，符号自驱方向。
- crypto EOD（`type=CRYPTO`）与 fiat（`type=FIAT`）两套引擎，共享 batch/outstanding/funds-flow 原语，互不干扰。

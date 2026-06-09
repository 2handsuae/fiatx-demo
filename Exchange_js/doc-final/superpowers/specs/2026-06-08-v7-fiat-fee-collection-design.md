# V7 法币手续费归集（Fiat Fee Collection）— Design

> ⚠️ **部分被取代（2026-06-09，Model A）**：本文档"swap 服务费 `C_VIBAN→F_FEE` + IN 交 gross"的部分已被 `2026-06-09-fiat-net-settlement-model-a-design.md` 取代 —— swap 服务费改为**公司侧** `F_LIQ→F_FEE`、IN 交割只交 net。**提现费 `C_VIBAN→F_FEE` 仍按本文档有效。**
> 状态：设计收口（pre-implementation）
> 关联：[[2026-06-08-v7-fiat-swap-settlement-design]]（法币 swap 交割）、`reference/v7-funds-layer-baseline.md`
> 适用：swap 兑换费/点差 + 提现费的法币（FIAT）归集。crypto 归集（C_MAIN→F_OPS 池级 drain）不在范围。

---

## 1. 目标与核心决策

所有法币手续费最终都沉淀在 `FEE_RECEIVABLE(currency)`（TB），但**物理现金**位置不同，归集路径随之不同。全部 **per-event、无 cron**（与法币 per-swap 即时结算一致；客户资产隔离禁止跨客户 EOD 轧差）。

| 费种 | TB 记账（V5/V6 已存在） | 物理现金位置 | 真实归集路径 | 触发 |
|---|---|---|---|---|
| 提现费 | `CLIENT_CREDIT→FEE_RECEIVABLE` | 客户 VIBAN | **C_VIBAN→F_FEE**（直连 1 跳） | payout SUCCESS |
| swap 服务费 | `CLIENT_CREDIT→FEE_RECEIVABLE` | 客户 VIBAN（**前提：结算改交 gross**） | **C_VIBAN→F_FEE**（直连 1 跳） | swap 结算 SUCCESS 后 |
| swap 点差 spread | `TRADE_CLEARING→FEE_RECEIVABLE` | F_LIQ（公司池，托管边界外） | **F_LIQ→F_FEE**（公司账间） | swap 结算 SUCCESS 后 |

| # | 决策 | 选择 |
|---|---|---|
| D1 | 节奏 | per-event，无 cron |
| D2 | 客户付的费（`CLIENT_CREDIT→FEE_RECEIVABLE` 腿）物理来源 | 客户 VIBAN → `C_VIBAN→F_FEE` 直连，逐客户 |
| D3 | 点差（`TRADE_CLEARING→FEE_RECEIVABLE` 腿）物理来源 | F_LIQ 池 → `F_LIQ→F_FEE` |
| D4 | **swap 法币结算交付额** | 改交 **gross = net + 服务费**（= swap `toAmount`），让服务费物理留在 VIBAN 可抽；**仅 FIAT**，crypto 保持 net |
| D5 | TB drain | 每笔按**指定金额**（这一笔的 fee/spread）drain `FEE_RECEIVABLE→BANK`，**非全额** |
| D6 | VIBAN→F_FEE | 直连单跳（无 F_SET pivot）；用户确认 Zand 允许 |

> 「客户支付了手续费」的记账表达 V5/V6 **已满足**（`CLIENT_CREDIT→FEE_RECEIVABLE` 腿已存在），本设计只补**物理归集**与必要的结算调整。

---

## 2. 关键改动：swap 法币结算改交 GROSS

[[2026-06-08-v7-fiat-swap-settlement-design]] 当前法币 IN 结算交付 `netToAmount`（net 到 VIBAN）。为让服务费物理留在 VIBAN：

- **法币 IN 结算交付额改为 gross = `toAmount`（= outstanding net + swap 服务费）**。客户 VIBAN：`+gross`（结算）→ `−fee`（归集）= net。
- **仅 FIAT 资产**：crypto IN 结算保持 net（crypto 费走既有池级 C_MAIN→F_OPS，不能改）。
- 点差（spread）**不进** VIBAN（它从 `TRADE_CLEARING` 计提，从来不是客户的钱）；gross = net + 服务费，**不含 spread**。
- 金额来源：`FiatSettlementWorkflowService` 通过 outstanding 的 `swapTransactionId` 读源 swap，取 `feeAmount`（服务费）与 `spreadAmount`。

---

## 3. 新白名单路径

加入 `TRANSFER_PATH_WHITELIST`（单跳、class B、medium BANK、drain `FEE_RECEIVABLE`、trigger `['SWAP','WITHDRAW']`）：

- `FIAT_FEE_COLLECT`：`C_VIBAN → F_FEE` —— 客户付的费（提现费 + swap 服务费）
- `FIAT_SPREAD_COLLECT`：`F_LIQ → F_FEE` —— swap 点差

均为 **1 InternalTransaction + 1 InternalFund**（单跳，比结算的 2 跳简单）。fund 走 `FIAT_TRANSITIONS`（CREATED→SUBMIT→CONFIRMING→CONFIRM→CONFIRMED→CLEAR）。`C_VIBAN` 按 owner 解析（`SystemWalletResolver.resolveCustomer`）；`F_FEE`/`F_LIQ` 为平台账户（`resolve`）。

---

## 4. 编排（L3，事件驱动）

### 4.1 Swap（在 `FiatSettlementWorkflowService` 内扩展）
当某 swap 的 **gross 结算 transfer 进 `SUCCESS`**（既有 `onFundsFlowStatusChanged` 完成分支里）→ 读源 swap → spawn：
1. 服务费 > 0：`FIAT_FEE_COLLECT`（`C_VIBAN→F_FEE`，amount = swap.feeAmount，owner = 该客户）。
2. 点差 > 0：`FIAT_SPREAD_COLLECT`（`F_LIQ→F_FEE`，amount = swap.spreadAmount，owner = PLATFORM）。

各自独立 transfer + 1 fund；幂等键 `sourceType=FIAT_FEE_COLLECTION` + `sourceId=<swapId>:FEE` / `:SPREAD`。

### 4.2 Withdrawal（新 handler，监听提现成功事件）
监听 **`WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT`**（payload `{ withdrawId }`，提现成功时 post-commit 发出；此时 net 已出外部、fee 已 post 进 `FEE_RECEIVABLE`、fee 留 VIBAN）→ 按 withdrawId 查 withdraw 行 → fee > 0 → spawn `FIAT_FEE_COLLECT`（`C_VIBAN→F_FEE`，amount = withdraw.feeAmount，owner = 客户）。幂等键 `sourceId=<withdrawId>:FEE`。
> ⚠️ 实现修正：`domain-events.constants` 的 `WITHDRAWAL_STATUS_CHANGED` **从未被 emit**（死事件，原 spec 误用）；提现成功真实 emit 的是 `WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT`（fiat 专属，已隐含 SUCCESS+FIAT）。订阅者按 V7 规则放在 funds-layer 的 L3 workflow。

> **只在终态成功触发**：提现 bounce/反转时不收费。

---

## 5. TB 记账（实现最敏感点）

每笔 fee-collect 在 transfer 进 `SUCCESS`（fund CLEAR）时，drain **指定金额** `FEE_RECEIVABLE → BANK`（debit `FEE_RECEIVABLE` / credit `BANK`，amount = 该笔 fee/spread）。

- ⚠️ **不能复用结算的「全额 drain」**：`FundsAccountingService.applyAccounting` 现按 `FEE_RECEIVABLE` **全部余额**符号 drain。`FEE_RECEIVABLE(AED)` 是所有费混在一起的池，per-event 必须只抽**这一笔的金额**。
  → 新增按指定金额 drain 的记账方法（如 `drainFeeReceivableAmount({ internalTransferId, amount, tx })`），或给 `applyAccounting` 加可选 `explicitAmount`。结算路径（全额 TRADE_CLEARING drain）保持不变。
- 服务费 vs 点差物理来源不同（VIBAN vs F_LIQ，后者在托管边界外），但 TB 都是同一笔金额的 `FEE_RECEIVABLE→BANK`。**实现时需用 verify-tb 脚本核对点差腿方向**（F_LIQ 边界外，确认 BANK 侧符号正确）。
- FIAT 用 `BANK`（非 CUSTODY）——`applyAccounting` 已加该分支（fiat 结算时落地）。

---

## 6. 数据模型（每笔）

- 一次 swap（含服务费 + 点差）：**1 结算 transfer（2 fund，gross）** + **1 服务费 transfer（1 fund，VIBAN→F_FEE）** + **1 点差 transfer（1 fund，F_LIQ→F_FEE）**。
- 一次提现：**1 提现费 transfer（1 fund，VIBAN→F_FEE）**。
- 这些 fee-collect transfer **不挂 SettlementBatch**（它们不是结算，是费用归集）；通过 `sourceType=FIAT_FEE_COLLECTION` + `sourceId` 关联回源 swap/withdraw。
- 对账不变量：fee 收完后 **物理 VIBAN = TB `CLIENT_CREDIT`(net)**；per-event 即时收保证两者快速对齐（收费前 VIBAN 暂为 gross，短暂高于 TB net）。

---

## 7. 错误与边界

- fee-collect 自身 fund FAIL/TIMEOUT → transfer FAILED + repair surface（钱仍在 VIBAN/F_LIQ，可重试）。
- 提现 bounce / swap 失败 → 不触发 fee-collect（只在源终态成功触发）。
- 幂等：`sourceType=FIAT_FEE_COLLECTION` + `sourceId` 去重；重跑已存在跳过。
- VIBAN→F_FEE 失败导致 VIBAN 暂留 gross（> 客户 net 应得）→ repair surface 重试，直到对齐。

---

## 8. Out of Scope（本轮不做）

- crypto 手续费归集（`C_MAIN→F_OPS` 池级 drain）—— 不变。
- 低频兜底 cron —— 全 per-event。
- `F_FEE → Ops` 的后续清分 / 提现 —— 另说。
- VAT / 税 —— baseline §6 待财务确认，不在此。

---

## 9. 交付清单（改动面）

| 文件 | 改动 |
|---|---|
| `funds-layer/constants/internal-transfer-paths.constant.ts` | 加 `FIAT_FEE_COLLECT`（C_VIBAN→F_FEE）+ `FIAT_SPREAD_COLLECT`（F_LIQ→F_FEE），单跳 route 或单 from/to，class B / BANK / drain FEE_RECEIVABLE |
| `funds-layer/guards/whitelist.guard.ts` | 支持新单跳路径校验（复用 `assertWhitelisted` 或 `assertRoute`） |
| `funds-layer/accounting/funds-accounting.service.ts` | 新增按指定金额 drain `FEE_RECEIVABLE→BANK` 的方法；结算全额 drain 不变 |
| `funds-layer/workflow/fiat-settlement-workflow.service.ts` | ① 结算交付改 gross（fiat IN）；② SUCCESS 后 spawn 服务费 + 点差 fee-collect transfer |
| 新 `funds-layer/workflow/fiat-fee-collection-workflow.service.ts` | 监听 `WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT` → spawn 提现费 fee-collect（+ swap fee/spread + 完成时按额 drain）|
| `funds-layer/domain/funds-flow.service.ts` | 复用 `createLeg`（单 fund）；无新状态机 |
| `funds-layer/domain/system-wallet-resolver.service.ts` | 复用 `resolve`(F_FEE/F_LIQ) + `resolveCustomer`(C_VIBAN) |
| 测试 | 各 service 单测；fee-collect 路径 + 指定金额 drain + gross 结算 + 提现费触发 |
| demo | 扩展 `seed-fiat-settle-demo` 或新脚本：含 fee/spread 的 swap → 看 VIBAN→F_FEE + F_LIQ→F_FEE |

---

## 10. 不变量速查

- 法币费归集 per-event：swap 费/点差随结算 ride-along，提现费随 payout 成功。
- 客户付的费（`CLIENT_CREDIT→FEE_RECEIVABLE` 腿）→ `C_VIBAN→F_FEE` 直连逐客户；点差（`TRADE_CLEARING→FEE_RECEIVABLE` 腿）→ `F_LIQ→F_FEE` 池级。
- swap 法币结算交 **gross**（net+服务费），fee-collect 再抽回 → VIBAN 落 net；spread 不进 VIBAN。
- TB 每笔按**指定金额** drain `FEE_RECEIVABLE→BANK`，不是全额。
- fee 收完 **物理 VIBAN = TB CLIENT_CREDIT(net)**。

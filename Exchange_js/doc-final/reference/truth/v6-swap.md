# V6 兑换流程 — 当前实现真相

Last Verified: 2026-07-04（核对方式：三路 subagent 走查 + 主线裁决 reverse/FAILED/REVERSED 可达性 + SwapSettlementService 命名）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 0. 一句话定位

平台内兑换（crypto↔fiat 余额交换，**资金不出境、无外部对手方**）：报价 → L1 资格 → 消费 Quote → 4 腿实时记账 → SUCCESS。合规**仅 L1 同步 eligibility**（无 L2 KYT/TR、无大额审批门——与充值/提现的三层合规刻意不同，因资金不出境）。**不**管：内部转账、上链。

## 1. 状态机

`SwapTransactionStatus` 枚举 4 态，**但仅 2 态运行时可达**：
```
PROCESSING ──(4 腿全 CLEAR)──→ SUCCESS
PROCESSING ──(腿失败)──→ 自愈重试(attempt+1，≤MAX_LEG_ATTEMPTS)──→ STUCK(needsReview + 手动 resume)，仍 PROCESSING
```
- ⚠️ **`FAILED` / `REVERSED` 是死枚举**：定义在 `SwapTransactionStatus`，但**全代码无一处 `markStatus` 设置它们**（`markStatus` 只被 `'SUCCESS'` 调用）。失败**永不**转 FAILED（注释原文 "never markStatus FAILED"），**无 reverse 端点**转 REVERSED。
- 锚点：`swap-transaction.dto.ts → SwapTransactionStatus` ｜ `swap-workflow.service.ts → onLegFailedSelfHeal()`（自愈+STUCK）

## 2. 数据模型要点

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)；记账口径 → [accounting-coa.md](accounting-coa.md)。

- **swap 腿** = `swapTransactionId` 非空的 `funds_order`（+ `legSeq` 1-4，不走白名单）。⚠️ 代码仍用 `InternalFundAction` 旧名映射到 `FundsOrderAction`（命名债，见 BACKLOG）
- **Quote**：`SwapQuoteStatus` = ACTIVE/USED/EXPIRED/CANCELLED；`SWAP_QUOTE_TTL_SECONDS = 30`；**懒过期**（查询时 markExpired，无 cron）
- **SwapFeeLevel**：tier = `rateMarkupBps`（点差）+ `feeItems`（可选，**支持 spread-only** tier）
- 锚点：`swap-quote.service.ts → SWAP_QUOTE_TTL_SECONDS` ｜ `pricing.types.ts → SwapTier`

## 3. 关键流程

- **报价**：`SwapQuoteService.createQuote()` → `resolveBestLevel()`（多 level 取最低费）+ `BinanceRateProvider.fetchRate()`（实时 + 3s 缓存 + AED 钉 3.6725）+ `PricingEngineService.buildSwapQuote()`（amountOut/spread/fee）→ 30s TTL
- **L1 资格**：`SwapWorkflowService.executeSwap()` 内 `ensureCustomerCanTransact()` + `assertTradingEligibility(ownerId, 'SWAP')`（pre-creation 同步）
- **R4 双边收款账户门**：`executeSwap()` 读到 quote 后（事务内，consume 前）逐一检查 buy/sell 两侧资产的 `WalletQueryService.hasReceivingAccount(ownerId, assetId)`（ACTIVE 的 C_DEP/C_VIBAN），任一缺失即 `RECEIVING_ACCOUNT_REQUIRED`（带 assetCode），先于 consumeQuote/建 swap 行/建 leg1 拦截，避免腿中段才在 `resolveLegWallets()` 撞见钱包缺失
- **成交编排**：consume Quote → swap PROCESSING → `createLeg(leg1)` → per-leg two-phase → `onLegConfirmed()` 链式创建下一腿 → 第 4 腿 CLEAR → `markStatus('SUCCESS')`
- **推进**：leg1 自动 initiate、**leg2-4 lazy**（admin `POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance` → `advanceLeg()`，带 **sell-first 顺序守卫**）；STUCK 后 `POST .../resume`（新 attempt 重试）
- **4 腿账户**（`swap-leg-plan.constant.ts`，CRYPTO_TO_FIAT / FIAT_TO_CRYPTO 各一组）：客户侧 `CLIENT_PAYABLE↔CLIENT_ASSET`、公司侧 `FIRM_ASSET↔FIRM_OPS/SET/FEE`；per-leg two-phase `initiateLegPending()→postLeg()`（成功）/ `voidLeg()`（失败 best-effort 补偿）。**无 clearing bridge / Outstanding / FEE_RECEIVABLE**（全仓 0 命中）
- **对账 evidence**：每腿 `externalRef = ${swapNo}:${legSeq}:${attempt}:pending` + debit/creditWalletRef + `isExternalCrossing=true`（swap 不上链，swap-internal ref 即跨钱包互证键）
- **费率治理**：3 独立工作流 `SwapFeeLevel{Creation/Change/Binding}WorkflowService`；创建/变更走审批（**OPS_OFFICER 单步**），Change 走 request-record + `configHash` 冲突检测 + 单 PENDING 约束，Binding 无审批门
- 锚点：`swap-workflow.service.ts → executeSwap()/handleFundsOrderChanged()/onLegConfirmed()/onLegFailedSelfHeal()/advanceLeg()/mapLegAction()` ｜ `swap-leg-accounting.ts → initiateLegPending()/postLeg()/voidLeg()` ｜ `swap-leg-plan.constant.ts → buildSwapLegPlan()` ｜ `swap-quote.service.ts → createQuote()/resolveBestLevel()` ｜ `binance-rate.provider.ts → fetchRate()` ｜ `swap-fee-level/*-workflow.service.ts`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **FAILED/REVERSED 死枚举 + 无 reverse 端点**：`SwapTransactionStatus` 定义了 FAILED/REVERSED，但无代码路径可达；控制器只有 advance/resume，**无 reverse**（roadmap 曾标 ✅2026-06-26 整笔冲正——**过度声明，实际未接**）
- **无自动 FAILED 状态机**：腿失败走自愈→STUCK(needsReview)，swap 留 PROCESSING 等人工 resume；无终态失败（设计 deferred）
- **合规仅 L1**（无 KYT/TR/大额审批门）——设计决策（资金不出境），非遗漏；若将来启用大额兑换合规需补
- **Sumsub TM 真实集成未做** / **Quote TTL 无 cron sweep**（仅懒过期）/ **兑换成功通知未接** / **TB 记账失败无专用 repair surface**（仅 resume 重试）
- **InternalFund 命名债**：swap 腿操作 funds_order 表，但类/枚举/注释仍用 `InternalFund*` 旧名（Round 2 rename 未跟随）
- **架构命名漂移**：roadmap 写"L2 SwapSettlementService"——**该类不存在**；实际 = `SwapWorkflowService`（入口+编排）+ `SwapLegAccounting`（记账）+ `SwapTransactionsService`（状态/CRUD）

## 5. 锚点

`swap-transactions/`：`swap-workflow.service.ts`（入口+事件编排+advance，主文件）｜ `swap-leg-accounting.ts`（per-leg two-phase 记账）｜ `swap-transactions.service.ts`（状态机+投影）｜ `swap-transactions.controller.ts`（advance/resume 端点）｜ `dto/swap-transaction.dto.ts`（状态枚举）
`swap-fee-level/`：`swap-quote.service.ts`（报价+resolveBestLevel）｜ `swap-fee-level.service.ts`（executeChange+configHash）｜ `*-creation/change/binding-workflow.service.ts`
`funds-layer/constants/swap-leg-plan.constant.ts`（4 腿声明）｜ `pricing-center/`（`pricing-engine.service.ts`、`providers/binance-rate.provider.ts`；**`PricingCenterService` 已删**）｜ `approval.constants.ts → SWAP_FEE_LEVEL_CREATION/CHANGE`
前端：`client-web/Swap.tsx`、`admin-web/SwapTransaction{List,Detail}.tsx`、`SwapQuote{List,Detail}.tsx`、`SwapFeeLevel{List,Detail}.tsx`

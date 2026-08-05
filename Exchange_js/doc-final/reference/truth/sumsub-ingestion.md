# Sumsub 合规信号翻译层 — 当前实现真相（跨版本共享域）

Last Verified: 2026-08-05（核对方式：补料 Embed 功能收尾（deposit-action-embed 分支 Task 7），补第 3 节 `applicantActions[]` 从 `getTxn` 经 handler 透传到充值单的完整链路 + 第 4 节新增 `createActionSdkToken()` 两处缺陷条目，均回代码逐符号核实。前序核对方式：2026-08-03 业主要求逐份核充值相关 truth，查出三处漂移并修：①前置分流仍写 startsWith 前缀匹配（实为 KYT_VERDICT_TYPES 显式集合）②类型清单写 applicantKytTxnOnHold（官方无 Txn，正是本轮修掉的真接入必失效 bug）③第 4 节仍称充值新旧两条路径并存（applyKytResult/applyTrResult 已全仓零残留）。更早核对方式：符号级 grep + V2/V4/V5/V6 体检交叉佐证；本次补充充值 KYT-txn webhook 前置分流段，见第 3 节）

> 本文只描述"现在是什么样"。改代码必须同步本文。**跨版本共享域**：被 V2(onboarding/CRA/材料时效)/V4(充值 KYT)/V5(提现 KYT)/V6(兑换) 引用——外部合规信号进平台的**唯一入口**。各版本文档只描述"自己消费哪个事件"，翻译层机制链到此。

---

## 0. 一句话定位

Sumsub（KYC/KYT/Travel Rule/制裁筛查/持续监控）的 webhook → 翻译成内部领域事件 → 路由到各消费方。**平台侧只做翻译层 + 审计**，不重建合规执行管道。本文管：webhook 接入、ingest 去重、dispatch 路由、retry/dead-letter、模拟端点。**不**管：各消费方收到事件后怎么处置（去 v2/v4/v5/v6）。

## 1. 状态机（SumsubWebhookEvent）

- `PENDING → (dispatch 成功) DISPATCHED / (失败) FAILED → (retry 3 次仍失败) DEAD`
- 锚点：prisma `SumsubWebhookEvent`（eventNo/status/rawPayload/retryCount）

## 2. 数据模型要点

- **SumsubWebhookEvent**：每 webhook 一行；`dedupeKey` 去重（真实 webhook）；`rawPayload` JSON 存原始报文；`status`/`retryCount`/`lastError`
- **事件类型两类**：真实（applicantReviewed / applicantActionReviewed / applicantWorkflowCompleted / ongoingDocExpired）+ 模拟（kytCheckSimulated / travelRuleCheckSimulated / withdrawKyt.../withdrawTravelRule.../caseDecisionSimulated）——**均走同一 ingest→dispatch 管道**
- 锚点：prisma `SumsubWebhookEvent`

## 3. 关键流程（`sumsub-ingestion.service.ts` + controller）

- **接入**：`POST /webhooks/sumsub` → `handleWebhook()` 签名验证（`sumsubClient.verifyWebhookSignature`，失败抛 401）
- **ingest**：`ingest()` → 去重（dedupeKey）→ `createEventRecord()` 建 SumsubWebhookEvent(PENDING) → 触发 dispatch
- **dispatch 前置分流（充值交易 webhook，2026-07 落地；2026-07-31 由前缀匹配改为显式集合匹配）**：`dispatch()` 在按 eventType 的老 if/else 分支**之前**新插一段——`payload.type` 命中 **`KYT_VERDICT_TYPES`**（`deposit-sumsub/kyt-webhook-types.ts`，六项：`applicantKytTxnApproved` / `applicantKytTxnRejected` / `applicantKytTxnAwaitingUser` / **`applicantKytOnHold`** / `applicantKytTxnReviewed` / `applicantKytTxnCreated`）即整段转交 `DepositWebhookRouter.route()`（新模块 `deposit-sumsub/`），复用本表既有的去重/retry/dead-letter，只是路由目标从老 if/else 换成这个 router。
  ⚠️ **`applicantKytOnHold` 没有 `Txn`** —— 这是 Sumsub 官方的命名不一致（其文档自己也注明）。~~此前用 `startsWith('applicantKytTxn')` 前缀匹配~~，真实 on-hold 事件不以该前缀开头，**在最外层分流处就被丢弃**，挂起复核整条路失效；因我方 fixture 与全链路五处一致地写成 `applicantKytTxnOnHold`，演示与单测全绿、完全掩盖了缺陷（2026-07-31 修）。
  **修法约束（勿改回）**：不可放宽成 `startsWith('applicantKyt')` —— 那会把 `applicantKytAml*` 等同前缀的其它 KYT 族事件误吞进 deposit 路由。类型清单以 `kyt-webhook-types.ts` 为**单一真相源**，ingestion 前置分流 / `DepositWebhookRouter` / `DepositKytVerdictHandler` 三处共用同一份，不得各自维护副本。`DepositWebhookRouter` 再按 type 二次分流到 `DepositKytVerdictHandler`（Approved/Rejected/AwaitingUser/OnHold）→ 调 `DepositWorkflowService.applyKytVerdict()` 驱动充值状态机（Created 只记 debug 回执 no-op，Reviewed 归一 ignore，未知 type 记 orphan warn）。`applicantAction*` 事件**不**进这条新分支——仍走下面"applicant 事件"这条老分支（Clue 3，材料时效重检消费方 V2 `materialRefreshService`），两者互不干扰；充值侧对材料补齐后的重检不需要专门 handler 接住 action 事件本身，客户补料后 Sumsub 自动重评发出的仍是 `applicantKytTxn*`，继续走新分支。详见 `v4-deposit.md` §4.1。
- **dispatch 路由**（老分支，按 eventType + 客户 onboardingStatus 分流；命中 `KYT_VERDICT_TYPES` 的充值 KYT-txn 事件已被上面的前置分流拦截，不会落到这里）：
  - 模拟合规事件（kyt/tr/caseDecision）→ 对应交易的合规门（V4/V5/V6 KYT/TR 状态）
  - `ongoingDocExpired` → V2 `materialRefreshService.handleSumsubDocMonitoringFire()`
  - applicant 事件 → 按 onboardingStatus：PENDING_VERIFICATION→V2 onboarding；APPROVED+WorkflowCompleted→V2 tierUpgrade；APPROVED+Reviewed(RED)→V2 CRA
- **韧性**：`sumsub-ingestion-retry.service.ts` `@Cron('*/2 * * * *')` 扫 FAILED，退避 [30s/5m/30m]，超 3 次 → DEAD
- **模拟端点**：`simulate()`（DEV 阶段注入合规结果，走同 ingest 管道）；admin `list()/findOne()/replay()`（Sumsub Events 页）
- **`applicantActions[]` 透传（充值补料，2026-08-04/05 落地）**：`SumsubTxnClient.getTxn()` 的返回体（`sumsub-txn.types.ts → SumsubTxnDetail`）带 `applicantActions?: {applicantActionId, externalActionId}[]`（`scoringResult.applicantActions`，`awaitUser` 裁决时 Sumsub 告诉我方要客户补什么）；`sumsub-txn-client.mock.ts`/`sumsub-txn-client.http.ts` 两个实现各自把原始报文的 `scoringResult.applicantActions` 映射成这个数组（两处映射逻辑手写重复，未共享 helper，见 BACKLOG）。`DepositKytVerdictHandler.handle()`（`awaitUser` 裁决分支）从 `getTxn` 存证结果里取出 `detail.applicantActions` 原样透传给 `DepositWorkflowService.applyKytVerdict()` 的 `applicantActions` 参数，最终落进 `applyKytAwaitUser()`——只取数组第一个（`applicantActions?.[0]`）写进 deposit 的 `sumsubActionId`/`sumsubExternalActionId` 两列；多个 action 只处理第一个是已知缺口，详见 `v4-deposit.md` §4.6"已知缺口"。`applicantAction*` webhook 事件本身（如 §3 上方所述）**不**触发这条链路——补料后 Sumsub 自动重评发出的仍是 `applicantKytTxn*`，走的是本节前置分流那条路，不需要专门的 action-event handler。
- 锚点：`sumsub-ingestion.controller.ts → handleWebhook()` ｜ `sumsub-ingestion.service.ts → ingest()/dispatch()/simulate()/replay()` ｜ `sumsub-ingestion-retry.service.ts` ｜ `admin-sumsub-simulation.controller.ts`（各交易的 kyt/tr 模拟端点）｜ `deposit-sumsub/deposit-webhook.router.ts`（充值 KYT-txn webhook 前置分流）｜ `deposit-sumsub/deposit-kyt-verdict.handler.ts`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **真实 Sumsub KYT/TR 集成未做（V5/V6）**：V5（提现）/V6（兑换）的 KYT/Travel Rule 门仍**靠模拟端点驱动**，真实 webhook 消费链路未见部署；V5 `archivePostKyt()` stub（待替换真实 PATCH /kyt/txns 调用）。**V4（充值）已接真实 webhook**（`KYT_VERDICT_TYPES` → `DepositWebhookRouter`，见第 3 节 + `v4-deposit.md` §4.1）。~~老 mock kyt-check/tr-check 路径并未删除，新旧两条路径并存~~ —— **该路径已于 2026-07-31 单笔提交改造中整体删除**（`applyKytResult()`/`applyTrResult()` 全仓零残留，已 grep 核实），充值侧不再并存两条路径，见 `v4-deposit.md` §4.2 的作废声明。
- 🔴 **`createActionSdkToken()` 真接 Sumsub 必炸**（`identity/onboarding/providers/sumsub/sumsub.client.ts:118`，充值补料 Embed 换真 SDK 时会用到这个方法签发短时 token）：两处缺陷——① `userId` 参数当前传的是 Sumsub 侧 `applicantId`，官方接口定义要求传我方 `externalUserId`（真实数据里两者不同，不可互换）；② 缺 applicant action 场景必填的 `externalActionId`（该方法目前只接 `applicantId`/`levelName`/`ttlInSecs` 三个参数，未接收/透传 action 级别的 `externalActionId`）。当前被 `SUMSUB_MOCK_MODE=true` 时的假返回（`mock-sdk-token-...`）掩盖，未在任何真实调用路径上暴露；详见 `v4-deposit.md` §4.6"已知缺口"。
- 消费方处置见各版本：V2 onboarding/CRA/材料时效（v2-customer-compliance.md）、V4-V6 合规门（各自 truth）

## 5. 锚点汇总

`sumsub-ingestion/`：`sumsub-ingestion.controller.ts`（webhook 接入）｜ `sumsub-ingestion.service.ts`（ingest/dispatch 主）｜ `sumsub-ingestion-retry.service.ts`（retry/dead-letter cron）｜ `sumsub-ingestion-admin.controller.ts`（Events 页）｜ `admin-sumsub-simulation.controller.ts`（模拟端点）
`deposit-sumsub/`（充值 KYT-txn webhook 消费方，2026-07 落地）：`deposit-webhook.router.ts`（分流）｜ `deposit-kyt-verdict.handler.ts`（翻译 verdict）｜ `deposit-sla.service.ts`（onHold/ACTION_PENDING SLA 定时器）｜ `sumsub-txn-client.{interface,http,mock}.ts`（提交/查询 KYT 交易）
消费方：`identity/onboarding`、`identity/client-risk-assessment`、`identity/material-refresh`、`deposit-sumsub`（充值 KYT-txn，见上）、各 trading 模块合规门

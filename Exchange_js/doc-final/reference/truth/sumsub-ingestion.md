# Sumsub 合规信号翻译层 — 当前实现真相（跨版本共享域）

Last Verified: 2026-07-04（核对方式：符号级 grep + V2/V4/V5/V6 体检交叉佐证）

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
- **dispatch 路由**（`dispatch()`，按 eventType + 客户 onboardingStatus 分流）：
  - 模拟合规事件（kyt/tr/caseDecision）→ 对应交易的合规门（V4/V5/V6 KYT/TR 状态）
  - `ongoingDocExpired` → V2 `materialRefreshService.handleSumsubDocMonitoringFire()`
  - applicant 事件 → 按 onboardingStatus：PENDING_VERIFICATION→V2 onboarding；APPROVED+WorkflowCompleted→V2 tierUpgrade；APPROVED+Reviewed(RED)→V2 CRA
- **韧性**：`sumsub-ingestion-retry.service.ts` `@Cron('*/2 * * * *')` 扫 FAILED，退避 [30s/5m/30m]，超 3 次 → DEAD
- **模拟端点**：`simulate()`（DEV 阶段注入合规结果，走同 ingest 管道）；admin `list()/findOne()/replay()`（Sumsub Events 页）
- 锚点：`sumsub-ingestion.controller.ts → handleWebhook()` ｜ `sumsub-ingestion.service.ts → ingest()/dispatch()/simulate()/replay()` ｜ `sumsub-ingestion-retry.service.ts` ｜ `admin-sumsub-simulation.controller.ts`（各交易的 kyt/tr 模拟端点）

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **真实 Sumsub KYT/TR 集成未做**：当前 V4/V5/V6 的 KYT/Travel Rule 门**靠模拟端点驱动**，真实 webhook 对交易合规的消费链路未见部署；V5 `archivePostKyt()` stub（待替换真实 PATCH /kyt/txns 调用）
- 消费方处置见各版本：V2 onboarding/CRA/材料时效（v2-customer-compliance.md）、V4-V6 合规门（各自 truth）

## 5. 锚点汇总

`sumsub-ingestion/`：`sumsub-ingestion.controller.ts`（webhook 接入）｜ `sumsub-ingestion.service.ts`（ingest/dispatch 主）｜ `sumsub-ingestion-retry.service.ts`（retry/dead-letter cron）｜ `sumsub-ingestion-admin.controller.ts`（Events 页）｜ `admin-sumsub-simulation.controller.ts`（模拟端点）
消费方：`identity/onboarding`、`identity/client-risk-assessment`、`identity/material-refresh`、各 trading 模块合规门

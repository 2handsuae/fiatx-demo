# V2 客户管理 + 合规底座 — 当前实现真相

Last Verified: 2026-07-04（核对方式：三路 subagent 走查 + 主线抽验模块注册/交易门/Corporate 禁用/冻结缺口）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。
> ⚠️ **roadmap 严重滞后**：roadmap 把 Onboarding/CRA/Material Refresh 全标 [ ]（未做），实测**均已建可用、模块注册在 AppModule 且在跑**——本文以代码为准。

---

## 0. 一句话定位

客户准入 + 合规管理：Onboarding（CDD via Sumsub）+ CRA（风险评估）+ Material Refresh（材料时效）+ Tier Upgrade + 冻结管控。核心是**客户主表三轴状态模型**；`assertTradingEligibility` 是 **V4-V6 每条交易流都调的交易资格门**。MVP **仅 Individual**，Corporate/机构客户**显式禁用**。

## 1. 状态机

- **三轴**（`customer-status.util.ts`）：`onboardingStatus`（准入）+ `adminStatus`（行政）+ `complianceStatus`（合规）；两开关过 + restrictions JSON 细粒度限制
  - onboardingStatus：`NONE → PENDING_VERIFICATION → FINAL_APPROVAL → APPROVED / REJECTED / WITHDRAWN`
  - adminStatus：`INACTIVE / ACTIVE / SUSPENDED / OFFBOARDED`
  - complianceStatus：`CLEAR / FROZEN`（仅二值）
- **Material Refresh cycle**：`FRESH → NOTIFIED(NUDGE) → URGENT → BLOCKING → CLEARED`（⚠️ 代码用 NUDGE_ONLY/CLEARED，roadmap 写 NUDGE/RESOLVED，名不符）
- **Tier Upgrade case**：`PENDING_LEVEL2 → PENDING_PHASE2_APPROVAL → COMPLETED / REJECTED`
- 锚点：`customer-status.util.ts → resolveCustomerCanonicalState()` ｜ prisma `CustomerMain`

## 2. 数据模型要点

- **CustomerMain**：三轴字段 + `restrictions` JSON（`[{capability, reason}]`）+ `investorTier`(STANDARD/ENHANCED) + `tradingTier`(BASIC/PREMIUM) + `riskRating`(LOW/MEDIUM/HIGH) + `complianceFreezeReason`/`complianceFreezeCaseId`
- **SumsubWebhookEvent**：webhook 事件记录（eventNo/status/rawPayload），retry/dead-letter
- **CorporateProfile / UboProfile / ShareholdingRegistry* / AppointmentRecord**：表在、关系连（`customers.service` detail include），但**无机构业务逻辑**（stub，机构入口禁用）
- 锚点：prisma `CustomerMain`/`SumsubWebhookEvent`/`CorporateProfile`

## 3. 关键流程

- **assertTradingEligibility（V4-V6 交易门，最关键）**：`onboardingStatus=APPROVED && adminStatus=ACTIVE && complianceStatus≠FROZEN` + restrictions 校验；被 deposit/withdraw/swap **全部** 调用（`onboarding.service.ts → assertTradingEligibility()`）
- **Onboarding**（`onboarding/`，~80% 可用，真实 Sumsub 集成非 stub）：`startVerification()`（创建 Sumsub applicant + SDK token）→ webhook `handleSumsubVerificationEvent()` 驱状态 → 走过 Level 2 的进 `FINAL_APPROVAL` + `ONBOARDING_FINAL_APPROVAL` MLRO 审批门 → APPROVED（adminStatus=ACTIVE 开户）；前端契约 `GET /onboarding/me`+`/next-step`（INTRO→GUIDE→FLOW）
- **CRA**（`client-risk-assessment/`，~85% 可用）：`startAssessment()` → Sumsub AML → `applyPolicy()`（6 规则：SANCTIONS→冻结/PEP→MLRO/ADVERSE_MEDIA/red_other/material_stale/green_stable）→ `routeSignoff()`（LOW_TO_LOW 自动 / LOW_TO_HIGH 走 `RISK_RATING_MLRO_REVIEW` 审批门=**EDD**）；制裁命中 `handleSanctionsPath()`→complianceStatus=FROZEN；月度 cron `runQuarterlyAssessment()` 定期 re-KYC
- **Material Refresh**（`material-refresh/`，~95%）：每日 cron `@Cron('0 2 * * *')` 扫材料时效 → stage 迁移 → BLOCKING 阶段设 complianceStatus=FROZEN；Sumsub doc monitoring 驱动；补件成功自动解冻
- **Tier Upgrade**（`tier-upgrade-case/`，后端~70% 全建、⛔ 缺前端）：CRA 判 HIGH → `createFromCra()`（冻结+推 Sumsub Level 2）→ `handleLevel2WorkflowComplete()` → `RISK_RATING_TIER_UPGRADE_APPROVAL`（MLRO+SMO）→ 升级；**无 controller/客户端 UI**
- **Sumsub 翻译层**（📖 机制详情 → [sumsub-ingestion.md](sumsub-ingestion.md)）：webhook→ingest→dispatch 按 eventType×onboardingStatus 路由到 V2 消费方（onboarding/tierUpgrade/CRA/材料时效）；本层是 V2+V4/V5/V6 共享入口
- 锚点：`onboarding.service.ts → assertTradingEligibility()/startVerification()/handleSumsubVerificationEvent()` ｜ `onboarding-final-approval.service.ts → syncApprovalProjectionByEvent()` ｜ `client-risk-assessment.service.ts → routeSignoff()/handleSanctionsPath()` ｜ `client-risk-assessment-cron.service.ts → runQuarterlyAssessment()` ｜ `material-refresh.service.ts → enterBlockingStage()` ｜ `material-freshness-cron.service.ts` ｜ `tier-upgrade-case.service.ts → createFromCra()` ｜ `sumsub-ingestion.service.ts → ingest()/dispatch()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **冻结/解冻无统一 workflow**：冻结散在多处自动触发（material BLOCKING / tier upgrade / CRA 制裁），**无独立 freeze workflow**、**无 MLRO 解冻审批门**（`UNFREEZE` 常量定义了但无人用）、**无 freeze/unfreeze API**（DTO 有 handler 无）；roadmap 要求的"管理层手动先审批后冻结 + 解冻统一 MLRO 审批"未实现
- **Tier Upgrade ⛔ BLOCKED**：后端全建，缺客户端材料提交 UI（真实卡点）
- **Corporate/机构客户显式禁用**：`onboarding.service.ts` 两处 `throw 'Corporate onboarding is disabled'`；CorporateProfile/UboProfile 表+关系在但无业务逻辑（ADVANCED stub）
- **Material Refresh 状态名不符**：代码 NUDGE_ONLY/CLEARED vs roadmap NUDGE/RESOLVED（文档订正）
- **交易门覆盖**：assertTradingEligibility 已确认被 deposit/withdraw/swap 全调（V4-V6 体检佐证），无遗漏
- **ADVANCED 全未做**：Individual 3（资料变更/销户/协议版本）+ Institutional 7（Corporate KYB/UBO/授权代表/结构变更/多用户/Corporate CRA/Re-KYB）

## 5. 锚点

`identity/onboarding/`：`onboarding.service.ts`（主，含交易门）｜ `onboarding-final-approval.service.ts` ｜ `onboarding-{admin,customer}.controller.ts` ｜ `providers/sumsub/sumsub.client.ts`
`identity/client-risk-assessment/`：`client-risk-assessment.service.ts` ｜ `client-risk-assessment-cron.service.ts` ｜ `policy/` ｜ `client-risk-assessment-approval-projection.service.ts`
`identity/material-refresh/`：`material-refresh.service.ts` ｜ `material-freshness-cron.service.ts` ｜ `policy/`
`identity/tier-upgrade-case/`：`tier-upgrade-case.service.ts` ｜ `tier-upgrade-case-approval-projection.service.ts`（无 controller）
`identity/customers/`：`customers.service.ts` ｜ `customer-status.util.ts`（三轴判定）
`sumsub-ingestion/`：`sumsub-ingestion.service.ts` ｜ `sumsub-ingestion.controller.ts`（webhook）｜ `sumsub-ingestion-retry.service.ts` ｜ `sumsub-ingestion-admin.controller.ts`
`trading/shared/customer-transaction-guard.ts`（restrictions 解析）

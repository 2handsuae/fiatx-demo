# V2 客户管理 + 合规底座 — 当前实现真相

Last Verified: 2026-08-16（核对方式：客户生命周期轴 + 限制账落地后逐段重写；e2e customer-restrictions 六用例实证）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。
> ⚠️ **roadmap 严重滞后**：roadmap 把 Onboarding/CRA/Material Refresh 全标 [ ]（未做），实测**均已建可用、模块注册在 AppModule 且在跑**——本文以代码为准。

---

## 0. 一句话定位

客户准入 + 合规管理：Onboarding（CDD via Sumsub）+ CRA（风险评估）+ Material Refresh（材料时效）+ Tier Upgrade + 冻结管控。核心是**一根客户关系生命周期轴（`lifecycle`）+ 一张限制账（`customer_restrictions`）**；`assertTradingEligibility` 是 **V4-V6 每条交易流都调的交易资格门**。MVP **仅 Individual**，Corporate/机构客户**显式禁用**。

## 1. 状态机

- **一根轴**（`identity/constants/customer-lifecycle.constant.ts`）：`lifecycle` —— 描述客户关系走到哪一步，与"能不能干事"解耦
  - `PROSPECT → IN_VERIFICATION → PENDING_APPROVAL → ACTIVE`；旁支 `REJECTED` / `WITHDRAWN`（可 `REAPPLY` 回 `IN_VERIFICATION`）；终态 `OFFBOARDED`
  - 8 个动作：`START_VERIFICATION` / `VERIFICATION_PASSED` / `VERIFICATION_REJECTED` / `WITHDRAW_APPLICATION` / `FINAL_APPROVED` / `FINAL_REJECTED` / `REAPPLY` / `OFFBOARD`；非法边由 `nextLifecycle()` 抛 `Invalid lifecycle action <action> from <from>`
  - 不变量：不存在 `ACTIVE → REJECTED|WITHDRAWN` 边（已 ACTIVE 的客户只能被 `OFFBOARD`，被摁住走限制账不走轴）
- **一张限制账**（`customer_restrictions`，一行 = 一次摁住的一个 scope）：范围 / 可见性 / 解除路径三个正交属性由 `cause` 查 `RESTRICTION_CAUSE_POLICY` 推出，人工不可填
  - 7 个 cause：`SANCTION`（SILENT/MLRO）｜`ADMIN_SUSPENSION`（DISCLOSED/OPS）｜`MATERIAL_EXPIRED`｜`TIER_UPGRADE_PENDING`｜`KYT_REJECTED_SOFT`（三者 DISCLOSED/OPS）｜`KYT_REJECTED_HARD`（SILENT/MLRO）｜`PENDING_DOCUMENT`（DISCLOSED/OPS，唯一 `scopeSelectable`）
  - 一张便签多 scope = 同 `restrictionNo` 多行；release 以 `restrictionNo` 为单位一次全撕
  - 幂等键 `(customerId, cause, caseRef)`：已有 OPEN 即 no-op（`caseRef` 为 null 时不去重）
- 旧的 `onboardingStatus` / `adminStatus` / `complianceStatus` / `complianceFreeze*` 四列 / `restrictions` JSON **已全部删除**，无兼容层（demo 数据约定，reset 重铺）
- **Material Refresh cycle**：`FRESH → NOTIFIED(NUDGE) → URGENT → BLOCKING → CLEARED`（⚠️ 代码用 NUDGE_ONLY/CLEARED，roadmap 写 NUDGE/RESOLVED，名不符）
- **Tier Upgrade case**：`PENDING_LEVEL2 → PENDING_PHASE2_APPROVAL → COMPLETED / REJECTED`
- 锚点：`customer-status.util.ts → resolveCustomerCanonicalState()` ｜ prisma `CustomerMain`

## 2. 数据模型要点

- **CustomerMain**：`lifecycle` 一列 + `investorTier`(STANDARD/ENHANCED) + `tradingTier`(BASIC/PREMIUM) + `riskRating`(LOW/MEDIUM/HIGH) + `hardLineDispositionedAt`（兑换域硬线 sticky 标记，一旦命中制裁永久沉默该客户此后任何一笔裁决的补料入口）。**2026-08-18 订正**：`pendingActionExternalId`/`pendingActionReason`/`pendingActionSubmittedAt` 客户级三列已随迁移 `20260817020000_drop_legacy_action_stores` 物理删除——这三列是单值指针（同一客户第二次补料会把第一次整个盖掉），已被材料请求账（`material_requests`，一行 = 一次下发）取代，见下方新增条目
- **MaterialRequest**（`material_requests`，2026-08-17 落地）：`requestNo`(MRQ) + `customerId`/`sumsubApplicantId` + `materialType`/`levelName` + `applicantActionId`/`externalActionId`（服务端专用，绝不下发客户面）+ `orderDomain`/`orderRef`（同空同非空，绑不绑具体订单）+ `restrictionNo`（可后补，与限制账互补：限制账说"不能做什么"，材料账说"交什么才能松开"，`caseRef` 用 `requestNo` 关联）+ `origin`(SUMSUB_PUSHED/OPERATOR_ISSUED/SYSTEM_SCHEDULED) + `status`(PENDING_SUBMISSION/SUBMITTED/APPROVED/REJECTED/CANCELLED) + `reviewAnswer`(GREEN/RED) + `reviewRejectType`(RETRY/FINAL，仅 RED 有值——RETRY 回 `PENDING_SUBMISSION` 且两个 Sumsub id 原样不变，FINAL 终态 `REJECTED`；旧模型不分这两种，运营永远关不掉单)；`externalActionId` 唯一，充值/提现/兑换/材料重检/等级升级五处下发口全部收拢到此表
- **CustomerRestriction**（`customer_restrictions`）：`restrictionNo`(RST) + `scope` 单值 + `cause`/`visibility`/`releasePolicy`（查表写入）+ `status`(OPEN/RELEASED) + `reason`/`caseRef` + `releaseOrderRef`/`releaseApprovalNo`/`releaseMode`(AUTO/MANUAL) + `traceId`；`@@unique([restrictionNo, scope])`
- **SumsubWebhookEvent**：webhook 事件记录（eventNo/status/rawPayload），retry/dead-letter
- **CorporateProfile / UboProfile / ShareholdingRegistry* / AppointmentRecord**：表在、关系连（`customers.service` detail include），但**无机构业务逻辑**（stub，机构入口禁用）
- 锚点：prisma `CustomerMain`/`SumsubWebhookEvent`/`CorporateProfile`

## 3. 关键流程

- **能力门（V4-V6 交易门，最关键）**：读侧统一收口到 `CustomerAccessService.resolve()`，唯一执法依据是 `lifecycle === 'ACTIVE'`（否则 `LIFECYCLE_NOT_ACTIVE`）+ `!blocked.has(capability)`（否则 `CAPABILITY_RESTRICTED`）；`scope='ALL'` 展开成 {DEPOSIT, WITHDRAW, SWAP}。**`blocked`（含 SILENT，服务端执法）与 `disclosedBlocked`（仅 DISCLOSED，客户面）分成两个字段，是 tipping-off 命门**——客户面 DTO 只允许出现 `disclosedBlocked` / `disclosed`，`blocked` / `openCount` 禁止序列化（`customer-access.contract.spec.ts` 逐文件扫描守着）。被制裁客户前端照常渲染可点按钮，点击后由后端以中性文案拒绝（与明示受限客户的响应体逐字相同）。`OnboardingService.assertTradingEligibility()` 现在只是纯委托。2026-07-11 起该门额外并入 `assertTradingReady()`：WITHDRAW/SWAP 须客户有 ≥1 个 ACTIVE 法币（BANK）提现地址，否则抛 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`；DEPOSIT 例外不在此硬拒。贴 `scope=ALL` 便签会冻结该客户名下全部非终态充值/提现单，兑换域没有 FROZEN 态、改为拦住推腿并写 `SWAP_LEG_HALTED_BY_RESTRICTION` 审计；`scope < ALL` 不动在途单。
- **Onboarding**（`onboarding/`，~80% 可用，真实 Sumsub 集成非 stub）：`startVerification()`（创建 Sumsub applicant + SDK token）→ webhook `handleSumsubVerificationEvent()` 驱状态 → 走过 Level 2 的进 `PENDING_APPROVAL` + `ONBOARDING_FINAL_APPROVAL` MLRO 审批门 → `lifecycle=ACTIVE` 开户；前端契约 `GET /onboarding/me`+`/next-step`（INTRO→GUIDE→FLOW）
- **CRA**（`client-risk-assessment/`，~85% 可用）：`startAssessment()` → Sumsub AML → `applyPolicy()`（6 规则：SANCTIONS→冻结/PEP→MLRO/ADVERSE_MEDIA/red_other/material_stale/green_stable）→ `routeSignoff()`（LOW_TO_LOW 自动 / LOW_TO_HIGH 走 `RISK_RATING_MLRO_REVIEW` 审批门=**EDD**）；制裁命中 `handleSanctionsPath()`→贴 SANCTION 便签（SILENT/MLRO 解除）；月度 cron `runQuarterlyAssessment()` 定期 re-KYC
- **Material Refresh**（`material-refresh/`，~95%）：每日 cron `@Cron('0 2 * * *')` 扫材料时效 → stage 迁移 → BLOCKING 阶段贴 MATERIAL_EXPIRED 便签（DISCLOSED，WITHDRAW+SWAP）；Sumsub doc monitoring 驱动；补件成功 autoRelease 只撕自己那张（多因并存不互相解）
- **Tier Upgrade**（`tier-upgrade-case/`，后端~70% 全建、⛔ 缺前端）：CRA 判 HIGH → `createFromCra()`（冻结+推 Sumsub Level 2）→ `handleLevel2WorkflowComplete()` → `RISK_RATING_TIER_UPGRADE_APPROVAL`（MLRO+SMO）→ 升级；**无 controller/客户端 UI**
- **Sumsub 翻译层**（📖 机制详情 → [sumsub-ingestion.md](sumsub-ingestion.md)）：webhook→ingest→dispatch 按 eventType×lifecycle 路由到 V2 消费方（onboarding/tierUpgrade/CRA/材料时效）；本层是 V2+V4/V5/V6 共享入口
- 锚点：`onboarding.service.ts → assertTradingEligibility()/startVerification()/handleSumsubVerificationEvent()` ｜ `onboarding-final-approval.service.ts → syncApprovalProjectionByEvent()` ｜ `client-risk-assessment.service.ts → routeSignoff()/handleSanctionsPath()` ｜ `client-risk-assessment-cron.service.ts → runQuarterlyAssessment()` ｜ `material-refresh.service.ts → enterBlockingStage()` ｜ `material-freshness-cron.service.ts` ｜ `tier-upgrade-case.service.ts → createFromCra()` ｜ `sumsub-ingestion.service.ts → ingest()/dispatch()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- [x] ~~🔴 **冻结/解冻无统一 workflow**~~ **已兑现（2026-08-16，客户生命周期轴 + 限制账）**：贴便签统一走 `CustomerRestrictionWorkflowService.openRestriction()`（立即生效、不开审批 —— 制裁 24h 上报窗口等不起审批）；撕便签统一走 `initiateRelease()` → 按 `releasePolicy` 分流 `CUSTOMER_RESTRICTION_RELEASE_MLRO`（SANCTION / KYT_REJECTED_HARD）或 `CUSTOMER_RESTRICTION_RELEASE_OPS`（其余五因）审批门 → `onReleaseDecided()` 落地；四个端点已建（admin 列表 / 贴 / 发起解除 + client 只读 disclosed）。MLRO 类必填 `releaseOrderRef`，缺失 400。
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
`identity/customers/`：`customers.service.ts` ｜ `customer-restrictions.service.ts`（守单实体不变量）｜ `customer-access.service.ts`（读侧唯一收口）｜ `customer-restriction-workflow.service.ts`（编排 + 审计 + 审批）｜ `constants/restriction-cause.constant.ts`（原因注册表）
`sumsub-ingestion/`：`sumsub-ingestion.service.ts` ｜ `sumsub-ingestion.controller.ts`（webhook）｜ `sumsub-ingestion-retry.service.ts` ｜ `sumsub-ingestion-admin.controller.ts`
`trading/shared/customer-transaction-guard.ts`（改调 CustomerAccessService.assertCapability）

# V1 审计底座（审批 / 审计 / RBAC / Admin 生命周期）— 当前实现真相

Last Verified: 2026-07-04（核对方式：三路 subagent 走查 + 主线抽验通知/retention/traceId）

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。
> 覆盖：平台治理底座——审批引擎 + 审计日志 + RBAC 权限 + admin 生命周期 + 凭证安全。**所有后续版本（V2-V9）的操作可信性依赖它。**

---

## 0. 一句话定位

平台治理底座。**审批引擎**（maker-checker 多步骤）+ **审计日志**（append-only）+ **RBAC**（运行时权限校验）+ **admin 生命周期**（入职/首登/停用/恢复/凭证）。10 个 MVP 工作流全部 ✅ LIVE；8 个 ADVANCED 全未做。

## 1. 状态机

- **ApprovalCase**：`DRAFT → PENDING → APPROVED / REJECTED / EXPIRED / CANCELLED`；多步骤链，**每步多角色 OR**（任一角色可审该步）
- **User.status**：`PENDING_INVITE_APPROVAL → INVITE_SENT → ACTIVE ⇄ SUSPENDED`（+ INACTIVE/LOCKED）
- **firstLoginStatus**：`PENDING_IDENTITY_CONFIRM → MFA_BINDING → COMPLETED`（首登四步）
- 锚点：`approval.constants.ts → ApprovalStatuses` ｜ `mfa-binding-workflow.service.ts`（首登状态机）

## 2. 数据模型要点

- **audit_log_events**：必填 `workflowType`/`action`（UPPER_SNAKE）/`traceId`（UUID v4）；**已删列禁用**：`module`(2026-04-29)/`triggerType`(2026-04-30)/`workflowId`/`workflowNo`(2026-04-08)/`audit_log_subject_nos` 关联表(2026-05-19)
- **ApprovalActionPolicy**：`stepsConfig` JSON 列（多步骤）取代扁平 `checkerRoles`；回退链 stepsConfig→checkerRoles→DEFAULT
- **RBAC catalog**（`rbac.catalog.ts`）：`RBAC_PERMISSION_DEFINITIONS` 150+ 路由权限；`ACTION_BUCKET_CATALOG` **9 域 23 bucket**（roadmap 写的 4 域 13 bucket 已过期）；`HARD_MUTEX_ROLE_PAIRS` 3 对（[CISO,MLRO]/[MLRO,OPS_OFFICER]/[CISO,OPS_OFFICER]）
- 锚点：prisma `audit_log_events`/`approval_action_policies` ｜ `rbac.catalog.ts`

## 3. 关键流程

**审批引擎**（`governance/approvals/`）：
- `ApprovalHandlerBase`（抽象基类，子类提供 4 常量 actionType/workflowType/auditActions/entityType + 基类实现全部 `@OnEvent`）
- `ApprovalsService.approve()/reject()`：单步推进 + **SoD same-user deny**（`DENY_SAME_USER_MAKER_CHECKER`，maker 不能自审 + 跨步骤 `hasActorApprovedAnyStep`）
- `ApprovalPolicyService.getPolicy()`：stepsConfig 回退链；`APPROVAL_POLICY_CHANGE` **自审防篡改**（改审批策略自身走审批，`SELF_POLICY_IMMUTABLE`）
- 锚点：`approval-handler.base.ts → ApprovalHandlerBase` ｜ `approvals.service.ts → approve()` ｜ `approval-policy.service.ts → getPolicy()`

**Admin 生命周期**（`identity/users/`）：
- Invite（3 层 + SoD `validateHardMutex` + 邀请 token 状态机 `assertInvitationUsable`）
- First Login（四步 MFA 绑定 `confirmIdentity → initMfaBind → verifyMfaBind`）
- Suspension（审批 + JWT Strategy 拦截 SUSPENDED，`jwt.strategy.ts` — **非即时 token blacklist**）/ Reactivation（配对）
- Password Reset（自助邮箱→MFA→链接 + CISO 代操作；`TOKEN_TTL_MS=15min` + SHA-256 hash + 速率限制 + 反枚举）
- MFA Reset（`POST /admin/iam/users/:id/reset-mfa`，权限 `IAM_CREDENTIAL_RESET` CISO/TECH_OFFICER，重置后重走首登）
- 锚点：`admin-invite-workflow.service.ts` ｜ `mfa-binding-workflow.service.ts → verifyMfaBind()` ｜ `jwt.strategy.ts`（SUSPENDED 拦截）｜ `admin-password-reset-workflow.service.ts → TOKEN_TTL_MS/hashToken()`

**审计**（`audit-logging/`，canonical 实现在此，非 risk-engine）：
- `AuditLogsService.recordByActor()`（人/API）/ `recordSystem()`（jobs），append-only 写 `audit_log_events`
- Query `GET /admin/audit-logs`（`buildWhere` 支持 actorNo/traceId/时间；⚠️ **subjectNo 过滤缺失**）
- Evidence Export（`audit-evidence-package.controller.ts`，approval-backed `AUDIT_EVIDENCE_EXPORT_APPROVAL`，manifest + records + SHA-256 digest）
- 锚点：`audit-logs.service.ts → recordByActor()` ｜ `audit-evidence-export-workflow.service.ts`

**RBAC**（`identity/access-control/`）：
- `AdminPermissionGuard`（每 API 运行时校验）+ `rbac.catalog.ts`（RBAC_PERMISSION_DEFINITIONS）
- 锚点：`admin-permission.guard.ts → AdminPermissionGuard` ｜ `access-control.service.ts → validateHardMutex()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway.notifyComplianceUpdated`，**无 email/webhook/retry 实现**（roadmap 标 Notification send/retry ✅ MVP 是**过度声明**）——这是 V4-V6"通知基础设施在但没接"的根因（本体就没做）
- 🔴 **subjectNos 合约漂移**：`rules/audit-logging.md` Query Contract 要求 detail 返回 `subjectNos[]`，但代码 `mapEvent()` 不返回、DTO 无此字段、query 无 subjectNo 过滤；`audit_log_subject_nos` 表已删（2026-05-19）；代码仍有 `item.subjectNos` 幻影访问（恒 undefined）
- **audit-retention-job.ts 死脚本**：`scripts/audit-retention-job.ts:33-45` 仍 select/access 已删列 `module`/`triggerType`（脚本会坏/返 undefined）
- **SUPER_ADMIN 硬编码 bypass**：`access-control.service.ts` 对 SUPER_ADMIN 完全跳过 SoD + 直接给全权限；roadmap 定性"正式上线不存在"——**上线前须移除此 bypass**
- **traceId 共享待核**：首登 `ADMIN_LOGIN_SUCCESS`(authTraceId) 与 `MFA_LOGIN_VERIFIED`(loginTraceId) 是否共享同一 traceId 存疑（roadmap 称共享，agent 存疑，待核）
- **Suspension 非即时**：JWT Strategy 校验拦截 SUSPENDED（下次请求生效），非 token blacklist 即时撤销（生产需改造）
- **ADVANCED 8 项全未做**：Admin 删除 / 证据包删除 / Break-Glass / 审批超时预警 / Periodic Access Review / API Key 轮换×2 / Audit Log Archival（Archival 有 `markArchivedBefore` 骨架但 retention 脚本坏）

## 5. 锚点

`governance/approvals/`：`approval-handler.base.ts` ｜ `approvals.service.ts` ｜ `approval-policy.service.ts` ｜ `constants/approval.constants.ts`
`identity/users/`：`admin-invite-{approval,workflow}.service.ts` ｜ `mfa-binding-workflow.service.ts` ｜ `admin-{suspension,reactivation}-workflow.service.ts` ｜ `admin-password-reset-workflow.service.ts` ｜ `admin-role-binding-change-workflow.service.ts` ｜ `users.domain.service.ts`
`identity/access-control/`：`rbac.catalog.ts` ｜ `access-control.service.ts` ｜ `admin-permission.guard.ts` ｜ `role-definition-{create,modify}-workflow.service.ts`
`identity/auth/`：`auth.service.ts` ｜ `jwt.strategy.ts`
`audit-logging/`：`audit-logs.service.ts` ｜ `audit-logs.controller.ts` ｜ `audit-evidence-package.controller.ts` ｜ `audit-evidence-export-workflow.service.ts` ｜ `constants/audit-actions.constant.ts`
`core/notifications/`：`notifications.gateway.ts`（仅 WebSocket stub）

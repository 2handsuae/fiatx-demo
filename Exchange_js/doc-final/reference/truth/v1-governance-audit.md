# V1 审计底座（审批 / 审计 / RBAC / Admin 生命周期）— 当前实现真相

Last Verified: 2026-08-25（核对方式：审计日志重构第一批 Task 11 端到端验收——真实 API 驱动 admin 停用/恢复/角色定义创建/SoD 拒绝/审计日志查询等 V1 治理动作，配合三次数据破坏型变异测试）

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

- **audit_log_events**（2026-08-25 按应然十组字段重建，63 列，`seq` 自增整型当物理主键、`id` UUID 供子表外键引用）：`outcome` 四值枚举（`SUCCESS`/`FAILED`/`DENIED`/`PARTIAL`，语义是"动作执行成没成"不是"业务结果好不好"——`APPROVAL_DECLINED` 的 `outcome` 是 `SUCCESS`）；`workflowType` 列保留但 V1 域**停止写入依赖**（本批唯一过渡层例外，物理删列排交易域批次，因交易域仍有 63 处写入点依赖该字段）；`updatedAt` 已删（审计表只增不改，没有"更新时间"的语义）；`action`/`recordedAt`/`eventNo`/`primarySubjectNo`/`ownerCustomerNo`/`actorRolesAtTime`（JSON 数组快照）全部到位。**已删列禁用**：`module`(2026-04-29)/`triggerType`(2026-04-30)/`workflowId`/`workflowNo`(2026-04-08)/`audit_log_subject_nos` 关联表(2026-05-19，本批已按同形状重建为 `audit_log_subjects`，见下方「审计」小节)
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
- `AuditLogsService.recordByActor()`（人/API）/ `recordSystem()`（jobs），append-only 写 `audit_log_events`，写入前经 `assertActionSpec` 机器校验（V1 词表内的码缺必填字段/`START` 码读到已有旅程都会拒绝写入）
- 子表 `audit_log_subjects` 已建（2026-08-25 恢复，五角色 `PRIMARY`/`OWNER`/`INSTRUMENT`/`RELATED`/`COUNTERPARTY` 封闭枚举，刻意不设 `ACTOR`；唯一键 `[eventId, subjectType, subjectNo, subjectRole]` 含角色，同一对象可在一条事件里担两个角色；`PRIMARY` 至多一个、零个合法，多个会被写入前守卫拒绝）。**⚠️ 覆盖面缺口**：目前只有横切的 6 个 `APPROVAL_*` 码（`approvals.service.ts`）与 `AUDIT_LOG_QUERIED`（仅当查询带 `ownerCustomerNo` 时）真正调用 `persistSubjects` 写子表行；其余约 38 个 IAM/CONFIG/AUDIT_EVIDENCE_EXPORT 域码的 workflow service 只设置主表扁平字段 `primarySubjectType`/`primarySubjectNo`，从不传 `subjects:` 数组——用这些码自己的业务号（如某个被停用的 `ADM2501010008`）按 `subjectNo` 查询子表恒 0 命中，须改用 `primarySubjectNo=` 精确过滤才查得到。详见 BACKLOG「审计日志重构 · 第一批之后仍欠的账」
- V1 完整日志清单 45 个动作码（`V1_AUDIT_ACTIONS`，`audit-actions.constant.ts:889-956`，IAM 27 / CONFIG 8 / APPROVAL 6 / AUDIT 4），前缀优先命名、六后缀封闭（`_REQUESTED`/`_APPLIED`/`_COMPLETED`/`_CANCELLED`/`_EXPIRED`/`_DENIED`）；每码出生即定死四项声明（`actionDomain`/`correlationMode`/额外必填字段/`causationId` 是否必填）；另有 11 个退役码（`DEPRECATED_AUDIT_ACTIONS`）标记禁止新写入，历史仍可读，且退役校验加了 `inV1Domain` 闸门只对四个 V1 域生效（避免误伤三个非 V1 文件复用的同名裸词 `CHANGE_APPLY_FAILED`）
- 打点全部上收编排层（workflow service），领域服务与 controller 不直接调用 `recordByActor`/`recordSystem`；**唯一例外** `audit-logs.controller.ts` 的 `AUDIT_LOG_QUERIED`——这个动作只存在于 controller 层、无对应 workflow，词表声明 `correlationMode=NONE`
- Query `GET /admin/audit-logs`（`buildWhere` 支持 `subjectNo`/`subjectRole`/`outcome`/`actionDomain`/`ownerCustomerNo`/`primarySubjectType`/`primarySubjectNo`/`correlationId`/`causationId`/`traceId`/`actorNo` 等精确过滤；详情与列表返回 `subjects[]` 新形状）
- Evidence Export（`audit-evidence-package.controller.ts`，approval-backed `AUDIT_EVIDENCE_EXPORT_APPROVAL`，manifest + records + SHA-256 digest）
- 锚点：`audit-logs.service.ts → recordByActor()/persistSubjects()/assertActionSpec()` ｜ `audit-actions.constant.ts → V1_AUDIT_ACTIONS/DEPRECATED_AUDIT_ACTIONS` ｜ `audit-evidence-export-workflow.service.ts` ｜ 验收脚本 `scripts/verify-audit.ts`（`npm run verify:audit`）

**RBAC**（`identity/access-control/`）：
- `AdminPermissionGuard`（每 API 运行时校验）+ `rbac.catalog.ts`（RBAC_PERMISSION_DEFINITIONS）
- 锚点：`admin-permission.guard.ts → AdminPermissionGuard` ｜ `access-control.service.ts → validateHardMutex()`

## 4. ⚠️ 已知缺口（详见 BACKLOG.md）

- 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway.notifyComplianceUpdated`，**无 email/webhook/retry 实现**（roadmap 标 Notification send/retry ✅ MVP 是**过度声明**）——这是 V4-V6"通知基础设施在但没接"的根因（本体就没做）
- 🔴 **`audit_log_subjects` 子表覆盖面远小于设计前提**（2026-08-25 Task 11 端到端实测新发现）：只有 6 个 `APPROVAL_*` 横切码与 `AUDIT_LOG_QUERIED`（限 `ownerCustomerNo` 查询）会写子表行，其余约 38 个 V1 码只写主表扁平字段；按业务号经子表查这 38 个码恒 0 命中，须改用扁平字段过滤。详见本文件上方「审计」小节与 BACKLOG 对应条目
- **audit-retention-job.ts 死脚本**：`scripts/audit-retention-job.ts:33-45` 仍 select/access 已删列 `module`/`triggerType`（脚本会坏/返 undefined）
- **SUPER_ADMIN 硬编码 bypass**：`access-control.service.ts` 对 SUPER_ADMIN 完全跳过 SoD + 直接给全权限；roadmap 定性"正式上线不存在"——**上线前须移除此 bypass**。2026-08-25 Task 11 实测坐实：SUPER_ADMIN 能自批自己提交的任意类型审批请求（含 `ADMIN_SUSPENSION_APPROVAL`），`APPROVAL_SOD_DENIED` 不会触发；换非 SUPER_ADMIN 角色（如 CISO 对自己提交的 `ROLE_DEFINITION_CREATE`）自批才会被正确拦截
- **traceId 共享待核（已随退役失去 V1 域验证场景）**：首登 `ADMIN_LOGIN_SUCCESS`(authTraceId) 与 `MFA_LOGIN_VERIFIED`(loginTraceId) 是否共享同一 traceId 存疑；2026-08-25 本批已将这两个码列入 `DEPRECATED_AUDIT_ACTIONS`（登录归③安全日志，非②业务审计），`verify:audit` 不变量③确认零新写入——原疑问是否仍需在③建设时重提，留给运维批次判断
- **Suspension 非即时**：JWT Strategy 校验拦截 SUSPENDED（下次请求生效），非 token blacklist 即时撤销（生产需改造）
- **ADVANCED 8 项全未做**：Admin 删除 / 证据包删除 / Break-Glass / 审批超时预警 / Periodic Access Review / API Key 轮换×2 / Audit Log Archival（Archival 有 `markArchivedBefore` 骨架但 retention 脚本坏）

## 5. 锚点

`governance/approvals/`：`approval-handler.base.ts` ｜ `approvals.service.ts` ｜ `approval-policy.service.ts` ｜ `constants/approval.constants.ts`
`identity/users/`：`admin-invite-{approval,workflow}.service.ts` ｜ `mfa-binding-workflow.service.ts` ｜ `admin-{suspension,reactivation}-workflow.service.ts` ｜ `admin-password-reset-workflow.service.ts` ｜ `admin-role-binding-change-workflow.service.ts` ｜ `users.domain.service.ts`
`identity/access-control/`：`rbac.catalog.ts` ｜ `access-control.service.ts` ｜ `admin-permission.guard.ts` ｜ `role-definition-{create,modify}-workflow.service.ts`
`identity/auth/`：`auth.service.ts` ｜ `jwt.strategy.ts`
`audit-logging/`：`audit-logs.service.ts` ｜ `audit-logs.controller.ts` ｜ `audit-evidence-package.controller.ts` ｜ `audit-evidence-export-workflow.service.ts` ｜ `constants/audit-actions.constant.ts`
`core/notifications/`：`notifications.gateway.ts`（仅 WebSocket stub）

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Depends On: `docs/acceptance/wave-1-foundation-final-acceptance.md`, `docs/specs/modules/governance-control-foundation-module.md`, `docs/specs/modules/rbac-member-management-module.md`, `docs/cleanup/2026-04-wave1-foundation-reset/README.md`, `prisma/schema.prisma`
Source of Truth Level: review-note

# Wave 1 Subject Table Dictionary And Minimal Model Review

## Purpose
- 本文档只做两件事：
  1. 把 `Wave 1` 主体表逐张拆开，给出字段名、字段类型、字段含义。
  2. 给出一个更简洁、更统一、更适合产品理解和后台展示的最小模型建议。
- 这不是新的运行时真相文档。
- 它是面向产品、运营、未来清理工作的字段审查说明。

## How This Review Defines "主体表"
- 主体表：
  - 有独立生命周期
  - 有自己的 operator-facing `No`
  - 可以单独开列表或详情
  - 可以单独作为工作流或治理对象被追踪
- 支撑表：
  - 服务于主体表
  - 主要承担绑定、步骤、通知、子事件、关系映射
  - 一般不作为独立 operator 根对象理解

## Wave 1 Table Map

| 分类 | 表名 | 为什么算进 Wave 1 |
| --- | --- | --- |
| 主体表 | `User` | 管理员身份主体，承载登录、激活、软删除治理 |
| 主体表 | `Role` | RBAC 角色目录主体 |
| 主体表 | `Permission` | RBAC 权限目录主体 |
| 主体表 | `AdminUserInvitation` | 平台成员邀请与激活链路主体 |
| 主体表 | `ApprovalCase` | 审批工作流根对象 |
| 主体表 | `AuditEvidencePackage` | 审计证据导出主体 |
| 主体表 | `ComplianceCaseEvidencePackage` | 合规 case 证据导出主体 |
| 主体表 | `ChangeTicket` | 变更发布治理主体 |
| 主体表 | `DeleteRequest` | 软删除治理主体 |
| 主体表 | `SlaTimer` | 治理 SLA 计时主体 |
| 主体表 | `AuditLogEvent` | Canonical audit 证据主体 |
| 支撑表 | `ApprovalStep` | 审批步骤子记录 |
| 支撑表 | `ChangeTicketGateRun` | 变更 gate 执行子记录 |
| 支撑表 | `SlaNotification` | SLA 通知注册子记录 |
| 支撑表 | `AuditLogSubjectNo` | 审计主体编号锚点子记录 |
| 结构表 | `UserRole` | 用户和角色的绑定表 |
| 结构表 | `RolePermission` | 角色和权限的绑定表 |
| 配置表 | `ApprovalActionPolicy` | 审批动作策略表 |
| 配置表 | `ApprovalSodRule` | 职责分离规则表 |

## Field Dictionary

### `User`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `userNo` | `String` | 面向运营和后台的管理员编号。 |
| `email` | `String` | 管理员登录邮箱，也是唯一身份入口之一。 |
| `password` | `String` | 管理员登录口令存储列，运行时应视为敏感字段。 |
| `role` | `String` | 兼容/展示用角色字段，不应再视为权限真相。 |
| `status` | `String` | 当前成员是否可登录，例如 `INACTIVE`、`ACTIVE`。 |
| `failedLoginAttempts` | `Int` | 连续登录失败次数，用于安全锁定。 |
| `lockedUntil` | `DateTime?` | 账号被临时锁定到何时。 |
| `lastLoginAt` | `DateTime?` | 最近一次成功登录时间。 |
| `deletedAt` | `DateTime?` | 软删除生效时间，表示该管理员已退休。 |
| `deletedBy` | `String?` | 执行软删除的操作人。 |
| `deleteRequestId` | `String?` | 关联的治理删除请求 ID。 |
| `deleteReason` | `String?` | 软删除原因。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `userRoles` | `UserRole[]` | 该用户的真实角色绑定集合。 |
| `adminInvitations` | `AdminUserInvitation[]` | 该用户关联的邀请记录集合。 |

### `Role`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `code` | `String` | 角色目录的 canonical 标识。 |
| `name` | `String` | 角色显示名称。 |
| `description` | `String?` | 角色用途说明。 |
| `status` | `String` | 角色是否仍处于可用状态。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `rolePermissions` | `RolePermission[]` | 该角色绑定的权限集合。 |
| `userRoles` | `UserRole[]` | 被哪些用户绑定。 |

### `Permission`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `code` | `String` | 权限目录的 canonical 标识。 |
| `name` | `String` | 权限显示名称。 |
| `description` | `String?` | 权限含义说明。 |
| `method` | `String` | 权限对应的 HTTP method 或动作类型。 |
| `path` | `String` | 权限对应的主要路由路径。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `rolePermissions` | `RolePermission[]` | 被哪些角色引用。 |

### `AdminUserInvitation`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `userId` | `String` | 被邀请管理员的用户 ID。 |
| `tokenHash` | `String` | 邀请 token 的哈希值，敏感字段，不应用于普通展示。 |
| `expiresAt` | `DateTime` | 邀请链接过期时间。 |
| `consumedAt` | `DateTime?` | 邀请被接受的时间。 |
| `revokedAt` | `DateTime?` | 邀请被作废的时间。 |
| `createdByUserId` | `String?` | 创建邀请的后台成员。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `user` | `User` | 对应的管理员主体。 |

### `ApprovalCase`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `approvalNo` | `String` | 面向运营的审批编号。 |
| `actionType` | `String` | 审批动作类型，例如 final approval、delete approval。 |
| `entityRef` | `String` | 被审批对象的主引用，一般是业务对象 ID。 |
| `makerUserId` | `String` | 发起审批的人。 |
| `status` | `String` | 审批状态，例如 `DRAFT`、`PENDING`、`APPROVED`。 |
| `executionStatus` | `String` | 审批通过后，执行投影是否成功。 |
| `riskLevel` | `String` | 该审批动作绑定的风险等级。 |
| `checkerRoles` | `String` | 允许审批该动作的角色集合快照。 |
| `selectedCheckerRole` | `String` | 本次实际选择的审批角色。 |
| `allowCancel` | `Boolean` | 该审批是否允许取消。 |
| `allowRetry` | `Boolean` | 该审批是否允许重试。 |
| `docRef` | `String?` | 审批关联的文档或证据引用。 |
| `metadataJson` | `String` | 业务上下文 JSON。 |
| `traceId` | `String` | 链路追踪 ID，用于把审批串回工作流。 |
| `workflowType` | `String?` | 绑定的工作流类型。 |
| `workflowId` | `String?` | 绑定的工作流内部 ID。 |
| `workflowNo` | `String?` | 绑定的工作流业务编号。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `submittedAt` | `DateTime?` | 提交审批时间。 |
| `timeoutAt` | `DateTime?` | 审批超时点。 |
| `decidedAt` | `DateTime?` | 作出决定的时间。 |
| `executedAt` | `DateTime?` | 决定结果被投影执行的时间。 |
| `decisionByUserId` | `String?` | 最终决策人 ID。 |
| `decisionByRole` | `String?` | 最终决策人角色。 |
| `decisionReason` | `String?` | 审批结论理由。 |
| `deletedAt` | `DateTime?` | 该审批对象被治理删除的时间。 |
| `deletedBy` | `String?` | 删除执行人。 |
| `deleteRequestId` | `String?` | 关联的删除请求 ID。 |
| `deleteReason` | `String?` | 删除原因。 |
| `steps` | `ApprovalStep[]` | 审批步骤子记录。 |
| `evidencePackage` | `AuditEvidencePackage?` | 关联的审计证据导出对象。 |
| `caseEvidencePackage` | `ComplianceCaseEvidencePackage?` | 关联的 case 证据导出对象。 |
| `latestForChangeTicket` | `ChangeTicket?` | 被变更单作为 latest approval 引用。 |
| `latestForDeleteRequest` | `DeleteRequest?` | 被删除请求作为 latest approval 引用。 |
| `latestForCustomerFinalApproval` | `CustomerMain?` | 被客户 final approval 场景引用。 |
| `linkedRegulatoryGates` | `RegulatoryGateItem[]` | 被监管 gate 直接绑定。 |
| `internalTransactionForApproval` | `InternalTransaction?` | 被内部资金审批直接绑定。 |

### `AuditEvidencePackage`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `packageNo` | `String` | 面向运营的证据包编号。 |
| `approvalCaseId` | `String?` | 关联的审批对象 ID。 |
| `exportedByType` | `String` | 发起导出的主体类型。 |
| `exportedById` | `String` | 发起导出的主体 ID。 |
| `exportedByRole` | `String?` | 发起导出的主体角色。 |
| `status` | `String` | 证据包状态，例如 `PENDING_APPROVAL`、`READY`。 |
| `exportMode` | `String` | 导出模式。 |
| `fileName` | `String?` | 生成文件名。 |
| `filterSnapshot` | `String?` | 导出请求时的筛选条件快照。 |
| `selectedEventIdsSnapshot` | `String?` | 导出时选中的审计事件 ID 集合快照。 |
| `itemCount` | `Int` | 导出条目数量。 |
| `digest` | `String` | 证据包摘要，用于完整性校验。 |
| `manifest` | `String` | 证据包 manifest 内容。 |
| `packageBody` | `String?` | 证据包正文内容。 |
| `deletedAt` | `DateTime?` | 被治理删除的时间。 |
| `deletedBy` | `String?` | 删除执行人。 |
| `deleteRequestId` | `String?` | 关联删除请求。 |
| `deleteReason` | `String?` | 删除原因。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `approvalCase` | `ApprovalCase?` | 关联审批对象。 |

### `ComplianceCaseEvidencePackage`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `packageNo` | `String` | 面向运营的 case 证据包编号。 |
| `approvalCaseId` | `String?` | 关联的审批对象 ID。 |
| `exportedByType` | `String` | 发起导出的主体类型。 |
| `exportedById` | `String` | 发起导出的主体 ID。 |
| `exportedByRole` | `String?` | 发起导出的主体角色。 |
| `status` | `String` | case 证据包状态。 |
| `exportMode` | `String` | 导出模式。 |
| `fileName` | `String?` | 生成文件名。 |
| `filterSnapshot` | `String?` | 导出筛选条件快照。 |
| `selectedCaseIdsSnapshot` | `String?` | 选中的 case 集合快照。 |
| `itemCount` | `Int` | 导出条目数量。 |
| `digest` | `String` | 证据包摘要。 |
| `manifest` | `String` | case 证据包 manifest。 |
| `packageBody` | `String?` | case 证据包正文。 |
| `deletedAt` | `DateTime?` | 被治理删除的时间。 |
| `deletedBy` | `String?` | 删除执行人。 |
| `deleteRequestId` | `String?` | 关联删除请求。 |
| `deleteReason` | `String?` | 删除原因。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `approvalCase` | `ApprovalCase?` | 关联审批对象。 |

### `ChangeTicket`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `ticketNo` | `String` | 面向运营的变更单编号。 |
| `status` | `String` | 变更单状态。 |
| `changeType` | `String?` | 变更类型。 |
| `scopeSummary` | `String?` | 变更范围摘要。 |
| `riskLevel` | `String` | 变更风险级别。 |
| `testEvidenceRef` | `String?` | 测试证据引用。 |
| `rollbackPlanRef` | `String?` | 回滚方案引用。 |
| `latestApprovalId` | `String?` | 当前绑定的 latest approval。 |
| `latestApprovalStatus` | `String?` | latest approval 的实际状态。 |
| `traceId` | `String` | 变更链路追踪 ID。 |
| `emergency` | `Boolean` | 是否紧急变更。 |
| `emergencyReason` | `String?` | 紧急变更原因。 |
| `postApprovalDueAt` | `DateTime?` | 紧急变更的补审批截止时间。 |
| `postApprovalCompletedAt` | `DateTime?` | 紧急变更补审批完成时间。 |
| `createdByUserId` | `String` | 创建人。 |
| `submittedByUserId` | `String?` | 提交人。 |
| `closedByUserId` | `String?` | 关闭人。 |
| `submittedAt` | `DateTime?` | 提交时间。 |
| `deployedAt` | `DateTime?` | 实际部署时间。 |
| `closedAt` | `DateTime?` | 关闭时间。 |
| `deletedAt` | `DateTime?` | 被治理删除的时间。 |
| `deletedBy` | `String?` | 删除执行人。 |
| `deleteRequestId` | `String?` | 关联删除请求。 |
| `deleteReason` | `String?` | 删除原因。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `latestApproval` | `ApprovalCase?` | 关联审批对象。 |
| `gateRuns` | `ChangeTicketGateRun[]` | 关联 gate 执行记录。 |

### `DeleteRequest`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `requestNo` | `String` | 面向运营的删除请求编号。 |
| `targetType` | `String` | 被删除对象类型。 |
| `targetId` | `String` | 被删除对象内部 ID。 |
| `targetNo` | `String` | 被删除对象业务编号。 |
| `status` | `String` | 删除请求状态。 |
| `latestApprovalId` | `String?` | 当前绑定的 latest approval。 |
| `latestApprovalStatus` | `String?` | latest approval 的实际状态。 |
| `makerUserId` | `String` | 发起删除请求的人。 |
| `submittedByUserId` | `String?` | 提交人。 |
| `executedByUserId` | `String?` | 实际执行删除的人。 |
| `deleteReason` | `String` | 删除原因。 |
| `docRef` | `String?` | 附件或文档引用。 |
| `targetSnapshotJson` | `String` | 删除前对象快照。 |
| `traceId` | `String` | 删除治理链路 trace。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `submittedAt` | `DateTime?` | 提交时间。 |
| `executedAt` | `DateTime?` | 执行时间。 |
| `latestApproval` | `ApprovalCase?` | 关联审批对象。 |

### `SlaTimer`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `timerNo` | `String` | 面向运营的 SLA 编号。 |
| `workflowType` | `String` | 绑定的工作流类型。 |
| `workflowId` | `String` | 绑定的工作流内部 ID。 |
| `workflowNo` | `String` | 绑定的工作流业务编号。 |
| `subjectType` | `String` | 被计时主体类型。 |
| `subjectId` | `String` | 被计时主体内部 ID。 |
| `subjectNo` | `String` | 被计时主体业务编号。 |
| `timerType` | `String` | SLA 计时类型。 |
| `ownerUserId` | `String` | 当前负责人。 |
| `status` | `String` | 计时器状态。 |
| `dueAt` | `DateTime` | 到期时间。 |
| `graceSeconds` | `Int` | 容错宽限秒数。 |
| `traceId` | `String` | 计时器所属工作流 trace。 |
| `contextJson` | `String` | 计时计算上下文 JSON。 |
| `closedAt` | `DateTime?` | 手工或系统关闭时间。 |
| `expiredAt` | `DateTime?` | 自动过期时间。 |
| `activeKey` | `String?` | 当前有效计时器唯一键。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `notifications` | `SlaNotification[]` | 关联通知注册记录。 |

### `AuditLogEvent`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `auditNo` | `String` | 面向运营的审计事件编号。 |
| `triggerType` | `String` | 事件触发类型。 |
| `action` | `String` | 发生的审计动作。 |
| `module` | `String` | 产生事件的模块。 |
| `entityType` | `String` | 当前事件绑定的实体类型。 |
| `entityId` | `String?` | 当前事件绑定的实体内部 ID。 |
| `entityNo` | `String?` | 当前事件绑定的实体业务编号。 |
| `traceId` | `String?` | 工作流链路追踪 ID。 |
| `workflowType` | `String?` | 工作流类型。 |
| `workflowId` | `String?` | 工作流内部 ID。 |
| `workflowNo` | `String?` | 工作流业务编号。 |
| `entityOwnerType` | `String?` | 归属主体类型。 |
| `entityOwnerId` | `String?` | 归属主体内部 ID。 |
| `statusFrom` | `String?` | 状态流转前值。 |
| `statusTo` | `String?` | 状态流转后值。 |
| `actorType` | `String` | 事件发起者类型。 |
| `actorId` | `String` | 事件发起者内部 ID。 |
| `actorNo` | `String?` | 事件发起者业务编号。 |
| `actorRole` | `String?` | 事件发起者角色。 |
| `requestId` | `String?` | 请求级关联 ID。 |
| `sourceIp` | `String?` | 来源 IP。 |
| `sourcePlatform` | `String?` | 来源平台。 |
| `result` | `String` | 事件结果，例如成功、失败、拒绝。 |
| `reason` | `String?` | 结果原因说明。 |
| `metadata` | `String?` | 补充上下文 JSON。 |
| `beforeData` | `String?` | 变更前快照 JSON。 |
| `afterData` | `String?` | 变更后快照 JSON。 |
| `idempotencyKey` | `String?` | 幂等键。 |
| `payloadDigest` | `String` | 规范化 payload 摘要。 |
| `maskVersion` | `String` | 脱敏版本。 |
| `retainedUntil` | `DateTime` | 合规保留截止时间。 |
| `entityOwnerNo` | `String?` | 归属主体业务编号。 |
| `archivedAt` | `DateTime?` | 归档时间。 |
| `occurredAt` | `DateTime` | 事件真实发生时间。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `subjectNos` | `AuditLogSubjectNo[]` | 事件绑定的多个主体编号锚点。 |

## Key Support Tables

### `ApprovalStep`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `approvalCaseId` | `String` | 所属审批对象。 |
| `stepNo` | `Int` | 第几步审批。 |
| `status` | `String` | 当前步骤状态。 |
| `checkerRoleCandidates` | `String` | 本步骤允许的审批角色集合。 |
| `decidedByUserId` | `String?` | 本步骤决策人。 |
| `decidedByRole` | `String?` | 本步骤决策角色。 |
| `reason` | `String?` | 本步骤决策理由。 |
| `decidedAt` | `DateTime?` | 本步骤决策时间。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `approvalCase` | `ApprovalCase` | 关联审批主体。 |

### `ChangeTicketGateRun`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `ticketId` | `String` | 所属变更单。 |
| `targetEnv` | `String` | 目标环境。 |
| `releaseVersion` | `String` | 本次发版版本号。 |
| `status` | `String` | gate 执行状态。 |
| `reason` | `String?` | 通过或处理说明。 |
| `failureReason` | `String?` | 失败原因。 |
| `operatorUserId` | `String` | 触发 gate 的操作人。 |
| `traceId` | `String` | gate 执行链路 trace。 |
| `startedAt` | `DateTime?` | 开始时间。 |
| `finishedAt` | `DateTime?` | 结束时间。 |
| `activeKey` | `String?` | 当前活跃 run 的唯一键。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `ticket` | `ChangeTicket` | 关联变更单主体。 |

### `SlaNotification`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `timerId` | `String` | 所属 SLA timer。 |
| `notificationType` | `String` | 通知类型。 |
| `status` | `String` | 通知状态。 |
| `scheduledAt` | `DateTime` | 计划触发时间。 |
| `triggeredAt` | `DateTime?` | 实际触发时间。 |
| `reasonCode` | `String?` | 原因代码。 |
| `message` | `String?` | 展示消息。 |
| `metadataJson` | `String` | 补充上下文 JSON。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `updatedAt` | `DateTime` | 最近更新时间。 |
| `timer` | `SlaTimer` | 关联 SLA 主体。 |

### `AuditLogSubjectNo`

| 字段 | 类型 | 含义说明 |
| --- | --- | --- |
| `id` | `String` | 数据库内部主键。 |
| `eventId` | `String` | 所属审计事件。 |
| `subjectRole` | `String` | 该主体在事件里的角色，例如 actor、entity、owner。 |
| `subjectType` | `String` | 主体类型。 |
| `subjectId` | `String?` | 主体内部 ID。 |
| `subjectNo` | `String` | 主体业务编号。 |
| `occurredAt` | `DateTime` | 该锚点所对应的事件发生时间。 |
| `createdAt` | `DateTime` | 创建时间。 |
| `event` | `AuditLogEvent` | 关联审计事件主体。 |

## Simplification Options

| 方案 | 核心思路 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 只改展示层 | 不动表，只把详情页分成主区和技术区 | 风险最低、落地最快 | 底层模型仍然臃肿，后续继续长 | 可先做，但不是底座收紧 |
| B. 轻模型收束 | 保留现有主体表，但把字段分成 typed core、structured children、context JSON、compat fields | 最平衡，既能保留现有运行能力，又能显著降复杂度 | 需要持续清理字段口径和详情页投影 | 推荐 |
| C. 激进泛化 | 把 approval / change ticket / delete request / sla 继续抽成更泛的统一治理对象 | 表面最简 | 语义变差，产品更难懂，迁移代价高 | 不推荐 |

## Recommended Minimal Version

### 1. 存储分层
- `Typed Core`
  - 只保留会驱动状态、筛选、排序、工作流绑定、审计取证的字段。
  - 典型字段：
    - `No`
    - `status`
    - `result`
    - `actionType`
    - `workflowType / workflowNo`
    - `subjectNo`
    - `dueAt`
    - `occurredAt`
    - `latestApprovalStatus`
- `Structured Children`
  - 重复出现、结构稳定、并且业务需要单独展开的子对象。
  - 典型对象：
    - `ApprovalStep[]`
    - `ChangeTicketGateRun[]`
    - `SlaNotification[]`
    - `AuditLogSubjectNo[]`
    - `UserRole[]`
- `Context JSON`
  - 只做解释、回放、取证，不做日常列表筛选。
  - 典型字段：
    - `metadataJson`
    - `contextJson`
    - `targetSnapshotJson`
    - `filterSnapshot`
    - `selectedEventIdsSnapshot`
    - `beforeData`
    - `afterData`
- `Compat / Technical Fields`
  - 可以继续留库，但默认不进入主展示层。
  - 典型字段：
    - `id`
    - `traceId`
    - `workflowId`
    - `entityId`
    - `targetId`
    - `requestId`
    - `sourceIp`
    - `tokenHash`
    - `deleteRequestId`

### 2. 详情页分层
- 列表页：
  - 只看 `No + 状态 + 责任人/角色 + 关键时间 + 下一步`
- 详情页主区：
  - 只看“业务判断需要”的字段
- 详情页技术区：
  - 放 `traceId / internal id / raw json / source ip / digest`
- 默认不展示：
  - 敏感字段
  - 兼容字段
  - 大块 JSON

### 3. 每张主体表的最小展示合同

| 表 | 列表页最小字段 | 详情页主区最小字段 | 技术区字段 |
| --- | --- | --- | --- |
| `User` | `userNo` `email` `status` `role-summary` | `failedLoginAttempts` `lockedUntil` `lastLoginAt` | `id` `deleteRequestId` `deletedBy` `password` |
| `Role` | `code` `name` `status` | `description` | `id` `createdAt` `updatedAt` |
| `Permission` | `code` `name` `method` `path` | `description` | `id` `createdAt` `updatedAt` |
| `AdminUserInvitation` | `userNo/email` `expiresAt` `consumedAt/revokedAt` | `createdByUserId` | `id` `userId` `tokenHash` |
| `ApprovalCase` | `approvalNo` `actionType` `status` `executionStatus` | `selectedCheckerRole` `decisionReason` `submittedAt` `decidedAt` `workflowNo` | `id` `traceId` `workflowId` `entityRef` `metadataJson` |
| `AuditEvidencePackage` | `packageNo` `status` `exportMode` `itemCount` | `exportedBy` `fileName` `createdAt` | `id` `approvalCaseId` `digest` `manifest` `packageBody` |
| `ComplianceCaseEvidencePackage` | `packageNo` `status` `itemCount` | `exportedBy` `createdAt` | `id` `approvalCaseId` `digest` `manifest` `packageBody` |
| `ChangeTicket` | `ticketNo` `status` `changeType` `riskLevel` | `scopeSummary` `latestApprovalStatus` `emergency` `submittedAt` `deployedAt` | `id` `traceId` `latestApprovalId` `deleteRequestId` |
| `DeleteRequest` | `requestNo` `targetType` `targetNo` `status` | `deleteReason` `latestApprovalStatus` `submittedAt` `executedAt` | `id` `targetId` `traceId` `targetSnapshotJson` |
| `SlaTimer` | `timerNo` `timerType` `status` `ownerUserId` `dueAt` | `workflowNo` `subjectNo` `graceSeconds` | `id` `traceId` `workflowId` `subjectId` `contextJson` |
| `AuditLogEvent` | `auditNo` `action` `result` `occurredAt` | `actor` `workflowNo` `reason` `subjectNos` | `id` `traceId` `entityId` `requestId` `sourceIp` `payloadDigest` `beforeData/afterData` |

## What I Would Clean First
1. 先做显示收束，不急着物理删字段。
2. 把 `User.role` 明确降级为 compat 字段，只把 `user_roles` 当真相。
3. 把 `ApprovalCase` 上的跨 wave 直连关系从“主理解路径”里移走，回到 `workflow + trace + projection`。
4. 把 `AuditLogEvent` 的查询主入口固定为：
   - `auditNo`
   - `action`
   - `result`
   - `workflowType / workflowNo`
   - `traceId`
   - `subjectNos[]`
5. 把所有详情页里的 `raw json / internal id / trace id` 统一折叠到技术区。

## Bottom Line
- 真正让人头大的，不只是字段多，而是字段没有分层。
- 这套 `Wave 1` 底座最适合的极简方向，不是强行并表，而是：
  - 主体表保持清晰
  - 支撑表承担重复结构
  - JSON 只做上下文
  - 技术字段退出默认主视图
- 如果后续继续做 schema cleanup，推荐从 `compat fields` 和“跨业务直连关系”开始，而不是先删时间戳或治理字段。

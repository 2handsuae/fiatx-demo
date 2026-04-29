# Wave 1 数据模型 PRD

> **文档性质**：开发参考文档（Developer-Facing PRD）
> **受众**：加入 Wave 2+ 的后端开发人员
> **语言约定**：中文说明 + 技术英文术语混用
> **最后更新**：2026-04-11

---

## 概述

本文档覆盖 Exchange_js 项目 Wave 1 阶段所有数据库表的完整定义，包括字段说明、业务约束、关联关系以及 Seed 数据。Wave 1 的核心能力集中在：

- **身份与权限**（IAM）：用户、角色、角色绑定
- **治理审批**（Governance）：变更工单、审批单、审批策略、SoD 规则
- **删除管理**（Delete Management）：删除申请工作流
- **审计合规**（Audit & Compliance）：审计日志事件、审计证据包

所有表均在 SQLite（开发/demo）上通过 Prisma ORM 管理，迁移文件位于 `prisma/migrations/`。

---

## 目录

1. [users — 管理员用户表](#1-users--管理员用户表)
2. [roles — 角色表](#2-roles--角色表)
3. [user_roles — 用户-角色绑定表](#3-user_roles--用户角色绑定表)
4. [approval_cases — 审批单主表](#4-approval_cases--审批单主表)
5. [approval_steps — 审批步骤表](#5-approval_steps--审批步骤表)
6. [approval_action_policies — 审批策略配置表](#6-approval_action_policies--审批策略配置表)
7. [approval_sod_rules — SoD 规则表](#7-approval_sod_rules--sod-规则表)
8. [change_tickets — 变更工单表](#8-change_tickets--变更工单表)
9. [delete_requests — 删除申请表](#9-delete_requests--删除申请表)
10. [audit_log_events — 审计日志事件表](#10-audit_log_events--审计日志事件表)
11. [audit_evidence_packages — 审计证据包表](#11-audit_evidence_packages--审计证据包表)
12. [audit_log_subject_nos — 审计主体编号关联表](#12-audit_log_subject_nos--审计主体编号关联表)
13. [Seed 数据](#13-seed-数据)

---

## 1. users — 管理员用户表

### 业务说明

存储所有后台管理员账号。Wave 1 中，所有用户均为人工预置的管理员角色，不存在 C 端用户概念。邀请流程中，账号创建后状态为 `INACTIVE`，激活后变为 `ACTIVE`。

权威授权来源以 `user_roles` 表为准，`role` 字段为历史兼容字段，仅用于 JWT 向后兼容场景。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | Prisma 默认使用 `cuid()` 或 `uuid()` |
| `userNo` | String | UNIQUE, NOT NULL | 业务编号，格式 `ADMIN-XXX` | 全局唯一，operator 侧主要展示标识 |
| `email` | String | UNIQUE, NOT NULL | 登录邮箱 | 不区分大小写存储（建议全小写） |
| `password` | String | NOT NULL | bcrypt 哈希密码 | 明文不入库，wave 1 demo 默认密码 `123456` |
| `role` | String | NOT NULL | 兼容字段（legacy） | JWT `role` claim 向后兼容用，权威来源见 `user_roles` |
| `status` | Enum | NOT NULL | `ACTIVE` / `INACTIVE` | `INACTIVE` 表示邀请已创建但用户未激活 |
| `failedLoginAttempts` | Int | DEFAULT 0 | 连续登录失败次数 | 达到阈值后触发账号锁定 |
| `lockedUntil` | DateTime | NULLABLE | 账号解锁时间 | 锁定期间禁止登录；`null` 表示未锁定 |
| `lastLoginAt` | DateTime | NULLABLE | 最近一次成功登录时间 | 每次登录成功后更新 |
| `deletedAt` | DateTime | NULLABLE | 软删除时间戳 | 由 `DeleteRequest` 工作流写入，非直接删除 |
| `deletedBy` | String | NULLABLE | 执行删除的用户 id | 关联 `users.id` |
| `deleteRequestId` | String | NULLABLE | 关联的删除申请 id | 关联 `delete_requests.id` |
| `deleteReason` | String | NULLABLE | 删除原因 | 由 `DeleteRequest` 工作流从 `delete_requests` 冗余写入 |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### 枚举说明

**UserStatus**：
- `ACTIVE`：账号正常可用
- `INACTIVE`：邀请已发送但用户尚未激活（不可登录）

### 关联关系

```
users ──< user_roles >── roles
users ──< change_tickets (createdByUserId)
users ──< delete_requests (createdByUserId)
users ──< approval_cases (createdByUserId, decisionByUserId)
```

### 设计说明

- **软删除**：Wave 1 中用户删除需走 `delete_requests` 审批工作流，不允许直接物理删除。
- **账号锁定**：`failedLoginAttempts` 累计到阈值时，系统写入 `lockedUntil`（当前时间 + 锁定时长）。`lockedUntil` 过期后自动解锁，无需人工干预。
- **`role` 字段**：Wave 1 保留此字段作为 JWT 兼容层，Wave 2 计划完全迁移至 `user_roles`。

---

## 2. roles — 角色表

### 业务说明

存储系统内所有角色定义。Wave 1 共有 8 个预置角色，对应不同的监管职能和操作权限。角色表为静态配置表，Wave 1 阶段不开放动态创建角色的功能。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `code` | String | UNIQUE, NOT NULL | 角色代码 | 如 `CISO`、`MLRO`、`TECH_OFFICER`，全局唯一 |
| `name` | String | NOT NULL | 角色显示名称 | 用于 UI 展示 |
| `description` | String | NULLABLE | 角色说明 | 描述该角色的职责范围 |
| `status` | Enum | NOT NULL | 角色状态 | Wave 1 仅有 `ACTIVE` 状态 |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | |

### 枚举说明

**RoleStatus**：
- `ACTIVE`：角色启用（Wave 1 所有角色均为此状态）

### 设计说明

- `code` 是业务上引用角色的唯一标识，所有策略配置（如 `approval_action_policies.checkerRoles`）均使用 `code` 而非 `id`。
- Wave 1 角色列表完全通过 Seed 脚本写入，不提供运行时 API 创建角色。

---

## 3. user_roles — 用户-角色绑定表

### 业务说明

多对多关联表，记录用户与角色的绑定关系。一个用户可以绑定多个角色，一个角色也可以分配给多个用户。这是 Wave 1 中权限判断的**权威来源**。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `userId` | String | NOT NULL, FK | 关联 `users.id` | 外键约束 |
| `roleId` | String | NOT NULL, FK | 关联 `roles.id` | 外键约束 |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### 索引与约束

| 约束类型 | 字段 | 说明 |
|---|---|---|
| UNIQUE | `(userId, roleId)` | 同一用户不能重复绑定同一角色 |
| INDEX | `userId` | 按用户查角色列表 |
| INDEX | `roleId` | 按角色查用户列表 |

### 设计说明

- 角色绑定变更（新增/撤销）是 Wave 1 的核心治理操作，需通过 `CHANGE_TICKET` 工作流完成，不允许直接写库。
- 变更内容在 `change_tickets.bindingSnapshotJson` 中冻结，执行后才写入此表。

---

## 4. approval_cases — 审批单主表

### 业务说明

审批单是 Wave 1 所有需要 maker-checker 二人操作场景的核心载体。每一个需要审批的业务动作（变更工单提交、删除申请提交、审计证据导出申请）都会创建一条 `approval_cases` 记录。

审批流程状态机：
```
DRAFT → PENDING → APPROVED → (executionStatus: EXECUTED)
                ↘ REJECTED
       → EXPIRED
       → CANCELLED
```

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `approvalNo` | String | UNIQUE, NOT NULL | 业务编号 | 格式 `APR-YYYYMMDD-XXXX`，operator 主要标识符 |
| `actionType` | Enum | NOT NULL | 审批类型 | Wave 1 有效值见下表 |
| `entityRef` | String | NOT NULL | 被审批对象的 id | 关联 `change_ticket.id` / `delete_request.id` / `audit_evidence_package.id` |
| `createdByUserId` | String | NOT NULL | 发起人（maker）的用户 id | 关联 `users.id` |
| `createdByUserNo` | String | NULLABLE | 发起人的 `userNo` | 冗余字段，避免 JOIN |
| `status` | Enum | NOT NULL | 审批单状态 | `DRAFT` / `PENDING` / `APPROVED` / `REJECTED` / `EXPIRED` / `CANCELLED` |
| `executionStatus` | Enum | NOT NULL | 执行状态 | `NOT_EXECUTED` / `EXECUTED` / `EXECUTION_FAILED` |
| `riskLevel` | Enum | NOT NULL | 风险等级 | Wave 1 全部为 `HIGH` |
| `checkerRoles` | String | NOT NULL | 允许审批的角色列表 | 逗号分隔的 role code，来自 `approval_action_policies` |
| `selectedCheckerRole` | String | NOT NULL | 实际执行审批的角色 | 审批决策后填写 |
| `allowCancel` | Boolean | NOT NULL | 是否允许取消 | 来自 `approval_action_policies` 配置 |
| `allowRetry` | Boolean | NOT NULL | 是否允许执行失败后重试 | 来自 `approval_action_policies` 配置 |
| `metadataJson` | String | NOT NULL DEFAULT `{}` | 附加元数据（JSON序列化字符串） | 如 `{ ticketNo, requestNo, source }` |
| `docRef` | String | NULLABLE | 关联文档引用 | 可选，指向关联的外部文档或附件 |
| `traceId` | String | NOT NULL | 链路追踪 ID | 贯穿整个工作流，用于跨表关联日志 |
| `workflowType` | String | NULLABLE | 关联业务工作流类型 | 如 `CHANGE_TICKET` |
| `workflowId` | String | NULLABLE | 关联业务工作流 id | |
| `workflowNo` | String | NULLABLE | 关联业务工作流业务编号 | |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |
| `submittedAt` | DateTime | NULLABLE | 提交审批时间 | 从 `DRAFT` 进入 `PENDING` 的时间 |
| `timeoutAt` | DateTime | NULLABLE | 超时截止时间 | `submittedAt + timeoutHours` |
| `decidedAt` | DateTime | NULLABLE | 审批决策时间 | |
| `executedAt` | DateTime | NULLABLE | 执行完成时间 | `executionStatus` 变更时填写 |
| `decisionByUserId` | String | NULLABLE | 审批决策人用户 id | |
| `decisionByUserNo` | String | NULLABLE | 审批决策人 `userNo` | 冗余字段 |
| `decisionByRole` | String | NULLABLE | 审批决策人角色 code | 记录实际使用的角色 |
| `decisionReason` | String | NULLABLE | 审批决策说明（含拒绝原因） | |
| `deletedAt` | DateTime | NULLABLE | 软删除时间戳 | |
| `deletedBy` | String | NULLABLE | 执行软删除的用户 id | |
| `deleteRequestId` | String | NULLABLE | 关联的删除申请 id | |
| `deleteReason` | String | NULLABLE | 删除原因 | |

### 枚举说明

**ApprovalStatus**：
| 值 | 说明 |
|---|---|
| `DRAFT` | 初始草稿状态，尚未提交 |
| `PENDING` | 已提交，等待 checker 审批 |
| `APPROVED` | 审批通过 |
| `REJECTED` | 审批拒绝 |
| `EXPIRED` | 超时未审批 |
| `CANCELLED` | 发起人主动取消（需 `allowCancel=true`） |

**ExecutionStatus**：
| 值 | 说明 |
|---|---|
| `NOT_EXECUTED` | 审批通过后尚未执行 |
| `EXECUTED` | 已成功执行 |
| `EXECUTION_FAILED` | 执行失败（可重试，需 `allowRetry=true`） |

**Wave 1 有效 ActionType**：
| 值 | 说明 |
|---|---|
| `CHANGE_TICKET_APPROVAL` | 变更工单审批 |
| `DELETE_REQUEST_APPROVAL` | 删除申请审批 |
| `AUDIT_EVIDENCE_EXPORT_APPROVAL` | 审计证据导出审批 |

**Wave 3 新增 ActionType** *(Updated 2026-04-11)*：
| 值 | checkerRoles | 审批步数 | 说明 |
|---|---|---|---|
| `ONBOARDING_FINAL_APPROVAL` | MLRO → SMO | 2 步（双签） | Onboarding 终审（原为单步 SMO，已升级为双签） |
| `RISK_RATING_UPGRADE_PHASE1` | MLRO | 1 步 | 风险评级升级 phase 1 |
| `RISK_RATING_MAINTENANCE_APPROVAL` | MLRO | 1 步 | 高风险维护审批 |
| `RISK_RATING_HIGH_APPROVAL` | MLRO → SMO | 2 步（双签） | 高风险评级终审 |
| `RISK_RATING_MEDIUM_APPROVAL` | COMPLIANCE_OFFICER | 1 步 | 中风险评级审批（预留） |
| `PEP_RELATIONSHIP_APPROVAL` | MLRO → SMO | 2 步（双签） | PEP 关系审批（预留） |

### 设计说明

- **traceId**：由发起动作时注入，贯穿 `approval_cases`、`change_tickets`/`delete_requests`、`audit_log_events` 三张表，实现全链路追踪。
- **冗余字段**（如 `createdByUserNo`、`decisionByUserNo`）：故意冗余，避免审计场景下因用户数据变更导致历史记录失真。
- **executionStatus 与 status 分离**：`status` 表示审批流程本身的状态，`executionStatus` 表示审批通过后业务动作的执行状态，两者独立演进。

---

## 5. approval_steps — 审批步骤表

### 业务说明

记录审批单的每一个步骤。系统支持**顺序多步审批**（sequential multi-step approval）：当 `approval_action_policies.checkerRoles` 包含多个角色时，`createDraftCase()` 为每个角色创建一条 `approval_steps` 记录（`stepNo` 从 1 递增），各步骤必须按顺序依次审批。Wave 1 原有的三种治理 actionType（`CHANGE_TICKET_APPROVAL`、`DELETE_REQUEST_APPROVAL`、`AUDIT_EVIDENCE_EXPORT_APPROVAL`）仍为单步审批；Wave 3 新增的 `ONBOARDING_FINAL_APPROVAL`、`RISK_RATING_HIGH_APPROVAL`、`PEP_RELATIONSHIP_APPROVAL` 等类型使用双步审批（dual-sign）。 *(Updated 2026-04-11)*

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `approvalCaseId` | String | NOT NULL, FK | 关联 `approval_cases.id` | 外键约束 |
| `approvalNo` | String | NULLABLE | 关联审批单业务编号 | 冗余字段，便于查询时避免 JOIN |
| `stepNo` | Int | NOT NULL | 步骤序号 | 从 `1` 递增；单步审批仅有 `1`，多步审批可达 `N` |
| `status` | Enum | NOT NULL | 步骤状态 | `PENDING` / `APPROVED` / `REJECTED` / `EXPIRED` / `CANCELLED` |
| `checkerRoleCandidates` | String | NOT NULL | 该步骤允许的审批角色 | 逗号分隔的 role code |
| `decidedByUserId` | String | NULLABLE | 决策人用户 id | |
| `decidedByUserNo` | String | NULLABLE | 决策人 `userNo` | 冗余字段 |
| `decidedByRole` | String | NULLABLE | 决策人实际使用的角色 code | |
| `reason` | String | NULLABLE | 决策说明或拒绝原因 | |
| `decidedAt` | DateTime | NULLABLE | 决策时间 | |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### 多步审批运行机制 *(Updated 2026-04-11)*

当 `checkerRoles` 策略包含 N 个角色时，`createDraftCase()` 创建 N 条 `approval_steps`：

```typescript
policy.checkerRoles.map((role, idx) => ({
  stepNo: idx + 1,
  status: 'PENDING',
  checkerRoleCandidates: role,   // 每步对应单个角色
}))
```

**审批顺序**：步骤必须按 `stepNo` 升序依次审批。`approve()` 查找第一个 `PENDING` 且匹配 actor 角色的步骤，标记为 `APPROVED`，然后检查是否存在后续 `PENDING` 步骤：
- 若存在 → case 保持 `PENDING`（mid-flow），等待下一步签批
- 若不存在 → case 变为 `APPROVED`（终态）

**拒绝逻辑**：任一步骤被拒绝时，当前步骤标记为 `REJECTED`，所有剩余 `PENDING` 步骤批量标记为 `CANCELLED`，case 立即变为 `REJECTED`。

### 设计说明

- 单步审批场景下（如 `CHANGE_TICKET_APPROVAL` → `checkerRoles: ['CISO']`），`approval_cases` 与 `approval_steps` 为 1:1 关系。
- 多步审批场景下（如 `ONBOARDING_FINAL_APPROVAL` → `checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER']`），系统创建 2 条步骤，Step 1 由 MLRO 签批，Step 2 由 SMO 签批。
- 每步的 `checkerRoleCandidates` 是该步骤独立的角色要求，与父表 `approval_cases.checkerRoles`（逗号分隔的完整列表）区分。

---

## 6. approval_action_policies — 审批策略配置表

### 业务说明

定义各审批类型的策略配置，包括：谁可以审批（`checkerRoles`）、多长时间超时（`timeoutHours`）、是否允许取消/重试。每次创建审批单时，系统从此表读取策略并快照写入 `approval_cases`，后续策略变更不影响已有审批单。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `actionType` | String | PK | 主键，对应审批类型 | 与 `approval_cases.actionType` 一一对应 |
| `riskLevel` | Enum | NOT NULL | 风险等级 | Wave 1 全部为 `HIGH` |
| `checkerRoles` | String | NOT NULL | 允许审批的角色 | 逗号分隔的 role code |
| `timeoutHours` | Int | NOT NULL, DEFAULT 24 | 超时小时数 | 从 `submittedAt` 起计算 |
| `allowCancel` | Boolean | NOT NULL | 是否允许 maker 取消审批 | |
| `allowRetry` | Boolean | NOT NULL | 执行失败后是否允许重试 | |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新（无 `createdAt`，以 `actionType` 为 PK） |

### Wave 1 Seeded 策略

| actionType | checkerRoles | timeoutHours | allowCancel | allowRetry |
|---|---|---|---|---|
| `AUDIT_EVIDENCE_EXPORT_APPROVAL` | `MLRO` | 24 | true | true |
| `CASE_EVIDENCE_EXPORT_APPROVAL` | `DPO,MLRO` | 24 | true | true |
| `CHANGE_TICKET_APPROVAL` | `CISO` | 24 | true | true |
| `DELETE_REQUEST_APPROVAL` | `DPO,CISO` | 24 | true | true |
| `ONBOARDING_FINAL_APPROVAL` | `MLRO,SENIOR_MANAGEMENT_OFFICER` | 240 | true | true |
| `POOL_SETTLEMENT_BATCH_APPROVAL` | `SENIOR_MANAGEMENT_OFFICER,TECH_OFFICER` | 24 | true | true |
| `TREASURY_CROSS_POOL_TRANSFER_APPROVAL` | `SENIOR_MANAGEMENT_OFFICER,TECH_OFFICER` | 24 | true | true |

> **说明**：`CASE_EVIDENCE_EXPORT_APPROVAL`、`POOL_SETTLEMENT_BATCH_APPROVAL`、`TREASURY_CROSS_POOL_TRANSFER_APPROVAL` 为 Wave 2+ 预埋策略，Wave 1 阶段不会触发，仅做前向兼容配置。

> **多步审批提示**：当 `checkerRoles` 包含多个角色时（如 `MLRO,SENIOR_MANAGEMENT_OFFICER`），系统为每个角色创建独立的 `approval_steps` 记录，步骤必须按序依次签批。详见 [第 5 节](#5-approval_steps--审批步骤表)。 *(Updated 2026-04-11)*

### Wave 3 新增策略 *(Updated 2026-04-11)*

| actionType | checkerRoles | timeoutHours | allowCancel | allowRetry | 说明 |
|---|---|---|---|---|---|
| `RISK_RATING_UPGRADE_PHASE1` | `MLRO` | 168 | true | true | Layer 2: LOW→HIGH phase 1 单步审批 |
| `RISK_RATING_MAINTENANCE_APPROVAL` | `MLRO` | 168 | true | true | Layer 2: HIGH→HIGH maintenance 单步审批 |
| `RISK_RATING_HIGH_APPROVAL` | `MLRO,SENIOR_MANAGEMENT_OFFICER` | 240 | true | true | Layer 2: LOW→HIGH phase 2 双步审批（MLRO→SMO） |
| `RISK_RATING_MEDIUM_APPROVAL` | `COMPLIANCE_OFFICER` | 168 | true | true | 预留（暂未启用） |
| `PEP_RELATIONSHIP_APPROVAL` | `MLRO,SENIOR_MANAGEMENT_OFFICER` | 240 | true | true | 预留（PEP 当前复用 `RISK_RATING_HIGH_APPROVAL`） |

### 设计说明

- 此表使用 `actionType` 作为主键（非 UUID），因为每种审批类型只有唯一一条策略，天然符合主键语义。
- 策略更新通过数据库迁移脚本进行，不提供运行时 API 修改。
- 快照机制：审批单创建时，`checkerRoles`、`allowCancel`、`allowRetry` 会快照写入 `approval_cases` 对应字段，避免策略变更影响进行中的审批。
- **DB 策略优先** *(Updated 2026-04-11)*：`ApprovalPolicyService.getPolicy()` 首先查询 `approval_action_policies` DB 表，未命中时回退到代码中的 `DEFAULT_APPROVAL_POLICIES` 常量。两者应保持同步。

---

## 7. approval_sod_rules — SoD 规则表

### 业务说明

SoD（Segregation of Duties，职责分离）规则表，定义审批流程中的职责隔离约束。Wave 1 实现了最核心的 maker-checker 隔离规则，确保同一个人不能既发起又审批同一件事。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `ruleCode` | String | PK | 规则代码，主键 | Wave 1 有效值：`DENY_SAME_USER_MAKER_CHECKER` |
| `enabled` | Boolean | NOT NULL | 是否启用 | `false` 时规则不生效（不建议在生产关闭） |
| `description` | String | NULLABLE | 规则说明 | |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### Wave 1 Seeded 规则

| ruleCode | enabled | description |
|---|---|---|
| `DENY_SAME_USER_MAKER_CHECKER` | `true` | 同一用户不得在同一审批单中同时担任 maker（创建人）和 checker（审批人） |

### SUPER_ADMIN 绕过机制

`SUPER_ADMIN` 角色在紧急情况下可绕过此规则（bypass），但系统会在 `audit_log_events` 中记录 `metadata.superAdminBypass=true`，确保操作可追溯、可审计。

### 设计说明

- SoD 规则的校验逻辑位于审批服务的 checker 身份验证环节，在 checker 提交审批决策前执行。
- Wave 2+ 可扩展新的规则代码（如 `DENY_CONSECUTIVE_APPROVALS_SAME_ROLE`），只需在此表新增一行并实现对应的规则引擎逻辑。

---

## 8. change_tickets — 变更工单表

### 业务说明

变更工单（Change Ticket）是 Wave 1 IAM 治理的核心操作单元。所有对 `user_roles` 表的修改（包括新增管理员和修改角色绑定）都必须通过 Change Ticket 工作流进行，禁止直接写库。

工单生命周期状态机：
```
DRAFT → PENDING_APPROVAL → READY → DONE
                         ↘ REJECTED
                         → CANCELLED
                READY → FAILED（执行失败）
```

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `ticketNo` | String | UNIQUE, NOT NULL | 业务编号 | 格式 `CT-YYYYMMDD-XXXX` |
| `status` | Enum | NOT NULL | 工单状态 | 见下方枚举说明 |
| `changeType` | Enum | NOT NULL | 变更类型 | Wave 1 有效值见下表 |
| `changeReason` | String | NOT NULL | 变更原因 | 必填，业务必要性说明 |
| `bindingSnapshotJson` | String | NOT NULL DEFAULT `{}` | 变更内容快照（JSON序列化字符串） | 提交时冻结，不可更改；包含 `intent` 字段 |
| `bindingDigest` | String | NULLABLE | 快照 SHA256 摘要 | 防篡改校验，消费前验证；`null` 表示尚未计算 |
| `scopeSummary` | String | NOT NULL | 变更范围描述 | 简要说明影响范围 |
| `testEvidenceRef` | String | NOT NULL | 测试证据引用 | 如测试报告 URL 或文件路径 |
| `rollbackPlanRef` | String | NOT NULL | 回滚计划引用 | 如回滚脚本 URL 或文件路径 |
| `approvalCaseId` | String | UNIQUE, NULLABLE | 关联审批单 id | 关联 `approval_cases.id`，UNIQUE 确保 1:1 |
| `approvalNo` | String | NULLABLE | 关联审批单业务编号 | 冗余字段 |
| `traceId` | String | NOT NULL | 链路追踪 ID | 贯穿整个工作流 |
| `createdByUserId` | String | NOT NULL | 创建人用户 id | 关联 `users.id` |
| `createdByUserNo` | String | NOT NULL | 创建人 `userNo` | 冗余字段 |
| `submittedByUserId` | String | NULLABLE | 提交人用户 id | 一般与创建人相同 |
| `submittedByUserNo` | String | NULLABLE | 提交人 `userNo` | 冗余字段 |
| `consumedByUserId` | String | NULLABLE | 执行消费人用户 id | 执行阶段由系统/服务账号填写 |
| `consumedByUserNo` | String | NULLABLE | 执行消费人 `userNo` | 冗余字段 |
| `submittedAt` | DateTime | NULLABLE | 提交时间 | 进入 `PENDING_APPROVAL` 的时间 |
| `consumedAt` | DateTime | NULLABLE | 执行消费时间 | 进入 `DONE` 或 `FAILED` 的时间 |
| `resultNote` | String | NULLABLE | 执行结果说明 | 成功或失败的详细描述 |
| `deletedAt` | DateTime | NULLABLE | 软删除时间戳 | |
| `deletedBy` | String | NULLABLE | 执行软删除的用户 id | |
| `deleteRequestId` | String | NULLABLE | 关联的删除申请 id | 关联 `delete_requests.id` |
| `deleteRequestNo` | String | NULLABLE | 关联的删除申请业务编号 | 冗余字段 |
| `deleteReason` | String | NULLABLE | 删除原因 | 由删除工作流写入 |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### 枚举说明

**ChangeTicketStatus**：
| 值 | 说明 |
|---|---|
| `DRAFT` | 草稿，可编辑 |
| `PENDING_APPROVAL` | 已提交，等待审批 |
| `READY` | 审批通过，待执行 |
| `DONE` | 执行成功，变更已生效 |
| `FAILED` | 执行失败 |
| `REJECTED` | 审批被拒绝 |
| `CANCELLED` | 已取消 |

**ChangeType**：
| 值 | 说明 |
|---|---|
| `ADMIN_ACCESS_CHANGE` | 管理员访问权限变更（新增/撤销用户） |
| `RBAC_CATALOG_CHANGE` | RBAC 角色绑定目录变更 |

### bindingSnapshotJson 结构说明

`bindingSnapshotJson` 通过 `intent` 字段区分变更意图：

**intent = `ADMIN_MEMBER_PROVISIONING`**（新增管理员）：
```json
{
  "intent": "ADMIN_MEMBER_PROVISIONING",
  "email": "new_admin@fiatx.com",
  "roleCodes": ["COMPLIANCE_OFFICER"]
}
```

**intent = `ADMIN_ROLE_BINDING_CHANGE`**（修改角色绑定）：
```json
{
  "intent": "ADMIN_ROLE_BINDING_CHANGE",
  "targetUserId": "user-uuid-xxxx",
  "targetUserNo": "ADMIN-XXX",
  "roleCodes": ["CISO", "COMPLIANCE_OFFICER"]
}
```

### 设计说明

- **快照冻结**：工单提交后，`bindingSnapshotJson` 不可修改。系统在执行前会验证 `bindingDigest`，确保快照未被篡改。
- **消费者模式**：Wave 1 中，`READY` 状态的工单由 `GovernedExecutionListener` 监听 `change-ticket.consumed` 事件后执行，实现审批与执行的解耦。
- **唯一绑定**：`approvalCaseId` 设置了 UNIQUE 约束，确保一个工单最多对应一个审批单。

---

## 9. delete_requests — 删除申请表

### 业务说明

删除申请（Delete Request）是 Wave 1 中对重要数据执行软删除的唯一合规路径。删除操作同样需要 maker-checker 审批，执行人（consumer）与申请人（maker）必须是不同的人（`SUPER_ADMIN` 例外）。

删除申请生命周期：
```
DRAFT → PENDING_APPROVAL → READY → DONE
                          ↘ REJECTED
                          → CANCELLED
               READY → FAILED
```

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `requestNo` | String | UNIQUE, NOT NULL | 业务编号 | 格式 `DR-YYYYMMDD-XXXX` |
| `targetType` | Enum | NOT NULL | 删除目标类型 | Wave 1 有效值见下表 |
| `targetId` | String | NOT NULL | 目标记录 id | 对应目标表的主键 |
| `targetNo` | String | NOT NULL | 目标业务编号 | 如 `ticketNo` / `packageNo` / `userNo` |
| `status` | Enum | NOT NULL | 申请状态 | `DRAFT` / `PENDING_APPROVAL` / `READY` / `DONE` / `FAILED` / `REJECTED` / `CANCELLED` |
| `approvalCaseId` | String | UNIQUE, NULLABLE | 关联审批单 id | UNIQUE 确保 1:1 |
| `approvalNo` | String | NULLABLE | 关联审批单业务编号 | 冗余字段 |
| `createdByUserId` | String | NOT NULL | 创建人（maker）用户 id | |
| `createdByUserNo` | String | NOT NULL | 创建人 `userNo` | 冗余字段 |
| `submittedByUserId` | String | NULLABLE | 提交人用户 id | 一般与创建人相同 |
| `submittedByUserNo` | String | NULLABLE | 提交人 `userNo` | 冗余字段 |
| `consumedByUserId` | String | NULLABLE | 执行消费人用户 id | 必须不同于创建人（`SUPER_ADMIN` 例外） |
| `consumedByUserNo` | String | NULLABLE | 执行消费人 `userNo` | 冗余字段 |
| `deleteReason` | String | NOT NULL | 删除原因 | 必填，合规要求 |
| `resultNote` | String | NULLABLE | 执行结果说明 | |
| `docRef` | String | NULLABLE | 外部文档引用 | 如合规审批单据 URL |
| `targetSnapshotJson` | String | NOT NULL DEFAULT `{}` | 目标对象快照（JSON序列化字符串） | 创建申请时冻结，记录删除前的数据状态 |
| `targetSnapshotDigest` | String | NULLABLE | 快照 SHA256 摘要 | 防篡改 |
| `traceId` | String | NOT NULL | 链路追踪 ID | |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |
| `submittedAt` | DateTime | NULLABLE | 提交时间 | 进入 `PENDING_APPROVAL` 的时间 |
| `consumedAt` | DateTime | NULLABLE | 执行消费时间 | 进入 `DONE` 或 `FAILED` 的时间 |

### 枚举说明

**DeleteTargetType**（Wave 1 有效值）：
| 值 | 说明 |
|---|---|
| `CHANGE_TICKET` | 删除变更工单（仅允许删除 `DONE`/`REJECTED`/`CANCELLED` 状态） |
| `AUDIT_EVIDENCE_PACKAGE` | 删除审计证据包 |
| `ADMIN_USER` | 删除管理员账号（软删除，保留 `users` 记录） |

### 设计说明

- **消费人隔离**：执行删除操作的用户（consumer）必须与创建申请的用户（maker）不同，这是 SoD 原则在删除流程中的体现。`SUPER_ADMIN` 在紧急情况下可例外，但会在审计日志中标记。
- **快照保全**：`targetSnapshotJson` 在申请创建时冻结，即使目标记录在审批期间被修改，历史状态也得以保留，满足监管举证要求。
- **软删除写回**：执行完成后，删除工作流将 `deletedAt`、`deletedBy`、`deleteRequestId`、`deleteReason` 写回目标记录（如 `users.deletedAt`、`change_tickets.deletedAt`）。

---

## 10. audit_log_events — 审计日志事件表

### 业务说明

审计日志是 Wave 1 合规架构的基石。系统中**所有重要操作**（用户登录、审批决策、变更执行、删除操作等）都必须写入此表，且记录一经写入**不可修改、不可物理删除**。

`payloadDigest` 字段对整条记录做摘要，用于检测日志是否被篡改。关联的业务主体编号通过 `audit_log_subject_nos` 子表记录（详见 Section 12）。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `auditNo` | String | UNIQUE, NOT NULL | 业务编号 | 格式 `AUD-YYYYMMDD-XXXX` |
| `triggerType` | String | NOT NULL | 触发机制分类 | 见下方枚举说明 |
| `action` | String | NOT NULL | 具体操作代码 | 如 `CHANGE_TICKET_CREATED`、`APPROVAL_GRANTED`，必须来自常量文件 |
| `entityType` | String | NOT NULL | 实体类型 | 如 `CHANGE_TICKET`、`APPROVAL_CASE`、`AUDIT_EVIDENCE_PACKAGE` |
| `entityId` | String | NULLABLE | 实体主键 id | |
| `entityNo` | String | NULLABLE | 实体业务编号 | 如 `CT-20260405-0001`、`AEP-20260429-0001` |
| `traceId` | String | NULLABLE | 链路追踪 ID | 用于跨表、跨服务关联同一工作流实例的所有事件 |
| `workflowType` | String | NULLABLE | 关联工作流类型 | 如 `AUDIT_EVIDENCE_EXPORT`、`CHANGE_TICKET`，Audit Center 按此聚合 |
| `entityOwnerType` | String | NULLABLE | 实体所有者类型 | 多租户场景下的所有者类型（如 CUSTOMER） |
| `entityOwnerId` | String | NULLABLE | 实体所有者 id | |
| `entityOwnerNo` | String | NULLABLE | 实体所有者业务编号 | 冗余字段，便于查询，避免 JOIN |
| `actorType` | String | NOT NULL | 操作人类型 | `SYSTEM` / `ADMIN` / `CLIENT` |
| `actorId` | String | NOT NULL | 操作人 id | 系统触发时填 `'SYSTEM'` |
| `actorNo` | String | NULLABLE | 操作人业务编号 | 如 `ADMIN-CISO` |
| `actorRole` | String | NULLABLE | 操作人角色 code | 记录操作时实际使用的角色 |
| `requestId` | String | NULLABLE | HTTP 请求 id | 系统触发时为空，用于幂等键生成 |
| `sourceIp` | String | NULLABLE | 来源 IP 地址 | 系统触发时为空 |
| `sourcePlatform` | String | NULLABLE | 来源平台标识 | 如 `ADMIN_API`、`SYSTEM`、`CLIENT_API` |
| `result` | String | NOT NULL, DEFAULT 'SUCCESS' | 操作结果 | `SUCCESS` / `FAILED` / `REJECTED` |
| `reason` | String | NULLABLE | 失败原因或补充说明 | |
| `metadata` | String | NULLABLE | 附加元数据（JSON 字符串） | 如 `{ itemCount: 42, fileSize: 102400 }` |
| `idempotencyKey` | String | UNIQUE, NULLABLE | 幂等键 | SHA256(action \| entityType \| entityId \| requestId \| triggerType) |
| `payloadDigest` | String | NOT NULL | 整条记录摘要 | SHA256，用于检测日志篡改 |
| `retainedUntil` | DateTime | NOT NULL | 数据保留截止时间 | 写入时根据保留策略自动计算 |
| `archivedAt` | DateTime | NULLABLE | 归档时间 | 归档处理后写入，`null` 表示未归档 |
| `occurredAt` | DateTime | NOT NULL, DEFAULT now() | 事件发生的业务时间 | 与 `createdAt`（系统写入时间）可能因消息延迟而不同 |
| `createdAt` | DateTime | NOT NULL, DEFAULT now() | 数据库记录写入时间 | |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |
| `subjectNos` | Relation | — | 关联 `audit_log_subject_nos[]` | 子表，详见 Section 12 |

> **已删除字段**：`module`（2026-04-29 删除）。workflow 上下文已由 `workflowType` + `entityType` + `action` + `triggerType` 完整覆盖，`module` 字段冗余无独立信息量，从 schema、DTO、所有 service call site 中全部移除。

### 索引

| 索引 | 字段 | 用途 |
|---|---|---|
| PK | `id` | 主键查询 |
| UNIQUE | `auditNo` | 业务编号唯一 |
| UNIQUE | `idempotencyKey` | 幂等防重 |
| INDEX | `occurredAt` | 时间范围查询 |
| INDEX | `triggerType, occurredAt` | 按触发类型过滤 |
| INDEX | `entityType, entityId` | 按实体查询 |
| INDEX | `actorType, actorId, occurredAt` | 按操作人查询 |
| INDEX | `actorNo, occurredAt` | 按操作人业务编号查询 |
| INDEX | `entityOwnerNo, occurredAt` | 按所有者查询 |
| INDEX | `traceId, occurredAt` | 按 trace 查询工作流时间线 |
| INDEX | `workflowType, occurredAt` | 按工作流类型聚合 |
| INDEX | `result, occurredAt` | 按操作结果过滤 |
| INDEX | `retainedUntil` | 数据保留清理任务 |
| INDEX | `archivedAt` | 归档状态查询 |

### 枚举说明

**TriggerType**（`AuditTriggerType` 枚举）：
| 值 | 说明 |
|---|---|
| `STATE_TRANSITION` | 业务状态机流转 |
| `MANUAL_OVERRIDE` | 人工干预/手动覆盖 |
| `EVIDENCE_EXPORT` | 审计证据导出操作（C5 专用） |
| `AUTH_EVENT` | 认证相关事件（登录、锁定、解锁） |
| `PERMISSION_CHANGE` | 权限变更操作 |
| `CONFIG_CHANGE` | 配置变更操作 |
| `DATA_CREATE` | 数据创建操作 |
| `DATA_UPDATE` | 数据更新操作 |
| `DATA_DELETE` | 数据删除操作 |
| `SYSTEM_EVENT` | 系统内部自动触发事件 |

**AuditResult**：
| 值 | 说明 |
|---|---|
| `SUCCESS` | 操作成功 |
| `FAILED` | 操作失败（技术性错误） |
| `REJECTED` | 操作被拒绝（审批拒绝、校验未通过） |

### 设计说明

- **不可篡改原则**：应用层禁止对 `audit_log_events` 执行 UPDATE/DELETE。
- **幂等写入**：`idempotencyKey`（SHA256）保证同一业务事件在重试场景下不产生重复记录；唯一约束冲突被静默处理，不抛异常。
- **occurredAt vs createdAt**：`occurredAt` 是业务语义时间，`createdAt` 是 DB 写入时间，两者在事件回放/补录场景下可能不同。
- **无 module 字段**：上下文由 `workflowType`、`entityType`、`action`、`triggerType` 四字段共同承载，表达力更强且无冗余。

---

## 11. audit_evidence_packages — 审计证据包表

### 业务说明

审计证据包（Audit Evidence Package）是将选定的 `audit_log_events` 记录打包成可交付证据文件的数据结构。全流程需经过审批（`AUDIT_EVIDENCE_EXPORT_APPROVAL`）：

1. Maker 发起申请 → 证据包以 `PENDING_APPROVAL` 状态创建
2. Checker（DPO 或 MLRO）审批通过 → 系统异步执行打包 → 状态变为 `READY`
3. Operator 下载包文件

证据包从创建到就绪经历多个中间状态（见枚举说明）。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `packageNo` | String | UNIQUE, NOT NULL | 业务编号 | 格式 `AEP-YYYYMMDD-XXXX` |
| `approvalCaseId` | String | UNIQUE, NULLABLE | 关联审批单 id | 关联 `approval_cases.id`，UNIQUE 确保 1:1 |
| `approvalCaseNo` | String | NULLABLE | 关联审批单业务编号 | 冗余字段，避免 JOIN |
| `exportedByType` | String | NOT NULL | 申请人类型 | `ADMIN` |
| `exportedById` | String | NOT NULL | 申请人用户 id | 关联 `users.id`；审批通过后也是打包执行人 |
| `exportedByNo` | String | NULLABLE | 申请人 `userNo` | 冗余字段 |
| `exportedByRole` | String | NULLABLE | 申请人角色 code | 记录申请时使用的角色 |
| `status` | String | NOT NULL | 证据包状态 | 见下方枚举说明 |
| `exportMode` | String | NOT NULL, DEFAULT 'SELECTION' | 导出模式 | 目前仅有 `SELECTION`（手动勾选条目） |
| `fileName` | String | NULLABLE | 生成的文件名 | 格式 `{packageNo}.json`；打包完成前为 null |
| `filterSnapshot` | String | NULLABLE | 筛选条件快照（JSON 序列化） | 申请时传入的查询参数，包含 startAt/endAt/selectedEventIds 等 |
| `selectedEventIdsSnapshot` | String | NULLABLE | 选中的事件 ID 列表（JSON 序列化） | `SELECTION` 模式下被选中的 `audit_log_events.id` 列表 |
| `itemCount` | Int | NOT NULL | 选中记录数 | 创建时由系统计算 |
| `digest` | String | NOT NULL | 内容摘要 | SHA256；申请阶段为请求摘要，打包完成后更新为包体摘要 |
| `manifest` | String | NOT NULL | 包清单（JSON 序列化） | 描述包内容结构：版本、时间范围、生成时间、审批信息等 |
| `packageBody` | String | NULLABLE | 包体内容（JSON 序列化） | 打包完成前为 null；包含 records 列表和 manifest |
| `deletedAt` | DateTime | NULLABLE | 软删除时间戳 | 需通过 `DELETE_REQUEST_APPROVAL` 工作流删除 |
| `deletedBy` | String | NULLABLE | 执行软删除的用户 id | |
| `deleteRequestId` | String | NULLABLE | 关联的删除申请 id | |
| `deleteReason` | String | NULLABLE | 删除原因 | |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 证据包申请提交时创建 |
| `updatedAt` | DateTime | NOT NULL | 记录最后更新时间 | 自动更新 |

### 枚举说明

**PackageStatus**（完整状态集）：
| 值 | 说明 | 来源 |
|---|---|---|
| `PENDING_APPROVAL` | 审批等待中，尚未生成包体 | 申请创建时写入 |
| `READY` | 证据包已生成，可供下载 | 审批通过且打包成功后写入 |
| `FAILED` | 打包执行失败 | 审批通过但生成异常时写入 |
| `REJECTED` | 审批被拒绝 | Checker 拒绝时写入 |
| `CANCELLED` | 申请已取消 | 申请人或 SUPER_ADMIN 取消时写入 |
| `EXPIRED` | 审批超时 | 审批单 expire 时写入 |

**ExportMode**：
| 值 | 说明 |
|---|---|
| `SELECTION` | 手动勾选特定审计日志条目打包，目前唯一支持的模式 |

### 索引

| 索引 | 字段 | 用途 |
|---|---|---|
| PK | `id` | 主键 |
| UNIQUE | `packageNo` | 业务编号唯一 |
| UNIQUE | `approvalCaseId` | 确保 1:1 关联 |
| INDEX | `createdAt` | 时间排序查询 |
| INDEX | `exportedByType, exportedById` | 按申请人查询 |
| INDEX | `status, createdAt` | 按状态过滤 |
| INDEX | `exportMode, createdAt` | 按导出模式过滤 |

### manifest 结构（参考）

```json
{
  "version": "1.0",
  "generatedAt": "2026-04-29T14:00:00.000Z",
  "requestPhase": "PENDING_APPROVAL",   // 申请阶段
  "exportMode": "SELECTION",
  "criteria": { "startAt": "...", "endAt": "..." },
  "workflowSummary": { "... breakdown by workflow" },
  "itemCount": 42,
  "approvalStatus": "APPROVED",
  "approvalId": "uuid",
  "approvedBy": "user-uuid",
  "approvalDecidedAt": "2026-04-29T14:30:00.000Z"
}
```

### 设计说明

- **两阶段写入**：证据包在申请时创建（`PENDING_APPROVAL`），审批通过后异步更新 `packageBody`、`digest`、`manifest`、`fileName`、`status`，实现申请与生成解耦。
- **完整性保证**：`digest` 对包体做 SHA256 摘要，监管机构可在收到证据包后独立验证完整性。
- **软删除限制**：证据包删除须经 `DELETE_REQUEST_APPROVAL` 工作流（`targetType=AUDIT_EVIDENCE_PACKAGE`），禁止直接删除。删除后 `packageBody` 物理数据保留。

---

## 12. audit_log_subject_nos — 审计主体编号关联表

### 业务说明

每条 `audit_log_events` 记录可以关联多个"主体"（Subject）。主体是与本次审计事件存在业务关系的实体，典型用途：

- C5 导出申请事件同时关联 `AUDIT_EVIDENCE_PACKAGE`（被导出的包）和 `APPROVAL_CASE`（关联的审批单），使 Audit Center 可以通过 packageNo 或 approvalNo 任意一个编号检索到该事件。
- 审批决策事件同时关联审批单和被审批的业务实体。

`audit_log_subject_nos` 表支持通过 `subjectNo` 精确检索，是 Audit Center 跨实体关联查询的核心索引表。

### 字段定义

| 字段名 | 类型 | 约束 | 说明 | 备注 |
|---|---|---|---|---|
| `id` | UUID | PK | 主键 | |
| `eventId` | String | NOT NULL, FK | 关联 `audit_log_events.id` | 外键，级联删除（`onDelete: Cascade`） |
| `subjectRole` | String | NOT NULL | 主体在本事件中的角色 | 见下方枚举说明 |
| `subjectType` | String | NOT NULL | 主体实体类型 | 来自 `AuditEntityTypes` 常量，如 `AUDIT_EVIDENCE_PACKAGE`、`APPROVAL_CASE` |
| `subjectId` | String | NULLABLE | 主体内部 UUID | 可选，有助于精确关联 |
| `subjectNo` | String | NOT NULL | 主体业务编号 | 如 `AEP-20260429-0001`、`APR-20260429-0001` |
| `occurredAt` | DateTime | NOT NULL | 冗余自父事件的 occurredAt | 避免 JOIN 的查询优化字段 |
| `createdAt` | DateTime | NOT NULL | 记录创建时间 | 自动设置 |

### 枚举说明

**SubjectRole**（`AuditSubjectRole` 枚举）：
| 值 | 说明 |
|---|---|
| `ACTOR` | 主体是操作人（适合记录操作人的业务编号） |
| `OWNER` | 主体是实体的所有者（如客户） |
| `ENTITY` | 主体是本事件的核心实体（主角） |
| `RELATED` | 主体与本事件存在关联关系（配角） |
| `SOURCE` | 主体是触发本事件的来源实体 |

### 索引

| 索引 | 字段 | 用途 |
|---|---|---|
| PK | `id` | 主键 |
| INDEX | `subjectNo, occurredAt` | 按业务编号检索所有相关事件（核心查询路径） |
| INDEX | `subjectType, subjectNo, occurredAt` | 按类型+编号精确过滤 |
| INDEX | `eventId` | 反查某事件的所有 subject |

### 使用示例（C5 EXPORT_REQUESTED 事件）

```typescript
subjectNos: [
  {
    subjectRole: AuditSubjectRole.RELATED,
    subjectType: AuditEntityTypes.APPROVAL_CASE,
    subjectId: approval.id,
    subjectNo: approval.approvalNo,   // 'APR-20260429-0001'
  },
  {
    subjectRole: AuditSubjectRole.RELATED,
    subjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
    subjectId: evidencePackage.id,
    subjectNo: evidencePackage.packageNo,  // 'AEP-20260429-0001'
  },
]
```

效果：Audit Center 可以用 `APR-20260429-0001` 或 `AEP-20260429-0001` 任意一个编号，检索到这条 `EXPORT_REQUESTED` 事件。

### 设计说明

- **子表关系**：`audit_log_subject_nos` 通过 `eventId` 外键关联 `audit_log_events`，级联删除（审计事件理论上不删除，此配置为防御性设置）。
- **去 JOIN 设计**：`occurredAt` 冗余自父表，支持时间范围 + subjectNo 的复合查询，无需 JOIN。
- **写入归属**：由 `AuditLogsService` 内部在写入 `audit_log_events` 时同步批量写入，调用方通过 `subjectNos` 数组传入，不直接操作子表。

---

## 13. Seed 数据

### 13.1 Wave 1 管理员用户（8 个）

Wave 1 预置 8 个管理员账号，覆盖所有监管角色。这些账号在 Seed 脚本中创建，用于 demo 环境和开发测试。

| roleCode | email | userNo | 说明 |
|---|---|---|---|
| `SUPER_ADMIN` | admin@fiatx.com | `ADMIN-001` | 紧急兜底账号，不用于日常操作 |
| `SENIOR_MANAGEMENT_OFFICER` | sm@fiatx.com | `ADMIN-SMO` | 高层审批与监管问责，VARA RI 候选 |
| `CISO` | ciso@fiatx.com | `ADMIN-CISO` | IAM 治理与安全审批，VARA RI 候选 |
| `MLRO` | mlro@fiatx.com | `ADMIN-MLRO` | AML/CFT 独立监督，法定 MLRO |
| `DPO` | dpo@fiatx.com | `ADMIN-DPO` | 数据保护合规，UAE PDPL 要求 |
| `COMPLIANCE_OFFICER` | compliance_lead@fiatx.com | `ADMIN-COMP` | 日常合规操作 |
| `TECH_OFFICER` | tech_admin@fiatx.com | `ADMIN-TECH` | 平台运营与变更管理 |
| `OPS_OFFICER` | ops_officer@fiatx.com | `ADMIN-OPS` | 资金/结算/对账/会计 |

> **注意**：所有账号默认密码为 `123456`（仅限 demo 环境），生产环境部署前必须强制修改。

### 13.2 Wave 1 角色定义（8 个）

| code | name | VARA 对应 / 职责说明 |
|---|---|---|
| `SUPER_ADMIN` | Super Administrator | 紧急访问账号，非日常操作，拥有全部权限 |
| `SENIOR_MANAGEMENT_OFFICER` | Senior Management Officer | VARA RI（Responsible Individual）候选，高层审批与监管问责 |
| `CISO` | Chief Information Security Officer | VARA RI 候选，IAM 治理与安全审批 |
| `MLRO` | Money Laundering Reporting Officer | 法定 MLRO 角色，AML/CFT 独立监督 |
| `DPO` | Data Protection Officer | UAE PDPL 法规要求，数据保护合规 |
| `COMPLIANCE_OFFICER` | Compliance Officer | 日常合规操作与监控 |
| `TECH_OFFICER` | Tech Officer | 平台技术运营与变更管理 |
| `OPS_OFFICER` | Operations Officer | 资金运营、结算、对账、会计 |

### 13.3 审批策略（Wave 1: 7 条 + Wave 3: 5 条）

详见 [第 6 节](#6-approval_action_policies--审批策略配置表) 中的 Wave 1 Seeded 策略表和 Wave 3 新增策略表。

### 13.4 Wave 1 SoD 规则（1 条）

| ruleCode | enabled | 说明 |
|---|---|---|
| `DENY_SAME_USER_MAKER_CHECKER` | `true` | 同一用户不得在同一审批单中同时担任 maker（发起人）和 checker（审批人） |

---

## 附录：业务编号格式汇总

| 表 | 字段 | 格式 | 示例 |
|---|---|---|---|
| `users` | `userNo` | `ADMIN-{CODE 或 序号}` | `ADMIN-001`、`ADMIN-CISO` |
| `approval_cases` | `approvalNo` | `APR-YYYYMMDD-XXXX` | `APR-20260405-0001` |
| `change_tickets` | `ticketNo` | `CT-YYYYMMDD-XXXX` | `CT-20260405-0001` |
| `delete_requests` | `requestNo` | `DR-YYYYMMDD-XXXX` | `DR-20260405-0001` |
| `audit_log_events` | `auditNo` | `AUD-YYYYMMDD-XXXX` | `AUD-20260405-0001` |
| `audit_evidence_packages` | `packageNo` | `AEP-YYYYMMDD-XXXX` | `AEP-20260405-0001` |

---

## 附录：软删除字段约定

Wave 1 所有支持软删除的表（`users`、`change_tickets`、`delete_requests`、`approval_cases`、`audit_evidence_packages`）均遵循统一的软删除字段约定：

| 字段 | 类型 | 说明 |
|---|---|---|
| `deletedAt` | DateTime | 软删除时间戳，`null` 表示未删除 |
| `deletedBy` | String | 执行软删除的用户 id |
| `deleteRequestId` | String | 触发本次删除的 `delete_requests.id` |
| `deleteReason` | String | 删除原因（从 `delete_requests.deleteReason` 冗余写入） |

> **查询约定**：所有常规查询均应加上 `WHERE deletedAt IS NULL` 过滤软删除记录。Prisma 的软删除中间件（若配置）会自动处理此逻辑。

---

*文档由 Claude Code 生成，基于 Wave 1 实现代码与数据库 Schema 分析。如有字段变更，请同步更新此文档。*

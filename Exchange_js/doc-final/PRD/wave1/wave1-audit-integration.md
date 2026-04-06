# Wave 1 审计底座集成指南

> **受众**：AI 代码代理 / 未来 Wave 的开发者
> **语言约定**：中文说明 + 英文代码
> **最后更新**：2026-04-06（Wave 1 稳定合约）

---

## Section 1: 审计底座概述

Wave 1 建立了 `AuditLogsService`（位于 `src/modules/risk-engine/audit-logs/audit-logs.service.ts`）作为所有模块的**统一审计记录接口**。

### 核心约束

- **所有写操作 MUST 通过 `AuditLogsService`**。任何模块均不得直接写 `audit_log_events` 表或 `audit_log_subject_nos` 表。
- 常量来源必须使用 `audit-actions.constant.ts` 中定义的 `AuditModules`、`AuditEntityTypes`、`AuditActions`、`AuditWorkflowTypes`，不得硬编码字符串。
- 每次调用须携带有效的 `traceId`——Audit Center 依赖 `traceId` 串联同一工作流实例的所有事件。

### 两个主要调用入口

| 方法 | 适用场景 | triggerType 推断 |
|---|---|---|
| `recordByActor(input, actor)` | 管理员或客户主动触发的操作 | 由 service 根据 action/module 自动推断 |
| `recordSystem(input)` | 系统内部触发（事件监听器、定时任务、自动执行） | 强制设为 `SYSTEM_EVENT` |

`recordSystem()` 是对 `recordByActor()` 的封装，自动注入 `actorType='SYSTEM'`、`actorId='SYSTEM'`、`sourcePlatform='SYSTEM'`，调用方无需再传 actor 参数。

---

## Section 2: 如何调用 AuditLogsService

### 2.1 recordSystem() — 系统触发

适用于：事件监听器（如 `GovernedExecutionListener`）、后台 worker、系统自动状态转换等。

```typescript
await this.auditLogsService.recordSystem({
  module: AuditModules.GOVERNANCE_CHANGE_TICKETS,
  entityType: AuditEntityTypes.CHANGE_TICKET,
  entityId: ticket.id,
  entityNo: ticket.ticketNo,
  action: AuditActions.CHANGE_TICKET_CREATED,
  actorId: actor.userId,
  actorNo: actor.userNo,
  actorRole: actor.role,
  traceId: ticket.traceId,
  workflowType: AuditWorkflowTypes.CHANGE_TICKET,
  workflowId: ticket.id,
  workflowNo: ticket.ticketNo,
  subjectNos: [ticket.ticketNo],
  metadata: { changeType: ticket.changeType },
});
```

### 2.2 recordByActor() — 管理员/客户触发

适用于：API 请求直接触发的写操作，actor 为真实用户。

```typescript
await this.auditLogsService.recordByActor(
  {
    module: AuditModules.GOVERNANCE_APPROVALS,
    entityType: AuditEntityTypes.APPROVAL_CASE,
    entityId: approval.id,
    entityNo: approval.approvalNo,
    action: AuditActions.APPROVAL_APPROVED,
    traceId: approval.traceId,
    workflowType: AuditWorkflowTypes.APPROVAL,
    workflowId: approval.id,
    workflowNo: approval.approvalNo,
    subjectNos: [approval.approvalNo, approval.entityRef],
    metadata: { decisionReason: dto.reason },
  },
  {
    actorType: 'ADMIN',
    actorId: actor.userId,
    actorNo: actor.userNo,
    actorRole: actor.role,
  },
);
```

### 2.3 必填字段说明

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `module` | string | `AuditModules` 常量 | 标识所属业务模块 |
| `entityType` | string | `AuditEntityTypes` 常量 | 标识被审计的实体类型 |
| `entityId` | string | 数据库主键（UUID） | 被审计实体的内部 ID |
| `entityNo` | string | 业务编号字段 | 面向操作员的可读标识 |
| `action` | string | `AuditActions` 常量 | 标识具体操作，必须 UPPER_SNAKE_CASE |
| `traceId` | string | 工作流创建时生成，贯穿全程 | 用于 Audit Center 关联事件链 |
| `workflowType` | string | `AuditWorkflowTypes` 常量 | 用于 Audit Center 按工作流查询 |
| `workflowId` | string | 工作流根实体 ID | 通常与 `entityId` 相同 |
| `workflowNo` | string | 工作流根实体业务编号 | 通常与 `entityNo` 相同 |

**actor（仅 `recordByActor()` 需要）**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `actorType` | `'ADMIN' \| 'CUSTOMER' \| 'SYSTEM'` | 操作人身份类型 |
| `actorId` | string | 操作人 userId；系统调用传 `'SYSTEM'` |
| `actorNo` | string? | 操作人的业务编号（可选，service 会自动解析） |
| `actorRole` | string? | 操作人当前角色 code |

### 2.4 幂等性机制

`AuditLogsService` 内部通过 `idempotencyKey` 防止重复写入。当调用方未显式传入 `idempotencyKey` 时，service 会自动生成：

```
idempotencyKey = sha256(module + '|' + entityType + '|' + entityId + '|' + action + '|' + requestId_or_NO_REQUEST_ID + '|' + triggerType)
```

若重复调用（相同 module + entityType + entityId + action + requestId），数据库的唯一约束会被捕获并静默处理（返回已存在的记录），**不会抛异常**。这意味着同一事件路径上的意外重复调用不会产生重复记录。

---

## Section 3: Wave 1 审计事件字典

### 3.1 GOVERNANCE_CHANGE_TICKETS 模块

模块常量：`AuditModules.GOVERNANCE_CHANGE_TICKETS` = `'governance/change-tickets'`
实体类型：`AuditEntityTypes.CHANGE_TICKET`
工作流类型：`AuditWorkflowTypes.CHANGE_TICKET`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `CHANGE_TICKET_CREATED` | `'CHANGE_TICKET_CREATED'` | 工单创建成功（DRAFT 写入） | `recordByActor` |
| `CHANGE_TICKET_SUBMITTED` | `'CHANGE_TICKET_SUBMITTED'` | 工单提交审批（→ PENDING_APPROVAL） | `recordByActor` |
| `CHANGE_TICKET_APPROVAL_LINKED` | `'CHANGE_TICKET_APPROVAL_LINKED'` | 审批单与工单关联（approvalId 写入） | `recordSystem` |
| `CHANGE_TICKET_APPROVED` | `'CHANGE_TICKET_APPROVED'` | 审批通过，工单变 READY | `recordSystem` |
| `CHANGE_TICKET_REJECTED` | `'CHANGE_TICKET_REJECTED'` | 审批拒绝/超时/取消，工单变 REJECTED | `recordSystem` |
| `CHANGE_TICKET_CONSUMED` | `'CHANGE_TICKET_CONSUMED'` | 工单执行成功（→ DONE） | `recordSystem` |
| `CHANGE_TICKET_DEPLOY_FAILED` | `'CHANGE_TICKET_DEPLOY_FAILED'` | 工单执行失败 | `recordSystem` |

### 3.2 GOVERNANCE_DELETE_REQUESTS 模块

模块常量：`AuditModules.GOVERNANCE_DELETE_REQUESTS` = `'governance/delete-requests'`
实体类型：`AuditEntityTypes.DELETE_REQUEST`
工作流类型：`AuditWorkflowTypes.DELETE_REQUEST`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `DELETE_REQUEST_CREATED` | `'DELETE_REQUEST_CREATED'` | 删除申请创建 | `recordByActor` |
| `DELETE_REQUEST_SUBMITTED` | `'DELETE_REQUEST_SUBMITTED'` | 提交审批 | `recordByActor` |
| `DELETE_REQUEST_APPROVED` | `'DELETE_REQUEST_APPROVED'` | 审批通过 | `recordSystem` |
| `DELETE_REQUEST_REJECTED` | `'DELETE_REQUEST_REJECTED'` | 审批拒绝/超时/取消 | `recordSystem` |
| `DELETE_REQUEST_CANCELLED` | `'DELETE_REQUEST_CANCELLED'` | 申请人主动取消 | `recordByActor` |
| `DELETE_REQUEST_CONSUMED` | `'DELETE_REQUEST_CONSUMED'` | 执行成功，目标软删除完成 | `recordSystem` |
| `DELETE_REQUEST_EXECUTION_FAILED` | `'DELETE_REQUEST_EXECUTION_FAILED'` | 执行失败 | `recordSystem` |

### 3.3 GOVERNANCE_APPROVALS 模块

模块常量：`AuditModules.GOVERNANCE_APPROVALS` = `'governance/approvals'`
实体类型：`AuditEntityTypes.APPROVAL_CASE`
工作流类型：`AuditWorkflowTypes.APPROVAL`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `APPROVAL_SUBMITTED` | `'APPROVAL_SUBMITTED'` | 审批单进入 PENDING | `recordByActor` |
| `APPROVAL_APPROVED` | `'APPROVAL_APPROVED'` | checker 批准 | `recordByActor` |
| `APPROVAL_REJECTED` | `'APPROVAL_REJECTED'` | checker 拒绝 | `recordByActor` |
| `APPROVAL_CANCELLED` | `'APPROVAL_CANCELLED'` | 取消 | `recordByActor` |
| `APPROVAL_EXPIRED` | `'APPROVAL_EXPIRED'` | 超时 | `recordSystem` |
| `APPROVAL_EXECUTED` | `'APPROVAL_EXECUTED'` | 执行成功 | `recordSystem` |
| `APPROVAL_EXECUTION_FAILED` | `'APPROVAL_EXECUTION_FAILED'` | 执行失败 | `recordSystem` |
| `APPROVAL_REQUIRED_MISSING` | `'APPROVAL_REQUIRED_MISSING'` | 需要审批但未创建审批单 | `recordSystem` |

### 3.4 AUDIT_LOGS 模块（证据包相关）

模块常量：`AuditModules.AUDIT_LOGS` = `'risk-engine/audit-logs'`
实体类型：`AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `AUDIT_EVIDENCE_EXPORT_REQUESTED` | `'AUDIT_EVIDENCE_EXPORT_REQUESTED'` | 请求导出证据包 | `recordByActor` |
| `AUDIT_EVIDENCE_PACKAGE_EXPORTED` | `'AUDIT_EVIDENCE_PACKAGE_EXPORTED'` | 证据包生成完成 | `recordSystem` |
| `AUDIT_EVIDENCE_PACKAGE_DOWNLOADED` | `'AUDIT_EVIDENCE_PACKAGE_DOWNLOADED'` | 证据包被下载 | `recordByActor` |

---

## Section 4: Future Wave 接入规范

### 4.1 新 Wave 接入前必须完成

1. **在 `AuditModules` 中注册新模块常量**（文件：`audit-actions.constant.ts`）
2. **在 `AuditEntityTypes` 中注册新实体类型常量**（同上文件）
3. **在 `AuditActions` 中注册新 action 常量**（同上文件，命名必须 `UPPER_SNAKE_CASE`）
4. **所有写操作必须调用 `recordByActor()` 或 `recordSystem()`**，根据触发来源选择
5. **关联审批的操作必须在 `subjectNos` 中包含 `approvalNo`**，以便 Audit Center 按审批单查询
6. **`workflowType` / `workflowId` / `workflowNo` 必须填写**，Audit Center 依赖这三个字段按工作流聚合事件

示例（新 Wave 接入模板）：

```typescript
// 1. 在 audit-actions.constant.ts 中添加
export const AuditModules = {
  // ... 已有模块
  MY_NEW_MODULE: 'my-domain/my-new-module',  // 新增
} as const;

export const AuditEntityTypes = {
  // ... 已有类型
  MY_NEW_ENTITY: 'MY_NEW_ENTITY',  // 新增
} as const;

export const AuditActions = {
  // ... 已有 actions
  MY_ENTITY_CREATED: 'MY_ENTITY_CREATED',    // 新增
  MY_ENTITY_APPROVED: 'MY_ENTITY_APPROVED',  // 新增
} as const;

// 2. 在 service 中调用
await this.auditLogsService.recordByActor(
  {
    module: AuditModules.MY_NEW_MODULE,
    entityType: AuditEntityTypes.MY_NEW_ENTITY,
    entityId: entity.id,
    entityNo: entity.entityNo,
    action: AuditActions.MY_ENTITY_CREATED,
    traceId: entity.traceId,
    workflowType: AuditWorkflowTypes.MY_WORKFLOW,
    workflowId: entity.id,
    workflowNo: entity.entityNo,
    subjectNos: [entity.entityNo],
  },
  actor,
);
```

### 4.2 严禁事项（DO NOT）

1. **不得直接写 `audit_log_events` 表**——任何 Prisma `auditLogEvent.create()` 调用都必须在 `AuditLogsService` 内部。
2. **不得在同一事件路径上重复调用**——幂等键会去重，但额外的调用仍会产生不必要的数据库查询。
3. **不得省略 `traceId`**——Audit Center 的"工作流时间线"视图依赖 `traceId` 关联所有相关事件；省略将导致事件孤立，无法在 UI 中追踪。
4. **不得硬编码 action 字符串**——必须使用 `AuditActions` 常量，字符串值由常量文件统一维护。
5. **不得跨模块借用 action 常量**——每个模块应定义自己的 action，避免语义混淆。

### 4.3 测试要求

- 每个 action 路径必须有对应的单元测试，断言 `auditLogsService.recordByActor` 或 `auditLogsService.recordSystem` 被调用，且参数中包含正确的 `module`、`entityType`、`action`、`traceId`。
- 建议使用 `jest.spyOn(auditLogsService, 'recordSystem')` 在 spec 中验证调用参数。
- 幂等性场景（同一请求重复到达）应在集成测试中覆盖。

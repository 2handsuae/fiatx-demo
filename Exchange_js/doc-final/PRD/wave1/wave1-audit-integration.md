# Wave 1 审计底座集成指南

> **受众**：AI 代码代理 / 未来 Wave 的开发者
> **语言约定**：中文说明 + 英文代码
> **最后更新**：2026-04-29（删除 module 字段；C5 Plan B 架构；action 命名规范）

---

## Section 1: 审计底座概述

Wave 1 建立了 `AuditLogsService`（位于 `src/modules/audit-logging/audit-logs.service.ts`）作为所有模块的**统一审计记录接口**。

### 核心约束

- **所有写操作 MUST 通过 `AuditLogsService`**。任何模块均不得直接写 `audit_log_events` 表或 `audit_log_subject_nos` 表。
- Action 常量来自 `audit-actions.constant.ts` 中的 `AuditActions`、`AuditGovernanceActions`，命名必须 **`UPPER_SNAKE_CASE`**，不得硬编码字符串。
- `module` 字段已于 2026-04-29 从数据库表和所有 DTO 中删除，**禁止传入该字段**。上下文信息由 `workflowType`、`entityType`、`action`、`triggerType` 四字段共同承载，信息量完整。

### 两个主要调用入口

| 方法 | 适用场景 |
|---|---|
| `recordByActor(input, actor)` | 管理员或客户主动触发的操作 |
| `recordSystem(input)` | 系统内部触发（事件监听器、定时任务、自动执行） |

`recordSystem()` 自动注入 `actorType='SYSTEM'`、`actorId='SYSTEM'`、`sourcePlatform='SYSTEM'`，调用方无需传 actor 参数。

---

## Section 2: 架构模式 — 两种写入模式

### 2.1 通用模式（大多数 workflow）

业务 service 直接调用 `AuditLogsService.recordByActor()` 或 `recordSystem()`。`ApprovalsService` 负责写通用审批节点事件（`APPROVAL_SUBMITTED`、`APPROVAL_APPROVED` 等）。

### 2.2 Workflow 独占模式（Plan B — 适用于 C5 等）

**判断条件**：当一个 workflow 满足以下任意一条，应使用独占模式：
- 有业务语义的中间状态（不只是"审批通过"，还有"生成中/生成失败/已下载"等）
- 有异步副作用（文件生成、后台任务）
- action 集合 > 3 个，且与通用审批动作不重叠

**实现方式**：
1. 为该 workflow 创建专属 service（如 `AuditEvidenceExportApprovalService`），该 service 是**唯一的审计日志写入者**，负责所有节点（含审批节点）的审计事件。
2. 在 `ApprovalsService.hasDedicatedAuditService(workflowType)` 中注册该 workflowType，使通用审批 service 跳过对应的 audit 写入，防止重复。

```typescript
// approvals.service.ts
private hasDedicatedAuditService(workflowType: string | null | undefined): boolean {
  return workflowType === AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT;
  // 新增 Plan B workflow 时在此扩展
}
```

---

## Section 3: 如何调用 AuditLogsService

### 3.1 recordByActor() — 管理员/客户触发

```typescript
await this.auditLogsService.recordByActor(
  {
    triggerType: AuditTriggerType.STATE_TRANSITION,   // 可选，不传由 service 推断
    action: AuditActions.APPROVAL_APPROVED,           // 必填，来自常量
    entityType: AuditEntityTypes.APPROVAL_CASE,       // 必填
    entityId: approval.id,                            // 可选（UUID）
    entityNo: approval.approvalNo,                    // 可选（业务编号）
    workflowType: AuditWorkflowTypes.APPROVAL,        // 可选，用于跨表聚合查询
    traceId: approval.traceId,                        // 可选，强烈建议填写
    result: AuditResult.SUCCESS,                      // 可选，默认 SUCCESS
    metadata: { decisionReason: dto.reason },         // 可选
    subjectNos: [...],                                // 可选，关联主体编号
    sourcePlatform: 'ADMIN_API',                      // 可选
    requestId: 'req-xxx',                             // 可选
  },
  {
    actorType: 'ADMIN',
    actorId: actor.userId,
    actorNo: actor.userNo,
    actorRole: actor.role,
  },
);
```

### 3.2 recordSystem() — 系统触发

```typescript
await this.auditLogsService.recordSystem({
  action: AuditActions.CHANGE_TICKET_CONSUMED,
  entityType: AuditEntityTypes.CHANGE_TICKET,
  entityId: ticket.id,
  entityNo: ticket.ticketNo,
  workflowType: AuditWorkflowTypes.CHANGE_TICKET,
  traceId: ticket.traceId,
  metadata: { changeType: ticket.changeType },
});
```

### 3.3 必填与重要字段说明

| 字段 | 必填 | 来源 | 说明 |
|---|---|---|---|
| `action` | ✅ | `AuditActions` 或 `AuditGovernanceActions` 常量 | 必须 `UPPER_SNAKE_CASE`，禁止硬编码字符串 |
| `entityType` | ✅ | `AuditEntityTypes` 常量 | 标识被审计的实体类型 |
| `entityId` | — | 数据库主键（UUID） | 被审计实体的内部 ID |
| `entityNo` | — | 业务编号字段 | 面向操作员的可读标识 |
| `traceId` | 强烈推荐 | workflow 创建时生成，贯穿全程 | Audit Center 用于关联同一工作流的所有事件 |
| `workflowType` | — | `AuditWorkflowTypes` 或 `AuditBusinessWorkflowTypes` 常量 | 按工作流查询/聚合的关键字段 |
| `triggerType` | — | `AuditTriggerType` 枚举 | 不传时由 service 自动推断 |
| `result` | — | `AuditResult` 枚举 | 默认 `SUCCESS` |

**actor（仅 `recordByActor()` 需要）**：

| 字段 | 说明 |
|---|---|
| `actorType` | `'ADMIN' \| 'CUSTOMER' \| 'SYSTEM'` |
| `actorId` | 操作人 userId |
| `actorNo` | 操作人的业务编号（可选） |
| `actorRole` | 操作人当前角色 code（可选） |

### 3.4 幂等性机制

`AuditLogsService` 通过 `idempotencyKey` 防止重复写入。调用方未显式传入时，service 自动生成：

```
idempotencyKey = sha256(action + '|' + entityType + '|' + (entityId ?? '') + '|' + (requestId ?? 'NO_REQUEST_ID') + '|' + triggerType)
```

注意：`module` 字段已从幂等键公式中移除（2026-04-29）。

---

## Section 4: Action 命名规范

### 4.1 通用 action（`AuditActions`）

用于大多数业务模块的标准操作事件。命名规则：**`ENTITY_VERB`** 或 **`ENTITY_FROM_TO`**。

```typescript
// 正确示例
'APPROVAL_APPROVED'          // 实体_动词
'CHANGE_TICKET_CREATED'      // 实体_动词
'WITHDRAW_CREATED_TO_PAYOUT_PENDING'  // 实体_状态转换
```

### 4.2 治理 workflow action（`AuditGovernanceActions`）

治理 workflow（C1-D2）使用嵌套命名空间，C5 例外。

**C1-C4、D1、D2（dotted.lowercase 格式）**：
```typescript
AuditGovernanceActions.ADMIN_INVITE.INITIATED
// → 'governance.admin_invite.initiated'

AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_GRANTED
// → 'governance.admin_role_binding.approval_granted'
```

**C5 AUDIT_EVIDENCE_EXPORT（短 UPPERCASE，无前缀）**：
```typescript
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.EXPORT_REQUESTED     // 'EXPORT_REQUESTED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_GRANTED     // 'APPROVAL_GRANTED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_DECLINED    // 'APPROVAL_DECLINED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_CANCELLED   // 'APPROVAL_CANCELLED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.GENERATION_COMPLETED // 'GENERATION_COMPLETED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.GENERATION_FAILED    // 'GENERATION_FAILED'
AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.PACKAGE_DOWNLOADED   // 'PACKAGE_DOWNLOADED'
```

> **设计意图**：`workflowType = AUDIT_EVIDENCE_EXPORT` 已提供 workflow 上下文，action 无需重复前缀。短 UPPERCASE 简洁可读，适合这类操作密集的 workflow。

---

## Section 5: Wave 1 审计事件字典

### 5.1 治理审批（`GOVERNANCE_APPROVALS`）

实体类型：`AuditEntityTypes.APPROVAL_CASE`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `APPROVAL_SUBMITTED` | `'APPROVAL_SUBMITTED'` | 审批单进入 PENDING | `recordByActor` |
| `APPROVAL_APPROVED` | `'APPROVAL_APPROVED'` | checker 批准 | `recordByActor` |
| `APPROVAL_REJECTED` | `'APPROVAL_REJECTED'` | checker 拒绝 | `recordByActor` |
| `APPROVAL_CANCELLED` | `'APPROVAL_CANCELLED'` | 取消 | `recordByActor` |
| `APPROVAL_EXPIRED` | `'APPROVAL_EXPIRED'` | 超时 | `recordSystem` |
| `APPROVAL_EXECUTED` | `'APPROVAL_EXECUTED'` | 执行成功 | `recordSystem` |
| `APPROVAL_EXECUTION_FAILED` | `'APPROVAL_EXECUTION_FAILED'` | 执行失败 | `recordSystem` |

> ⚠️ 以上事件仅由通用 `ApprovalsService` 写入。对于使用 Plan B 独占模式的 workflow（如 AUDIT_EVIDENCE_EXPORT），`ApprovalsService` 不写这些事件，改由专属 service 写对应的 workflow 语义事件。

### 5.2 变更工单（`GOVERNANCE_CHANGE_TICKETS`）

实体类型：`AuditEntityTypes.CHANGE_TICKET`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `CHANGE_TICKET_CREATED` | `'CHANGE_TICKET_CREATED'` | 工单创建成功 | `recordByActor` |
| `CHANGE_TICKET_SUBMITTED` | `'CHANGE_TICKET_SUBMITTED'` | 工单提交审批 | `recordByActor` |
| `CHANGE_TICKET_APPROVED` | `'CHANGE_TICKET_APPROVED'` | 审批通过，工单变 READY | `recordSystem` |
| `CHANGE_TICKET_REJECTED` | `'CHANGE_TICKET_REJECTED'` | 审批拒绝/超时/取消 | `recordSystem` |
| `CHANGE_TICKET_CONSUMED` | `'CHANGE_TICKET_CONSUMED'` | 工单执行成功 | `recordSystem` |
| `CHANGE_TICKET_DEPLOY_FAILED` | `'CHANGE_TICKET_DEPLOY_FAILED'` | 工单执行失败 | `recordSystem` |

### 5.3 删除申请（`GOVERNANCE_DELETE_REQUESTS`）

实体类型：`AuditEntityTypes.DELETE_REQUEST`

| action 常量 | 字符串值 | 触发时机 | 调用方式 |
|---|---|---|---|
| `DELETE_REQUEST_CREATED` | `'DELETE_REQUEST_CREATED'` | 删除申请创建 | `recordByActor` |
| `DELETE_REQUEST_SUBMITTED` | `'DELETE_REQUEST_SUBMITTED'` | 提交审批 | `recordByActor` |
| `DELETE_REQUEST_APPROVED` | `'DELETE_REQUEST_APPROVED'` | 审批通过 | `recordSystem` |
| `DELETE_REQUEST_REJECTED` | `'DELETE_REQUEST_REJECTED'` | 审批拒绝/超时/取消 | `recordSystem` |
| `DELETE_REQUEST_CANCELLED` | `'DELETE_REQUEST_CANCELLED'` | 申请人主动取消 | `recordByActor` |
| `DELETE_REQUEST_CONSUMED` | `'DELETE_REQUEST_CONSUMED'` | 执行成功，目标软删除完成 | `recordSystem` |
| `DELETE_REQUEST_EXECUTION_FAILED` | `'DELETE_REQUEST_EXECUTION_FAILED'` | 执行失败 | `recordSystem` |

### 5.4 C5 — 审计证据导出（`AUDIT_EVIDENCE_EXPORT`）

实体类型：`AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE`
workflowType：`AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT`
triggerType：`AuditTriggerType.EVIDENCE_EXPORT`
**写入归属**：全部由 `AuditEvidenceExportApprovalService` 独占写入（Plan B 模式）

| action 值（来自 `AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT`） | 触发时机 | 调用方 |
|---|---|---|
| `EXPORT_REQUESTED` | Maker 提交导出申请，`AuditEvidencePackage` 创建 | `createExportRequest()` |
| `APPROVAL_GRANTED` | Checker（MLRO）审批通过 | `handleApprovedApproval()` 事件监听 |
| `APPROVAL_DECLINED` | Checker 审批拒绝 | `handleRejectedApproval()` 事件监听 |
| `APPROVAL_CANCELLED` | Maker 或 SUPER_ADMIN 取消申请 | `handleCancelledApproval()` 事件监听 |
| `GENERATION_COMPLETED` | 证据包文件生成成功，状态变 READY | `handleApprovedApproval()` 异步执行后 |
| `GENERATION_FAILED` | 证据包文件生成失败，状态变 FAILED | `handleApprovedApproval()` 异常捕获 |
| `PACKAGE_DOWNLOADED` | Operator 下载证据包 | `downloadEvidencePackage()` |

**多步审批场景说明**：

`AUDIT_EVIDENCE_EXPORT_APPROVAL` 配置 `checkerRoles = ['MLRO']`，系统为**单步审批**，不创建多条 `approval_steps`。

**subjectNos 构成**：

每条 C5 审计事件的 `subjectNos` 包含两条记录：
1. `APPROVAL_CASE`：关联审批单（subjectRole=RELATED）
2. `AUDIT_EVIDENCE_PACKAGE`：本次导出包（subjectRole=RELATED）

### 5.5 多步审批场景的审计事件

当审批单包含多个步骤（如 `ONBOARDING_FINAL_APPROVAL` 的 MLRO→SMO 双签），**每个步骤的审批决策独立生成一条审计事件**，通过 `metadata.stepNo` 和 `metadata.checkerRole` 区分：

```
多步审批审计序列示例（RISK_RATING_HIGH_APPROVAL）：

1. APPROVAL_SUBMITTED              — case 进入 PENDING
2. APPROVAL_APPROVED               — Step 1: metadata { stepNo: 1, checkerRole: 'MLRO' }
3. APPROVAL_APPROVED               — Step 2: metadata { stepNo: 2, checkerRole: 'SMO' }
4. APPROVAL_EXECUTED               — 执行成功
```

---

## Section 6: Future Wave 接入规范

### 6.1 通用模式接入步骤

1. **在 `AuditEntityTypes` 中注册新实体类型常量**（`audit-actions.constant.ts`）
2. **在 `AuditActions` 或 `AuditGovernanceActions` 中注册 action 常量**（命名必须 `UPPER_SNAKE_CASE`）
3. **选择调用方式**：`recordByActor()` 或 `recordSystem()`，根据触发来源选择
4. **填写 `workflowType`**，Audit Center 依赖此字段按工作流聚合事件
5. **填写 `traceId`**，贯穿整个工作流实例

代码模板（通用模式）：

```typescript
await this.auditLogsService.recordByActor(
  {
    action: AuditActions.MY_ENTITY_CREATED,          // 必填，来自常量
    entityType: AuditEntityTypes.MY_ENTITY,          // 必填，来自常量
    entityId: entity.id,                             // 可选
    entityNo: entity.entityNo,                       // 可选
    workflowType: AuditWorkflowTypes.MY_WORKFLOW,    // 推荐
    traceId: entity.traceId,                         // 推荐
    subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'MY_ENTITY', subjectNo: entity.entityNo }],
  },
  actor,
);
```

### 6.2 Plan B（Workflow 独占）模式接入步骤

1. 创建专属 service（`xxx-approval.service.ts`），注入 `AuditLogsService`（DI，禁止 `new`）
2. 在专属 service 中定义 workflow 的全部 action 常量（嵌套在 `AuditGovernanceActions` 下）
3. 在 `ApprovalsService.hasDedicatedAuditService()` 中注册 workflowType
4. 在专属 service 中通过 `@OnEvent()` 监听 `ApprovalEvents.APPROVED / REJECTED / CANCELLED / EXPIRED` 写入对应审计事件
5. **验证**：触发完整流程后，`audit_log_events` 中不存在重复条目

### 6.3 严禁事项（DO NOT）

1. **不得直接写 `audit_log_events` 表**
2. **不得在同一事件路径上重复调用**（Plan B 已通过 guard 防止，通用模式需自行保证）
3. **不得硬编码 action 字符串**——必须使用常量文件中定义的值
4. **不得传入 `module` 字段**——该字段已删除，传入会导致 TS 编译错误
5. **不得跨 workflow 借用 action 常量**——每个 workflow 应有自己的 action 集合

### 6.4 测试要求

- 每个 action 路径须有单元测试，断言 `auditLogsService.recordByActor` 或 `recordSystem` 以正确参数被调用（使用 `jest.spyOn`）
- Plan B 模式须额外验证：`ApprovalsService` 的通用 audit 调用在对应 workflowType 下**不被触发**
- 幂等性场景（同一请求重复到达）在集成测试中覆盖

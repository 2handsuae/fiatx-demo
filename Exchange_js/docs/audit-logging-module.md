# 统一审核日志模块设计（v1）

## 文档导航
- 产品文档：[audit-logging-product-doc.md](./audit-logging-product-doc.md)
- 技术文档：[audit-logging-technical-doc.md](./audit-logging-technical-doc.md)
- 审计约束：[audit-logging-constraints.md](./constraints/audit-logging-constraints.md)

> 以下保留 v1 快速概览，作为历史上下文。

## 1. Trigger 类型

当前模块采用以下 `triggerType`：

- `STATE_TRANSITION`：状态机迁移（如提现审批、清算完成）
- `DATA_CREATE`：关键实体创建
- `DATA_UPDATE`：关键字段更新
- `DATA_DELETE`：关键数据删除
- `PERMISSION_CHANGE`：权限、角色、访问策略变更
- `AUTH_EVENT`：登录、登出、鉴权失败等事件
- `CONFIG_CHANGE`：配置基线变更
- `MANUAL_OVERRIDE`：人工强制干预
- `SYSTEM_EVENT`：系统任务、批处理、补偿动作
- `EVIDENCE_EXPORT`：证据包导出动作（导出行为本身也审计）

## 2. 表结构

### `audit_log_events`

统一审计事件表，关键字段：

- 识别字段：`id`、`auditNo`
- 事件字段：`triggerType`、`action`、`module`、`entityType`
- 业务关联：`entityId`、`entityNo`、`entityOwnerType`、`entityOwnerId`
- 变更对比：`statusFrom`、`statusTo`、`beforeData`、`afterData`
- 操作者：`actorType`、`actorId`、`actorRole`
- 请求上下文：`requestId`、`sourceIp`、`sourcePlatform`
- 结果与说明：`result`、`reason`、`metadata`
- 治理字段：`idempotencyKey`、`payloadDigest`、`maskVersion`、`retainedUntil`、`archivedAt`
- 时间：`occurredAt`、`createdAt`、`updatedAt`

索引覆盖：时间、触发类型、模块、实体、操作者、结果。

### `audit_evidence_packages`

证据包导出留痕表，关键字段：

- `packageNo`：证据包编号
- `exportedByType`、`exportedById`、`exportedByRole`：导出人
- `approvalCaseId`：关联审批单（敏感导出需审批）
- `filterSnapshot`：导出筛选条件快照
- `itemCount`：包含审计记录数量
- `digest`：证据包摘要（SHA-256）
- `manifest`：导出清单（JSON）

## 3. 查询接口

- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`
- `GET /admin/audit-logs/evidence-packages`
- `GET /admin/audit-logs/evidence-packages/:id`
- `GET /admin/audit-logs/evidence-packages/:id/download`

支持过滤：

- 分页：`skip`、`take`
- 业务过滤：`triggerType`、`module`、`entityType`、`entityId`、`actorId`、`result`
- 工作流过滤：`traceId`、`workflowType`、`workflowNo`
- 时间窗口：`startAt`、`endAt`
- 关键字：`keyword`

## 4. 导出证据包

接口：`POST /admin/audit-logs/export/evidence-package`

V1 当前只支持 `SELECTION` 模式，即从 `Audit Log` 页面勾选若干事件后发起导出。

核心流程：

1. `Audit Log` 页面按勾选事件创建 evidence export request。
2. 系统同步创建 `approval_case`，动作类型固定为 `SENSITIVE_EXPORT_APPROVAL`。
3. 审批通过前，`audit_evidence_packages.status = PENDING_APPROVAL`，不可下载。
4. 审批通过后，系统按稳定顺序组装 `manifest/records/snapshots` 并计算最终 `digest`。
5. 落库最终包体到 `audit_evidence_packages.packageBody`，状态推进为 `READY`。
6. 同时写入一条 `EVIDENCE_EXPORT` 审计事件，形成导出闭环留痕。

## 5. 管理接口（写入）

- `POST /admin/audit-logs`：管理员手工补录/追记关键事件。

后续建议：业务模块关键路径统一调用 `AuditLogsService.recordByActor()`，逐步替换散落的各业务审计表写入逻辑，最终汇聚到统一审计中心。

## 6. 当前管理入口

- 一级菜单：`Audit Center`
1. `Audit Log`
2. `Evidence Export`
- 一级菜单：`Governance Center`
1. `Approvals`
2. `Change Tickets`
3. `Delete Requests`
4. `SLA Timers`
- `Audit Log` 列表页仅保留列表、筛选、勾选导出能力。
- `Audit Log Detail`：`/dashboard/audit/audit-logs/:id`
- `Evidence Export` 列表页仅保留列表、分页、刷新、下载入口，不再内嵌 detail 模块；未审批/未就绪记录不可下载。
- `Evidence Export Detail`：`/dashboard/audit/evidence-exports/:id`
- `Evidence Export Detail` 仅基于 `audit_evidence_packages` 单条记录字段做语义归类展示，并保留 `manifest/packageBody` JSON。
- `Approvals`：`/dashboard/governance/approvals`
- `Approval Detail`：`/dashboard/governance/approvals/:id`
- `Change Tickets`：`/dashboard/governance/change-tickets`
- `Change Ticket Create`：`/dashboard/governance/change-tickets/create`
- `Change Ticket Detail`：`/dashboard/governance/change-tickets/:id`
- `Delete Requests`：`/dashboard/governance/delete-requests`
- `Delete Request Create`：`/dashboard/governance/delete-requests/create`
- `Delete Request Detail`：`/dashboard/governance/delete-requests/:id`
- `SLA Timers`：`/dashboard/governance/sla-timers`
- `SLA Timer Detail`：`/dashboard/governance/sla-timers/:id`
- 兼容路由 `/dashboard/compliance/audit-logs` 仍保留跳转，但菜单中不再展示入口。

## 6.1 Governance WF-06（Change Ticket + Release Gate）

当前第二阶段已接入 `WF-06` 最小闭环：

1. 创建 `Change Ticket`
2. 提交并自动创建/提交 `CHANGE_TICKET_APPROVAL`
3. 审批通过后进入 `READY_FOR_DEPLOY`
4. 执行 `Release Gate Check`
5. 标记 `DEPLOYED / DEPLOY_FAILED`
6. 关闭工单

该流程产出的审计事件统一具备：
- `workflowType=CHANGE_TICKET`
- `workflowNo=ticketNo`
- `traceId`
- `subjectNos` 至少包含 `ticketNo`

## 6.2 Governance WF-04（SLA Timer Engine）

当前第四阶段已接入两类 Governance SLA：

1. `APPROVAL_TIMEOUT`
2. `CHANGE_POST_APPROVAL_FOLLOWUP`

实现约束：
- 编号采用 `timerNo`
- 状态机固定为 `ACTIVE -> CLOSED / EXPIRED`
- `APPROVAL_TIMEOUT` 只读，不允许人工 close
- `CHANGE_POST_APPROVAL_FOLLOWUP` 允许在详情页手工 close
- 审计事件统一具备 `timerNo + workflowNo + subjectNo + traceId`

## 7. 运维脚本

- 历史回填（预览）：`npm run audit:backfill:dry`
- 历史回填（执行）：`npm run audit:backfill:apply`
- 保留期扫描（预览）：`npm run audit:retention:dry`
- 保留期归档标记（执行）：`npm run audit:retention:apply`

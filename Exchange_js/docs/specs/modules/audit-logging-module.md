# 统一审核日志模块设计（v1）

## 文档导航
- 产品文档：[audit-logging-product-doc.md](./audit-logging-product-doc.md)
- 技术文档：[audit-logging-technical-doc.md](./audit-logging-technical-doc.md)
- 审计约束：[audit-logging-constraints.md](../../constraints/audit-logging-constraints.md)

> 以下保留 v1 快速概览，作为当前 source-of-truth 的模块说明。

## 1. 模块 Contract

统一审计日志采用三层语义：
- typed core：`audit_log_events` 上的稳定事件事实字段
- `subjectNos[]`：面向运营的 multi-anchor lookup layer
- context JSON：`metadata`、`beforeData`、`afterData` 这类可脱敏上下文

这三层必须分开理解：
- typed core 负责“发生了什么”
- `subjectNos[]` 负责“用哪些 No 定位它”
- context JSON 负责“补充上下文”，不能替代核心字段

## 2. Trigger 与 Action 规范

当前模块采用以下 `triggerType`，顺序固定：
- `EVIDENCE_EXPORT`
- `STATE_TRANSITION`
- `MANUAL_OVERRIDE`
- `AUTH_EVENT`
- `PERMISSION_CHANGE`
- `CONFIG_CHANGE`
- `DATA_CREATE`
- `DATA_UPDATE`
- `DATA_DELETE`
- `SYSTEM_EVENT`

命名规则：
- `action` 必须使用 `UPPER_SNAKE_CASE`
- 状态迁移动作必须遵循 `<ENTITY>_<FROM_STATUS>_TO_<TO_STATUS>`，除非已明确列入 allowlist
- `MANUAL_*` 只表示人工操作
- `SYSTEM_*` 只表示系统任务或编排动作

## 3. 数据模型

### `audit_log_events`
这是统一审计的 typed core 表，不是 payload dump 容器。

核心字段：
- 识别字段：`id`、`auditNo`
- 事件事实：`triggerType`、`action`、`module`、`entityType`
- 业务关联：`entityId`、`entityNo`、`entityOwnerType`、`entityOwnerId`、`entityOwnerNo`
- 流程关联：`traceId`、`workflowType`、`workflowId`、`workflowNo`
- 操作者：`actorType`、`actorId`、`actorNo`、`actorRole`
- 结果与说明：`result`、`reason`
- 上下文 JSON：`requestId`、`sourceIp`、`sourcePlatform`、`metadata`、`beforeData`、`afterData`
- 治理字段：`idempotencyKey`、`payloadDigest`、`maskVersion`、`retainedUntil`
- 时间：`occurredAt`、`createdAt`、`updatedAt`

### `audit_log_subject_nos`
这是 operator-facing multi-anchor lookup layer，不是主事实表。

字段：
- `eventId`
- `subjectRole`
- `subjectType`
- `subjectId`
- `subjectNo`
- `occurredAt`
- `createdAt`

### `audit_evidence_packages`
这是受治理的导出对象，不是某个业务域的交易快照容器。

字段：
- `packageNo`
- `approvalCaseId`
- `exportedByType`
- `exportedById`
- `exportedByRole`
- `status`
- `exportMode`
- `fileName`
- `filterSnapshot`
- `selectedEventIdsSnapshot`
- `itemCount`
- `digest`
- `manifest`
- `packageBody`
- `createdAt`
- `updatedAt`

## 4. 查询边界

查询必须保持两条独立语义：
- `subjectNo` 精确检索：用于 operator-facing 的 No-first 查找
- `traceId + workflowType/workflowNo` 检索：用于 workflow 维度的链路定位

两条语义不能混成一个查询概念，也不能用其中一条替代另一条。

## 5. 写入与导出

统一写入主路径：
- `AuditLogsService.recordByActor()`
- `AuditLogsService.recordSystem()`

写入链路必须包含：
- 输入校验
- 脱敏
- 幂等键
- `subjectNos[]` 构建
- `payloadDigest`
- `retainedUntil`
- 写入 `audit_log_events`
- 写入 `audit_log_subject_nos`

导出链路必须保持：
- 先创建受审批治理的 export request
- 再由批准结果触发最终 artifact 生成
- 最终输出单个 JSON 包，包含 `manifest + records + digest`
- 导出事件自身再写一条 `EVIDENCE_EXPORT`

## 6. 当前入口

- 一级菜单：`Audit Center`
1. `Audit Log`
2. `Evidence Export`
- 一级菜单：`Control Gates Center`
1. `Approvals`
2. `Change Tickets`
3. `Delete Requests`
4. `SLA Timers`

## 7. 运行与验证

- 查询优先使用 No-first 入口，不要让关键词搜索盖过 exact No lookup。
- 导出只接受已选事件和审批通过后的治理路径，不接受直接生成包体的旁路。
- 证据包保持中性结构，任何域特定 snapshot 组装都必须放在 workflow 或 serializer 层，而不是模块定义本身。

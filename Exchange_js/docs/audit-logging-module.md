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
- `filterSnapshot`：导出筛选条件快照
- `itemCount`：包含审计记录数量
- `digest`：证据包摘要（SHA-256）
- `manifest`：导出清单（JSON）

## 3. 查询接口

- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`

支持过滤：

- 分页：`skip`、`take`
- 业务过滤：`triggerType`、`module`、`entityType`、`entityId`、`actorId`、`result`
- 时间窗口：`startAt`、`endAt`
- 关键字：`keyword`

## 4. 导出证据包

接口：`POST /admin/audit-logs/export/evidence-package`

核心流程：

1. 按筛选条件稳定拉取审计记录（按 `occurredAt ASC`）。
2. 对每条记录生成 SHA-256 摘要，形成 `recordDigests`。
3. 组装 `manifest`（版本、导出人、筛选条件、数量、摘要算法）。
4. 计算证据包总摘要 `digest = sha256(manifest + records)`。
5. 落库 `audit_evidence_packages`，保证导出行为可追溯。
6. 同时写入一条 `EVIDENCE_EXPORT` 审计事件，形成审计闭环。

## 5. 管理接口（写入）

- `POST /admin/audit-logs`：管理员手工补录/追记关键事件。

后续建议：业务模块关键路径统一调用 `AuditLogsService.recordByActor()`，逐步替换散落的各业务审计表写入逻辑，最终汇聚到统一审计中心。

## 6. 运维脚本

- 历史回填（预览）：`npm run audit:backfill:dry`
- 历史回填（执行）：`npm run audit:backfill:apply`
- 保留期扫描（预览）：`npm run audit:retention:dry`
- 保留期归档标记（执行）：`npm run audit:retention:apply`

> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. See current audit contract.
>
> Replacement: `docs/constraints/audit-trace-context-constraints.md`

# 统一审计日志技术文档（Audit Logging）

## 架构总览与模块边界
统一审计采用“中心写入 + 业务接入”的结构：
- 审计中心模块：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs`
- 审批治理模块：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/governance/approvals`
- 更改单治理模块：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/governance/change-tickets`
- 后端入口控制器：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.controller.ts`
- 核心写入服务：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- 常量与规范：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
- 工具：
1. 脱敏：`.../utils/audit-mask.util.ts`
2. 摘要：`.../utils/audit-digest.util.ts`
3. Subject No 归一：`.../utils/audit-subject-no.util.ts`

边界要求：
- 业务模块不直接写 `audit_log_events`，统一经 `AuditLogsService.recordByActor()` / `recordSystem()`。
- 旧审计表仅保留历史读取，不再承接新写入。
- `audit_log_events` 只承载 typed core + context JSON，`audit_log_subject_nos` 承载 operator-facing multi-anchor lookup layer。
- `subjectNo` exact lookup 与 `traceId + workflowType/workflowNo` lookup 必须分开实现，不能用同一语义覆盖。
- 每个新功能、每条新业务流程、每个关键状态迁移、每个自动阻断动作都 MUST 接入这条 canonical write path。
- 没有接入 canonical audit logging 的功能不得视为完成态。

## Business Workflow / Trace Canonical Rules
统一审计的第一层语义以 business workflow 为准，规则固定如下：
- 一个 business workflow 实例 MUST 对应一条 `traceId`。
- `workflowType/workflowId/workflowNo` 是 raw container tuple，用于技术定位与派生显示，不直接等同于页面第一层文案。
- read model 需要从 raw tuple、`action`、`subjectNos[]` 派生 `businessWorkflow`、`userAction`、`primaryRefNo`。
- `approval` MUST 视为嵌入式治理节点；若 approval 服务于父业务流程，则其审计事件 MUST 继承父 workflow 上下文与 trace。
- delete workflow MUST 使用自己的 workflow trace，MUST NOT 继承 target 对象原 trace。
- 页面第一层隐藏 container 名称；raw tuple 与 raw action 保留在 technical context 中。

Wave 1 operator-facing business workflows 固定为：
- `ADMIN_MEMBER_PROVISIONING`
- `ADMIN_LOGIN_ACCESS`
- `ADMIN_ROLE_BINDING_CHANGE`
- `CHANGE_TICKET_DELETION`
- `ADMIN_USER_DELETION`
- `AUDIT_EVIDENCE_PACKAGE_DELETION`
- `AUDIT_EVIDENCE_EXPORT`

Wave 1 第一层 user action vocabulary 固定为：
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `REJECTED`
- `CANCELLED`
- `EXECUTED`
- `EXECUTION_FAILED`
- `RESENT`
- `ACCEPTED`
- `ACCEPT_FAILED`
- `LOGIN_SUCCEEDED`
- `LOGIN_FAILED`
- `EXPORTED`
- `EXPORT_FAILED`

## 数据模型（`audit_log_events`、`audit_log_subject_nos`、`audit_evidence_packages`）
Prisma 定义位于：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/prisma/schema.prisma`

### 1) `audit_log_events`
核心字段分层如下：
- Typed core：`id`、`auditNo`、`triggerType`、`action`、`module`、`entityType`、`actorType`、`actorId`、`actorNo`、`actorRole`、`result`、`reason`
- Lookup anchors：`entityId`、`entityNo`、`entityOwnerType`、`entityOwnerId`、`entityOwnerNo`、`traceId`、`workflowType`、`workflowId`、`workflowNo`
- Context JSON：`requestId`、`sourceIp`、`sourcePlatform`、`metadata`、`beforeData`、`afterData`
- Governance：`idempotencyKey`（unique nullable）、`payloadDigest`、`maskVersion`、`retainedUntil`
- Time：`occurredAt`、`createdAt`、`updatedAt`

关键索引：
- `(module, entityType, entityId, occurredAt)`
- `(actorType, actorId, occurredAt)`
- `(actorNo, occurredAt)`
- `(entityOwnerNo, occurredAt)`
- `(traceId, occurredAt)`
- `(workflowType, workflowNo, occurredAt)`
- `(retainedUntil)`

### 2) `audit_log_subject_nos`
用于一条事件挂多个 No，支持 operator-facing multi-anchor lookup：
- `eventId`
- `subjectRole`（ACTOR/OWNER/ENTITY/RELATED/SOURCE）
- `subjectType`
- `subjectId`
- `subjectNo`
- `occurredAt`
- `createdAt`

关键索引：
- `(subjectNo, occurredAt)`
- `(subjectType, subjectNo, occurredAt)`
- `(eventId)`

### 3) `audit_evidence_packages`
用于导出留痕的受治理对象：
- `packageNo`
- `approvalCaseId`
- `exportedByType/exportedById/exportedByRole`
- `status`
- `exportMode`
- `fileName`
- `filterSnapshot`
- `selectedEventIdsSnapshot`
- `itemCount`
- `digest`
- `manifest`
- `packageBody`
- `createdAt/updatedAt`

## Trigger 判定与 Action 命名规则
触发类型判定在 `AuditLogsService.inferTriggerType()`，顺序固定：
1. `EVIDENCE_EXPORT`
2. `STATE_TRANSITION`
3. `MANUAL_OVERRIDE`
4. `AUTH_EVENT`
5. `PERMISSION_CHANGE`
6. `CONFIG_CHANGE`
7. `DATA_CREATE`
8. `DATA_UPDATE`
9. `DATA_DELETE`
10. `SYSTEM_EVENT`

命名规则：
- `action` 必须 `UPPER_SNAKE_CASE`
- 状态迁移动作：`<ENTITY>_<FROM_STATUS>_TO_<TO_STATUS>`（或 allowlist）
- 手工动作：`MANUAL_*`
- 系统动作：`SYSTEM_*`

动作字典定义位置：
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`

## `AuditLogsService` 写入链路（脱敏、摘要、幂等、No 归一、subjectNos 构建）
写入主链路在 `recordByActor()`：
1. 解析时间与 trigger：`toDate()` + `inferTriggerType()`
2. 参数校验：`validateInput()`（含状态迁移、manual/system 前缀、失败原因）
3. 脱敏：`maskAuditPayload()` + `maskIpAddress()`
4. 幂等键：`buildIdempotencyKey()`（请求未提供时自动生成）
5. No 归一：`resolveActorNo()`、`resolveEntityNo()`、`resolveEntityOwnerNo()`
6. 主体构建：`buildSubjectNos()` -> `audit_log_subject_nos`
7. 摘要：`sha256Hex()` 生成 `payloadDigest`
8. 保留期：`toRetainedUntil()`（+8 年）
9. 落库：`createEventWithUniqueNo()`（冲突重试 + 幂等复用）

`recordSystem()` 走同一 typed core / context JSON / subjectNos 构建规则，只是 actor 来源是系统或编排上下文。

证据包链路在 `AuditEvidenceExportApprovalService.createExportRequest()`：
- `POST /admin/audit-logs/export/evidence-package` 先创建 `audit_evidence_packages` 申请记录
- 同步创建 `approval_case`，动作类型固定为 `AUDIT_EVIDENCE_EXPORT_APPROVAL`
- 审批通过事件触发后，再调用 `AuditLogsService.buildEvidencePackageArtifacts()` 生成最终 `manifest/records/packageBody/digest`
- 成功后将 `audit_evidence_packages.status` 更新为 `READY`，失败则为 `FAILED`
- 追加一条 `EVIDENCE_EXPORT` 审计事件，并通过 `ApprovalsService.markExecutionResult()` 回写审批执行态

## API/DTO 契约（查询过滤、详情、导出）
控制器：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.controller.ts`
DTO：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`

### 已有接口
- `POST /admin/audit-logs`
- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`
- `POST /admin/audit-logs/export/evidence-package`
- `GET /admin/audit-logs/evidence-packages`
- `GET /admin/audit-logs/evidence-packages/:id`
- `GET /admin/audit-logs/evidence-packages/:id/download`
- `GET /admin/control-gates/approvals`
- `GET /admin/control-gates/approvals/:id`
- `POST /admin/control-gates/approvals/:id/approve`
- `POST /admin/control-gates/approvals/:id/reject`
- `POST /admin/control-gates/approvals/:id/cancel`
- `POST /admin/control-gates/change-tickets`
- `GET /admin/control-gates/change-tickets`
- `GET /admin/control-gates/change-tickets/:id`
- `POST /admin/control-gates/change-tickets/:id/submit`
- `POST /admin/control-gates/change-tickets/:id/consume`
- `POST /admin/control-gates/delete-requests`
- `GET /admin/control-gates/delete-requests`
- `GET /admin/control-gates/delete-requests/:id`
- `POST /admin/control-gates/delete-requests/:id/submit`
- `POST /admin/control-gates/delete-requests/:id/cancel`
- `POST /admin/control-gates/delete-requests/:id/consume`

### 查询过滤（`GET /admin/audit-logs`）
- 分页：`skip/take`
- 类型：`triggerType/result/module/entityType/entityId`
- No 过滤：`subjectNo/subjectType/actorNo/entityOwnerNo`
- 工作流过滤：`traceId/workflowType/workflowNo`
- 时间窗：`startAt/endAt`
- 关键字：`keyword`
- 归档开关：`includeArchived`

`subjectNo` 精确检索和 `traceId/workflowType/workflowNo` 检索必须保持独立语义，DTO 不应把它们合并成一个含混入口。

### 详情返回（`GET /admin/audit-logs/:id`）
- 返回事件基础字段 + `subjectNos[]`
- Admin 前端独立详情页：`/dashboard/audit/audit-logs/:id`
- 详情页按单条事件字段做语义分组展示，不做跨表聚合查询
- 第一层展示字段为 `businessWorkflow`、`userAction`、`primaryRefNo`
- 技术区保留 raw `action`、`traceId`、`workflowType/workflowId/workflowNo`、`entityType/entityNo`

### 导出（`POST /admin/audit-logs/export/evidence-package`）
- 当前模式：`SELECTION`
- 必填：`selectedEventIds[]`
- `maxItems`：默认 1000，最大 5000
- `includeRecords`：可选，false 时不在包体里包含 `records`

### 导出历史（`GET /admin/audit-logs/evidence-packages*`）
- 列表返回持久化导出记录摘要。
- Admin 前端列表页 `/dashboard/audit/evidence-exports` 不再内嵌 detail 模块。
- Admin 前端独立详情页：`/dashboard/audit/evidence-exports/:id`
- 详情页仅消费单条 `GET /admin/audit-logs/evidence-packages/:id`，按 `audit_evidence_packages` 字段语义分组展示。
- 下载接口先过审批 gate，只有 `approvalCase.status = APPROVED` 且包状态 `READY` 时才返回持久化 `packageBody`。

## Governance Approval V1（Evidence Export 首批接入）
- 新模块：
1. `ApprovalsService`
2. `ApprovalPolicyService`
3. `AuditEvidenceExportApprovalService`
- 新表：
1. `approval_cases`
2. `approval_steps`
3. `approval_action_policies`
4. `approval_sod_rules`
- 状态机：
1. `DRAFT -> PENDING -> APPROVED / REJECTED / EXPIRED / CANCELLED`
2. 执行态：`NOT_EXECUTED / EXECUTED / EXECUTION_FAILED`
- 默认策略：
1. `AUDIT_EVIDENCE_EXPORT_APPROVAL`：`DPO/MLRO`
2. SoD：maker/checker 不能同人
- 前端入口：
1. `/dashboard/control-gates/approvals`
2. `/dashboard/control-gates/approvals/:id`

approval 审计语义要求：
- `APPROVAL_*` 仍保留为 raw technical action。
- 若 approval 绑定到 `ChangeTicket`、`DeleteRequest`、`AUDIT_EVIDENCE_EXPORT` 等父流程，则 approval record 与 approval event MUST 继承父 business workflow 上下文。
- 审批页可继续展示 approval container；审计页第一层不得把 `APPROVAL` 作为 operator workflow。

## 历史兼容注记
- 旧版更改单发布能力仅作为治理域的历史上下文保留；本 audit module 文档不再把它写成当前实现主线。

## 关键接入矩阵（按模块列出接入点与 action）
### Deposit workflow（本轮重点验收）
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/asset-treasury/payins/payins.service.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/orchestrators/deposit-workflow.service.ts`
- 动作：
1. `PAYIN_CREATED`
2. `DEPOSIT_CREATED_FROM_PAYIN`
3. `PAYIN_*` 状态迁移（与 deposit 主链相关）
4. `DEPOSIT_*` 状态迁移
5. `DEPOSIT_COMPLIANCE_EVIDENCE_SYNCED`
6. `DEPOSIT_ACCOUNTING_POSTED`

### Governance Control Gate workflow（第二阶段）
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.ts`
- 动作：
1. `CHANGE_TICKET_CREATED`
2. `CHANGE_TICKET_SUBMITTED`
3. `CHANGE_TICKET_CONSUMED`
4. `DELETE_REQUEST_CREATED`
5. `DELETE_REQUEST_SUBMITTED`
6. `DELETE_REQUEST_CANCELLED`
7. `DELETE_REQUEST_CONSUMED`

这些 container action 在审计页中仅作为 raw technical action 保留；页面第一层 workflow 应派生为其对应业务语义，如 `ADMIN_MEMBER_PROVISIONING`、`ADMIN_ROLE_BINDING_CHANGE`、`*_DELETION`。

以下为当前关键接入点（P0 优先）：
- Auth
1. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/auth/auth.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/auth/customer-auth.service.ts`
3. 动作：`ADMIN_LOGIN_SUCCESS/FAILED`、`CUSTOMER_LOGIN_SUCCESS/FAILED`、`ACCOUNT_LOCKED/UNLOCKED`

- Compliance
1. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`
2. 动作：`KYT_CASE_CREATED`、`KYT_CASE_UPDATED`、`TRAVEL_RULE_UPDATED`、`SYSTEM_TX_COMPLIANCE_BACKFILL_EXECUTED`

- Config
1. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/asset-treasury/assets/assets.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/counterparty/liquidity-config/liquidity-config.service.ts`
3. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/accounting/acct-events/acct-events.service.ts`
4. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/clearing-settle/clearing/clearing-templates.service.ts`
5. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/accounting/journal-header-templates/journal-header-templates.service.ts`
6. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/accounting/journal-line-templates/journal-line-templates.service.ts`
7. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/customer-swap-rates/customer-swap-rates.service.ts`
8. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/accounting/coa/coa.service.ts`
9. 动作：`ASSET_CONFIG_UPDATED`、`LP_CONFIG_UPDATED`、`ACCT_EVENT_UPDATED`、`CLEARING_TEMPLATE_UPDATED`、`JOURNAL_TEMPLATE_UPDATED`、`COA_CONFIG_UPDATED`、`CUSTOMER_SWAP_RATE_UPDATED`

- 主数据与报价
1. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/asset-treasury/wallets/wallets.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/customers/customers.service.ts`
3. `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/trading/swap-transactions/swap-quotes.service.ts`
4. 动作：`WALLET_CREATED`、`WALLET_STATUS_UPDATED`、`CUSTOMER_CREATED/UPDATED/DELETED`、`SWAP_QUOTE_CREATED/CANCELLED/USED`

- 既有交易链（已统一）
1. Onboarding/Payin/Deposit/Swap/Withdraw/Payout/Internal Tx/Fund 等关键状态流。
2. 具体接入文件见各模块 service/orchestrator 中 `AuditLogsService` 调用点。

## 脚本与运维（`audit:backfill:*`、`audit:backfill:nos:*`、`audit:retention:*`）
脚本路径：
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/scripts/backfill-audit-log-events.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/scripts/backfill-audit-log-nos.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/scripts/audit-retention-job.ts`

命令示例（在 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js` 执行）：
```bash
npm run audit:backfill:dry
npm run audit:backfill:apply
npm run audit:backfill:nos:dry
npm run audit:backfill:nos:apply
npm run audit:retention:dry
npm run audit:retention:apply
```

常用本地启动命令：
```bash
npm run dev:start
npm run dev:stop
npm run dev:reset
```

## 故障排查（迁移缺列 `P2022`、`requestId` 类型归一问题）
### 1) 迁移缺列 `P2022`
现象：查询/写入报错，提示某列不存在（常见于 `actorNo/entityOwnerNo/retainedUntil/subjectNos` 相关）。

排查步骤：
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx prisma migrate status
npm run db:migrate:local
npx prisma generate
```

若为本地 SQLite，可快速确认表结构：
```bash
sqlite3 /tmp/exchange_js_main/dev.db ".schema audit_log_events"
sqlite3 /tmp/exchange_js_main/dev.db ".schema audit_log_subject_nos"
```

### 2) `requestId` 类型归一问题
现象：部分调用链传入 number/object 导致幂等键不稳定或查询对不上。

当前处理：
- 在 `audit-logs.service.ts` 中通过 `normalizeOptionalString()` 将 `requestId` 统一为字符串或 `null`。
- 接入侧应传递稳定字符串（建议来自 HTTP request id 或业务 trace id）。

建议校验：
- 检查 controller/service 是否把 `req.id` 透传为字符串。
- 对后台任务明确设置 `requestId` 或固定前缀。

## 回滚与发布检查清单
发布前检查：
- 数据库迁移已执行并成功（含 `audit_log_subject_nos` 与新增列）。
- `npm run test -- audit-logs.service.spec.ts` 至少通过核心审计服务单测。
- `GET /admin/audit-logs` 可按 `subjectNo/actorNo/entityOwnerNo` 命中数据。
- `GET /admin/audit-logs/:id` 返回 `subjectNos[]`，且 `traceId` 查询不会和 `subjectNo` 语义混用。
- 导出接口返回 `manifest/records/digest`，并产生 `EVIDENCE_EXPORT` 事件。
- Admin 菜单主入口：`/dashboard/audit/audit-logs`
- 兼容路由：`/dashboard/compliance/audit-logs`（跳转可保留，但菜单不展示）

回滚策略（仅文档建议，按环境审批执行）：
1. 若仅前端入口异常，可先回退 `admin-web` 路由与菜单改动。
2. 若后端审计接口异常，可临时限制导出入口，保留查询接口。
3. 若迁移不兼容，先恢复到上一个可用迁移版本并停止新写入（避免脏数据扩大），再做增量修复。

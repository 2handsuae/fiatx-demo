# 统一审计日志技术文档（Audit Logging）

## 架构总览与模块边界
统一审计采用“中心写入 + 业务接入”的结构：
- 审计中心模块：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs`
- 后端入口控制器：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.controller.ts`
- 核心写入服务：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- 常量与规范：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
- 工具：
1. 脱敏：`.../utils/audit-mask.util.ts`
2. 摘要：`.../utils/audit-digest.util.ts`
3. Subject No 归一：`.../utils/audit-subject-no.util.ts`

边界要求：
- 业务模块不直接写 `audit_log_events`，统一经 `AuditLogsService.recordByActor()` / `recordSystem()`。
- 旧审计表仅保留历史读取，不再承接新写入。

## 数据模型（`audit_log_events`、`audit_log_subject_nos`、`audit_evidence_packages`）
Prisma 定义位于：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/prisma/schema.prisma`

### 1) `audit_log_events`
核心字段：
- 标识：`id`、`auditNo`
- 事件：`triggerType`、`action`、`module`、`entityType`
- 关联：`entityId`、`entityNo`、`entityOwnerType`、`entityOwnerId`、`entityOwnerNo`
- 操作者：`actorType`、`actorId`、`actorNo`、`actorRole`
- 状态：`statusFrom`、`statusTo`、`result`、`reason`
- 上下文：`requestId`、`sourceIp`、`sourcePlatform`
- 变更体：`metadata`、`beforeData`、`afterData`
- 治理：`idempotencyKey`（unique nullable）、`payloadDigest`、`maskVersion`、`retainedUntil`、`archivedAt`
- 时间：`occurredAt`、`createdAt`、`updatedAt`

关键索引：
- `(module, entityType, entityId, occurredAt)`
- `(actorType, actorId, occurredAt)`
- `(actorNo, occurredAt)`
- `(entityOwnerNo, occurredAt)`
- `(retainedUntil)`

### 2) `audit_log_subject_nos`
用于一条事件挂多个 No，支持跨主体反查：
- `eventId`、`subjectRole`（ACTOR/OWNER/ENTITY/RELATED/SOURCE）
- `subjectType`、`subjectId`、`subjectNo`
- `occurredAt`、`createdAt`

关键索引：
- `(subjectNo, occurredAt)`
- `(subjectType, subjectNo, occurredAt)`
- `(eventId)`

### 3) `audit_evidence_packages`
用于导出留痕：
- `packageNo`
- `exportedByType/exportedById/exportedByRole`
- `filterSnapshot`
- `itemCount`
- `digest`
- `manifest`
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
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`

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

证据包链路在 `exportEvidencePackage()`：
- 按条件取数（`occurredAt ASC`）
- 生成 `recordDigests`
- 组装 `manifest`
- 计算包级 `digest`
- 落库 `audit_evidence_packages`
- 追加一条 `EVIDENCE_EXPORT` 审计事件

## API/DTO 契约（查询过滤、详情、导出）
控制器：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.controller.ts`
DTO：`/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`

### 已有接口
- `POST /admin/audit-logs`
- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`
- `POST /admin/audit-logs/export/evidence-package`

### 查询过滤（`GET /admin/audit-logs`）
- 分页：`skip/take`
- 类型：`triggerType/result/module/entityType/entityId`
- No 过滤：`subjectNo/subjectType/actorNo/entityOwnerNo`
- 时间窗：`startAt/endAt`
- 关键字：`keyword`
- 归档开关：`includeArchived`

### 详情返回（`GET /admin/audit-logs/:id`）
- 返回事件基础字段 + `subjectNos[]`

### 导出（`POST /admin/audit-logs/export/evidence-package`）
- `maxItems`：默认 1000，最大 5000
- `includeRecords`：可选，false 时仅清单

## 关键接入矩阵（按模块列出接入点与 action）
以下为当前关键接入点（P0 优先）：
- Auth
1. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/identity/auth/auth.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/identity/auth/customer-auth.service.ts`
3. 动作：`ADMIN_LOGIN_SUCCESS/FAILED`、`CUSTOMER_LOGIN_SUCCESS/FAILED`、`ACCOUNT_LOCKED/UNLOCKED`

- Compliance
1. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`
2. 动作：`KYT_CASE_CREATED`、`KYT_CASE_UPDATED`、`TRAVEL_RULE_UPDATED`、`SYSTEM_TX_COMPLIANCE_BACKFILL_EXECUTED`

- Config
1. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/asset-treasury/assets/assets.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/counterparty/liquidity-config/liquidity-config.service.ts`
3. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/accounting/acct-events/acct-events.service.ts`
4. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/clearing-settle/clearing/clearing-templates.service.ts`
5. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/accounting/journal-header-templates/journal-header-templates.service.ts`
6. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/accounting/journal-line-templates/journal-line-templates.service.ts`
7. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/identity/customer-swap-rates/customer-swap-rates.service.ts`
8. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/accounting/coa/coa.service.ts`
9. 动作：`ASSET_CONFIG_UPDATED`、`LP_CONFIG_UPDATED`、`ACCT_EVENT_UPDATED`、`CLEARING_TEMPLATE_UPDATED`、`JOURNAL_TEMPLATE_UPDATED`、`COA_CONFIG_UPDATED`、`CUSTOMER_SWAP_RATE_UPDATED`

- 主数据与报价
1. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/asset-treasury/wallets/wallets.service.ts`
2. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/identity/customers/customers.service.ts`
3. `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/src/modules/trading/swap-transactions/swap-quotes.service.ts`
4. 动作：`WALLET_CREATED`、`WALLET_STATUS_UPDATED`、`CUSTOMER_CREATED/UPDATED/DELETED`、`SWAP_QUOTE_CREATED/CANCELLED/USED`

- 既有交易链（已统一）
1. Onboarding/Payin/Deposit/Swap/Withdraw/Payout/Internal Tx/Fund 等关键状态流。
2. 具体接入文件见各模块 service/orchestrator 中 `AuditLogsService` 调用点。

## 脚本与运维（`audit:backfill:*`、`audit:backfill:nos:*`、`audit:retention:*`）
脚本路径：
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/scripts/backfill-audit-log-events.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/scripts/backfill-audit-log-nos.ts`
- `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js/scripts/audit-retention-job.ts`

命令示例（在 `/Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js` 执行）：
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
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-logging/Exchange_js
npx prisma migrate status
npx prisma migrate deploy
npx prisma generate
```

若为本地 SQLite，可快速确认表结构：
```bash
sqlite3 prisma/dev.db ".schema audit_log_events"
sqlite3 prisma/dev.db ".schema audit_log_subject_nos"
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
- 导出接口返回 `manifest/records/digest`，并产生 `EVIDENCE_EXPORT` 事件。
- Admin 菜单存在入口：`/dashboard/compliance/audit-logs`。

回滚策略（仅文档建议，按环境审批执行）：
1. 若仅前端入口异常，可先回退 `admin-web` 路由与菜单改动。
2. 若后端审计接口异常，可临时限制导出入口，保留查询接口。
3. 若迁移不兼容，先恢复到上一个可用迁移版本并停止新写入（避免脏数据扩大），再做增量修复。

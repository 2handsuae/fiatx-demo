# Approval Metadata Consolidation

Date: 2026-05-08 | Status: Draft | Scope: V1 approval_cases table + all 6 workflows

---

## Problem

`approval_cases` 有两个 JSON 列：`metadataJson` 和 `objectSnapshot`。两者内容高度重复——都是 write-once、display-only 的 JSON 包。metadata 没有任何业务消费者：workflow handler 不读它，审批引擎不用它做决策，前端只是原样展示。维护两个几乎相同的 JSON 增加了理解成本和维护成本。

## Decision

删除 `metadataJson` 列，`objectSnapshot` 成为 approval 上唯一的 JSON 载荷。各 workflow 的 `createAndSubmit` 调用停止传 `metadata`，将原 metadata 里独有的字段合并进 `objectSnapshot`。

**不做的事：**
- 不改 `objectSnapshot` 的字段名或语义——它仍然是"审批宾语的冻结快照"
- 不改 `recordAudit` 方法的 metadata 参数机制——该参数传的是运行时上下文（`timeoutAt`、`superAdminBypass`），与 `metadataJson` 列无关
- 不改 `ApprovalDecidedEvent` 的 metadata 字段——本来就没被填充
- 不做历史数据 backfill——旧 approval 的 objectSnapshot 为 null，`metadataJson` 内容随列删除永久丢失。可接受：旧记录的 audit log 条目仍保有完整业务上下文，且当前环境为开发期，无生产数据

## Design

### Data Layer

删除 `metadataJson` 列：

```sql
ALTER TABLE "approval_cases" DROP COLUMN "metadataJson";
```

Prisma schema 同步删除该字段。`objectSnapshot` 保持不变（nullable TEXT）。

### Backend — approvals.service.ts

**删除：**
- `serializeMetadata()` 辅助方法
- `parseMetadata()` 辅助方法
- `createDraftCase` 中的 `metadataJson` 写入行
- `mapApproval` 中的 `metadata` 输出行

**不变：**
- `recordAudit` 方法签名和逻辑——`...(metadata || {})` spread 的是调用方传入的运行时上下文参数，不是 DB 列
- `objectSnapshot` 的序列化/反序列化逻辑

### Backend — DTO

`CreateApprovalDto`：删除 `metadata` 字段及其装饰器（`@ApiPropertyOptional`、`@IsOptional`、`@IsObject`）。保留 `objectSnapshot` 字段。

### Backend — 6 个 Workflow 变更

每个 workflow 的 `createAndSubmit` 调用删除 `metadata` 对象。检查 metadata 独有字段是否需要合并进 objectSnapshot：

| Workflow | metadata 独有字段 | 处置 |
|---|---|---|
| Admin Invite | `userEmail`（objectSnapshot 用 `email`） | 无遗漏，删除 metadata |
| Role Binding Change | 无独有字段 | 删除 metadata |
| Admin Suspension | 无独有字段 | 删除 metadata |
| Admin Reactivation | 无独有字段 | 删除 metadata |
| Evidence Export | `workflowSummary` | 合并进 objectSnapshot |
| Policy Change | `currentStepsConfig`/`proposedStepsConfig`（对象形式，objectSnapshot 已有从 request 行解析的版本） | 无遗漏，删除 metadata |

唯一需要合并的是 Evidence Export 的 `workflowSummary`。

### Frontend — ApprovalDetailPage.tsx

- 删除 `ApprovalDetail` 接口中的 `metadata` 字段
- 删除 `hasMetadata` 判断逻辑
- 删除 Metadata 展示区块（`<Cap>Metadata</Cap>` + `<JsonBlock title="metadata">`）
- 保留 Object Snapshot 展示区块，不改动

### What Stays Unchanged

- `recordAudit` 的 metadata 参数机制（传运行时上下文，与 DB 列无关）
- `ApprovalDecidedEvent` 的 metadata 字段（本来没被填充，不影响）
- objectSnapshot 的写入时机（createAndSubmit 时一次性冻结）
- objectSnapshot 的 nullable 语义（历史 approval 为 null 时不展示）
- Audit log 条目——各 workflow 自己的 audit 写入不受影响，approval 层的 `recordAudit` 只用运行时参数

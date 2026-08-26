# Approval Object Snapshot

Date: 2026-05-07 | Status: Draft | Scope: V1 all approval-backed workflows

---

## Problem

V1 有 6 个审批制 workflow，每个都有独立的 request 实体和页面。Operator 需要在多个 request 页面之间跳转才能了解待处理事项。领导希望减少 request 的前端暴露，让 operator 围绕 approval 页面完成工作。

## Decision

在 `approval_cases` 表增加 `objectSnapshot` JSON 列，创建 approval case 时将对应 request 的完整记录快照写入。前端隐藏 request 页面导航入口，operator 在 approval detail 页查看审批宾语。

**不做的事：**
- 不消灭 request 表或 domain service
- 不改审批引擎核心逻辑
- 不改 audit log 的 entityType / entityId
- 不改 3-Layer 架构
- 不做历史数据 backfill

## Design

### Data Layer

`approval_cases` 新增列：

```sql
ALTER TABLE approval_cases ADD COLUMN objectSnapshot JSON;
```

- Nullable — 历史 approval case 该字段为 null
- 内容 = request 表完整记录的 JSON 序列化（所有字段原样复制）
- 写入时机：`approvalsService.createCase()` 调用时一次性写入
- 写入后不同步 — 冻结快照，不是活引用

### Backend

**approvalsService 变更：**

`createCase()` 方法签名扩展，增加可选参数：

```typescript
async createCase(
  ...existingParams,
  objectSnapshot?: Record<string, any>,
): Promise<ApprovalCase>
```

创建 approval case 时将 `objectSnapshot` 持久化到新列。

**各 workflow 调用点变更：**

每个 workflow 的 `createCase` 调用点传入 request 完整记录。示例（Role Binding Change）：

```typescript
// workflow 创建 approval case 时
const request = await this.roleChangeRequestService.create(dto, tx);
const approvalCase = await this.approvalsService.createCase(
  ...existingArgs,
  request,  // objectSnapshot
);
```

**Response DTO 变更：**

`GET /admin/approvals/:id` 的 response DTO 扩展，包含 `objectSnapshot` 字段。

**不变：**
- Request 表结构
- Request domain service
- Request 相关 endpoint（保留，不删除）
- Audit log 写入逻辑

### Frontend

**Approval detail 页：**
- 新增通用 JSON / key-value 展示区块，渲染 `objectSnapshot`
- 所有 actionType 统一使用同一个渲染组件，不做类型特化
- `objectSnapshot` 为 null 时（历史数据）不展示该区块

**Request 页面处理：**
- 6 个 request 相关页面（列表 + 详情）：保留页面文件和路由注册
- 隐藏侧边栏导航入口（不再引导 operator 进入这些页面）

### Affected Workflows

| Workflow | Request Entity | actionType |
|---|---|---|
| Admin Invite | invite record | ADMIN_INVITE |
| Admin Role Binding Change | role_change_requests | ROLE_BINDING_CHANGE |
| Admin Account Suspension | suspension record | ADMIN_SUSPENSION |
| Admin Account Reactivation | reactivation record | ADMIN_REACTIVATION |
| Audit Evidence Export | evidence export record | AUDIT_EVIDENCE_EXPORT |
| Approval Policy Change | policy change record | APPROVAL_POLICY_CHANGE |

### What Stays Unchanged

- Request 表 + domain service + 业务校验 — 全部保留
- Audit log entityType / entityId — 不变
- 审批引擎核心（步骤推进、SoD 校验、超时）— 不变
- 3-Layer 架构（Domain Service → Approval Handler → Workflow）— 不变
- Client-web — 不涉及

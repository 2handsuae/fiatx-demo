# Role Detail Page — Redesign Spec

Last Updated: 2026-04-23 | Status: Pending Implementation

---

## 目标

将 `RoleDetailPage` 从"API 文档风格的路由表"改造成"功能域能力地图"。  
**只读展示，不做任何编辑功能。**

---

## 设计方案

### 整体布局

```
┌──────────────────────────────────────────────────────────────────┐
│  CISO  ·  Chief Information Security Officer            ACTIVE   │
│  Security governance and IAM control owner.                      │
└──────────────────────────────────────────────────────────────────┘

  快速概览栏（横向滚动）：
  [Identity & Access · MANAGE]  [Governance · DECIDE]  [Audit · VIEW]
  [Customer · —]  [Compliance · —]  [Trading · —]  ...

  ↓ 展开区：只显示有权限的域（toggle 可显示全部）

  ┌─────────────────────────────────────────┐
  │  🔐 Identity & Access        [MANAGE]   │
  │─────────────────────────────────────────│
  │  ✓ Browse admin member list             │
  │  ✓ View admin member detail             │
  │  ✓ Invite new admin member              │
  │  ✓ Resend invitation                    │
  │  ✓ Browse role catalog                  │
  │  ✓ View role permissions                │
  │  ✓ Assign / change admin roles          │
  │  ○ [dimmed: capabilities not held]      │
  └─────────────────────────────────────────┘
  ...（其他有权限的域）
```

### Access Level Badge（每个域右上角）

| Badge | 含义 | 颜色 |
|---|---|---|
| `MANAGE` | 含 ASSIGN / 配置写权限（最高） | amber |
| `FULL` | 含决策/消费/执行类权限 | amber |
| `OPERATE` | 含 READ + WRITE / SUBMIT | green |
| `VIEW` | 仅 READ 权限 | blue |
| `—` | 无此域任何权限 | dimmed grey |

### 无权限域的处理

- 默认只展示有权限的域（有 badge 的）
- 页面底部或侧栏提供 **"Show domains without access"** toggle
- toggle 打开后，无权限域以灰色折叠卡片显示

### 原始路由表保留

每个域卡片底部提供折叠入口：
```
▸ Show raw API bindings (9 routes)
```
供开发者需要时展开查看，不影响默认视图。

---

## Wave 1 功能域与能力清单

> 以下为 Wave 1 范围内所有页面的功能点，作为 Role Detail 展示内容的数据来源。  
> 格式：`[权限组] 能力描述 (对应页面)`

---

### Domain 1 — Identity & Access Management

**对应权限组：** `IAM_READ`、`IAM_ASSIGN`

| 能力标签 | 权限组 | 来源页面 |
|---|---|---|
| Browse admin member list | IAM_READ | PlatformMembers |
| Search / filter members by name, email, role | IAM_READ | PlatformMembers |
| View admin member detail (profile, roles, invite status) | IAM_READ | PlatformMemberDetailPage |
| View member's current role bindings | IAM_READ | PlatformMemberDetailPage |
| Invite new admin member | IAM_ASSIGN | PlatformMembers |
| Resend invitation to inactive member | IAM_ASSIGN | PlatformMemberDetailPage |
| Browse role catalog (all roles and descriptions) | IAM_READ | RolesPage |
| View role permission bindings | IAM_READ | RoleDetailPage |
| Assign / change admin roles (initiate governance workflow) | IAM_ASSIGN | PlatformMemberDetailPage |

**Access Level 判断：**
- 有 `IAM_ASSIGN` → `MANAGE`
- 只有 `IAM_READ` → `VIEW`

---

### Domain 2 — Governance · Approval Engine

**对应权限组：** `GOV_APPROVAL_READ`、`GOV_APPROVAL_WRITE`、`GOV_APPROVAL_DECIDE`

| 能力标签 | 权限组 | 来源页面 |
|---|---|---|
| Browse approval cases | GOV_APPROVAL_READ | ApprovalsPage |
| Filter approvals by status / action type | GOV_APPROVAL_READ | ApprovalsPage |
| View approval case detail (history, steps, SoD metadata) | GOV_APPROVAL_READ | ApprovalDetailPage |
| View SoD configuration (maker/checker rules per action type) | GOV_APPROVAL_READ | SodConfigPage |
| Create / submit approval request | GOV_APPROVAL_WRITE | ApprovalDetailPage |
| Cancel own approval request | GOV_APPROVAL_WRITE | ApprovalDetailPage |
| Approve an approval case (checker decision) | GOV_APPROVAL_DECIDE | ApprovalDetailPage |
| Reject an approval case (checker decision) | GOV_APPROVAL_DECIDE | ApprovalDetailPage |

**Access Level 判断：**
- 有 `GOV_APPROVAL_DECIDE` → `FULL`
- 有 `GOV_APPROVAL_WRITE` (无 DECIDE) → `OPERATE`
- 只有 `GOV_APPROVAL_READ` → `VIEW`

---

### Domain 3 — Governance · Change Tickets

**对应权限组：** `GOV_CHANGE_TICKET_READ`、`GOV_CHANGE_TICKET_WRITE`、`GOV_CHANGE_TICKET_GATE`

| 能力标签 | 权限组 | 来源页面 |
|---|---|---|
| Browse change tickets | GOV_CHANGE_TICKET_READ | ChangeTicketsPage |
| View change ticket detail | GOV_CHANGE_TICKET_READ | ChangeTicketDetailPage |
| Create change ticket (Admin Invite / Role Binding) | GOV_CHANGE_TICKET_WRITE | ChangeTicketCreatePage |
| Submit change ticket for approval | GOV_CHANGE_TICKET_WRITE | ChangeTicketDetailPage |
| Consume (execute) approved change ticket | GOV_CHANGE_TICKET_WRITE | ChangeTicketDetailPage |
| Cancel change ticket | GOV_CHANGE_TICKET_WRITE | ChangeTicketDetailPage |

**Access Level 判断：**
- 有 `GOV_CHANGE_TICKET_WRITE` → `OPERATE`
- 只有 `GOV_CHANGE_TICKET_READ` → `VIEW`

> 注：`GOV_CHANGE_TICKET_GATE` / `GOV_CHANGE_TICKET_CLOSE` 当前为死权限组（无路由使用），不展示。

---

### Domain 4 — Governance · Delete Requests

**对应权限组：** `GOV_DELETE_REQUEST_READ`、`GOV_DELETE_REQUEST_WRITE`、`GOV_DELETE_REQUEST_CONSUME`

| 能力标签 | 权限组 | 来源页面 |
|---|---|---|
| Browse delete requests | GOV_DELETE_REQUEST_READ | DeleteRequestsPage |
| View delete request detail | GOV_DELETE_REQUEST_READ | DeleteRequestDetailPage |
| Create delete request (Admin User / Change Ticket / Evidence Package) | GOV_DELETE_REQUEST_WRITE | DeleteRequestCreatePage |
| Submit delete request for approval | GOV_DELETE_REQUEST_WRITE | DeleteRequestDetailPage |
| Cancel delete request | GOV_DELETE_REQUEST_WRITE | DeleteRequestDetailPage |
| Consume (execute) approved delete request | GOV_DELETE_REQUEST_CONSUME | DeleteRequestDetailPage |

**Access Level 判断：**
- 有 `GOV_DELETE_REQUEST_CONSUME` → `FULL`
- 有 `GOV_DELETE_REQUEST_WRITE` (无 CONSUME) → `OPERATE`
- 只有 `GOV_DELETE_REQUEST_READ` → `VIEW`

---

### Domain 5 — Audit Center

**对应权限组：** `AUDIT_READ`、`AUDIT_MANUAL_WRITE`、`AUDIT_EXPORT_CREATE`、`AUDIT_EXPORT_READ`

| 能力标签 | 权限组 | 来源页面 |
|---|---|---|
| Browse audit log events | AUDIT_READ | AuditLogsPage |
| Filter audit logs (by actor, action, date range) | AUDIT_READ | AuditLogsPage |
| View audit log event detail | AUDIT_READ | AuditLogDetailPage |
| Write manual audit log entry | AUDIT_MANUAL_WRITE | AuditLogsPage |
| Request audit evidence package export | AUDIT_EXPORT_CREATE | EvidenceExportsPage |
| Browse audit evidence packages | AUDIT_EXPORT_READ | EvidenceExportsPage |
| View evidence package detail and generation status | AUDIT_EXPORT_READ | EvidenceExportDetailPage |
| Download evidence package content | AUDIT_EXPORT_READ | EvidenceExportDetailPage |

**Access Level 判断：**
- 有 `AUDIT_EXPORT_CREATE` 或 `AUDIT_MANUAL_WRITE` → `OPERATE`
- 有 `AUDIT_EXPORT_READ` (无写类) → `VIEW`（若也有 `AUDIT_READ`）
- 只有 `AUDIT_READ` → `VIEW`

---

## API 变更需求

当前 `GET /admin/iam/roles` 返回的 `permissions[]` 不含 `groups` 字段。  
重构后前端需要 `groups` 来做域归组。

**方案 A（推荐）**：后端 response 每条 permission 带 `groups: string[]`，改动极小（`RBAC_PERMISSION_DEFINITIONS` 已有此字段，序列化时带出即可）。

**方案 B（纯前端）**：前端维护 `permissionCode → groups[]` 映射表，不改后端。缺点：映射表需手动与 catalog 同步。

---

## 实现清单

| # | 工作项 | 依赖 |
|---|---|---|
| 1 | 后端 `/admin/iam/roles` response 带 `groups` 字段 | 方案 A 选用时 |
| 2 | 前端定义 `DOMAIN_CONFIG`：各域标签、icon、权限组列表、access level 计算函数 | — |
| 3 | 实现 `CapabilityDomainCard` 组件：access badge + 能力列表 + 折叠 raw routes | — |
| 4 | 实现快速概览栏（横向域摘要） | 3 完成后 |
| 5 | 实现"Show domains without access"toggle | 3 完成后 |
| 6 | 删除旧的 method filter / permission table（或移至折叠区） | — |

---

## 不在范围

- 任何编辑、写入操作（role 绑定变更走 C2 governance workflow）
- Wave 2–4 功能域（Customer、Trading、Treasury 等）不在本次 Wave 1 重构范围，但 `DOMAIN_CONFIG` 结构应预留扩展位

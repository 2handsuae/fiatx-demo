Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-06
Applies To: `Exchange_js`
Audience: Wave 2+ developers
Source of Truth Level: PRD-wave1

# Wave 1 治理工作流全览

## 文档目的

本文档面向加入 Wave 2 及后续阶段的开发者。Wave 1 建立了 Exchange_js 平台的核心治理框架，所有后续 Wave 的受控变更都复用本文档描述的机制。阅读本文档后，开发者应能理解：

- Wave 1 的三种核心治理机制及其区别
- 六条受控工作流的完整状态机、参与角色、SoD 规则
- 各流程的关键 API、执行效果、审计事件序列
- 错误处理策略与共同约束

**约定**：中文用于概念解释，英文用于代码、API、字段名、状态值。

---

## 一、Wave 1 治理机制总览

Wave 1 共三种核心治理机制，承载六条受控工作流：

| 机制 | Workflow ID | 用途 |
|---|---|---|
| **Change Ticket** | WF-06 | Admin IAM 变更：先审批，再执行 |
| **Delete Request** | WF-05 | 受控软删除：先审批，再消费 |
| **Approval (直接执行型)** | WF-03 扩展 | 审批即执行，无独立 consume 步骤 |

### 机制对比

```
Change Ticket (WF-06)
  创建 DRAFT → submit → PENDING_APPROVAL → approve → READY → consume → DONE/FAILED
  特点：consume 是独立步骤，由任意有权限管理员执行，不限于创建人/审批人

Delete Request (WF-05)
  创建 DRAFT → submit → PENDING_APPROVAL → approve → READY → consume → DONE/FAILED
  特点：consume 强制不同于创建人（SUPER_ADMIN 例外）

Approval 直接执行型 (WF-03 扩展)
  创建并提交 → PENDING → approve → 自动执行 → EXECUTED
  特点：无独立 consume 步骤，审批通过后系统自动执行
```

### 治理容器 vs 业务工作流名称

> 重要约定：`Change Ticket`、`Delete Request`、`Approval` 是**治理容器**（governance container），不是面向 operator 的顶层工作流名称。
>
> 审计日志、UI 页面第一层使用的是**业务工作流名称**，例如 `ADMIN_MEMBER_PROVISIONING`、`CHANGE_TICKET_DELETION`。

---

## 二、六条受控工作流

| # | 流程名称 | 机制 | changeType / targetType |
|---|---|---|---|
| Flow 1 | 创建管理员账号 | Change Ticket | `ADMIN_ACCESS_CHANGE` / intent=`ADMIN_MEMBER_PROVISIONING` |
| Flow 2 | 更改管理员角色绑定 | Change Ticket | `RBAC_CATALOG_CHANGE` / intent=`ADMIN_ROLE_BINDING_CHANGE` |
| Flow 3 | 导出审计证据包 | Approval 直接执行 | `AUDIT_EVIDENCE_EXPORT_APPROVAL` |
| Flow 4 | 删除管理员账号 | Delete Request | `targetType=ADMIN_USER` |
| Flow 5 | 删除变更工单 | Delete Request | `targetType=CHANGE_TICKET` |
| Flow 6 | 删除审计证据包 | Delete Request | `targetType=AUDIT_EVIDENCE_PACKAGE` |

---

## Flow 1：创建管理员账号 (Admin Member Provisioning)

### 概述

通过 Change Ticket 机制对管理员账号创建进行双人治理。创建请求提交后不立即生效，需经 CISO 审批并由任意有权限的管理员执行 consume 后，系统才真正创建用户。

- **业务工作流名称（operator-facing）**：`ADMIN_MEMBER_PROVISIONING`
- **治理容器**：`Change Ticket`（`changeType=ADMIN_ACCESS_CHANGE`）
- **入口页面**：`Backend Member Management → Platform Members → 创建管理员`

### 参与角色

| 角色 | 系统角色代码 | 职责 |
|---|---|---|
| Maker | `TECH_OFFICER` | 创建变更工单并提交审批 |
| Checker | `CISO` | 审批工单（唯一有权审批此类型的角色） |
| Executor | 任意有 `GOV_CHANGE_TICKET_WRITE` 权限的管理员 | 执行 consume，触发实际账号创建 |

### SoD 规则

- Maker ≠ Checker：提交人不能自审
- Checker **必须**是 `CISO`，其他角色无法通过 approve 接口审批此类工单
- Executor 无限制（Maker 本人也可执行 consume）

### 状态机

```
[发起创建请求]
      ↓ POST /users (创建 Change Ticket, status=DRAFT)
  DRAFT
      ↓ POST /admin/control-gates/change-tickets/:id/submit (Maker 提交)
  PENDING_APPROVAL ←─────────────── 关联 ApprovalCase 同步创建并进入 PENDING
      │                    │
      ↓ CISO approve        ↓ reject / expire / cancel
  READY               REJECTED (终态)
      │
      ↓ POST /admin/control-gates/change-tickets/:id/consume (Executor)
      │
  ┌───┴───┐
DONE    FAILED  ← 执行失败不改变 READY 状态，executionStatus=EXECUTION_FAILED，可重试
```

**状态说明**：

| 状态 | 含义 |
|---|---|
| `DRAFT` | 已创建，尚未提交审批 |
| `PENDING_APPROVAL` | 已提交，等待 CISO 审批 |
| `READY` | 审批通过，等待 consume 执行 |
| `DONE` | consume 成功，账号已创建 |
| `FAILED` | consume 执行失败（终态，不可重试；但 `READY` 状态下 executionStatus=EXECUTION_FAILED 可重试） |
| `REJECTED` | 审批拒绝/超时/取消（终态） |
| `CANCELLED` | 工单被取消（终态） |

### bindingSnapshotJson 结构

```json
{
  "intent": "ADMIN_MEMBER_PROVISIONING",
  "email": "new.admin@fiatx.com",
  "roleCodes": ["COMPLIANCE_OFFICER"],
  "displayName": "张三"
}
```

`bindingSnapshot` 在工单**创建时**冻结，是审批和 consume 的合同。CISO 审批的是这份 snapshot，consume 执行的也是这份 snapshot，而非当时的实时状态。

### 关键 API

```
# 1. 创建变更工单（同时进入 DRAFT）
POST /users
Body: {
  email, displayName, roleCodes,
  changeReason, scopeSummary, testEvidenceRef, rollbackPlanRef
}

# 2. 提交审批（DRAFT → PENDING_APPROVAL）
POST /admin/control-gates/change-tickets/:id/submit

# 3. CISO 审批（PENDING_APPROVAL → READY）
POST /admin/control-gates/approvals/:id/approve
Body: { comment? }

# 4. 执行 consume（READY → DONE/FAILED）
POST /admin/control-gates/change-tickets/:id/consume

# 查询工单
GET /admin/control-gates/change-tickets
GET /admin/control-gates/change-tickets/:id
```

### 执行效果（consume 成功后）

consume 成功后，系统原子性地完成以下操作：

1. 创建 `users` 记录，`status=INACTIVE`
2. 生成 `AdminUserInvitation`（24h TTL 邀请链接，供 operator 在 Member Detail 页面复制）
3. 写入 `user_roles` 绑定（根据 snapshot 中的 `roleCodes`）
4. 写入 `consumedByUserNo`、`consumedAt`、`resultNote` 到工单记录
5. 发送审计事件序列（见下）

**注意**：新创建的 `INACTIVE` 用户无法登录，必须通过邀请链接激活后 `status` 才变为 `ACTIVE`。

### 审计事件序列

```
Trace: ADMIN_MEMBER_PROVISIONING / ticketNo

1. CHANGE_TICKET_CREATED          — Maker 发起创建
2. CHANGE_TICKET_SUBMITTED        — Maker 提交审批
   APPROVAL_SUBMITTED             — 关联 ApprovalCase 提交
3. APPROVAL_APPROVED              — CISO 审批通过
   CHANGE_TICKET_APPROVED         — 工单投影为 READY
4. CHANGE_TICKET_CONSUMED         — Executor 执行
   USER_CREATED                   — 用户记录创建
   ADMIN_INVITATION_CREATED       — 邀请链接生成
```

---

## Flow 2：更改管理员角色绑定 (Admin Role Binding Change)

### 概述

通过 Change Ticket 机制对管理员角色绑定变更进行双人治理。变更请求审批通过后，consume 执行时替换目标用户的所有角色绑定。

- **业务工作流名称（operator-facing）**：`ADMIN_ROLE_BINDING_CHANGE`
- **治理容器**：`Change Ticket`（`changeType=RBAC_CATALOG_CHANGE`）
- **入口页面**：`Backend Member Management → Platform Members → Member Detail → 变更角色`

### 参与角色

与 Flow 1 相同：

| 角色 | 系统角色代码 | 职责 |
|---|---|---|
| Maker | `TECH_OFFICER` | 创建变更工单并提交审批 |
| Checker | `CISO` | 审批工单 |
| Executor | 任意有 `GOV_CHANGE_TICKET_WRITE` 权限的管理员 | 执行 consume |

### SoD 规则

与 Flow 1 相同：
- Maker ≠ Checker（不可自审）
- Checker 必须是 `CISO`

### 状态机

与 Flow 1 完全相同，不再赘述：

```
DRAFT → PENDING_APPROVAL → READY → DONE / FAILED
                         ↘ REJECTED
```

### bindingSnapshotJson 结构

```json
{
  "intent": "ADMIN_ROLE_BINDING_CHANGE",
  "targetUserId": "uuid-of-target-user",
  "targetUserNo": "ADMIN-TECH",
  "roleCodes": ["TECH_OFFICER", "COMPLIANCE_OFFICER"],
  "changeMode": "REPLACE"
}
```

- `changeMode=REPLACE`：consume 时先删除目标用户所有现有角色绑定，再新增 snapshot 中指定的 `roleCodes`
- `targetUserNo` 作为人类可读的唯一标识，`targetUserId` 是内部主键

### 关键 API

```
# 1. 创建变更工单
PUT /admin/iam/users/:id/roles
Body: {
  roleCodes, changeReason, scopeSummary, testEvidenceRef, rollbackPlanRef
}

# 2. 提交审批
POST /admin/control-gates/change-tickets/:id/submit

# 3. CISO 审批
POST /admin/control-gates/approvals/:id/approve

# 4. 执行 consume
POST /admin/control-gates/change-tickets/:id/consume
```

### 执行效果（consume 成功后）

1. 删除目标用户所有现有 `user_roles` 绑定
2. 新增 snapshot 中 `roleCodes` 对应的 `user_roles` 绑定
3. 更新 `users.role` 兼容字段（取主要角色，向后兼容旧查询）
4. **注意**：`user_roles` 是授权真值，`users.role` 仅为兼容字段，开发者应读取 `user_roles`

### 审计事件序列

```
Trace: ADMIN_ROLE_BINDING_CHANGE / ticketNo

1. CHANGE_TICKET_CREATED
2. CHANGE_TICKET_SUBMITTED + APPROVAL_SUBMITTED
3. APPROVAL_APPROVED + CHANGE_TICKET_APPROVED
4. CHANGE_TICKET_CONSUMED → USER_ROLE_BINDING_UPDATED
```

---

## Flow 3：导出审计证据包 (Audit Evidence Export)

### 概述

通过直接执行型 Approval 机制对审计证据导出请求进行治理。与 Change Ticket 不同，此流程**没有独立的 consume 步骤**。审批通过后，系统自动执行证据包打包并生成可下载文件。

- **业务工作流名称（operator-facing）**：`AUDIT_EVIDENCE_EXPORT_APPROVAL`（审批直接执行型）
- **治理容器**：`Approval`（`actionType=AUDIT_EVIDENCE_EXPORT_APPROVAL`）
- **入口页面**：`Audit Center → Audit Log → 导出证据包`

### 参与角色

| 角色 | 权限/系统角色 | 职责 |
|---|---|---|
| Maker | `COMPLIANCE_OFFICER`（有 `AUDIT_EXPORT_CREATE` 权限） | 发起导出请求 |
| Checker | `DPO` 或 `MLRO` | 审批导出申请 |
| 无独立 Executor | — | 审批通过后系统自动打包，无需手动 consume |

### SoD 规则

- Maker ≠ Checker（不可自审）
- Checker **必须**是 `DPO` 或 `MLRO`
- 与 Change Ticket 类型不同：此类审批 Checker 接受两种角色，且审批通过即自动执行

### 状态机

```
[发起导出请求]
      ↓ POST /admin/audit/evidence-packages
        → 同时创建 AuditEvidencePackage(status=PENDING) + ApprovalCase(DRAFT→PENDING)

  AuditEvidencePackage.status     ApprovalCase.status
       PENDING                      PENDING
           │                            │
           │                   ↓ DPO/MLRO approve
           │                       APPROVED
           │                            │
           │                   ↓ 自动执行打包
           ↓                            ↓
       READY                      executionStatus=EXECUTED
           │
           ↓ 可下载
     [download available]

                  ↓ reject / expire
               REJECTED (ApprovalCase)
               AuditEvidencePackage.status = REJECTED (不生成文件)
```

**与 Flow 1/2 的关键区别**：

| 维度 | Change Ticket | Approval 直接执行型 |
|---|---|---|
| 审批通过后 | 工单变为 `READY`，等待人工 consume | 自动执行打包，无需额外步骤 |
| 执行角色 | 任意有权限管理员 | 系统自动 |
| 重试机制 | consume 可重试 | 打包失败需重新提交请求 |

### 关键 API

```
# 1. 创建并提交导出请求（同时创建 AuditEvidencePackage + ApprovalCase）
POST /admin/audit/evidence-packages
Body: {
  dateRangeStart, dateRangeEnd,
  eventTypes[],     // 要导出的审计事件类型
  exportReason,
  scopeSummary
}

# 2. DPO/MLRO 审批
POST /admin/control-gates/approvals/:id/approve
Body: { comment? }

# 3. 下载（仅当 status=READY 且 ApprovalCase.executionStatus=EXECUTED 后可用）
GET /admin/audit/evidence-packages/:id/download

# 查询
GET /admin/audit/evidence-packages
GET /admin/audit/evidence-packages/:id
```

### 证据包内容结构

审批通过后自动生成以下组件：

```json
{
  "manifest": "...",       // 导出清单：时间范围、事件类型、生成时间
  "records": [...],        // 筛选后的审计事件列表（含关联快照）
  "packageBody": "...",    // 完整证据包（压缩归档）
  "digest": "sha256:..."   // 内容摘要，用于完整性校验
}
```

### 审计事件序列

```
Trace: AUDIT_EVIDENCE_EXPORT_APPROVAL / approvalNo

1. AUDIT_EVIDENCE_EXPORT_REQUESTED   — Maker 提交导出申请
2. APPROVAL_SUBMITTED                — ApprovalCase 进入 PENDING
3. APPROVAL_APPROVED                 — DPO/MLRO 审批通过
4. APPROVAL_EXECUTED                 — 系统自动打包完成
   AUDIT_EVIDENCE_PACKAGE_EXPORTED   — 证据包就绪（此事件本身也被纳入审计日志）
```

---

## Flow 4：删除管理员账号 (Delete Admin User)

### 概述

通过 Delete Request 机制对管理员账号软删除进行治理。与 Change Ticket 不同，Delete Request 强制要求 **consume 执行人不得是请求创建人**（`SUPER_ADMIN` 例外）。

- **业务工作流名称（operator-facing）**：`ADMIN_USER_DELETION`
- **治理容器**：`Delete Request`（`targetType=ADMIN_USER`）
- **入口页面**：`Backend Member Management → Platform Members → Member Detail → 删除账号`

### 参与角色

| 角色 | 权限要求 | 职责 |
|---|---|---|
| Creator/Submitter | `GOV_DELETE_REQUEST_WRITE` 权限 | 创建删除申请并提交 |
| Checker | `DPO` 或 `CISO` | 审批删除申请 |
| Consumer | `GOV_DELETE_REQUEST_CONSUME` 权限，且**不得为 Creator** | 执行 consume |
| SUPER_ADMIN | 任意 | 可绕过 Creator ≠ Consumer SoD（须留审计记录） |

### SoD 规则

- Maker ≠ Checker（不可自审）
- Checker 必须是 `DPO` 或 `CISO`（接受两种角色）
- **Creator ≠ Consumer**：创建人不得执行 consume，这是 Delete Request 与 Change Ticket 的核心区别
- `SUPER_ADMIN` 可绕过 Creator ≠ Consumer 限制，但系统会在审计日志中记录 bypass 元数据

### 前置条件

在创建 Delete Request 时，系统验证：

- 目标用户（`targetNo=userNo`，如 `ADMIN-TECH`）必须存在
- 目标用户尚未被软删除（`deletedAt IS NULL`）
- 系统同时捕获目标快照（target snapshot）作为删除记录的一部分

### 状态机

```
[发起删除申请]
      ↓ POST /admin/control-gates/delete-requests
        (解析 targetNo，捕获 target snapshot，创建 DRAFT)
  DRAFT
      ↓ POST /admin/control-gates/delete-requests/:id/submit (Creator)
  PENDING_APPROVAL ←──── 关联 ApprovalCase 进入 PENDING
      │                    │
      ↓ DPO/CISO approve   ↓ reject / expire / cancel
  READY               REJECTED (终态)
      │
      ↓ POST /admin/control-gates/delete-requests/:id/consume
        (Consumer 必须 ≠ Creator，SUPER_ADMIN 例外)
      │
  ┌───┴───┐
DONE    FAILED
```

**cancel 规则**：
- Creator 可取消 `DRAFT`、`PENDING_APPROVAL`、`READY` 状态的请求
- `SUPER_ADMIN` 可取消他人创建的请求

### 执行效果（consume 成功后）

软删除操作写入目标用户记录：

```sql
UPDATE users SET
  deleted_at       = NOW(),
  deleted_by       = :consumerUserId,
  delete_request_id = :deleteRequestId,
  delete_reason    = :deleteRequest.deleteReason
WHERE id = :targetUserId;
```

业务影响：

1. 软删除用户从 `Platform Members` 列表隐藏（列表查询默认过滤 `deleted_at IS NOT NULL`）
2. 软删除用户登录被拒（`AuthService` 在 login 时检查 `deletedAt`，返回 401）
3. 软删除用户已有的邀请链接立即失效（invitation 查询会同步检查用户 `deletedAt`）
4. Delete Request 详情页仍可查看（不随目标删除而消失）

### 关键 API

```
# 1. 创建删除申请
POST /admin/control-gates/delete-requests
Body: {
  targetType: "ADMIN_USER",
  targetNo: "ADMIN-TECH",       // userNo，系统自动解析为 userId
  deleteReason: "...",
  scopeSummary: "..."
}

# 2. 提交审批
POST /admin/control-gates/delete-requests/:id/submit

# 3. DPO 或 CISO 审批
POST /admin/control-gates/approvals/:id/approve

# 4. 执行 consume（非创建人）
POST /admin/control-gates/delete-requests/:id/consume

# 5. 取消（Creator 或 SUPER_ADMIN）
POST /admin/control-gates/delete-requests/:id/cancel

# 查询
GET /admin/control-gates/delete-requests
GET /admin/control-gates/delete-requests/:id
```

### 审计事件序列

```
Trace: ADMIN_USER_DELETION / requestNo

1. DELETE_REQUEST_CREATED        — Creator 发起
2. DELETE_REQUEST_SUBMITTED      — Creator 提交
   APPROVAL_SUBMITTED            — 关联 ApprovalCase 提交
3. APPROVAL_APPROVED             — DPO/CISO 审批通过
   DELETE_REQUEST_APPROVED       — 请求投影为 READY
4. DELETE_REQUEST_CONSUMED       — Consumer 执行（目标软删除完成）
```

---

## Flow 5：删除变更工单 (Delete Change Ticket)

### 概述

通过 Delete Request 机制对已终结的 Change Ticket 进行受控软删除。仅允许删除处于终态的工单。

- **业务工作流名称（operator-facing）**：`CHANGE_TICKET_DELETION`
- **治理容器**：`Delete Request`（`targetType=CHANGE_TICKET`）
- **入口页面**：`Control Gates Center → Change Tickets → Detail → 删除工单`

### 参与角色

与 Flow 4 相同：

| 角色 | 职责 |
|---|---|
| Creator/Submitter | 创建删除申请并提交 |
| Checker（DPO 或 CISO） | 审批 |
| Consumer（非 Creator） | 执行 consume |

### SoD 规则

与 Flow 4 完全相同（Creator ≠ Consumer，Checker 必须是 DPO 或 CISO）。

### 前置条件

在创建 Delete Request 时，系统验证：

- 目标工单（`targetNo=ticketNo`，如 `CT-20260401-0001`）必须存在
- 目标工单尚未被软删除（`deletedAt IS NULL`）
- 目标工单必须处于**终态**：`DONE`、`FAILED`、`REJECTED`、`CANCELLED`

> 处于 `DRAFT`、`PENDING_APPROVAL`、`READY` 的工单不可发起删除申请，系统返回 422。

### 状态机

与 Flow 4 完全相同，不再赘述。

### 执行效果（consume 成功后）

软删除操作写入目标工单记录：

```sql
UPDATE change_tickets SET
  deleted_at         = NOW(),
  deleted_by         = :consumerUserId,
  delete_request_id  = :deleteRequestId,
  delete_request_no  = :deleteRequest.requestNo,
  delete_reason      = :deleteRequest.deleteReason
WHERE id = :targetTicketId;
```

业务影响：

1. 工单从 `Control Gates Center → Change Tickets` 列表隐藏
2. Delete Request 详情页仍可访问已删除工单的快照信息（target snapshot 在请求创建时已捕获）

### 审计事件序列

```
Trace: CHANGE_TICKET_DELETION / requestNo

1. DELETE_REQUEST_CREATED
2. DELETE_REQUEST_SUBMITTED + APPROVAL_SUBMITTED
3. APPROVAL_APPROVED + DELETE_REQUEST_APPROVED
4. DELETE_REQUEST_CONSUMED
```

---

## Flow 6：删除审计证据包 (Delete Audit Evidence Package)

### 概述

通过 Delete Request 机制对审计证据包进行受控软删除。物理数据（packageBody）保留，仅在数据库层面标记删除并从列表隐藏。

- **业务工作流名称（operator-facing）**：`AUDIT_EVIDENCE_PACKAGE_DELETION`
- **治理容器**：`Delete Request`（`targetType=AUDIT_EVIDENCE_PACKAGE`）
- **入口页面**：`Audit Center → Evidence Packages → Detail → 删除证据包`

### 参与角色

与 Flow 4/5 相同。

### SoD 规则

与 Flow 4/5 完全相同（Creator ≠ Consumer，Checker 必须是 DPO 或 CISO）。

### 前置条件

在创建 Delete Request 时，系统验证：

- 目标证据包必须存在
- 目标证据包尚未被软删除（`deletedAt IS NULL`）
- 目标证据包**不得有处于 `PENDING` 状态的关联审批单**（防止删除进行中的导出审批）

> 如果证据包的关联 ApprovalCase 仍处于 `PENDING`，系统返回 422，需等审批流程结束后才可发起删除。

### 执行效果（consume 成功后）

```sql
UPDATE audit_evidence_packages SET
  deleted_at         = NOW(),
  deleted_by         = :consumerUserId,
  delete_request_id  = :deleteRequestId,
  delete_reason      = :deleteRequest.deleteReason
WHERE id = :targetPackageId;
```

业务影响：

1. 证据包从 `Audit Center → Evidence Packages` 列表隐藏
2. **物理数据（packageBody）保留**，不执行实际文件删除（符合合规数据保留要求）
3. 已删除证据包无法通过 download API 访问

### 审计事件序列

```
Trace: AUDIT_EVIDENCE_PACKAGE_DELETION / requestNo

1. DELETE_REQUEST_CREATED
2. DELETE_REQUEST_SUBMITTED + APPROVAL_SUBMITTED
3. APPROVAL_APPROVED + DELETE_REQUEST_APPROVED
4. DELETE_REQUEST_CONSUMED
```

---

## 三、共同规则与约束

### SoD 规则对比

| 规则 | Change Ticket (Flow 1/2) | Delete Request (Flow 4/5/6) | Approval 直接执行 (Flow 3) |
|---|---|---|---|
| Maker ≠ Checker | ✅ 强制 | ✅ 强制 | ✅ 强制 |
| Checker 角色限制 | `CISO` only | `DPO` 或 `CISO` | `DPO` 或 `MLRO` |
| Creator ≠ Consumer | ❌ 无此限制 | ✅ 强制（SUPER_ADMIN 例外） | N/A（无 consume 步骤） |
| SUPER_ADMIN 可绕过 SoD | ✅（留审计记录） | ✅（留审计记录） | ✅（留审计记录） |
| 审批超时时间 | 24h | 24h | 24h |
| 支持 cancel | ✅ | ✅（DRAFT/PENDING_APPROVAL/READY 均可） | ✅ |

### 通用超时规则

- 所有审批单（`ApprovalCase`）在 `PENDING` 状态下，24h 后自动 expire
- expire 后对应的 Change Ticket / Delete Request 投影为 `REJECTED` 终态
- expire 不触发任何业务副作用（不执行任何写操作）

### consume 幂等性与重试

```
执行失败场景：
  Change Ticket / Delete Request 处于 READY 状态
  executionStatus = EXECUTION_FAILED
  → 可重新调用 consume 接口重试

执行成功后：
  状态变为 DONE（终态）
  → 不可重试、不可撤销
```

### bindingSnapshot 冻结原则

- `bindingSnapshot` 在**工单创建时**冻结，之后不可修改
- Checker 审批的是创建时的 snapshot 内容
- Consumer consume 执行的也是同一份 snapshot
- 如需修改参数，必须取消原工单并重新创建

---

## 四、错误处理

| 场景 | HTTP 状态码 | 行为 |
|---|---|---|
| consume 执行失败（业务逻辑错误） | `200`（异步失败）| status 维持 `READY`，`executionStatus=EXECUTION_FAILED`，可重试 |
| 重复提交相同 `entityRef` 的审批 | `409` | Engine 拒绝，返回冲突错误 |
| SoD 违规（同人审批） | `403` | Engine 拒绝，审批接口返回 Forbidden |
| Checker 角色不匹配（非 CISO/DPO 等） | `403` | decide 接口拒绝，返回 Forbidden |
| Creator 尝试 consume Delete Request | `403` | consume 接口拒绝（SUPER_ADMIN 除外） |
| 目标不满足前置条件（如工单非终态） | `422` | 创建时即拒绝，返回 Unprocessable Entity |
| 目标已被软删除 | `422` | 创建时即拒绝 |
| 目标有 PENDING 审批（Flow 6 特有） | `422` | 创建时即拒绝 |
| 工单/请求处于非法状态（如 DONE 状态 submit）| `409` | 返回状态冲突错误 |

---

## 五、审计追踪架构

### Trace 设计原则

每条业务工作流实例对应**一条 Trace**：

```
ADMIN_MEMBER_PROVISIONING Trace (primaryRefNo = ticketNo)
  ├── CHANGE_TICKET_CREATED
  ├── CHANGE_TICKET_SUBMITTED
  ├── APPROVAL_SUBMITTED        ← 治理节点嵌入在业务 trace 内
  ├── APPROVAL_APPROVED
  ├── CHANGE_TICKET_APPROVED
  ├── CHANGE_TICKET_CONSUMED
  ├── USER_CREATED
  └── ADMIN_INVITATION_CREATED
```

```
ADMIN_USER_DELETION Trace (primaryRefNo = requestNo)
  ├── DELETE_REQUEST_CREATED
  ├── DELETE_REQUEST_SUBMITTED
  ├── APPROVAL_SUBMITTED        ← 治理节点嵌入在删除 trace 内
  ├── APPROVAL_APPROVED
  ├── DELETE_REQUEST_APPROVED
  └── DELETE_REQUEST_CONSUMED
```

**重要约束**：
- 删除工作流（Flow 4/5/6）有**自己独立的 trace**，不继承被删目标的原 trace
- `Change Ticket`、`Delete Request`、`Approval` 作为技术层事件留在 technical context
- 页面第一层显示的是业务工作流名称（`ADMIN_MEMBER_PROVISIONING` 等）

### audit 事件 vocabulary（第一层）

| 业务场景 | 第一层 action vocabulary |
|---|---|
| 请求创建 | `REQUEST_CREATED` |
| 提交审批 | `SUBMITTED` |
| 审批通过可执行 | `APPROVED_FOR_EXECUTION` |
| 取消 | `CANCELLED` |
| 执行成功 | `EXECUTED` |
| 执行失败 | `EXECUTION_FAILED` |

---

## 六、模块读写归属

| 服务 | 归属职责 |
|---|---|
| `ChangeTicketsService` | Change Ticket 全生命周期、审批投影、业务页面 proposal helpers、consume dispatch |
| `DeleteRequestsService` | Delete Request 全生命周期、目标验证、snapshot 捕获、cancel、consume |
| `ApprovalsService` | 关联审批单生命周期、审批终态投影 |
| `UsersService` | 正式 provisioning 写入（consume 触发）、member 列表/详情、邀请重发 |
| `AccessControlService` | 角色权限目录真值、正式角色绑定替换（consume 触发） |
| `AdminInvitationsService` | 邀请 token 签发与验证 |
| `AuthService` | Admin login、`/auth/me` 权限解析 |
| `AuditEvidenceExportApprovalService` | 证据包导出请求创建、最终打包执行 |
| `AuditLogsService` | 所有模块的审计日志写入、证据包记录辅助 helpers |

---

## 七、Wave 2+ 开发者参考

### 新增受控流程时应遵循的模式

1. **确定机制**：是 Change Ticket（需要人工 consume）、Delete Request（软删除）还是直接执行型 Approval？
2. **定义 SoD 规则**：Checker 角色限制是什么？是否需要 Creator ≠ Consumer？
3. **设计 bindingSnapshot**：确定在创建时冻结的字段列表
4. **定义前置条件**：目标必须满足什么条件才能创建请求
5. **确定 Trace 归属**：是新 trace 还是继承父 workflow trace？
6. **定义审计事件**：参照上述 vocabulary 约定

### 已建立的不变式（Invariants）

```
invariant: Change Ticket.bindingSnapshot 在创建后不可变
invariant: consume 只能在 READY 状态执行
invariant: 软删除不执行物理删除，physical data 保留
invariant: 删除工作流 trace 不继承被删目标 trace
invariant: 所有 SoD 绕过行为必须在 audit 记录中标注
invariant: Change Ticket 审批通过只改变状态为 READY，不执行任何业务写操作
```

### 相关规格文档

- `docs/specs/workflows/change-ticket-release-gate-workflow.md` — Change Ticket 机制规格
- `docs/specs/workflows/delete-request-soft-delete-workflow.md` — Delete Request 机制规格
- `docs/specs/workflows/audit-evidence-export-approval-workflow.md` — 审计导出 Approval 规格
- `docs/specs/workflows/admin-member-auth-boundary-workflow.md` — Admin Member 认证边界规格
- `docs/specs/modules/governance-control-foundation-module.md` — 治理控制基础模块规格
- `docs/constraints/backend-workflow-state-machine-constraints.md` — 状态机约束
- `docs/constraints/backend-auth-and-authorization-constraints.md` — 认证授权约束

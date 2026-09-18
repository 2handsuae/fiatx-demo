# Role Definition Create — Approval Workflow

Date: 2026-05-08 | Status: Draft | Scope: Create Role with C2 approval

---

## Problem

当前系统的 8 个角色在 `rbac.catalog.ts` 中 hardcode，通过 seed 写入 DB。没有 UI 或 API 支持动态创建新角色。随着组织扩展，operator 需要能自行定义新角色并配置权限，且该操作需走审批流程（VARA 合规要求）。

## Decision

采用 **Admin Invite 同构模式**：直接在 `roles` 表上创建 `PENDING_APPROVAL` 状态的行，审批通过后激活为 `ACTIVE`，审批拒绝/取消后物理删除。不建独立的 request 表。

权限选择以 **Permission Group 粒度** 进行——operator 勾选 permission group（如 `IAM_READ`、`AUDIT_EXPORT_CREATE`），一个 group 包含该功能域的所有 permission。

**不做的事：**
- 不做 Update Role 工作流（改名/改权限）——后续独立 scope
- 不做 Disable/Enable Role 工作流——ADVANCED scope
- 不改 seed 逻辑——现有 seed 直接创建 ACTIVE 角色，不受影响
- 不改 `listRoles` 的 `status: 'ACTIVE'` 过滤——PENDING 角色自然不参与权限解析
- Catalog 降级为初始模板——seed 后 DB 是 source of truth，但本次不改 seed 行为，只是新增的角色不经过 catalog

## Design

### Data Layer

**修改 `Role` 模型**，新增 3 个字段：

```prisma
model Role {
  // ... existing fields ...
  approvalCaseId          String?
  approvalCaseNo          String?
  proposedPermissionGroups String?   // JSON: ["IAM_READ","AUDIT_READ"]
}
```

- `approvalCaseId` / `approvalCaseNo`：关联审批单，审批通过后保留（审计可追溯）
- `proposedPermissionGroups`：创建时存储提案的 permission group codes，审批通过后解析为 `role_permissions` 记录并清空

角色状态流转：
- 创建时 `status = 'PENDING_APPROVAL'`
- 审批通过 → `status = 'ACTIVE'`，写入 `role_permissions`，清空 `proposedPermissionGroups`
- 审批拒绝/取消/超时 → 物理删除 role 行

### Backend — Constants

**ApprovalActionTypes** 新增：
```typescript
ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE'
```

**AuditBusinessWorkflowTypes** 新增：
```typescript
ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE'
```

**AuditGovernanceActions** 新增：
```typescript
ROLE_DEFINITION: {
  CREATE_REQUESTED:     'CREATE_REQUESTED',
  APPROVAL_GRANTED:     'APPROVAL_GRANTED',
  APPROVAL_DECLINED:    'APPROVAL_DECLINED',
  APPROVAL_CANCELLED:   'APPROVAL_CANCELLED',
  ROLE_ACTIVATED:       'ROLE_ACTIVATED',
  ROLE_ACTIVATE_FAILED: 'ROLE_ACTIVATE_FAILED',
  CREATE_CANCELLED:     'CREATE_CANCELLED',
}
```

**默认审批策略：**
```typescript
[ApprovalActionTypes.ROLE_DEFINITION_CREATE]: {
  riskLevel: 'HIGH',
  steps: [{ stepNo: 1, roles: ['CISO'] }],
  timeoutHours: 48,
  allowCancel: true,
  allowRetry: false,
}
```

### Backend — Workflow Service

**新文件：`src/modules/identity/access-control/role-definition-create-workflow.service.ts`**

**依赖注入：** PrismaService, ApprovalsService, AccessControlService, AuditLogsService

**`initiateCreate(dto, actor)`：**

DTO 字段：
- `roleCode: string` — 大写 + 下划线，如 `RISK_ANALYST`
- `roleName: string` — 显示名称
- `description?: string` — 可选描述
- `permissionGroupCodes: string[]` — 至少 1 个
- `changeReason: string` — 变更原因

流程：
1. 校验 `roleCode` 格式（`/^[A-Z][A-Z0-9_]{1,48}$/`）
2. 校验 `roleCode` 在 `roles` 表唯一（包含所有状态，避免重复提交）
3. 校验 `permissionGroupCodes` 都存在于 `RBAC_PERMISSION_GROUPS`
4. 在 `roles` 表创建行：
   - `code = dto.roleCode`
   - `name = dto.roleName`
   - `description = dto.description || null`
   - `status = 'PENDING_APPROVAL'`
   - `proposedPermissionGroups = JSON.stringify(dto.permissionGroupCodes)`
5. 调 `approvalsService.createAndSubmit()`:
   - `actionType: ROLE_DEFINITION_CREATE`
   - `entityRef: role.id`
   - `workflowType: ROLE_DEFINITION_CREATE`
   - `workflowId: role.id`
   - `workflowNo: role.code`
   - `objectSnapshot: { roleCode, roleName, description, permissionGroupCodes, status }`
6. 回写 `role.approvalCaseId` / `approvalCaseNo`
7. 记审计日志：`ROLE_DEFINITION.CREATE_REQUESTED`
8. 返回 `{ roleCode, roleName, approvalNo, status }`

失败时（步骤 5-6 抛异常）：物理删除步骤 4 创建的 role 行。

**`@OnEvent('workflow.role-definition-create.decided')`：**

- `APPROVED` → `executeActivation()`：
  1. 解析 `proposedPermissionGroups`，通过 `RBAC_PERMISSION_GROUPS` 展开为 permission code 列表
  2. 查 `permissions` 表获取对应 permission id
  3. 批量 createMany `role_permissions`
  4. 更新 role：`status = 'ACTIVE'`，`proposedPermissionGroups = null`
  5. 记审计日志：`ROLE_DEFINITION.ROLE_ACTIVATED`
  6. `markExecutionResult(approvalId, true)`
  7. 执行失败时：`markExecutionResult(approvalId, false, errorMessage)`，记 `ROLE_ACTIVATE_FAILED`

- `DECLINED` / `CANCELLED` / `EXPIRED` → `executeCancellation()`：
  1. 物理删除 role 行（CASCADE 会清理 role_permissions，虽然此时不应有）
  2. 记审计日志：`CREATE_CANCELLED`

### Backend — Controller

**新路由加在现有 `AccessControlController`（`admin/iam`）上：**

- `POST /admin/iam/role-definitions` — 发起创建角色审批
  - Body: `{ roleCode, roleName, description?, permissionGroupCodes, changeReason }`
  - Response: `{ roleCode, roleName, approvalNo, status }`
  - Permission: `api.post.admin_iam_role-definitions`

- `GET /admin/iam/role-definitions/permission-groups` — 返回可选的 permission group 列表
  - Response: `Array<{ code: string; name: string; permissionCount: number }>`
  - Permission: `api.get.admin_iam_role-definitions_permission-groups`

### Backend — RBAC

**新 Permission Group `IAM_ROLE_DEFINE`：**
包含上述 2 条路由的 permission。

**分配给角色：** `CISO`, `TECH_OFFICER`

### Frontend — RolesPage

**修改 `RolesPage.tsx`：**

1. 加 "Create Role" 按钮（权限门控 `PERMISSIONS.ROLE_DEFINITIONS_CREATE`）
2. 点击展开 modal 表单：
   - Role Code — 文本输入，自动转大写，只允许 `A-Z0-9_`
   - Role Name — 文本输入
   - Description — 可选文本输入
   - Permission Groups — 多选勾选框列表，从 `/permission-groups` 接口加载，显示 group code + name + permission count
   - Change Reason — 文本输入
3. 提交后显示 success toast（含 approvalNo）
4. 修改 `listRoles` 请求：不再过滤掉 PENDING_APPROVAL 状态的角色（让列表显示待审批角色）
5. PENDING_APPROVAL 状态的角色在列表中用灰色 badge 标识

### Backend — listRoles 调整

当前 `AccessControlService.listRoles()` 硬编码 `where: { status: 'ACTIVE' }`。为了让前端能展示 PENDING_APPROVAL 状态的角色，将过滤条件改为 `where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } }`。

`getUserPermissionCodes` / `getUserRoles` 等权限解析方法保持 `status: 'ACTIVE'` 不变——只有 listRoles（展示用）放开。

### What Stays Unchanged

- `getUserPermissionCodes` 中的 `status: 'ACTIVE'` 过滤 — PENDING 角色不参与权限解析
- `getUserRoles` / `replaceUserRoles` 中的 `status: 'ACTIVE'` 过滤 — 不可将用户绑定到 PENDING 角色
- Seed 逻辑 — 现有 seed 直接创建 ACTIVE 角色，不受影响
- RoleDetailPage — PENDING 角色可以点进去看，显示 proposedPermissionGroups 作为"待审批权限"
- 其他审批工作流 — 不受影响

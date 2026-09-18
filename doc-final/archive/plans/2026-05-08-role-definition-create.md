# Role Definition Create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow operators to create new roles via an approval workflow — submit a proposal with role code, name, description, and permission groups; CISO approves; role becomes ACTIVE with permissions written.

**Architecture:** Follows the Admin Invite pattern — create a PENDING_APPROVAL row in the `roles` table, submit to the approval engine, activate on approval or delete on rejection. New workflow service in `access-control/`, new routes on the existing `AccessControlController`, new "Create Role" modal on `RolesPage`.

**Tech Stack:** NestJS + Prisma + SQLite (backend), React (admin-web)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add 3 fields to Role model |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Modify | Add action type + default policy |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Modify | Add workflow type + audit actions |
| `src/modules/identity/access-control/rbac.catalog.ts` | Modify | Add `IAM_ROLE_DEFINE` permission group + type union member + route definitions + CISO/TECH_OFFICER bindings |
| `src/modules/identity/access-control/role-definition-create-workflow.service.ts` | Create | Workflow service: initiate, execute, cancel |
| `src/modules/identity/access-control/access-control.controller.ts` | Modify | Add 2 new routes |
| `src/modules/identity/access-control/access-control.service.ts` | Modify | Relax `listRoles` filter, add `listPermissionGroups` |
| `src/modules/identity/access-control/access-control.module.ts` | Modify | Register new service |
| `admin-web/src/rbac/permissions.ts` | Modify | Add new permission constants |
| `admin-web/src/pages/RolesPage.tsx` | Modify | Add Create Role button + modal |

---

### Task 1: Prisma Schema — Add Fields to Role Model

**Files:**
- Modify: `prisma/schema.prisma` (Role model, lines ~49-61)

- [ ] **Step 1: Add 3 new fields to the Role model**

In `prisma/schema.prisma`, find the `Role` model. Add these fields before the relation fields:

```prisma
model Role {
  id                      String           @id @default(uuid())
  code                    String           @unique
  name                    String
  description             String?
  status                  String           @default("ACTIVE")
  approvalCaseId          String?
  approvalCaseNo          String?
  proposedPermissionGroups String?
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt
  rolePermissions         RolePermission[]
  userRoles               UserRole[]

  @@map("roles")
}
```

- [ ] **Step 2: Regenerate Prisma client and create migration**

```bash
npx prisma generate
npx prisma migrate dev --name add-role-approval-fields
```

Expected: Migration created. SQL adds 3 nullable columns to `roles` table.

- [ ] **Step 3: Verify migration SQL**

```bash
cat prisma/migrations/*add-role-approval-fields*/migration.sql
```

Expected: Contains `ALTER TABLE "roles" ADD COLUMN "approvalCaseId"`, `ADD COLUMN "approvalCaseNo"`, `ADD COLUMN "proposedPermissionGroups"`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore(prisma): add approval fields to Role model"
```

---

### Task 2: Backend Constants — Action Type, Audit Actions, Default Policy

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add ApprovalActionType**

In `approval.constants.ts`, add to the `ApprovalActionTypes` object (after the `APPROVAL_POLICY_CHANGE` line, ~line 50):

```typescript
ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE',
```

- [ ] **Step 2: Add default approval policy**

In `approval.constants.ts`, add to the `DEFAULT_APPROVAL_POLICIES` object (after the last IAM policy entry):

```typescript
[ApprovalActionTypes.ROLE_DEFINITION_CREATE]: {
  riskLevel: ApprovalRiskLevels.HIGH,
  steps: [{ stepNo: 1, roles: ['CISO'] }],
  timeoutHours: 48,
  allowCancel: true,
  allowRetry: false,
},
```

- [ ] **Step 3: Add AuditBusinessWorkflowTypes entry**

In `audit-actions.constant.ts`, add to the `AuditBusinessWorkflowTypes` object (after `ADMIN_CREDENTIAL_MGMT`, ~line 147):

```typescript
ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE',
```

- [ ] **Step 4: Add AuditGovernanceActions block**

In `audit-actions.constant.ts`, add to the `AuditGovernanceActions` object (after the last existing block):

```typescript
ROLE_DEFINITION: {
  CREATE_REQUESTED:     'CREATE_REQUESTED',
  APPROVAL_GRANTED:     'APPROVAL_GRANTED',
  APPROVAL_DECLINED:    'APPROVAL_DECLINED',
  APPROVAL_CANCELLED:   'APPROVAL_CANCELLED',
  ROLE_ACTIVATED:       'ROLE_ACTIVATED',
  ROLE_ACTIVATE_FAILED: 'ROLE_ACTIVATE_FAILED',
  CREATE_CANCELLED:     'CREATE_CANCELLED',
},
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(constants): add ROLE_DEFINITION_CREATE action type, policy, and audit actions"
```

---

### Task 3: RBAC Catalog — Add Permission Group and Route Definitions

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Add `IAM_ROLE_DEFINE` to the PermissionGroup type union**

In `rbac.catalog.ts`, find the `PermissionGroup` type (line 9). Add `'IAM_ROLE_DEFINE'` after `'IAM_CREDENTIAL_RESET'` (~line 13):

```typescript
| 'IAM_ROLE_DEFINE'
```

- [ ] **Step 2: Add route permission definitions**

In `rbac.catalog.ts`, find the RBAC_PERMISSION_DEFINITIONS array. Add these two entries in the IAM section (after the existing IAM routes):

```typescript
route('POST', '/admin/iam/role-definitions', 'Create role definition request', ['IAM_ROLE_DEFINE']),
route('GET', '/admin/iam/role-definitions/permission-groups', 'List available permission groups', ['IAM_ROLE_DEFINE']),
```

- [ ] **Step 3: Add IAM_ROLE_DEFINE to CISO and TECH_OFFICER role bindings**

In `rbac.catalog.ts`, find `RBAC_ROLE_GROUP_BINDINGS`. Add `'IAM_ROLE_DEFINE'` to the CISO array (after `'IAM_CREDENTIAL_RESET'`) and to the TECH_OFFICER array (after `'IAM_CREDENTIAL_RESET'`).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): add IAM_ROLE_DEFINE permission group for role definition workflow"
```

---

### Task 4: Backend Service — Workflow + listPermissionGroups

**Files:**
- Create: `src/modules/identity/access-control/role-definition-create-workflow.service.ts`
- Modify: `src/modules/identity/access-control/access-control.service.ts`

- [ ] **Step 1: Add `listPermissionGroups` method to AccessControlService**

In `access-control.service.ts`, add a new method that returns the list of available permission groups with their permission counts. Read the method body carefully — it derives the list from `RBAC_PERMISSION_DEFINITIONS`:

```typescript
listPermissionGroups() {
  const groupMap = new Map<string, { code: string; permissionCount: number }>();

  for (const perm of RBAC_PERMISSION_DEFINITIONS) {
    for (const group of perm.groups) {
      const existing = groupMap.get(group);
      if (existing) {
        existing.permissionCount++;
      } else {
        groupMap.set(group, { code: group, permissionCount: 1 });
      }
    }
  }

  return Array.from(groupMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}
```

Add `RBAC_PERMISSION_DEFINITIONS` to the imports from `./rbac.catalog` if not already imported.

- [ ] **Step 2: Relax `listRoles` status filter**

In `access-control.service.ts`, find the `listRoles()` method (~line 87). Change the `where` clause:

Before:
```typescript
where: {
  status: 'ACTIVE',
  code: { in: ACTIVE_RBAC_ROLE_CODES },
},
```

After:
```typescript
where: {
  status: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
},
```

This removes the `code: { in: ACTIVE_RBAC_ROLE_CODES }` filter so dynamically created roles also appear, and adds `PENDING_APPROVAL` to the status filter.

- [ ] **Step 3: Create the workflow service file**

Create `src/modules/identity/access-control/role-definition-create-workflow.service.ts`:

```typescript
import { Injectable, BadRequestException, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditGovernanceActions,
  AuditSubjectRole,
} from '../../audit-logging/constants/audit-actions.constant';
import { RBAC_PERMISSION_DEFINITIONS, type PermissionGroup } from './rbac.catalog';

const ROLE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,48}$/;

const VALID_PERMISSION_GROUPS = new Set<string>(
  RBAC_PERMISSION_DEFINITIONS.flatMap((p) => p.groups),
);

interface CreateRoleDefinitionDto {
  roleCode: string;
  roleName: string;
  description?: string;
  permissionGroupCodes: string[];
  changeReason: string;
}

interface ApprovalActorContext {
  userId: string;
  userNo?: string;
  email?: string;
  roleCodes?: string[];
}

const SECONDARY_EVENT = 'workflow.role-definition-create.decided';

@Injectable()
export class RoleDefinitionCreateWorkflowService {
  private readonly logger = new Logger(RoleDefinitionCreateWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiateCreate(dto: CreateRoleDefinitionDto, actor: ApprovalActorContext) {
    const roleCode = dto.roleCode.trim().toUpperCase();
    const roleName = dto.roleName.trim();
    const description = dto.description?.trim() || null;
    const permissionGroupCodes = dto.permissionGroupCodes;
    const changeReason = dto.changeReason.trim();

    if (!ROLE_CODE_REGEX.test(roleCode)) {
      throw new BadRequestException(
        'roleCode must be uppercase letters, digits, and underscores (2-49 chars), starting with a letter',
      );
    }
    if (!roleName) {
      throw new BadRequestException('roleName is required');
    }
    if (!permissionGroupCodes || permissionGroupCodes.length === 0) {
      throw new BadRequestException('At least one permission group is required');
    }
    if (!changeReason) {
      throw new BadRequestException('changeReason is required');
    }

    const invalidGroups = permissionGroupCodes.filter((g) => !VALID_PERMISSION_GROUPS.has(g));
    if (invalidGroups.length > 0) {
      throw new BadRequestException(`Invalid permission groups: ${invalidGroups.join(', ')}`);
    }

    const existing = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (existing) {
      throw new BadRequestException(`Role code '${roleCode}' already exists`);
    }

    const traceId = crypto.randomUUID();

    const role = await this.prisma.role.create({
      data: {
        code: roleCode,
        name: roleName,
        description,
        status: 'PENDING_APPROVAL',
        proposedPermissionGroups: JSON.stringify(permissionGroupCodes),
      },
    });

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ROLE_DEFINITION_CREATE,
          entityRef: role.id,
          workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
          workflowId: role.id,
          workflowNo: roleCode,
          traceId,
          objectSnapshot: {
            roleCode,
            roleName,
            description,
            permissionGroupCodes,
            status: 'PENDING_APPROVAL',
          },
        },
        {
          reason: changeReason,
          traceId,
        },
        actor,
      );
    } catch (err) {
      await this.prisma.role.delete({ where: { id: role.id } });
      throw err;
    }

    await this.prisma.role.update({
      where: { id: role.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.record({
      action: AuditGovernanceActions.ROLE_DEFINITION.CREATE_REQUESTED,
      result: 'SUCCESS',
      actorUserId: actor.userId,
      actorUserNo: actor.userNo,
      resourceType: 'ROLE',
      resourceId: role.id,
      resourceNo: roleCode,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
      workflowId: role.id,
      workflowNo: roleCode,
      traceId,
      subjects: [
        {
          subjectRole: AuditSubjectRole.TARGET,
          subjectType: 'ROLE',
          subjectId: role.id,
          subjectNo: roleCode,
        },
      ],
      metadata: {
        roleName,
        permissionGroupCodes,
        changeReason,
        approvalNo: approvalCase.approvalNo,
      },
    });

    return {
      roleCode,
      roleName,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Role definition create decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision);
    }
  }

  private async executeActivation(approvalId: string, roleId: string) {
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role || role.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Role ${roleId} not found or not in PENDING_APPROVAL status`);
        await this.approvalsService.markExecutionResult(approvalId, false, 'Role not found or wrong status');
        return;
      }

      const groupCodes: string[] = JSON.parse(role.proposedPermissionGroups || '[]');

      const permissionCodes = RBAC_PERMISSION_DEFINITIONS
        .filter((p) => p.groups.some((g) => groupCodes.includes(g)))
        .map((p) => p.code);

      const uniqueCodes = [...new Set(permissionCodes)];

      const permissions = await this.prisma.permission.findMany({
        where: { code: { in: uniqueCodes } },
        select: { id: true, code: true },
      });

      if (permissions.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: permissions.map((p: any) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
          skipDuplicates: true,
        });
      }

      await this.prisma.role.update({
        where: { id: role.id },
        data: {
          status: 'ACTIVE',
          proposedPermissionGroups: null,
        },
      });

      await this.approvalsService.markExecutionResult(approvalId, true);

      await this.auditLogsService.record({
        action: AuditGovernanceActions.ROLE_DEFINITION.ROLE_ACTIVATED,
        result: 'SUCCESS',
        resourceType: 'ROLE',
        resourceId: role.id,
        resourceNo: role.code,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        workflowId: role.id,
        workflowNo: role.code,
        metadata: {
          permissionGroupCodes: groupCodes,
          permissionsWritten: uniqueCodes.length,
        },
      });

      this.logger.log(`Role ${role.code} activated with ${uniqueCodes.length} permissions`);
    } catch (err: any) {
      this.logger.error(`Failed to activate role ${roleId}: ${err.message}`);
      await this.approvalsService.markExecutionResult(approvalId, false, err.message);

      await this.auditLogsService.record({
        action: AuditGovernanceActions.ROLE_DEFINITION.ROLE_ACTIVATE_FAILED,
        result: 'FAILURE',
        resourceType: 'ROLE',
        resourceId: roleId,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        workflowId: roleId,
        metadata: { error: err.message },
      });
    }
  }

  private async executeCancellation(approvalId: string, roleId: string, decision: string) {
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        this.logger.warn(`Role ${roleId} not found for cancellation`);
        return;
      }

      await this.prisma.role.delete({ where: { id: role.id } });

      await this.auditLogsService.record({
        action: AuditGovernanceActions.ROLE_DEFINITION.CREATE_CANCELLED,
        result: 'SUCCESS',
        resourceType: 'ROLE',
        resourceId: role.id,
        resourceNo: role.code,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        workflowId: role.id,
        workflowNo: role.code,
        metadata: { decision },
      });

      this.logger.log(`Role ${role.code} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel role creation ${roleId}: ${err.message}`);
    }
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors (the service won't be wired yet, but the file should compile standalone).

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/role-definition-create-workflow.service.ts src/modules/identity/access-control/access-control.service.ts
git commit -m "feat(iam): add RoleDefinitionCreateWorkflowService and listPermissionGroups"
```

---

### Task 5: Backend Controller — Add Routes

**Files:**
- Modify: `src/modules/identity/access-control/access-control.controller.ts`

- [ ] **Step 1: Add imports and inject the workflow service**

In `access-control.controller.ts`, add the import:

```typescript
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
```

Add it to the constructor:

```typescript
constructor(
  private readonly accessControlService: AccessControlService,
  private readonly roleDefinitionCreateWorkflow: RoleDefinitionCreateWorkflowService,
) {}
```

- [ ] **Step 2: Add the POST route for creating a role definition**

Add this route to the controller (after the existing routes):

```typescript
@Post('role-definitions')
@RequirePermissions(buildPermissionCode('POST', '/admin/iam/role-definitions'))
@ApiOperation({ summary: 'Initiate role definition create approval' })
createRoleDefinition(@Req() req: any, @Body() body: any) {
  return this.roleDefinitionCreateWorkflow.initiateCreate(body, this.ensureAdmin(req));
}
```

If the controller doesn't have an `ensureAdmin` method, check how other controllers build the actor context. Use the same pattern — typically it's extracted from `req.user`:

```typescript
private ensureAdmin(req: any): { userId: string; userNo?: string; email?: string; roleCodes?: string[] } {
  const user = req.user;
  if (!user?.sub) throw new UnauthorizedException();
  return { userId: user.sub, userNo: user.userNo, email: user.username, roleCodes: user.roleCodes };
}
```

- [ ] **Step 3: Add the GET route for listing permission groups**

```typescript
@Get('role-definitions/permission-groups')
@RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definitions/permission-groups'))
@ApiOperation({ summary: 'List available permission groups for role creation' })
listPermissionGroups() {
  return this.accessControlService.listPermissionGroups();
}
```

**Important:** This route MUST be defined BEFORE any `@Get(':id')` route in the controller, otherwise Express will match `permission-groups` as an `:id` parameter.

- [ ] **Step 4: Add necessary imports**

Ensure `Post`, `Body`, `UnauthorizedException` are imported from `@nestjs/common`, and `buildPermissionCode` from wherever the other routes import it.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/access-control/access-control.controller.ts
git commit -m "feat(iam): add role definition create and permission-groups routes"
```

---

### Task 6: Module Registration

**Files:**
- Modify: `src/modules/identity/access-control/access-control.module.ts`

- [ ] **Step 1: Register the workflow service**

In `access-control.module.ts`, add the import and provider:

```typescript
import { RoleDefinitionCreateWorkflowService } from './role-definition-create-workflow.service';
```

Add to providers:

```typescript
@Module({
  providers: [AccessControlService, AdminPermissionGuard, RoleDefinitionCreateWorkflowService],
  controllers: [AccessControlController],
  exports: [AccessControlService, AdminPermissionGuard],
})
```

- [ ] **Step 2: Check if ApprovalsModule and AuditLoggingModule are imported**

The workflow service depends on `ApprovalsService` and `AuditLogsService`. Check if `AccessControlModule` already imports these modules. If not, add them:

```typescript
imports: [forwardRef(() => ApprovalsModule), AuditLoggingModule],
```

Use `forwardRef` if there's a circular dependency (approvals → access-control → approvals).

- [ ] **Step 3: Verify TypeScript compiles and the app starts**

```bash
npx tsc --noEmit
npm run build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/access-control/access-control.module.ts
git commit -m "feat(iam): register RoleDefinitionCreateWorkflowService in module"
```

---

### Task 7: Frontend — Permission Constants + Create Role Modal

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/pages/RolesPage.tsx`

- [ ] **Step 1: Add frontend permission constants**

In `admin-web/src/rbac/permissions.ts`, add:

```typescript
IAM_ROLE_DEFINITIONS_CREATE: 'api.post.admin_iam_role-definitions',
IAM_ROLE_DEFINITIONS_PERMISSION_GROUPS: 'api.get.admin_iam_role-definitions_permission-groups',
```

- [ ] **Step 2: Add Create Role button and modal to RolesPage**

In `admin-web/src/pages/RolesPage.tsx`, add the following changes:

**Add imports** at top of file:

```typescript
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';
```

**Add state variables** inside the component (after existing state):

```typescript
const { hasPermission } = useAdminSession();
const canCreate = hasPermission(PERMISSIONS.IAM_ROLE_DEFINITIONS_CREATE);

const [showCreateModal, setShowCreateModal] = useState(false);
const [createCode, setCreateCode] = useState('');
const [createName, setCreateName] = useState('');
const [createDescription, setCreateDescription] = useState('');
const [createGroups, setCreateGroups] = useState<string[]>([]);
const [createReason, setCreateReason] = useState('');
const [createError, setCreateError] = useState('');
const [createLoading, setCreateLoading] = useState(false);
const [permissionGroups, setPermissionGroups] = useState<Array<{ code: string; permissionCount: number }>>([]);
```

**Add permission groups fetch** (inside a useEffect or when modal opens):

```typescript
useEffect(() => {
  if (!showCreateModal) return;
  api.get('/admin/iam/role-definitions/permission-groups')
    .then((res) => setPermissionGroups(res.data))
    .catch(() => {});
}, [showCreateModal]);
```

**Add submit handler:**

```typescript
const submitCreate = async () => {
  setCreateError('');
  const code = createCode.trim().toUpperCase();
  const name = createName.trim();
  const reason = createReason.trim();
  if (!code || !name || createGroups.length === 0 || !reason) {
    setCreateError('All fields except description are required');
    return;
  }
  setCreateLoading(true);
  try {
    const res = await api.post('/admin/iam/role-definitions', {
      roleCode: code,
      roleName: name,
      description: createDescription.trim() || undefined,
      permissionGroupCodes: createGroups,
      changeReason: reason,
    });
    setShowCreateModal(false);
    setCreateCode(''); setCreateName(''); setCreateDescription('');
    setCreateGroups([]); setCreateReason('');
    fetchRoles();
    alert(`Role creation submitted. Approval: ${res.data.approvalNo}`);
  } catch (err: any) {
    setCreateError(err?.response?.data?.message || 'Failed to submit');
  } finally {
    setCreateLoading(false);
  }
};
```

**Add "Create Role" button** in the header area (near the filter controls):

```tsx
{canCreate && (
  <button
    className={adminButtonClass}
    onClick={() => setShowCreateModal(true)}
  >
    + Create Role
  </button>
)}
```

**Add modal** at the end of the component (before the closing fragment/div). Follow the same pattern used in `PlatformMembers.tsx`:

```tsx
{showCreateModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="w-full max-w-lg rounded-lg border border-adm-border bg-adm-bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-adm-border px-6 py-4">
        <h2 className="text-sm font-semibold text-adm-t1">Create Role</h2>
        <button onClick={() => setShowCreateModal(false)} className="text-adm-t3 hover:text-adm-t1">&times;</button>
      </div>
      <div className="space-y-4 px-6 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-adm-t2">Role Code</label>
          <input
            className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-xs text-adm-t1 uppercase"
            value={createCode}
            onChange={(e) => setCreateCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder="e.g. RISK_ANALYST"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-adm-t2">Role Name</label>
          <input
            className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 text-xs text-adm-t1"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. Risk Analyst"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-adm-t2">Description (optional)</label>
          <input
            className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 text-xs text-adm-t1"
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-adm-t2">Permission Groups</label>
          <div className="max-h-48 overflow-y-auto rounded border border-adm-border bg-adm-bg p-2">
            {permissionGroups.map((g) => (
              <label key={g.code} className="flex items-center gap-2 px-1 py-0.5 text-xs text-adm-t1">
                <input
                  type="checkbox"
                  checked={createGroups.includes(g.code)}
                  onChange={(e) => {
                    setCreateGroups((prev) =>
                      e.target.checked ? [...prev, g.code] : prev.filter((c) => c !== g.code),
                    );
                  }}
                />
                <span className="font-mono">{g.code}</span>
                <span className="text-adm-t3">({g.permissionCount})</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-adm-t2">Change Reason</label>
          <textarea
            className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 text-xs text-adm-t1"
            rows={2}
            value={createReason}
            onChange={(e) => setCreateReason(e.target.value)}
          />
        </div>
        {createError && <p className="text-xs text-red-500">{createError}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-adm-border px-6 py-3">
        <button
          className="rounded border border-adm-border px-4 py-1.5 text-xs text-adm-t2 hover:bg-adm-bg"
          onClick={() => setShowCreateModal(false)}
        >
          Cancel
        </button>
        <button
          className={adminButtonClass}
          onClick={submitCreate}
          disabled={createLoading}
        >
          {createLoading ? 'Submitting...' : 'Submit for Approval'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify frontend TypeScript compiles**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/pages/RolesPage.tsx
git commit -m "feat(admin-web): add Create Role button and modal to RolesPage"
```

---

### Task 8: Seed — Register RBAC Permissions

**Files:**
- No new files — the seed script reads from `rbac.catalog.ts` automatically

- [ ] **Step 1: Run seed to register new permissions in the DB**

The new route permissions (`POST /admin/iam/role-definitions`, `GET /admin/iam/role-definitions/permission-groups`) need to exist in the `permissions` table. The seed script reads `RBAC_PERMISSION_DEFINITIONS` and upserts them.

However, the seed has a pre-existing TypeScript error (`checkerRoles` on `PolicyStepConfig`). If `npm run dev:rebuild` fails due to this, use the apply-migrations-only approach:

```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate deploy
```

Then manually insert the permissions if the seed can't run. Alternatively, the `ApprovalsService` governance demo bootstrap or the first `npm run build && node dist/main` may handle RBAC sync on startup — check if `seedRbac` runs on application boot.

If neither works, manually insert via SQLite:

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "
INSERT OR IGNORE INTO permissions (id, code, name, description, method, path, createdAt, updatedAt)
VALUES
  (lower(hex(randomblob(16))), 'api.post.admin_iam_role-definitions', 'Create role definition request', 'Create role definition request', 'POST', '/admin/iam/role-definitions', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'api.get.admin_iam_role-definitions_permission-groups', 'List available permission groups', 'List available permission groups', 'GET', '/admin/iam/role-definitions/permission-groups', datetime('now'), datetime('now'));
"
```

Then create the role_permission bindings for CISO and TECH_OFFICER for these new permissions.

- [ ] **Step 2: Verify the backend starts and routes are accessible**

```bash
npm run build
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" node dist/main
```

Test the permission-groups endpoint:

```bash
TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
curl -s http://localhost:3500/admin/iam/role-definitions/permission-groups -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
```

Expected: JSON array of permission groups with codes and counts.

- [ ] **Step 3: Commit (if any manual seed fixups were needed)**

```bash
git add -A
git commit -m "chore(seed): register IAM_ROLE_DEFINE permissions in database"
```

---

### Task 9: Smoke Test — End-to-End Verification

- [ ] **Step 1: Restart the full dev stack**

```bash
npm run dev:stop
npm run dev:start
```

Or if dev:start has seed issues, start manually:

```bash
npm run build
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" API_PORT=3500 node dist/main
```

- [ ] **Step 2: Test Create Role API**

```bash
TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -s -X POST http://localhost:3500/admin/iam/role-definitions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleCode":"RISK_ANALYST","roleName":"Risk Analyst","description":"Handles risk assessments","permissionGroupCodes":["RISK_DECISION_RECORD_READ","ALERT_READ"],"changeReason":"New role for risk team"}' \
  | python3 -m json.tool
```

Expected: `{ "roleCode": "RISK_ANALYST", "roleName": "Risk Analyst", "approvalNo": "APR...", "status": "PENDING_APPROVAL" }`

- [ ] **Step 3: Verify the role exists in DB with PENDING_APPROVAL status**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT code, name, status, proposedPermissionGroups FROM roles WHERE code='RISK_ANALYST';"
```

Expected: `RISK_ANALYST|Risk Analyst|PENDING_APPROVAL|["RISK_DECISION_RECORD_READ","ALERT_READ"]`

- [ ] **Step 4: Approve the role creation**

```bash
APPROVAL_NO=$(curl -s -X POST http://localhost:3500/admin/iam/role-definitions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleCode":"TEST_ROLE_APPROVE","roleName":"Test Approve","permissionGroupCodes":["BASE_ACCESS"],"changeReason":"Test approval flow"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["approvalNo"])')

echo "Approval: $APPROVAL_NO"
```

Then approve it (login as CISO who has approval-decide permission):

```bash
CISO_TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"ciso@fiatx.com","password":"123456"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -s -X POST "http://localhost:3500/admin/control-gates/approvals/${APPROVAL_NO}/approve" \
  -H "Authorization: Bearer $CISO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Approved for testing"}' | python3 -m json.tool
```

- [ ] **Step 5: Verify the role is now ACTIVE with permissions**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT code, status, proposedPermissionGroups FROM roles WHERE code='TEST_ROLE_APPROVE';"
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM role_permissions WHERE roleId = (SELECT id FROM roles WHERE code='TEST_ROLE_APPROVE');"
```

Expected: Status is `ACTIVE`, `proposedPermissionGroups` is null, permission count > 0.

- [ ] **Step 6: Verify the role appears in the RolesPage list**

Open `http://localhost:3501` in browser, navigate to Roles page. Verify:
- The new role appears in the list
- PENDING_APPROVAL roles show with appropriate badge
- ACTIVE roles show normally

- [ ] **Step 7: Test the Create Role modal in the frontend**

Click "Create Role" button, fill in the form, submit. Verify the approval is created and the role appears in the list with PENDING_APPROVAL status.

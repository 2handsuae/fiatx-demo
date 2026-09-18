# Role Definition Modify Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow operators to modify an existing ACTIVE role's capabilities, name, and description through a CISO-approval-gated workflow.

**Architecture:** A separate `RoleDefinitionModifyRequest` table stores current/proposed state snapshots. The three-service pattern (WorkflowService + ApprovalHandlerService + Controller) mirrors the existing Create Role flow. The Role stays ACTIVE throughout; changes apply only after approval.

**Tech Stack:** NestJS, Prisma, SQLite, React (admin-web)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add `RoleDefinitionModifyRequest` model |
| `prisma/migrations/20260509...` | Migration SQL |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Add `ROLE_DEFINITION_MODIFY` actionType + default policy |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add 4 audit actions + workflow type |
| `src/modules/identity/access-control/rbac.catalog.ts` | Add 3 routes, update bucket label |
| `src/modules/identity/access-control/role-definition-modify-workflow.service.ts` | **New** — initiate + execute modify |
| `src/modules/identity/access-control/role-definition-modify-approval.service.ts` | **New** — approval event bridge |
| `src/modules/identity/access-control/access-control.controller.ts` | Add 3 endpoints |
| `src/modules/identity/access-control/access-control.service.ts` | Add query methods |
| `src/modules/identity/access-control/access-control.module.ts` | Register new providers |
| `admin-web/src/rbac/permissions.ts` | Add 3 permission constants |
| `admin-web/src/pages/RoleDetailPage.tsx` | Add Modify button + modal |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260509200000_add_role_definition_modify_requests/migration.sql`

- [ ] **Step 1: Add RoleDefinitionModifyRequest model to schema.prisma**

Add after the existing `Role` model block (after `@@map("roles")` closing brace):

```prisma
model RoleDefinitionModifyRequest {
  id                       String    @id @default(uuid())
  requestNo                String    @unique @default("TEMP")
  roleId                   String
  currentName              String
  currentDescription       String?
  currentPermissionGroups  String
  proposedName             String
  proposedDescription      String?
  proposedPermissionGroups String
  changeReason             String
  status                   String    @default("PENDING_APPROVAL")
  approvalCaseId           String?
  approvalCaseNo           String?
  requestedByUserId        String
  executedAt               DateTime?
  failureReason            String?
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  role Role @relation(fields: [roleId], references: [id])

  @@index([roleId, status])
  @@map("role_definition_modify_requests")
}
```

Also add the reverse relation on the `Role` model — add this line inside the `Role` model block, after `userRoles`:

```prisma
  modifyRequests           RoleDefinitionModifyRequest[]
```

- [ ] **Step 2: Create migration SQL**

Create directory `prisma/migrations/20260509200000_add_role_definition_modify_requests/` and file `migration.sql`:

```sql
-- CreateTable
CREATE TABLE "role_definition_modify_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "roleId" TEXT NOT NULL,
    "currentName" TEXT NOT NULL,
    "currentDescription" TEXT,
    "currentPermissionGroups" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "proposedDescription" TEXT,
    "proposedPermissionGroups" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "role_definition_modify_requests_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "role_definition_modify_requests_requestNo_key" ON "role_definition_modify_requests"("requestNo");

-- CreateIndex
CREATE INDEX "role_definition_modify_requests_roleId_status_idx" ON "role_definition_modify_requests"("roleId", "status");
```

- [ ] **Step 3: Generate Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Apply migration**

Run: `npx prisma migrate deploy`
Expected: `1 migration applied`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260509200000_add_role_definition_modify_requests/
git commit -m "feat(schema): add RoleDefinitionModifyRequest model for role modify workflow"
```

---

### Task 2: Approval + audit constants

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add ROLE_DEFINITION_MODIFY to ApprovalActionTypes**

In `approval.constants.ts`, add after the `ROLE_DEFINITION_CREATE` entry (line 52):

```typescript
  ROLE_DEFINITION_MODIFY: 'ROLE_DEFINITION_MODIFY',
```

- [ ] **Step 2: Add default approval policy**

In `DEFAULT_APPROVAL_POLICIES`, add after the `ROLE_DEFINITION_CREATE` policy block:

```typescript
  [ApprovalActionTypes.ROLE_DEFINITION_MODIFY]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Add to V1_APPROVAL_ACTION_TYPES**

In the `V1_APPROVAL_ACTION_TYPES` array, add after the last entry:

```typescript
  ApprovalActionTypes.ROLE_DEFINITION_CREATE,
  ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
```

- [ ] **Step 4: Add AuditBusinessWorkflowTypes entry**

In `audit-actions.constant.ts`, in `AuditBusinessWorkflowTypes`, add after `ROLE_DEFINITION_CREATE`:

```typescript
  ROLE_DEFINITION_MODIFY: 'ROLE_DEFINITION_MODIFY',
```

- [ ] **Step 5: Add audit actions under ROLE_DEFINITION**

In `AuditGovernanceActions.ROLE_DEFINITION`, add after `CREATE_CANCELLED`:

```typescript
    MODIFY_REQUESTED:     'MODIFY_REQUESTED',
    ROLE_MODIFIED:        'ROLE_MODIFIED',
    ROLE_MODIFY_FAILED:   'ROLE_MODIFY_FAILED',
    MODIFY_CANCELLED:     'MODIFY_CANCELLED',
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(constants): add ROLE_DEFINITION_MODIFY approval action type and audit actions"
```

---

### Task 3: Backend routes + action bucket update + frontend permissions

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Add 3 route entries to RBAC_PERMISSION_DEFINITIONS**

In `rbac.catalog.ts`, after the existing role-definition routes (the `POST /admin/iam/role-definitions` and `GET /admin/iam/role-definitions/permission-groups` lines), add:

```typescript
  route('POST', '/admin/iam/role-definitions/:roleId/modify', 'Submit role definition modify request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definition-modify-requests', 'List role definition modify requests', ['IAM_READ']),
  route('GET', '/admin/iam/role-definition-modify-requests/:id', 'Get role definition modify request detail', ['IAM_READ']),
```

- [ ] **Step 2: Update iam.define_roles bucket label**

In `ACTION_BUCKET_CATALOG`, find the `iam.define_roles` bucket and update:

```typescript
{
  key: 'iam.define_roles',
  label: 'Manage role definitions',
  description: 'Propose new role definitions or modify existing ones for approval',
  groups: ['IAM_ROLE_DEFINE'],
},
```

- [ ] **Step 3: Add frontend permission constants**

In `admin-web/src/rbac/permissions.ts`, after `IAM_ROLE_DEFINITIONS_CREATE`, add:

```typescript
  IAM_ROLE_DEFINITIONS_MODIFY: 'api.post.admin_iam_role_definitions_id_modify',
  IAM_ROLE_DEFINITION_MODIFY_REQUESTS_READ: 'api.get.admin_iam_role_definition_modify_requests',
  IAM_ROLE_DEFINITION_MODIFY_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_definition_modify_requests_id',
```

- [ ] **Step 4: Verify TypeScript compiles (both backend and frontend)**

Run: `npx tsc --noEmit && cd admin-web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts admin-web/src/rbac/permissions.ts
git commit -m "feat(rbac): add role definition modify routes and update action bucket label"
```

---

### Task 4: Role Definition Modify Approval Handler Service

**Files:**
- Create: `src/modules/identity/access-control/role-definition-modify-approval.service.ts`

- [ ] **Step 1: Create the approval handler service**

Create `src/modules/identity/access-control/role-definition-modify-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';

@Injectable()
export class RoleDefinitionModifyApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ROLE_DEFINITION_MODIFY;
  readonly workflowType = AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY;
  readonly auditActions = {
    granted: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ACCESS_CONTROL;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/access-control/role-definition-modify-approval.service.ts
git commit -m "feat(iam): add RoleDefinitionModifyApprovalService extending ApprovalHandlerBase"
```

---

### Task 5: Role Definition Modify Workflow Service

**Files:**
- Create: `src/modules/identity/access-control/role-definition-modify-workflow.service.ts`

- [ ] **Step 1: Create the workflow service**

Create `src/modules/identity/access-control/role-definition-modify-workflow.service.ts`:

```typescript
import { Injectable, BadRequestException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { RBAC_PERMISSION_DEFINITIONS, type PermissionGroup } from './rbac.catalog';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const VALID_PERMISSION_GROUPS = new Set<string>(
  RBAC_PERMISSION_DEFINITIONS.flatMap((p) => p.groups),
);

interface ModifyRoleDefinitionDto {
  proposedName: string;
  proposedDescription?: string;
  proposedPermissionGroups: string[];
  changeReason: string;
}

const SECONDARY_EVENT = 'workflow.role-definition-modify.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class RoleDefinitionModifyWorkflowService {
  private readonly logger = new Logger(RoleDefinitionModifyWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /* ── Initiate ── */

  async initiateModify(
    roleId: string,
    dto: ModifyRoleDefinitionDto,
    actor: ApprovalActorContext,
  ) {
    const { proposedName, proposedDescription, proposedPermissionGroups, changeReason } = dto;

    /* Validate inputs */
    if (!proposedName?.trim()) {
      throw new BadRequestException('proposedName is required.');
    }
    if (!proposedPermissionGroups?.length) {
      throw new BadRequestException('proposedPermissionGroups must be non-empty.');
    }
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required.');
    }
    const invalidGroups = proposedPermissionGroups.filter((g) => !VALID_PERMISSION_GROUPS.has(g));
    if (invalidGroups.length > 0) {
      throw new BadRequestException(`Invalid permission groups: ${invalidGroups.join(', ')}`);
    }

    /* Load role */
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }
    if (role.status !== 'ACTIVE') {
      throw new BadRequestException(`Role must be ACTIVE to modify. Current status: ${role.status}`);
    }

    /* Check no pending modify request exists */
    const pendingRequest = await this.prisma.roleDefinitionModifyRequest.findFirst({
      where: { roleId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new BadRequestException(
        `Role ${role.code} already has a pending modify request: ${pendingRequest.requestNo}`,
      );
    }

    /* Derive current permission groups from existing RolePermission rows */
    const currentGroupsSet = new Set<string>();
    for (const rp of role.rolePermissions) {
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === rp.permission.code);
      if (def) {
        for (const g of def.groups) currentGroupsSet.add(g);
      }
    }
    const currentPermissionGroups = Array.from(currentGroupsSet).sort();

    /* Create request record */
    const requestNo = generateReferenceNo('RDM-');
    const request = await this.prisma.roleDefinitionModifyRequest.create({
      data: {
        requestNo,
        roleId,
        currentName: role.name,
        currentDescription: role.description,
        currentPermissionGroups: JSON.stringify(currentPermissionGroups),
        proposedName: proposedName.trim(),
        proposedDescription: proposedDescription?.trim() || null,
        proposedPermissionGroups: JSON.stringify(proposedPermissionGroups),
        changeReason: changeReason.trim(),
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    /* Create and submit approval case */
    const traceId = `rdm-${request.id}`;
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
          entityRef: request.id,
          workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
          workflowId: request.id,
          workflowNo: requestNo,
          traceId,
          objectSnapshot: {
            roleCode: role.code,
            currentName: role.name,
            currentDescription: role.description,
            currentPermissionGroups,
            proposedName: proposedName.trim(),
            proposedDescription: proposedDescription?.trim() || null,
            proposedPermissionGroups,
          },
        },
        { reason: changeReason.trim(), traceId },
        actor,
      );
    } catch (err) {
      /* Rollback: delete request record */
      await this.prisma.roleDefinitionModifyRequest.delete({ where: { id: request.id } });
      throw err;
    }

    /* Link approval case back to request */
    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.caseNo,
      },
    });

    /* Audit */
    await this.auditLogsService.record({
      action: AuditGovernanceActions.ROLE_DEFINITION.MODIFY_REQUESTED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      subjectNo: requestNo,
      subjectRole: AuditSubjectRole.OPERATOR,
      result: AuditResult.SUCCESS,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      workflowId: request.id,
      traceId,
      operatorUserId: actor.userId,
      detail: {
        roleCode: role.code,
        proposedName: proposedName.trim(),
        proposedPermissionGroups,
        approvalCaseNo: approvalCase.caseNo,
      },
    });

    return {
      requestNo,
      roleCode: role.code,
      approvalNo: approvalCase.caseNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /* ── Approval decided ── */

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn(`[onDecided] Missing approvalId or entityRef: ${JSON.stringify(payload)}`);
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeModification(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  /* ── Execute modification (on APPROVED) ── */

  private async executeModification(approvalId: string, requestId: string, payload: any) {
    const traceId = payload?.traceId || `rdm-exec-${requestId}`;

    const request = await this.prisma.roleDefinitionModifyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`[executeModification] Request ${requestId} not found or not PENDING_APPROVAL`);
      return;
    }

    const role = await this.prisma.role.findUnique({
      where: { id: request.roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role || role.status !== 'ACTIVE') {
      const reason = !role ? 'Role not found' : `Role status is ${role.status}`;
      await this.failRequest(request, approvalId, reason, traceId);
      return;
    }

    /* Conflict detection: derive current groups and compare */
    const actualGroupsSet = new Set<string>();
    for (const rp of role.rolePermissions) {
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === rp.permission.code);
      if (def) {
        for (const g of def.groups) actualGroupsSet.add(g);
      }
    }
    const actualGroups = Array.from(actualGroupsSet).sort();
    const snapshotGroups: string[] = JSON.parse(request.currentPermissionGroups);
    snapshotGroups.sort();

    if (JSON.stringify(actualGroups) !== JSON.stringify(snapshotGroups)) {
      const reason = `Conflict: role permissions changed since request was submitted. Expected groups: ${JSON.stringify(snapshotGroups)}, actual: ${JSON.stringify(actualGroups)}`;
      await this.failRequest(request, approvalId, reason, traceId);
      return;
    }

    /* Resolve proposed groups to permission codes */
    const proposedGroups: string[] = JSON.parse(request.proposedPermissionGroups);
    const proposedGroupSet = new Set<string>(proposedGroups);
    const permissionCodes = RBAC_PERMISSION_DEFINITIONS
      .filter((p) => p.groups.some((g) => proposedGroupSet.has(g)))
      .map((p) => p.code);

    /* Look up Permission records by code */
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    const permissionIdByCode = new Map(permissions.map((p: any) => [p.code, p.id]));

    /* Execute in transaction: delete old RolePermissions, create new, update Role */
    await this.prisma.$transaction(async (tx: any) => {
      /* Delete old RolePermission rows */
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });

      /* Create new RolePermission rows */
      const rpData = permissionCodes
        .filter((code) => permissionIdByCode.has(code))
        .map((code) => ({
          roleId: role.id,
          permissionId: permissionIdByCode.get(code)!,
        }));
      if (rpData.length > 0) {
        await tx.rolePermission.createMany({ data: rpData });
      }

      /* Update Role name/description */
      await tx.role.update({
        where: { id: role.id },
        data: {
          name: request.proposedName,
          description: request.proposedDescription,
        },
      });

      /* Mark request as APPROVED */
      await tx.roleDefinitionModifyRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          executedAt: new Date(),
        },
      });
    });

    /* Mark approval execution result */
    await this.approvalsService.markExecutionResult(
      approvalId,
      true,
      `Role ${role.code} modified successfully.`,
      SYSTEM_ACTOR,
    );

    /* Audit */
    await this.auditLogsService.record({
      action: AuditGovernanceActions.ROLE_DEFINITION.ROLE_MODIFIED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      subjectNo: request.requestNo,
      subjectRole: AuditSubjectRole.OPERATOR,
      result: AuditResult.SUCCESS,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      workflowId: request.id,
      traceId,
      operatorUserId: 'SYSTEM',
      detail: {
        roleCode: role.code,
        proposedName: request.proposedName,
        proposedPermissionGroups: JSON.parse(request.proposedPermissionGroups),
        permissionCount: rpData?.length ?? permissionCodes.length,
      },
    });

    this.logger.log(`[executeModification] Role ${role.code} modified via request ${request.requestNo}`);
  }

  /* ── Fail request (conflict or missing role) ── */

  private async failRequest(request: any, approvalId: string, reason: string, traceId: string) {
    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', failureReason: reason, executedAt: new Date() },
    });

    await this.approvalsService.markExecutionResult(approvalId, false, reason, SYSTEM_ACTOR);

    await this.auditLogsService.record({
      action: AuditGovernanceActions.ROLE_DEFINITION.ROLE_MODIFY_FAILED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      subjectNo: request.requestNo,
      subjectRole: AuditSubjectRole.OPERATOR,
      result: AuditResult.FAILURE,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      workflowId: request.id,
      traceId,
      operatorUserId: 'SYSTEM',
      detail: { failureReason: reason },
    });

    this.logger.warn(`[failRequest] Request ${request.requestNo} failed: ${reason}`);
  }

  /* ── Execute cancellation (on REJECTED / CANCELLED / EXPIRED) ── */

  private async executeCancellation(
    approvalId: string,
    requestId: string,
    decision: string,
    payload: any,
  ) {
    const traceId = payload?.traceId || `rdm-cancel-${requestId}`;

    const request = await this.prisma.roleDefinitionModifyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`[executeCancellation] Request ${requestId} not PENDING_APPROVAL`);
      return;
    }

    const newStatus = decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED';

    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: { status: newStatus },
    });

    await this.auditLogsService.record({
      action: AuditGovernanceActions.ROLE_DEFINITION.MODIFY_CANCELLED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      subjectNo: request.requestNo,
      subjectRole: AuditSubjectRole.OPERATOR,
      result: AuditResult.SUCCESS,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      workflowId: request.id,
      traceId,
      operatorUserId: 'SYSTEM',
      detail: { decision },
    });

    this.logger.log(`[executeCancellation] Request ${request.requestNo} ${newStatus}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/access-control/role-definition-modify-workflow.service.ts
git commit -m "feat(iam): add RoleDefinitionModifyWorkflowService with initiate, execute, and cancel"
```

---

### Task 6: Controller endpoints + service query methods + module registration

**Files:**
- Modify: `src/modules/identity/access-control/access-control.controller.ts`
- Modify: `src/modules/identity/access-control/access-control.service.ts`
- Modify: `src/modules/identity/access-control/access-control.module.ts`

- [ ] **Step 1: Add query methods to AccessControlService**

In `access-control.service.ts`, add these methods at the end of the class (before the closing brace):

```typescript
  /* ── Role Definition Modify Requests ── */

  async listRoleDefinitionModifyRequests(query: {
    roleId?: string;
    status?: string;
    take?: number;
    skip?: number;
  }) {
    const where: any = {};
    if (query.roleId) where.roleId = query.roleId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).roleDefinitionModifyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take || 50,
        skip: query.skip || 0,
        include: { role: { select: { code: true, name: true } } },
      }),
      (this.prisma as any).roleDefinitionModifyRequest.count({ where }),
    ]);

    return { items, total };
  }

  async getRoleDefinitionModifyRequest(id: string) {
    const request = await (this.prisma as any).roleDefinitionModifyRequest.findUnique({
      where: { id },
      include: { role: { select: { code: true, name: true, status: true } } },
    });
    if (!request) {
      throw new NotFoundException(`Role definition modify request not found: ${id}`);
    }
    return request;
  }
```

Also add `NotFoundException` to the imports from `@nestjs/common` at the top of the file.

- [ ] **Step 2: Add controller endpoints**

In `access-control.controller.ts`, add these imports at the top:

```typescript
import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';
```

Add `private readonly roleDefinitionModifyWorkflowService: RoleDefinitionModifyWorkflowService` to the constructor parameters.

Then add these endpoints. Place the `role-definitions/:roleId/modify` endpoint BEFORE the `roles` endpoint to avoid route conflicts:

```typescript
  @Post('role-definitions/:roleId/modify')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/role-definitions/:roleId/modify'))
  @ApiOperation({ summary: 'Submit a role definition modify request' })
  async submitRoleDefinitionModify(
    @Param('roleId') roleId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    const actor = this.buildAdminActor(req);
    return this.roleDefinitionModifyWorkflowService.initiateModify(roleId, body, actor);
  }

  @Get('role-definition-modify-requests')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definition-modify-requests'))
  @ApiOperation({ summary: 'List role definition modify requests' })
  async listRoleDefinitionModifyRequests(@Query() query: any) {
    this.ensureAdmin(query);
    return this.accessControlService.listRoleDefinitionModifyRequests(query);
  }

  @Get('role-definition-modify-requests/:id')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/role-definition-modify-requests/:id'))
  @ApiOperation({ summary: 'Get role definition modify request detail' })
  async getRoleDefinitionModifyRequest(@Param('id') id: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.getRoleDefinitionModifyRequest(id);
  }
```

Add `Param, Query` to the imports from `@nestjs/common` if not already present.

- [ ] **Step 3: Register providers in module**

In `access-control.module.ts`, add imports:

```typescript
import { RoleDefinitionModifyApprovalService } from './role-definition-modify-approval.service';
import { RoleDefinitionModifyWorkflowService } from './role-definition-modify-workflow.service';
```

Add both to the `providers` array:

```typescript
providers: [
  AccessControlService,
  AdminPermissionGuard,
  RoleDefinitionCreateApprovalService,
  RoleDefinitionCreateWorkflowService,
  RoleDefinitionModifyApprovalService,
  RoleDefinitionModifyWorkflowService,
],
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/access-control.controller.ts src/modules/identity/access-control/access-control.service.ts src/modules/identity/access-control/access-control.module.ts
git commit -m "feat(iam): add modify role definition endpoints, service methods, and module registration"
```

---

### Task 7: Frontend — RoleDetailPage Modify button + modal

**Files:**
- Modify: `admin-web/src/pages/RoleDetailPage.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports at the top:

```typescript
import { Plus, X } from 'lucide-react';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';
```

Inside the component, after the existing state declarations, add:

```typescript
  const { hasPermission } = useAdminSession();
  const canModify = hasPermission(PERMISSIONS.IAM_ROLE_DEFINITIONS_MODIFY);

  /* Modify modal state */
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyName, setModifyName] = useState('');
  const [modifyDescription, setModifyDescription] = useState('');
  const [modifySelectedBuckets, setModifySelectedBuckets] = useState<Set<string>>(new Set());
  const [modifyReason, setModifyReason] = useState('');
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [modifyLoading, setModifyLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
```

- [ ] **Step 2: Add notice auto-dismiss and modal helpers**

After the existing useEffect hooks, add:

```typescript
  /* Notice auto-dismiss */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* Open modify modal — pre-fill current values */
  const openModifyModal = () => {
    if (!detail || !catalog) return;
    setModifyName(detail.name || '');
    setModifyDescription(detail.description || '');
    /* Pre-select currently held buckets */
    const held = new Set<string>();
    for (const domain of catalog.domains) {
      for (const bucket of domain.buckets) {
        if (bucket.groups.some((g) => heldGroups.has(g))) {
          held.add(bucket.key);
        }
      }
    }
    setModifySelectedBuckets(held);
    setModifyReason('');
    setModifyError(null);
    setShowModifyModal(true);
  };

  const closeModifyModal = () => {
    setShowModifyModal(false);
    setModifyError(null);
  };
```

- [ ] **Step 3: Add submitModify function**

```typescript
  const submitModify = async () => {
    if (!detail) return;
    setModifyError(null);
    const name = modifyName.trim();
    const reason = modifyReason.trim();
    if (!name || modifySelectedBuckets.size === 0 || !reason) {
      setModifyError('Name, at least one capability, and change reason are required.');
      return;
    }
    setModifyLoading(true);
    try {
      const domainsWithBuckets = (catalog?.domains ?? []).filter((d) => d.buckets.length > 0);
      const permissionGroupCodes = Array.from(new Set(
        domainsWithBuckets
          .flatMap((d) => d.buckets)
          .filter((b) => modifySelectedBuckets.has(b.key))
          .flatMap((b) => b.groups),
      ));
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-definitions/${detail.id}/modify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedName: name,
            proposedDescription: modifyDescription.trim() || undefined,
            proposedPermissionGroups: permissionGroupCodes,
            changeReason: reason,
          }),
        },
      );
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to submit modify request.');
        setModifyError(msg);
        return;
      }
      const data = (await res.json()) as { approvalNo: string; requestNo: string };
      closeModifyModal();
      void fetchDetail();
      setNotice(`Role modify approval ${data.approvalNo} submitted for ${detail.code}.`);
    } catch (err: unknown) {
      setModifyError(err instanceof Error ? err.message : 'Failed to submit.');
    } finally {
      setModifyLoading(false);
    }
  };
```

- [ ] **Step 4: Add Modify button to the page header**

In the render section, find the `DetailPageHeader` component and add children to it. Change:

```tsx
      <DetailPageHeader
        title="Role"
        onBack={() => navigate('/dashboard/members/roles')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Roles"
      />
```

To:

```tsx
      <DetailPageHeader
        title="Role"
        onBack={() => navigate('/dashboard/members/roles')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Roles"
      >
        {canModify && detail?.status === 'ACTIVE' && (
          <button onClick={openModifyModal} className={adminButtonClass('listPrimary')}>
            Modify
          </button>
        )}
      </DetailPageHeader>
```

- [ ] **Step 5: Add notice banner**

After the inline error banner (the `{error && (...)}` block), add:

```tsx
      {notice && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
            {notice}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Add the Modify Modal**

Before the closing `</div>` of the page component, add:

```tsx
      {/* ════ Modify Role Modal ════ */}
      {showModifyModal && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Modify Role Definition
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Submits an approval request. Changes take effect after approval.
                </p>
              </div>
              <button
                onClick={closeModifyModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">

              {/* Role Code (read-only) */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Code
                </p>
                <p className="font-mono text-[11px] font-semibold text-adm-amber">
                  {detail.code}
                </p>
              </div>

              {/* Role Name */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Name
                </p>
                <input
                  value={modifyName}
                  onChange={(e) => setModifyName(e.target.value)}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Description (optional)
                </p>
                <input
                  value={modifyDescription}
                  onChange={(e) => setModifyDescription(e.target.value)}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Capabilities */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Capabilities
                </p>
                <div className="space-y-2">
                  {(catalog?.domains ?? [])
                    .filter((d) => d.buckets.length > 0)
                    .map((domain) => (
                      <div key={domain.id}>
                        <p className="flex items-center gap-1.5 py-1 font-mono text-[10px] font-semibold text-adm-t2">
                          <span>{domain.icon}</span>
                          {domain.label}
                        </p>
                        <div className="space-y-1">
                          {domain.buckets.map((bucket) => (
                            <label
                              key={bucket.key}
                              className="flex cursor-pointer gap-3 rounded border border-adm-border bg-adm-bg p-3 hover:bg-adm-card"
                              title={bucket.description}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={modifySelectedBuckets.has(bucket.key)}
                                onChange={(e) => {
                                  setModifySelectedBuckets((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(bucket.key);
                                    } else {
                                      next.delete(bucket.key);
                                    }
                                    return next;
                                  });
                                }}
                              />
                              <div>
                                <p className="font-mono text-[10px] font-semibold text-adm-t1">
                                  {bucket.label}
                                </p>
                                <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                                  {bucket.description}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Change Reason */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Change Reason
                </p>
                <textarea
                  value={modifyReason}
                  onChange={(e) => setModifyReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this role definition change is needed."
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors resize-none"
                />
              </div>

              {modifyError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {modifyError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeModifyModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitModify()}
                disabled={modifyLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {modifyLoading ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}
```

- [ ] **Step 7: Verify frontend TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/pages/RoleDetailPage.tsx
git commit -m "feat(admin-web): add Modify button and modal to RoleDetailPage"
```

---

### Task 8: Final verification

- [ ] **Step 1: Verify no TypeScript errors (backend + frontend)**

Run: `npx tsc --noEmit && cd admin-web && npx tsc --noEmit`
Expected: no errors for both

- [ ] **Step 2: Verify migration applies**

Run: `npx prisma migrate deploy`
Expected: all migrations applied, no errors

- [ ] **Step 3: Restart backend and verify new endpoints exist**

Start the backend, login, and test:
```bash
# Should return 401 (exists but needs auth), not 404
curl -s http://localhost:3500/admin/iam/role-definition-modify-requests
```
Expected: `{"statusCode":401,"message":"Unauthorized"}` (NOT 404)

- [ ] **Step 4: Verify action bucket catalog updated**

```bash
TOKEN=$(curl -s http://localhost:3500/auth/login -H "Content-Type: application/json" -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
curl -s http://localhost:3500/admin/iam/action-buckets -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(b['label']) for x in d['domains'] for b in x['buckets'] if b['key']=='iam.define_roles']"
```
Expected: `Manage role definitions`

- [ ] **Step 5: Commit any remaining changes**

```bash
git status
# If clean, no commit needed
```

# Role Definition Modify Workflow Design

## Goal

Allow operators to modify an existing ACTIVE role's capabilities (permission groups), name, and description through an approval-gated workflow. The role code is immutable.

## Architecture

Follows the established three-service pattern used by Role Definition Create and Admin Role Binding Change:

1. **WorkflowService** — validates input, creates a `RoleDefinitionModifyRequest` record, creates and submits an ApprovalCase, writes audit logs, executes the change on approval
2. **ApprovalHandlerService** — extends `ApprovalHandlerBase`, bridges approval events to a workflow-specific secondary event
3. **Controller** — exposes HTTP endpoints gated by `IAM_ROLE_DEFINE` permission group

The Role itself stays `ACTIVE` throughout. The modification request is a separate entity (`RoleDefinitionModifyRequest`) that stores both current and proposed state — matching the `AdminRoleChangeRequest` pattern.

## Data Model

### Prisma: `RoleDefinitionModifyRequest`

```prisma
model RoleDefinitionModifyRequest {
  id                       String    @id @default(uuid())
  requestNo                String    @unique @default("TEMP")
  roleId                   String
  currentName              String
  currentDescription       String?
  currentPermissionGroups  String    // JSON: string[] — snapshot at request time
  proposedName             String
  proposedDescription      String?
  proposedPermissionGroups String    // JSON: string[] — target state
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
}
```

Status flow: `PENDING_APPROVAL -> APPROVED | REJECTED | CANCELLED`

Constraint: only one `PENDING_APPROVAL` request per Role at a time (enforced in WorkflowService).

### Current vs Proposed

Both old and new values are stored on the request:
- `currentName` / `proposedName`
- `currentDescription` / `proposedDescription`
- `currentPermissionGroups` / `proposedPermissionGroups`

This enables:
- Approver sees before/after comparison
- Execution-time conflict detection: if `currentPermissionGroups` no longer matches the Role's actual state, the execution fails with `ROLE_MODIFY_FAILED`

## API Endpoints

| Method | Path | Permission Group | Description |
|--------|------|-----------------|-------------|
| `POST` | `/admin/iam/role-definitions/:roleId/modify` | `IAM_ROLE_DEFINE` | Initiate modify request |
| `GET` | `/admin/iam/role-definition-modify-requests` | `IAM_READ` | List modify requests |
| `GET` | `/admin/iam/role-definition-modify-requests/:id` | `IAM_READ` | Get modify request detail |

### POST request body

```typescript
{
  proposedName: string;              // required
  proposedDescription?: string;
  proposedPermissionGroups: string[]; // required, non-empty, valid group codes
  changeReason: string;              // required
}
```

### POST response

```typescript
{
  requestNo: string;
  roleCode: string;
  approvalNo: string;
  status: 'PENDING_APPROVAL';
}
```

## Approval Integration

### New constants

```typescript
// ApprovalActionTypes
ROLE_DEFINITION_MODIFY = 'ROLE_DEFINITION_MODIFY'

// AuditBusinessWorkflowTypes
ROLE_DEFINITION_MODIFY = 'ROLE_DEFINITION_MODIFY'
```

### Default approval policy

```typescript
ROLE_DEFINITION_MODIFY: {
  steps: [{ stepNo: 1, roles: ['CISO'] }],
  timeoutHours: 48,
  allowCancel: true,
  allowRetry: false,
}
```

### ApprovalCase objectSnapshot

```typescript
{
  roleCode: string;
  currentName: string;
  currentDescription: string | null;
  currentPermissionGroups: string[];
  proposedName: string;
  proposedDescription: string | null;
  proposedPermissionGroups: string[];
}
```

### Event flow

```
POST /admin/iam/role-definitions/:roleId/modify
  -> WorkflowService.initiateModify()
     -> create RoleDefinitionModifyRequest (PENDING_APPROVAL)
     -> approvalsService.createAndSubmit(actionType: ROLE_DEFINITION_MODIFY)
     -> audit: MODIFY_REQUESTED

CISO approves
  -> emits 'governance.approval.approved'
  -> RoleDefinitionModifyApprovalService (extends ApprovalHandlerBase)
     -> audit: APPROVAL_GRANTED
     -> emits 'workflow.role-definition-modify.decided' (decision: APPROVED)
  -> WorkflowService.onDecided()
     -> verify currentPermissionGroups matches actual Role state
     -> delete old RolePermission rows
     -> create new RolePermission rows from proposedPermissionGroups
     -> update Role name/description
     -> mark request APPROVED, set executedAt
     -> audit: ROLE_MODIFIED
     -> approvalsService.markExecutionResult(success)

CISO rejects
  -> RoleDefinitionModifyApprovalService -> audit: APPROVAL_DECLINED
  -> WorkflowService.onDecided()
     -> mark request REJECTED
     -> audit: MODIFY_CANCELLED
```

### Conflict detection

At execution time, the WorkflowService derives the Role's current permission groups from its `RolePermission` rows and compares against `request.currentPermissionGroups`. If they differ (another modification was applied in the interim), execution fails:
- Request status set to `APPROVED` with `failureReason`
- Audit: `ROLE_MODIFY_FAILED`
- `approvalsService.markExecutionResult(false, failureReason)`

## Audit Actions

New entries under `AuditGovernanceActions.ROLE_DEFINITION`:

| Action | Trigger |
|--------|---------|
| `MODIFY_REQUESTED` | Operator submits modify request |
| `ROLE_MODIFIED` | Change executed successfully after approval |
| `ROLE_MODIFY_FAILED` | Execution failed (conflict detection) |
| `MODIFY_CANCELLED` | Request cancelled or rejected |

The three approval-decision actions (`APPROVAL_GRANTED`, `APPROVAL_DECLINED`, `APPROVAL_CANCELLED`) are shared with Create — the `workflowType` field distinguishes them.

## Permission Routes (rbac.catalog.ts)

```typescript
route('POST', '/admin/iam/role-definitions/:roleId/modify', 'Submit role definition modify request', ['IAM_ROLE_DEFINE']),
route('GET',  '/admin/iam/role-definition-modify-requests', 'List role definition modify requests', ['IAM_READ']),
route('GET',  '/admin/iam/role-definition-modify-requests/:id', 'Get role definition modify request detail', ['IAM_READ']),
```

## Action Bucket Update

The existing `iam.define_roles` bucket in `ACTION_BUCKET_CATALOG`:
- Label: "Create role definitions" -> "Manage role definitions"
- Description: "Propose new role definitions or modify existing ones for approval"
- Groups: `['IAM_ROLE_DEFINE']` (unchanged)

## Frontend

### RoleDetailPage — Modify button

Conditions:
- Role status is `ACTIVE`
- User has `IAM_ROLE_DEFINITIONS_CREATE` permission (same `IAM_ROLE_DEFINE` group)

Button placement: inside `DetailPageHeader` area, using `adminButtonClass('listPrimary')`.

### Modify Modal

Follows the established modal pattern (PlatformMembers / RolesPage Create):
- Backdrop: `bg-black/50`
- Card: `bg-adm-panel`, rounded-xl, shadow-xl
- Header: `bg-adm-card` with title "Modify Role Definition" + subtitle + X close
- Body: `max-h-[60vh] overflow-y-auto`
- Footer: `bg-adm-card` with `modalCancel` + `modalConfirm` buttons

Form fields:
1. **Role Code** — read-only display (mono, amber text)
2. **Role Name** — pre-filled with current value, editable
3. **Description** — pre-filled with current value, editable
4. **Capabilities** — domain -> bucket card-style checkboxes (fetched from action-buckets API), pre-selected with currently held buckets
5. **Change Reason** — required textarea

Pre-selection logic: derive `heldGroups` from role's permissions via `permCodeToGroups`, then find bucket keys where `bucket.groups.some(g => heldGroups.has(g))`.

### Success feedback

`setNotice()` green banner with 4-second auto-dismiss: "Role modify approval {approvalNo} submitted for {roleCode}."

### Frontend permission constants (permissions.ts)

```typescript
IAM_ROLE_DEFINITIONS_MODIFY: 'api.post.admin_iam_role_definitions_id_modify',
IAM_ROLE_DEFINITION_MODIFY_REQUESTS_READ: 'api.get.admin_iam_role_definition_modify_requests',
IAM_ROLE_DEFINITION_MODIFY_REQUEST_DETAIL_READ: 'api.get.admin_iam_role_definition_modify_requests_id',
```

## V1_APPROVAL_ACTION_TYPES

Add `ROLE_DEFINITION_MODIFY` to the V1 list so it appears in the Approval Policy Management UI.

## Seed update

`seed.base.ts` `isBaseComplete()` and `seedGovernanceApprovalBaseline()` must include the new `ROLE_DEFINITION_MODIFY` policy.

## Files Changed

| Layer | File | Change |
|-------|------|--------|
| Schema | `prisma/schema.prisma` | Add `RoleDefinitionModifyRequest` model |
| Migration | `prisma/migrations/YYYYMMDD_add_role_definition_modify_requests/` | New migration |
| Constants | `approval.constants.ts` | Add `ROLE_DEFINITION_MODIFY` actionType + default policy + V1 list |
| Constants | `audit-actions.constant.ts` | Add 4 actions under `ROLE_DEFINITION` |
| Backend | `rbac.catalog.ts` | Add 3 route entries; update `iam.define_roles` bucket label |
| Backend | `access-control.controller.ts` | Add 3 endpoints |
| Backend | `access-control.service.ts` | Add query methods for modify requests |
| Backend | `role-definition-modify-workflow.service.ts` | New — initiate + execute |
| Backend | `role-definition-modify-approval.service.ts` | New — approval event bridge |
| Backend | `access-control.module.ts` | Register new providers |
| Frontend | `permissions.ts` | Add 3 constants |
| Frontend | `RoleDetailPage.tsx` | Add Modify button + modal |
| Seed | `seed.base.ts` | Include new approval policy |

## Non-Goals

- Modify role code (immutable business key)
- Standalone list/detail pages for modify requests (use Approval Center)
- Batch-modify multiple roles at once
- Role deactivation/deletion workflow (separate future work)

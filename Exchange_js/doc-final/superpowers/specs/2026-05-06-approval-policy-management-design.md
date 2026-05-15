# Approval Policy Management — Design Spec

**Date:** 2026-05-06
**Status:** Draft
**Workflow #10 of V1 MVP (审计底座)**

## Goal

Allow authorized admins to view all approval policies and modify checker role assignments through a governed change workflow. Modifications require `APPROVAL_POLICY_CHANGE` approval (checker: CISO, hardcoded). The policy governing `APPROVAL_POLICY_CHANGE` itself cannot be modified through the platform — only via code deployment.

## Regulatory Context

- **VARA CRM Rulebook II.B** Internal Controls — approval chain governance must be self-consistent and tamper-proof
- **Company Rulebook III Governance** — changes to governance mechanisms require their own governance gate

---

## Data Model

### New: `ApprovalPolicyChangeRequest`

Follows the same pattern as `AdminRoleChangeRequest` — a change snapshot entity linked to an approval case.

```prisma
model ApprovalPolicyChangeRequest {
  id                String    @id @default(uuid())
  requestNo         String    @unique @default("TEMP")
  targetActionType  String
  currentCheckerRoles String                              // CSV snapshot at request time
  proposedCheckerRoles String                             // CSV proposed value
  changeReason      String
  status            String    @default("PENDING_APPROVAL") // PENDING_APPROVAL | APPROVED | REJECTED | CANCELLED | EXPIRED | FAILED
  approvalCaseId    String?
  approvalCaseNo    String?
  requestedByUserId String
  executedAt        DateTime?
  failureReason     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?

  @@index([targetActionType, status])
  @@index([approvalCaseId])
  @@index([status])
  @@index([requestedByUserId])
  @@map("approval_policy_change_requests")
}
```

**Business key:** `requestNo` with prefix `APC` (generated via `generateReferenceNo('APC')`).

### Existing: `ApprovalActionPolicy` (unchanged)

```prisma
model ApprovalActionPolicy {
  actionType   String   @id
  riskLevel    String   @default("HIGH")
  checkerRoles String                     // CSV: "CISO,MLRO"
  timeoutHours Int      @default(24)
  allowCancel  Boolean  @default(true)
  allowRetry   Boolean  @default(true)
  updatedAt    DateTime @updatedAt

  @@map("approval_action_policies")
}
```

When an `APPROVAL_POLICY_CHANGE` is approved, the workflow service upserts the `checkerRoles` field on this table for the target `actionType`. Other fields (`timeoutHours`, `allowCancel`, `allowRetry`) are not modifiable through the platform.

---

## V1 Visibility Whitelist

Only V1 action types are visible in the management UI. Non-V1 types remain in code constants but are filtered out of API responses.

```typescript
const V1_APPROVAL_ACTION_TYPES = [
  'ADMIN_INVITE_APPROVAL',
  'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
  'ADMIN_SUSPENSION_APPROVAL',
  'ADMIN_REACTIVATION_APPROVAL',
  'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  'APPROVAL_POLICY_CHANGE',
];
```

As future versions ship, their action types are added to this whitelist.

---

## Backend Architecture

### Three-Layer Pattern (same as Role Binding Change)

| Layer | File | Location | Responsibility |
|-------|------|----------|----------------|
| Domain Service | `approval-policy.service.ts` (extend existing) | `src/modules/governance/approvals/` | Read all policies (merged default + DB), upsert checkerRoles for a single actionType |
| Approval Handler | `approval-policy-change-approval.service.ts` (new) | `src/modules/governance/approvals/` | Thin handler extending `ApprovalHandlerBase`, emits secondary event |
| Workflow Service | `approval-policy-change-workflow.service.ts` (new) | `src/modules/governance/approvals/` | Orchestration: validate → snapshot → create request → submit approval → listen for result → execute → audit |

### Domain Service: `ApprovalPolicyService` (extend)

New methods to add:

```typescript
async listV1Policies(): Promise<ResolvedApprovalPolicy[]>
// Merges DEFAULT_APPROVAL_POLICIES with DB overrides for V1 whitelist types.
// Each entry includes a `source` field: 'DEFAULT' | 'CUSTOMIZED'.

async upsertCheckerRoles(actionType: string, checkerRoles: string[], tx?: PrismaTransactionClient): Promise<void>
// Upserts ApprovalActionPolicy row. On insert: copies riskLevel/timeoutHours/allowCancel/allowRetry
// from DEFAULT_APPROVAL_POLICIES. On update: only overwrites checkerRoles, preserves other fields.
// Throws if actionType === 'APPROVAL_POLICY_CHANGE' (self-protection).
```

### Approval Handler: `ApprovalPolicyChangeApprovalService`

```typescript
@Injectable()
export class ApprovalPolicyChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = 'APPROVAL_POLICY_CHANGE';
  readonly workflowType = AuditBusinessWorkflowTypes.APPROVAL_POLICY;
  readonly auditActions = {
    granted: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.APPROVAL_POLICY;
}
```

Secondary event emitted: `workflow.approval-policy.decided`

### Workflow Service: `ApprovalPolicyChangeWorkflowService`

**`requestChange(targetActionType, proposedCheckerRoles, changeReason, actor)`:**

1. Validate `targetActionType` is in V1 whitelist
2. Reject if `targetActionType === 'APPROVAL_POLICY_CHANGE'` (400)
3. Validate `proposedCheckerRoles` against available role codes
4. Snapshot current checkerRoles via `ApprovalPolicyService.getPolicy()`
5. Reject if proposed === current (409 no change)
6. Create `ApprovalPolicyChangeRequest` with status `PENDING_APPROVAL`
7. Call `approvalsService.createAndSubmit()` with:
   - `actionType: 'APPROVAL_POLICY_CHANGE'`
   - `entityRef: request.id`
   - `workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY`
   - `workflowId: request.id`
   - `workflowNo: requestNo`
   - `metadata: { targetActionType, currentCheckerRoles, proposedCheckerRoles, changeReason }`
8. Update request with `approvalCaseId` / `approvalCaseNo`
9. Audit: `MODIFICATION_REQUESTED`
10. Return `{ requestNo, approvalNo, status }`

**`@OnEvent('workflow.approval-policy.decided')` handler:**

- `APPROVED` → call `ApprovalPolicyService.upsertCheckerRoles()` → update request status to `APPROVED` + `executedAt` → audit `MODIFICATION_APPLIED` → `markExecutionResult(SUCCESS)`
- `DECLINED` → update request status to `REJECTED` → audit
- `CANCELLED` → update request status to `CANCELLED` → audit
- `EXPIRED` → update request status to `EXPIRED` → audit
- Execution failure → update request status to `FAILED` + `failureReason` → audit `MODIFICATION_APPLY_FAILED` → `markExecutionResult(FAILED)`

---

## API Endpoints

All endpoints under a new `ApprovalPolicyController` in `src/modules/governance/approvals/`.

### Policy Read

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/governance/approval-policies` | List all V1 policies (merged default + DB overrides) |

**Response shape:**
```json
[
  {
    "actionType": "ADMIN_INVITE_APPROVAL",
    "checkerRoles": ["CISO"],
    "timeoutHours": 48,
    "source": "DEFAULT",
    "editable": true
  },
  {
    "actionType": "APPROVAL_POLICY_CHANGE",
    "checkerRoles": ["CISO"],
    "timeoutHours": 48,
    "source": "DEFAULT",
    "editable": false
  }
]
```

### Change Request Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/governance/approval-policies/:actionType/change-requests` | Create change request |
| GET | `/admin/governance/approval-policy-change-requests` | List change requests |
| GET | `/admin/governance/approval-policy-change-requests/:id` | Change request detail |

**POST body:**
```json
{
  "proposedCheckerRoles": ["CISO", "MLRO"],
  "changeReason": "Add MLRO as co-checker for invite approvals per quarterly access review"
}
```

**POST response:**
```json
{
  "requestNo": "APC2605060123",
  "approvalNo": "APR2605060456",
  "status": "PENDING_APPROVAL"
}
```

**Validation rules:**
- `proposedCheckerRoles`: non-empty array, each element must be a valid role code
- `changeReason`: non-empty string
- `actionType` param: must be in V1 whitelist and not `APPROVAL_POLICY_CHANGE`

---

## Frontend

### Page: `ApprovalPoliciesPage`

**Route:** `/dashboard/governance/approval-policies`

**Layout:** Standard admin list page (matches existing governance pages).

**Table columns:**

| Column | Content |
|--------|---------|
| Action Type | Human-readable label (e.g., "Admin Invite Approval") |
| Checker Roles | Role badges (e.g., `CISO`, `MLRO`) |
| Timeout | `48h` |
| Source | Badge: `Default` (gray) or `Customized` (amber) |
| Actions | Edit button |

**Edit button behavior:**
- `APPROVAL_POLICY_CHANGE` row: disabled, tooltip "This policy can only be modified via code deployment"
- All other rows: opens edit modal

### Modal: Edit Checker Roles

**Content:**
- Header: "Modify Approval Policy: {actionType label}"
- Current checkerRoles display (read-only, gray badges)
- Arrow indicator (→)
- Proposed checkerRoles: multi-select from available role codes (CISO, MLRO, SENIOR_MANAGEMENT_OFFICER, TECH_OFFICER, COMPLIANCE_OFFICER, DPO)
- Change reason textarea (required)
- Submit button: "Submit for Approval"

**On submit:** POST to change-requests endpoint → success toast with approvalNo → navigate to approval detail or stay on page.

### No separate change request list page

Change requests are visible through the existing Approvals list page (filtered by `actionType = APPROVAL_POLICY_CHANGE`). No dedicated page needed.

---

## Anti-Tampering Rules

1. **Backend guard:** `targetActionType === 'APPROVAL_POLICY_CHANGE'` → 400 BadRequest with code `SELF_POLICY_IMMUTABLE`
2. **Frontend guard:** Edit button disabled on `APPROVAL_POLICY_CHANGE` row
3. **Hardcoded checker:** `APPROVAL_POLICY_CHANGE` entry in `DEFAULT_APPROVAL_POLICIES` with `checkerRoles: ['CISO']` — since this type cannot be modified, the DB override path is never exercised for it
4. **No bypass:** Even SUPER_ADMIN cannot modify `APPROVAL_POLICY_CHANGE` policy through the platform

---

## Audit Trail

Uses pre-registered constants:
- `workflowType`: `AuditBusinessWorkflowTypes.APPROVAL_POLICY`
- `entityType`: `AuditEntityTypes.APPROVAL_POLICY`

| Event | Audit Action |
|-------|-------------|
| Change requested | `AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_REQUESTED` |
| Approval granted | `AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_GRANTED` |
| Approval declined | `AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_DECLINED` |
| Approval cancelled | `AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_CANCELLED` |
| Policy applied | `AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLIED` |
| Apply failed | `AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLY_FAILED` |

---

## New Constants

### `ApprovalActionTypes` addition

```typescript
APPROVAL_POLICY_CHANGE: 'APPROVAL_POLICY_CHANGE',
```

### `DEFAULT_APPROVAL_POLICIES` addition

```typescript
[ApprovalActionTypes.APPROVAL_POLICY_CHANGE]: {
  riskLevel: 'HIGH',
  checkerRoles: ['CISO'],
  timeoutHours: 48,
  allowCancel: true,
  allowRetry: false,
},
```

### `AuditEntityTypes` addition (if not already present)

```typescript
APPROVAL_POLICY: 'APPROVAL_POLICY',
```

---

## Module Registration

All new services register in `ApprovalsModule`:

- `ApprovalPolicyChangeApprovalService` → providers
- `ApprovalPolicyChangeWorkflowService` → providers
- `ApprovalPolicyController` → controllers

No new module needed — everything lives in the existing `governance/approvals` module.

---

## Out of Scope

- Modifying `timeoutHours`, `allowCancel`, `allowRetry` through the platform (code-only)
- Cleaning up non-V1 action types from code constants (incremental with future versions)
- Change request list/detail dedicated pages (use existing Approvals page)
- Approval delegation or escalation for policy changes

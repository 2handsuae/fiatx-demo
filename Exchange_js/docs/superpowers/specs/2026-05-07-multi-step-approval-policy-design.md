# Multi-Step Approval Policy Configuration

## Goal

Restructure the approval policy model so that each policy explicitly defines **steps** as a first-class structure, where each step can have **multiple roles** in an OR relationship (any of those roles can approve that step). Replace the current flat `checkerRoles` array — which implicitly creates one step per role — with an explicit `steps: PolicyStepConfig[]` structure.

## Key Discovery

The runtime approval engine (`approvals.service.ts`) already supports multi-role per step. `ApprovalStep.checkerRoleCandidates` is a `String` field, and the `approve()` method already does `splitRoleCsv(s.checkerRoleCandidates).some(candidate => actor.roleCodes.includes(candidate))`. Only the **policy model**, **step creation logic**, **change workflow**, and **admin UI** need to change.

## Approach

**Approach A — JSON column on `ApprovalActionPolicy`** (chosen over normalized table or encoded delimiter):

- Add `stepsConfig` column (JSON string: `PolicyStepConfig[]`) to `ApprovalActionPolicy`
- Keep `checkerRoles` as a derived flat CSV for backward compatibility
- Policy configs are always read/written as a whole unit — no need for per-step queries
- Minimal migration: existing flat CSV converts to single-step-per-role JSON

---

## Section 1: Data Model

### 1.1 Shared Type

```typescript
interface PolicyStepConfig {
  stepNo: number;   // 1-based, sequential, no gaps
  roles: string[];  // OR: any of these roles can approve this step
}
```

### 1.2 Prisma — `ApprovalActionPolicy`

```prisma
model ApprovalActionPolicy {
  actionType   String   @id
  riskLevel    String   @default("HIGH")
  checkerRoles String                    // DERIVED from stepsConfig, kept for backward compat
  stepsConfig  String?                   // NEW: JSON PolicyStepConfig[]
  timeoutHours Int      @default(24)
  allowCancel  Boolean  @default(true)
  allowRetry   Boolean  @default(true)
  updatedAt    DateTime @updatedAt
  @@map("approval_action_policies")
}
```

- `stepsConfig` is the **single source of truth**
- `checkerRoles` is always derived from `stepsConfig` on write (sync'd) and on read (computed)
- When `stepsConfig` is null (pre-migration rows), derive steps from `checkerRoles` (each role = 1 step)

### 1.3 Prisma — `ApprovalPolicyChangeRequest`

```prisma
model ApprovalPolicyChangeRequest {
  // ... existing fields preserved ...
  currentCheckerRoles  String          // kept for old records
  proposedCheckerRoles String          // kept for old records
  currentStepsConfig   String?         // NEW: JSON PolicyStepConfig[]
  proposedStepsConfig  String?         // NEW: JSON PolicyStepConfig[]
  // ...
}
```

New records populate both JSON and CSV fields. Old records have null JSON fields — backend falls back to CSV.

### 1.4 `DEFAULT_APPROVAL_POLICIES`

Type changes from `checkerRoles: string[]` to `steps: PolicyStepConfig[]`:

```typescript
export const DEFAULT_APPROVAL_POLICIES: Record<string, {
  riskLevel: string;
  steps: PolicyStepConfig[];
  timeoutHours: number;
  allowCancel: boolean;
  allowRetry: boolean;
}> = {
  [ApprovalActionTypes.ADMIN_INVITE_APPROVAL]: {
    riskLevel: 'HIGH',
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  // ... all 21 action types converted (each old role → 1 step)
};
```

### 1.5 `ResolvedApprovalPolicy`

```typescript
export interface ResolvedApprovalPolicy {
  actionType: string;
  riskLevel: string;
  steps: PolicyStepConfig[];       // NEW: primary field
  checkerRoles: string[];          // DERIVED: [...new Set(steps.flatMap(s => s.roles))]
  timeoutHours: number;
  allowCancel: boolean;
  allowRetry: boolean;
}
```

`checkerRoles` is computed as `[...new Set(steps.flatMap(s => s.roles))]` — keeps `ApprovalCase.checkerRoles` and `resolveDecisionRole()` working.

### 1.6 Unchanged Models

- **`ApprovalCase`** — `checkerRoles` remains a flat CSV (denormalized union of all step roles). No schema change.
- **`ApprovalStep`** — `checkerRoleCandidates` already supports CSV. No schema change.

---

## Section 2: Backend Service Changes

### 2.1 New Utilities — `constants/approval.constants.ts`

```typescript
// Shared type
export interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}

// Derive flat unique roles from steps
export function deriveCheckerRoles(steps: PolicyStepConfig[]): string[] {
  return [...new Set(steps.flatMap(s => s.roles))];
}

// Parse JSON + validate:
//   - Non-empty array
//   - stepNo sequential from 1, no gaps, no duplicates
//   - Each step has ≥1 non-empty role string
// Throws BadRequestException on invalid input
export function parseAndValidateStepsConfig(json: string): PolicyStepConfig[] { ... }

// Convert flat CSV roles → steps (backward compat: each role = 1 step)
export function checkerRolesToSteps(roles: string[]): PolicyStepConfig[] {
  return roles.map((role, idx) => ({ stepNo: idx + 1, roles: [role] }));
}
```

### 2.2 `approval-policy.service.ts`

**`getPolicy(actionType)`** — resolution order:

1. If DB row has `stepsConfig` → `parseAndValidateStepsConfig(stepsConfig)`
2. Else if DB row has `checkerRoles` → `checkerRolesToSteps(splitRoleCsv(checkerRoles))`
3. Else fallback to `DEFAULT_APPROVAL_POLICIES[actionType].steps`
4. Derive `checkerRoles` from `deriveCheckerRoles(steps)`

Returns `ResolvedApprovalPolicy` with both `steps` and `checkerRoles`.

**`listV1Policies()`** — updated to:

- Parse `stepsConfig` from DB rows (or derive from `checkerRoles`)
- Include `steps: PolicyStepConfig[]` in the return type
- Keep returning `checkerRoles` as derived field

**`upsertCheckerRoles()` → renamed to `upsertStepsConfig()`**:

```typescript
async upsertStepsConfig(
  actionType: string,
  steps: PolicyStepConfig[],
  tx?: any,
): Promise<void> {
  // Self-protection: APPROVAL_POLICY_CHANGE cannot be modified
  // Validate steps via parseAndValidateStepsConfig
  const stepsConfig = JSON.stringify(steps);
  const checkerRoles = deriveCheckerRoles(steps).join(',');

  await db.approvalActionPolicy.upsert({
    where: { actionType },
    update: { stepsConfig, checkerRoles },
    create: {
      actionType,
      stepsConfig,
      checkerRoles,
      riskLevel: defaultPolicy.riskLevel,
      timeoutHours: defaultPolicy.timeoutHours,
      allowCancel: defaultPolicy.allowCancel,
      allowRetry: defaultPolicy.allowRetry,
    },
  });
}
```

Both `stepsConfig` and `checkerRoles` are always written together — no desync risk.

### 2.3 `approvals.service.ts`

**Step creation in `createDraftCase()`**:

```typescript
// Before:
policy.checkerRoles.map((role, idx) => ({
  stepNo: idx + 1,
  status: ApprovalStepStatuses.PENDING,
  checkerRoleCandidates: role,
}))

// After:
policy.steps.map(step => ({
  stepNo: step.stepNo,
  status: ApprovalStepStatuses.PENDING,
  checkerRoleCandidates: step.roles.join(','),
}))
```

**`selectedCheckerRole` initialization fix**:

```typescript
// Before:
const selectedCheckerRole =
  this.normalizeOptionalString(dto.checkerRole) || policy.checkerRoles[0];
if (!policy.checkerRoles.includes(selectedCheckerRole)) { throw ... }

// After:
const selectedCheckerRole =
  this.normalizeOptionalString(dto.checkerRole) || policy.steps[0]?.roles[0];
if (!policy.steps[0]?.roles.includes(selectedCheckerRole)) { throw ... }
```

Validation scoped to step 1's roles (the initial step), not the flat union.

**`approve()` and `reject()` — enforce sequential step ordering (BLOCKER fix)**:

Both `approve()` and `reject()` must use the same fix:

```typescript
// Before: finds first PENDING step where actor has matching role (can skip steps!)
const currentStep = (approval.steps || []).find(
  (s) => s.status === PENDING && (splitRoleCsv(s.checkerRoleCandidates).some(...) || isSuperAdmin)
);

// After: find first PENDING step, then check if actor can act on it
const firstPendingStep = (approval.steps || []).find(
  (s) => s.status === ApprovalStepStatuses.PENDING,
);
if (!firstPendingStep) {
  throw new ForbiddenException('No pending steps');
}
const canAct =
  splitRoleCsv(firstPendingStep.checkerRoleCandidates).some(
    (candidate) => (actor.roleCodes || []).includes(candidate),
  ) || this.isSuperAdmin(actor);
if (!canAct) {
  throw new ForbiddenException(
    `Actor role ${(actor.roleCodes || []).join(',')} cannot sign the current pending step (step ${firstPendingStep.stepNo})`,
  );
}
const currentStep = firstPendingStep;
```

This prevents skipping steps — actor must wait for their step.

**`resolveDecisionRole()` — scope to current step (BLOCKER fix)**:

Currently validates against `approval.checkerRoles` (case-level flat CSV). Change to accept the current step's roles:

```typescript
// Add parameter for current step's candidates
private async resolveDecisionRole(
  approval: ApprovalCaseRow,
  actor: ApprovalActorContext,
  requestedRole?: string,
  stepCandidateRoles?: string[],  // NEW: from current step's checkerRoleCandidates
): Promise<string> {
  const allowedRoles = stepCandidateRoles || splitRoleCsv(approval.checkerRoles);
  // ... rest of logic uses allowedRoles
}
```

Caller in `approve()` passes `splitRoleCsv(currentStep.checkerRoleCandidates)`.

**`cancel()` — fix hardcoded `stepNo: 1` (BLOCKER fix)**:

```typescript
// Before:
await tx.approvalStep.update({
  where: { approvalCaseId_stepNo: { approvalCaseId: approval.id, stepNo: 1 } },
  data: { status: 'CANCELLED', decidedByUserId: actor.userId, ... },
});

// After:
await tx.approvalStep.updateMany({
  where: { approvalCaseId: approval.id, status: ApprovalStepStatuses.PENDING },
  data: {
    status: ApprovalStepStatuses.CANCELLED,
    decidedByUserId: actor.userId,
    decidedByUserNo: actor.userNo || null,
    decidedByRole: decisionRole,
    reason: dto.reason || null,
    decidedAt: now,
  },
});
```

Already-APPROVED steps are preserved (semantically correct).

**`expirePendingApprovalCase()` — same fix**:

```typescript
// Before: hardcoded stepNo: 1
// After:
await tx.approvalStep.updateMany({
  where: { approvalCaseId: approval.id, status: ApprovalStepStatuses.PENDING },
  data: { status: ApprovalStepStatuses.EXPIRED, decidedAt: now },
});
```

**`submitCase()` — intentionally unchanged**:

The hardcoded `stepNo: 1` in `submitCase()` is correct by design: submit always activates step 1 (the first step). This is **intentional, not an oversight**. Add a comment:

```typescript
// NOTE: stepNo: 1 is intentional — submit always activates the first step.
// Do not change to dynamic lookup.
```

### 2.4 `approval-policy-change-workflow.service.ts`

**`requestChange()` — new signature**:

```typescript
async requestChange(
  targetActionType: string,
  proposedSteps: PolicyStepConfig[],  // ← replaces proposedCheckerRoles
  changeReason: string,
  actor: ApprovalActorContext,
)
```

**No-change guard — structural comparison**:

```typescript
// Normalize for comparison: sort roles within each step
const normalize = (steps: PolicyStepConfig[]) =>
  JSON.stringify(steps.map(s => ({ ...s, roles: [...s.roles].sort() })));

if (normalize(currentPolicy.steps) === normalize(proposedSteps)) {
  throw new ConflictException({ code: 'NO_CHANGE', ... });
}
```

**Concurrent request guard**:

```typescript
const pendingExists = await this.prisma.approvalPolicyChangeRequest.findFirst({
  where: { targetActionType, status: 'PENDING_APPROVAL', deletedAt: null },
});
if (pendingExists) {
  throw new ConflictException({
    code: 'PENDING_REQUEST_EXISTS',
    message: `A pending change request already exists for ${targetActionType} (${pendingExists.requestNo})`,
  });
}
```

**Create record — populate both JSON and CSV fields**:

```typescript
const request = await this.prisma.approvalPolicyChangeRequest.create({
  data: {
    requestNo,
    targetActionType,
    currentStepsConfig: JSON.stringify(currentPolicy.steps),
    proposedStepsConfig: JSON.stringify(proposedSteps),
    currentCheckerRoles: currentPolicy.checkerRoles.join(','),      // backward compat
    proposedCheckerRoles: deriveCheckerRoles(proposedSteps).join(','), // backward compat
    changeReason,
    status: 'PENDING_APPROVAL',
    requestedByUserId: actor.userId,
  },
});
```

**Audit metadata — include step configs**:

```typescript
metadata: {
  targetActionType,
  currentStepsConfig: currentPolicy.steps,
  proposedStepsConfig: proposedSteps,
  currentCheckerRoles: currentPolicy.checkerRoles,    // keep for readability
  proposedCheckerRoles: deriveCheckerRoles(proposedSteps),
  changeReason,
  approvalNo: approvalCase.approvalNo,
},
```

**`executePolicyChange()` — backward-compatible read**:

```typescript
let proposedSteps: PolicyStepConfig[];
if (request.proposedStepsConfig) {
  proposedSteps = parseAndValidateStepsConfig(request.proposedStepsConfig);
} else {
  // Old record fallback: flat CSV → one-role-per-step
  proposedSteps = checkerRolesToSteps(
    request.proposedCheckerRoles.split(',').filter(Boolean),
  );
}

await this.policyService.upsertStepsConfig(request.targetActionType, proposedSteps, tx);
```

---

## Section 3: API Changes

### 3.1 Controller — `approval-policy.controller.ts`

**`POST /:actionType/change-requests`** — request body change:

```typescript
// Before:
@Body() body: { proposedCheckerRoles: string[]; changeReason: string }

// After:
@Body() body: { proposedSteps: PolicyStepConfig[]; changeReason: string }
```

Calls `workflowService.requestChange(actionType, body.proposedSteps, body.changeReason, actor)`.

**`GET /` (list policies)** — no controller change. `listV1Policies()` return type now includes `steps`.

**`GET /change-requests` and `GET /change-requests/:id`** — no controller change. Response JSON automatically includes `currentStepsConfig` / `proposedStepsConfig` fields.

### 3.2 API Response Shape

```json
{
  "actionType": "ADMIN_INVITE_APPROVAL",
  "steps": [
    { "stepNo": 1, "roles": ["CISO", "MLRO"] },
    { "stepNo": 2, "roles": ["DPO"] }
  ],
  "checkerRoles": ["CISO", "MLRO", "DPO"],
  "timeoutHours": 24,
  "source": "CUSTOMIZED",
  "editable": true
}
```

### 3.3 Breaking Changes

| Endpoint | Change | Impact |
|---|---|---|
| `POST .../change-requests` | Body `proposedCheckerRoles` → `proposedSteps` | Admin-internal API, acceptable break |
| `GET /` | Response adds `steps` field | Additive, non-breaking |
| `GET /change-requests[/:id]` | Response adds JSON fields | Additive, non-breaking |

---

## Section 4: Frontend UI Changes

### 4.1 Shared Type

```typescript
interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}
```

### 4.2 `PolicyView` Interface Update

```typescript
interface PolicyView {
  actionType: string;
  steps: PolicyStepConfig[];        // NEW
  checkerRoles: string[];           // kept (derived)
  timeoutHours: number;
  source: 'DEFAULT' | 'CUSTOMIZED';
  editable: boolean;
}
```

### 4.3 `ApprovalPoliciesPage.tsx` — Table

Replace "Checker Roles" column with "Steps" column:

```
┌─────────────────┬──────────────────────────────┬─────────┬────────────┬─────────┐
│ Action Type      │ Steps                        │ Timeout │ Source     │ Actions │
├─────────────────┼──────────────────────────────┼─────────┼────────────┼─────────┤
│ Admin Invite     │ Step 1: CISO · MLRO          │ 24h     │ CUSTOMIZED │ [Edit]  │
│                  │ Step 2: DPO                  │         │            │         │
├─────────────────┼──────────────────────────────┼─────────┼────────────┼─────────┤
│ Evidence Export  │ Step 1: MLRO                 │ 24h     │ DEFAULT    │ 🔒Locked│
└─────────────────┴──────────────────────────────┴─────────┴────────────┴─────────┘
```

Each step renders as a row within the cell. Roles within a step shown as amber badges.

### 4.4 `ApprovalPoliciesPage.tsx` — Edit Modal

Redesigned from flat role toggle to step-based editor:

```
┌──────────────────────────────────────────────────┐
│  Modify: Admin Invite                        [X] │
├──────────────────────────────────────────────────┤
│                                                  │
│  CURRENT CONFIGURATION                           │
│  Step 1: [CISO]  →  Step 2: [DPO]               │
│                                                  │
│  ─────────────────────────────────────────────── │
│                                                  │
│  PROPOSED CONFIGURATION                          │
│                                                  │
│  Step 1                                    [🗑]  │
│  [CISO ✓] [MLRO ✓] [SMO] [TECH] [COMP] [DPO]  │
│                                                  │
│  Step 2                                    [🗑]  │
│  [CISO] [MLRO] [SMO] [TECH] [COMP] [DPO ✓]    │
│                                                  │
│  [+ Add Step]                                    │
│                                                  │
│  CHANGE REASON                                   │
│  ┌──────────────────────────────────────────┐   │
│  │ Explain why this change is needed…       │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
├──────────────────────────────────────────────────┤
│                       [Cancel]  [Submit for Approval] │
└──────────────────────────────────────────────────┘
```

**Interactions:**

| Action | Behavior |
|---|---|
| Click role toggle | Select/deselect role within that step |
| `+ Add Step` | Append new empty step at bottom |
| 🗑 delete step | Remove step, auto-renumber remaining (step 2 → step 1 if step 1 deleted) |
| Submit validation | Each step ≥ 1 role; ≥ 1 step total |

**State:**

```typescript
const [proposedSteps, setProposedSteps] = useState<PolicyStepConfig[]>([]);

// On openEdit:
setProposedSteps(policy.steps.map(s => ({ stepNo: s.stepNo, roles: [...s.roles] })));
```

**Submit payload:**

```typescript
body: JSON.stringify({
  proposedSteps,
  changeReason: changeReason.trim(),
})
```

### 4.5 `PolicyChangeRequestDetailPage.tsx`

Side-by-side comparison of current vs proposed step configurations:

```
CURRENT CONFIGURATION              PROPOSED CONFIGURATION
Step 1: [CISO]                     Step 1: [CISO] [MLRO]
Step 2: [DPO]                      Step 2: [DPO]
                                   Step 3: [SMO]  ← new
```

Parse from `currentStepsConfig` / `proposedStepsConfig` JSON. Fallback to old CSV fields via `checkerRolesToSteps()`.

### 4.6 `PolicyChangeRequestsPage.tsx`

Summary column shows step count and role count:

```
2 steps · 2 roles → 3 steps · 4 roles
```

---

## Section 5: Migration Strategy

### 5.1 Prisma Schema Migration

Additive only — no columns deleted:

```sql
ALTER TABLE approval_action_policies ADD COLUMN stepsConfig TEXT;
ALTER TABLE approval_policy_change_requests ADD COLUMN currentStepsConfig TEXT;
ALTER TABLE approval_policy_change_requests ADD COLUMN proposedStepsConfig TEXT;
```

### 5.2 Data Migration Script

For existing `ApprovalActionPolicy` rows, generate `stepsConfig` from `checkerRoles` CSV:

```typescript
const rows = await prisma.approvalActionPolicy.findMany();
for (const row of rows) {
  if (row.stepsConfig) continue; // already migrated
  const roles = row.checkerRoles.split(',').filter(Boolean);
  const steps = roles.map((role, idx) => ({ stepNo: idx + 1, roles: [role] }));
  await prisma.approvalActionPolicy.update({
    where: { actionType: row.actionType },
    data: { stepsConfig: JSON.stringify(steps) },
  });
}
```

Each old role becomes a single-role step. Semantic behavior unchanged. Script is a no-op if no customized policies exist in DB.

### 5.3 Existing `ApprovalPolicyChangeRequest` Records

**No backfill.** Old records have `currentStepsConfig = null` and `proposedStepsConfig = null`. Backend reads with fallback:

```typescript
if (request.proposedStepsConfig) {
  steps = parseAndValidateStepsConfig(request.proposedStepsConfig);
} else {
  steps = checkerRolesToSteps(splitCsv(request.proposedCheckerRoles));
}
```

### 5.4 Existing `ApprovalCase` + `ApprovalStep` Records

**Zero changes.** Already-created approval instances are unaffected:
- `ApprovalCase.checkerRoles` — flat CSV, no schema change
- `ApprovalStep.checkerRoleCandidates` — already supports CSV, no schema change
- In-progress approval flows continue working normally

### 5.5 `DEFAULT_APPROVAL_POLICIES` Constants

All 21 action types converted from `checkerRoles: string[]` to `steps: PolicyStepConfig[]`. Each old role becomes a single-role step. Semantic behavior unchanged. TypeScript compiler catches all callsites that reference old `.checkerRoles` field.

### 5.6 Deployment Order

```
1. Prisma migrate   → add stepsConfig / currentStepsConfig / proposedStepsConfig columns
2. Data migration   → populate stepsConfig for existing ApprovalActionPolicy rows
3. Deploy backend   → getPolicy() reads stepsConfig, fallback to checkerRoles
4. Deploy frontend  → UI shows step-based editor
```

Each step is forward-compatible. Can deploy incrementally or all at once.

---

## BLOCKER Fixes Included in This Design

| # | Issue | Location | Fix |
|---|---|---|---|
| B1 | `approve()`/`reject()` `.find()` can skip steps | `approvals.service.ts` | Find first PENDING step, then check actor role |
| B2 | `resolveDecisionRole()` uses case-level flat roles | `approvals.service.ts` | Accept step-level `candidateRoles` parameter |
| B3 | `cancel()` hardcodes `stepNo: 1` | `approvals.service.ts` | `updateMany` all PENDING steps |
| B4 | `expire()` hardcodes `stepNo: 1` | `approvals.service.ts` | `updateMany` all PENDING steps |
| B5 | `selectedCheckerRole` uses `policy.checkerRoles[0]` | `approvals.service.ts` | Use `policy.steps[0].roles[0]` |

## IMPORTANT Fixes Included

| # | Issue | Fix |
|---|---|---|
| I1 | Dual source of truth (`stepsConfig` vs `checkerRoles`) | `stepsConfig` is sole source; `checkerRoles` always derived on write |
| I2 | JSON validation missing | `parseAndValidateStepsConfig()` validates structure |
| I3 | No-change guard compares flat roles | Structural comparison via normalized JSON |
| I4 | Concurrent change requests | Reject if PENDING_APPROVAL request exists for same policy |
| I5 | Audit metadata missing step info | Include `currentStepsConfig` / `proposedStepsConfig` |
| I6 | `submitCase()` hardcodes `stepNo: 1` | Intentional — add comment, do not change |
| I7 | `listV1Policies()` missing `steps` | Updated return type includes `steps` |

## Explicit Non-Changes

- `ApprovalCase.checkerRoles` — remains flat CSV denormalized union, used by `mapApproval()` for read model
- `ApprovalStep` schema — no change, `checkerRoleCandidates` already supports CSV
- `timeoutHours` — remains case-level (not per-step). Future enhancement if needed.
- `submitCase()` `stepNo: 1` — intentional, documented

## Critical Test Scenarios

1. Multi-step creation: policy with 3 steps creates 3 `ApprovalStep` rows with correct `stepNo` and `checkerRoleCandidates`
2. Multi-role step approval: step with roles `[CISO, MLRO]` can be approved by either role
3. Sequential enforcement: actor with role for step 2 cannot approve while step 1 is pending
4. Step progression: approving step 1 leaves case PENDING; approving last step marks case APPROVED
5. Reject at step 2: rejecting cancels remaining pending steps
6. Cancel multi-step: already-approved steps preserved, only pending steps cancelled
7. Expire multi-step: same as cancel but with EXPIRED status
8. `resolveDecisionRole` scoped to current step: returns role from current step only
9. Backward compat: policy with null `stepsConfig` falls back to `checkerRoles`-derived steps
10. Change request round-trip: create with `proposedSteps`, approve, verify policy updated
11. No-change guard: submitting identical step config rejected
12. Concurrent guard: second PENDING request for same policy rejected
13. Migration: existing `ApprovalActionPolicy` rows get correct `stepsConfig`
14. Frontend: UI sends `proposedSteps`, API accepts, detail page renders step comparison

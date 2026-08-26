# V1 Product Bug Fixes — Design Spec

> 6 confirmed product-level bugs found during V1 code audit. All fixes are scoped, non-architectural point fixes.

---

## Fix 1: SUSPENDED Users Can Still Log In

### Problem

`auth.service.ts` `validateUser` checks for INACTIVE (line 84) and LOCKED (line 119) but never checks SUSPENDED. A suspended admin passes password validation and proceeds to login.

Additionally, `first-login-workflow.service.ts` `verifyMfaLogin` performs zero status checks — a SUSPENDED user with valid MFA receives an access token.

The JWT strategy (`jwt.strategy.ts` line 56) does check SUSPENDED on every authenticated request, so the token is blocked on first use. But the login itself succeeds, which is a defense-in-depth failure.

### Fix

**`auth.service.ts` — `validateUser`:**
- After the INACTIVE check (line ~84), add:
  ```
  if (user.status === 'SUSPENDED') {
    throw new ForbiddenException('Account has been suspended');
  }
  ```

**`first-login-workflow.service.ts` — `verifyMfaLogin`:**
- Before MFA token verification, load the user's `status` field (currently not selected by `findFirstLoginState`)
- Add status gate: reject SUSPENDED and LOCKED users before issuing the access token

### Boundary

- PENDING_INVITE_APPROVAL users never reach `validateUser` (no password set yet) — no additional handling needed.
- The JWT strategy SUSPENDED check remains as defense-in-depth; it is not removed.

---

## Fix 2: Multi-Step Approval SoD Gap

### Problem

`approvals.service.ts` `resolveDecisionRole` (line 619-623) only checks maker-checker separation: the case creator cannot be the checker. In a multi-step approval flow, there is no check preventing the same user from approving multiple steps. A user holding both MLRO and SENIOR_MANAGEMENT_OFFICER roles can approve all steps alone, defeating the purpose of multi-step separation of duties.

### Fix

**`approvals.service.ts` — `resolveDecisionRole`:**
- After the existing maker-checker check, add cross-step exclusion:
  1. Query all steps of the same approval case where `status = 'APPROVED'`
  2. Collect `decidedByUserId` from each approved step
  3. If `actor.userId` appears in the set, throw `ConflictException('Same user cannot approve multiple steps of the same case')`

### Rules

- **SUPER_ADMIN is not exempt** — SoD must apply universally, no privilege bypass.
- **Cross-step, not just consecutive** — approving step 1 blocks approving step 2, 3, etc. (option A as agreed).

---

## Fix 3: handleExpired Writes CANCELLED Instead of EXPIRED

### Problem

`approval-handler.base.ts` `handleExpired` (line 162) writes `this.auditActions.cancelled` as the audit action. The `auditActions` interface only defines `{ granted, declined, cancelled }` — there is no `expired` field. Expired cases are recorded as cancelled in the audit trail, misrepresenting the compliance state.

Additionally, `handleExpired` uses `recordByActor` with a fabricated actor (`actorType: 'ADMIN', actorId: 'SYSTEM'`). Expiration is a system-triggered timer event and should use `recordSystem`.

### Fix

**`approval-handler.base.ts`:**

1. Extend the `auditActions` interface to include `expired`:
   ```typescript
   auditActions: {
     granted: string;
     declined: string;
     cancelled: string;
     expired: string;    // NEW
   };
   ```

2. In `handleExpired`, change:
   - `this.auditActions.cancelled` → `this.auditActions.expired`
   - `this.auditLogsService.recordByActor(...)` → `this.auditLogsService.recordSystem(...)`
   - Remove the fabricated actor object

**All 8 `ApprovalHandlerBase` subclasses** — add `expired` field using the governance naming convention `<DOMAIN>_EXPIRED`:

| Handler | `expired` value |
|---------|----------------|
| AdminInviteApprovalService | `INVITE_EXPIRED` |
| AdminRoleBindingChangeApprovalService | `ROLE_CHANGE_EXPIRED` |
| AdminSuspensionApprovalService | `SUSPENSION_EXPIRED` |
| AdminReactivationApprovalService | `REACTIVATION_EXPIRED` |
| RoleDefinitionCreateApprovalService | `ROLE_DEFINITION_CREATE_EXPIRED` |
| RoleDefinitionModifyApprovalService | `ROLE_DEFINITION_MODIFY_EXPIRED` |
| ApprovalPolicyChangeApprovalService | `POLICY_CHANGE_EXPIRED` |
| AuditEvidenceExportApprovalService | `EVIDENCE_EXPORT_EXPIRED` |

### Audit Action Registration

Each new `*_EXPIRED` action must be added to `AuditGovernanceActions` in `audit-actions.constant.ts` under the corresponding workflow namespace.

---

## Fix 4: ROLE_DEFINITION_CREATE Missing from V1_APPROVAL_ACTION_TYPES

### Problem

`approval.constants.ts` `V1_APPROVAL_ACTION_TYPES` (line 339-347) includes `ROLE_DEFINITION_MODIFY` but not `ROLE_DEFINITION_CREATE`. The "Create Role Definition" approval type is invisible in the Approval Policy Management UI and cannot be managed by operators.

### Fix

Add `ApprovalActionTypes.ROLE_DEFINITION_CREATE` to the `V1_APPROVAL_ACTION_TYPES` array. One line.

---

## Fix 5: canApprove/canReject Are Case-Level, Not Step-Aware

### Problem

`approvals.service.ts` `mapApproval` (line 514-528) computes `canApprove`/`canReject` from case-level `checkerRoles` (the flat union of all steps' roles). A user whose role matches a later step (but not the current pending step) incorrectly sees `canApprove: true`. Clicking approve then returns 403 from the actual `approve` method, which correctly enforces step-level checks.

### Fix

**`approvals.service.ts` — `mapApproval`:**

1. Find the current pending step: first step with `status = 'PENDING'`
2. If no pending step exists (case is terminal), set `canApprove = canReject = false`
3. Compute `availableDecisionRoles` from the pending step's `checkerRoleCandidates` instead of case-level `checkerRoles`
4. Add cross-step SoD check: if actor already approved a prior step, `canApprove = canReject = false`

### Shared Helper

Fix 2 and Fix 5 both need the same check: "has this userId already approved a step in this case?" Extract a private helper method (e.g., `hasActorApprovedAnyStep(steps, userId): boolean`) used by both `resolveDecisionRole` (enforcement) and `mapApproval` (display).

### Dependency

This fix depends on Fix 2's SoD logic being implemented first, as the `mapApproval` display check must mirror the enforcement check.

---

## Fix 6: Three Approval Types Produce Duplicate Audit Logs

### Problem

`approvals.service.ts` has a `hasDedicatedAuditService` list (line 350-360) that controls which workflow types skip the generic audit write path. Three workflow types have dedicated `ApprovalHandlerBase` subclasses but are missing from this list:
- `APPROVAL_POLICY`
- `ROLE_DEFINITION_CREATE`
- `ROLE_DEFINITION_MODIFY`

Every approve/reject/cancel/expire on these types produces 2 audit entries: one from the generic `approvals.service` and one from the handler subclass.

### Fix

Add the three missing workflow types to the `hasDedicatedAuditService` array. Three lines.

---

## Cross-Fix Dependencies

```
Fix 4 (add to V1 list)           — independent
Fix 6 (add to DEDICATED list)    — independent
Fix 1 (login block)              — independent
Fix 3 (handleExpired)            — independent
Fix 2 (SoD enforcement)          — independent
Fix 5 (canApprove step-aware)    — depends on Fix 2
```

Recommended implementation order: 4 → 6 → 1 → 3 → 2 → 5

---

## Out of Scope

These items were identified during audit but are explicitly NOT included in this fix batch:
- JWT hardcoded secret removal (technical, not product)
- Plaintext password reset token (technical)
- maskAuditPayload activation (technical)
- traceId format unification (technical)
- $transaction / TOCTOU fixes (technical)
- MFA reset workflow creation (separate product feature, requires its own brainstorm)
- Token revocation / session invalidation (known gap, deferred)

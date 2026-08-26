# Credential Reset Workflow Redesign — Design Spec

> Unify password reset and MFA reset into consistent three-layer architecture. Admin-initiated resets require approval flow; self-service password reset remains unchanged.

---

## Problem

Password reset has a 322-line workflow service with self-service and CISO paths, token model, and comprehensive audit logging. MFA reset is a 66-line flat service that executes immediately with no approval, no persistent record, and minimal audit. These are symmetrical credential management operations with inconsistent governance.

Additionally, the CISO password reset path currently bypasses approval — a CISO can directly generate a reset token for any non-SUPER_ADMIN user without maker-checker oversight.

---

## Decisions

1. **Self-service password reset** — no approval flow (keep current MFA-verify → token → consume mechanism)
2. **Admin-initiated password reset** — requires approval flow (ApprovalCase)
3. **Admin-initiated MFA reset** — requires approval flow (ApprovalCase)
4. **MFA reset has no self-service path** — user who lost MFA device must contact admin
5. **Separate approval types** — `ADMIN_PASSWORD_RESET` and `ADMIN_MFA_RESET` are independent, allowing different approval policies
6. **Password reset execution after approval** — auto-generates PasswordResetToken and sends email (reuses existing token mechanism)

---

## Architecture

### Paths After Redesign

**Password Reset — Self-Service (unchanged):**
```
User → POST /auth/password-reset/request (email)
     → POST /auth/password-reset/verify-mfa (MFA code)
     → System generates PasswordResetToken, sends email
     → POST /auth/password-reset/consume (token + newPassword)
```

**Password Reset — Admin Path (redesigned):**
```
CISO → POST /admin/iam/users/:id/reset-password
     → AdminPasswordResetWorkflowService.initiateAdminReset()
     → Creates ApprovalCase (ADMIN_PASSWORD_RESET)
     → Approval granted → auto-generate PasswordResetToken, send email
     → Target user consumes token via existing /auth/password-reset/consume
```

**MFA Reset — Admin Path (new):**
```
CISO → POST /admin/iam/users/:id/reset-mfa
     → AdminMfaResetWorkflowService.initiateAdminMfaReset()
     → Creates ApprovalCase (ADMIN_MFA_RESET)
     → Approval granted → usersDomainService.resetMfa()
     → Target user re-binds MFA on next login
```

### Three-Layer Mapping

| Layer | Password Reset | MFA Reset |
|-------|---------------|-----------|
| L1 Domain | `usersDomainService.resetPassword()` (exists) | `usersDomainService.resetMfa()` (exists) |
| L2 Approval | `admin-password-reset-approval.service.ts` (new) | `admin-mfa-reset-approval.service.ts` (new) |
| L3 Workflow | `admin-password-reset-workflow.service.ts` (modify) | `admin-mfa-reset-workflow.service.ts` (new) |

---

## New Files

### `admin-password-reset-approval.service.ts` (Layer 2)

Standard `ApprovalHandlerBase` subclass. Four constants only:

```typescript
actionType = ApprovalActionTypes.ADMIN_PASSWORD_RESET
workflowType = AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET
entityType = AuditEntityTypes.ADMIN_USER
auditActions = {
  granted: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_GRANTED,
  declined: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_DECLINED,
  cancelled: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_CANCELLED,
  expired: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_EXPIRED,
}
```

### `admin-mfa-reset-approval.service.ts` (Layer 2)

Same structure, substituting `ADMIN_MFA_RESET` namespace.

```typescript
actionType = ApprovalActionTypes.ADMIN_MFA_RESET
workflowType = AuditBusinessWorkflowTypes.ADMIN_MFA_RESET
entityType = AuditEntityTypes.ADMIN_USER
auditActions = {
  granted: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_GRANTED,
  declined: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_DECLINED,
  cancelled: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_CANCELLED,
  expired: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_EXPIRED,
}
```

### `admin-mfa-reset-workflow.service.ts` (Layer 3)

New workflow service replacing the flat `admin-mfa-reset.service.ts`.

**`initiateAdminMfaReset(targetUserId, actor)`:**
- Preconditions:
  - `actor.userId !== targetUserId` (cannot reset own MFA)
  - Target user exists, `status = 'ACTIVE'`
  - Target user has MFA binding (`mfaEnabledAt` is set)
  - Target user is not SUPER_ADMIN
- Creates ApprovalCase via `approvalsService.createAndSubmit()` with:
  - `actionType: ADMIN_MFA_RESET`
  - `entityRef: targetUserId`
  - `objectSnapshot: { userNo, email, targetRole }`
- Records audit: `ADMIN_MFA_RESET.RESET_REQUESTED`
- Returns `{ approvalNo, status: 'PENDING_APPROVAL' }`

**`handleApprovalDecided(event)` — `@OnEvent('workflow.admin-mfa-reset.decided')`:**
- APPROVED:
  - Calls `usersDomainService.resetMfa(targetUserId)`
  - Records audit: `ADMIN_MFA_RESET.RESET_EXECUTED`
  - Calls `approvalsService.markExecutionResult(approvalId, true, ...)`
- APPROVED but execution fails:
  - Records audit: `ADMIN_MFA_RESET.RESET_FAILED`
  - Calls `approvalsService.markExecutionResult(approvalId, false, ...)`
- DECLINED / CANCELLED / EXPIRED:
  - Records audit: `ADMIN_MFA_RESET.RESET_CANCELLED`

---

## Modified Files

### `admin-password-reset-workflow.service.ts`

**Self-service path — NO CHANGES to:**
- `requestSelfServiceReset()`
- `createResetTokenForSelf()`
- `consumeResetToken()`
- `createResetToken()` (private, reused by both self-service and post-approval execution)

**CISO path — REPLACE `requestCisoReset()` with `initiateAdminReset()`:**

`initiateAdminReset(targetUserId, actor)`:
- Same preconditions as existing `requestCisoReset()`:
  - `actor.userId !== targetUserId`
  - Target user `status = 'ACTIVE'`
  - Target user `firstLoginStatus = 'COMPLETED'`
  - Target user `mfaEnabledAt` is set
  - Target user is not SUPER_ADMIN
- Creates ApprovalCase via `approvalsService.createAndSubmit()` with:
  - `actionType: ADMIN_PASSWORD_RESET`
  - `entityRef: targetUserId`
  - `objectSnapshot: { userNo, email, targetRoles }`
- Records audit: `ADMIN_PASSWORD_RESET.RESET_REQUESTED`
- Returns `{ approvalNo, status: 'PENDING_APPROVAL' }`

**NEW: `handleApprovalDecided(event)` — `@OnEvent('workflow.admin-password-reset.decided')`:**
- APPROVED:
  - Loads target user (validate still ACTIVE)
  - Calls existing `createResetToken(userId, userNo, email, 'CISO', decisionByUserId, decisionByUserNo)`
  - Records audit: `ADMIN_PASSWORD_RESET.RESET_EXECUTED`
  - Calls `approvalsService.markExecutionResult(approvalId, true, ...)`
- APPROVED but execution fails:
  - Records audit: `ADMIN_PASSWORD_RESET.RESET_FAILED`
  - Calls `approvalsService.markExecutionResult(approvalId, false, ...)`
- DECLINED / CANCELLED / EXPIRED:
  - Records audit: `ADMIN_PASSWORD_RESET.RESET_CANCELLED`

**New dependencies:** `ApprovalsService`, `EventEmitter2` (via `@OnEvent`).

**Remove:** `requestCisoReset()` method — replaced by `initiateAdminReset()`.

### `approval.constants.ts`

Add to `ApprovalActionTypes` enum:
```typescript
ADMIN_PASSWORD_RESET = 'ADMIN_PASSWORD_RESET'
ADMIN_MFA_RESET = 'ADMIN_MFA_RESET'
```

Add both to `V1_APPROVAL_ACTION_TYPES` array.

### `audit-actions.constant.ts`

Add to `AuditBusinessWorkflowTypes`:
```typescript
ADMIN_PASSWORD_RESET = 'ADMIN_PASSWORD_RESET'
ADMIN_MFA_RESET = 'ADMIN_MFA_RESET'
```

`AuditEntityTypes.ADMIN_USER` already exists — no change needed.

Add two new governance namespaces in `AuditGovernanceActions`:
```typescript
ADMIN_PASSWORD_RESET: {
  RESET_REQUESTED: 'ADMIN_PASSWORD_RESET_REQUESTED',
  RESET_EXECUTED: 'ADMIN_PASSWORD_RESET_EXECUTED',
  RESET_FAILED: 'ADMIN_PASSWORD_RESET_FAILED',
  RESET_CANCELLED: 'ADMIN_PASSWORD_RESET_CANCELLED',
  APPROVAL_GRANTED: 'ADMIN_PASSWORD_RESET_APPROVAL_GRANTED',
  APPROVAL_DECLINED: 'ADMIN_PASSWORD_RESET_APPROVAL_DECLINED',
  APPROVAL_CANCELLED: 'ADMIN_PASSWORD_RESET_APPROVAL_CANCELLED',
  APPROVAL_EXPIRED: 'ADMIN_PASSWORD_RESET_APPROVAL_EXPIRED',
}

ADMIN_MFA_RESET: {
  RESET_REQUESTED: 'ADMIN_MFA_RESET_REQUESTED',
  RESET_EXECUTED: 'ADMIN_MFA_RESET_EXECUTED',
  RESET_FAILED: 'ADMIN_MFA_RESET_FAILED',
  RESET_CANCELLED: 'ADMIN_MFA_RESET_CANCELLED',
  APPROVAL_GRANTED: 'ADMIN_MFA_RESET_APPROVAL_GRANTED',
  APPROVAL_DECLINED: 'ADMIN_MFA_RESET_APPROVAL_DECLINED',
  APPROVAL_CANCELLED: 'ADMIN_MFA_RESET_APPROVAL_CANCELLED',
  APPROVAL_EXPIRED: 'ADMIN_MFA_RESET_APPROVAL_EXPIRED',
}
```

### `approvals.service.ts`

Add both new workflow types to `hasDedicatedAuditService` list:
```typescript
AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
```

### `admin-credential-mgmt.controller.ts`

- Replace `AdminMfaResetService` dependency with `AdminMfaResetWorkflowService`
- `POST /admin/iam/users/:id/reset-mfa` calls `workflow.initiateAdminMfaReset()` instead of `executeMfaReset()`
- Returns `{ approvalNo, status: 'PENDING_APPROVAL' }` instead of immediate result

### `users.controller.ts`

- `POST /users/:id/reset-password` calls `workflow.initiateAdminReset()` instead of `requestCisoReset()`
- Returns `{ approvalNo, status: 'PENDING_APPROVAL' }` instead of `{ resetNo, status: 'RESET_EMAIL_SENT' }`

### `users.module.ts`

- Remove `AdminMfaResetService` from providers
- Add `AdminMfaResetWorkflowService`, `AdminPasswordResetApprovalService`, `AdminMfaResetApprovalService` to providers
- Export `AdminMfaResetWorkflowService` if needed by other modules

---

## Deleted Files

| File | Reason |
|------|--------|
| `admin-mfa-reset.service.ts` | Replaced by `admin-mfa-reset-workflow.service.ts` |

---

## Existing Self-Service Audit Actions

The existing `AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT` namespace covers self-service password reset audit actions (`PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_RESET_FAILED`, `PASSWORD_RESET_REVOKED`) and the old MFA reset (`MFA_RESET_EXECUTED`). These are retained as-is for the self-service path. The new `ADMIN_PASSWORD_RESET` and `ADMIN_MFA_RESET` namespaces cover admin-initiated (approval-gated) paths only.

---

## Out of Scope

- Self-service MFA reset (user cannot self-verify without MFA device)
- Token revocation / session invalidation after credential reset (known gap, deferred)
- Email notification service integration (TODO placeholder retained)
- Frontend changes for approval status display (existing approval UI handles it)

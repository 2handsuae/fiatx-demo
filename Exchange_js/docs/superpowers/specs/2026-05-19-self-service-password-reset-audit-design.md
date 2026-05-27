# Self-Service Password Reset Audit Log Coverage

**Date:** 2026-05-19
**Scope:** `AdminPasswordResetWorkflowService` self-service path
**Approach:** Workflow 层内联审计（方案 A）

---

## Problem

Self-service password reset has 3 steps, all missing audit log coverage:

1. `requestSelfServiceReset()` — user submits email, gets MFA session token
2. `createResetTokenForSelf()` → `createResetToken()` — after MFA verification, reset token created
3. `consumeResetToken()` — user submits new password with token

This violates rule #1 (persistent state changes must write `AuditLogsService`) and VARA TIR Rulebook III.A (credential lifecycle management audit requirements).

The admin-initiated path (CISO) has full audit coverage. The self-service path has none.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Actor strategy | `recordByActor` with target user as actor | Self-service = user acting on themselves; semantically accurate |
| Anti-enumeration (user not found) | No audit log | Avoid polluting audit table with invalid emails |
| Action naming | New `SELF_` prefix actions | Distinguishes self-service vs governance path in audit queries without relying on metadata filtering |
| workflowType | Reuse `ADMIN_PASSWORD_RESET` | Same business domain; action name differentiates the path |
| consumeResetToken audit | Unconditional (both paths) | Token consumption was unaudited for both self-service and admin paths |

---

## New Audit Action Constants

Add to `AuditGovernanceActions.ADMIN_PASSWORD_RESET`:

```
SELF_RESET_REQUESTED:     'SELF_RESET_REQUESTED'
SELF_RESET_TOKEN_CREATED: 'SELF_RESET_TOKEN_CREATED'
SELF_RESET_COMPLETED:     'SELF_RESET_COMPLETED'
RESET_CONSUMED:           'RESET_CONSUMED'
```

`SELF_RESET_COMPLETED` is used when `requestSource === 'SELF'`. `RESET_CONSUMED` is used when `requestSource !== 'SELF'` (admin-initiated path — token consumption was previously unaudited).

File: `src/modules/audit-logging/constants/audit-actions.constant.ts`

---

## Audit Log Calls

### Call 1: `requestSelfServiceReset()` — after user found, before JWT sign

```
action:        SELF_RESET_REQUESTED
entityType:    ADMIN_USER
entityId:      user.id
entityNo:      user.userNo
workflowType:  ADMIN_PASSWORD_RESET
traceId:       new randomUUID() (generated at method entry, embedded in JWT)
result:        SUCCESS
metadata:      { email: user.email, requestSource: 'SELF' }
actor:         { actorType: 'ADMIN', actorId: user.id, actorNo: user.userNo, actorRole: 'SELF' }
```

Condition: only when user exists and passes all preconditions (status=ACTIVE, firstLoginStatus=COMPLETED, mfaEnabled). User-not-found returns silently per anti-enumeration design.

### Call 2: `createResetToken()` — after token persisted, when `requestSource='SELF'`

```
action:        SELF_RESET_TOKEN_CREATED
entityType:    ADMIN_USER
entityId:      userId
entityNo:      userNo
workflowType:  ADMIN_PASSWORD_RESET
traceId:       passed in from caller (originated in step 1)
result:        SUCCESS
metadata:      { resetNo, requestSource: 'SELF' }
actor:         { actorType: 'ADMIN', actorId: userId, actorNo: userNo, actorRole: 'SELF' }
```

Condition: only when `requestSource === 'SELF'`. Admin path audit is handled by `executeAdminReset()`.

### Call 3: `consumeResetToken()` — after $transaction succeeds

Action is chosen by `tokenRecord.requestSource`:

- `requestSource === 'SELF'` → action = `SELF_RESET_COMPLETED`, actorRole = `'SELF'`
- `requestSource !== 'SELF'` (admin path) → action = `RESET_CONSUMED`, actorRole = `'SELF'`

```
action:        SELF_RESET_COMPLETED or RESET_CONSUMED (by requestSource)
entityType:    ADMIN_USER
entityId:      targetUser.id
entityNo:      targetUser.userNo
workflowType:  ADMIN_PASSWORD_RESET
traceId:       tokenRecord.traceId (persisted on PasswordResetToken row)
result:        SUCCESS
metadata:      { resetNo: tokenRecord.resetNo, requestSource: tokenRecord.requestSource }
actor:         { actorType: 'ADMIN', actorId: targetUser.id, actorNo: targetUser.userNo, actorRole: 'SELF' }
```

Condition: unconditional — covers both self-service and admin paths. Token consumption was previously unaudited for both. `RESET_CONSUMED` is a new action constant added alongside the `SELF_` actions.

---

## traceId Propagation

Current state: three steps have no shared traceId. `createResetToken()` generates its own traceId internally, but it is not connected to the request step.

### Design

| Step | traceId source | Propagation mechanism |
|------|---------------|----------------------|
| `requestSelfServiceReset` | New `randomUUID()` | Embedded in mfaSessionToken JWT claims as `traceId` field |
| `createResetTokenForSelf` (via verify-mfa) | Read from `req.passwordResetMfaUser.traceId` | Passed as new parameter to `createResetToken()` |
| `consumeResetToken` | Read from `tokenRecord.traceId` | Already persisted on PasswordResetToken row |

### Changes required

1. **`requestSelfServiceReset()`** — generate traceId, add to JWT sign payload: `{ ..., traceId }`
2. **`PasswordResetMfaGuard`** — extract `traceId` from decoded JWT, attach to `req.passwordResetMfaUser`
3. **`PasswordResetController.verifyMfa()`** — pass `traceId` to `createResetTokenForSelf()`
4. **`createResetTokenForSelf()`** — add `traceId` parameter, forward to `createResetToken()`
5. **`createResetToken()`** — add optional `traceId?` parameter; use if provided, else `randomUUID()` (preserves admin path behavior)

Result: `WHERE traceId = X` returns all 3 audit events for a single self-service reset journey.

---

## Files Changed

| File | Change |
|------|--------|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add 3 new action constants |
| `src/modules/identity/users/admin-password-reset-workflow.service.ts` | Add 3 audit calls, add traceId generation and parameter threading |
| `src/modules/identity/auth/guards/password-reset-mfa.guard.ts` | Extract traceId from JWT, attach to request |
| `src/modules/identity/auth/password-reset.controller.ts` | Pass traceId from request to `createResetTokenForSelf()` |

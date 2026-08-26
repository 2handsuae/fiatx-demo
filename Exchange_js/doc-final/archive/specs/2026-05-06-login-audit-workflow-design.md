# Login Audit Workflow (`ADMIN_LOGIN_ACCESS`) Design

## Goal

Model the admin login operation as a thin workflow (`ADMIN_LOGIN_ACCESS`) so that all audit actions within a single login attempt share the same `traceId` and `workflowType`. Currently the credential-validation action logs both fields, but the MFA-verification action (a separate HTTP request) logs neither.

## Scope

Only **Branch 2 (MFA login path)** is affected:

| Branch | Actions | Change needed |
|---|---|---|
| Branch 1 — First login | `ADMIN_LOGIN_SUCCESS` only; first-login is a separate workflow (`ADMIN_FIRST_LOGIN`) | None |
| Branch 2 — MFA login | `ADMIN_LOGIN_SUCCESS` + `MFA_LOGIN_VERIFIED` / `MFA_LOGIN_VERIFY_FAILED` | **Yes** |
| Branch 3 — Direct login (no MFA) | `ADMIN_LOGIN_SUCCESS` only; workflow completes in one request | None |

## Current Problem

```
POST /auth/login
  validateUser()  →  authTraceId = randomUUID()
                     logs ADMIN_LOGIN_SUCCESS with { traceId, workflowType }  ✅
  login(user)     →  signs mfaSessionToken WITHOUT authTraceId
                     returns { status: 'MFA_REQUIRED', mfaSessionToken }

POST /auth/mfa/verify
  verifyMfaLogin() → logs MFA_LOGIN_VERIFIED with { traceId: undefined, workflowType: undefined }  ❌
```

The `authTraceId` generated in `validateUser()` is never returned to the caller, so `login()` cannot embed it in the JWT, and `verifyMfaLogin()` has no way to reference it.

## Solution: Embed `loginTraceId` in JWT

The `authTraceId` flows through the `mfaSessionToken` JWT as a `loginTraceId` claim. Stateless, no DB changes.

### Data Flow (After)

```
POST /auth/login
  AuthController.login()
    → authService.validateUser()       generates authTraceId
                                       logs ADMIN_LOGIN_SUCCESS ✅
                                       returns { ...user, authTraceId }
    → authService.login(user)          reads user.authTraceId
                                       embeds loginTraceId in mfaSessionToken JWT
    → response: { status: 'MFA_REQUIRED', mfaSessionToken }

POST /auth/mfa/verify
  MfaSessionGuard                      extracts loginTraceId from JWT payload
                                       sets req.mfaSessionUser.loginTraceId
  FirstLoginController.verifyMfaLogin()
    → passes loginTraceId to service
  FirstLoginWorkflowService.verifyMfaLogin()
    → logs MFA_LOGIN_VERIFIED with { traceId: loginTraceId, workflowType: ADMIN_LOGIN_ACCESS } ✅
    → (or MFA_LOGIN_VERIFY_FAILED with same traceId + workflowType)
```

## Changes by File

### 1. `src/modules/identity/auth/auth.service.ts` — `validateUser()`

**Current:** On success, returns `{ ...user }` (password excluded). `authTraceId` is a local variable that never leaves the function.

**Change:** Return `{ ...user, authTraceId }` on success. Failed/null paths unchanged.

### 2. `src/modules/identity/auth/auth.service.ts` — `login()`

**Current:** `mfaSessionToken` payload contains `{ username, sub, userNo, role, roleCodes, scope, type }`.

**Change:** Read `user.authTraceId`. In Branch 2, add `loginTraceId: user.authTraceId` to the `mfaSessionToken` JWT payload. Branch 1 and Branch 3 unchanged.

### 3. `src/modules/identity/auth/guards/mfa-session.guard.ts`

**Current:** Extracts `{ userId, userNo, email, role, roleCodes }` from JWT payload into `req.mfaSessionUser`.

**Change:** Also extract `loginTraceId` from payload. Add to `req.mfaSessionUser`.

### 4. `src/modules/identity/auth/first-login.controller.ts` — `verifyMfaLogin()`

**Current:** Destructures `{ userId, userNo, email, role, roleCodes }` from `req.mfaSessionUser` and passes to service.

**Change:** Also destructure `loginTraceId`, pass it as additional argument.

### 5. `src/modules/identity/users/first-login-workflow.service.ts` — `verifyMfaLogin()`

**Current:** Signature is `verifyMfaLogin(userId, code, roleCodes, role, email, userNo)`. Audit logs for `MFA_LOGIN_VERIFIED` and `MFA_LOGIN_VERIFY_FAILED` have no `traceId` or `workflowType`.

**Change:**
- Add `loginTraceId?: string` parameter
- `MFA_LOGIN_VERIFIED` audit log: add `traceId: loginTraceId`, `workflowType: AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS`
- `MFA_LOGIN_VERIFY_FAILED` audit log: same additions

## JWT Payload Change

```typescript
// mfaSessionToken — before
{
  username, sub, userNo, role, roleCodes,
  scope: 'mfa_session',
  type: 'ADMIN',
}

// mfaSessionToken — after
{
  username, sub, userNo, role, roleCodes,
  scope: 'mfa_session',
  type: 'ADMIN',
  loginTraceId,           // <-- new: UUID from validateUser()
}
```

## What Does NOT Change

- `firstLoginToken` JWT — first-login is a separate workflow with its own `firstLoginTraceId`
- Audit constants (`AuditBusinessWorkflowTypes`, `AuditActions`) — all needed values already exist
- DB schema — no migration needed
- `buildLoginAuditContext()` helper — already produces the `{ traceId, workflowType }` shape; `verifyMfaLogin` uses the same pattern inline
- Branch 1 / Branch 3 logic — untouched

## Verification

After implementation, run the MFA login flow and query audit logs:

```sql
SELECT auditNo, action, traceId, workflowType
FROM audit_logs
WHERE traceId = '<the-trace-id>'
ORDER BY createdAt;
```

Expected: both `ADMIN_LOGIN_SUCCESS` and `MFA_LOGIN_VERIFIED` share the same `traceId` and `workflowType = 'ADMIN_LOGIN_ACCESS'`.

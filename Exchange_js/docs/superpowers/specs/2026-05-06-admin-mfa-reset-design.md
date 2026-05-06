# Admin MFA Reset — Design Spec

**Date:** 2026-05-06
**Status:** Approved

---

## Goal

Allow CISO and TECH_OFFICER to reset any admin user's MFA (including their own). After reset, the target user re-enters the existing 4-step first-login flow (PENDING_IDENTITY_CONFIRM → MFA_BINDING → POLICY_ACK_PENDING → COMPLETED) to rebind MFA.

No approval workflow required — direct execution with audit logging.

---

## API

**Endpoint:** `POST /admin/iam/users/:userId/reset-mfa`

**Guard:** `AdminPermissionGuard` — a new RBAC permission group `IAM_CREDENTIAL_RESET` bound to CISO and TECH_OFFICER.

**Request:** No body required. Target user identified by `:userId` path param.

**Response (200):**
```json
{
  "message": "MFA reset successful",
  "userId": "<uuid>",
  "userNo": "ADM-XXXXXX",
  "newStatus": "PENDING_IDENTITY_CONFIRM"
}
```

**Error responses:**
- `404` — Target user not found
- `403` — Caller lacks `IAM_CREDENTIAL_RESET` permission
- `409` — Target user not in a valid state for MFA reset (not ACTIVE, or MFA not bound)

---

## Preconditions

Both must be true for reset to proceed:
1. Target user `status === 'ACTIVE'`
2. Target user `mfaEnabledAt IS NOT NULL` (MFA was bound)

If status is not ACTIVE → 409 Conflict ("Cannot reset MFA for a non-active user").
If MFA not bound → 409 Conflict ("User has no MFA binding to reset").

Self-reset is allowed: a CISO/TECH_OFFICER can reset their own MFA.

---

## Execution — Domain Service

**New method:** `UsersDomainService.resetMfa(userId, tx?)`

Clears all MFA and first-login state in a single update:

```typescript
await client.user.update({
  where: { id: userId },
  data: {
    mfaSecret: null,
    mfaEnabledAt: null,
    mfaVerifyFailCount: 0,
    mfaVerifyLockedUntil: null,
    firstLoginStatus: 'PENDING_IDENTITY_CONFIRM',
    firstLoginTraceId: null,
    securityAckAt: null,
  },
});
```

Returns `{ id, userNo, email, role }` for audit enrichment.

---

## Workflow Service

**New file:** `src/modules/identity/users/admin-mfa-reset.service.ts`

Single method `executeMfaReset(targetUserId, actor)`:

1. Load target user, validate preconditions
2. Call `UsersDomainService.resetMfa(targetUserId)`
3. Record audit log `MFA_RESET_EXECUTED`
4. Return response payload

No transaction needed — single domain call + audit log (audit is fire-and-forget).

---

## Audit Logging

**Action:** `AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.MFA_RESET_EXECUTED`

**New constants to add:**

```typescript
// In AuditWorkflowTypes
ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',

// In AuditBusinessWorkflowTypes
ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',

// In AuditGovernanceActions
ADMIN_CREDENTIAL_MGMT: {
  MFA_RESET_EXECUTED: 'CREDENTIAL_MFA_RESET_EXECUTED',
},
```

**Audit record shape:**
```typescript
{
  action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.MFA_RESET_EXECUTED,
  entityType: AuditEntityTypes.ADMIN_USER,
  entityId: targetUser.id,
  entityNo: targetUser.userNo,
  workflowType: AuditWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
  traceId: <new UUID>,
  result: AuditResult.SUCCESS,
  metadata: {
    targetEmail: targetUser.email,
    targetRole: targetUser.role,
    selfReset: actor.actorId === targetUser.id,
  },
  sourcePlatform: 'ADMIN_API',
}
```

Actor context from JWT: `{ actorType: 'ADMIN', actorId, actorNo, actorRole }`.

---

## RBAC

**New permission group:** `IAM_CREDENTIAL_RESET`

**New route entry:**
```typescript
route('POST', '/admin/iam/users/:id/reset-mfa', 'Reset admin MFA', ['IAM_CREDENTIAL_RESET']),
```

**Role bindings — add `IAM_CREDENTIAL_RESET` to:**
- `CISO`
- `TECH_OFFICER`

(SUPER_ADMIN gets all permissions implicitly.)

---

## Controller

**New file:** `src/modules/identity/users/admin-credential-mgmt.controller.ts`

Separate from `AccessControlController` (which handles role/permission catalog queries). This controller owns credential-management operations under the `/admin/iam/users` path and will host future endpoints (password reset, session force-revocation).

```typescript
@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminCredentialMgmtController {
  constructor(private readonly adminMfaResetService: AdminMfaResetService) {}

  @Post('users/:id/reset-mfa')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/users/:id/reset-mfa'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset admin MFA binding (CISO / TECH_OFFICER)' })
  async resetMfa(@Param('id', new ParseUUIDPipe()) userId: string, @Req() req: any) {
    const actor = {
      actorType: 'ADMIN' as const,
      actorId: req.user.sub,
      actorNo: req.user.userNo,
      actorRole: req.user.role,
    };
    return this.adminMfaResetService.executeMfaReset(userId, actor);
  }
}
```

---

## Files to Change

| File | Action |
|------|--------|
| `src/modules/identity/users/users.domain.service.ts` | Add `resetMfa()` method |
| `src/modules/identity/users/admin-mfa-reset.service.ts` | **New** — workflow service |
| `src/modules/identity/users/admin-credential-mgmt.controller.ts` | **New** — controller for `POST /admin/iam/users/:id/reset-mfa` |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add `ADMIN_CREDENTIAL_MGMT` constants |
| `src/modules/identity/access-control/rbac.catalog.ts` | Add `IAM_CREDENTIAL_RESET` group + route + role bindings |
| `src/modules/identity/users/users.module.ts` | Register `AdminMfaResetService` provider + `AdminCredentialMgmtController` controller |

---

## What This Does NOT Change

- **No frontend changes** — after MFA reset, the target user simply sees the existing first-login page on next login
- **No firstLogin field rename** — deferred to a future task
- **No approval workflow** — direct execution per design decision
- **No notification to target user** — they discover the reset on next login attempt

---

## Post-Reset User Experience

1. Target user's current session JWT remains valid until expiry (no force-revocation)
2. On next login, `auth.service.login()` sees `firstLoginStatus !== 'COMPLETED'` → issues `firstLoginToken`
3. Frontend redirects to first-login page
4. User walks through: identity confirm → MFA bind → policy ack → gets full access token

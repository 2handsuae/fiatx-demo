# Admin Password Reset — Design Spec

Date: 2026-05-06
Status: Approved
Workflow ID: C5 (V1 MVP #6)
workflowType: ADMIN_CREDENTIAL_MGMT (shared with future MFA Reset and Session Force-Revocation)

## Purpose

Allow admins to reset their password through two paths: self-service (forgot password with MFA verification) and CISO-initiated (security response). No approval gate — password reset is a credential hygiene operation, not a governance action.

VARA basis: TIR Rulebook III.A Authentication — credential lifecycle management, immediate reset capability on compromise.

## Constraints (from brainstorm)

| Dimension | Decision |
|-----------|----------|
| Triggers | Self-service (email + MFA) and CISO-initiated |
| Approval gate | None |
| Session invalidation | V1: not implemented. Future: needs `tokenInvalidBefore` or session store |
| Token TTL | 15 minutes |
| Token usage | One-time, marked CONSUMED |
| Rate limit | One request per userId per 15 minutes (based on `createdAt`, not status) |
| Self-service identity verification | Email + TOTP MFA code |
| Token storage | SHA-256 hash (not bcrypt) — enables `@unique` index lookup |

## Data Model

### New table: `PasswordResetToken`

```prisma
model PasswordResetToken {
  id                String    @id @default(uuid())
  resetNo           String    @unique @default("TEMP")
  userId            String
  tokenHash         String    @unique
  status            String    @default("PENDING")
  requestSource     String                          // SELF | CISO
  requestedByUserId String?                         // CISO's userId (null for SELF)
  requestedByUserNo String?                         // CISO's userNo
  expiresAt         DateTime
  consumedAt        DateTime?
  traceId           String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status, expiresAt])
  @@index([traceId, createdAt])
  @@map("password_reset_tokens")
}
```

Add inverse relation on `User`: `passwordResetTokens PasswordResetToken[]`

`resetNo` generated via `generateReferenceNo('PWR')` → e.g. `PWR2605060012`.

### Status machine

```
PENDING ──→ CONSUMED   (token used, password updated)
PENDING ──→ REVOKED    (new request supersedes this token)
```

`EXPIRED` is not persisted. Domain service computes it at read time: `status=PENDING && expiresAt <= now`.

### Rate limit logic

Query `WHERE userId = :id AND createdAt > now() - 15min`. If any row exists (regardless of status), reject with `TOO_MANY_REQUESTS`.

## Three-Layer Architecture

### Layer 1 — Domain Service (`users.domain.service.ts`)

New method `resetPassword(userId: string, newPasswordHash: string, tx?: Prisma.TransactionClient)`:
- Precondition: user exists, `deletedAt` is null.
- Precondition: `status` must be `ACTIVE`.
- Precondition: `firstLoginStatus` must be `COMPLETED`.
- Action: update `password`, set `failedLoginAttempts = 0`, clear `lockedUntil = null`.
- Does NOT write audit logs (Layer 1 rule).

### Layer 2 — Approval Sub-Workflow

None. This workflow has no approval gate.

### Layer 3 — Workflow (`admin-password-reset-workflow.service.ts`)

New file. Orchestrates the full journey across two phases: request and consume.

**Phase 1 — Request (self-service path):**

`requestSelfServiceReset(email: string)`:
1. Find user by email. If not found or status ≠ ACTIVE or firstLoginStatus ≠ COMPLETED or mfaEnabledAt is null → return `{ status: 'MFA_REQUIRED' }` with no `mfaSessionToken` field (anti-enumeration: same HTTP 200 shape, but client cannot proceed to verify-mfa without a token).
2. User valid → generate scoped JWT: `{ sub: userId, scope: 'password_reset_mfa', exp: 5min }`.
3. Return `{ status: 'MFA_REQUIRED', mfaSessionToken }`.

`verifySelfServiceMfa(userId: string, code: string)`:
1. Verify TOTP code (reuse existing otplib logic + fail count / lockout).
2. On success → call `createResetToken(userId, 'SELF', null, null)`.

**Phase 1 — Request (CISO path):**

`requestCisoReset(targetUserId: string, actor: { userId, userNo })`:
1. Validate: target exists, status = ACTIVE, firstLoginStatus = COMPLETED, mfaEnabledAt not null.
2. Validate: actor ≠ target (cannot reset own password via CISO path).
3. Validate: target is not SUPER_ADMIN.
4. Call `createResetToken(targetUserId, 'CISO', actor.userId, actor.userNo)`.

**Shared: `createResetToken(userId, requestSource, requestedByUserId?, requestedByUserNo?)`:**
1. Rate limit check: query by userId + createdAt > 15min ago → reject if exists.
2. Revoke existing: update all PENDING tokens for this userId to REVOKED, write `PASSWORD_RESET_REVOKED` audit per token. (Defensive: normally rate limit prevents reaching here, but handles edge cases like clock drift or future rate-limit policy changes.)
3. Generate token: `randomBytes(32).toString('hex')`.
4. Hash: `createHash('sha256').update(token).digest('hex')`.
5. Generate `resetNo` via `generateReferenceNo('PWR')`.
6. Generate `traceId` via `randomUUID()`.
7. Create `PasswordResetToken` row (status: PENDING, expiresAt: now + 15min).
8. Send email with plaintext token in link.
9. Write audit: `PASSWORD_RESET_REQUESTED`.
10. Return `{ resetNo, status: 'RESET_EMAIL_SENT' }`.

**Phase 2 — Consume:**

`consumeResetToken(plainToken: string, newPassword: string)`:
1. Hash token → SHA-256.
2. Find by `tokenHash` (unique index). Not found → generic error `INVALID_OR_EXPIRED_TOKEN`.
3. Check `status = PENDING`. Otherwise → same generic error.
4. Check `expiresAt > now`. Otherwise → same generic error.
5. Load target user. Check `status = ACTIVE` (may have been suspended since token was issued). Otherwise → reject.
6. `prisma.$transaction`:
   a. `usersDomainService.resetPassword(userId, bcryptHash(newPassword), tx)`
   b. Update token: `status = CONSUMED`, `consumedAt = now`.
7. Write audit: `PASSWORD_RESET_COMPLETED`.
8. Return `{ status: 'PASSWORD_RESET_COMPLETE' }`.
9. On failure: write audit `PASSWORD_RESET_FAILED` with reason in metadata.

## API Endpoints

### Public endpoints (no JWT guard)

**`POST /auth/password-reset/request`**
- Body: `{ email: string }`
- Response: `{ status: 'MFA_REQUIRED', mfaSessionToken?: string }`
- Always returns same shape regardless of whether user exists (anti-enumeration).

**`POST /auth/password-reset/verify-mfa`**
- Guard: MfaSession scope (`password_reset_mfa`)
- Body: `{ code: string }`
- Response (success): `{ status: 'RESET_EMAIL_SENT' }`
- Response (fail): MFA error with remaining attempts

**`POST /auth/password-reset/consume`**
- Body: `{ token: string, newPassword: string }`
- Response (success): `{ status: 'PASSWORD_RESET_COMPLETE' }`
- Response (fail): `{ code: 'INVALID_OR_EXPIRED_TOKEN' }` (unified error, no detail leak)

### Protected endpoint (JWT + RBAC)

**`POST /admin/iam/members/:userId/password-reset`**
- Guard: JWT + `@RequirePermissions` (CISO role)
- Body: none
- Response: `{ resetNo: string, status: 'RESET_EMAIL_SENT' }`

## Audit Logging

### Actions (under `AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT`)

| Action | When | Record method |
|--------|------|---------------|
| `PASSWORD_RESET_REQUESTED` | Token created (self or CISO) | `recordByActor` |
| `PASSWORD_RESET_COMPLETED` | Token consumed, password updated | `recordSystem` |
| `PASSWORD_RESET_FAILED` | Token invalid/expired/user suspended | `recordSystem` |
| `PASSWORD_RESET_REVOKED` | Existing PENDING token superseded | `recordSystem` |

### Common fields on all audit rows

- `workflowType`: `ADMIN_CREDENTIAL_MGMT`
- `entityType`: `PASSWORD_RESET_TOKEN`
- `entityId`: `passwordResetToken.id`
- `entityNo`: `passwordResetToken.resetNo`
- `traceId`: from `passwordResetToken.traceId`
- `entityOwnerNo`: target admin's userNo

### Subject Nos

- `ACTOR`: initiator userNo (on REQUESTED event)
- `OWNER`: target admin userNo (all events)
- `ENTITY`: resetNo (all events)

### Metadata by event

| Event | metadata |
|-------|----------|
| REQUESTED (SELF) | `{ requestSource: 'SELF' }` |
| REQUESTED (CISO) | `{ requestSource: 'CISO', targetUserNo }` |
| COMPLETED | `{ requestSource }` |
| FAILED | `{ reason, requestSource }` |
| REVOKED | `{ supersededByResetNo }` |

## Security

### Token security

- Generated: `randomBytes(32).toString('hex')` — 64 character high-entropy string
- Stored: SHA-256 hash only. Plaintext appears only in the email link.
- Lookup: via `@unique` index on `tokenHash`.

### State gate checks (on request)

| Check | Self-service | CISO |
|-------|-------------|------|
| Target status = ACTIVE | ✅ | ✅ |
| Target firstLoginStatus = COMPLETED | ✅ | ✅ |
| Target mfaEnabledAt not null | ✅ | ✅ |
| Target deletedAt = null | ✅ | ✅ |
| Actor ≠ target | — | ✅ |
| Target is not SUPER_ADMIN | — | ✅ |

### On consume

1. Token hash lookup — not found → `INVALID_OR_EXPIRED_TOKEN`
2. Status ≠ PENDING → same error
3. expiresAt ≤ now → same error
4. Target user status ≠ ACTIVE → reject (may have been suspended since issuance)
5. All checks pass → `$transaction`: update password + mark CONSUMED

### Anti-enumeration

- `/request`: identical response shape whether user exists or not
- `/consume`: unified error code, no distinction between "not found", "expired", "already used"

### MFA verification (self-service only)

- Scoped JWT (`password_reset_mfa`, 5 min TTL) issued after email submission
- TOTP verification reuses existing otplib + fail count / 15-min lockout logic
- MFA-scoped token cannot access any other endpoint

## Frontend

### New page: `ResetPasswordPage.tsx`

- Route: `/reset-password` (public, no auth guard)
- Reads `token` from URL query param
- Shows: new password + confirm password form
- On submit: `POST /auth/password-reset/consume`
- Success: "Password has been reset" message + redirect to `/login`
- Error: "Link is invalid or expired" message + "Request new reset" link

### Modified: `AdminLogin.tsx`

- Add "Forgot Password?" link below login form
- Clicking toggles inline step flow (no route change):
  - Step 1: email input → submit → `POST /auth/password-reset/request`
  - Step 2: MFA code input → submit → `POST /auth/password-reset/verify-mfa`
  - Step 3: success message "Reset link sent to your email"
- "Back to login" link at each step

### Modified: `PlatformMemberDetailPage.tsx`

- Add "Reset Password" button in action section
- Visible only to users with CISO role permission
- Disabled when target is SUPER_ADMIN or target status ≠ ACTIVE
- Click → confirmation dialog → `POST /admin/iam/members/:userId/password-reset`
- Success toast: "Reset link sent to {email}"

## Email

### Template (shared by both paths, content varies by `requestSource`)

- **Subject**: `[Exchange] Password Reset Request`
- **Link**: `{ADMIN_URL}/reset-password?token={plainToken}`
- **Expiry notice**: "This link expires in 15 minutes."
- **Source notice (SELF)**: "You requested a password reset."
- **Source notice (CISO)**: "A security administrator has initiated a password reset for your account."
- **Safety notice**: "If you did not request this, please contact your security team immediately."

Sending: synchronous call to notification service after token creation. Send failure does not block the flow (token is created; admin can request again).

## Out of V1 Scope (documented for future)

- Session invalidation after password reset (needs `tokenInvalidBefore` field or session store — shared infra with MFA Reset and Session Force-Revocation)
- Password history check (prevent reuse of N previous passwords)
- Password expiry policy (forced periodic rotation)
- Expired token cleanup cron (PENDING tokens past expiresAt accumulate but are harmless — domain service treats them as expired at read time)

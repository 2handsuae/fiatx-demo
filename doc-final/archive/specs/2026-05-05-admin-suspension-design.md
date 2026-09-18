# Admin Account Suspension — Design Spec

Date: 2026-05-05
Status: Approved
Workflow ID: C4 (V1 MVP)

## Purpose

Allow CISO or TECH_OFFICER to suspend an admin account through a governed approval flow. On execution, the target account transitions to SUSPENDED status and all active sessions become invalid on their next request.

VARA reference: TIR Rulebook IV.C Incident Response — must be able to immediately revoke system access during security events.

## Three-Layer Architecture

### Layer 1 — Domain Service (`users.domain.service.ts`)

New method `suspendUser(userId: string, tx?: Prisma.TransactionClient)`:
- Precondition: user exists, `status` is ACTIVE or INACTIVE, `deletedAt` is null.
- Precondition: user is NOT SUPER_ADMIN (checked via `user_roles` binding, not legacy `role` field).
- Transition: sets `status = SUSPENDED`, writes `suspendedAt = now()`.
- Does NOT write audit logs (Layer 1 rule).

### Layer 2 — Approval Sub-Workflow (`admin-suspension-approval.service.ts`)

New file. Extends `ApprovalHandlerBase`.

Constants:
- `actionType`: `ADMIN_SUSPENSION_APPROVAL`
- `workflowType`: `AuditWorkflowTypes.ADMIN_SUSPENSION`
- `auditActions`: `AuditGovernanceActions.ADMIN_SUSPENSION`
- `entityType`: `AuditEntityTypes.ADMIN_USER`

Writes approval-layer audit logs only: APPROVAL_GRANTED, APPROVAL_DECLINED, APPROVAL_CANCELLED.

### Layer 3 — Workflow (`admin-suspension-workflow.service.ts`)

New file. Orchestrates the full journey.

**Initiation** (`initiateSuspension`):
1. Validate: target user exists, is ACTIVE or INACTIVE, is not SUPER_ADMIN, is not the requesting actor.
2. Check no duplicate: no existing PENDING approval of type `ADMIN_SUSPENSION_APPROVAL` for same target user.
3. Create ApprovalCase via `approvalsService.createDraftCase` + `submitCase`.
4. Write audit: `SUSPENSION_REQUESTED`.
5. Return approval reference.

**Approval decided** (`handleApprovalDecided`, via `@OnEvent`):
- APPROVED: call `usersDomainService.suspendUser(targetUserId, tx)` inside transaction, then write audit `ACCOUNT_SUSPENDED`.
- REJECTED/CANCELLED: no domain action, approval service handles its own audit.

## Status Machine

### User.status (Prisma enum)

Add `SUSPENDED` to `UserStatus` enum.

```
ACTIVE ──→ SUSPENDED
INACTIVE ──→ SUSPENDED
SUSPENDED ──→ (blocked; reactivation = C4b, not in scope)
```

`SUSPENDED` users cannot:
- Log in (login endpoint rejects)
- Make any authenticated API call (JWT strategy rejects)

### ApprovalCase

Standard: `PENDING → APPROVED / REJECTED / EXPIRED / CANCELLED`

## Approval Policy

| Field | Value |
|---|---|
| actionType | `ADMIN_SUSPENSION_APPROVAL` |
| riskLevel | `HIGH` |
| checkerRoles | `SENIOR_MANAGEMENT_OFFICER` |
| timeoutHours | 48 |
| allowCancel | true |
| allowRetry | false |

Maker roles: CISO, TECH_OFFICER (enforced via RBAC permission on the endpoint, not in the approval policy).

## Session Revocation Strategy

**Demo implementation (this spec):** JWT Strategy (`jwt.strategy.ts`) adds a DB lookup on every `validate()` call to check `user.status`. If SUSPENDED, throw `UnauthorizedException`. This means tokens are not instantly invalidated but become useless on the next API call.

**Production note:** For real-time revocation, a token blacklist (Redis or DB-backed) with `jti` tracking is required. This is out of scope for the demo system and should be marked in the roadmap.

## Guard Rails

| Rule | Implementation |
|---|---|
| SUPER_ADMIN cannot be suspended | Workflow initiation rejects with explicit error |
| Cannot suspend yourself | Workflow initiation checks `actor.userId !== targetUserId` |
| No duplicate pending suspension | Workflow checks for existing PENDING `ADMIN_SUSPENSION_APPROVAL` on same target |
| SoD maker-checker | Standard `DENY_SAME_USER_MAKER_CHECKER` rule applies |

## Audit Event Sequence

All events use `workflowType = ADMIN_SUSPENSION`, `entityType = ADMIN_USER`.

```
1. SUSPENSION_REQUESTED     — recordByActor (Maker initiates)
2. APPROVAL_GRANTED         — recordByActor (SMO approves)
   — or APPROVAL_DECLINED / APPROVAL_CANCELLED
3. ACCOUNT_SUSPENDED        — recordSystem (execution result)
```

`subjectNos` on each event:
- `ENTITY` → target user (`userNo`)
- `RELATED` → approval case (`approvalNo`)

## API Endpoint

```
POST /users/:id/suspend
Body: { reason: string }
Auth: JWT + RBAC (CISO or TECH_OFFICER)
Response: { approvalNo, traceId, targetUserNo, status: 'PENDING' }
```

## Database Changes

1. **Prisma schema** — add `SUSPENDED` to `UserStatus` enum.
2. **Prisma schema** — add `suspendedAt DateTime?` field to `users` table.
3. **Migration** — new migration file for enum + field addition.
4. **Seed** — add `ADMIN_SUSPENSION_APPROVAL` to `approval_action_policies` table.

## Files to Create/Modify

| Action | File |
|---|---|
| Create | `src/modules/identity/users/admin-suspension-approval.service.ts` |
| Create | `src/modules/identity/users/admin-suspension-workflow.service.ts` |
| Modify | `src/modules/identity/users/users.domain.service.ts` — add `suspendUser()` |
| Modify | `src/modules/identity/users/users.controller.ts` — add suspend endpoint |
| Modify | `src/modules/identity/users/users.module.ts` — register new services |
| Modify | `src/modules/identity/auth/jwt.strategy.ts` — SUSPENDED check |
| Modify | `src/modules/governance/approvals/constants/approval.constants.ts` — add action type + policy |
| Modify | `prisma/schema.prisma` — UserStatus enum + suspendedAt field |
| Create | `prisma/migrations/xxx_add_user_suspended/` — migration |
| Modify | `prisma/seed.ts` or equivalent — seed approval policy |
| Modify | `doc-final/reference/roadmap.md` — mark C4 done + production session revoke note |

## Out of Scope

- C4b Admin Account Reactivation (separate workflow)
- JWT token blacklist / session store (production enhancement)
- Admin First Login / MFA (C2)
- In-flight approval cancellation on suspension

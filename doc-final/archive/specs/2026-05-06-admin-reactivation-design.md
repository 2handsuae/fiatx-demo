# C4b Admin Account Reactivation — Design Spec

Date: 2026-05-06
Status: Approved
Workflow ID: C4b (V1 MVP)
Depends on: C4 Admin Account Suspension (complete)

## Purpose

Allow CISO or TECH_OFFICER to reactivate a SUSPENDED admin account through a governed approval flow. On execution, the target account transitions back to ACTIVE and regains access to the admin panel.

Mirror of C4 (suspension) — same permission model, same 3-layer architecture, same approval policy shape.

## Three-Layer Architecture

### Layer 1 — Domain Service (`users.domain.service.ts`)

New method `reactivateUser(userId: string, tx?: Prisma.TransactionClient)`:
- Precondition: user exists, `deletedAt` is null.
- Precondition: `status` must be `SUSPENDED`. All other statuses rejected with `ConflictException`.
- Precondition: user is NOT SUPER_ADMIN (defensive — SUPER_ADMIN cannot be suspended in the first place).
- Transition: sets `status = ACTIVE`, clears `suspendedAt = null`.
- Does NOT write audit logs (Layer 1 rule).

### Layer 2 — Approval Sub-Workflow (`admin-reactivation-approval.service.ts`)

New file. Extends `ApprovalHandlerBase`.

Constants:
- `actionType`: `ADMIN_REACTIVATION_APPROVAL`
- `workflowType`: `AuditBusinessWorkflowTypes.ADMIN_REACTIVATION`
- `auditActions`: `AuditGovernanceActions.ADMIN_REACTIVATION` (`.APPROVAL_GRANTED`, `.APPROVAL_DECLINED`, `.APPROVAL_CANCELLED`)
- `entityType`: `AuditEntityTypes.ADMIN_USER`

These audit action constants are already pre-registered in `audit-actions.constant.ts`.

### Layer 3 — Workflow (`admin-reactivation-workflow.service.ts`)

New file. Orchestrates the full journey.

**Initiation** (`initiateReactivation`):
1. Validate: target user exists, status is `SUSPENDED`, is not SUPER_ADMIN, is not the requesting actor.
2. Check no duplicate: no existing PENDING approval of type `ADMIN_REACTIVATION_APPROVAL` for same target user.
3. Create ApprovalCase via `approvalsService.createAndSubmit`.
4. Write audit: `REACTIVATION_REQUESTED`.
5. Return approval reference.

**Approval decided** (`handleApprovalDecided`, via `@OnEvent`):
- APPROVED: call `usersDomainService.reactivateUser(targetUserId)`, then write audit `ACCOUNT_REACTIVATED`, then `markExecutionResult(success)`.
- REJECTED/CANCELLED: no domain action, approval service handles its own audit.
- Execution failure: write audit with `FAILED` result, `markExecutionResult(false)`.

## Status Machine

### User.status

```
SUSPENDED ──→ ACTIVE    (reactivation approved)
```

Reactivated users regain full access immediately on the next API call (JWT strategy checks `user.status` per request).

## Approval Policy

| Field | Value |
|---|---|
| actionType | `ADMIN_REACTIVATION_APPROVAL` |
| riskLevel | `HIGH` |
| checkerRoles | `SENIOR_MANAGEMENT_OFFICER` |
| timeoutHours | 48 |
| allowCancel | true |
| allowRetry | false |

Maker roles: CISO, TECH_OFFICER (enforced via RBAC permission on the endpoint, not in the approval policy).

## Guard Rails

| Rule | Implementation |
|---|---|
| Only SUSPENDED users can be reactivated | Domain service rejects other statuses |
| SUPER_ADMIN guard | Domain service checks (defensive) |
| Cannot reactivate yourself | Workflow initiation checks `actor.userId !== targetUserId` |
| No duplicate pending reactivation | Workflow checks existing PENDING `ADMIN_REACTIVATION_APPROVAL` on same target |
| SoD maker-checker | Standard `DENY_SAME_USER_MAKER_CHECKER` rule applies |

## Audit Event Sequence

All events use `workflowType = ADMIN_REACTIVATION`, `entityType = ADMIN_USER`.

```
1. REACTIVATION_REQUESTED   — recordByActor (Maker initiates)
2. APPROVAL_GRANTED          — recordByActor (SMO approves)
   — or APPROVAL_DECLINED / APPROVAL_CANCELLED
3. ACCOUNT_REACTIVATED       — recordSystem (execution result)
```

`subjectNos` on each event:
- `ENTITY` → target user (`userNo`)
- `RELATED` → approval case (`approvalNo`)

## API Endpoint

```
POST /users/:id/reactivate
Body: { reason: string }
Auth: JWT + RBAC (CISO or TECH_OFFICER via IAM_ASSIGN)
Response: { approvalNo, traceId, targetUserNo, status: 'PENDING' }
```

## Frontend UI

### Reactivate Button

- **Location**: Sidebar Actions section of `PlatformMemberDetailPage`
- **Visibility**: `member.status === 'SUSPENDED'` AND `hasAnyPermission([PERMISSIONS.USERS_REACTIVATE])`
- **Variant**: `adminButtonClass('workflowPrimary')` — amber primary (positive action)
- **Icon**: `UserCheck` from `lucide-react`
- **Label**: "Reactivate User"

### Reactivate Confirmation Modal

Same header/body/footer pattern as Suspend modal:
- **Title**: "Reactivate Admin Account"
- **Subtitle**: `{member.userNo} · {member.email}`
- **Warning box**: amber tint — "This will submit a reactivation request for approval. If approved, this user will regain access to the admin panel."
- **Reason textarea**: Required, placeholder "Describe why this account should be reactivated…"
- **Submit button**: `modalConfirm` variant, label "Submit for Approval"
- **API call**: `POST /users/${id}/reactivate` with `{ reason }`, same error handling pattern

### Permission Constant

Add to `admin-web/src/rbac/permissions.ts`:
```typescript
USERS_REACTIVATE: 'api.post.users_id_reactivate',
```

### State Additions

```typescript
const [showReactivateModal, setShowReactivateModal] = useState(false);
const [reactivateReason, setReactivateReason] = useState('');
const [submittingReactivate, setSubmittingReactivate] = useState(false);
```

## Backend Files Changed

| Action | File |
|---|---|
| Create | `src/modules/identity/users/admin-reactivation-approval.service.ts` |
| Create | `src/modules/identity/users/admin-reactivation-workflow.service.ts` |
| Modify | `src/modules/identity/users/users.domain.service.ts` — add `reactivateUser()` |
| Modify | `src/modules/identity/users/users.controller.ts` — add reactivate endpoint |
| Modify | `src/modules/identity/users/users.module.ts` — register new services |
| Modify | `src/modules/governance/approvals/constants/approval.constants.ts` — add action type + policy |
| Modify | `src/modules/governance/approvals/approvals.service.ts` — add `ADMIN_REACTIVATION` to `hasDedicatedAuditService` |
| Modify | `src/modules/identity/access-control/rbac.catalog.ts` — add reactivate permission route |

## Frontend Files Changed

| Action | File |
|---|---|
| Modify | `admin-web/src/rbac/permissions.ts` — add `USERS_REACTIVATE` |
| Modify | `admin-web/src/pages/PlatformMemberDetailPage.tsx` — add `UserCheck` import, 3 state vars, handler, button, modal |

## Out of Scope

- Reactivation to a status other than ACTIVE (always ACTIVE)
- Password reset on reactivation (user retains existing credentials)
- Notification to the reactivated user (email/Slack)
- Reactivation audit dashboard or reporting

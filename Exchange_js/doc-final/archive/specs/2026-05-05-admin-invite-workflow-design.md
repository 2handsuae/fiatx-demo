# Admin Invite Workflow — V1 Redesign Spec

Date: 2026-05-05 | Status: Approved | Scope: V1 Workflow #1

---

## 1. Architecture Overview

Complete rewrite following strict three-layer architecture. Existing `admin-invite-approval.service.ts` (single-file pattern) will be deleted and replaced by:

```
src/modules/identity/users/
├── users.domain.service.ts          # Layer 1 — User entity operations
├── admin-invite-approval.service.ts # Layer 2 — ApprovalHandlerBase subclass
├── admin-invite-workflow.service.ts  # Layer 3 — Orchestrates full journey
├── admin-invitations.service.ts     # Utility — Token management (kept)
├── users.controller.ts              # Transport only
└── users.service.ts                 # Legacy queries (kept for read model)

src/modules/governance/approvals/
├── approval-handler.base.ts         # NEW — Abstract base class for all L2
└── approvals.service.ts             # Existing approval engine
```

### Event Flow (Two-Stage Dispatch)

```
ApprovalEngine emits → governance.approval.approved
                     ↓
Layer 2 (ApprovalHandlerBase) subscribes via @OnEvent
  → filters by actionType
  → writes approval audit logs (APPROVAL_GRANTED/DECLINED/CANCELLED)
  → emits secondary event: workflow.admin-invite.decided
                     ↓
Layer 3 (Workflow) subscribes to secondary event
  → executes business actions (create token, update status, dispatch link)
  → writes business audit logs
```

---

## 2. ApprovalHandlerBase Abstract Class

New file: `src/modules/governance/approvals/approval-handler.base.ts`

```typescript
export abstract class ApprovalHandlerBase {
  // Subclass provides exactly 4 constants:
  abstract readonly actionType: string;       // e.g. 'ADMIN_INVITE_APPROVAL'
  abstract readonly workflowType: string;     // e.g. 'ADMIN_INVITE'
  abstract readonly auditActions: {
    granted: string;
    declined: string;
    cancelled: string;
  };
  abstract readonly entityType: string;       // e.g. 'ACCESS_CONTROL'

  // Base class provides all @OnEvent handler implementations:
  // - handleApproved(event) → filter by actionType → write audit → emit secondary
  // - handleRejected(event) → filter by actionType → write audit → emit secondary
  // - handleCancelled(event) → filter by actionType → write audit → emit secondary
  // - handleExpired(event)  → filter by actionType → write audit → emit secondary
}
```

Secondary event payload shape:
```typescript
interface ApprovalDecidedEvent {
  decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  actionType: string;
  entityRef: string;
  approvalId: string;
  approvalNo: string;
  traceId: string;
  decisionByUserId?: string;
  decisionByUserNo?: string;
  decisionByRole?: string;
  decisionReason?: string;
  decidedAt: string;
  metadata: Record<string, any>;
}
```

Secondary event name format: `workflow.[workflowType-kebab].decided`
Example: `workflow.admin-invite.decided`

---

## 3. User Entity Status Machine

Single `status` field on User model. No separate approval axis.

### States (5 values)

| Status | Meaning |
|--------|---------|
| `PENDING_INVITE_APPROVAL` | User record created, waiting for approval |
| `INVITE_SENT` | Approved, invitation link dispatched |
| `ACTIVE` | Account activated by user |
| `PENDING_SUSPENSION_APPROVAL` | Suspension requested, waiting for approval |
| `SUSPENDED` | Account suspended |

### Transition Graph (Invite Workflow scope)

```
[create] → PENDING_INVITE_APPROVAL
  → INVITE_SENT         (approval granted + invite dispatched)
  → [physical delete]   (approval declined/cancelled/expired)

INVITE_SENT
  → ACTIVE              (user accepts invitation + sets password)
  → INVITE_SENT         (resend — no status change, new token only)

ACTIVE
  → (out of scope for this workflow)
```

Physical deletion rationale: A rejected invite means the user never existed operationally. The audit trail captures the full governance record. No terminal `REJECTED` state pollutes the user list.

---

## 4. Workflow Lifecycle (5 Paths)

### Path 1: Happy Path (Invite → Approve → Activate)
1. Admin submits invite request (email + roleCodes)
2. Layer 3 creates provisional User (PENDING_INVITE_APPROVAL) via Layer 1
3. Layer 3 binds roles via AccessControlService
4. Layer 3 submits approval case via ApprovalsService
5. Audit: `INVITE_REQUESTED`
6. Checker approves → Layer 2 writes `APPROVAL_GRANTED` → emits secondary
7. Layer 3 receives secondary → creates invitation token → updates status to INVITE_SENT
8. Audit: `INVITE_DISPATCHED`
9. User clicks link → sets password → status becomes ACTIVE
10. Audit: `ACCOUNT_ACTIVATED`

### Path 2: Approval Declined
1-5 same as Path 1
6. Checker declines → Layer 2 writes `APPROVAL_DECLINED` → emits secondary
7. Layer 3 receives secondary → physically deletes User record
8. Audit: `INVITE_CANCELLED` (with reason)

### Path 3: Approval Cancelled (by maker)
1-5 same as Path 1
6. Maker cancels → Layer 2 writes `APPROVAL_CANCELLED` → emits secondary
7. Layer 3 receives secondary → physically deletes User record
8. Audit: `INVITE_CANCELLED`

### Path 4: Approval Expired
1-5 same as Path 1
6. Timeout → Layer 2 writes `APPROVAL_CANCELLED` (expired) → emits secondary
7. Layer 3 receives secondary → physically deletes User record
8. Audit: `INVITE_CANCELLED` (expired)

### Path 5: Resend Invitation
Precondition: User.status = INVITE_SENT or INACTIVE
1. Admin requests resend
2. Layer 3 revokes existing tokens, creates new one
3. No re-approval required
4. Audit: `INVITE_RESENT`

### SoD Rules
- Maker cannot approve own request (standard SoD)
- Exception: SUPER_ADMIN role can self-approve (explicit bypass, audited)

---

## 5. API Contract

### 5.1 POST /users — Initiate Invite

Request:
```json
{
  "email": "user@example.com",
  "roleCodes": ["COMPLIANCE_OFFICER"],
  "changeReason": "New hire for compliance team"
}
```

Response 201:
```json
{
  "userId": "uuid",
  "userNo": "ADM-XXXXXX",
  "email": "user@example.com",
  "status": "PENDING_INVITE_APPROVAL",
  "approvalNo": "APR-XXXXXX",
  "approvalStatus": "PENDING"
}
```

### 5.2 GET /users — List Members

Query: `?skip=0&take=20`

Response 200: Array of:
```json
{
  "id": "uuid",
  "userNo": "ADM-XXXXXX",
  "email": "user@example.com",
  "role": "COMPLIANCE_OFFICER",
  "status": "ACTIVE",
  "roles": ["COMPLIANCE_OFFICER", "VIEWER"],
  "createdAt": "ISO",
  "lastLoginAt": "ISO"
}
```

### 5.3 GET /users/:id — Member Detail

Response 200:
```json
{
  "id": "uuid",
  "userNo": "ADM-XXXXXX",
  "email": "user@example.com",
  "role": "COMPLIANCE_OFFICER",
  "status": "ACTIVE",
  "roles": ["COMPLIANCE_OFFICER", "VIEWER"],
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "lastLoginAt": "ISO",
  "invitation": {
    "status": "CONSUMED",
    "expiresAt": "ISO",
    "consumedAt": "ISO"
  },
  "approval": {
    "approvalNo": "APR-XXXXXX",
    "status": "APPROVED",
    "requestedAt": "ISO",
    "decidedAt": "ISO"
  }
}
```

### 5.4 POST /users/:id/invitations/resend — Resend Invitation

No body required.

Response 200:
```json
{
  "userId": "uuid",
  "userNo": "ADM-XXXXXX",
  "email": "user@example.com",
  "status": "INVITE_SENT",
  "inviteLink": "https://admin.example.com/admin/activate?token=...",
  "inviteExpiresAt": "ISO",
  "inviteStatus": "PENDING"
}
```

### 5.5 GET /admin-invitations/preview?token=xxx — Invitation Preview (public)

Response 200:
```json
{
  "email": "user@example.com",
  "userNo": "ADM-XXXXXX",
  "expiresAt": "ISO",
  "status": "PENDING"
}
```

### 5.6 POST /admin-invitations/accept — Accept Invitation (public)

Request:
```json
{
  "token": "...",
  "password": "newSecurePassword123"
}
```

Response 200:
```json
{
  "userId": "uuid",
  "userNo": "ADM-XXXXXX",
  "email": "user@example.com",
  "status": "ACTIVE"
}
```

---

## 6. Audit Log Actions

### Layer 2 (Approval Sub-Workflow) — 3 actions

| Action | When | Result |
|--------|------|--------|
| `APPROVAL_GRANTED` | Checker approves | SUCCESS |
| `APPROVAL_DECLINED` | Checker declines | REJECTED |
| `APPROVAL_CANCELLED` | Maker cancels or expires | SUCCESS |

### Layer 3 (Workflow) — 7 actions

| Action | When | Result |
|--------|------|--------|
| `INVITE_REQUESTED` | Invite submitted to approval | SUCCESS |
| `INVITE_DISPATCHED` | Invite token created + link generated | SUCCESS |
| `INVITE_RESENT` | Resend triggered | SUCCESS |
| `INVITE_CANCELLED` | Declined/cancelled/expired → user deleted | SUCCESS |
| `ACCOUNT_ACTIVATED` | User accepts invite + sets password | SUCCESS |
| `ACCOUNT_ACTIVATION_FAILED` | Accept invitation fails | FAILED |
| `INVITE_DISPATCH_FAILED` | Token generation fails post-approval | FAILED |

All audit writes include: `workflowType: 'ADMIN_INVITE'`, `traceId`, `entityType: 'ACCESS_CONTROL'`, `entityId`, `entityNo`.

---

## 7. Frontend Design

### 7.1 Platform Members List Page (`PlatformMembers.tsx`)

- Table columns: userNo, email, role, status (badge), createdAt, lastLoginAt
- Status badge colors: PENDING_INVITE_APPROVAL=orange, INVITE_SENT=blue, ACTIVE=green, SUSPENDED=red
- "Invite New Member" button → modal with email + role selector + optional reason
- Row click → navigate to detail page

### 7.2 Platform Member Detail Page (`PlatformMemberDetailPage.tsx`)

- Header: userNo, email, status badge
- Sections:
  - Basic Info: role, roles list, timestamps
  - Invitation Status: current token status, expiry, consumed date
  - Approval History: linked approval case summary
- Actions (contextual by status):
  - INVITE_SENT → "Resend Invitation" button
  - PENDING_INVITE_APPROVAL → no actions (waiting for approval)
  - ACTIVE → (future: suspend, role change — out of scope for this workflow)

### 7.3 Invitation Accept Page (`/admin/activate?token=xxx`)

- Public page (no auth required)
- Flow: token → preview API → show email + expiry → password form → submit → redirect to login
- Error states: expired, consumed, revoked, invalid

---

## 8. Implementation Dependencies

### Must Build First (shared infrastructure)
1. `ApprovalHandlerBase` abstract class
2. Secondary event emission pattern in base class
3. Register `ADMIN_INVITE_APPROVAL` action type step config (SoD rules, timeout)

### Existing Infrastructure (reuse)
- `ApprovalsService.createAndSubmit()` — approval engine
- `AdminInvitationsService` — token CRUD (keep as-is)
- `AccessControlService.replaceUserRoles()` — role binding
- `AuditLogsService.recordByActor()` — audit writes

### Files to Delete
- Current `admin-invite-approval.service.ts` (will be replaced by 3 files)

### Files to Create
- `src/modules/governance/approvals/approval-handler.base.ts`
- `src/modules/identity/users/users.domain.service.ts`
- `src/modules/identity/users/admin-invite-approval.service.ts` (new, extends base)
- `src/modules/identity/users/admin-invite-workflow.service.ts`

### Files to Rewrite
- `src/modules/identity/users/users.controller.ts`
- `admin-web/src/pages/PlatformMembers.tsx`
- `admin-web/src/pages/PlatformMemberDetailPage.tsx`

---

## 9. Pre-Flight Checklist (per backend-platform.md)

| Item | Answer |
|------|--------|
| Trigger | Admin POST /users (human action) |
| Emitted events | None (workflow does not emit domain events) |
| Subscribed events | `workflow.admin-invite.decided` (from Layer 2) |
| Direct cross-module deps | ApprovalsService, AccessControlService, AdminInvitationsService |
| Audit actions | See §6 (10 total across L2 + L3) |
| Approval sub-workflow | `admin-invite-approval.service.ts` (extends ApprovalHandlerBase) |

# Delete Request Workflow
Wave: 1 | Source verified: delete-requests.service.ts, delete-requests.controller.ts, constants/delete-request.constants.ts
Last Updated: 2026-04-21

## Purpose
Governed soft-delete gate: any deletion of a sensitive entity (change ticket, audit evidence package, admin user) requires maker-checker approval before the `deletedAt` tombstone is written.

## Actors
| Actor | Role |
|---|---|
| Maker (Admin) | Creates and submits the delete request; cannot consume it themselves |
| Checker (DPO or CISO by default) | Approves or rejects via the linked ApprovalCase |
| Consumer (Admin, not creator) | Executes the actual soft-delete once request is READY |
| SYSTEM | Projection listener that moves request status when approval decision arrives |
| SUPER_ADMIN | Can cancel on behalf of any creator; bypass logged in audit |

## State Machine
| Status | Description | Valid Next States |
|---|---|---|
| DRAFT | Created; target snapshot frozen, awaiting submission | PENDING_APPROVAL, CANCELLED |
| PENDING_APPROVAL | Submitted; linked ApprovalCase is PENDING | READY, REJECTED, CANCELLED |
| READY | ApprovalCase reached APPROVED; eligible for consumption | DONE, FAILED, CANCELLED |
| DONE | Soft-delete executed successfully | — (terminal) |
| FAILED | Soft-delete transaction failed at execution time | — (terminal) |
| REJECTED | ApprovalCase reached REJECTED, EXPIRED, or CANCELLED | — (terminal) |
| CANCELLED | Creator (or SUPER_ADMIN) withdrew the request | — (terminal) |

### Active statuses (block new request for same target)
`PENDING_APPROVAL`, `READY` — while in either state, creating a new delete request for the same target returns the existing one (idempotent).

## Target Types (`targetType`)
| Value | Target entity | Terminal-state precondition |
|---|---|---|
| CHANGE_TICKET | `ChangeTicket` record | Must be in DONE, FAILED, REJECTED, or CANCELLED before a delete request can be created |
| AUDIT_EVIDENCE_PACKAGE | `AuditEvidencePackage` record | Must not have a PENDING linked ApprovalCase |
| ADMIN_USER | `User` (admin) record | No terminal-state precondition |

## Flow
1. **Create (→ DRAFT)** — Maker calls `POST /admin/control-gates/delete-requests` with `{ targetType, targetNo, deleteReason, docRef? }`. Service:
   a. Calls `resolveTargetByNo` to look up the target by its human-readable number (`ticketNo`, `packageNo`, `userNo`).
   b. Enforces terminal-state preconditions (see Target Types table above).
   c. Checks for an active request (`PENDING_APPROVAL | READY`) for the same target; returns existing if found (idempotent).
   d. Freezes `targetSnapshotJson` + `targetSnapshotDigest` (SHA-256).
   e. Creates record in DRAFT with a fresh `traceId` (always auto-generated UUID, not inherited from target).

2. **Submit (DRAFT → PENDING_APPROVAL)** — Maker calls `POST /admin/control-gates/delete-requests/:id/submit`. Only the creator may submit. Inside a DB transaction:
   a. Re-validates target still exists via `resolveTargetById`.
   b. Calls `approvalsService.createAndSubmit()` with `actionType = DELETE_REQUEST_APPROVAL`, `entityRef = request.id`.
   c. Updates request: `status = PENDING_APPROVAL`, `approvalCaseId`, `approvalNo`, `submittedByUserId`, `submittedAt`.
   After commit, emits `governance.approval.submitted`.

3. **Approval decision projection (PENDING_APPROVAL → READY or REJECTED)** — SYSTEM: `ApprovalsService` fires `governance.approval.approved/rejected/expired/cancelled`; `deleteRequestsService.syncApprovalProjectionByEvent` handles it:
   - ApprovalCase APPROVED → request READY
   - ApprovalCase REJECTED | EXPIRED | CANCELLED → request REJECTED

4. **Cancel (DRAFT|PENDING_APPROVAL|READY → CANCELLED)** — Creator or SUPER_ADMIN calls `POST /admin/control-gates/delete-requests/:id/cancel`. If the linked ApprovalCase is still PENDING, it is cancelled first (cascaded cancel). Then request status → CANCELLED.

5. **Consume (READY → DONE or FAILED)** — A different admin (not the creator) calls `POST /admin/control-gates/delete-requests/:id/consume`. Service:
   a. Enforces creator≠consumer SoD.
   b. Calls `approvalsService.requireApproved()` to verify linked ApprovalCase is APPROVED.
   c. Inside a DB transaction, writes the soft-delete fields (`deletedAt`, `deletedBy`, `deleteRequestId`, `deleteReason`) on the target entity.
      - For `ADMIN_USER`: also revokes any outstanding un-consumed invitations.
   d. Updates request to DONE with `consumedByUserId`, `consumedAt`, updated `targetSnapshotJson` (post-delete snapshot).
   e. On transaction failure, sets request to FAILED and records `DELETE_REQUEST_EXECUTION_FAILED` audit entry, then re-throws.

## Key Rules
- **Creator ≠ Consumer SoD**: `current.createdByUserId === actor.userId` is forbidden on consume unless the actor is SUPER_ADMIN (and even then it is flagged with `superAdminBypass: true` in audit metadata).
- **Target terminal-state precondition for CHANGE_TICKET**: the change ticket must be in `{DONE, FAILED, REJECTED, CANCELLED}` at the time the delete request is created; active/in-flight tickets cannot be deleted.
- **AUDIT_EVIDENCE_PACKAGE with pending approval block**: if the evidence package has a linked ApprovalCase in `PENDING` status, creating a delete request is rejected.
- **Soft delete, not hard delete**: execution writes `deletedAt` / `deletedBy` / `deleteRequestId` / `deleteReason` on the target row. Records remain in DB for audit history.
- **FAILED requests cannot be re-consumed**: service throws `BadRequestException` if `status = FAILED`.
- **Target snapshot integrity**: a SHA-256 digest of the target snapshot is stored both at creation and at consumption for tamper-evidence comparison.
- **Cascaded invitation revocation**: deleting an `ADMIN_USER` atomically revokes all unconsumed, non-expired invitations for that user within the same transaction.
- **Cancel cascades to approval**: if the linked ApprovalCase is still PENDING when the delete request is cancelled, the approval is cancelled first.

## API Endpoints
| Method | Path | Actor | Description |
|---|---|---|---|
| POST | /admin/control-gates/delete-requests | Admin (Maker) | Create DRAFT delete request |
| GET | /admin/control-gates/delete-requests | Admin | List delete requests |
| GET | /admin/control-gates/delete-requests/:id | Admin | Get delete request detail |
| POST | /admin/control-gates/delete-requests/:id/submit | Admin (Maker, creator only) | Submit DRAFT → PENDING_APPROVAL |
| POST | /admin/control-gates/delete-requests/:id/cancel | Admin (creator or SUPER_ADMIN) | Cancel DRAFT / PENDING_APPROVAL / READY |
| POST | /admin/control-gates/delete-requests/:id/consume | Admin (non-creator) | Execute soft-delete → DONE or FAILED |

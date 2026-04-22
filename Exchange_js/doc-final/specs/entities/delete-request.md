# Delete Request
Wave: 1 | Source verified: prisma/schema.prisma, src/modules/governance/delete-requests/delete-requests.service.ts, src/modules/governance/delete-requests/delete-requests.controller.ts, src/modules/governance/delete-requests/constants/delete-request.constants.ts
Last Updated: 2026-04-21

## Prisma Model: DeleteRequest
Table: `delete_requests`
Business Key: `requestNo` (prefix `DR-`, generated via `generateReferenceNo`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| requestNo | String | No | Unique business key, generated with `DR` prefix |
| targetType | String | No | See DeleteRequestTargetTypes enum |
| targetId | String | No | UUID of the target entity |
| targetNo | String | No | Business key of the target entity |
| status | String | No | Default `DRAFT`; see DeleteRequestStatuses enum |
| approvalCaseId | String | Yes | FK to ApprovalCase (unique — one approval per request) |
| approvalNo | String | Yes | Denormalized approval business key |
| createdByUserId | String | No | Creator user ID |
| createdByUserNo | String | No | Creator user number |
| submittedByUserId | String | Yes | User who submitted to approval |
| submittedByUserNo | String | Yes | |
| consumedByUserId | String | Yes | User who executed the deletion |
| consumedByUserNo | String | Yes | |
| deleteReason | String | No | Required reason for the deletion |
| resultNote | String | Yes | Outcome note set during consume |
| docRef | String | Yes | Optional supporting document reference |
| targetSnapshotJson | String | No | Default `{}`; snapshot of target state at consume time (SHA256-digested) |
| targetSnapshotDigest | String | Yes | SHA-256 hex digest of `targetSnapshotJson` |
| traceId | String | No | UUID v4 trace identifier (assigned at creation, not inherited from target) |
| createdAt | DateTime | No | Auto timestamp |
| updatedAt | DateTime | No | Auto-updated timestamp |
| submittedAt | DateTime | Yes | When submitted to approval |
| consumedAt | DateTime | Yes | When consumed (deletion executed) |

## Status Enum (DeleteRequestStatuses)
| Value | Meaning |
|---|---|
| DRAFT | Created; pending submission |
| PENDING_APPROVAL | Submitted; waiting for checker approval |
| READY | Approval granted; ready for execution |
| DONE | Deletion successfully executed |
| FAILED | Deletion attempted but failed (partial failure possible) |
| REJECTED | Approval rejected, expired, or cancelled |
| CANCELLED | Manually withdrawn by creator (or SUPER_ADMIN) |

## Active Statuses
`DeleteRequestActiveStatuses = [PENDING_APPROVAL, READY]` — used to detect duplicate-in-flight requests.

## Target Types (DeleteRequestTargetTypes)
| Value | Target Entity | Deletable Condition |
|---|---|---|
| CHANGE_TICKET | ChangeTicket | Status must be terminal: DONE, FAILED, REJECTED, or CANCELLED |
| AUDIT_EVIDENCE_PACKAGE | AuditEvidencePackage | Must not have a PENDING linked approval |
| ADMIN_USER | User (admin) | No additional prerequisite beyond `deletedAt = null` |

## Key Business Rules
- **Creator cannot consume**: `consume()` enforces `createdByUserId !== actor.userId`; the person who requested the deletion cannot be the one who executes it (SoD). SUPER_ADMIN is explicitly allowed to bypass this but is flagged with `superAdminBypass: true` in audit metadata
- **Idempotent creation**: if an active (PENDING_APPROVAL or READY) request already exists for the same `targetType + targetId`, the existing request is returned rather than creating a duplicate
- **Snapshot at consume time**: `targetSnapshotJson` + `targetSnapshotDigest` are refreshed at consumption (not at creation) to capture final state before deletion
- **Approval linked at submit**: submitting atomically creates+submits an `ApprovalCase` with `actionType: DELETE_REQUEST_APPROVAL`; `approvalCaseId` is unique (one approval per request)
- **Approval projection**: when the linked ApprovalCase reaches APPROVED/REJECTED/EXPIRED/CANCELLED, the request status is updated via `syncApprovalProjectionByEvent()` (event-driven, system actor)
  - ApprovalCase APPROVED → request READY
  - ApprovalCase REJECTED/EXPIRED/CANCELLED → request REJECTED
- **Cancellation cascades to approval**: if the request is in PENDING_APPROVAL and has a linked approval in PENDING, `cancel()` also cancels the linked ApprovalCase
- **Approval required for consume**: if `approvalCaseId` is set, `consume()` calls `requireApproved()` on the linked case; throws ForbiddenException if not APPROVED
- **Deletion is physical on the target**: `consume()` sets `deletedAt`, `deletedBy`, `deleteRequestId`, `deleteReason` on the target entity inside a DB transaction; for ADMIN_USER targets, all non-consumed, non-revoked invitations are also revoked
- **FAILED requests cannot be retried**: `consume()` throws on FAILED status
- **Cancellable from**: DRAFT, PENDING_APPROVAL, READY
- **Trace ID is request-scoped**: the `traceId` is generated fresh at request creation (not inherited from the target entity)

## Service Methods (key operations)
- `create(dto, actor)` — creates DRAFT request; resolves target by `targetNo`; idempotent on active existing request; builds initial target snapshot
- `submit(id, dto, actor)` — DRAFT→PENDING_APPROVAL; only creator can submit; atomically creates+submits linked ApprovalCase
- `cancel(id, dto, actor)` — cancels from DRAFT/PENDING_APPROVAL/READY; only creator or SUPER_ADMIN; cascades ApprovalCase cancel if PENDING
- `consume(id, dto, actor)` — READY→DONE or FAILED; enforces creator≠consumer; executes physical deletion in transaction; falls to FAILED on error
- `syncApprovalProjectionByEvent(event)` — internal; updates request status based on linked approval outcome
- `resolveTargetById(targetType, targetId)` — resolves and validates target entity by PK; validates deletability constraints
- `getById(id, actor)` — fetch single delete request
- `list(query, actor)` — paginated listing; filter by `requestNo`, `targetType`, `targetNo`, `status`, `traceId`, `approvalNo`, `createdByUserNo`, `consumedByUserNo`, keyword

## API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | /admin/control-gates/delete-requests | Create a delete request |
| GET | /admin/control-gates/delete-requests | List delete requests (paginated) |
| GET | /admin/control-gates/delete-requests/:id | Get delete request detail |
| POST | /admin/control-gates/delete-requests/:id/submit | Submit DRAFT request to approval |
| POST | /admin/control-gates/delete-requests/:id/cancel | Cancel a request |
| POST | /admin/control-gates/delete-requests/:id/consume | Execute the deletion (READY→DONE or FAILED) |

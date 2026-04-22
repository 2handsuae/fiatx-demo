# Change Ticket
Wave: 1 | Source verified: prisma/schema.prisma, src/modules/governance/change-tickets/change-tickets.service.ts, src/modules/governance/change-tickets/change-tickets.controller.ts, src/modules/governance/change-tickets/constants/change-ticket.constants.ts
Last Updated: 2026-04-21

## Prisma Model: ChangeTicket
Table: `change_tickets`
Business Key: `ticketNo` (prefix `CT-`, generated via `generateReferenceNo`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| ticketNo | String | No | Unique business key, generated with `CT` prefix |
| status | String | No | Default `DRAFT`; see ChangeTicketStatuses enum |
| changeType | String | No | See ChangeTicketTypes enum |
| changeReason | String | No | Human-readable reason for the change |
| bindingSnapshotJson | String | No | Default `{}`; frozen snapshot of change intent (SHA256-digested) |
| bindingDigest | String | Yes | SHA-256 hex digest of `bindingSnapshotJson` for tamper evidence |
| scopeSummary | String | No | Human-readable scope description |
| testEvidenceRef | String | No | Reference to test evidence; `BUSINESS_PAGE_PROPOSAL` for system-created tickets |
| rollbackPlanRef | String | No | Reference to rollback plan; `BUSINESS_PAGE_PROPOSAL` for system-created tickets |
| approvalCaseId | String | Yes | FK to ApprovalCase (unique — one active approval per ticket) |
| approvalNo | String | Yes | Denormalized approval business key |
| traceId | String | No | UUID v4 trace identifier |
| createdByUserId | String | No | Creator user ID |
| createdByUserNo | String | No | Creator user number |
| submittedByUserId | String | Yes | User who submitted to approval |
| submittedByUserNo | String | Yes | |
| consumedByUserId | String | Yes | User who consumed (executed) the ticket |
| consumedByUserNo | String | Yes | |
| submittedAt | DateTime | Yes | When submitted to approval |
| consumedAt | DateTime | Yes | When consumed |
| resultNote | String | Yes | Outcome note set during consume |
| deletedAt | DateTime | Yes | Soft-delete timestamp |
| deletedBy | String | Yes | Soft-delete actor |
| deleteRequestId | String | Yes | DR that soft-deleted this record |
| deleteRequestNo | String | Yes | |
| deleteReason | String | Yes | |
| createdAt | DateTime | No | Auto timestamp |
| updatedAt | DateTime | No | Auto-updated timestamp |

## Status Enum (ChangeTicketStatuses)
| Value | Meaning |
|---|---|
| DRAFT | Created; binding snapshot frozen, not yet submitted |
| PENDING_APPROVAL | Submitted; waiting for checker approval |
| READY | Approval granted; ticket is ready for execution (consume) |
| DONE | Consumed successfully; formal execution dispatched |
| FAILED | Consumed but execution failed |
| REJECTED | Approval rejected, expired, or cancelled |
| CANCELLED | Manually withdrawn (not yet implemented as a direct user action; deletion via DeleteRequest) |

## Change Type Enum (ChangeTicketTypes)
| Value | Business Workflow |
|---|---|
| ADMIN_ACCESS_CHANGE | Admin member provisioning (invite a new admin user) |
| RBAC_CATALOG_CHANGE | Admin role binding change (replace roles on existing user) |
| BUSINESS_CONFIG_CHANGE | Business config release publish authorization |

## Binding Snapshot Structure
The `bindingSnapshotJson` field is frozen at creation time and digested. Its structure depends on `changeType`:

**ADMIN_ACCESS_CHANGE** (`intent: ADMIN_MEMBER_PROVISIONING`):
- `email`, `roleCodes`, `requestedByUserId`, `requestedByUserNo`, `changeReason`, `scopeSummary`

**RBAC_CATALOG_CHANGE** (`intent: ADMIN_ROLE_BINDING_CHANGE`):
- `targetUserId`, `targetUserNo`, `targetEmail`, `roleCodes`, `requestedByUserId`, `requestedByUserNo`, `changeReason`, `scopeSummary`

**BUSINESS_CONFIG_CHANGE** (`intent: BUSINESS_CONFIG_CHANGE`):
- `releaseNo`, `subjectType`, `scopeSummary`, `changeReason`

## Key Business Rules
- **Binding frozen at creation**: `bindingSnapshotJson` and `bindingDigest` are set in the same DB transaction as creation and never mutated
- **Approval linked at submit**: submitting a DRAFT ticket atomically creates-and-submits an `ApprovalCase` with `actionType: CHANGE_TICKET_APPROVAL` and links it via `approvalCaseId`
- **Only one approval per ticket**: `approvalCaseId` has a unique constraint; each ticket has at most one linked approval case
- **Approval projection**: when the linked ApprovalCase reaches APPROVED/REJECTED/EXPIRED/CANCELLED, the ticket status is updated via `syncApprovalProjectionByEvent()` (event-driven, system actor)
  - ApprovalCase APPROVED → ticket READY
  - ApprovalCase REJECTED/EXPIRED/CANCELLED → ticket REJECTED
- **Consume requires READY status**: only READY tickets can be consumed; FAILED tickets cannot be retried
- **Formal execution on success**: consuming with `success: true` emits `CHANGE_TICKET_CONSUMED` event which triggers the actual downstream action (e.g. user provisioning, role binding)
- **Deletable statuses**: only terminal tickets (DONE, FAILED, REJECTED, CANCELLED) can be targeted by a DeleteRequest
- **Soft deletion**: `deletedAt` / `deletedBy` / `deleteRequestId` / `deleteRequestNo` / `deleteReason` are set when a DeleteRequest is consumed; `findTicketOrThrow` treats `deletedAt != null` as not found
- **Workflow type mapping**: each `changeType` maps to a distinct `AuditBusinessWorkflowType` for audit log routing

## Service Methods (key operations)
- `create(dto, actor)` — creates DRAFT ticket with frozen binding snapshot
- `createAdminMemberProvisioningTicket(input, actor)` — creates ADMIN_ACCESS_CHANGE ticket; binding includes `email` + `roleCodes`
- `createAdminRoleBindingChangeTicket(userId, input, actor)` — creates RBAC_CATALOG_CHANGE ticket; resolves target user from DB
- `createBusinessConfigReleaseTicket(input, actor)` — creates BUSINESS_CONFIG_CHANGE ticket; binding includes `releaseNo` + `subjectType`
- `submit(id, dto, actor)` — DRAFT→PENDING_APPROVAL; atomically creates+submits linked ApprovalCase
- `consume(id, dto, actor)` — READY→DONE (or FAILED); dispatches `CHANGE_TICKET_CONSUMED` event on success
- `syncApprovalProjectionByEvent(event)` — internal; updates ticket status based on approval outcome
- `getById(id, actor)` — fetch single ticket
- `list(query, actor)` — paginated listing; filter by `ticketNo`, `status`, `changeType`, `traceId`, keyword

## API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | /admin/control-gates/change-tickets | Create a change ticket |
| GET | /admin/control-gates/change-tickets | List change tickets (paginated) |
| GET | /admin/control-gates/change-tickets/:id | Get change ticket detail |
| POST | /admin/control-gates/change-tickets/:id/submit | Submit DRAFT ticket to approval |
| POST | /admin/control-gates/change-tickets/:id/consume | Consume a READY ticket (execute or fail) |

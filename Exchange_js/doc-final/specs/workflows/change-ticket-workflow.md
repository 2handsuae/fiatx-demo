# Change Ticket Workflow
Wave: 1 | Source verified: change-tickets.service.ts, change-tickets.controller.ts, constants/change-ticket.constants.ts, events/change-ticket-consumed.event.ts, governed-execution.listener.ts
Last Updated: 2026-04-21

## Purpose
Governance wrapper that requires a second-eyes approval before any privileged administrative change (member provisioning, role binding replacement, business config release) is executed on the system.

## Actors
| Actor | Role |
|---|---|
| Maker (Admin) | Creates and submits the change ticket |
| Checker (CISO role by default) | Approves or rejects via the linked ApprovalCase |
| Consumer (Admin, not creator) | Confirms execution success or failure on a READY ticket |
| SYSTEM | Projection listener that moves ticket status when approval decision arrives |

## State Machine
| Status | Description | Valid Next States |
|---|---|---|
| DRAFT | Created; binding snapshot frozen, awaiting submission | PENDING_APPROVAL |
| PENDING_APPROVAL | Submitted; linked ApprovalCase is PENDING | READY, REJECTED |
| READY | ApprovalCase reached APPROVED; eligible for consumption | DONE, FAILED |
| DONE | Consumer confirmed successful execution | — (terminal) |
| FAILED | Consumer reported execution failure | — (terminal) |
| REJECTED | ApprovalCase reached REJECTED, EXPIRED, or CANCELLED | — (terminal) |
| CANCELLED | (Enum value present; not used by current service flows; reserved) | — (terminal) |

## Change Types (`changeType`)
| Value | Description | Governed execution intent |
|---|---|---|
| ADMIN_ACCESS_CHANGE | New admin member provisioning (invite + role assign) | `ADMIN_MEMBER_PROVISIONING` |
| RBAC_CATALOG_CHANGE | Replace role bindings for an existing admin user | `ADMIN_ROLE_BINDING_CHANGE` |
| BUSINESS_CONFIG_CHANGE | Publish a validated business config release | `BUSINESS_CONFIG_CHANGE` |

## Flow
1. **Create (→ DRAFT)** — Any of three paths:
   - Generic: `POST /admin/control-gates/change-tickets` (caller builds the binding).
   - Member provisioning: `POST /users` → internally calls `createAdminMemberProvisioningTicket`.
   - Role binding change: `PUT /admin/iam/users/:id/roles` → internally calls `createAdminRoleBindingChangeTicket`.
   - Config release: `businessConfigService.createBusinessConfigReleaseTicket` (internal only).
   All three paths freeze a `bindingSnapshotJson` + `bindingDigest` (SHA-256 of snapshot) atomically in a single DB transaction. Status = DRAFT.

2. **Submit (DRAFT → PENDING_APPROVAL)** — Maker calls `POST /admin/control-gates/change-tickets/:id/submit`. Inside a DB transaction:
   a. Calls `approvalsService.createAndSubmit()` with `actionType = CHANGE_TICKET_APPROVAL`, `entityRef = ticket.id`.
   b. Updates ticket: `status = PENDING_APPROVAL`, `approvalCaseId`, `approvalNo`, `submittedByUserId`, `submittedAt`.
   After commit, emits `governance.approval.submitted` and records `CHANGE_TICKET_SUBMITTED` + `CHANGE_TICKET_APPROVAL_LINKED` audit entries.

3. **Approval decision projection (PENDING_APPROVAL → READY or REJECTED)** — SYSTEM: When the ApprovalCase fires `governance.approval.approved/rejected/expired/cancelled`, `ApprovalsService.projectGovernanceApprovalDecision` calls `changeTicketsService.syncApprovalProjectionByEvent`. This sets:
   - ApprovalCase APPROVED → ticket READY
   - ApprovalCase REJECTED | EXPIRED | CANCELLED → ticket REJECTED

4. **Consume (READY → DONE or FAILED)** — Any admin calls `POST /admin/control-gates/change-tickets/:id/consume` with `{ success: boolean, note?: string }`. If `success = true`:
   a. `dispatchFormalExecution` emits `CHANGE_TICKET_CONSUMED` event with the frozen `bindingSnapshotJson` as `binding` payload.
   b. `GovernedExecutionListener` handles the event by routing on `binding.intent`:
      - `ADMIN_MEMBER_PROVISIONING` → `usersService.executeAdminMemberProvisioning` (create user + invite)
      - `ADMIN_ROLE_BINDING_CHANGE` → `accessControlService.executeGovernedRoleBindingChange`
      - `BUSINESS_CONFIG_CHANGE` → `businessConfigService.publishReleaseFromGovernance`
   c. Ticket is updated to DONE regardless (the consume caller controls status via `success` flag).
   If `success = false`, ticket moves to FAILED (no event emitted).

## Key Rules
- **Binding snapshot is immutable after creation**: `bindingSnapshotJson` and `bindingDigest` are written inside the creation transaction and never updated thereafter. The consumer executes exactly what was approved.
- **Only one active approval per ticket**: submit re-uses an existing PENDING ApprovalCase if one exists (idempotent `createAndSubmit`).
- **Ticket status is driven by approval projection**: the ticket itself does not call the approval API; it waits for events from the approval module and updates via `syncApprovalProjectionByEvent`.
- **FAILED tickets cannot be re-consumed**: the service throws `BadRequestException` if `status = FAILED` on a consume attempt.
- **Soft-delete traceability**: deleted change tickets set `deletedAt` / `deletedBy` / `deleteRequestId` / `deleteRequestNo` / `deleteReason` fields; `findTicketOrThrow` treats `deletedAt != null` as not-found.
- **SoD on Consume**: no explicit creator≠consumer check in the change-ticket consume path (unlike delete requests). The approval SoD (creator≠approver) is enforced by the linked ApprovalCase.
- **traceId chain**: `traceId` is assigned once on creation (caller-provided or auto-UUID). All subsequent submit/consume calls must pass a matching `traceId` or omit it.

## API Endpoints
| Method | Path | Actor | Description |
|---|---|---|---|
| POST | /admin/control-gates/change-tickets | Admin (Maker) | Create DRAFT change ticket (generic) |
| GET | /admin/control-gates/change-tickets | Admin | List change tickets |
| GET | /admin/control-gates/change-tickets/:id | Admin | Get ticket detail |
| POST | /admin/control-gates/change-tickets/:id/submit | Admin (Maker) | Submit DRAFT → PENDING_APPROVAL, creates linked ApprovalCase |
| POST | /admin/control-gates/change-tickets/:id/consume | Admin (Consumer) | Consume READY ticket → DONE or FAILED |
| POST | /users | Admin | Create ADMIN_ACCESS_CHANGE ticket (member provisioning) |
| PUT | /admin/iam/users/:id/roles | Admin | Create RBAC_CATALOG_CHANGE ticket (role binding) |

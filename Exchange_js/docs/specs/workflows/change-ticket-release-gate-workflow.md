Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/change-ticket-entity.md`, `docs/specs/entities/approval-case-entity.md`
Source of Truth Level: specs-workflow

# Change Ticket Release Gate Workflow

## Purpose
- This workflow defines the Wave 1 governance release gate path for `WF-06`.

## Actors
- change maker
- approval checker
- gate / deploy operator

## State Model
- Ticket state machine remains:
  - `DRAFT`
  - `SUBMITTED`
  - `APPROVAL_PENDING`
  - `REJECTED`
  - `READY_FOR_DEPLOY`
  - `DEPLOYED`
  - `DEPLOY_FAILED`
  - `CLOSED`
- Gate runs are subordinate execution records, not a replacement for ticket state.

## Key Transitions
- `submit` creates and submits one `CHANGE_TICKET_APPROVAL`.
- Approval projection maps:
  - `APPROVED -> READY_FOR_DEPLOY`
  - `REJECTED / EXPIRED / CANCELLED -> REJECTED`
- `gate-check` is allowed only for `READY_FOR_DEPLOY`.
- `deploy-status` requires a matching passed gate run on the same:
  - ticket
  - target environment
  - release version
- `close` is allowed only from `DEPLOYED` or `DEPLOY_FAILED`.

## Release Gate Rules
- Minimum evidence remains:
  - `changeType`
  - `scopeSummary`
  - `riskLevel=HIGH`
  - `testEvidenceRef`
  - `rollbackPlanRef`
  - `latestApprovalStatus=APPROVED`
- Canonical `changeType` values are limited to the Wave 1 governance taxonomy.
- Generic or trading-oriented change types are retired runtime history.

## Read / Write Owners
- `ChangeTicketsService` owns ticket lifecycle.
- `ApprovalsService` owns linked approval lifecycle and projection into `latestApprovalStatus`.
- `ReleaseGatesService` owns gate-run creation and pass/fail evaluation.
- `AuditLogsService` owns canonical audit logging for ticket and gate actions.

## API / UI Projection
- API:
  - `POST /admin/control-gates/change-tickets`
  - `POST /admin/control-gates/change-tickets/:id/submit`
  - `POST /admin/control-gates/change-tickets/:id/resubmit`
  - `POST /admin/control-gates/change-tickets/:id/gate-checks`
  - `POST /admin/control-gates/change-tickets/:id/deploy-status`
  - `POST /admin/control-gates/change-tickets/:id/close`
- UI:
  - `Control Gates Center -> Change Tickets`

## MUST / MUST NOT
- MUST keep `ticketNo` as the operator-facing default identifier.
- MUST write all submit / approve / reject / gate / deploy / close actions through canonical audit logging.
- MUST NOT fold `WF-GOV-02` effectiveness gate semantics into this workflow.

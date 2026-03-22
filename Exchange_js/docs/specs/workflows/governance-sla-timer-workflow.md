Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-sla-timer-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/governance-sla-timer-entity.md`
Source of Truth Level: specs-workflow

# Governance SLA Timer Workflow

## Purpose
- This workflow defines the Wave 1 governance-only SLA timing baseline for `WF-04`.

## Actors
- scheduler / sweep job
- admin operator
- approval or change-ticket projection writer

## State Model
- Timer state machine remains:
  - `ACTIVE`
  - `CLOSED`
  - `EXPIRED`
- Notification registry remains:
  - `DUE_REMINDER`
  - `EXPIRE_MARK`

## Supported Timer Types
- `APPROVAL_TIMEOUT`
- `CHANGE_POST_APPROVAL_FOLLOWUP`

## Key Transitions
- Approval entering `PENDING` creates or reuses `APPROVAL_TIMEOUT`.
- Approval terminal state closes the active timeout timer.
- Emergency change deployment creates or reuses `CHANGE_POST_APPROVAL_FOLLOWUP`.
- Manual `close` is allowed only for active `CHANGE_POST_APPROVAL_FOLLOWUP`.
- `recalc` remains available for active timers.
- Expiry updates timer state and notification registry, but does not invent new intermediate timer statuses.

## Read / Write Owners
- `ApprovalSlaProjectionService` owns approval-timeout binding.
- `ChangeTicketSlaProjectionService` owns change follow-up binding.
- `SlaTimersService` owns list/detail/recalc/close behavior.
- `SlaTimerSweepService` owns automatic expire path.
- `AuditLogsService` owns timer and notification audit events.

## API / UI Projection
- API:
  - `GET /admin/control-gates/sla-timers`
  - `GET /admin/control-gates/sla-timers/:id`
  - `POST /admin/control-gates/sla-timers/:id/recalc`
  - `POST /admin/control-gates/sla-timers/:id/close`
  - `POST /admin/demo/control-gates/sla-timers/approval-timeout`
  - `POST /admin/demo/control-gates/sla-timers/change-follow-up`
  - `POST /admin/demo/control-gates/sla-timers/:id/expire`
- UI:
  - `Control Gates Center -> SLA Timers`

## MUST / MUST NOT
- MUST keep SLA scope inside governance workflows only.
- MUST log timer and notification actions through canonical audit logging.
- MUST NOT introduce external email / SMS delivery in the notification registry.
- MUST NOT add new timer statuses or non-governance bindings in Wave 1.

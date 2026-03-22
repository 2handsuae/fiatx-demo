Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/delete-request-entity.md`, `docs/specs/entities/approval-case-entity.md`, `docs/specs/entities/admin-user-entity.md`
Source of Truth Level: specs-workflow

# Delete Request Soft Delete Workflow

## Purpose
- This workflow defines the Wave 1 governed soft-delete path for `WF-05`.

## Actors
- delete-request maker
- approval checker
- delete executor

## State Model
- Delete request state machine remains:
  - `DRAFT`
  - `SUBMITTED`
  - `APPROVAL_PENDING`
  - `READY_TO_EXECUTE`
  - `EXECUTED`
  - `EXECUTION_FAILED`
  - `REJECTED`
  - `CANCELLED`

## Target Scope
- Supported targets are limited to:
  - `CHANGE_TICKET`
  - `AUDIT_EVIDENCE_PACKAGE`
  - `COMPLIANCE_CASE_EVIDENCE_PACKAGE`
  - `ADMIN_USER`
- `APPROVAL_CASE` is not a supported target or compatibility alias.

## Key Transitions
- `submit` creates and submits one `DELETE_REQUEST_APPROVAL`.
- Approval projection maps:
  - `APPROVED -> READY_TO_EXECUTE`
  - `REJECTED / EXPIRED / CANCELLED -> REJECTED`
- `execute` re-checks approval state, snapshots the target, and writes standardized soft-delete fields on the target row.
- Normal read paths must exclude `deletedAt != null`; direct detail or download access for deleted targets returns `404`.

## Read / Write Owners
- `DeleteRequestsService` owns request lifecycle, target validation, snapshot, and execute path.
- `ApprovalsService` owns linked approval lifecycle and execution-result writeback.
- Target modules continue to own their primary read models, but must honor the standardized soft-delete filter.
- `AuditLogsService` owns canonical delete-request audit events.

## API / UI Projection
- API:
  - `POST /admin/control-gates/delete-requests`
  - `POST /admin/control-gates/delete-requests/:id/submit`
  - `POST /admin/control-gates/delete-requests/:id/cancel`
  - `POST /admin/control-gates/delete-requests/:id/execute`
- UI:
  - `Control Gates Center -> Delete Requests`

## MUST / MUST NOT
- MUST resolve targets by `targetNo` in admin create flow.
- MUST preserve delete-request detail readability after target deletion.
- MUST NOT delete the shared approval object when deleting top-level governed targets.
- MUST NOT introduce undelete, batch delete, or hard delete in this workflow.

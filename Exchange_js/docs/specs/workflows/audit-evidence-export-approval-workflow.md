Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/audit-logging-constraints.md`, `docs/constraints/governance-approval-constraints.md`, `docs/specs/entities/audit-evidence-package-entity.md`, `docs/specs/entities/approval-case-entity.md`
Source of Truth Level: specs-workflow

# Audit Evidence Export Approval Workflow

## Purpose
- This workflow defines the canonical approval-gated path for exporting `Audit Center` evidence through maker-checker approval.

## Actors
- export requester
- approval checker
- audit evidence export executor

## State Model
- Evidence package request record starts as `PENDING_APPROVAL`.
- Linked approval case follows:
  - `DRAFT -> PENDING -> APPROVED / REJECTED / EXPIRED / CANCELLED`
- Evidence package becomes downloadable only after:
  - approval is `APPROVED`
  - package status is `READY`

## Key Transitions
- `POST /admin/audit-logs/export/evidence-package` creates:
  - one `audit_evidence_packages` request record
  - one `AUDIT_EVIDENCE_EXPORT_APPROVAL`
- Approval `APPROVED` triggers final package artifact generation from selected typed audit events and associated context snapshots:
  - `manifest`
  - `records`
  - `packageBody`
  - `digest`
- Successful generation appends one `EVIDENCE_EXPORT` audit event for the export action itself.
- Rejected, cancelled, or expired approval MUST NOT produce a downloadable package.
- Soft deletion may retire the package later through `Delete Request`, but MUST NOT delete the shared approval object.

## Read / Write Owners
- `AuditEvidenceExportApprovalService` owns request creation and final artifact assembly.
- `ApprovalsService` owns approval state and execution result projection.
- `AuditLogsService` owns export event audit write and evidence package record assembly helpers.

## API / UI Projection
- API:
  - `POST /admin/audit-logs/export/evidence-package`
  - `GET /admin/audit-logs/evidence-packages`
  - `GET /admin/audit-logs/evidence-packages/:id`
  - `GET /admin/audit-logs/evidence-packages/:id/download`
- UI:
  - `Audit Center -> Audit Log`
  - `Audit Center -> Evidence Export`
  - `Control Gates Center -> Approvals`

## Payload Boundary
- The workflow materializes a governed evidence package from selected events and optional snapshots.
- The workflow does not define domain-scoped snapshot composition rules; those belong to upstream selection logic and downstream serializers.
- The workflow MUST keep `subjectNo` exact lookup concerns separate from `traceId + workflowType/workflowNo` query concerns.

## MUST / MUST NOT
- MUST use `AUDIT_EVIDENCE_EXPORT_APPROVAL`.
- MUST record the export action itself in canonical audit logging.
- MUST keep approval detail able to link both approval and evidence package detail.
- MUST NOT bypass approval by directly generating a `READY` package from `AuditLogsService`.

# Governance Change Ticket Constraints

## 1) Scope and Ownership
- MUST keep the canonical implementation under:
  1. `src/modules/governance/change-tickets`
  2. `src/modules/governance/approvals`
- MUST treat change tickets as the minimal approval-and-consume workflow for `WF-06`.
- MUST NOT fold delete request or SLA timer requirements into this file.

## 2) Data Model and Identifier Contract
- MUST persist `change_tickets`.
- `change_tickets` MUST expose `ticketNo` as the operator-facing primary identifier.
- `ticketNo` MUST be generated with `generateReferenceNo('CT')`.
- Internal routing and foreign-key relations MAY continue to use `id`, but admin UI and default search MUST prioritize `ticketNo`.
- Canonical `changeType` values are limited to:
  1. `ADMIN_ACCESS_CHANGE`
  2. `RBAC_CATALOG_CHANGE`
- Canonical status values are limited to:
  1. `DRAFT`
  2. `PENDING_APPROVAL`
  3. `READY`
  4. `DONE`
  5. `FAILED`
  6. `REJECTED`
  7. `CANCELLED`

## 3) Field Contract
- MUST keep the current minimal field model:
  1. `approvalCaseId`
  2. `approvalNo`
  3. `createdByUserNo`
  4. `submittedByUserNo`
  5. `consumedByUserNo`
  6. `bindingSnapshotJson`
  7. `bindingDigest`
  8. `resultNote`
  9. `traceId`
  10. `changeReason`
  11. `scopeSummary`
  12. `testEvidenceRef`
  13. `rollbackPlanRef`
- `createdByUserId`, `submittedByUserId`, and `consumedByUserId` remain part of the storage model and may be used for internal ownership checks.
- `deletedAt`, `deletedBy`, `deleteRequestId`, `deleteRequestNo`, and `deleteReason` are target soft-delete fields and are not part of the normal creation model.

## 4) Approval Binding Rules
- `submit` MUST be allowed only from `DRAFT`.
- `submit` MUST create and submit one approval case with:
  1. `actionType = CHANGE_TICKET_APPROVAL`
  2. `entityRef = changeTicket.id`
  3. metadata including `source = WF06` and `ticketNo`
- Approval projection MUST map:
  1. `APPROVED -> READY`
  2. `REJECTED -> REJECTED`
  3. `EXPIRED -> REJECTED`
  4. `CANCELLED -> REJECTED`
- `consume` MUST be allowed only from `READY`.
- There is no maker-checker restriction on consume beyond the admin route guard and the ready-state check.
- There is no resubmit, gate, deploy, or close step in this workflow.

## 5) Audit and Workflow Traceability
- All change ticket writes MUST go through `AuditLogsService`.
- Audit records MUST include:
  1. `module = GOVERNANCE_CHANGE_TICKETS`
  2. `workflowType = CHANGE_TICKET`
  3. `workflowId = ticket.id`
  4. `workflowNo = ticket.ticketNo`
  5. `traceId = ticket.traceId`
- `subjectNos` MUST include `ticketNo`.
- If an approval is linked, `subjectNos` SHOULD also include `approvalNo`.
- Active action dictionary MUST include:
  1. `CHANGE_TICKET_CREATED`
  2. `CHANGE_TICKET_SUBMITTED`
  3. `CHANGE_TICKET_APPROVAL_LINKED`
  4. `CHANGE_TICKET_APPROVED`
  5. `CHANGE_TICKET_REJECTED`
  6. `CHANGE_TICKET_CONSUMED`
  7. `CHANGE_TICKET_CONSUME_FAILED`

## 6) Admin UI and Route Contract
- Control Gates admin entry MUST surface:
  1. `/dashboard/control-gates/change-tickets`
  2. `/dashboard/control-gates/change-tickets/create`
  3. `/dashboard/control-gates/change-tickets/:id`
- List page MUST remain a pure list page and MUST NOT embed a bottom detail panel.
- List page default filters MUST support:
  1. `ticketNo`
  2. `status`
  3. `changeType`
  4. `traceId`
  5. `keyword`
- Detail page MUST expose only create, list, detail, submit, and consume actions.

## 7) RBAC Baseline
- Active route permissions MUST be:
  1. `GET /admin/control-gates/change-tickets` -> `GOV_CHANGE_TICKET_READ`
  2. `GET /admin/control-gates/change-tickets/:id` -> `GOV_CHANGE_TICKET_READ`
  3. `POST /admin/control-gates/change-tickets` -> `GOV_CHANGE_TICKET_WRITE`
  4. `POST /admin/control-gates/change-tickets/:id/submit` -> `GOV_CHANGE_TICKET_WRITE`
  5. `POST /admin/control-gates/change-tickets/:id/consume` -> `GOV_CHANGE_TICKET_WRITE`
- `SUPER_ADMIN` bypasses permission checks in the admin permission guard.
- Any broader legacy catalog entries not tied to active routes are non-canonical for this workflow.

## 8) Delivery Checklist
- Ticket create, submit, consume, and list filters are verified against tests.
- Approval submit and projection path are verified end-to-end.
- Audit Center can query change ticket events by `workflowType`, `workflowNo`, and `traceId`.

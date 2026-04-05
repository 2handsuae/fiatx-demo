# Governance Delete Request Constraints

## 1) Scope and Ownership
- MUST keep the canonical implementation under:
  1. `src/modules/governance/delete-requests`
  2. `src/modules/governance/approvals`
- MUST treat delete requests as the minimal approval-and-consume workflow for `WF-05`.
- MUST NOT fold SLA timer requirements into this file.

## 2) Data Model and Identifier Contract
- MUST persist `delete_requests`.
- `delete_requests` MUST expose `requestNo` as the operator-facing primary identifier.
- `requestNo` MUST be generated with `generateReferenceNo('DR')`.
- Internal routing and foreign-key relations MAY continue to use `id`, but admin UI and default search MUST prioritize `requestNo` and `targetNo`.
- Canonical target types are limited to:
  1. `CHANGE_TICKET`
  2. `AUDIT_EVIDENCE_PACKAGE`
  3. `ADMIN_USER`
- Canonical status values are limited to:
  1. `DRAFT`
  2. `PENDING_APPROVAL`
  3. `READY`
  4. `DONE`
  5. `FAILED`
  6. `REJECTED`
  7. `CANCELLED`
- Soft delete fields on target tables MUST be standardized as:
  1. `deletedAt`
  2. `deletedBy`
  3. `deleteRequestId`
  4. `deleteReason`

## 3) Field Contract
- MUST keep the current minimal field model:
  1. `approvalCaseId`
  2. `approvalNo`
  3. `createdByUserNo`
  4. `submittedByUserNo`
  5. `consumedByUserNo`
  6. `deleteReason`
  7. `resultNote`
  8. `docRef`
  9. `targetSnapshotJson`
  10. `targetSnapshotDigest`
  11. `traceId`
  12. `targetType`
  13. `targetId`
  14. `targetNo`
- `createdByUserId`, `submittedByUserId`, and `consumedByUserId` remain part of the storage model and are used for SoD checks.

## 4) Approval Binding and SoD
- `submit` MUST be allowed only from `DRAFT` and only by the creator.
- `submit` MUST create and submit one approval case with:
  1. `actionType = DELETE_REQUEST_APPROVAL`
  2. `entityRef = deleteRequest.id`
  3. metadata including `requestNo`, `targetType`, `targetId`, and `targetNo`
- Approval projection MUST map:
  1. `APPROVED -> READY`
  2. `REJECTED -> REJECTED`
  3. `EXPIRED -> REJECTED`
  4. `CANCELLED -> REJECTED`
- `cancel` MUST be allowed from `DRAFT`, `PENDING_APPROVAL`, or `READY`.
- `cancel` MUST be allowed by the creator, and `SUPER_ADMIN` MAY cancel another user's request.
- `consume` MUST be allowed only from `READY`.
- The creator MUST NOT consume their own request unless the actor is `SUPER_ADMIN`.
- If a request has an approval case, `consume` MUST re-check that approval case is approved before deleting the target.
- `SUPER_ADMIN` MAY bypass the creator-executor SoD, and audit metadata MUST include `superAdminBypass=true` when that happens.
- There is no execute or resubmit step in this workflow.

## 5) Target Gate Rules
- `CHANGE_TICKET` MUST exist, MUST not already be deleted, and MUST be in a terminal ticket status: `DONE`, `FAILED`, `REJECTED`, or `CANCELLED`.
- `AUDIT_EVIDENCE_PACKAGE` MUST exist, MUST not already be deleted, and MUST not have a pending linked approval.
- `ADMIN_USER` MUST exist, MUST not already be deleted, and MUST be resolved by `userNo` in the admin create flow.
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE` and `APPROVAL_CASE` are not canonical targets.

## 6) Audit and Workflow Traceability
- All delete request writes MUST go through `AuditLogsService`.
- Audit records MUST include:
  1. `module = GOVERNANCE_DELETE_REQUESTS`
  2. `entityType = DELETE_REQUEST`
  3. `entityId = deleteRequest.id`
  4. `entityNo = deleteRequest.requestNo`
  5. `workflowType = DELETE_REQUEST`
  6. `workflowId = deleteRequest.id`
  7. `workflowNo = deleteRequest.requestNo`
  8. `traceId = deleteRequest.traceId`
- `subjectNos` MUST include `requestNo` and `targetNo`.
- If an approval is linked, `subjectNos` SHOULD also include `approvalNo`.
- Active action dictionary MUST include:
  1. `DELETE_REQUEST_CREATED`
  2. `DELETE_REQUEST_SUBMITTED`
  3. `DELETE_REQUEST_APPROVED`
  4. `DELETE_REQUEST_REJECTED`
  5. `DELETE_REQUEST_CANCELLED`
  6. `DELETE_REQUEST_CONSUMED`
  7. `DELETE_REQUEST_CONSUME_FAILED`

## 7) Admin UI and Route Contract
- Control Gates admin entry MUST surface:
  1. `/dashboard/control-gates/delete-requests`
  2. `/dashboard/control-gates/delete-requests/create`
  3. `/dashboard/control-gates/delete-requests/:id`
- List page MUST remain a pure list page and MUST NOT embed a bottom detail panel.
- List page default filters MUST support:
  1. `requestNo`
  2. `targetType`
  3. `targetNo`
  4. `status`
  5. `traceId`
  6. `approvalNo`
  7. `createdByUserNo`
  8. `consumedByUserNo`
  9. `keyword`
- Detail page MUST expose only create, list, detail, submit, cancel, and consume actions.

## 8) RBAC Baseline
- Active route permissions MUST be:
  1. `GET /admin/control-gates/delete-requests` -> `GOV_DELETE_REQUEST_READ`
  2. `GET /admin/control-gates/delete-requests/:id` -> `GOV_DELETE_REQUEST_READ`
  3. `POST /admin/control-gates/delete-requests` -> `GOV_DELETE_REQUEST_WRITE`
  4. `POST /admin/control-gates/delete-requests/:id/submit` -> `GOV_DELETE_REQUEST_WRITE`
  5. `POST /admin/control-gates/delete-requests/:id/cancel` -> `GOV_DELETE_REQUEST_WRITE`
  6. `POST /admin/control-gates/delete-requests/:id/consume` -> `GOV_DELETE_REQUEST_CONSUME`
- `SUPER_ADMIN` bypasses permission checks in the admin permission guard.
- Any broader legacy catalog entries not tied to active routes are non-canonical for this workflow.

## 9) Delivery Checklist
- Request create, submit, cancel, consume, and list filters are verified against tests.
- Approval submit and projection path are verified end-to-end.
- Soft-deleted targets remain hidden from their normal modules, while delete-request detail stays readable.

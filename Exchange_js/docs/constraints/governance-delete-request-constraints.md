# Governance Delete Request Constraints

## 1) Scope and Ownership
- MUST keep `WF-05` canonical implementation under:
1. `src/modules/governance/delete-requests`
2. `src/modules/governance/approvals`
- MUST treat `Delete Request + Soft Delete Gate` as the only in-scope governance workflow for this phase.
- MUST NOT fold `SLA Timer` requirements into this constraint file until that phase is implemented.

## 2) Data Model and No-First Contract
- MUST persist `delete_requests`.
- `delete_requests` MUST expose `requestNo` as the operator-facing primary identifier.
- `requestNo` MUST be generated with `generateReferenceNo('DR')`.
- Internal routing and foreign-key relations MAY continue to use `id`, but admin UI and default search MUST prioritize `requestNo` and `targetNo`.
- Phase 3 target scope MUST be limited to:
1. `CHANGE_TICKET`
2. `APPROVAL_CASE`
3. `AUDIT_EVIDENCE_PACKAGE`
- Soft delete fields MUST be standardized on target tables as:
1. `deletedAt`
2. `deletedBy`
3. `deleteRequestId`
4. `deleteReason`

## 3) Delete Request State Machine
- MUST keep delete request state machine:
1. `DRAFT`
2. `SUBMITTED`
3. `APPROVAL_PENDING`
4. `READY_TO_EXECUTE`
5. `EXECUTED`
6. `EXECUTION_FAILED`
7. `REJECTED`
8. `CANCELLED`
- `APPROVED` MUST NOT be used as a stable `delete_requests.status`.
- Approval projection MUST map:
1. `APPROVED -> READY_TO_EXECUTE`
2. `REJECTED -> REJECTED`
3. `EXPIRED -> REJECTED`
4. `CANCELLED -> REJECTED`
- `latestApprovalStatus` MUST preserve the real approval terminal status even when request status mirrors to `REJECTED`.
- Phase 3 MUST NOT implement `resubmit`, `undelete`, or batch delete.

## 4) Approval Binding and SoD
- Submit MUST create and submit an approval case with:
1. `actionType = DELETE_REQUEST_APPROVAL`
2. `entityRef = deleteRequest.id`
3. metadata including `requestNo`, `targetType`, `targetId`, and `targetNo`
- Phase 3 checker roles MUST come from the approval policy baseline: `DPO,TECH_ADMIN`.
- `submit` MUST be allowed only from `DRAFT` and only by the maker.
- `cancel` MUST be allowed only from `DRAFT / SUBMITTED / APPROVAL_PENDING` and only by the maker.
- `execute` MUST be allowed only from `READY_TO_EXECUTE`.
- Maker MUST NOT execute their own delete request.
- `SUPER_ADMIN` MAY bypass maker-checker and maker-executor SoD, but audit metadata MUST include `superAdminBypass=true`.

## 5) Target Gate Rules
- `CHANGE_TICKET` delete target MUST be `CLOSED` and not already deleted.
- `APPROVAL_CASE` delete target MUST NOT be `PENDING` and not already deleted.
- `AUDIT_EVIDENCE_PACKAGE` delete target MUST NOT be deleted already.
- `AUDIT_EVIDENCE_PACKAGE` delete target MUST be blocked when its linked approval is `PENDING`.
- Phase 3 MUST resolve targets by `targetNo` in the UI and create API.

## 6) Execution and Read Filtering
- Execute MUST re-check approval via `requireApproved(DELETE_REQUEST_APPROVAL, entityRef=deleteRequest.id)`.
- Execute MUST snapshot the target before writing soft delete fields.
- Execute MUST best-effort write `ApprovalsService.markExecutionResult(...)`.
- Normal read paths for:
1. `Approvals`
2. `Change Tickets`
3. `Evidence Export`
  MUST exclude rows with `deletedAt != null`.
- Direct detail/download access to soft-deleted target rows MUST return `404`.
- `Delete Request` list/detail MUST remain readable after target deletion.

## 7) Audit and Workflow Traceability
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
- Phase 3 action dictionary MUST include:
1. `DELETE_REQUEST_CREATED`
2. `DELETE_REQUEST_SUBMITTED`
3. `DELETE_REQUEST_APPROVED`
4. `DELETE_REQUEST_REJECTED`
5. `DELETE_REQUEST_CANCELLED`
6. `DELETE_REQUEST_EXECUTED`
7. `DELETE_REQUEST_EXECUTION_FAILED`

## 8) Admin UI and Route Contract
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
5. `latestApprovalStatus`
6. `traceId`
7. `keyword`
- Detail page MUST keep admin detail page styling and MUST expose actions according to request status and permission.

## 9) RBAC Baseline
- Phase 3 permission groups MUST include:
1. `GOV_DELETE_REQUEST_READ`
2. `GOV_DELETE_REQUEST_WRITE`
3. `GOV_DELETE_REQUEST_EXECUTE`
- Phase 3 role matrix MUST be:
1. all Java roles -> `GOV_DELETE_REQUEST_READ`
2. `TECH_ADMIN / FINANCE / OPS_TREASURY / COMPLIANCE_LEAD / DPO` -> `GOV_DELETE_REQUEST_WRITE`
3. `TECH_ADMIN / DPO` -> `GOV_DELETE_REQUEST_EXECUTE`
4. `SUPER_ADMIN` -> all permissions

## 10) Delivery Checklist
- Prisma migration added for `delete_requests` and target soft delete fields.
- Approval submit and projection path verified end-to-end.
- Execute soft delete path verified with tests.
- Soft-deleted approvals, change tickets, and evidence packages are hidden from normal list/detail/download paths.
- RBAC sync updates new delete request permissions into active roles.

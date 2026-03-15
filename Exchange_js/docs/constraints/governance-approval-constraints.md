# Governance Approval Constraints

## 1) Scope and Ownership
- MUST keep `WF-03` canonical implementation under:
1. `src/modules/governance/approvals`
2. `src/modules/governance/approvals/constants`
- MUST treat `Approval Engine + maker-checker` as the shared governance approval baseline for Wave 1.
- MUST NOT fold `GOV-02 effectiveness gate` semantics into this file until that workflow exists as an implemented capability.

## 2) Data Model and No-First Contract
- MUST persist:
1. `approval_cases`
2. `approval_steps`
3. `approval_action_policies`
4. `approval_sod_rules`
- `approval_cases.approvalNo` MUST remain the operator-facing primary identifier.
- `approvalNo` MUST be generated with `generateReferenceNo('APR')`.
- Internal routing and foreign-key relations MAY continue to use `id`, but admin UI and default search MUST prioritize `approvalNo`.
- V1 MUST remain single-step only:
1. `approval_steps` is retained for forward compatibility
2. newly created approvals MUST use one logical step (`stepNo=1`)

## 3) Approval State Machine
- MUST keep approval state machine:
1. `DRAFT`
2. `PENDING`
3. `APPROVED`
4. `REJECTED`
5. `EXPIRED`
6. `CANCELLED`
- MUST keep execution state machine:
1. `NOT_EXECUTED`
2. `EXECUTED`
3. `EXECUTION_FAILED`
- `submit` MUST be allowed only from `DRAFT`.
- `approve` and `reject` MUST be allowed only from `PENDING`.
- `cancel` MUST be allowed only when policy permits and current state is still cancellable.
- V1 MUST NOT introduce:
1. multi-step serial approvals
2. parallel approvals
3. per-case custom checker-role override

## 4) Action Type and SoD Baseline
- Approval action types MUST remain limited to the active Wave 1 baseline:
1. `SENSITIVE_EXPORT_APPROVAL`
2. `CHANGE_TICKET_APPROVAL`
3. `DELETE_REQUEST_APPROVAL`
- Maker-checker SoD MUST block the same non-super-admin user from acting as both maker and checker.
- `SUPER_ADMIN` MAY bypass maker-checker SoD, but audit metadata MUST include `superAdminBypass=true`.
- Duplicate pending approvals for the same `actionType + entityRef` MUST be blocked by engine rules.

## 5) Audit and Workflow Traceability
- All approval writes MUST go through `AuditLogsService`.
- Approval audit records MUST include:
1. `approvalNo`
2. `traceId`
3. `workflowType`
4. `workflowNo`
- Approval-driven business actions SHOULD include `approvalNo` in `subjectNos` when linked.
- Approval audit action dictionary MUST include at least:
1. `APPROVAL_SUBMITTED`
2. `APPROVAL_APPROVED`
3. `APPROVAL_REJECTED`
4. `APPROVAL_CANCELLED`
5. `APPROVAL_EXPIRED`
6. `APPROVAL_EXECUTED`
7. `APPROVAL_EXECUTION_FAILED`
8. `APPROVAL_REQUIRED_MISSING`

## 6) API, Route, and RBAC Contract
- Approval admin API MUST be surfaced under:
1. `/admin/control-gates/approvals`
2. `/admin/control-gates/approvals/:id`
- Approval admin UI MUST be surfaced under:
1. `/dashboard/control-gates/approvals`
2. `/dashboard/control-gates/approvals/:id`
- Approval permission groups MUST include:
1. `GOV_APPROVAL_READ`
2. `GOV_APPROVAL_WRITE`
3. `GOV_APPROVAL_DECIDE`
- `GET /auth/me` permission resolution MUST expose the above permissions after `db:base:sync`.

## 7) Delivery Checklist
- Approval list/detail use `approvalNo` as the primary operator-facing identifier.
- Approval routes and permission codes use `control-gates`, not `governance`.
- Approval detail, evidence export detail, and linked workflow pages display `approvalNo` where relevant.
- Approval engine behavior remains aligned with current Wave 1 implementation and excludes unimplemented GOV-02 semantics.

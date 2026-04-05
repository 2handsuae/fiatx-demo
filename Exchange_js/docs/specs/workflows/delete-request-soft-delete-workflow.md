Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-04
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/delete-request-entity.md`, `docs/specs/entities/approval-case-entity.md`, `docs/specs/entities/admin-user-entity.md`
Source of Truth Level: specs-workflow

# Delete Request Soft Delete Workflow

## Purpose
- Canonical governance lifecycle for delete requests in the minimal approval-and-consume model for `WF-05`.
- `Delete Request` 是治理容器，不是 operator-facing 顶层 workflow 名称。

## Actors
- delete-request maker
- approval checker
- canceller
- consumer

## State Model
- `DRAFT`
- `PENDING_APPROVAL`
- `READY`
- `DONE`
- `FAILED`
- `REJECTED`
- `CANCELLED`

## Target Scope
- `CHANGE_TICKET`
- `AUDIT_EVIDENCE_PACKAGE`
- `ADMIN_USER`

## Key Transitions
- `create` resolves `targetNo`, captures a target snapshot, and creates one draft request.
- `submit` creates and submits one `DELETE_REQUEST_APPROVAL` and moves the request to `PENDING_APPROVAL`.
- Approval projection maps:
  - `APPROVED -> READY`
  - `REJECTED / EXPIRED / CANCELLED -> REJECTED`
- `cancel` moves the request to `CANCELLED`.
- `consume` is allowed only for `READY` requests and writes the standardized soft-delete fields on the target row.
- There is no execute, resubmit, undelete, or hard-delete step in this workflow.

## Entry Flows
- Runtime delete entry flows are limited to:
  - `ChangeTicket` deletion from `Control Gates Center -> Change Tickets -> Detail`
  - `Admin Member` deletion from `Backend Member Management -> Platform Members -> Member Detail`
  - `Audit Evidence Package` deletion from `Audit Logging -> Evidence Packages -> Detail`
- All three entry surfaces only create `DeleteRequest`.
- Approval only moves the request to `READY`.
- Formal soft delete happens only when `DeleteRequest.consume` succeeds.
- 页面第一层 operator-facing workflows 分别为：
  - `CHANGE_TICKET_DELETION`
  - `ADMIN_USER_DELETION`
  - `AUDIT_EVIDENCE_PACKAGE_DELETION`
- 每个删除 workflow 实例对应自己的一条 trace。
- 删除 workflow 不继承被删 target 的原 trace。
- linked approval 是该删除 workflow 内的嵌入式治理节点，不是新的顶层 workflow。

## SoD Rules
- `submit` is allowed only for the creator and only from `DRAFT`.
- `cancel` is allowed for the creator, and `SUPER_ADMIN` may cancel another user's request.
- `consume` is blocked for the creator unless the actor is `SUPER_ADMIN`.
- If the request has an approval case, `consume` re-checks that approval case is approved before deleting the target.
- `SUPER_ADMIN` bypasses the creator-executor SoD, and audit metadata records the bypass.

## Target Gate Rules
- `CHANGE_TICKET` must exist, must not already be deleted, and must be in a terminal ticket status: `DONE`, `FAILED`, `REJECTED`, or `CANCELLED`.
- `AUDIT_EVIDENCE_PACKAGE` must exist, must not already be deleted, and must not have a pending linked approval.
- `ADMIN_USER` must exist, must not already be deleted, and is resolved by `userNo` in the admin create flow.
- `ADMIN_USER` delete proposals do not directly delete the member from `PlatformMembers`; member deletion remains pending until consume writes the soft-delete fields.

## Audit / Workflow Semantics
- 页面第一层 workflow 语言使用 `CHANGE_TICKET_DELETION`、`ADMIN_USER_DELETION`、`AUDIT_EVIDENCE_PACKAGE_DELETION`，不使用 `Delete Request`。
- 第一层 user action 使用 `REQUEST_CREATED`、`SUBMITTED`、`APPROVED_FOR_EXECUTION`、`CANCELLED`、`EXECUTED`、`EXECUTION_FAILED` 等稳定 vocabulary。
- `requestNo` 作为删除 workflow 的 `primaryRefNo`。
- raw `DELETE_REQUEST_*` action、`workflowType/workflowNo`、approval technical action 保留在 technical context。

## Read / Write Owners
- `DeleteRequestsService` owns request lifecycle, target validation, snapshot capture, cancel, and consume.
- `ApprovalsService` owns linked approval lifecycle and approval terminal projection.
- Target modules own their primary read models and must honor the soft-delete fields.
- `AuditLogsService` owns canonical delete-request audit events.

## API / UI Projection
- API:
  - `POST /admin/control-gates/delete-requests`
  - `GET /admin/control-gates/delete-requests`
  - `GET /admin/control-gates/delete-requests/:id`
  - `POST /admin/control-gates/delete-requests/:id/submit`
  - `POST /admin/control-gates/delete-requests/:id/cancel`
  - `POST /admin/control-gates/delete-requests/:id/consume`
- UI:
  - `Control Gates Center -> Delete Requests`

## MUST / MUST NOT
- MUST resolve targets by `targetNo` in admin create flow.
- MUST keep business pages as delete-proposal entry points only.
- MUST keep target objects readable until the delete request is actually consumed.
- MUST preserve delete-request detail readability after target deletion.
- MUST keep delete workflows on their own trace and MUST NOT inherit target trace.
- MUST NOT keep `execute`, `READY_TO_EXECUTE`, `EXECUTED`, or `COMPLIANCE_CASE_EVIDENCE_PACKAGE` as canonical behavior.
- MUST NOT soft-delete `CHANGE_TICKET`, `ADMIN_USER`, or `AUDIT_EVIDENCE_PACKAGE` directly from their business/detail pages.
- MUST NOT describe `Delete Request` as the page first-layer workflow name in audit surfaces.

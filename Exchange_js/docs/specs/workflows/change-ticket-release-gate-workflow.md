Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-04
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/change-ticket-entity.md`, `docs/specs/entities/approval-case-entity.md`
Source of Truth Level: specs-workflow

# Change Ticket Workflow

## Purpose
- Canonical governance lifecycle for change tickets in the minimal approval-and-consume model for `WF-06`.
- Runtime business pages create governance proposals first; approval only grants `READY`, and `consume` performs the formal business write.
- `Change Ticket` 是治理容器，不是 operator-facing 顶层 workflow 名称。

## Actors
- change maker
- approval checker
- consumer

## State Model
- `DRAFT`
- `PENDING_APPROVAL`
- `READY`
- `DONE`
- `FAILED`
- `REJECTED`
- `CANCELLED`

## Key Transitions
- `create` creates one draft ticket.
- `submit` creates and submits one `CHANGE_TICKET_APPROVAL` and moves the ticket to `PENDING_APPROVAL`.
- Approval projection maps:
  - `APPROVED -> READY`
  - `REJECTED / EXPIRED / CANCELLED -> REJECTED`
- `consume` is allowed only for `READY` tickets and moves the ticket to `DONE` or `FAILED`.
- There is no gate, deploy, close, or resubmit step in this workflow.

## Governed Flow Scope
- Canonical change-ticket business flows are limited to:
  - `ADMIN_ACCESS_CHANGE`
  - `RBAC_CATALOG_CHANGE`
- Operator-facing display labels are:
  - `ADMIN_ACCESS_CHANGE -> ADMIN_MEMBER_PROVISIONING`
  - `RBAC_CATALOG_CHANGE -> ADMIN_ROLE_BINDING_CHANGE`
- Business entry surfaces create the proposal:
  - `PlatformMembers` create-admin action creates `ADMIN_MEMBER_PROVISIONING`
  - `PlatformMembers` role-change action creates `ADMIN_ROLE_BINDING_CHANGE`
- Approval does not apply the business effect; it only moves the ticket to `READY`.
- `consume` applies the frozen `bindingSnapshot` as the formal write.
- 一个 `ADMIN_MEMBER_PROVISIONING` 或 `ADMIN_ROLE_BINDING_CHANGE` 实例对应一条 trace。
- linked approval 是该 trace 内的嵌入式治理节点，不是新的顶层 workflow。

## Release Rules
- `changeType` is limited to `ADMIN_ACCESS_CHANGE` and `RBAC_CATALOG_CHANGE`.
- Submission stores `approvalCaseId`, `approvalNo`, `submittedByUserNo`, and `submittedAt`.
- Consume stores `consumedByUserNo`, `consumedAt`, and `resultNote`.
- `bindingSnapshot` is frozen at ticket creation and is the approval / consume contract.
- Consuming `ADMIN_MEMBER_PROVISIONING` creates the `INACTIVE` admin user, initial role bindings, and the first invitation.
- Consuming `ADMIN_ROLE_BINDING_CHANGE` replaces the target member's role bindings.

## Audit / Workflow Semantics
- 页面第一层 workflow 语言使用 `ADMIN_MEMBER_PROVISIONING`、`ADMIN_ROLE_BINDING_CHANGE`，不使用 `Change Ticket`。
- 第一层 user action 使用 `REQUEST_CREATED`、`SUBMITTED`、`APPROVED_FOR_EXECUTION`、`EXECUTED`、`EXECUTION_FAILED` 等稳定 vocabulary。
- `ticketNo` 作为这些 workflow 的 `primaryRefNo`。
- raw `CHANGE_TICKET_*` action、`workflowType/workflowNo`、approval technical action 保留在 technical context。

## Read / Write Owners
- `ChangeTicketsService` owns ticket lifecycle, approval projection, business-page proposal helpers, and consume dispatch.
- `ApprovalsService` owns linked approval lifecycle and approval terminal projection.
- `UsersService` owns the formal provisioning write executed from `ChangeTicket.consume`.
- `AccessControlService` owns the formal role-binding replacement executed from `ChangeTicket.consume`.
- `AuditLogsService` owns canonical audit logging for create, submit, approval-link, approval projection, and consume actions.

## API / UI Projection
- API:
  - `POST /users`
  - `PUT /admin/iam/users/:id/roles`
  - `POST /admin/control-gates/change-tickets`
  - `GET /admin/control-gates/change-tickets`
  - `GET /admin/control-gates/change-tickets/:id`
  - `POST /admin/control-gates/change-tickets/:id/submit`
  - `POST /admin/control-gates/change-tickets/:id/consume`
- UI:
  - `Backend Member Management -> Platform Members`
  - `Control Gates Center -> Change Tickets`

## MUST / MUST NOT
- MUST keep `ticketNo` as the operator-facing default identifier.
- MUST keep approval as a release decision only; business state becomes real only after `consume`.
- MUST let business pages create governed proposals without directly mutating admin users or role bindings.
- MUST write approval linkage and consume through canonical audit logging.
- MUST keep approval audit events on the parent business workflow trace.
- MUST NOT perform the formal admin-member create or role-binding replace during proposal submission or approval projection.
- MUST NOT expose gate, deploy, close, or resubmit semantics as canonical workflow behavior.
- MUST NOT describe `Change Ticket` as the page first-layer workflow name in audit surfaces.

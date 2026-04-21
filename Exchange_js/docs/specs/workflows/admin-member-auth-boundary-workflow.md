> **PARTIALLY OUTDATED** — Some sections of this document no longer match the current code.
> Last verified: 2026-04-11. See notes below for specific outdated sections.
>
> Updated specs: `docs/specs/wave3-layer2-risk-assessment.md`, `docs/specs/wave3-layer3-material-refresh.md`, `docs/specs/wave3-onboarding-integration.md`
>
> **Note:** Missing Wave 3 risk-rating approval flows

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-04
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/admin-user-entity.md`, `docs/specs/modules/rbac-member-management-module.md`
Source of Truth Level: specs-workflow

# Admin Member Auth Boundary Workflow

## Purpose
- This workflow defines the Wave 1 admin-member lifecycle and auth-boundary semantics for `WF-02`.
- The runtime member path is `Platform Members`; `Role Management` explains the fixed catalog and does not author runtime roles.
- Create-admin and role-change operations are governed proposals first; approval moves the linked ticket to `READY`, and only `ChangeTicket.consume` performs the formal write.
- audit 页面第一层 workflow 语言采用 business workflow，而不是 governance container 名称。

## Actors
- member proposal maker
- approval checker
- change-ticket consumer
- invited admin user
- admin auth service

## Lifecycle Model
- Member lifecycle:
  - `submit provisioning proposal -> approval -> READY`
  - `ChangeTicket.consume -> create member as INACTIVE`
  - `accept invitation -> ACTIVE`
  - `delete request consume -> soft delete -> excluded from normal runtime`
- Invitation lifecycle is derived from invitation status:
  - `PENDING`
  - `REVOKED`
  - `EXPIRED`
  - `USED`

## Key Transitions
- `POST /users` creates one `ADMIN_ACCESS_CHANGE` change ticket and does not create a `User` yet; operator-facing workflow is `ADMIN_MEMBER_PROVISIONING`.
- `PUT /admin/iam/users/:id/roles` creates one `RBAC_CATALOG_CHANGE` change ticket and does not replace role bindings yet; operator-facing workflow is `ADMIN_ROLE_BINDING_CHANGE`.
- Approval projection moves governed admin-member tickets from `PENDING_APPROVAL` to `READY`.
- `POST /admin/control-gates/change-tickets/:id/consume` is the only formal write point for governed member changes.
- Consuming `ADMIN_MEMBER_PROVISIONING` creates the `INACTIVE` admin user, the first role bindings, and the first invitation.
- Consuming `ADMIN_ROLE_BINDING_CHANGE` replaces the target member's role bindings using the frozen ticket snapshot.
- `GET /auth/admin-invitations/:token` validates that the token is still usable.
- `POST /auth/admin-invitations/accept` sets password and flips member status to `ACTIVE`.
- `POST /auth/login` rejects `INACTIVE` or soft-deleted admin users; operator-facing workflow is `ADMIN_LOGIN_ACCESS`.
- `POST /users/:id/invitations/resend` remains an invitation child flow, does not require a new change ticket, and issues the next invitation for the same `INACTIVE` member.
- Role changes update authorization truth through `user_roles`, not `users.role`.
- Member role binding is runtime behavior; the role catalog stays fixed and is not created or edited through this workflow.
- No invitation email is sent in this workflow; operators use the canonical invitation display in `Platform Members -> Member Detail -> Invitation & Activation`.

## Audit / Workflow Semantics
- `ADMIN_MEMBER_PROVISIONING`、`ADMIN_ROLE_BINDING_CHANGE`、`ADMIN_LOGIN_ACCESS` 是当前 Wave 1 admin-member 域的 operator-facing workflows。
- 一个 workflow 实例对应一条 trace：
  - provisioning trace 串起 `USER_CREATED`、`USER_ROLE_BINDING_UPDATED`、`ADMIN_INVITATION_CREATED`、`ADMIN_INVITATION_RESENT`、`ADMIN_INVITATION_ACCEPTED`、`ADMIN_INVITATION_ACCEPT_FAILED`
  - login trace 仅用于 `ADMIN_LOGIN_*`，不并入 provisioning trace
- linked approval 是 provisioning / role-binding workflow 内的嵌入式治理节点，不是独立顶层 workflow。
- 页面第一层 user action 使用 `REQUEST_CREATED`、`SUBMITTED`、`APPROVED_FOR_EXECUTION`、`EXECUTED`、`RESENT`、`ACCEPTED`、`ACCEPT_FAILED`、`LOGIN_SUCCEEDED`、`LOGIN_FAILED` 等稳定 vocabulary。
- 第一层主编号优先使用父业务 workflow 编号；raw `CHANGE_TICKET_*`、`APPROVAL_*`、`ADMIN_LOGIN_*` technical action 与 raw tuple 保留在 technical context。

## Read / Write Owners
- `ChangeTicketsService` owns governed proposal creation and consume dispatch for admin-member change flows.
- `UsersService` owns member list/detail, formal provisioning execution, and resend-invitation entry for existing `INACTIVE` members.
- `AdminInvitationsService` owns invitation token issuance and validation.
- `AuthService` owns admin login and `/auth/me` permission resolution.
- `AccessControlService` owns role / permission catalog truth and formal role-binding replacement during ticket consume.
- `DeleteRequestsService` owns governed member deletion; member pages only create delete requests and consume performs the soft delete.
- `AuditLogsService` owns audit logging for governed member changes, login, invitation, and permission-affecting member operations.

## API / UI Projection
- API:
  - `POST /users`
  - `GET /users`
  - `GET /users/:id`
  - `POST /users/:id/invitations/resend`
  - `PUT /admin/iam/users/:id/roles`
  - `POST /admin/control-gates/change-tickets/:id/consume`
  - `POST /auth/login`
  - `GET /auth/admin-invitations/:token`
  - `POST /auth/admin-invitations/accept`
  - `GET /auth/me`
- UI:
  - `Backend Member Management -> Platform Members`
  - `Backend Member Management -> Platform Members -> Member Detail -> Invitation & Activation`
  - `Backend Member Management -> Role Management` (catalog explanation only)

## MUST / MUST NOT
- MUST keep admin auth separate from `/auth/customer/*`.
- MUST keep authorization truth in role bindings.
- MUST keep business pages as proposal-entry surfaces and keep `consume` as the only formal member-write point for governed create / role-change flows.
- MUST keep the role catalog fixed and treat `Role Management` as explanatory, not as a runtime role-authoring surface.
- MUST exclude soft-deleted admin users from member, invitation, and auth flows.
- MUST keep `resend invitation` as a child flow on the already-provisioned member and MUST NOT create a new change ticket for resend.
- MUST keep `ADMIN_LOGIN_ACCESS` on its own login trace and MUST NOT merge it into provisioning trace.
- MUST NOT create the admin user, invitation, or formal role bindings during business-page proposal submission or approval projection.
- MUST NOT treat `users.role` as the canonical permission source.
- MUST NOT describe `Change Ticket` or `Approval` as the page first-layer workflow name in audit surfaces.

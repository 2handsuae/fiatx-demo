Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/entities/admin-user-entity.md`, `docs/specs/modules/rbac-member-management-module.md`
Source of Truth Level: specs-workflow

# Admin Member Auth Boundary Workflow

## Purpose
- This workflow defines the Wave 1 admin-member lifecycle and auth-boundary semantics for `WF-02`.
- The runtime member path is `Platform Members`; `Role Management` explains the fixed catalog and does not author runtime roles.

## Actors
- member creator
- invited admin user
- admin auth service

## Lifecycle Model
- Member lifecycle:
  - `create member -> INACTIVE`
  - `accept invitation -> ACTIVE`
  - `soft delete -> excluded from normal runtime`
- Invitation lifecycle is derived from token fields:
  - active
  - revoked
  - expired
  - consumed

## Key Transitions
- `POST /users` creates an `INACTIVE` admin user and returns invitation metadata.
- `GET /auth/admin-invitations/:token` validates that the token is still usable.
- `POST /auth/admin-invitations/accept` sets password and flips member status to `ACTIVE`.
- `POST /auth/login` rejects `INACTIVE` or soft-deleted admin users.
- `POST /users/:id/invitations/resend` invalidates the prior active token and creates a new invitation.
- Role changes update authorization truth through `user_roles`, not `users.role`.
- Member role binding is runtime behavior; the role catalog stays fixed and is not created or edited through this workflow.

## Read / Write Owners
- `UsersService` owns member create, list, and role-binding convergence.
- `AdminInvitationsService` owns invitation token issuance and validation.
- `AuthService` owns admin login and `/auth/me` permission resolution.
- `AccessControlService` owns role / permission catalog truth.
- `AuditLogsService` owns audit logging for login, invitation, and permission-affecting member operations.

## API / UI Projection
- API:
  - `POST /users`
  - `GET /users`
  - `POST /users/:id/invitations/resend`
  - `POST /auth/login`
  - `GET /auth/admin-invitations/:token`
  - `POST /auth/admin-invitations/accept`
  - `GET /auth/me`
- UI:
  - `Backend Member Management -> Platform Members`
  - `Backend Member Management -> Role Management` (catalog explanation only)

## MUST / MUST NOT
- MUST keep admin auth separate from `/auth/customer/*`.
- MUST keep authorization truth in role bindings.
- MUST keep the role catalog fixed and treat `Role Management` as explanatory, not as a runtime role-authoring surface.
- MUST exclude soft-deleted admin users from member, invitation, and auth flows.
- MUST NOT treat `users.role` as the canonical permission source.

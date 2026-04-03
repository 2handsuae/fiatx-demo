Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: specs-module

# RBAC Member Management Module

## Purpose
- This document defines the durable Wave 1 admin-member and auth-boundary module contract for:
  - platform member lifecycle
  - invitation activation
  - admin login eligibility
  - role binding truth
- The role catalog is fixed; `Platform Members` is the runtime path, and `Role Management` is the catalog explainer.

## Canonical Entrypoints
- Member management:
  - `POST /users`
  - `GET /users`
  - `POST /users/:id/invitations/resend`
- Admin auth:
  - `POST /auth/login`
  - `GET /auth/admin-invitations/:token`
  - `POST /auth/admin-invitations/accept`
  - `GET /auth/me`

## Integration Contract
- `Platform Members` is the canonical admin surface for member create, list, and role assignment.
- `Role Management` explains role/permission catalog semantics, but does not replace member lifecycle operations or author the catalog at runtime.
- Authorization truth remains:
  - `user_roles`
  - `role_permissions`
- `users.role` remains a compatibility / display field only.
- Member role selection binds from the fixed catalog; it does not create or mutate role definitions.
- Soft-deleted admin users MUST be excluded from:
  - platform members list
  - admin login lookup
  - invitation preview
  - invitation accept
  - invitation resend
  - role replacement flows

## Audit Boundary
- Member creation, invitation resend, invitation accept, admin login, and permission-affecting role changes MUST be recorded through `AuditLogsService`.
- Admin member deletion remains a governed `Delete Request` target; member module does not own that approval lifecycle directly.

## Historical Aliases / Retired Notes
- Legacy JS role seed identities are not canonical runtime truth.
- SMTP delivery is not required for Wave 1; admin UI manual invite-link handoff remains the supported baseline.
- A soft-deleted admin user is retired runtime state, not an alternate inactive account flavor.
- `SUPER_ADMIN` remains a preserved fallback role with full-site permission and maker-checker SoD bypass capability.

## MUST / MUST NOT
- MUST resolve effective permissions from role bindings, not `users.role`.
- MUST preserve invitation-based `INACTIVE -> ACTIVE` activation.
- MUST keep admin auth boundary separate from customer auth under `/auth/customer/*`.
- MUST keep the role catalog fixed and treat `Role Management` as explanatory only.
- MUST NOT return soft-deleted admin users from normal list or auth paths.
- MUST NOT invent alternative activation or role-truth stores outside current RBAC tables.

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/rbac-member-management-constraints.md`
Source of Truth Level: specs-entity

# Role Entity

## Purpose
- This document defines `Role` as the durable authorization catalog subject for backend access control.

## Canonical Fields
- `id`
- `code`
- `name`
- `description`
- `status`
- `rolePermissions[]`
- `userRoles[]`

## Canonical Meaning
- `Role` is the reusable capability bundle assigned to backend users.
- `code` is the canonical operator-facing and seed-facing identifier.
- `Role` is a config subject, not a workflow root.

## Write Owners
- Base seed and RBAC catalog management own role creation and convergence.
- Member assignment flows consume roles, but do not redefine role semantics.

## Authorization Relationship
- Effective authorization truth remains:
  - `user_roles`
  - `role_permissions`
- `Role` names group permission bundles; they do not replace permission-level truth.

## Historical / Retired Notes
- Legacy JS role identities are historical only and MUST NOT return as active role catalog truth.

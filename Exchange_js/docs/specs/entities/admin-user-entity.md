Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
Source of Truth Level: specs-entity

# Admin User Entity

## Purpose
- This document defines the canonical semantics for backend admin users as the Wave 1 RBAC and auth-boundary entity.

## Canonical Fields
- `id`
- `userNo`
- `email`
- `password`
- `role`
- `status`
- `failedLoginAttempts`
- `lockedUntil`
- `lastLoginAt`
- `deletedAt`
- `deletedBy`
- `deleteRequestId`
- `deleteReason`
- `userRoles[]`
- `adminInvitations[]`

## Lifecycle Anchor
- Admin user lifecycle remains:
  - create member
  - invite / resend invite
  - accept invitation
  - login / session lookup
  - governed soft delete
- Invitation token rows are linked supporting objects, not a substitute for user identity.
- Runtime member flow binds admin users to the fixed role catalog; it does not author new roles.

## Write Owners
- `UsersService` owns create, list, and role-binding convergence.
- `AdminInvitationsService` owns invitation issuance and validation.
- `AuthService` owns admin login and session-facing read logic.
- `DeleteRequestsService` may retire the user through governed soft deletion.

## Authorization Truth
- Canonical authorization truth is:
  - `user_roles`
  - `role_permissions`
- The role catalog is fixed; member assignment selects from existing roles instead of mutating the catalog.
- `users.role` remains a compatibility / display field and MUST NOT be treated as the canonical permission source.

## Read-Model Meaning
- `userNo` is the operator-facing admin identity.
- `status` expresses activation readiness for login.
- `deletedAt` expresses governed retirement and removes the user from normal member, invitation, and auth read paths.

## Historical / Retired Notes
- Legacy JS role seed identities are not canonical Wave 1 runtime truth.
- Soft-deleted admin users are retired governed subjects, not alternative inactive members.
- `SUPER_ADMIN` remains a preserved fallback role with full-site permission and maker-checker SoD bypass capability.

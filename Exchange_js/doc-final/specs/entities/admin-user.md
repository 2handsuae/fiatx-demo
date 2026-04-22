# Admin User
Wave: 1 | Source verified: prisma/schema.prisma, src/modules/identity/users/users.service.ts, src/modules/identity/users/users.controller.ts, src/modules/identity/users/admin-invitations.service.ts, src/modules/identity/access-control/access-control.service.ts
Last Updated: 2026-04-21

## Prisma Model: User
Table: `users`
Business Key: `userNo` (prefix `ADM-`, generated via `generateReferenceNo`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| userNo | String | No | Unique business key, generated with `ADM` prefix |
| email | String | No | Unique; normalized to lowercase on write |
| password | String | No | bcrypt hash; initially set to a random 24-byte hex (unusable until invitation accepted) |
| role | String | No | Legacy single-role string; kept in JWT for backward compat; authoritative RBAC is via `userRoles` relation |
| status | String | No | INACTIVE / ACTIVE / LOCKED |
| failedLoginAttempts | Int | No | Default `0`; incremented on bad password |
| lockedUntil | DateTime | Yes | Account lock expiry after too many failed attempts |
| lastLoginAt | DateTime | Yes | Last successful login timestamp |
| deletedAt | DateTime | Yes | Soft-delete timestamp set by DeleteRequest consume |
| deletedBy | String | Yes | User ID of the admin who executed the deletion |
| deleteRequestId | String | Yes | DR that triggered the soft-delete |
| deleteReason | String | Yes | Reason from the delete request |
| createdAt | DateTime | No | Auto timestamp |
| updatedAt | DateTime | No | Auto-updated timestamp |

### Relations
- `userRoles` → `UserRole[]` → `Role` (RBAC binding; authoritative source of permissions)
- `adminInvitations` → `AdminUserInvitation[]`

## Status Enum (User.status)
| Value | Meaning |
|---|---|
| INACTIVE | Newly created; invitation not yet accepted; cannot log in |
| ACTIVE | Invitation accepted and password set; normal login permitted |
| LOCKED | Too many failed login attempts; `lockedUntil` is set |

## Invitation Model: AdminUserInvitation
Table: `admin_user_invitations`

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| userId | String | No | FK to User |
| tokenHash | String | No | Unique SHA-256 hash of the one-time token |
| expiresAt | DateTime | No | Expiry; TTL set by `ADMIN_INVITATION_TTL_HOURS` env (default 72 h) |
| consumedAt | DateTime | Yes | Set when the invitation link is used to set password |
| revokedAt | DateTime | Yes | Set when superseded by a resend, or when the user is deleted |
| createdByUserId | String | Yes | Admin who triggered the invitation |
| workflowType | String | Yes | Audit workflow type of the originating action |
| workflowNo | String? | Yes | Originating workflow number (note: field persists legacy `workflowNo` in invitation record; NOT used in audit log entity) |
| traceId | String | Yes | Trace ID from the originating governance workflow |
| createdAt | DateTime | No | Auto timestamp |
| updatedAt | DateTime | No | Auto-updated timestamp |

### Invitation Status (computed, not stored)
| Value | Logic |
|---|---|
| PENDING | Not yet consumed or revoked, and not expired |
| EXPIRED | `expiresAt <= now` and not consumed or revoked |
| USED | `consumedAt != null` |
| REVOKED | `revokedAt != null` |

## RBAC Model: Role / Permission / UserRole
- `Role` (table `roles`): `code` (unique), `name`, `description`, `status` (ACTIVE)
- `Permission` (table `permissions`): `code` (unique), `method`, `path`
- `UserRole` (table `user_roles`): junction between User and Role; unique on `(userId, roleId)`
- `RolePermission` (table `role_permissions`): junction between Role and Permission

## Key Business Rules
- **Creation flow requires governance**: `POST /users` does NOT directly create the user; it creates an `ADMIN_ACCESS_CHANGE` ChangeTicket via `createAdminMemberProvisioningTicket()`; actual user creation happens when the ticket is consumed (event `CHANGE_TICKET_CONSUMED`)
- **Invitation required to activate**: a new user is created with `status: INACTIVE` and an unusable random password; an `AdminUserInvitation` is created simultaneously; the user must click the invite link and set a password to become ACTIVE
- **Invitation resend is idempotent**: resending revokes all non-consumed, non-revoked active invitations first, then issues a new one; only works for INACTIVE users
- **Only one active invitation at a time**: existing non-expired, non-consumed, non-revoked invitations are revoked before a new one is created
- **Primary role code**: `getPrimaryRoleCode()` from the RBAC catalog picks the most privileged role for the legacy `role` field; the authoritative set is in `userRoles`
- **Soft-delete via DeleteRequest**: users are never hard-deleted; `deletedAt`/`deletedBy`/`deleteRequestId`/`deleteReason` are set; `findOne` / `findAll` filter `deletedAt: null`; upon deletion, all non-consumed, non-revoked invitations are revoked
- **Account lock**: `status` transitions to `LOCKED` after configured failed login attempts; `lockedUntil` clears automatically on next successful login or after the lock duration
- **Role replacement governance**: changing an existing user's roles requires an `RBAC_CATALOG_CHANGE` ChangeTicket (created via `createAdminRoleBindingChangeTicket()`)
- **Provisioning idempotency**: if `executeAdminMemberProvisioning()` encounters an INACTIVE user with matching email and identical role codes, it resends the invitation rather than failing with a conflict

## Service Methods (key operations)
- `createAdminUser(input)` — internal; creates user + invitation + role binding atomically; used by the governed execution flow
- `executeAdminMemberProvisioning(binding, actor)` — called on `CHANGE_TICKET_CONSUMED` for `ADMIN_ACCESS_CHANGE` tickets; idempotent on matching INACTIVE user
- `getMemberDetail(id)` — returns user fields + `roles[]` from UserRole + `latestInvitation` summary (status, expiresAt)
- `findAll(params)` — paginated list; always excludes soft-deleted users; includes `roles` via userRoles join
- `findOne(email)` — find active user by normalized email
- `findByIdentifier(identifier)` — find active user by email or userNo
- `resendAdminInvitation(input)` — delegates to `adminInvitationsService.resendInvitationForUser()`; only for INACTIVE users

## API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | /users | Create admin member provisioning change ticket (governance-gated) |
| GET | /users | List admin users (paginated; excludes soft-deleted) |
| GET | /users/:id | Get user detail with invitation summary |
| POST | /users/:id/invitations/resend | Resend invitation link for INACTIVE user |

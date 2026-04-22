# Role

Wave: 1 | Source verified: prisma/schema.prisma, src/modules/identity/access-control/rbac.catalog.ts, src/modules/identity/access-control/access-control.service.ts, src/modules/identity/access-control/access-control.controller.ts
Last Updated: 2026-04-21

## Prisma Model: Role

Table: `roles`
Business Key: `code` (unique string; matches RBAC catalog codes)

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | Primary key |
| code | String | No | Unique role identifier; e.g. `SUPER_ADMIN`, `CISO` |
| name | String | No | Human-readable display name |
| description | String | Yes | Role description / governance mandate |
| status | String | No | Default "ACTIVE"; only ACTIVE roles participate in RBAC resolution |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto-updated |

### Relations

| Relation | Type | Notes |
|---|---|---|
| rolePermissions | RolePermission[] | Join table binding role to permissions |
| userRoles | UserRole[] | Join table binding users to this role |

### Related Model: UserRole (join table)

Table: `user_roles`

| Field | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| userId | String | FK → User.id (Cascade delete) |
| roleId | String | FK → Role.id (Cascade delete) |
| createdAt | DateTime | Auto |
| updatedAt | DateTime | Auto |

Unique constraint: `(userId, roleId)`

## Role Catalog (RBAC_ROLE_DEFINITIONS)

All roles are seeded and managed via `rbac.catalog.ts`. The authoritative list is:

| Code | Name | Governance Mandate |
|---|---|---|
| `SUPER_ADMIN` | Super Administrator | Emergency full access; not for routine operations; bypasses all permission checks; gets ALL permissions |
| `SENIOR_MANAGEMENT_OFFICER` | Senior Management Officer | Senior oversight, high-level approvals, regulatory accountability |
| `CISO` | Chief Information Security Officer | Security governance, IAM control owner; VARA Responsible Individual candidate |
| `MLRO` | Money Laundering Reporting Officer | AML oversight, SAR filing, independent regulatory reporting; VARA Responsible Individual candidate |
| `DPO` | Data Protection Officer | Sensitive export governance, privacy compliance |
| `COMPLIANCE_OFFICER` | Compliance Officer | Daily compliance ops, audit export governance, regulatory program management |
| `TECH_OFFICER` | Tech Officer | Platform operations, technical governance, change management |
| `OPS_OFFICER` | Operations Officer | Treasury operations, settlement, reconciliation, accounting oversight |

`ACTIVE_RBAC_ROLE_CODES` = all 8 codes above.

## Primary Role Priority

When a user holds multiple roles, the "primary" role for JWT backward-compatibility is resolved in this order:
`SUPER_ADMIN > CISO > DPO > MLRO > COMPLIANCE_OFFICER > SENIOR_MANAGEMENT_OFFICER > TECH_OFFICER > OPS_OFFICER`

Implemented by `getPrimaryRoleCode(roleCodes)` in `rbac.catalog.ts`.

## Role-to-Permission Group Bindings (RBAC_ROLE_GROUP_BINDINGS)

Permission groups assigned per role (each group maps to a set of permission codes):

| Role | Permission Groups |
|---|---|
| SUPER_ADMIN | ALL permissions (special-cased; bypasses group lookup) |
| SENIOR_MANAGEMENT_OFFICER | BASE_ACCESS, IAM_READ, AUDIT_READ, RISK_DECISION_RECORD_READ, ALERT_READ, CASE_READ, CASE_EXPORT_READ, RECON_BREAK_READ, GOV_APPROVAL_READ, GOV_CHANGE_TICKET_READ, GOV_DELETE_REQUEST_READ, GOV_REGISTRY_READ, GOV_REGULATORY_GATE_READ, GOV_SLA_READ |
| TECH_OFFICER | BASE_ACCESS, IAM_READ, AUDIT_READ, AUDIT_EXPORT_READ, RISK_DECISION_RECORD_READ/WRITE, RECON_BREAK_READ/WRITE, GOV_APPROVAL_READ/DECIDE, GOV_CHANGE_TICKET_READ/WRITE/GATE/CLOSE, GOV_DELETE_REQUEST_READ/WRITE/CONSUME, GOV_REGISTRY_READ/WRITE, GOV_REGULATORY_GATE_READ/WRITE, GOV_SLA_READ/WRITE |
| OPS_OFFICER | BASE_ACCESS, IAM_READ, AUDIT_READ, RECON_BREAK_READ/WRITE, GOV_APPROVAL_READ, GOV_CHANGE_TICKET_READ/WRITE, GOV_DELETE_REQUEST_READ/WRITE, GOV_REGISTRY_READ, GOV_REGULATORY_GATE_READ |
| COMPLIANCE_OFFICER | BASE_ACCESS, IAM_READ, AUDIT_READ, AUDIT_EXPORT_CREATE/READ, RISK_DECISION_RECORD_READ/WRITE, ALERT_READ/WRITE, CASE_READ/WRITE, CASE_EXPORT_READ/WRITE, RECON_BREAK_READ/WRITE, GOV_APPROVAL_READ/WRITE, GOV_CHANGE_TICKET_READ/WRITE, GOV_DELETE_REQUEST_READ/WRITE, GOV_REGISTRY_READ/WRITE, GOV_REGULATORY_GATE_READ/WRITE, GOV_SLA_READ/WRITE |
| MLRO | BASE_ACCESS, IAM_READ, AUDIT_READ, AUDIT_EXPORT_CREATE/READ, RISK_DECISION_RECORD_READ/WRITE, MLRO_REVIEW_WRITE, ALERT_READ/WRITE, CASE_READ/WRITE, CASE_EXPORT_READ/WRITE, RECON_BREAK_READ/WRITE, GOV_APPROVAL_READ/WRITE/DECIDE, GOV_CHANGE_TICKET_READ, GOV_DELETE_REQUEST_READ, GOV_REGISTRY_READ, GOV_SLA_READ |
| DPO | BASE_ACCESS, IAM_READ, AUDIT_READ, AUDIT_EXPORT_CREATE/READ, GOV_APPROVAL_READ/WRITE/DECIDE, GOV_CHANGE_TICKET_READ, GOV_DELETE_REQUEST_READ/WRITE/CONSUME, GOV_REGISTRY_READ/WRITE, GOV_REGULATORY_GATE_READ/WRITE, GOV_SLA_READ |
| CISO | BASE_ACCESS, IAM_READ, IAM_ASSIGN, AUDIT_READ, RISK_DECISION_RECORD_READ, ALERT_READ, CASE_READ, CASE_EXPORT_READ, RECON_BREAK_READ, GOV_APPROVAL_READ/DECIDE, GOV_CHANGE_TICKET_READ/WRITE/GATE, GOV_DELETE_REQUEST_READ, GOV_REGISTRY_READ/WRITE, GOV_REGULATORY_GATE_READ/WRITE, GOV_SLA_READ/WRITE |

## Key Business Rules

- Role records are seeded into the DB; the catalog in `rbac.catalog.ts` is the source of truth. Only roles with `status = ACTIVE` and `code IN ACTIVE_RBAC_ROLE_CODES` participate in permission resolution.
- `SUPER_ADMIN` is special-cased in `getUserPermissionCodes()` and `hasPermission()` — it receives every permission code without DB lookup.
- A user may hold multiple roles simultaneously (many-to-many via UserRole). Permissions are unioned across all held roles.
- `HARD_MUTEX_ROLE_PAIRS` is defined as an empty array (no current hard conflicts). `SOFT_WARNING_ROLE_GROUPS` is also empty — warnings are returned in the response but do not block assignment.
- Role binding changes are governed: `PUT /admin/iam/users/:id/roles` creates a ChangeTicket (via `changeTicketsService.createAdminRoleBindingChangeTicket`) rather than applying immediately. The change takes effect when the ChangeTicket is consumed.
- When a user's role set changes, `user.role` (legacy JWT field) is also updated to the primary role code to maintain JWT backward-compatibility.
- Every role assignment change writes an audit log (`USER_ROLE_BINDING_UPDATED`) with before/after role arrays.

## Service Methods (key operations)

- `listRoles()` — returns ACTIVE roles in catalog order; includes bound permissions per role
- `listPermissions()` — returns all Permission records ordered by code
- `listCatalogPermissions()` — returns `RBAC_PERMISSION_DEFINITIONS` without DB query
- `getUserRoles(userId)` — returns role objects for a user (ACTIVE catalog roles only)
- `getUserRoleCodes(userId)` — returns string[] of role codes
- `getUserPermissionCodes(userId)` — unions permission codes from all user roles; SUPER_ADMIN returns all
- `hasPermission(userId, permissionCode)` — boolean check
- `replaceUserRoles(userId, roleCodes, actor, auditContext?)` — DB transaction: deletes all UserRole rows, creates new ones, updates user.role legacy field, writes audit log
- `executeGovernedRoleBindingChange(binding, actor)` — called by governance workflow execution; wraps `replaceUserRoles` with ADMIN_ROLE_BINDING_CHANGE audit context

## API Endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | /admin/iam/roles | IAM_READ | List role catalog with bound permissions |
| GET | /admin/iam/permissions | IAM_READ | List permission catalog |
| GET | /admin/iam/users/:id/roles | IAM_READ | Get role bindings for a specific user |
| PUT | /admin/iam/users/:id/roles | IAM_ASSIGN | Create role binding ChangeTicket (governed change) |

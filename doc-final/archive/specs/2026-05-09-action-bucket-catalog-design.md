# Action Bucket Catalog Design

## Goal

Replace the fragmented, duplicated permission-group mappings with a single backend-owned **Action Bucket Catalog** — a user-facing capability abstraction where users see functional descriptions ("查看成员与角色") instead of permission codes (`api.get.users`). The catalog is defined once in `rbac.catalog.ts` and served via API; the frontend consumes it for both the Role Detail page and the Create Role modal.

## Architecture

```
rbac.catalog.ts
  RBAC_PERMISSION_DEFINITIONS   (existing — individual route permissions)
  ACTION_BUCKET_CATALOG         (new — domain → bucket → groups mapping)
        │
        ▼
  GET /admin/iam/action-buckets   (new API endpoint)
        │
        ├──▶ RoleDetailPage       (replaces hardcoded DOMAIN_CONFIG + PERM_CODE_TO_GROUP)
        └──▶ Create Role Modal    (replaces raw PermissionGroup checkbox list)
```

**Single source of truth**: `ACTION_BUCKET_CATALOG` in `rbac.catalog.ts`.  
**Frontend deletes**: `PERM_CODE_TO_GROUP` and `DOMAIN_CONFIG` in `RoleDetailPage.tsx`.

## Data Structures

### Backend (`rbac.catalog.ts`)

```typescript
export interface ActionBucket {
  key: string;           // unique ID, e.g. 'iam.view'
  label: string;         // user-facing label, e.g. 'View members & roles'
  description: string;   // hover tooltip
  groups: string[];      // maps to PermissionGroup[]
}

export interface ActionDomain {
  id: string;            // e.g. 'iam'
  label: string;         // e.g. 'Identity & Access'
  icon: string;          // e.g. '🔐'
  buckets: ActionBucket[]; // empty array for placeholder domains
}

export const ACTION_BUCKET_CATALOG: ActionDomain[] = [ ... ];
```

### API

`GET /admin/iam/action-buckets` — returns `ActionDomain[]` directly from `ACTION_BUCKET_CATALOG`.

No DB involved. Pure static catalog, can be cached indefinitely by the frontend.

### Frontend consumption

**RoleDetailPage**: Fetch `action-buckets`, derive `heldGroups` from the role's permissions via `PERM_CODE_TO_GROUP` (which remains for the reverse-lookup: permission code → group). Render domain cards with bucket rows showing ✓/✗.

Wait — we need the reverse lookup to still work. The `PERM_CODE_TO_GROUP` map translates individual permission codes (that the role holds) into group names, so we can check if a bucket's groups are held. This map should also move to the backend.

**Revised**: the `GET /admin/iam/action-buckets` response includes an additional field:

```typescript
export interface ActionBucketCatalogResponse {
  domains: ActionDomain[];
  permCodeToGroup: Record<string, string>;  // permission code → group
}
```

The `permCodeToGroup` map is derived from `RBAC_PERMISSION_DEFINITIONS` at serve time:

```typescript
const permCodeToGroup: Record<string, string> = {};
for (const perm of RBAC_PERMISSION_DEFINITIONS) {
  for (const group of perm.groups) {
    permCodeToGroup[perm.code] = group;  // last-group-wins for multi-group perms
  }
}
```

Note: a permission can belong to multiple groups. For the bucket `held` check, we need ALL groups a permission belongs to. Revised:

```typescript
permCodeToGroups: Record<string, string[]>;  // permission code → group[]
```

This is derived directly from `RBAC_PERMISSION_DEFINITIONS[].groups`.

**RoleDetailPage**: 
1. Fetch action-buckets API → get `domains` + `permCodeToGroups`
2. From role's `permissions[]`, build `heldGroups: Set<string>` using `permCodeToGroups`
3. For each bucket, `held = bucket.groups.some(g => heldGroups.has(g))`
4. Render domain cards

**Create Role Modal**:
1. Fetch action-buckets API → get `domains`
2. Show domain cards with checkboxes on each bucket (instead of raw PermissionGroup codes)
3. On submit, collect all `groups[]` from checked buckets → deduplicate → send as `permissionGroupCodes[]`

## Bucket `held` Logic

A bucket is **held** (✓) if **any** of its `groups` appear in the role's held groups set. This matches existing behavior.

## V1 Scope: Detailed Domains

Only 3 domains have buckets defined in V1. The remaining 11 domains are registered as placeholders (empty `buckets[]` array) — they appear as domain headers but show "No capabilities defined yet" in the UI.

### Domain 1: Identity & Access 🔐

| key | label | description | groups |
|-----|-------|-------------|--------|
| `iam.view` | View members & roles | Browse member list, view detail & role bindings, view role catalog | `['IAM_READ']` |
| `iam.manage_members` | Manage members | Invite members, resend invitations, assign/change roles | `['IAM_ASSIGN']` |
| `iam.manage_credentials` | Manage credentials | Reset password, reset MFA | `['IAM_CREDENTIAL_RESET']` |
| `iam.define_roles` | Create role definitions | Propose new role definitions for approval | `['IAM_ROLE_DEFINE']` |

### Domain 2: Approval Center 🚦

| key | label | description | groups |
|-----|-------|-------------|--------|
| `gov_approvals.view` | View approvals | Browse approval list, view approval detail and history | `['GOV_APPROVAL_READ']` |
| `gov_approvals.submit` | Submit approvals | Create and submit approval requests | `['GOV_APPROVAL_WRITE']` |
| `gov_approval_policies.view` | View approval policies | Browse approval policy configurations | `['GOV_APPROVAL_POLICY_READ']` |
| `gov_approval_policies.manage` | Manage approval policies | Submit approval policy change requests | `['GOV_APPROVAL_POLICY_WRITE']` |

Note: Approve/Reject decisions are governed by Approval Policy checker-role configuration, not by static permission groups. They are intentionally excluded from this catalog.

### Domain 3: Audit Center 📁

| key | label | description | groups |
|-----|-------|-------------|--------|
| `audit.view` | View audit logs | Browse audit log events, filter, view detail | `['AUDIT_READ']` |
| `audit.export` | Export evidence packages | Create, browse, and download audit evidence packages | `['AUDIT_EXPORT_CREATE', 'AUDIT_EXPORT_READ']` |
| `audit.manual_entry` | Manual audit entries | Create manual audit log entries | `['AUDIT_MANUAL_WRITE']` |

### Domains 4–14: Placeholders

| # | id | label | icon | buckets |
|---|-----|-------|------|---------|
| 4 | `customer` | Customer Management | 👥 | `[]` |
| 5 | `compliance` | Compliance | 🛡️ | `[]` |
| 6 | `trading` | Trading | 📊 | `[]` |
| 7 | `accounting` | Accounting | 📒 | `[]` |
| 8 | `treasury` | Treasury | 📦 | `[]` |
| 9 | `recon` | Reconciliation | 🔍 | `[]` |
| 10 | `pricing` | Pricing | 💰 | `[]` |
| 11 | `config` | Configuration | ⚙️ | `[]` |
| 12 | `gov_registry` | Governance Registries | 🏛️ | `[]` |
| 13 | `counterparty` | Counterparty | 🤝 | `[]` |
| 14 | `clearing` | Clearing | 📋 | `[]` |

## Files Changed

### Backend

| File | Change |
|------|--------|
| `src/modules/identity/access-control/rbac.catalog.ts` | Add `ActionBucket`, `ActionDomain`, `ACTION_BUCKET_CATALOG` exports; add helper to build `permCodeToGroups` map |
| `src/modules/identity/access-control/access-control.service.ts` | Add `getActionBucketCatalog()` method |
| `src/modules/identity/access-control/access-control.controller.ts` | Add `GET /admin/iam/action-buckets` route |
| `src/modules/identity/access-control/rbac.catalog.ts` (PermissionGroup type) | No change needed — existing groups are sufficient |

### Frontend

| File | Change |
|------|--------|
| `admin-web/src/pages/RoleDetailPage.tsx` | Delete `PERM_CODE_TO_GROUP` and `DOMAIN_CONFIG`; fetch from API; render using API data |
| `admin-web/src/pages/RolesPage.tsx` | Replace raw PermissionGroup checkboxes with domain→bucket checkboxes from API |
| `admin-web/src/rbac/permissions.ts` | Add `IAM_ACTION_BUCKETS_READ` permission constant |

### New permission route

Add to `rbac.catalog.ts`:
```
GET /admin/iam/action-buckets  →  groups: ['IAM_READ']
```

Gated by `IAM_READ` since anyone who can view roles should be able to see the capability catalog.

## UI Behavior

### RoleDetailPage

- Fetch `/admin/iam/action-buckets` on mount (alongside role data)
- Build `heldGroups` set from role permissions + `permCodeToGroups` map
- Render only domains where at least one bucket is held (existing behavior)
- Placeholder domains (empty buckets) never appear on role detail (no buckets = nothing to show)

### Create Role Modal

- Fetch `/admin/iam/action-buckets` when modal opens
- Show only domains with non-empty buckets (the 3 V1 domains)
- Each domain is a collapsible section; each bucket is a checkbox row
- On submit: collect `groups[]` from all checked buckets → deduplicate → send as `permissionGroupCodes[]`
- User never sees group codes — only bucket labels

## Non-Goals

- Approval decide/reject capabilities (governed by Approval Policy)
- Bucket definitions for domains 4–14 (future work)
- i18n of bucket labels (English only for V1)
- Bucket-level RBAC enforcement (backend still enforces at individual permission level)

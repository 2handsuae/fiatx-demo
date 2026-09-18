# Role Detail Page Redesign

## Goal

Redesign the Role Detail page (`admin-web/src/pages/RoleDetailPage.tsx`) to use **medium-granularity action buckets** instead of per-capability checklists, add a **member list** sidebar section, and remove all redundant/technical UI elements. All frontend text is English.

## Design Decisions

1. **Medium granularity** — Each domain groups its permissions into 2–3 "action buckets" (e.g., View / Manage / Credentials). Each bucket maps to one or more Permission Groups and has a single English description sentence summarizing what it covers.
2. **Incremental per Version** — Only domains with mapped Permission Groups are shown. Currently V1 has 3 domains (IAM, Approvals, Audit). As future Versions are built, new domains are added to the config. Unmapped permissions are completely hidden.
3. **Hide unmapped permissions** — If a permission code is not mapped to any domain's action bucket, it is not shown on the page at all. No "uncategorized" section.
4. **Show role holders** — The sidebar includes a member list showing all users who hold this role (avatar initials, email, userNo).
5. **English only** — All frontend labels and descriptions in English.

## Architecture

### Action Bucket Data Model

Each domain defines an array of action buckets. Each bucket has:
- `key`: unique identifier within the domain (e.g., `'view'`, `'manage'`)
- `label`: English display label (e.g., `'View'`, `'Manage'`)
- `groups`: array of Permission Group codes that grant this bucket
- `description`: one-sentence English summary of what operations are included

A bucket is "held" (✓) if the role holds **any** of the bucket's Permission Groups. Otherwise it is "not held" (✗).

### V1 Domain + Bucket Configuration

```
Identity & Access (iam)
├─ View       → [IAM_READ]              → "Browse member list, view detail & role bindings, view role catalog"
├─ Manage     → [IAM_ASSIGN]            → "Invite members, resend invitations, assign/change roles"
└─ Credentials→ [IAM_CREDENTIAL_RESET]  → "Reset password, reset MFA"

Governance · Approvals (gov-approvals)
├─ View       → [GOV_APPROVAL_READ]     → "Browse approval cases, view step history, view SoD configuration"
├─ Submit     → [GOV_APPROVAL_WRITE]    → "Create, submit, and cancel approval requests"
└─ Decide     → [GOV_APPROVAL_DECIDE]   → "Approve or reject approval cases"

Audit Center (audit)
├─ View       → [AUDIT_READ]            → "Browse audit log events, filter, view detail"
└─ Export     → [AUDIT_EXPORT_CREATE, AUDIT_EXPORT_READ] → "Create, browse, and download evidence packages"
```

Total: 3 domains, 8 action buckets.

### Page Layout — Streamlined Two-Panel

Consistent with `PlatformMemberDetailPage.tsx` layout pattern.

**Left main area (scrollable):**

1. **Role Banner** — Role code (large, amber), name, status badge, description
2. **Domain Cards** — Section header "Capabilities · V1", then one card per domain that the role has any access to. Each card contains the domain's action buckets displayed as rows:
   - Bucket label (e.g., "View") — fixed width
   - Status icon: ✓ green if held, ✗ red if not held
   - Description text — dimmed if not held
3. No OverviewBar, no Access Level badges, no raw API bindings, no "Show domains without access" toggle

**Right sidebar (fixed width ~240px):**

1. **Quick Info** — Status badge, domain coverage count (e.g., "3 / 3"), total API route count
2. **Members** — Section header "Members (N)", list of users holding this role (avatar initials + email + userNo), with a "→ View all in Members page" link at the bottom

### Removed UI Elements

| Element | Reason |
|---|---|
| OverviewBar (horizontal pills) | Redundant with domain cards |
| Access Level badges (MANAGE/FULL/OPERATE/VIEW/NONE) | Replaced by action bucket ✓/✗ |
| Per-capability checklist (35 items) | Consolidated into bucket descriptions |
| Raw API bindings (collapsible) | Technical detail, not useful for target users |
| Sidebar: Access Coverage stats | Simplified to Quick Info |
| Sidebar: Permission Groups list | Internal concept, hidden |
| Sidebar: Access Level Legend | Access Levels removed |
| "Show domains without access" toggle | Domains without access are hidden |

## Backend API Change

### `GET /admin/iam/roles` — Add members field

Current response per role:
```json
{
  "id": "uuid",
  "code": "CISO",
  "name": "Chief Information Security Officer",
  "description": "...",
  "status": "ACTIVE",
  "permissions": [{ "code": "api.get.users", "method": "GET", "path": "/users", "name": "...", "description": "..." }]
}
```

New response adds `members`:
```json
{
  "...existing fields",
  "members": [
    { "id": "uuid", "userNo": "ADM2605061195", "email": "john@acme.com", "status": "ACTIVE" }
  ]
}
```

**Implementation:** In `AccessControlService.listRoles()`, add `include` on `userRoles → user` (filtered by `deletedAt: null`). Map to `{ id, userNo, email, status }` only — no sensitive fields.

## Frontend Changes

### File: `admin-web/src/pages/RoleDetailPage.tsx`

**Update `PERM_CODE_TO_GROUP`:**
- Add missing credential reset mappings:
  - `'api.post.admin_iam_users_id_reset_mfa': 'IAM_CREDENTIAL_RESET'`
  - `'api.post.users_id_reset_password': 'IAM_CREDENTIAL_RESET'`
- Remove stale Change Ticket entries (`GOV_CHANGE_TICKET_*`)
- Remove stale Delete Request entries (`GOV_DELETE_REQUEST_*`)
- Remove stale `AUDIT_MANUAL_WRITE` entry

**Replace:**
- `DOMAIN_CONFIG` array → new structure with `actionBuckets` instead of `capabilities` + `computeLevel`
- `DomainCard` component → new component showing action bucket rows (label + ✓/✗ + description)
- `OverviewBar` component → delete
- `AccessBadge` component → delete
- `ACCESS_STYLE` / `ACCESS_LABEL` / `AccessLevel` type → delete
- Sidebar content → replace with Quick Info + Members

**Add:**
- `ActionBucketRow` component — renders one bucket row (label, status icon, description)
- `MemberListSidebar` section — renders avatar + email + userNo for each member
- Types: `ActionBucket`, updated `DomainConfig`

### New TypeScript Types

```typescript
interface ActionBucket {
  key: string;           // e.g. 'view', 'manage', 'credentials'
  label: string;         // e.g. 'View', 'Manage', 'Credentials'
  groups: string[];      // Permission Group codes
  description: string;   // One-sentence English summary
}

interface DomainConfig {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}
```

### Bucket Resolution Logic

```typescript
// For each domain, for each bucket:
const isBucketHeld = (bucket: ActionBucket, heldGroups: Set<string>): boolean =>
  bucket.groups.some(g => heldGroups.has(g));

// A domain is visible if any of its buckets is held:
const isDomainVisible = (domain: DomainConfig, heldGroups: Set<string>): boolean =>
  domain.buckets.some(b => isBucketHeld(b, heldGroups));
```

## Version Expansion

When a new Version is built (e.g., V2 Customer Management), the only change needed is:
1. Add new entries to `PERM_CODE_TO_GROUP` for the new permission codes
2. Add a new `DomainConfig` entry with its action buckets
3. No structural changes to the page component

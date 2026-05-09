# Action Bucket Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented frontend-only permission group mappings with a single backend-owned Action Bucket Catalog, served via API, consumed by Role Detail page and Create Role modal.

**Architecture:** Define `ACTION_BUCKET_CATALOG` in `rbac.catalog.ts` alongside existing `RBAC_PERMISSION_DEFINITIONS`. Add a `GET /admin/iam/action-buckets` API that returns the domain→bucket catalog plus a `permCodeToGroups` reverse map. Frontend deletes hardcoded `PERM_CODE_TO_GROUP`/`DOMAIN_CONFIG` and fetches from API instead.

**Tech Stack:** NestJS (backend), React (admin frontend), existing `adminFetch` pattern

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/modules/identity/access-control/rbac.catalog.ts` | Permission + bucket catalog definitions | Add `ActionBucket`, `ActionDomain` interfaces, `ACTION_BUCKET_CATALOG` array, `buildPermCodeToGroups()` helper, new route entry |
| `src/modules/identity/access-control/access-control.service.ts` | Business logic | Add `getActionBucketCatalog()` method |
| `src/modules/identity/access-control/access-control.controller.ts` | HTTP routes | Add `GET action-buckets` route |
| `admin-web/src/rbac/permissions.ts` | Frontend permission constants | Add `IAM_ACTION_BUCKETS_READ` |
| `admin-web/src/pages/RoleDetailPage.tsx` | Role detail capability cards | Delete hardcoded maps, fetch from API, render with API data |
| `admin-web/src/pages/RolesPage.tsx` | Create Role modal | Replace raw PermissionGroup checkboxes with bucket-based UI |

---

### Task 1: Add ACTION_BUCKET_CATALOG to rbac.catalog.ts

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Add interfaces and catalog data after `RBAC_PERMISSION_DEFINITIONS`**

Open `src/modules/identity/access-control/rbac.catalog.ts`. After the closing `];` of `RBAC_PERMISSION_DEFINITIONS` (around line 775), add:

```typescript
/* ═══════════════════════════════════════════════════════════════
   Action Bucket Catalog
   User-facing capability abstraction. Each "bucket" represents
   a functional capability users can understand (e.g. "View members & roles")
   mapped to one or more PermissionGroups.
   ═══════════════════════════════════════════════════════════════ */

export interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: PermissionGroup[];
}

export interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}

export const ACTION_BUCKET_CATALOG: ActionDomain[] = [
  // ─── Domain 1: Identity & Access ─────────────────────
  {
    id: 'iam',
    label: 'Identity & Access',
    icon: '🔐',
    buckets: [
      {
        key: 'iam.view',
        label: 'View members & roles',
        description: 'Browse member list, view detail & role bindings, view role catalog',
        groups: ['IAM_READ'],
      },
      {
        key: 'iam.manage_members',
        label: 'Manage members',
        description: 'Invite members, resend invitations, assign/change roles',
        groups: ['IAM_ASSIGN'],
      },
      {
        key: 'iam.manage_credentials',
        label: 'Manage credentials',
        description: 'Reset password, reset MFA',
        groups: ['IAM_CREDENTIAL_RESET'],
      },
      {
        key: 'iam.define_roles',
        label: 'Create role definitions',
        description: 'Propose new role definitions for approval',
        groups: ['IAM_ROLE_DEFINE'],
      },
    ],
  },
  // ─── Domain 2: Approval Center ───────────────────────
  {
    id: 'gov_approvals',
    label: 'Approval Center',
    icon: '🚦',
    buckets: [
      {
        key: 'gov_approvals.view',
        label: 'View approvals',
        description: 'Browse approval list, view approval detail and history',
        groups: ['GOV_APPROVAL_READ'],
      },
      {
        key: 'gov_approvals.submit',
        label: 'Submit approvals',
        description: 'Create and submit approval requests',
        groups: ['GOV_APPROVAL_WRITE'],
      },
      {
        key: 'gov_approval_policies.view',
        label: 'View approval policies',
        description: 'Browse approval policy configurations',
        groups: ['GOV_APPROVAL_POLICY_READ'],
      },
      {
        key: 'gov_approval_policies.manage',
        label: 'Manage approval policies',
        description: 'Submit approval policy change requests',
        groups: ['GOV_APPROVAL_POLICY_WRITE'],
      },
    ],
  },
  // ─── Domain 3: Audit Center ──────────────────────────
  {
    id: 'audit',
    label: 'Audit Center',
    icon: '📁',
    buckets: [
      {
        key: 'audit.view',
        label: 'View audit logs',
        description: 'Browse audit log events, filter, view detail',
        groups: ['AUDIT_READ'],
      },
      {
        key: 'audit.export',
        label: 'Export evidence packages',
        description: 'Create, browse, and download audit evidence packages',
        groups: ['AUDIT_EXPORT_CREATE', 'AUDIT_EXPORT_READ'],
      },
      {
        key: 'audit.manual_entry',
        label: 'Manual audit entries',
        description: 'Create manual audit log entries',
        groups: ['AUDIT_MANUAL_WRITE'],
      },
    ],
  },
  // ─── Placeholder Domains (no buckets yet) ────────────
  { id: 'customer', label: 'Customer Management', icon: '👥', buckets: [] },
  { id: 'compliance', label: 'Compliance', icon: '🛡️', buckets: [] },
  { id: 'trading', label: 'Trading', icon: '📊', buckets: [] },
  { id: 'accounting', label: 'Accounting', icon: '📒', buckets: [] },
  { id: 'treasury', label: 'Treasury', icon: '📦', buckets: [] },
  { id: 'recon', label: 'Reconciliation', icon: '🔍', buckets: [] },
  { id: 'pricing', label: 'Pricing', icon: '💰', buckets: [] },
  { id: 'config', label: 'Configuration', icon: '⚙️', buckets: [] },
  { id: 'gov_registry', label: 'Governance Registries', icon: '🏛️', buckets: [] },
  { id: 'counterparty', label: 'Counterparty', icon: '🤝', buckets: [] },
  { id: 'clearing', label: 'Clearing', icon: '📋', buckets: [] },
];
```

- [ ] **Step 2: Add `buildPermCodeToGroups` helper**

Directly below `ACTION_BUCKET_CATALOG`, add:

```typescript
/**
 * Build a map from permission code → PermissionGroup[].
 * Used by the frontend to derive which groups a role holds
 * from its list of individual permission codes.
 */
export function buildPermCodeToGroups(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const perm of RBAC_PERMISSION_DEFINITIONS) {
    map[perm.code] = [...perm.groups];
  }
  return map;
}
```

- [ ] **Step 3: Add route entry for the new endpoint**

Find the section of `RBAC_PERMISSION_DEFINITIONS` where other `/admin/iam/` routes are defined (near the `role-definitions` routes). Add immediately after the `GET /admin/iam/role-definitions/permission-groups` entry:

```typescript
  route('GET', '/admin/iam/action-buckets', 'List action bucket catalog', ['IAM_READ']),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `rbac.catalog.ts`

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): add ACTION_BUCKET_CATALOG with 3 V1 domains and 11 placeholders"
```

---

### Task 2: Add backend API endpoint

**Files:**
- Modify: `src/modules/identity/access-control/access-control.service.ts`
- Modify: `src/modules/identity/access-control/access-control.controller.ts`

- [ ] **Step 1: Add `getActionBucketCatalog()` to `access-control.service.ts`**

Add this import at the top of `access-control.service.ts` (extend the existing import from `./rbac.catalog`):

```typescript
import {
  ACTIVE_RBAC_ROLE_CODES,
  HARD_MUTEX_ROLE_PAIRS,
  RBAC_PERMISSION_CODE_SET,
  RBAC_PERMISSION_DEFINITIONS,
  SOFT_WARNING_ROLE_GROUPS,
  getPrimaryRoleCode,
  ACTION_BUCKET_CATALOG,
  buildPermCodeToGroups,
} from './rbac.catalog';
```

Add this method to the `AccessControlService` class, after `listPermissionGroups()`:

```typescript
  getActionBucketCatalog() {
    return {
      domains: ACTION_BUCKET_CATALOG,
      permCodeToGroups: buildPermCodeToGroups(),
    };
  }
```

- [ ] **Step 2: Add route to `access-control.controller.ts`**

Add this route to the controller. Place it before the existing `GET roles` route to ensure path matching priority (more specific paths first):

```typescript
  @Get('action-buckets')
  getActionBucketCatalog() {
    return this.accessControlService.getActionBucketCatalog();
  }
```

No `@Req()` or actor context needed — this is a pure catalog read.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Smoke test the endpoint**

Start the server if not running: `cd Exchange_js && npm run dev:start`

```bash
# Login to get token
TOKEN=$(curl -s http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"admin123"}' | jq -r '.accessToken')

# Call the new endpoint
curl -s http://localhost:3500/admin/iam/action-buckets \
  -H "Authorization: Bearer $TOKEN" | jq '.domains | length'
```

Expected: `14` (3 domains with buckets + 11 placeholders)

```bash
# Verify permCodeToGroups is populated
curl -s http://localhost:3500/admin/iam/action-buckets \
  -H "Authorization: Bearer $TOKEN" | jq '.permCodeToGroups | keys | length'
```

Expected: a number matching the count of RBAC_PERMISSION_DEFINITIONS entries (~150+)

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/access-control.service.ts \
        src/modules/identity/access-control/access-control.controller.ts
git commit -m "feat(iam): add GET /admin/iam/action-buckets API endpoint"
```

---

### Task 3: Add frontend permission constant

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Add the permission constant**

In `admin-web/src/rbac/permissions.ts`, find the `IAM_ROLE_DEFINITIONS_PERMISSION_GROUPS` line and add after it:

```typescript
  IAM_ACTION_BUCKETS_READ: 'api.get.admin_iam_action_buckets',
```

Note: `buildPermissionCode('GET', '/admin/iam/action-buckets')` produces `api.get.admin_iam_action_buckets` (hyphens → underscores).

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/rbac/permissions.ts
git commit -m "feat(admin-web): add IAM_ACTION_BUCKETS_READ permission constant"
```

---

### Task 4: Refactor RoleDetailPage to use API

**Files:**
- Modify: `admin-web/src/pages/RoleDetailPage.tsx`

This task replaces the hardcoded `PERM_CODE_TO_GROUP` (lines 64-87) and `DOMAIN_CONFIG` (lines 91-141) with data fetched from the action-buckets API.

- [ ] **Step 1: Delete hardcoded maps and add API types**

Remove the entire `PERM_CODE_TO_GROUP` constant (lines 64-87) and the entire `DOMAIN_CONFIG` constant (lines 91-141). Also remove the local `ActionBucket` and `DomainConfig` interfaces (lines 41-53) since we'll redefine them from the API shape.

Replace them with:

```typescript
/* ── API types (from GET /admin/iam/action-buckets) ───────── */

interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: string[];
}

interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}

interface ActionBucketCatalogResponse {
  domains: ActionDomain[];
  permCodeToGroups: Record<string, string[]>;
}
```

- [ ] **Step 2: Add catalog fetch state and useEffect**

In the `RoleDetailPage` component, after the existing `detail`/`loading`/`error` state declarations, add:

```typescript
  const [catalog, setCatalog] = useState<ActionBucketCatalogResponse | null>(null);
```

After the existing `fetchDetail` useEffect, add:

```typescript
  useEffect(() => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/action-buckets`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as ActionBucketCatalogResponse;
        setCatalog(data);
      })
      .catch(() => {});
  }, []);
```

- [ ] **Step 3: Update `heldGroups` derivation**

Replace the existing `heldGroups` useMemo with:

```typescript
  const heldGroups = useMemo(() => {
    const s = new Set<string>();
    if (!catalog) return s;
    for (const p of detail?.permissions ?? []) {
      const groups = catalog.permCodeToGroups[p.code];
      if (groups) {
        for (const g of groups) s.add(g);
      }
    }
    return s;
  }, [detail, catalog]);
```

- [ ] **Step 4: Update `visibleDomains` derivation**

Replace the existing `visibleDomains` useMemo with:

```typescript
  const visibleDomains = useMemo(
    () => (catalog?.domains ?? []).filter((d) =>
      d.buckets.length > 0 &&
      d.buckets.some((b) => b.groups.some((g) => heldGroups.has(g)))
    ),
    [catalog, heldGroups],
  );
```

Note the added `d.buckets.length > 0` check — placeholder domains with empty buckets are never shown.

- [ ] **Step 5: Update the sidebar "Domains" count**

Find the `SidebarKV` for "Domains" (around line 440). Change:

```typescript
            <SidebarKV
              label="Domains"
              value={`${visibleDomains.length} / ${DOMAIN_CONFIG.length}`}
              mono
            />
```

to:

```typescript
            <SidebarKV
              label="Domains"
              value={`${visibleDomains.length} / ${(catalog?.domains ?? []).filter(d => d.buckets.length > 0).length}`}
              mono
            />
```

- [ ] **Step 6: Verify the page renders in the preview**

Open the admin preview at `http://localhost:3501`, navigate to Role Management → click any role (e.g., CISO). Verify:
- Domain cards render (Identity & Access, Audit Center at minimum for CISO)
- Bucket rows show ✓/✗ correctly
- No console errors

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/pages/RoleDetailPage.tsx
git commit -m "refactor(admin-web): RoleDetailPage uses action-buckets API instead of hardcoded maps"
```

---

### Task 5: Refactor Create Role modal to use bucket-based UI

**Files:**
- Modify: `admin-web/src/pages/RolesPage.tsx`

This task replaces the raw PermissionGroup checkbox list with domain→bucket checkboxes from the action-buckets API.

- [ ] **Step 1: Replace `PermissionGroup` interface and state with catalog types**

At the top of `RolesPage.tsx`, remove the `PermissionGroup` interface:

```typescript
// DELETE THIS:
interface PermissionGroup {
  code: string;
  permissionCount: number;
}
```

Add the API types (same as RoleDetailPage):

```typescript
interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: string[];
}

interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}
```

- [ ] **Step 2: Replace state variables**

Replace:

```typescript
  const [createGroups, setCreateGroups] = useState<string[]>([]);
  // ...
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
```

with:

```typescript
  const [selectedBucketKeys, setSelectedBucketKeys] = useState<Set<string>>(new Set());
  const [actionDomains, setActionDomains] = useState<ActionDomain[]>([]);
```

- [ ] **Step 3: Replace the permission groups fetch useEffect**

Replace the existing `useEffect` that fetches `/admin/iam/role-definitions/permission-groups` with:

```typescript
  useEffect(() => {
    if (!showCreateModal) return;
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/action-buckets`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { domains: ActionDomain[] };
        setActionDomains((data.domains ?? []).filter((d) => d.buckets.length > 0));
      })
      .catch(() => {});
  }, [showCreateModal]);
```

- [ ] **Step 4: Update `submitCreate` to derive groups from selected buckets**

In the `submitCreate` function, replace the validation line:

```typescript
    if (!code || !name || createGroups.length === 0 || !reason) {
```

with:

```typescript
    if (!code || !name || selectedBucketKeys.size === 0 || !reason) {
```

Replace the body JSON to derive `permissionGroupCodes` from selected buckets:

```typescript
          body: JSON.stringify({
            roleCode: code,
            roleName: name,
            description: createDescription.trim() || undefined,
            permissionGroupCodes: Array.from(new Set(
              actionDomains
                .flatMap((d) => d.buckets)
                .filter((b) => selectedBucketKeys.has(b.key))
                .flatMap((b) => b.groups),
            )),
            changeReason: reason,
          }),
```

- [ ] **Step 5: Update the reset after successful submit**

Replace:

```typescript
      setCreateGroups([]);
```

with:

```typescript
      setSelectedBucketKeys(new Set());
```

- [ ] **Step 6: Replace the checkbox UI in the modal**

Find the `<div>` that renders the permission group checkboxes (the one with `max-h-48 overflow-y-auto`). Replace the entire block:

```typescript
              <div>
                <label className="mb-1 block text-xs font-medium text-adm-t2">Permission Groups</label>
                <div className="max-h-48 overflow-y-auto rounded border border-adm-border bg-adm-bg p-2">
                  {permissionGroups.length === 0 && (
                    <p className="px-1 py-0.5 font-mono text-[10px] text-adm-t3">Loading groups…</p>
                  )}
                  {permissionGroups.map((g) => (
                    <label key={g.code} className="flex items-center gap-2 px-1 py-0.5 text-xs text-adm-t1">
                      <input
                        type="checkbox"
                        checked={createGroups.includes(g.code)}
                        onChange={(e) => {
                          setCreateGroups((prev) =>
                            e.target.checked ? [...prev, g.code] : prev.filter((c) => c !== g.code),
                          );
                        }}
                      />
                      <span className="font-mono">{g.code}</span>
                      <span className="text-adm-t3">({g.permissionCount})</span>
                    </label>
                  ))}
                </div>
              </div>
```

with:

```typescript
              <div>
                <label className="mb-1 block text-xs font-medium text-adm-t2">Capabilities</label>
                <div className="max-h-64 overflow-y-auto rounded border border-adm-border bg-adm-bg p-2 space-y-3">
                  {actionDomains.length === 0 && (
                    <p className="px-1 py-0.5 font-mono text-[10px] text-adm-t3">Loading…</p>
                  )}
                  {actionDomains.map((domain) => (
                    <div key={domain.id}>
                      <p className="flex items-center gap-1.5 px-1 py-1 font-mono text-[10px] font-semibold text-adm-t2">
                        <span>{domain.icon}</span>
                        {domain.label}
                      </p>
                      {domain.buckets.map((bucket) => (
                        <label
                          key={bucket.key}
                          className="flex items-center gap-2 px-1 py-0.5 text-xs text-adm-t1"
                          title={bucket.description}
                        >
                          <input
                            type="checkbox"
                            checked={selectedBucketKeys.has(bucket.key)}
                            onChange={(e) => {
                              setSelectedBucketKeys((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(bucket.key);
                                } else {
                                  next.delete(bucket.key);
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="font-mono text-[11px]">{bucket.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
```

- [ ] **Step 7: Update the close/cancel handler to reset bucket state**

Find the `onClick={() => setShowCreateModal(false)}` handler on the Cancel button and the × close button. These already work correctly since they just hide the modal. But we need to also reset the selected buckets when the modal closes. Add a wrapper:

In the state reset block after `setShowCreateModal(false)` in the successful submit path, `setSelectedBucketKeys(new Set())` is already done (Step 5). For the cancel/close paths, the state is preserved until next open which is fine — the useEffect re-fetches domains on open.

No change needed here.

- [ ] **Step 8: Verify the modal in the preview**

Open the admin preview at `http://localhost:3501`, navigate to Role Management, click "+ Create Role". Verify:
- Modal shows domain headers (🔐 Identity & Access, 🚦 Approval Center, 📁 Audit Center)
- Each domain has checkbox rows with bucket labels (not raw group codes)
- Checking buckets and submitting works correctly
- No console errors

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/RolesPage.tsx
git commit -m "refactor(admin-web): Create Role modal uses action bucket UI instead of raw permission groups"
```

---

### Task 6: Final verification and cleanup

**Files:**
- Verify all changes work end-to-end

- [ ] **Step 1: Full E2E test — Create Role flow**

1. Open admin preview → Role Management → "+ Create Role"
2. Fill in: Code = `TEST_BUCKET_ROLE`, Name = `Test Bucket Role`, select "View members & roles" and "View audit logs" buckets, Reason = `Testing bucket UI`
3. Click "Submit for Approval"
4. Verify success alert with approval number
5. Verify new role appears in table with PENDING_APPROVAL status

- [ ] **Step 2: Full E2E test — Role Detail page**

1. Click on CISO role in the table
2. Verify domain cards render from API data (Identity & Access, Approval Center, Audit Center)
3. Verify bucket ✓/✗ are correct for CISO's permissions
4. Click on SUPER_ADMIN role — verify all buckets show ✓

- [ ] **Step 3: Verify no hardcoded DOMAIN_CONFIG remains**

```bash
grep -rn "DOMAIN_CONFIG\|PERM_CODE_TO_GROUP" admin-web/src/
```

Expected: No results (both constants should be deleted)

- [ ] **Step 4: Cleanup the pending test role**

If the test role from Step 1 was created, clean it up via the Approvals page (reject it) so it gets deleted.

- [ ] **Step 5: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final verification of action bucket catalog"
```

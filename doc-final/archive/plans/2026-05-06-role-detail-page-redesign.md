# Role Detail Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign RoleDetailPage to use medium-granularity action buckets, add member list, remove redundant UI elements.

**Architecture:** Backend adds `members` field to `GET /admin/iam/roles`. Frontend replaces capability checklists with action bucket rows per domain, rewrites sidebar to Quick Info + Members.

**Tech Stack:** NestJS + Prisma (backend), React + Tailwind (frontend)

---

### Task 1: Backend — Add members to listRoles API response

**Files:**
- Modify: `src/modules/identity/access-control/access-control.service.ts:87-119`

**Context:** The `listRoles()` method currently queries roles with `rolePermissions → permission` include. We need to also include `userRoles → user` so the response contains members who hold each role. Only return non-deleted users with minimal fields (id, userNo, email, status).

- [ ] **Step 1: Update the Prisma query to include userRoles → user**

In `AccessControlService.listRoles()`, add `userRoles` to the `include` clause:

```typescript
async listRoles() {
  const roles = await (this.prisma as any).role.findMany({
    where: {
      status: 'ACTIVE',
      code: { in: ACTIVE_RBAC_ROLE_CODES },
    },
    orderBy: { code: 'asc' },
    include: {
      rolePermissions: {
        include: {
          permission: true,
        },
      },
      userRoles: {
        include: {
          user: {
            select: {
              id: true,
              userNo: true,
              email: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  return roles.map((role: any) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    status: role.status,
    permissions: (role.rolePermissions || [])
      .map((item: any) => ({
        code: item.permission.code,
        method: item.permission.method,
        path: item.permission.path,
        name: item.permission.name,
        description: item.permission.description,
      }))
      .sort((a: any, b: any) => a.code.localeCompare(b.code)),
    members: (role.userRoles || [])
      .map((ur: any) => ur.user)
      .filter((u: any) => u && u.deletedAt === null)
      .map((u: any) => ({
        id: u.id,
        userNo: u.userNo,
        email: u.email,
        status: u.status,
      })),
  }));
}
```

- [ ] **Step 2: Verify the API response**

Start the stack and call the API:

```bash
npm run dev:start
# Wait for startup, then:
curl -s http://localhost:3500/admin/iam/roles -H "Authorization: Bearer <token>" | jq '.[0] | {code, members}'
```

Expected: Each role object now has a `members` array with `{ id, userNo, email, status }` objects. Only non-deleted users appear.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/access-control/access-control.service.ts
git commit -m "feat(iam): include members in listRoles API response"
```

---

### Task 2: Frontend — Replace data model and PERM_CODE_TO_GROUP

**Files:**
- Modify: `admin-web/src/pages/RoleDetailPage.tsx` (types, constants, and mappings section — lines 1–204)

**Context:** Replace the old `Capability`/`DomainConfig`/`AccessLevel` types and `DOMAIN_CONFIG` array with new `ActionBucket`/`DomainConfig` types. Update `PERM_CODE_TO_GROUP` to add credential reset codes and remove stale entries. This task only changes types and constants — the components are updated in Task 3.

- [ ] **Step 1: Replace types**

Remove these types:
- `AccessLevel`
- `Capability` interface
- Old `DomainConfig` interface (with `capabilities` and `computeLevel`)

Replace with:

```typescript
interface RoleMember {
  id: string;
  userNo: string;
  email: string;
  status: string;
}

interface RoleDetail {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
  members: RoleMember[];
}

interface ActionBucket {
  key: string;
  label: string;
  groups: string[];
  description: string;
}

interface DomainConfig {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}
```

- [ ] **Step 2: Update PERM_CODE_TO_GROUP**

Add credential reset mappings:
```typescript
/* IAM_CREDENTIAL_RESET ────────────────────────────── */
'api.post.admin_iam_users_id_reset_mfa':  'IAM_CREDENTIAL_RESET',
'api.post.users_id_reset_password':       'IAM_CREDENTIAL_RESET',
```

Remove all stale entries:
- All `GOV_CHANGE_TICKET_*` entries (6 entries)
- All `GOV_DELETE_REQUEST_*` entries (6 entries)
- The `AUDIT_MANUAL_WRITE` entry (`api.post.admin_audit_logs`)

- [ ] **Step 3: Replace DOMAIN_CONFIG**

Remove the old `DOMAIN_CONFIG` array (with capabilities, computeLevel) and `ACCESS_STYLE`, `ACCESS_LABEL` constants. Replace with:

```typescript
const DOMAIN_CONFIG: DomainConfig[] = [
  {
    id: 'iam',
    label: 'Identity & Access',
    icon: '🔐',
    buckets: [
      {
        key: 'view',
        label: 'View',
        groups: ['IAM_READ'],
        description: 'Browse member list, view detail & role bindings, view role catalog',
      },
      {
        key: 'manage',
        label: 'Manage',
        groups: ['IAM_ASSIGN'],
        description: 'Invite members, resend invitations, assign/change roles',
      },
      {
        key: 'credentials',
        label: 'Credentials',
        groups: ['IAM_CREDENTIAL_RESET'],
        description: 'Reset password, reset MFA',
      },
    ],
  },
  {
    id: 'gov-approvals',
    label: 'Governance · Approvals',
    icon: '⚖️',
    buckets: [
      {
        key: 'view',
        label: 'View',
        groups: ['GOV_APPROVAL_READ'],
        description: 'Browse approval cases, view step history, view SoD configuration',
      },
      {
        key: 'submit',
        label: 'Submit',
        groups: ['GOV_APPROVAL_WRITE'],
        description: 'Create, submit, and cancel approval requests',
      },
      {
        key: 'decide',
        label: 'Decide',
        groups: ['GOV_APPROVAL_DECIDE'],
        description: 'Approve or reject approval cases',
      },
    ],
  },
  {
    id: 'audit',
    label: 'Audit Center',
    icon: '📁',
    buckets: [
      {
        key: 'view',
        label: 'View',
        groups: ['AUDIT_READ'],
        description: 'Browse audit log events, filter, view detail',
      },
      {
        key: 'export',
        label: 'Export',
        groups: ['AUDIT_EXPORT_CREATE', 'AUDIT_EXPORT_READ'],
        description: 'Create, browse, and download evidence packages',
      },
    ],
  },
];
```

- [ ] **Step 4: Verify TypeScript compiles (frontend only)**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -30
```

Expected: Type errors in the component code (Task 3 will fix those), but no errors in the types/constants section itself. If the component references old types like `AccessLevel` or `Capability`, those errors are expected and will be resolved in Task 3.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/RoleDetailPage.tsx
git commit -m "refactor(admin): replace RoleDetailPage types and domain config with action buckets"
```

---

### Task 3: Frontend — Rewrite page components (DomainCard, sidebar, main layout)

**Files:**
- Modify: `admin-web/src/pages/RoleDetailPage.tsx` (components and main page — lines 205–782)

**Context:** Replace the old `DomainCard`, `OverviewBar`, `AccessBadge` components with a new `DomainCard` that renders action bucket rows. Replace the sidebar with Quick Info + Members. Remove all unused components. Keep `SidebarGroup`, `SidebarKV`, `DetailPageHeader` imports — they are reused.

- [ ] **Step 1: Delete unused components**

Remove these components entirely:
- `AccessBadge` component
- `MethodTag` component
- `OverviewBar` component
- Old `DomainCard` component

Remove these constants:
- `ACCESS_STYLE`
- `ACCESS_LABEL`
- `METHOD_CLS`

- [ ] **Step 2: Write new BucketRow component**

```typescript
const BucketRow = ({
  bucket,
  held,
}: {
  bucket: ActionBucket;
  held: boolean;
}) => (
  <div
    className={[
      'flex items-start gap-3 py-2',
      held ? '' : 'opacity-40',
    ].join(' ')}
  >
    <span className="w-[72px] shrink-0 font-mono text-[9px] font-semibold text-adm-t3 pt-px">
      {bucket.label}
    </span>
    {held ? (
      <Check size={12} className="shrink-0 text-adm-green mt-px" />
    ) : (
      <span className="shrink-0 font-mono text-[12px] leading-none text-adm-red mt-px">✗</span>
    )}
    <span
      className={[
        'font-mono text-[10px] leading-relaxed',
        held ? 'text-adm-t2' : 'text-adm-t3',
      ].join(' ')}
    >
      {bucket.description}
    </span>
  </div>
);
```

- [ ] **Step 3: Write new DomainCard component**

```typescript
const DomainCard = ({
  domain,
  heldGroups,
}: {
  domain: DomainConfig;
  heldGroups: Set<string>;
}) => (
  <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-card">
    {/* Header */}
    <div className="flex items-center gap-2 border-b border-adm-border px-4 py-3">
      <span className="text-sm leading-none">{domain.icon}</span>
      <span className="font-mono text-[11px] font-semibold text-adm-t1">
        {domain.label}
      </span>
    </div>
    {/* Bucket rows */}
    <div className="divide-y divide-adm-border/40 px-4">
      {domain.buckets.map((bucket) => (
        <BucketRow
          key={bucket.key}
          bucket={bucket}
          held={bucket.groups.some((g) => heldGroups.has(g))}
        />
      ))}
    </div>
  </div>
);
```

- [ ] **Step 4: Update derived state in main component**

Replace old `useMemo` hooks. Remove:
- `domainLevels` (Access Level per domain)
- `domainPermsMap` (permissions → domain mapping for raw bindings)
- `showAll` state and `visibleDomains` memo
- `coveredCount` and `wave1GroupsHeld` memos

Replace with:

```typescript
/* ── Derive held permission groups ── */
const heldGroups = useMemo(() => {
  const s = new Set<string>();
  for (const p of detail?.permissions ?? []) {
    const group = PERM_CODE_TO_GROUP[p.code];
    if (group) s.add(group);
  }
  return s;
}, [detail]);

/* ── Visible domains: only those where role has any bucket held ── */
const visibleDomains = useMemo(
  () => DOMAIN_CONFIG.filter((d) =>
    d.buckets.some((b) => b.groups.some((g) => heldGroups.has(g)))
  ),
  [heldGroups],
);
```

- [ ] **Step 5: Rewrite the main area JSX**

Replace sections ② (OverviewBar) and ③ (old domain cards with toggle) with:

```tsx
{/* ② Domain capability cards */}
<section className="flex-1 px-6 py-5">
  <p className="mb-4 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    Capabilities · V1
  </p>
  <div className="flex flex-col gap-3">
    {visibleDomains.length === 0 ? (
      <div className="py-10 text-center font-mono text-[11px] text-adm-t3">
        No permission domains assigned to this role.
      </div>
    ) : (
      visibleDomains.map((domain) => (
        <DomainCard
          key={domain.id}
          domain={domain}
          heldGroups={heldGroups}
        />
      ))
    )}
  </div>
</section>
```

- [ ] **Step 6: Rewrite the sidebar JSX**

Replace all sidebar content (Identity, Access Coverage, Permission Groups, Legend) with:

```tsx
{/* ════ RIGHT SIDEBAR ════ */}
<div className="w-[240px] min-w-[240px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
  {/* Quick Info */}
  <SidebarGroup title="Quick Info">
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">Status</span>
      <AdminBadge value={detail.status} />
    </div>
    <SidebarKV
      label="Domains"
      value={`${visibleDomains.length} / ${DOMAIN_CONFIG.length}`}
      mono
    />
    <SidebarKV
      label="API Routes"
      value={String(detail.permissions?.length ?? 0)}
      mono
    />
  </SidebarGroup>

  {/* Members */}
  <SidebarGroup title={`Members (${detail.members?.length ?? 0})`}>
    {(detail.members ?? []).length === 0 ? (
      <p className="font-mono text-[9px] text-adm-t3">No members hold this role.</p>
    ) : (
      <>
        {(detail.members ?? []).map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-2.5 py-1.5"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-adm-amber/15 font-mono text-[9px] font-semibold text-adm-amber">
              {member.email
                .split('@')[0]
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] text-adm-t2">
                {member.email}
              </p>
              <p className="font-mono text-[8px] text-adm-t3">
                {member.userNo}
              </p>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => navigate('/dashboard/members')}
          className="mt-2 font-mono text-[9px] text-adm-t3 transition-colors hover:text-adm-t2"
        >
          → View all in Members page
        </button>
      </>
    )}
  </SidebarGroup>
</div>
```

- [ ] **Step 7: Clean up unused imports**

Remove imports that are no longer used:
- `ChevronDown`, `ChevronRight` from lucide-react (only `Check`, `RefreshCw` remain)
- Remove `useState` import for `rawOpen` and `showAll` if no longer needed (keep if used elsewhere)

- [ ] **Step 8: Verify the page renders correctly**

```bash
cd admin-web && npm run dev
```

Open `http://localhost:3501`, navigate to a role detail page. Verify:
1. Role banner shows code, name, description, status badge
2. Domain cards show action bucket rows with ✓/✗ indicators
3. Sidebar shows Quick Info (Status, Domains, API Routes) and Members list
4. No OverviewBar, no Access Level badges, no Legend, no raw API bindings
5. Domains without any held buckets are not shown

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/RoleDetailPage.tsx
git commit -m "feat(admin): redesign RoleDetailPage with action bucket granularity and member list"
```

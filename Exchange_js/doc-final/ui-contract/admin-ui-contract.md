# Admin UI Contract

> **Scope**: binding rules for building **list pages** and **detail pages** in `admin-web`.
> **Status**: Admin only. Client-side UI contract is not yet written (will be added when the client redesign lands).
> **Audience**: any agent/engineer building a new admin page or refactoring an existing one.

This contract is a **faithful extract** from four canonical reference pages. Any new admin list/detail page MUST match the anatomy, primitives, tokens, and state-handling described here. Deviations require explicit justification.

---

## 1. Reference pages (the source of truth)

| Surface | List page | Detail page |
|---|---|---|
| Approvals | `admin-web/src/pages/ApprovalsPage.tsx` | `admin-web/src/pages/ApprovalDetailPage.tsx` |
| Admin Users (Platform Members) | `admin-web/src/pages/PlatformMembers.tsx` | `admin-web/src/pages/PlatformMemberDetailPage.tsx` |
| Evidence Packages | `admin-web/src/pages/EvidenceExportsPage.tsx` | `admin-web/src/pages/EvidenceExportDetailPage.tsx` |
| Audit Logs | `admin-web/src/pages/AuditLogsPage.tsx` | `admin-web/src/pages/AuditLogDetailPage.tsx` |

Corresponding routes: `/dashboard/control-gates/approvals`, `/dashboard/members`, `/dashboard/audit/evidence-exports`, `/dashboard/audit/audit-logs`.

When in doubt, open these files and copy the pattern. Line numbers throughout this doc point back to them.

---

## 2. Design tokens

All tokens are CSS variables declared in `admin-web/src/index.css` and mapped to Tailwind classes in `admin-web/tailwind.config.js`. Use the classes — **never hardcode hex values**.

### 2.1 Surfaces (backgrounds and borders)

| Class | Role |
|---|---|
| `bg-adm-bg` | Page/table background (darkest) |
| `bg-adm-panel` | Header bars, filter bars, footers, sidebars |
| `bg-adm-card` | Hero sections, card headers, modal headers |
| `bg-adm-hover` | Row hover state |
| `border-adm-border` | Every divider, every border |
| `border-adm-bhi` | Border hover-intensified (on buttons only) |

### 2.2 Text hierarchy

| Class | Role | Example |
|---|---|---|
| `text-adm-t1` | Primary content (headlines, important values) | `detail.action` headline |
| `text-adm-t2` | Body text, table cells | Most cell content |
| `text-adm-t3` | Labels, meta, muted, empty markers | ALL-CAPS labels, `—` placeholder |

### 2.3 Accents (semantic color)

| Class | Meaning | Used for |
|---|---|---|
| `text-adm-amber` / `bg-adm-amber` | Primary identifier / CTA | Page-dominant IDs, primary buttons, row key links |
| `text-adm-green` / `bg-adm-green/…` | Success / active / positive notice | `SUCCESS` / `ACTIVE` badges, notice banners |
| `text-adm-red` / `bg-adm-red/…` | Failure / danger / error banner | `FAILED` badges, error banners, destructive buttons |
| `text-adm-blue` / `bg-adm-blue/…` | Info / pending / simulation | `PENDING` badges, role chips, simulation buttons |

Rule: **amber is reserved for identity and primary action**. Do not use amber for generic body text, decoration, or non-primary buttons.

### 2.4 Typography

- **Primary font**: JetBrains Mono (`font-mono`). Apply to identifiers, meta, labels, table cells, and nearly everything in an admin page.
- **Sans font**: reserved for large headlines only (e.g. the `detail.action` text in audit-log hero, `AuditLogDetailPage.tsx:263-265`).
- **Size scale** — use these exact sizes, do not invent new ones:
  - `text-[22px]` — detail hero action headline
  - `text-[19px]` — detail hero identifier (the dominant ID)
  - `text-[15px]` — page title in `PageTitleBar`, sidebar feature lines
  - `text-[14px]` / `text-[12px]` — detail subsection values
  - `text-[11px]` — table body, filter inputs, most body text
  - `text-[10px]` — table meta/timestamps, sidebar secondary values, small buttons
  - `text-[9px]` / `text-[8.5px]` — ALL-CAPS section labels, sidebar labels
- **Uppercase labels** always pair with `tracking-[0.12em]` to `tracking-[0.16em]`. See `Cap` primitive below.

### 2.5 Iconography

- All icons from `lucide-react`.
- Icon sizes: **13–14px** inside buttons and headers; **12px** inside table rows and inline actions; **15px** in modal close buttons; **24px** for the full-page loading spinner.
- Loading spinner is always `<RefreshCw className="animate-spin">`.

### 2.6 Spacing scale

- Header/footer vertical padding: `py-2` (list filter bar), `py-2.5` (table rows, banners), `py-3.5` (PageTitleBar), `py-4` (DetailPageHeader, sidebar groups), `py-5` (detail sections).
- Horizontal padding: `px-3` (table cells), `px-4` (sidebar, modal body), `px-5` (list bars, footer, modal header/footer), `px-6` (detail body sections).
- Gaps between filter controls: `gap-2`. Gaps inside button groups: `gap-1.5` or `gap-2`.

---

## 3. Page shell

**Every** list and detail page uses this outer shell:

```tsx
<div className="flex h-full flex-col overflow-hidden">
  {/* header bar (PageTitleBar OR DetailPageHeader) */}
  {/* middle sections (shrink-0 for bars, flex-1 for the scrollable body) */}
  {/* footer bar (shrink-0) */}
</div>
```

Rules:
- Outer is `flex h-full flex-col overflow-hidden` — never omit `overflow-hidden`.
- Scrollable region has `flex-1 overflow-auto` (list table) or `flex-1 overflow-y-auto` (detail main column).
- Header, filter bar, banners, and footer are all `shrink-0`.

See `ApprovalsPage.tsx:152`, `PlatformMembers.tsx:214`, `EvidenceExportsPage.tsx:170`, `AuditLogsPage.tsx:248` for the outer shell; `ApprovalDetailPage.tsx:401`, `PlatformMemberDetailPage.tsx:484`, `EvidenceExportDetailPage.tsx:362`, `AuditLogDetailPage.tsx:218` for the detail shell.

---

## 4. Required primitives

All of these live under `admin-web/src/components/` and must be **imported** rather than copy-pasted.

| Primitive | File | Purpose |
|---|---|---|
| `PageTitleBar` | `components/ui/PageTitleBar.tsx` | List page header |
| `DetailPageHeader` | `components/compliance/DetailPageComponents.tsx` | Detail page sticky header |
| `DetailCard`, `InfoField`, `JsonBlock` | `components/compliance/DetailPageComponents.tsx` | Optional card-style detail layout |
| `AdminBadge` | `components/ui/AdminBadge.tsx` | Status badge (success/failed/rejected/pending/active/deleted/info) |
| `TriggerTag` | `components/ui/AdminBadge.tsx` | Event-type tag for audit trigger taxonomy |
| `Pagination` | `components/common/Pagination.tsx` | List footer pagination |
| `adminButtonClass(variant)` | `components/common/adminButtonStyles.ts` | Every button class |
| `adminIconButtonClass()` | `components/common/adminButtonStyles.ts` | Square icon-only buttons |
| `adminFetch`, `getApiErrorMessage`, `AdminSessionError`, `AdminPermissionError` | `utils/adminFetch.ts` | Data fetching and typed errors |
| `PERMISSIONS` | `rbac/permissions.ts` | Permission constants |
| `useAdminSession()` | `contexts/AdminSessionContext.tsx` | `hasPermission` / `hasAnyPermission` hooks |

### 4.1 Button variants (from `adminButtonStyles.ts`)

13 named variants — **always use one of these, never invent ad-hoc button classes**:

| Variant | When to use |
|---|---|
| `listPrimary` | Amber-filled primary action in list header / filter bar (Search, Create, Export) |
| `listSecondary` | Ghost secondary in list header / filter bar (Reset, cross-links) |
| `rowKeyLink` | Amber mono key link inside a row (e.g. `auditNo`) |
| `rowLink` | Standard amber text link inside a row or banner |
| `rowSecondaryUtility` | Muted small text link inside a row (e.g. `Download` on evidence rows) |
| `detailUtility` | Ghost button in `DetailPageHeader` (Back, Refresh, Retry) |
| `workflowPrimary` | Amber-filled action inside a detail sidebar / workflow (e.g. Download Package) |
| `workflowSecondary` | Ghost action inside a detail sidebar / workflow |
| `workflowNegative` | Destructive action (e.g. Request Deletion) |
| `repair` | Warning / repair action (amber tinted) |
| `simulationAction` | Simulation / dry-run action (blue tinted) |
| `modalCancel` | Cancel button inside a modal footer |
| `modalConfirm` | Primary confirm button inside a modal footer |

`adminIconButtonClass()` returns the square 32×32 icon-button class (used for the Refresh button in `PageTitleBar`).

### 4.2 Shared shell primitives (re-declared inside detail pages)

All four detail pages declare these inline, verbatim. They are effectively part of the contract — **use the same shape** when writing a new detail page, or (preferred) extract them into `DetailPageComponents.tsx` — see §12 for the extraction TODO:

```tsx
// Dim ALL-CAPS section label — AuditLogDetailPage.tsx:72-76
const Cap = ({ children }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

// 2-col (default) / 1-col field grid — AuditLogDetailPage.tsx:79-83
const FieldGrid = ({ children, cols = 2 }) => (
  <div className={['grid gap-x-8 gap-y-4', cols === 1 ? 'grid-cols-1' : 'grid-cols-2'].join(' ')}>
    {children}
  </div>
);

// Labeled field — renders nothing if value absent — AuditLogDetailPage.tsx:86-114
const Field = ({ label, value, mono, amber, full }) => {
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">{label}</p>
      <p className={[
        'break-all leading-relaxed',
        mono ? 'font-mono text-[10px]' : 'text-[11px]',
        amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
      ].join(' ')}>{value}</p>
    </div>
  );
};

// Sidebar group + label-right-aligned KV — AuditLogDetailPage.tsx:118-143
const SidebarGroup = ({ title, children }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);
const SidebarKV = ({ label, value, mono }) => {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span className={['min-w-0 break-all text-right text-adm-t2', mono ? 'font-mono text-[10px]' : 'text-[11px]'].join(' ')}>{value}</span>
    </div>
  );
};
```

---

## 5. List page contract

### 5.1 Anatomy (top to bottom)

```
┌──────────────────────────────────────────────────┐
│ PageTitleBar      title + meta        [actions]  │  shrink-0, bg-adm-panel
├──────────────────────────────────────────────────┤
│ Primary filter bar (keyword, select, …, Search)  │  shrink-0, bg-adm-panel
├──────────────────────────────────────────────────┤
│ Advanced filter bar (collapsible) — optional     │  shrink-0, bg-adm-bg/60
├──────────────────────────────────────────────────┤
│ Notice banner — optional, green                  │  shrink-0
│ Error banner — optional, red                     │  shrink-0
│ Selection bar — optional, amber                  │  shrink-0
├──────────────────────────────────────────────────┤
│                                                  │
│ Table (flex-1 overflow-auto)                     │  flex-1
│                                                  │
├──────────────────────────────────────────────────┤
│ Pagination footer                                │  shrink-0, bg-adm-panel
└──────────────────────────────────────────────────┘
```

### 5.2 Title bar

```tsx
<PageTitleBar
  title="Audit Logs"
  meta={`${total} records · Compliance & Risk`}
>
  <button onClick={...} className={adminButtonClass('listPrimary')}>
    <Icon size={13} /> Primary Action
  </button>
  <button onClick={...} className={adminButtonClass('listSecondary')}>
    Secondary
  </button>
  <button onClick={...} className={adminIconButtonClass()} title="Refresh">
    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
  </button>
</PageTitleBar>
```

Rules:
- `title` is human-readable (title case).
- `meta` format: `` `${total} ${noun}${plural} · ${category}` `` — always includes the total count and a category. Examples from the references:
  - `` `${total} approval${total === 1 ? '' : 's'} · Control Gates Center` `` — `ApprovalsPage.tsx:157`
  - `` `${members.length} members · Identity & Access` `` — `PlatformMembers.tsx:219`
  - `` `${total} package${total === 1 ? '' : 's'} · Audit Center` `` — `EvidenceExportsPage.tsx:175`
  - `` `${total} records · Compliance & Risk` `` — `AuditLogsPage.tsx:252`
- Actions slot order (right to left): icon refresh button rightmost, then secondary(ies), then primary. Primary buttons always use `listPrimary`.
- Refresh is **required** on every list page.

### 5.3 Filter bar

Shared input className (declare as a local `fi` constant at the bottom of the component, above `return`):

```tsx
const fi = 'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
```

This literal string appears identically in all four references (`ApprovalsPage.tsx:132-133`, `PlatformMembers.tsx:208-209`, `EvidenceExportsPage.tsx:162-163`, `AuditLogsPage.tsx:244-245`). Do not modify it.

Primary bar structure (`bg-adm-panel`):

```tsx
<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
  <input className={`${fi} w-40`} placeholder="…" value={…} onChange={…} />
  <select className={`${fi} w-32`} value={…} onChange={…}> … </select>
  <button onClick={runSearch} className={adminButtonClass('listPrimary')}>
    <Search size={13} /> Search
  </button>
  <button onClick={resetFilters} className={adminButtonClass('listSecondary')}>
    Reset
  </button>
  {/* optional: Advanced toggle */}
  <button
    onClick={() => setShowAdvanced(p => !p)}
    className="ml-1 font-mono text-[10px] text-adm-t3 transition-colors hover:text-adm-amber"
  >
    {showAdvanced ? 'Less ▲' : 'Advanced ▾'}
  </button>
</div>
```

Rules:
- Always includes a **Search** button (`listPrimary` with a `Search` icon) and a **Reset** button (`listSecondary`). Reset is `disabled` when no filter is active in references that track `hasFilter`.
- Input widths follow `w-28 | w-32 | w-36 | w-40 | w-44` — pick the smallest that fits the placeholder.
- Keyword inputs either commit on Enter (`onKeyDown={e => e.key === 'Enter' && handleSearch()}` — `ApprovalsPage.tsx:173, 180, 199, 206, 213` applies it to *every* text input; `PlatformMembers.tsx:241` applies it to the keyword only) or on the Search button click. Enter-on-every-input is preferred when filters are homogeneous text/select fields.
- If more than ~5 filters exist **and** the tail filters are rarely used, move the tail behind an `Advanced ▾` toggle. The advanced bar uses a subtler background: `bg-adm-bg/60` instead of `bg-adm-panel`. See `AuditLogsPage.tsx:332-369`. (Note: `ApprovalsPage` has 6 filters but keeps them all visible because they're all commonly used — judge case by case.)

### 5.4 Banners (notice / error / selection)

Always rendered as `shrink-0` rows between the filter bar and the table. Copy the shapes verbatim — see `EvidenceExportsPage.tsx:217-227` for notice+error, `AuditLogsPage.tsx:391-406` for selection.

```tsx
{/* Notice — green */}
{notice && (
  <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green">
    {notice}
  </div>
)}

{/* Error — red */}
{error && (
  <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
    {error}
  </div>
)}

{/* Selection — amber (when multi-select is enabled) */}
{selectedIds.length > 0 && (
  <div className="flex shrink-0 items-center gap-3 border-b border-adm-amber/20 bg-adm-amber/5 px-5 py-2">
    <span className="font-mono text-[11px] text-adm-t2">{selectedIds.length} selected</span>
    <div className="h-3 w-px bg-adm-border" />
    <button onClick={() => setSelectedIds([])} className={adminButtonClass('listSecondary')}>
      <X size={12} /> Deselect
    </button>
  </div>
)}
```

Rules:
- Notices that result from user action (download done, request created) **auto-dismiss after 4s**: pattern at `EvidenceExportsPage.tsx:122-126`. Banner errors do not auto-dismiss.
- Never stack multiple notices. A newer notice replaces the older one.

### 5.5 Table

```tsx
<div className="flex-1 overflow-auto">
  <table className="w-full border-collapse text-sm">
    <thead>
      <tr>
        {columns.map(([label, width]) => (
          <th
            key={label}
            style={{ width: width === 'auto' ? undefined : width }}
            className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {loading && (
        <tr><td colSpan={N} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td></tr>
      )}
      {!loading && items.length === 0 && (
        <tr><td colSpan={N} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No {noun} found.</td></tr>
      )}
      {!loading && items.map(item => (
        <tr
          key={item.id}
          className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
          onClick={() => navigate(`/dashboard/…/${item.id}`)}
        >
          {/* cells */}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

Required cell conventions:
- **Identifiers** (e.g. `auditNo`, `userNo`, `packageNo`) — amber mono, bold: `font-mono text-[11px] font-semibold text-adm-amber`. Always the first data cell unless the row has a leading checkbox.
- **Status** — always rendered via `<AdminBadge value={status} />`. Never roll your own badge.
- **Timestamps** — `font-mono text-[10px] text-adm-t2 whitespace-nowrap` with either `fmt(value)` or `new Date(…).toLocaleString()`. Pick **one** helper per page and use it consistently.
- **Secondary mono values** (trace ID, role code, tx hash fragment) — `font-mono text-[10px] text-adm-t2`.
- **Empty cell** — `<span className="text-adm-t3">—</span>` (em-dash wrapped in muted span). Never `N/A`, `null`, or blank.
- **Action cells** at the far right — `text-right`; stop propagation on the click so the row navigation doesn't also fire: `onClick={e => e.stopPropagation()}`. See `EvidenceExportsPage.tsx:318-332`.
- Column widths are fixed in an array and applied via inline `style={{ width }}`. Widths follow the pattern `['Label', '148px']`, with one final `'auto'` column to absorb slack. See `AuditLogsPage.tsx:426-447`, `EvidenceExportsPage.tsx:234-253`, `PlatformMembers.tsx:286-305`.
- **Row click** navigates to the detail page with `navigate('/dashboard/.../${item.id}')`. The whole row is the target; the cursor is `cursor-pointer`; the hover background is `hover:bg-adm-hover`.
- **Result/status left border** (optional) — if a row has a clear good/bad/neutral state and that state is important enough to scan for, add a 2px left border on the identifier cell: `border-l-2 border-l-adm-green`, `border-l-adm-red`, `border-l-adm-amber`. Example: `AuditLogsPage.tsx:473-512`.
- **Selection checkbox column** — only when the page supports bulk export or bulk action. Width `w-9`, leading `<CheckSquare/>` / `<Square/>` toggle, header has a select-page toggle. See `AuditLogsPage.tsx:412-425, 488-502`.

### 5.6 Pagination footer

```tsx
<div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
  <Pagination
    currentPage={currentPage}
    totalItems={total}
    pageSize={PAGE_SIZE}
    onPageChange={(page) => void fetch(page, filters)}
  />
</div>
```

Rules:
- `PAGE_SIZE = 20` is the default. Deviate only if there's a domain reason.
- Footer is always `shrink-0` on `bg-adm-panel` with a top border.
- If `total <= PAGE_SIZE`, the reference pages either hide the pagination block or show a plain count line — do not render a disabled pagination widget. See `ApprovalsPage.tsx:333-348` and `EvidenceExportsPage.tsx:340-356` for the count-with-conditional-pagination pattern, and `PlatformMembers.tsx:376-380` for a pure count-only footer (client-side filtered list).

### 5.7 List data contract

All list endpoints MUST return:

```ts
interface ListResponse<T> {
  total: number;  // total matching rows (not the page size)
  skip: number;   // echoed back from the request
  take: number;   // echoed back
  items: T[];     // exactly PAGE_SIZE or fewer
}
```

Pagination params are **skip/take**, not `page/pageSize`:

```ts
params.set('skip', String((page - 1) * PAGE_SIZE));
params.set('take', String(PAGE_SIZE));
```

See `ApprovalsPage.tsx:91-127`, `AuditLogsPage.tsx:117-139`, `EvidenceExportsPage.tsx:91-107` for the canonical `buildParams` / fetch pattern.

### 5.8 Permissions

- **Every** destructive or governed action is gated by `useAdminSession().hasPermission` / `hasAnyPermission`, using a constant from `PERMISSIONS` — **never** a string literal. See `EvidenceExportsPage.tsx:77`, `PlatformMembers.tsx:81-82`.
- Actions that the user lacks permission for are **not rendered** (do not render disabled stubs).
- Permission-denied errors from the API are caught as `AdminPermissionError` and surfaced as a sentence inside the page error banner. See `EvidenceExportsPage.tsx:109-113`.

---

## 6. Detail page contract

### 6.1 Anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ DetailPageHeader  ← Back  ↻ Refresh   │title │  [row actions]  │  shrink-0, bg-adm-panel
├────────────────────────────────────────────────────────────────┤
│ Inline notice / error (optional)                                │  shrink-0
├─────────────────────────────────────────┬──────────────────────┤
│                                         │                      │
│ LEFT MAIN (flex-1 overflow-y-auto)      │ RIGHT SIDEBAR        │
│                                         │   w-[272px]           │
│ ① Hero section (bg-adm-card)            │ min-w-[272px]        │
│    Cap label, dominant ID, badge,       │ overflow-y-auto      │
│    secondary meta                       │ border-l             │
│                                         │ bg-adm-panel         │
│ ② … ⑤ Content sections                  │                      │
│    divided by `divide-y`                │ Optional Actions grp │
│                                         │ Sidebar groups…      │
│                                         │                      │
└─────────────────────────────────────────┴──────────────────────┘
```

All four detail pages follow this exact two-column shape. The split is `flex-1` main + `w-[272px] min-w-[272px]` sidebar — see `ApprovalDetailPage.tsx:429-664`, `PlatformMemberDetailPage.tsx:512+`, `EvidenceExportDetailPage.tsx:390-555`, `AuditLogDetailPage.tsx:230-421`.

### 6.2 Header

```tsx
<DetailPageHeader
  title="Audit Log"                           {/* Title is the OBJECT TYPE, not the instance */}
  onBack={() => navigate('/dashboard/audit/audit-logs')}
  onRefresh={() => void fetchDetail()}
  refreshing={loading}
  backLabel="Back to Audit Logs"              {/* or the list page's own name */}
>
  {/* Optional row actions on the right — use workflowPrimary / workflowSecondary / workflowNegative */}
</DetailPageHeader>
```

Rules:
- `title` is the **object-type label** (e.g. "Audit Log", "Evidence Package", "Platform Member") — never the instance identifier. The instance identifier belongs in the hero section below.
- Back button is required. Label it descriptively (`"Back to Audit Logs"` or `"Evidence Packages"`, not just `"Back"`).
- Refresh button is required.
- Header right-side children are workflow-level actions. Row-level actions (Edit, Download individual fields, etc.) belong in the sidebar Actions group instead.

### 6.3 Body layout (two-column)

```tsx
<div className="flex min-h-0 flex-1 overflow-hidden">
  {/* LEFT MAIN */}
  <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
    <section className="bg-adm-card px-6 py-5"> {/* HERO */} </section>
    <section className="px-6 py-5"> {/* SECTION 2 */} </section>
    <section className="px-6 py-5"> {/* SECTION 3 */} </section>
    {/* ... */}
  </div>

  {/* RIGHT SIDEBAR */}
  <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
    {/* SidebarGroup blocks */}
  </div>
</div>
```

Rules:
- Left column uses `divide-y divide-adm-border` — **do not** draw your own section borders.
- Every section is `px-6 py-5` (the hero also uses `bg-adm-card`).
- Right sidebar is **exactly** `w-[272px] min-w-[272px]` with `border-l border-adm-border bg-adm-panel px-4 py-1`.
- Sections that would be empty MUST be hidden entirely, not rendered as empty. Compute a `hasX` boolean and guard the JSX: `{hasWorkflow && <section>…</section>}`. See `AuditLogDetailPage.tsx:205-209, 342-354`.

### 6.4 Hero section (the first left-main section)

The hero is the identity block. It has four consistent ingredients:

1. **`<Cap>` label** — the object-type (e.g. `"Approval"`, `"Member"`, `"Package"`).
2. **Dominant identifier** — `font-mono text-[19px] font-bold leading-snug text-adm-amber`.
3. **Status badge(s)** on their own row, `mt-2.5`. When the entity has a **single** status, render one `<AdminBadge>`. When it has **two closely-related statuses** (e.g. request status + execution status), wrap them in a flex row:
   ```tsx
   <div className="mt-2.5 flex flex-wrap items-center gap-2">
     <AdminBadge value={detail.status} />
     <AdminBadge value={detail.executionStatus} />
   </div>
   ```
   Never exceed two badges in the hero — move anything beyond that into a content section.
4. **Divider + secondary meta** — `border-t border-adm-border pt-4` with a 1–2 line secondary description (e.g. `actionType` + short `id`, `email` + short `id`, `exportMode` + short `id`). The `id` is rendered as `font-mono text-[9px] text-adm-t3 break-all` — a deliberately muted afterthought for deep-linking.

Canonical examples (copy from any of these, they're nearly identical):
- Approval hero (two badges) — `ApprovalDetailPage.tsx:435-448`
- Platform Member hero (single badge) — `PlatformMemberDetailPage.tsx:518-530`
- Evidence Package hero (single badge) — `EvidenceExportDetailPage.tsx:396-408`

**Exception — event-like pages**: the audit-log hero uses a richer shape because audit events carry their identity across multiple dimensions. Its hero has a two-row header (identifier + result badge, then module + timestamp), followed by a sans-serif headline for `action`, an optional `reason` line, and an optional state-transition block with `Before → After` columns. Copy from `AuditLogDetailPage.tsx:239-291` **only** when you're building a similar event-history surface. For everything else, use the 4-ingredient shape above.

### 6.5 Content sections (left main)

Each section has the shape:

```tsx
<section className="px-6 py-5">
  <Cap>Section Title</Cap>
  {/* optional short description */}
  <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">…</p>
  <div className="mt-3">
    <FieldGrid>
      <Field label="Field A" value={detail.a} />
      <Field label="Field B" value={detail.b} mono />
      <Field label="Field C" value={detail.c} mono full />
    </FieldGrid>
  </div>
</section>
```

`Field` hides itself when the value is falsy, so sections naturally adapt. If **every** field in a section would be hidden, guard the whole `<section>` with a `hasX` boolean.

Structured data (filter snapshots, manifests, package bodies, metadata, before/after) goes inside a `<JsonBlock title value />`, wrapped in an outer container with `rounded border border-adm-border bg-adm-bg p-4`. See `EvidenceExportDetailPage.tsx:431-453` for the wrapping pattern and `AuditLogDetailPage.tsx:378-396` for the multi-block responsive grid variant.

Tag/chip rows (subject anchors, role bindings, selected event IDs) use:

```tsx
<div className="flex flex-wrap gap-2">
  {items.map(item => (
    <span key={…} className="inline-flex items-center rounded border border-adm-border bg-adm-card px-2.5 py-1.5 font-mono text-[10px]">
      …
    </span>
  ))}
</div>
```

Blue-tinted chip (role codes): `border-adm-blue/25 bg-adm-blue/10 text-adm-blue` — `PlatformMembers.tsx:349`, `PlatformMemberDetailPage.tsx:560-566`.

**Cross-resource link card** — when a detail page needs to point at a related resource (e.g. an approval's linked evidence package, an audit log linked to its evidence package), render it as a full-width button card rather than a plain text link. The shape is:

```tsx
<button
  onClick={() => navigate(`/dashboard/.../${related.id}`)}
  className="flex items-center justify-between gap-3 rounded border border-adm-border bg-adm-bg px-4 py-2.5 text-left transition-colors hover:border-adm-bhi hover:bg-adm-hover"
>
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
      {/* dim type label, e.g. "Audit Evidence Package" */}
      Related Resource Type
    </span>
    <span className="truncate font-mono text-[11px] font-semibold text-adm-amber">
      {related.identifier}
    </span>
  </div>
  <div className="flex shrink-0 items-center gap-2">
    <AdminBadge value={related.status} />
    <Link2 size={13} className="text-adm-t3" />
  </div>
</button>
```

Rules:
- The card is a `<button>`, not an `<a>` — routing stays inside React Router.
- Left column: dim ALL-CAPS type label above, amber mono identifier below.
- Right column: status badge + `<Link2 size={13} />` affordance icon.
- Multiple cards stack in a `<div className="flex flex-col gap-2">`.
- Only use for resources that **have their own detail page**. Inline fields (e.g. a trace ID) stay as `<Field mono full>`.

Canonical example: `ApprovalDetailPage.tsx:524-578` (two linked evidence packages under `Linked Evidence`).

### 6.6 Right sidebar

The sidebar holds **non-content, non-hero** information: governance metadata, lifecycle timestamps, maker/decider info, exporter/actor technical info, and a dedicated **Actions** group for workflow-level buttons. Canonical example: `ApprovalDetailPage.tsx:595-663` (Actions + Maker + Decision + Governance + Lifecycle groups).

```tsx
<div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
  {/* Optional: Actions group — top of the sidebar */}
  {(canA || canB) && (
    <div className="border-b border-adm-border py-4">
      <Cap>Actions</Cap>
      <div className="mt-2.5 flex flex-col gap-2">
        {canA && <button className={adminButtonClass('workflowPrimary')}>…</button>}
        {canB && <button className={adminButtonClass('workflowNegative')}>…</button>}
      </div>
    </div>
  )}

  <SidebarGroup title="Approval">
    <SidebarKV label="Approval No" value={…} mono />
    {/* For badge-valued rows, render an inline flex row with the label + <AdminBadge> */}
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">Status</span>
      <AdminBadge value={detail.status} />
    </div>
  </SidebarGroup>

  <SidebarGroup title="Lifecycle">
    <SidebarKV label="Created At" value={fmt(detail.createdAt)} mono />
    <SidebarKV label="Updated At" value={fmt(detail.updatedAt)} mono />
  </SidebarGroup>
</div>
```

Rules:
- Every sidebar group ends with `border-b border-adm-border` except the last (`last:border-b-0`).
- `SidebarKV` auto-hides on empty values — use it liberally.
- Action buttons inside the sidebar use `workflow*` variants or `detailUtility`, never `list*`. Specifically:
  - `workflowPrimary` — the happy-path primary action (Approve, Download Package).
  - `workflowNegative` — truly **destructive** actions (Reject, Request Deletion — actions that terminate or delete something).
  - `detailUtility` — benign withdrawals or neutral alternates (Cancel Request, where "cancel" means withdraw your own request, not destroy something). See `ApprovalDetailPage.tsx:619-626` for the Cancel-as-utility pattern.
- When a conditional sidebar group would have **zero** visible `SidebarKV` rows, guard the entire `<SidebarGroup>` with a `hasX` check to avoid rendering an empty group header. See `ApprovalDetailPage.tsx:639` (`(hasDecision || detail.selectedCheckerRole) &&`) for the conditional-group pattern.

### 6.7 Inline notices on detail pages

Detail pages render notices **between** the header and the body. Canonical: `ApprovalDetailPage.tsx:412-426`, `EvidenceExportDetailPage.tsx:373-387`, `PlatformMemberDetailPage.tsx:495-509`. (`AuditLogDetailPage` omits inline notices because it has no mutation actions — a read-only detail page may skip this block entirely.)

```tsx
{(notice || error) && (
  <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
    {notice && (
      <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
        {notice}
      </div>
    )}
    {error && (
      <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
        {error}
      </div>
    )}
  </div>
)}
```

Notice auto-dismisses after 4s (same pattern as list pages).

### 6.8 Loading / error / not-found stubs

Every detail page renders the three early-return stubs before the main shell, in this order:

1. **Loading** — a centered spinner:
   ```tsx
   if (loading) {
     return (
       <div className="flex h-full items-center justify-center gap-3">
         <RefreshCw size={24} className="animate-spin text-adm-amber" />
         <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
       </div>
     );
   }
   ```
2. **Error (no data)** — a minimal header with Back + Retry, then a red banner:
   ```tsx
   if (error && !detail) {
     return (
       <div className="flex h-full flex-col overflow-hidden">
         <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
           <button onClick={goBack} className={adminButtonClass('detailUtility')}>← Back</button>
           <button onClick={fetchDetail} className={adminButtonClass('detailUtility')}><RefreshCw size={13} /> Retry</button>
         </div>
         <div className="px-6 py-6">
           <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">{error}</div>
         </div>
       </div>
     );
   }
   ```
3. **Not found** — same header without Retry, and a muted "…not found." message.

See `ApprovalDetailPage.tsx:309-358`, `PlatformMemberDetailPage.tsx:413-462`, `EvidenceExportDetailPage.tsx:300-349`, `AuditLogDetailPage.tsx:171-203` for the canonical blocks.

### 6.9 Detail data contract

- Each detail endpoint returns the full object plus any nested references needed for the page (e.g. `approvalCase` on evidence packages, `latestInvitation` on members).
- **Nullable fields are the rule**. Every field is potentially null; guard rendering via `Field`/`SidebarKV` (which hide on empty) or an explicit `hasX` boolean.
- **Large JSON fields** (filter snapshots, manifests, package bodies, metadata, before/after data) are typed as `unknown` in TS and rendered via `<JsonBlock>`.

---

## 7. Data fetching & error handling

Every page uses `adminFetch` (never raw `fetch`) and the typed error classes:

```tsx
try {
  const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/...`);
  if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Default error message.'));
  const data = (await res.json()) as ListResponse<T>;
  // ...
} catch (e: unknown) {
  if (e instanceof AdminSessionError) return;             // session handler will redirect
  if (e instanceof AdminPermissionError) {                // permission denied
    setError('Permission denied. You cannot view this resource.');
    return;
  }
  setError(e instanceof Error ? e.message : 'Fallback message.');
} finally {
  setLoading(false);
}
```

Rules:
- **Never** catch `AdminSessionError` visually — return silently; the session layer handles redirect.
- **Always** translate `AdminPermissionError` into a human sentence starting with `"Permission denied."`.
- Use `getApiErrorMessage(res, fallback)` to extract the backend error message from the response body; fall back to the supplied default.
- For races (downloads, invite resends), use a `seqRef` sentinel to drop stale responses — see `EvidenceExportDetailPage.tsx:182, 230-257` and `PlatformMemberDetailPage.tsx:175, 324-362`.

---

## 8. Modals

Detail and list pages attach modals at the end of the returned JSX (before the outer closing `</div>`). The shell is:

```tsx
{isOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
      {/* Header — bg-adm-card */}
      <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
        <div>
          <p className="font-mono text-[11px] font-semibold text-adm-t1">Modal Title</p>
          <p className="mt-1 font-mono text-[9px] text-adm-t3">Short subtitle / context</p>
        </div>
        <button onClick={close} className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1">
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
        {/* fields */}
        {modalError && (
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
            {modalError}
          </div>
        )}
      </div>

      {/* Footer — bg-adm-card, right-aligned actions */}
      <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
        <button onClick={close} className={adminButtonClass('modalCancel')}>Cancel</button>
        <button onClick={submit} disabled={busy} className={adminButtonClass('modalConfirm')}>
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  </div>
)}
```

Rules:
- Backdrop is `bg-black/50` with `z-50`.
- Container widths: `max-w-md` (small — single-purpose prompts), `max-w-lg` (default), `max-w-2xl` (wide forms). Pick the smallest that fits.
- Header subtitle in `text-[9px]` mono, muted.
- Footer always has **Cancel** (`modalCancel`) + primary action. For destructive modals, replace the primary with `workflowNegative` (see `EvidenceExportDetailPage.tsx:612-618`). For multi-outcome modals (Approve / Reject / Cancel on one approval), drive the confirm button's variant from a derived map — see `ApprovalDetailPage.tsx:382-397, 747-758` for the pattern.
- Validate inline above the footer using the red banner shape — do not use `alert()`.

---

## 9. Mandatory helpers

Place these at the top of every page file (after imports, before the component):

```tsx
/** Format an ISO timestamp; returns — for falsy values and raw string on parse failure. */
const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};
```

Identical copy is present in all four list pages (`ApprovalsPage.tsx:58-62`, `PlatformMembers.tsx:48-52`, `EvidenceExportsPage.tsx:61-65`, `AuditLogsPage.tsx:90-95`) and all four detail pages (`ApprovalDetailPage.tsx:82-86`, `PlatformMemberDetailPage.tsx:61-65`, `EvidenceExportDetailPage.tsx:69-73`, `AuditLogDetailPage.tsx:63-67`). Do not replace with a different helper.

Pages with array-valued display fields (e.g. Approval's `checkerRoles`) add a companion helper for arrays:

```tsx
/** Join an array or return — for empty/nullish. */
const joinOrDash = (arr?: string[] | null): string =>
  arr && arr.length > 0 ? arr.join(', ') : '—';
```

See `ApprovalDetailPage.tsx:88-89`. Use this shape when rendering an array via `<Field>`; do not wrap in an inline `.join(', ') || '—'` ternary.

`PAGE_SIZE = 20` constant goes just below `fmt`.

---

## 10. Do / Don't quick reference

### Do

- **Use `PageTitleBar` + `DetailPageHeader`** — don't build your own header.
- **Use `AdminBadge`** for every status-like value. If a status isn't in the STATUS_MAP, add it there, don't render an ad-hoc pill.
- **Use `adminButtonClass()`** for every button. Thirteen variants cover every case.
- **Use `—` (em-dash)** for empty values, wrapped in `text-adm-t3` when inside a table cell.
- **Use `font-mono`** for identifiers, labels, timestamps, and most body text.
- **Use `adminFetch`** and handle `AdminSessionError` + `AdminPermissionError` explicitly.
- **Compute `hasX` booleans** and guard whole sections/groups when empty.
- **Use `divide-y divide-adm-border`** on the detail main column; let the divider do the work.
- **Import `PERMISSIONS`** and gate actions via `hasPermission` / `hasAnyPermission`. Don't render disabled stubs.
- **Keep `PAGE_SIZE = 20`** unless there's a domain reason.

### Don't

- Don't hardcode hex colors. Every color is a token.
- Don't invent new font sizes. Pick from the scale in §2.4.
- Don't use `N/A`, `null`, `-` (hyphen), or a blank cell for empty values.
- Don't roll your own spinner — `<RefreshCw className="animate-spin">`.
- Don't put row-level "Edit" / "Delete" / "Download" as separate columns unless there is no detail page — prefer navigating to the detail and putting actions in its sidebar.
- Don't build ad-hoc badges or chips. Use `AdminBadge`, `TriggerTag`, or the blue-chip tag pattern (§6.5).
- Don't stack multiple notices. Replace.
- Don't swallow `AdminSessionError`. Return silently.
- Don't place workflow actions in the `PageTitleBar` — those go in the detail sidebar's Actions group.
- Don't render an empty detail section. Either it has content or it's hidden.
- Don't modify the shared `fi` filter-input className string.

---

## 11. Checklist for a new admin page

Copy this into your task and tick items off:

**List page**
- [ ] Outer shell `<div className="flex h-full flex-col overflow-hidden">`
- [ ] `<PageTitleBar title meta>` with total count + category in meta
- [ ] Refresh icon button in the title bar
- [ ] Filter bar on `bg-adm-panel`, shared `fi` input class, Search + Reset buttons
- [ ] `Advanced ▾` toggle if more than ~5 filters
- [ ] Notice (green) / Error (red) / Selection (amber) banners
- [ ] Table header `text-[9px] uppercase tracking-[0.12em] text-adm-t3` cells
- [ ] Loading and empty `<tr>` rows
- [ ] Row click → detail navigation with `cursor-pointer hover:bg-adm-hover`
- [ ] Primary identifier in amber mono, status via `AdminBadge`, timestamps via `fmt()`
- [ ] Pagination footer on `bg-adm-panel`
- [ ] `skip/take` pagination, `PAGE_SIZE = 20`
- [ ] All actions gated by `PERMISSIONS.*`
- [ ] `adminFetch` + `AdminSessionError` / `AdminPermissionError` handling

**Detail page**
- [ ] Outer shell `<div className="flex h-full flex-col overflow-hidden">`
- [ ] `<DetailPageHeader title onBack onRefresh>` with object-type title (not instance ID)
- [ ] Inline notice / error block between header and body (if actions exist)
- [ ] Two-column body: `flex-1` main + `w-[272px] min-w-[272px]` sidebar
- [ ] Left main uses `divide-y divide-adm-border overflow-y-auto`
- [ ] Hero section on `bg-adm-card px-6 py-5` with dominant amber identifier + status badge
- [ ] Content sections `px-6 py-5` with `<Cap>` label + `<FieldGrid>` + `<Field>`
- [ ] Empty sections guarded by `hasX` booleans
- [ ] `<JsonBlock>` for structured data fields
- [ ] Right sidebar on `bg-adm-panel border-l` with `<SidebarGroup>` + `<SidebarKV>` rows
- [ ] Optional top `Actions` sidebar group using `workflow*` button variants
- [ ] Loading, error-no-data, and not-found stubs at the top of the component
- [ ] `adminFetch` + `AdminSessionError` / `AdminPermissionError` handling
- [ ] Modals (if any) follow the shell in §8

---

## 12. Open questions (for future revisions)

These are intentionally **not** specified yet because the reference pages don't agree or the pattern hasn't stabilized. Revisit when a fourth example lands.

1. **Shared primitives extraction.** `Cap`, `FieldGrid`, `Field`, `SidebarGroup`, `SidebarKV` are currently copy-pasted verbatim across all four detail pages (`ApprovalDetailPage.tsx:93-174`, `PlatformMemberDetailPage.tsx:69-150`, `EvidenceExportDetailPage.tsx:77-158`, `AuditLogDetailPage.tsx:72-143`). They should be promoted into `components/compliance/DetailPageComponents.tsx` the next time a new detail page needs them. Until then, copy them verbatim.
2. **Responsive breakpoints.** Admin is desktop-first; no mobile breakpoints in any reference. If/when mobile admin becomes a requirement, add a responsive section here.
3. **Keyboard shortcuts.** No page currently handles `Esc`/`Enter` in a consistent way; `PlatformMembers` has `Enter → applied` on the keyword input but the other two don't. Not a required pattern yet.
4. **Inline editing.** All mutation in the reference pages goes through modals + change-request workflows. If a page ever introduces true inline editing, spec it here first.

# Frontend: Admin UI Rules
Last Updated: 2026-06-17 | Scope: Wave 1–4 | Source: docs/constraints/frontend-admin-ui-constraints.md, frontend-platform-constraints.md

---

## API Client Rules

- ALL HTTP calls MUST use `adminFetch` — never raw `fetch`, `axios`, or any per-page token read.
- `adminFetch` MUST centralize: token attachment, 401/403 handling, stable error parsing, default headers.
- API host MUST come from `import.meta.env.VITE_API_URL` — no hardcoded hosts.
- `AdminSessionError` thrown by `adminFetch` MUST be caught and silently returned; session redirect is handled globally.

---

## Auth & Session Rules

- Auth checks MUST live at route-guard or app-shell level — UI hiding alone is NOT a permission boundary.
- Admin session helpers MUST NOT be shared with or reused by `client-web`.
- Forbidden/disabled states are different: `disabled` = visible but not actionable; `forbidden` = explain or hide.

---

## Component Rules

- Pages MUST use shared primitives: `DetailPageHeader`, `DetailCard`, `InfoField`, `JsonBlock`, `ActionSection`, `Pagination`.
- MUST NOT introduce page-local duplicates of any shared primitive without a documented reason.
- Sidebars MUST use `SidebarGroup` / `SidebarKV` — do not duplicate these as page-local components.
- `SidebarKV` renders nothing when value is null/empty — MUST NOT render `—` placeholder rows.
- Design tokens MUST use `adm-*` system on all admin pages — no raw Tailwind colors (`gray-*`, `blue-*`, etc.).

| Token | Role |
|---|---|
| `adm-panel` | Page background, table headers, sidebar bg |
| `adm-card` | Identity section card bg |
| `adm-bg` | Inner panel, expanded rows, code fields |
| `adm-border` | Borders, dividers |
| `adm-hover` | Table row hover |
| `adm-t1/t2/t3` | Primary / secondary / tertiary text |
| `adm-amber` | Active, DR, CRYPTO, SWAP accent |
| `adm-blue` | CR, FIAT, WITHDRAWAL, OUTGOING accent |
| `adm-green` | Enabled, INCOMING, active status |
| `adm-red` | Error states |

---

## Route Registration Rules

- Static route segments MUST be registered **before** dynamic segments in `App.tsx`.
- Route ownership: admin pages stay under admin/dashboard/operator-facing paths; MUST NOT cross-mount client routes.

---

## General Detail Page Layout

Applies to all entity detail pages (approvals, members, assets, customers, wallets, etc.).

### Nav Header Rules

- Nav header MUST contain only: back button (`← backLabel`) and refresh button.
- Nav header MUST NOT show entity type label (`title`) or business key (`subtitle`) — these belong in the Hero section.
- `DetailPageHeader` `title` and `subtitle` props are optional; omit both on entity detail pages.

### Two-Column Structure

```
[STICKY NAV HEADER]    shrink-0, border-b, bg-adm-panel
[INLINE NOTICE STRIP]  shrink-0, conditional (success / error banners only)
[BODY]  flex min-h-0 flex-1 overflow-hidden
  ├── MAIN BODY   flex-1, overflow-y-auto, divide-y divide-adm-border
  └── SIDEBAR     w-[272px] min-w-[272px], border-l, bg-adm-panel
```

- Main body MUST use `divide-y divide-adm-border` to separate sections — no explicit `<hr>`.
- Sidebar MUST be fixed width `w-[272px] min-w-[272px]` — no percentage, no `flex-1`.

### Main Body — Information Gradient

Sections MUST appear in this top-to-bottom order (most important → most technical):

| Position | Category | Answers | Presence |
|---|---|---|---|
| First | **Hero** | Who / what is this entity? | Always, `bg-adm-card` |
| Middle | **Core Context** | What is its current state? | Always |
| Middle | **Process / Timeline** | What happened to it? | Conditional |
| Middle | **Outcome** | What was the final result? | Conditional (when decided/resolved) |
| Last | **Technical Detail** | Internal IDs, JSON snapshots | Conditional |

- Hero MUST always be the first section with `bg-adm-card` background.
- Technical Detail MUST always be the last section.
- Conditional sections render only when the relevant data exists — never render empty sections.
- If Core Context is large, it MAY be split into multiple named sections; each split section MUST answer one distinct semantic question.
- A section MUST NOT be added solely to absorb leftover fields — every section must have a clear purpose.

### Hero Section Rules

```
████ Business Key  (font-mono text-[19px] font-bold adm-amber)
──────────────────────────────
LABEL    value / badge    ← e.g. STATUS / ACTIVE
LABEL    value            ← e.g. EMAIL  / user@example.com
```

- MUST show the primary business key prominently (amber, large mono) — no label required for the key itself.
- MUST NOT render a `<Cap>` entity-type label inside the hero — entity type is conveyed by `backLabel` only.
- Every field below the business key MUST follow `label : value` format. No bare values without labels.
- Status badges, emails, role names — all need a label.
- MUST NOT show UUID or any internal `id` field.

### Sidebar — Fixed Block Order

```
[ACTIONS]           conditional — shown only when ≥1 action is available
[IDENTITY SUMMARY]  always shown
[LIFECYCLE]         always shown
```

**ACTIONS block**
- Buttons MUST appear in this order: `workflowPrimary` → `detailUtility` → `workflowNegative`.
- Action buttons MUST NOT appear anywhere in the main body.

**IDENTITY SUMMARY block**
- MUST contain 3–5 `SidebarKV` rows — no more.
- MUST NOT repeat fields that are already prominent in the Hero section.
- MUST NOT contain multi-line text, arrays, lists, or JSON.
- Fields MUST be "scan-worthy": values an operator can read in under 2 seconds.

**LIFECYCLE block**
- MUST contain timestamps only: `createdAt`, `updatedAt`, and entity-specific activity timestamps.
- All values MUST use `mono` formatting.
- MUST NOT contain action buttons or navigable links.

### Field Ownership Rule

- Sidebar fields MAY also appear in main body — operators should not need to switch panels to cross-reference information.
- Main body fields do not need to appear in sidebar.
- The sidebar is a quick-scan summary; the main body is the authoritative display.

### Per-entity Sidebar Fields

When a new entity detail page is added, its sidebar field selection MUST be recorded here.

| Entity | Identity Summary fields | Lifecycle fields |
|---|---|---|
| **Approval** | `riskLevel`, `checkerRoles`, `createdByUserNo` | `submittedAt`, `timeoutAt`, `updatedAt` |
| **PlatformMember** | primary `role`, MFA status, account `status` badge | `createdAt`, `lastLoginAt`, `mfaEnabledAt` |
| **Role** | account `status` badge, domain count, permission count | (none — entity has no timestamp fields) |
| **AuditLog** | `triggerType`, `entityType`, `actorType` | `retainedUntil`, `archivedAt`, `createdAt`, `updatedAt` |
| **EvidencePackage** | account `status` badge, `exportMode`, `itemCount`, `exportedByNo` | `createdAt`, `updatedAt` |
| **Asset** | `assetNo`, `status` badge, `code`, `type` | `createdAt`, `updatedAt` |
| **CustodianWallet** | `walletNo`, `status` badge, `walletRole`, `roleName`, `asset.code` | `createdAt`, `updatedAt` |
| **WithdrawalAddress** | `addressNo`, `status` badge, `addressType`, `asset.code`, `customerNo` | `createdAt`, `updatedAt` |
| **LedgerAccount** | `codeLabel · assetCode`, `status` badge, `ownerType`, `assetCode`, `tbAccountId` | `createdAt` |
| **DepositTransaction** | `depositNo`, `status` badge, `ownerNo`, `ownerType`, `asset.code` | `createdAt`, `completedAt` |
| **Payin** | `payinNo`, `status` badge, `type`, `asset.code`, linked `depositNo` | `createdAt`, `completedAt` |
| **SwapTransaction** | `swapNo`, `status` badge, `ownerNo`, pair (`fromCode/toCode`), `netToAmount` | `createdAt`, `completedAt` |
| **InternalTransfer** | `internalTxNo`, `pathLabel`, `status` badge, `asset.code` | `createdAt`, `completedAt`, `updatedAt` |
| **SettlementBatch** | `batchNo`, `status` badge, `settlementType` | `createdAt`, `cutoffAt`, `completedAt` |
| **ReconciliationRun** | `runNo`, `status` badge, `layer`, `triggerType` | `startedAt`, `completedAt`, `createdAt` |
| **ReconciliationCase** | `caseNo`, `status` badge, `book` badge (CLIENT/FIRM), `assetCode`, `deltaAmount` | `slaDeadline`, `createdAt`, `updatedAt` |
| **ReconciliationExternalStatement** | `statementNo`, `source`, `currency`, `closingBalance` | `businessDate`, `fetchedAt`, `createdAt` |

---

## Forbidden Patterns

- MUST NOT use raw `fetch` or `axios` — only `adminFetch`.
- MUST NOT hardcode API hosts in page code.
- MUST NOT place raw `id` before operator `No/Code` in any operator-facing column or label.
- MUST NOT place raw JSON / payload blocks above the primary business detail section.
- MUST NOT show a blank loading screen without a back-navigation affordance.
- MUST NOT place simulation controls in the list header utility bar — use an explicitly labeled `Manual Simulation` section.
- MUST NOT classify `Change Ticket` / `Delete Request` actions as simulation or repair controls.
- MUST NOT treat UI hiding as the only auth/permission boundary.
- MUST NOT let each page invent its own table, pagination, or action-zone grammar.
- MUST NOT expand Chinese copy as the default active UI language.
- MUST NOT display UUID or internal `id` in Hero or sidebar — use business keys only (`approvalNo`, `userNo`, etc.).
- MUST NOT add a catch-all section (e.g. "Other Details", "Misc") to absorb leftover fields — every section must have a semantic purpose.
- MUST NOT place action buttons in main body sections — all actions belong in the sidebar Actions block.
- MUST NOT define sidebar Identity Summary with more than 5 fields.
- MUST NOT add a new entity detail page without recording its sidebar field selection in the Per-entity Sidebar Fields table.
- MUST NOT pass `title` or `subtitle` to `DetailPageHeader` on entity detail pages — nav header shows back/refresh buttons only.
- MUST NOT render a `<Cap>` entity-type label inside the Hero section.
- MUST NOT render hero fields (status, email, role, etc.) as bare values — every field below the business key requires a label.

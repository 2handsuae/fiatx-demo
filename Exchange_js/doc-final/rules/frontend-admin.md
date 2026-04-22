# Frontend: Admin UI Rules
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: docs/constraints/frontend-admin-ui-constraints.md, frontend-platform-constraints.md

---

## API Client Rules

- ALL HTTP calls MUST use `adminFetch` — never raw `fetch`, `axios`, or any per-page token read.
- `adminFetch` MUST centralize: token attachment, 401/403 handling, stable error parsing, default headers.
- API host MUST come from `import.meta.env.VITE_API_URL` — no hardcoded hosts.
- `AdminSessionError` thrown by `adminFetch` MUST be caught and silently returned; session redirect is handled globally.
- Config-release pages MUST follow the two-step fetch contract:
  1. `GET /admin/business-config/releases?subjectType=X&status=ACTIVE&take=1` → extract `items[0].releaseNo`
  2. `GET /admin/business-config/releases/:releaseNo` → iterate `items[]`; each item has `{ businessKey, payload }`
- Items MUST be located by `businessKey` match, not array index.

---

## Auth & Session Rules

- Auth checks MUST live at route-guard or app-shell level — UI hiding alone is NOT a permission boundary.
- Admin session helpers MUST NOT be shared with or reused by `client-web`.
- Forbidden/disabled states are different: `disabled` = visible but not actionable; `forbidden` = explain or hide.

---

## Component Rules

- Pages MUST use shared primitives: `DetailPageHeader`, `DetailCard`, `InfoField`, `JsonBlock`, `ActionSection`, `Pagination`.
- `DetailPageHeader` for config-release detail pages MUST be imported from `../components/compliance/DetailPageComponents`.
- MUST NOT introduce page-local duplicates of any shared primitive without a documented reason.
- Config-release sidebar MUST use `SidebarGroup` / `SidebarKV` — do not duplicate these as page-local components.
- `SidebarKV` renders nothing when value is null/empty — MUST NOT render `—` placeholder rows.
- `AdminBadge` MUST display release status in snapshot page headers.
- Design tokens MUST use `adm-*` system on all config-release pages — no raw Tailwind colors (`gray-*`, `blue-*`, etc.).

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
- Config-release snapshot route `history/:releaseNo` MUST appear before `:key` in the router to prevent React Router v6 collision.
- Route ownership: admin pages stay under admin/dashboard/operator-facing paths; MUST NOT cross-mount client routes.

---

## Config-Release Subject Pages (Section 13 Rules)

Each of the 6 subjects (ASSET_CONFIG / COA / ACCT_EVENT / JOURNAL_TEMPLATE / CLEARING_TEMPLATE / PRICING_POLICY) requires three tiers:

| Tier | Route | Rules |
|---|---|---|
| List | `/:subject` | Two-step fetch; show active `releaseNo`; accent strip encodes primary category; rows `cursor-pointer`; chevron column last; Version History button in title bar |
| Detail | `/:subject/:key` | `DetailPageHeader`; two-column layout (main left + `w-[272px]` sidebar); Identity section → Signature Element → additional fields; sidebar groups: Release / subject stats / History link |
| Snapshot | `/:subject/history/:releaseNo` | Parallel fetch (release detail + history list); derive `effectiveUntil` from next newer release; sidebar groups: Release / Timeline / Validation / Governance (Governance only when `changeTicketId` or `approvalCaseId` non-null) |

Signature elements per subject (canonical, do not invent alternatives):

| Subject | Signature |
|---|---|
| ASSET_CONFIG | Asset properties grid (network, contract, precision) |
| COA | T-Account Diagram — DR/CR two-panel, highlighted normal-balance side |
| ACCT_EVENT | State Transition Diagram — `from` pill → SVG arrow → `to` pill |
| JOURNAL_TEMPLATE | DR/CR Double-Entry Ledger — two-column table |
| CLEARING_TEMPLATE | Clearing Flow Pipeline — INCOMING → Pool → FEE + OUTGOING |
| PRICING_POLICY (SWAP) | Pair Grid (Wave 6) |
| PRICING_POLICY (WITHDRAWAL) | Asset Tier Ladder (Wave 7) |

Snapshot accordion rules (subjects with sub-items — JOURNAL_TEMPLATE, CLEARING_TEMPLATE):
- MUST use expandable accordion; header rows expand on click.
- Toggle MUST use `ChevronDown` / `ChevronRight` from `lucide-react`.
- Sub-item rows MUST have color-coded left borders: DR → amber, CR → blue; INCOMING → green, FEE → amber, OUTGOING → blue.
- Footer MUST hint "click row to expand lines".

Payload field access rules:
- COA, ACCT_EVENT: flat fields on `payload` directly.
- JOURNAL_TEMPLATE: `payload.header.*` and `payload.lines[]`.
- CLEARING_TEMPLATE: flat with embedded `payload.lineTemplates[]`.
- PRICING_POLICY: `payload.pairs[]` (SWAP) or `payload.assets[]` (WITHDRAWAL).

---

## Forbidden Patterns

- MUST NOT use raw `fetch` or `axios` — only `adminFetch`.
- MUST NOT hardcode API hosts in page code.
- MUST NOT place raw `id` before operator `No/Code` in any operator-facing column or label.
- MUST NOT place raw JSON / payload blocks above the primary business detail section.
- MUST NOT register `:key` dynamic route before `history/:releaseNo` static route.
- MUST NOT create a separate detail page for sub-items (journal lines, clearing line templates) — embed in header detail.
- MUST NOT use a flat snapshot table for two-level subjects — accordion is mandatory.
- MUST NOT access payload fields by array index or undocumented field names.
- MUST NOT use raw Tailwind color classes on config-release pages.
- MUST NOT show a blank loading screen without a back-navigation affordance.
- MUST NOT place simulation controls in the list header utility bar — use an explicitly labeled `Manual Simulation` section.
- MUST NOT classify `Change Ticket` / `Delete Request` actions as simulation or repair controls.
- MUST NOT treat UI hiding as the only auth/permission boundary.
- MUST NOT let each page invent its own table, pagination, or action-zone grammar.
- MUST NOT expand Chinese copy as the default active UI language.

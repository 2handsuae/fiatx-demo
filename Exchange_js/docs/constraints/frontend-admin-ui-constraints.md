Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-21
Applies To: `Exchange_js/admin-web`
Supersedes: `docs/constraints/frontend-ui-constraints.md`
Depends On: `docs/constraints/frontend-platform-constraints.md`, `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`
Source of Truth Level: constraints

# Frontend Admin UI Constraints

## 1) Purpose
- This document defines the long-term admin UI language for `admin-web`.
- The admin app should feel orderly, efficient, and trustworthy.
- The target aesthetic is `light-first`, restrained, and structure-led.

## 2) Visual Principles
- Admin UI MUST feel like an operator console, not a marketing site.
- Default mood is:
1. calm
2. clear
3. dense but breathable
4. low-decoration
5. motion-light
- Visual hierarchy MUST come from spacing, grouping, typography, and alignment before color or effects.
- Decorative gradients, glow, and glass effects MUST remain minimal in admin surfaces.

## 3) Information Architecture
- Admin pages SHOULD organize information in this order when applicable:
1. header/title area
2. filter/search area
3. primary table or summary area
4. pagination area
5. detail cards
6. action surface
7. audit, raw JSON, or evidence side information
- Business truth MUST stay in the primary zone.
- Technical metadata and raw payloads MUST stay in secondary zones.

## 4) List Page Rules
- List pages MUST prioritize operator scanning speed.
- `No` or canonical operator key SHOULD appear in the first meaningful identification column.
- Filter bar, refresh control, results table, and pagination SHOULD follow one consistent structure.
- Loading rows, empty state rows, and error banners MUST be visually consistent across list pages.
- Primary row action placement MUST remain stable:
1. `View` or `Open` in the operation column
2. row identifier itself MAY also be clickable
- Row identifier links and row actions are different UI roles:
1. clickable identifiers are operator-key links
2. operation-column actions are row actions
- Row actions SHOULD use one stable label by default: `View`.
- Row actions SHOULD be text-only by default; icons are reserved for utility or selection controls, not primary row navigation.
- Clickable identifiers SHOULD use a dedicated `rowKeyLink` treatment and MUST NOT replace the operation-column row action.
- Lists MAY keep at most one `rowSecondaryUtility` when it provides meaningful subordinate inspection value.
- `rowSecondaryUtility` MUST remain text-only, weaker than `View`, and MUST NOT trigger workflow, repair, or simulation behavior.
- Inline read-only drawers or evidence panels MAY use `rowSecondaryUtility` labels such as `Inspect` when the page intentionally has no standalone detail route.
- Lists without a real detail or canonical read-only destination MUST NOT invent a fake `View` action just to match other pages.
- When no detail destination exists, the list MAY keep one legitimate `rowSecondaryUtility` instead of a primary row action.
- Control-heavy operator lists MAY keep embedded row-level workflow controls only when those controls are the page's core purpose. In those exceptions, `View` MUST remain the primary row action and every extra control MUST read as a weaker secondary action.

## 5) Detail Page Rules
- Admin detail pages SHOULD converge on:
1. `Header`
2. `DetailCard`
3. `ActionSection`
4. timeline, event, audit, or `JsonBlock` secondary surfaces
- Primary detail cards MUST show business truth first:
1. operator key
2. lifecycle status
3. related subject keys
4. operator-relevant timestamps
5. linked workflow/action anchors
- Raw JSON, payload snapshots, or technical evidence MUST NOT appear above the primary detail summary.
- `id` MAY appear only in the technical section or low-priority detail fields.

## 6) Create and Edit Page Rules
- Forms MUST be grouped by business meaning rather than raw schema order.
- Required fields MUST be visibly marked.
- Validation errors MUST appear near the field and also in a visible summary zone when helpful.
- Footer actions MUST remain stable:
1. `Cancel` as secondary action
2. primary submit action on the right or strongest visual position
- High-risk context or irreversible consequences MUST be visible before submission.

## 7) High-Risk Action Rules
- These actions MUST live in explicit action surfaces, not hidden ad hoc controls:
1. `approve`
2. `reject`
3. `execute`
4. `close`
5. status changes
6. `export`
7. invitation resend
- Destructive or governance-impacting actions MUST require explicit confirmation.
- In-flight requests MUST disable duplicate submission.
- Action surfaces MUST explain the current guard, blocker, or required role when action is unavailable.

## 7A) Admin Button Taxonomy
- Admin buttons MUST be classified before styling:
1. `List Utility`
2. `List Row Action`
3. `Detail Utility`
4. `Detail Workflow Action`
5. `Detail Repair Action`
6. `Simulation Action`
7. `Modal Confirm`
- `Change Ticket` and `Delete Request` actions are `Detail Workflow Action`; they MUST NOT be treated as mock or simulate controls.
- `Re-run Closeout`, `Re-run Compensation`, and similar retry/re-clear controls are `Detail Repair Action`.
- `SimulationRail` and manual simulation controls are `Simulation Action`; they MUST NOT be restyled as workflow or repair actions.

## 7B) Button Placement Rules
- List page top bars MUST contain only `List Utility`.
- List rows SHOULD default to one persistent `List Row Action`: `View` or `Open`.
- If a list still needs simulation tooling, it MUST move that tooling into an explicitly labeled `Manual Simulation` section instead of the header utility bar.
- Repair actions SHOULD live on detail pages first; they MUST NOT be treated as default row actions.
- Detail page headers SHOULD contain only `Detail Utility`.
- Detail workflow buttons MUST live in explicit `ActionSection` blocks.
- Detail repair buttons MUST live in their own `ActionSection` and stay visually separate from workflow actions.
- `Simulation Action` MUST remain inside `SimulationRail` or an explicitly labeled manual simulation section.

## 7C) Button Style Hierarchy
- `List Utility Primary`: dark solid button, used for the single strongest page-level action in a group.
- `List Utility Secondary`: white outlined button, used for refresh, reset, and secondary navigation.
- `List Row Action`: text-link style, used for `View/Open`.
- `rowKeyLink`: operator-key text link in the first meaningful identity column.
- `rowSecondaryUtility`: weaker text-link utility for the rare second inspection action in a row.
- `Detail Utility`: white outlined utility button for back, refresh, and linked-object navigation.
- `Detail Workflow Primary`: dark solid button for the strongest current business action.
- `Detail Workflow Secondary`: white outlined workflow button for valid but lower-priority actions.
- `Detail Workflow Negative`: light rose warning button for cancel/reject/fail-style actions.
- `Detail Repair`: amber warning button; repair actions MUST NOT use the primary brand treatment.
- `Modal Confirm`: left `Cancel` as secondary, right confirm as strongest action.

## 8) Shared Admin Component Rule
- Admin UI SHOULD converge on the existing shared skeleton direction:
1. `DetailPageHeader`
2. `DetailCard`
3. `InfoField`
4. `JsonBlock`
5. `ActionSection`
6. `Pagination`
- New pages MUST NOT introduce page-local duplicates of these primitives without a documented reason.
- Existing repeated in-page implementations are cleanup debt and SHOULD be retired in follow-up cleanup work.

## 9) Copy and Labeling
- Admin active UI is `English-first`.
- Chinese comments or temporary notes MAY remain as implementation annotations, but MUST NOT expand into default active UI copy.
- Field labels SHOULD prefer canonical business names:
1. `Approval No` over raw internal ids
2. `Target No` over raw database references
3. `Trace ID` only where it provides operator value

## 10) Current Runtime Debt That This Document Freezes
- Current runtime already shows the correct direction for shared admin detail skeletons, but repeated implementations remain across pages.
- Current runtime already has `adminFetch` as the correct request-helper direction.
- Follow-up cleanup SHOULD:
1. elevate `adminFetch` usage from common practice to full runtime convergence
2. retire repeated page-local detail primitives
3. keep `No-first` operator display consistent across every admin page

## 11) Forbidden Patterns
- MUST NOT turn admin pages into decorative showcase layouts.
- MUST NOT place raw ids before business identifiers on operator-facing pages.
- MUST NOT place raw payload blocks above primary business detail.
- MUST NOT let each page invent a different table, pagination, or action-zone grammar.
- MUST NOT re-expand Chinese active copy as the default admin UI language.

## 12) Change Protocol
- Any durable change to admin UI rules MUST include:
1. impacted page type
2. impacted operator workflow
3. component convergence or divergence note
4. cleanup note when it intentionally leaves old page-local patterns behind

## 13) Config-Release Subject UI Pattern

### 13.1 Overview

Business-config release subjects (ASSET_CONFIG / COA / ACCT_EVENT / JOURNAL_TEMPLATE / CLEARING_TEMPLATE / PRICING_POLICY) share a **three-tier page architecture**. Every subject MUST implement all three tiers before the subject is considered UI-complete for its wave.

| Tier | Route Pattern | Purpose |
|---|---|---|
| List | `/…/:subject` | Operator scanning; shows active release items |
| Detail | `/…/:subject/:key` | Single-item drill-down with signature visualization |
| Snapshot | `/…/:subject/history/:releaseNo` | Point-in-time version content viewer |

History (version list) is a supporting fourth page but does not constitute a tier in the content architecture.

### 13.2 List Page Rules (Config-Release)

- MUST fetch via two-step API: `GET releases?subjectType=X&status=ACTIVE&take=1` → `GET releases/:releaseNo`.
- MUST display the active `releaseNo` somewhere visible (filter bar trailing or footer).
- Accent strip (left colored `w-0.5` bar per row) MUST encode the primary categorical dimension of that subject (e.g. CRYPTO/FIAT for journal, WITHDRAWAL/INTERNAL_COLLECTION for clearing).
- Rows MUST be `cursor-pointer` with `onClick → /:key` once a detail page exists.
- A chevron column (`›`) MUST appear as the last column when rows are clickable.
- Version History button MUST appear in the title bar and navigate to the history list.
- Filter bar MUST use `h-[30px]` selects with `border-adm-border` / `focus:border-adm-amber` styling.
- Column headers MUST use `font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3`.

### 13.3 Detail Page Rules (Config-Release)

- MUST use `DetailPageHeader` from `../components/compliance/DetailPageComponents` for back navigation, refresh, and subtitle.
- Layout MUST be a two-column split: main content left + sidebar right (`w-[272px] min-w-[272px]`).
- Left main area MUST begin with an **Identity section** showing:
  - Subject key in `font-mono text-[16px] font-bold text-adm-amber`
  - Categorical badges (`AdminBadge` for status; custom badge for type)
  - Accent bar (`h-10 w-1 rounded-full`) color-coded by category
  - Key scalar fields in a compact grid below
- Left main area MUST include a **Signature Element** section immediately after Identity. Each subject has exactly one canonical signature:

  | Subject | Signature Element |
  |---|---|
  | ASSET_CONFIG | Asset properties grid (network, contract address, precision) |
  | COA | T-Account Diagram — two-panel DR/CR with highlighted normal balance side |
  | ACCT_EVENT | State Transition Diagram — `from` pill → SVG arrow → `to` pill (amber highlight) |
  | JOURNAL_TEMPLATE | DR/CR Double-Entry Ledger — two-column table (DEBIT amber \| CREDIT blue) |
  | CLEARING_TEMPLATE | Clearing Flow Pipeline — INCOMING cards → Pool node → FEE + OUTGOING cards |
  | PRICING_POLICY (SWAP) | Pair Grid — currency pair fee matrix (Wave 6) |
  | PRICING_POLICY (WITHDRAWAL) | Asset Tier Ladder — fee tier steps per asset (Wave 7) |

- Left main area MAY include additional detail sections after the signature (full field tables, subordinate item lists).
- Right sidebar MUST use `SidebarGroup` / `SidebarKV` pattern:
  - Groups: Release (releaseNo, effectiveFrom, publishedAt) · subject-specific stats · History link
  - `SidebarKV` renders nothing when value is null/empty — MUST NOT render `—` rows
- `adminFetch` MUST be the only HTTP client used.
- Error state MUST render a back button + red error card, not a blank page.

### 13.4 Snapshot Page Rules (Config-Release)

- Route MUST be `history/:releaseNo` — registered **before** `:key` dynamic segment in `App.tsx` to prevent React Router v6 collision.
- MUST fetch the release detail AND the full history list in parallel (`Promise.all`) to derive `effectiveUntil` by finding the next newer release.
- Layout mirrors Detail: main table left + `w-[272px]` sidebar right.
- Right sidebar MUST contain four groups: **Release** · **Timeline** · **Validation** · **Governance**.
  - Timeline MUST show "Ongoing" (green) for the currently active release; derived `effectiveUntil` for historical ones.
  - Governance group MUST appear only when `changeTicketId` or `approvalCaseId` are non-null.
- For subjects with embedded sub-items (JOURNAL_TEMPLATE lines, CLEARING_TEMPLATE lineTemplates):
  - MUST use an **expandable accordion** pattern: header rows expand on click to reveal the sub-item table inline.
  - Expand/collapse toggle MUST use `ChevronDown` / `ChevronRight` from `lucide-react`.
  - Sub-item rows MUST have color-coded left borders matching sub-item type (DR → amber, CR → blue; INCOMING → green, FEE → amber, OUTGOING → blue).
  - Footer MUST hint "click row to expand lines".
- For flat subjects (COA, ACCT_EVENT), the snapshot table directly renders all items — no accordion needed.
- `AdminBadge` MUST display release status in the header.
- A "View current →" button MUST appear for historical (non-ACTIVE) snapshots.

### 13.5 Data Fetching Contract

```
Step 1:  GET /admin/business-config/releases
           ?subjectType=<SUBJECT>
           &status=ACTIVE
           &take=1
         → extract items[0].releaseNo

Step 2:  GET /admin/business-config/releases/:releaseNo
         → iterate items[]; each item has { businessKey, payload }
```

- Payload field access MUST match the subject's actual structure:
  - COA, ACCT_EVENT: flat fields directly on `payload`
  - JOURNAL_TEMPLATE: nested — `payload.header.*` and `payload.lines[]`
  - CLEARING_TEMPLATE: flat with embedded array — `payload.lineTemplates[]`
  - PRICING_POLICY: flat with typed sub-arrays — `payload.pairs[]` (SWAP) or `payload.assets[]` (WITHDRAWAL)
- Items MUST be found by `businessKey` match, not by array position.
- `AdminSessionError` from `adminFetch` MUST be caught and silently returned (session redirect handled globally).

### 13.6 Design Token Rules (adm-*)

All config-release subject pages MUST use the adm-* token system exclusively. Reference mapping:

| Token | Semantic role |
|---|---|
| `adm-panel` | Page-level background, table headers, sidebar background |
| `adm-card` | Section card background (Identity section) |
| `adm-bg` | Inner panel, expanded rows, code fields |
| `adm-border` | All borders, dividers |
| `adm-hover` | Table row hover state |
| `adm-t1` | Primary text |
| `adm-t2` | Secondary text, field values |
| `adm-t3` | Tertiary text, labels, empty states, metadata |
| `adm-amber` | Active / DR / primary accent; CRYPTO type; SWAP business |
| `adm-blue` | CR / secondary accent; FIAT type; WITHDRAWAL business; OUTGOING lane |
| `adm-green` | Enabled / INCOMING lane / active status / balanced indicator |
| `adm-red` | Error states, error text |

- MUST NOT use Tailwind raw colors (gray-*, blue-*, etc.) on config subject pages.
- Opacity variants (e.g. `adm-amber/10`, `adm-border/50`) MAY be used for backgrounds and borders within signature elements.

### 13.7 Forbidden Patterns

- MUST NOT create a separate detail page for subordinate line items (journal lines, clearing line templates). Lines MUST be embedded in the header detail page.
- MUST NOT use a flat item list for snapshot pages when the subject has two-level data — accordion is mandatory.
- MUST NOT access payload fields by index or by field name without first verifying the subject's actual payload structure.
- MUST NOT register `:key` dynamic route before `history/:releaseNo` static route in App.tsx.
- MUST NOT duplicate `SidebarGroup` / `SidebarKV` as page-local components — import from the existing pattern or co-locate once per file.
- MUST NOT show a blank loading screen without a back-navigation affordance.

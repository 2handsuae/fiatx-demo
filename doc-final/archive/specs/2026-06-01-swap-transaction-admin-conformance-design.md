# Swap Transaction Admin Pages — Conformance Rebuild

**Date:** 2026-06-01
**Scope:** `admin-web/src/pages/SwapTransactionList.tsx`, `admin-web/src/pages/SwapTransactionDetail.tsx`
**Status:** Approved (brainstorming → spec)

---

## Problem

Both Swap Transaction admin pages are artifacts from the pre–Phase-C era and no longer
match either the system's behavior or the admin frontend rules
(`doc-final/rules/frontend-admin.md`).

After Phase C, a swap is **synchronous, eligibility-gated, and always-SUCCESS**:
failures roll back without persisting, so the only persisted status is `SUCCESS`.
Yet the current pages still carry dead Wave-2 compliance vocabulary and the wrong layout:

### List page defects
- Raw Tailwind colors (`bg-white`, `text-gray-900`, `bg-green-100`, …) instead of the
  mandated `adm-*` token system.
- Status filter offers `PENDING_COMPLIANCE` / `UNDER_REVIEW` / `REJECTED` — none of which
  ever persist.
- Subtitle reads "Review swap lifecycle and monitor Risk Execution / Alert / Case progress"
  — dead Wave-2 framing.
- No `Pagination` primitive, although the backend returns `total`.

### Detail page defects
- Old single-column `DetailCard` grid (`max-w-5xl mx-auto`) instead of the mandated
  two-column structure (sticky nav → main body `divide-y` → `w-[272px]` sidebar).
- **Approve / Flag / Reject** buttons `PATCH /admin/swap-transactions/:id/status` — an
  endpoint that **does not exist**. Entirely dead.
- "Risk & Trace" card of always-null `riskDecisionRef` / `alertId` / `caseId`.
- Amber "Compliance Center review path" notice + "Open Alerts" / "Open Case" buttons — dead.
- Passes `title` / `subtitle` to `DetailPageHeader` (rule violation: nav header is
  back/refresh only).
- Surfaces **none** of the data the backend now returns: `spreadAmount`, `netToAmount`,
  `feeAmount`, `feeBreakdown` (quote snapshot with market rate + markup), TB transfer refs.

---

## Architecture

Both pages become **read-only monitors** of completed swaps. No write actions.
No backend changes — the existing endpoints already return the full record:

- `GET /admin/swap-transactions?swapNo&ownerId&ownerType&startDate&endDate&skip&take` →
  `{ items, total }`, each item including `fromAsset`, `toAsset`, `customer` relations.
- `GET /admin/swap-transactions/:id` → full `SwapTransaction` record + relations.

Reference pages (already conforming):
- **List:** `admin-web/src/pages/SwapQuoteList.tsx` — `adm-*` tokens, date filters, and the
  shared `Pagination` primitive (`../components/common/Pagination`, default export, props
  `currentPage` + total-driven `setPage`, `PAGE_SIZE` constant, `skip = (page-1)*PAGE_SIZE`).
- **Detail:** `admin-web/src/pages/DepositTransactionDetail.tsx` — canonical two-column
  layout.

### Available record fields (relevant)
`swapNo`, `ownerType`, `ownerId`, `ownerNo`, `status`, `fromAssetId`, `fromAssetCode`,
`fromAmount`, `toAssetId`, `toAssetCode`, `toAmount` (gross), `netToAmount`, `feeAmount`,
`feeCurrency`, `feeBreakdown` (JSON string), `spreadAmount`, `exchangeRate` (all-in quoted),
`quoteId`, `quoteNo`, `traceId`, `statusHistory` (JSON string), `createdAt`, `updatedAt`,
`completedAt`, `customer { firstName, lastName, customerNo }`,
`fromAsset { currency, code, type, network, decimals }`, `toAsset { … }`.

`feeBreakdown` is a JSON array with one element: `{ policyRef, matched, fx, fees, totals }`
where `fx = { baseRate, quotedRate, markupBps, effectiveBaseRate, … }`.

---

## List Page Design (`SwapTransactionList.tsx`)

- **Tokens:** migrate every raw Tailwind color to the `adm-*` system
  (`adm-panel`, `adm-card`, `adm-bg`, `adm-border`, `adm-hover`, `adm-t1/t2/t3`,
  `adm-amber`, `adm-blue`, `adm-green`, `adm-red`).
- **Header:** title "Swap Transactions"; subtitle "Monitor completed swap conversions"
  (drop Risk/Alert/Case framing). Refresh button only.
- **Filters:** Swap No search · Owner No/Id search · date range (start + end) · Search · Reset.
  **Remove the status dropdown** — `SUCCESS` is the only persisted value, so the filter is dead.
- **Table columns:**
  | Column | Content |
  |---|---|
  | Swap No | mono / `adm-amber`, click → detail |
  | Owner | `customerNo` + name (never UUID; show `ownerType` + short id only when no customer) |
  | Sell (From) | `adm-red`, `formatAssetAmount(fromAmount)` + currency |
  | Buy (Net) | `adm-green`, `formatAssetAmount(netToAmount ?? toAmount)` + currency |
  | Rate | mono, `formatRate8(exchangeRate)` |
  | Spread | platform margin: `formatAssetAmount(spreadAmount)` + toAsset currency (`—` if null) |
  | Status | `AdminBadge` / SUCCESS green pill |
  | Created | `createdAt` localized |
  | Action | View → detail |
- **Pagination:** add the shared `Pagination` primitive (`../components/common/Pagination`)
  driven by `total`, exactly as `SwapQuoteList` does — `page` state, `PAGE_SIZE = 20`,
  `skip = (page-1)*PAGE_SIZE`, `take = PAGE_SIZE`.
- **States:** loading spinner (`adm-amber`), error row, empty row — all `adm-*`.

---

## Detail Page Design (`SwapTransactionDetail.tsx`)

Full two-column rebuild mirroring `DepositTransactionDetail`.

### Nav header
`DetailPageHeader` with `onBack` (→ `/exchange/swap-transactions`), `onRefresh`,
`backLabel="Swaps"`. **No `title`, no `subtitle`.**

### Main body (`flex-1 overflow-y-auto divide-y divide-adm-border`)

1. **Hero** (`bg-adm-card`): `swapNo` (font-mono `text-[19px]` font-bold `adm-amber`).
   Labeled fields below: Status (SUCCESS badge) · Pair (`fromAsset.code` → `toAsset.code`)
   · Net Received (`netToAmount` + currency, bold) · Owner (`customerNo` →
   `/customers/:ownerId`, `adm-blue`).
2. **Compliance** (slim): a single tile — `L1 · Eligibility` heading, value `PASSED`
   (`adm-green`), sublabel "Pre-execution gate". A persisted swap implies the gate passed.
3. **Conversion** (`DetailCard`, columns=2):
   Sell — Asset Code (accent), Asset Type, Amount (highlight).
   Buy — Gross Amount (`toAmount`), Fee (`feeAmount` + `feeCurrency`), Net Amount
   (`netToAmount`, highlight).
4. **Pricing** (`DetailCard`, columns=2): Market Rate (`fx.baseRate`) · Quoted All-in Rate
   (`exchangeRate`) · Spread (bps, `fx.markupBps`) · Spread (amount, `spreadAmount` +
   toAsset currency) · Fee (`feeAmount` + `feeCurrency`) · Gross Out (`toAmount`) ·
   Net Out (`netToAmount`, highlight). Parse `feeBreakdown[0].fx` defensively; if parse
   fails, omit the rate/bps rows and still show record-derived figures (`exchangeRate`,
   `spreadAmount`, fee, gross, net).
5. **Status History** (`DetailCard`, columns=1): `adm-*` `StatusTimeline` over
   `statusHistory`.
6. **Technical Detail** (last): Quote No · Quote ID (mono) · Trace ID (mono) ·
   From Asset ID (mono) · To Asset ID (mono) · raw `feeBreakdown` via `JsonBlock` (compact).
   **No TB transfer IDs.**

### Sidebar (`w-[272px] min-w-[272px]`, `border-l`, `bg-adm-panel`)

- **No Actions block** (read-only — Actions render only when ≥1 action exists).
- **Identity Summary** (5 `SidebarKV`): Swap No (mono) · Status (`AdminBadge`) ·
  Owner (`customerNo` link) · Pair (`fromCode/toCode`) · Net Received.
- **Lifecycle**: Created (`createdAt`, mono) · Completed (`completedAt`, mono; renders
  nothing when null).

### Cleanup (orphans created by this change)
Remove: `handleAction`, reject modal + its state (`isRejectModalOpen`, `rejectReason`,
`isSubmitting`), `availableActions`, `WorkflowAction` type, Risk & Trace card,
Open Alerts/Case buttons, compliance notice strip, and the raw-color status helpers
that are no longer referenced.

---

## Rules Compliance

- Add a `SwapTransaction` row to the **Per-entity Sidebar Fields** table in
  `doc-final/rules/frontend-admin.md`:

  | Entity | Identity Summary fields | Lifecycle fields |
  |---|---|---|
  | **SwapTransaction** | `swapNo`, `status` badge, `ownerNo`, pair (`fromCode/toCode`), `netToAmount` | `createdAt`, `completedAt` |

- Reuse shared primitives only: `DetailPageHeader`, `DetailCard`, `InfoField`, `JsonBlock`
  (`components/compliance/DetailPageComponents`); `SidebarGroup`, `SidebarKV`
  (`components/ui/SidebarPrimitives`); `AdminBadge` (`components/ui/AdminBadge`);
  `Pagination` (shared). Zero page-local duplicates.
- All HTTP via `adminFetch`; `AdminSessionError` caught and silently returned; host from
  `import.meta.env.VITE_API_URL`.
- Never render UUID in Hero or sidebar — business keys only.

---

## Verification

- `npm run build` in `admin-web/` — TypeScript typecheck passes, no unused symbols.
- Manual E2E against the running stack (admin 3501, backend 3500):
  1. List renders with `adm-*` styling; date-range + Swap No + Owner filters work;
     pagination advances; Spread column populated.
  2. Detail shows Hero, L1 Eligibility tile, Conversion, Pricing breakdown with the
     correct spread (market rate > quoted rate; spread amount = `amountIn × marketRate −
     gross`), Status History, Technical Detail.
  3. No Approve/Flag/Reject buttons; no Risk/Alert/Case UI; nav header shows back/refresh
     only.
  4. Browser console clean.

## Out of Scope

- Backend changes (endpoints already return everything needed).
- Other swap admin pages (Quote, Fee Level, Outstanding) — already conform.
- Removing the dead `/status`-style handlers' backend counterparts (none exist for swap).

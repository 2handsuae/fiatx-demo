# Admin Deposit & Payin Pages Full Redesign

> **Scope:** 4 admin pages — Deposit List, Deposit Detail, Payin List, Payin Detail
> **Goal:** Full information architecture redesign aligned with `frontend-admin.md` rules, V4 deposit state machine, and compliance-first operator workflow.

---

## Design Decisions

1. **Compliance-first IA** — Deposit Detail uses a three-card Compliance Gates section as the visual centerpiece (Gate 0: Customer, Gate 1: KYT, Gate 2: Travel Rule), immediately below Hero.
2. **Bidirectional links** — Deposit ↔ Payin cross-link via clickable business keys (depositNo / payinNo).
3. **All actions shown, unavailable disabled** — Deposit Detail sidebar shows all state machine actions; unavailable ones are grayed out.
4. **Payin simulation in sidebar** — Payin Detail sidebar Actions block renders simulation advancement buttons with a distinctive `⚡ SIM` style, only when simulation mode is enabled.
5. **No raw UUIDs** — All entity references use business keys (depositNo, payinNo, customerNo, walletNo).
6. **Existing color conventions preserved** — Status badge colors (purple=COMPLIANCE_PENDING, cyan=FROZEN, etc.), button colors (green-600=primary, red-600=negative, gray-200=secondary).

---

## 1. Deposit Detail

### Nav Header

- Back button: `← Deposits` (navigates to `/exchange/deposit-transactions`)
- Refresh button
- No title or subtitle in nav header (per frontend-admin.md rule)

### Main Body — Information Gradient

| # | Section | Content | Presence |
|---|---------|---------|----------|
| 1 | **Hero** (bg-adm-card) | `depositNo` (font-mono text-[19px] font-bold amber), STATUS badge, AMOUNT + asset code, TYPE (crypto/fiat), OWNER (customerNo clickable) | Always |
| 2 | **Compliance Gates** | Three-card grid: Gate 0 (customer complianceStatus), Gate 1 (kytStatus, kytRiskScore, kytCheckedAt), Gate 2 (travelRuleRequired, travelRuleStatus, travelRuleCheckedAt). Color-coded left borders: green=passed, amber=pending, red=failed, gray=not required. | Always |
| 3 | **Transaction Details** | Asset (code, type, network), amount, netAmount, feeAmount, txHash (copyable), fromAddress, toAddress, toWalletNo, fromWalletNo, referenceNo | Always |
| 4 | **Linked Payin** | Horizontal card: payinNo (clickable → Payin Detail), payin status badge, payin type. Renders only when `payinId` exists. | Conditional |
| 5 | **Status History** | Timeline component: each entry shows status transition, timestamp, actor (operatorId), reason. Newest first. | Always (from statusHistory JSON) |
| 6 | **Technical Detail** | traceId, raw statusHistory JSON block | Always |

### Sidebar (w-[272px])

**Actions block** — shown always; buttons enabled/disabled by current status:

| Action | Style | Enabled when status is |
|--------|-------|----------------------|
| Approve | `bg-green-600 text-white` (workflowPrimary) | COMPLIANCE_PENDING, ACTION_PENDING, FROZEN |
| Freeze | `bg-gray-200 text-gray-700` (workflowSecondary) | COMPLIANCE_PENDING, ACTION_PENDING |
| Resume | `bg-gray-200 text-gray-700` (workflowSecondary) | ACTION_PENDING |
| Expire | `bg-gray-200 text-gray-700` (workflowSecondary) | ACTION_PENDING |
| Reject | `bg-red-600 text-white` (workflowNegative) | COMPLIANCE_PENDING, ACTION_PENDING |
| Confiscate | `bg-red-600 text-white` (workflowNegative) | FROZEN |

Button order (per frontend-admin.md: primary → utility → negative):
Approve → Freeze → Resume → Expire → Reject → Confiscate.
Confiscate requires reason modal (existing behavior preserved).
Reject requires reason modal (same UX as confiscate).
All disabled buttons use `opacity-50 cursor-not-allowed`.

**Identity Summary** (5 fields):
- `depositNo` (mono)
- `status` badge (existing color scheme)
- `Owner` → customerNo, clickable link to customer page
- `Owner Type`
- `Asset` → asset.code

**Lifecycle**:
- `Created` → createdAt (mono)
- `Completed` → completedAt (mono, omit row if null per SidebarKV rule)

### Status Badge Color Map (preserved from existing)

| Status | Background | Text |
|--------|-----------|------|
| PAYIN_PENDING | blue-100 | blue-800 |
| COMPLIANCE_PENDING | purple-100 | purple-800 |
| ACTION_PENDING | amber-100 | amber-800 |
| FROZEN | cyan-100 | cyan-800 |
| SUCCESS | green-100 | green-800 |
| REJECTED | red-100 | red-800 |
| FAILED | orange-100 | orange-800 |
| EXPIRED | gray-100 | gray-800 |
| CONFISCATED | red-200 | red-900 |

### Compliance Gate Color Rules

| Gate State | Left border color | Status text color |
|-----------|------------------|-------------------|
| PASSED / ACTIVE / APPROVED / CLEAR | green (adm-green) | green |
| PENDING / CREATED / RECEIVED | amber (adm-amber) | amber |
| FAILED / REJECTED / SUSPENDED / BLOCKED | red (adm-red) | red |
| NOT_REQUIRED / null / empty | gray (adm-border) | gray |

---

## 2. Deposit List

### Title Bar

- Title: "Deposit Transactions"
- Refresh button

### Filters

| Filter | Type | Notes |
|--------|------|-------|
| Deposit No | text input | Partial match (contains) |
| Owner No | text input | Exact match on customerNo |
| Status | select dropdown | All 9 V4 statuses + "All" |
| Type | select dropdown | Crypto / Fiat / All |
| Start Date | date input | createdAt >= |
| End Date | date input | createdAt <= |

Removed: `assetIdFilter` (unused state in current code), `ownerId` filter (non-business-key), `toWalletId` filter.

### Table Columns

| Column | Alignment | Style |
|--------|-----------|-------|
| Deposit No | left | amber, font-weight-600, clickable |
| Status | left | Badge with status color |
| Amount | right | formatted amount + asset code |
| Type | left | CRYPTO (amber) / FIAT (blue) |
| Owner | left | customerNo, blue, clickable |
| Created | left | date-time, gray, small |
| (chevron) | center | `›` navigation hint |

Row click navigates to Deposit Detail page.

### Pagination

Standard Pagination component: "Showing X-Y of Z" + Prev/1/2/Next buttons.

---

## 3. Payin Detail

### Nav Header

- Back button: `← Payins`
- Refresh button
- No title or subtitle

### Main Body — Information Gradient

| # | Section | Content | Presence |
|---|---------|---------|----------|
| 1 | **Hero** (bg-adm-card) | `payinNo` (amber mono 19px), STATUS badge, AMOUNT, TYPE, ASSET (code + network) | Always |
| 2 | **Chain Details** | txHash (copyable, linkable to explorer), confirmations, fromAddress, toAddress, blockNumber, referenceNo, fromIban, toIban | Always |
| 3 | **Linked Deposit** | Horizontal card: depositNo (clickable → Deposit Detail), deposit status badge. Conditional on deposit existing. | Conditional |
| 4 | **Status History** | Timeline: status transitions with timestamps and event names (MEMPOOL_SEEN, CHAIN_CONFIRMED, etc.) | Always |
| 5 | **Technical Detail** | traceId, providerRef, raw JSON | Always |

### Sidebar (w-[272px])

**Actions block** — conditional, only when simulation mode is enabled:

Simulation advancement buttons use a distinctive style:
- Border: `border-dashed border-amber-400`
- Background: `bg-amber-900/20`
- Label prefix: `⚡` emoji
- Block header: "Simulation Controls" with `⚡ SIM` tag

Buttons vary by payin type and current status:

Crypto flow:
- `⚡ MEMPOOL_SEEN` (DETECTED → CONFIRMING)
- `⚡ CHAIN_CONFIRMED` (CONFIRMING → CONFIRMED)
- `⚡ CLEAR` (CONFIRMED → CLEARED)
- `⚡ FAIL` (any non-terminal → FAILED)

Fiat flow:
- `⚡ BANK_RECEIVED` (DETECTED → CONFIRMED)
- `⚡ CLEAR` (CONFIRMED → CLEARED)
- `⚡ FAIL` (any non-terminal → FAILED)

Each button disabled when not applicable to current status.

**Identity Summary** (5 fields):
- `payinNo` (mono)
- `status` badge
- `Type` (CRYPTO / FIAT)
- `Asset` → asset.code
- `Deposit` → linked depositNo (clickable)

**Lifecycle**:
- `Created` → createdAt (mono)
- `Completed` → completedAt (mono, omit if null)

### Payin Status Badge Color Map

| Status | Background | Text |
|--------|-----------|------|
| DETECTED | blue-100 | blue-800 |
| CONFIRMING | amber-100 | amber-800 |
| CONFIRMED | indigo-100 | indigo-800 |
| CLEARED | green-100 | green-800 |
| FAILED | red-100 | red-800 |

---

## 4. Payin List

### Title Bar

- Title: "Payin Transactions"
- Refresh button

### Filters

| Filter | Type | Notes |
|--------|------|-------|
| Payin No | text input | Partial match |
| Tx Hash | text input | Partial match |
| Status | select dropdown | DETECTED / CONFIRMING / CONFIRMED / CLEARED / FAILED + "All" |
| Type | select dropdown | Crypto / Fiat / All |
| Start Date | date input | createdAt >= |
| End Date | date input | createdAt <= |

### Table Columns

| Column | Alignment | Style |
|--------|-----------|-------|
| Payin No | left | amber, font-weight-600, clickable |
| Status | left | Badge with payin status color |
| Amount | right | formatted amount + asset code |
| Type | left | CRYPTO (amber) / FIAT (blue) |
| Tx Hash | left | truncated (first 6...last 4), mono, gray |
| Deposit | left | linked depositNo, blue, clickable |
| Created | left | date-time, gray, small |
| (chevron) | center | `›` |

Row click navigates to Payin Detail page.

### Bug Fixes

- Fix: refetch must re-trigger when txHash filter changes (add `txHashFilter` to useEffect dependency array).
- Fix: normalize `CLEAR` → `CLEARED` consistently (use `normalizePayinStatus()` from transactionRootDisplay.ts).

---

## 5. Per-entity Sidebar Fields (add to frontend-admin.md)

| Entity | Identity Summary fields | Lifecycle fields |
|--------|------------------------|-----------------|
| **DepositTransaction** | `depositNo`, `status` badge, `ownerNo`, `ownerType`, `asset.code` | `createdAt`, `completedAt` |
| **Payin** | `payinNo`, `status` badge, `type`, `asset.code`, linked `depositNo` | `createdAt`, `completedAt` |

---

## 6. Shared Components & Utilities

### New Components

- **ComplianceGatesPanel** — Three-card grid displaying Gate 0/1/2 with color-coded borders and status. Used only in Deposit Detail.
- **LinkedEntityCard** — Horizontal card with business key link + status badge + dividers. Used for Linked Payin (in Deposit Detail) and Linked Deposit (in Payin Detail).
- **SimulationActionsBlock** — Sidebar block with dashed-border amber simulation buttons. Used only in Payin Detail when simulation mode is on.

### Existing Components Reused

- `DetailPageHeader` — nav header with back + refresh (no title/subtitle)
- `DetailCard` — section container (remove icon usage, use plain section headers)
- `InfoField` — label:value pairs
- `Pagination` — standard pagination
- `StatusTimeline` — timeline component (already exists in Deposit Detail, extract if not shared)
- `SidebarKV` — key-value rows (renders nothing when value is null)
- `GateBadge` — small gate status badge (already exists, reuse in sidebar)

### Utility Functions

- `formatStatusLabel(status)` — existing, unchanged
- `getStatusBadgeColors(status)` — extract from inline mappings to shared utility
- `getComplianceGateStyle(gateValue)` — new: returns border color + text color for gate states
- `getAvailableDepositActions(status)` — new: returns which actions are enabled for a given deposit status
- `getAvailablePayinSimActions(status, type)` — new: returns which simulation actions are available for a given payin status + type

---

## 7. Data Requirements

### Deposit Detail API Response

The existing `GET /deposit-transactions/:id` response already includes all needed fields:
- Core: depositNo, status, amount, netAmount, feeAmount, type, ownerType, ownerNo
- Compliance: kytStatus, kytRiskScore, kytCheckedAt, travelRuleRequired, travelRuleStatus, travelRuleCheckedAt
- Customer: customer.complianceStatus
- Linked: payinNo, payinStatus, payinType
- Addresses: fromAddress, toAddress, fromWalletNo, toWalletNo, txHash
- Timeline: statusHistory JSON
- Asset: asset.code, asset.type, asset.network, asset.decimals

No backend changes needed for Deposit Detail.

### Payin Detail API Response

The existing `GET /payins/:id` response needs verification that it includes:
- payinNo, status, amount, type, asset info
- txHash, fromAddress, toAddress, confirmations, blockNumber
- Linked depositNo and deposit status
- Status history / audit trail

If linked deposit info is missing, the Payin controller will need a small join. This is a backend concern to verify during implementation.

### Payin Simulation Endpoints

Existing simulation endpoints for advancing payin state (already implemented in the payin controller). The sidebar buttons will call these existing endpoints.

---

## 8. Non-Goals

- No changes to backend state machines or business logic.
- No changes to client-web pages (customer-facing).
- No new API endpoints (only potential small joins on existing endpoints).
- No config-release page changes (different UI domain).
- SimulationRail component in Payin Detail is removed from main body; simulation controls move to sidebar.

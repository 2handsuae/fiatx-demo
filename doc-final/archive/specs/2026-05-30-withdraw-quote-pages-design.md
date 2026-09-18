# Withdraw Quote Admin Pages — Design Spec

## Goal

Create dedicated `WithdrawQuoteList.tsx` and `WithdrawQuoteDetail.tsx` admin pages for withdrawal pricing quotes. The existing `SwapQuoteList` / `SwapQuoteDetail` pages remain untouched.

## Background

The current Quote Center (`SwapQuoteList.tsx`) mixes SWAP and WITHDRAWAL quotes in one page using conditional branching. Withdrawal quotes have fundamentally different fields (no rate/pair, has fee level, single asset) which makes the shared layout awkward. The existing detail page (`SwapQuoteDetail.tsx`) uses a single-column layout with raw JSON dumps, violating `frontend-admin.md` rules.

The backend API already supports filtered queries: `GET /admin/pricing/quotes?business=WITHDRAWAL` returns `{ items, total }` with skip/take pagination. Detail endpoint: `GET /admin/pricing/quotes/WITHDRAWAL/:id`.

## Scope

- **Create**: `WithdrawQuoteList.tsx`, `WithdrawQuoteDetail.tsx`
- **Modify**: `App.tsx` (routes), `DashboardLayout.tsx` (nav entry), `permissions.ts` (constants)
- **Do NOT modify**: `SwapQuoteList.tsx`, `SwapQuoteDetail.tsx`

---

## 1. WithdrawQuoteList.tsx

### Filters

| Filter | Type | Backend param |
|--------|------|---------------|
| Status | select: ACTIVE / USED / EXPIRED / CANCELLED | `status` |
| Quote No | text input | `quoteNo` |
| Owner No | text input | `ownerNo` |
| Start Date | date input | `startDate` |
| End Date | date input | `endDate` |

Buttons: Search, Reset. Reset clears all filters and re-fetches.

### Table Columns

| Column | Source | Format |
|--------|--------|--------|
| Quote No | `quoteNo` | clickable link → detail page |
| Status | `status` | `AdminBadge` with color map |
| Owner No | `ownerNo` | mono, text |
| Asset | `primaryAssetCurrency` | mono |
| Amount | `amount` + `primaryAssetCurrency` | `formatAssetAmount` |
| Fee | `feeTotal` + `feeCurrency` | `formatAssetAmount` |
| Linked Withdraw | `linkedBusinessNo` | mono text (display only — no UUID available for linking) |
| Created | `createdAt` | locale date string |

> **Note:** The backend `PricingQuoteListItem` uses `primaryAssetCurrency` (not `primaryAssetCode`). The existing `SwapQuoteList.tsx` frontend interface has a stale name `primaryAssetCode` — the new page should use the correct backend field name `primaryAssetCurrency`.

### Pagination

Use shared `Pagination` component. Default `pageSize = 20`. API: `skip = (page - 1) * pageSize`, `take = pageSize`. Total from `response.total`.

### API Call

```
GET /admin/pricing/quotes?business=WITHDRAWAL&skip=0&take=20&status=...&quoteNo=...&ownerNo=...&startDate=...&endDate=...
```

Response: `{ items: PricingQuoteListItem[], total: number }`

### Theme

`adm-*` dark tokens. Table uses `bg-adm-bg`, `border-adm-border`, `text-adm-text-primary` etc. Status badge colors via `AdminBadge`.

---

## 2. WithdrawQuoteDetail.tsx

### API

```
GET /admin/pricing/quotes/WITHDRAWAL/:id
```

Response shape (from backend `getAdminPricingQuoteDetail` WITHDRAWAL branch):

```typescript
{
  quoteId: string;
  quoteNo: string;
  business: 'WITHDRAWAL';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  fees: Array<{ code: string; label: string; amount: string; currency: string }>;
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
  withdrawal: {
    assetId: string;
    assetCode: string;
    asset: { code: string; decimals?: number; network?: string };
    amount: string;
    segment: string;
    riskTier: string;
    matchedAssetEntryId: string;
    matchedTierId: string;
    matchedTierName: string;
    linkedWithdrawals: Array<{ withdrawNo: string; status: string; createdAt: string }>;
  };
}
```

### Layout: Two-Column

**Left (main body, flex-1):**

#### Hero Section
- `DetailPageHeader` with title "Withdraw Quote Detail", subtitle = `quoteNo`
- Back button → `/dashboard/pricing/withdraw-quotes`
- Refresh button
- Status badge (amber)

#### Card: Withdrawal Terms
Fields via `InfoField`:
| Label | Value |
|-------|-------|
| Asset Code | `withdrawal.assetCode` (mono) |
| Network | `withdrawal.asset.network` |
| Amount | `withdrawal.amount` + currency (mono) |
| Segment | `withdrawal.segment` |
| Risk Tier | `withdrawal.riskTier` |
| Matched Tier | `withdrawal.matchedTierName` (`withdrawal.matchedTierId`) |

#### Card: Fee Breakdown
Table with columns: Code, Label, Amount, Currency. Rows from `fees` array. Footer row showing total from `totals`.

#### Card: Linked Withdrawals
Table with columns: Withdraw No (mono text, not clickable — API only returns `withdrawNo`, not UUID), Status (badge), Created At. Data from `withdrawal.linkedWithdrawals`.

#### Card: Technical Detail
`JsonBlock` with `policyRef`.

**Right (sidebar, w-[272px]):**

#### SidebarGroup: Identity Summary
- Business → `WITHDRAWAL`
- Owner Type → `ownerType`
- Owner No → `ownerNo`
- Quote No → `quoteNo` (copyable)

#### SidebarGroup: Lifecycle
- Created → `createdAt`
- Expires → `expiresAt`
- Used → `usedAt` or "—"
- Cancelled → `cancelledAt` or "—"

---

## 3. Route Registration (App.tsx)

```typescript
const WithdrawQuoteList = lazy(() => import('./pages/WithdrawQuoteList'));
const WithdrawQuoteDetail = lazy(() => import('./pages/WithdrawQuoteDetail'));

// Routes:
<Route path="pricing/withdraw-quotes" element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])} />
<Route path="pricing/withdraw-quotes/:id" element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])} />
```

## 4. Navigation (DashboardLayout.tsx)

Add under Pricing section, after existing "Quote Center" entry:

```typescript
{
  path: '/dashboard/pricing/withdraw-quotes',
  label: 'Withdraw Quotes',
  permission: PERMISSIONS.WITHDRAW_QUOTES_READ,
}
```

## 5. Permission Constants (permissions.ts)

```typescript
WITHDRAW_QUOTES_READ: 'api.get.admin_pricing_quotes_withdrawal',
WITHDRAW_QUOTES_DETAIL_READ: 'api.get.admin_pricing_quotes_withdrawal_id',
```

---

## Shared Primitives Used

All from `components/compliance/DetailPageComponents.tsx` and `components/common/`:
- `DetailPageHeader` — header with back/refresh
- `DetailCard` — section card
- `InfoField` — label/value field
- `JsonBlock` — formatted JSON display
- `SidebarGroup` / `SidebarKV` — sidebar sections
- `AdminBadge` — status badges
- `Pagination` — pagination control
- `adminButtonClass` / `adminIconButtonClass` — button styles
- `formatAssetAmount` — number formatting

## Status Badge Color Map

| Status | Color |
|--------|-------|
| ACTIVE | green |
| USED | blue |
| EXPIRED | gray |
| CANCELLED | red |

## Files Summary

| Action | Path |
|--------|------|
| Create | `admin-web/src/pages/WithdrawQuoteList.tsx` |
| Create | `admin-web/src/pages/WithdrawQuoteDetail.tsx` |
| Modify | `admin-web/src/App.tsx` |
| Modify | `admin-web/src/components/DashboardLayout.tsx` |
| Modify | `admin-web/src/rbac/permissions.ts` |

# Swap Quote Admin Pages — Rewrite Design

## Overview

Rewrite `SwapQuoteList.tsx` and `SwapQuoteDetail.tsx` from old-style "Quote Center" (mixed SWAP+WITHDRAWAL, generic styling) to dedicated swap-only pages using the admin theme system. Mirror `WithdrawQuoteList.tsx` / `WithdrawQuoteDetail.tsx` exactly in structure and styling, substituting swap-specific fields.

Also rename "Quote Center" nav label to "Swap Quotes" in DashboardLayout.

**Scope:** 3 files modified, 0 files created.

---

## 1. Files to Modify

| File | Change |
|------|--------|
| `admin-web/src/pages/SwapQuoteList.tsx` | Full rewrite — swap-only list with admin theme |
| `admin-web/src/pages/SwapQuoteDetail.tsx` | Full rewrite — swap-only detail with admin theme |
| `admin-web/src/components/DashboardLayout.tsx` | Rename "Quote Center" label to "Swap Quotes" |

---

## 2. SwapQuoteList.tsx — Full Rewrite

### 2.1 API

Same endpoint as Quote Center but hardcoded to SWAP:

```
GET /admin/pricing/quotes?business=SWAP&skip=0&take=20&status=...&quoteNo=...&ownerNo=...&startDate=...&endDate=...
```

Response: `{ items: SwapQuoteListItem[], total: number }`

### 2.2 Interface

```typescript
interface SwapQuoteListItem {
  quoteId: string;
  quoteNo: string | null;
  business: 'SWAP';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  primaryAssetCode: string;     // fromAssetCode
  secondaryAssetCode: string | null;  // toAssetCode
  amountIn: string | null;
  amountOut: string | null;
  rateAllIn: string | null;
  feeTotal: string;
  feeCurrency: string;
  linkedBusinessNo: string | null;  // linked swap transaction no
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
}
```

### 2.3 Filters

Same as WithdrawQuoteList:

```
[Status ▾]  [Quote No]  [Owner No]  [Start Date]  [End Date]  [Search] [Reset]
```

FilterState: `{ status, quoteNo, ownerNo, startDate, endDate }`

### 2.4 Table Columns

| Column | Content |
|--------|---------|
| Quote No | `rowKeyLink`, navigates to detail |
| Status | `AdminBadge` |
| Owner No | Mono text |
| Pair | `primaryAssetCode → secondaryAssetCode` |
| Amount In | `amountIn primaryAssetCode` |
| Amount Out | `amountOut secondaryAssetCode` |
| Rate | `rateAllIn` formatted with `formatRate8` |
| Fee | `feeTotal feeCurrency` |
| Created | Formatted timestamp |

### 2.5 Styling

Mirrors `WithdrawQuoteList.tsx` exactly:
- `PageTitleBar` with title "Swap Quotes" and subtitle
- Filter bar with `adm-*` tokens
- Sticky table header with `bg-adm-card`
- `AdminBadge` for status
- `Pagination` component
- `adminButtonClass` / `adminIconButtonClass`

### 2.6 Row Navigation

Click row → `/dashboard/pricing/quotes/SWAP/${quoteId}`

---

## 3. SwapQuoteDetail.tsx — Full Rewrite

### 3.1 API

```
GET /admin/pricing/quotes/SWAP/:id
```

Response: `PricingQuoteDetailData` with `swap` section populated.

### 3.2 Layout

Two-column layout matching `WithdrawQuoteDetail.tsx`:
- **Left main:** Hero + Swap Terms + Fee Breakdown + Linked Swap + Technical Detail
- **Right sidebar (272px):** Identity Summary + Lifecycle

### 3.3 Swap Terms Card

Replaces "Withdrawal Terms". Fields:

| Field | Value |
|-------|-------|
| Pair | `fromAssetCode → toAssetCode` |
| Side / Amount Type | `side / amountType` |
| Amount In | `amountIn currencyIn` |
| Gross Receive | `amountOutGross currencyOut` (from totals or amountOut) |
| Fee | `feeTotal feeCurrency` |
| Net Receive | `amountOutNet currencyOut` (from totals or amountOut) |
| Rate Display | formatted |
| Rate All-In | formatted |
| Market Rate | formatted |
| Spread | `spreadPercent% (spreadBps bps)` |
| Rate Source | text |
| Fetched At | timestamp |

### 3.4 Fee Breakdown Card

Identical to WithdrawQuoteDetail — table with Code, Label, Amount, Currency + Totals row.

### 3.5 Linked Swap Transaction

Replaces "Linked Withdrawals". Shows linked swap transaction if exists:

| Column | Content |
|--------|---------|
| Swap No | mono text |
| Status | `AdminBadge` |
| Created | timestamp |

### 3.6 Technical Detail Card

Same as withdrawal — `JsonBlock` for policyRef + matched/pricingSource data.

### 3.7 Sidebar

```
Identity Summary:
  Business      SWAP
  Owner Type    {ownerType}
  Owner No      {ownerNo}
  Quote No      {quoteNo}
  Quote Type    {swap.quoteType}

Lifecycle:
  Created       {createdAt}
  Expires       {expiresAt}
  Used          {usedAt}
  Cancelled     {cancelledAt}
```

### 3.8 Styling

Uses the same components as `WithdrawQuoteDetail.tsx`:
- `DetailPageHeader` with back to `/dashboard/pricing/quotes`
- `DetailCard`, `InfoField`, `JsonBlock` from `DetailPageComponents`
- `AdminBadge` for status
- `SidebarGroup`, `SidebarKV` from `SidebarPrimitives`
- `formatAssetAmount`, `formatRate8` from `number-format`
- All `adm-*` theme tokens

---

## 4. Navigation Label Change

In `DashboardLayout.tsx`, change the "Quote Center" nav entry:

```typescript
// Before
{ label: 'Quote Center', ... }

// After
{ label: 'Swap Quotes', ... }
```

Path, icon, and permission remain unchanged.

---

## 5. What Is NOT Changing

- Routes in `App.tsx` — already wired correctly
- Permissions in `permissions.ts` — already defined
- RBAC catalog — already has swap quote routes
- Backend controller / service — no changes needed
- `WithdrawQuoteList.tsx` / `WithdrawQuoteDetail.tsx` — not touched

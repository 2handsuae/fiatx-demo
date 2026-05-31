# SwapFeeLevel Admin Pages Design

## Overview

Admin frontend pages + backend controller for SwapFeeLevel governance. Mirrors the WithdrawalFeeLevel admin pattern with two key differences: currency pair selection (fromAsset + toAsset) and per-tier `rateMarkupBps` field.

**Scope:** Backend controller (1 file), frontend List + Detail pages (2 files), route/nav/permission wiring (3 files modified), TierEditor extension for swap item codes + rateMarkupBps (1 file modified).

---

## 1. Files to Create / Modify

### Create

| File | Purpose |
|------|---------|
| `src/modules/trading/swap-fee-level/swap-fee-level.controller.ts` | Admin REST controller (7 endpoints) |
| `admin-web/src/pages/SwapFeeLevelList.tsx` | List page with filters, table, create modal |
| `admin-web/src/pages/SwapFeeLevelDetail.tsx` | Detail page with tiers, bindings, change/bind modals |

### Modify

| File | Change |
|------|--------|
| `src/modules/trading/swap-fee-level/swap-fee-level.module.ts` | Add controller to `@Module({ controllers: [...] })` |
| `admin-web/src/App.tsx` | Add routes `pricing/swap-fee-levels` and `pricing/swap-fee-levels/:levelCode` |
| `admin-web/src/rbac/permissions.ts` | Add `SWAP_FEE_LEVELS_READ` permission constant |
| `admin-web/src/components/DashboardLayout.tsx` | Add nav menu entry under Pricing section |
| `admin-web/src/components/pricing/TierEditor.tsx` | Make `ITEM_CODES` configurable via prop; add optional `rateMarkupBps` input per tier |

---

## 2. Backend Controller

`swap-fee-level.controller.ts` — mirrors `withdrawal-fee-level.controller.ts` exactly.

**Route prefix:** `admin/swap-fee-levels`

**Guards:** `AuthGuard('jwt')` + `AdminPermissionGuard`

**Endpoints:**

| Method | Path | Description | Differences from Withdrawal |
|--------|------|-------------|-----------------------------|
| `GET /` | List | Query filters: `fromAssetId`, `toAssetId`, `status`, `skip`, `take` | Two asset filters instead of one |
| `GET /:levelCode` | Detail | Same | None |
| `POST /` | Create | Body includes `fromAssetId` + `toAssetId` | Two asset fields instead of one `assetId` |
| `POST /:levelCode/change` | Request change | Same | None |
| `GET /:levelCode/bindings` | List bindings | Same | None |
| `POST /bindings/bind` | Bind customer | Same | None |
| `DELETE /bindings/unbind` | Unbind customer | Same | None |

Helper methods `ensureAdmin()` and `buildAdminActor()` — identical to Withdrawal controller.

---

## 3. Frontend — SwapFeeLevelList.tsx

Mirrors `WithdrawalFeeLevelList.tsx` with these changes:

### 3.1 Interface Changes

```typescript
interface FeeLevelItem {
  // Same as withdrawal, except:
  fromAsset: { id: string; code: string; type: string };  // replaces `asset`
  toAsset: { id: string; code: string; type: string };    // new
  // rest unchanged: id, levelCode, name, isDefault, tiersJson, status, updatedAt
}
```

### 3.2 Filter Bar

Replace single `Asset` dropdown with two dropdowns:

```
[From Asset ▾]  [To Asset ▾]  [Status ▾]  ☐ Default Only  [Search] [Reset] [⟳]
```

Filter state adds `fromAssetId` and `toAssetId` (replaces `assetId`). Both are passed as query params.

### 3.3 Table Columns

| Column | Width | Content |
|--------|-------|---------|
| Level Code | 140 | `rowKeyLink` button, navigates to detail |
| Name | 130 | Plain text |
| **Pair** | 160 | `FromAsset → ToAsset` with typed badges (CRYPTO=blue, FIAT=amber) |
| Default | 60 | ✅ or — |
| Tiers | 50 | Count from parsed tiersJson |
| Status | 120 | `AdminBadge` |
| Updated | 140 | Formatted timestamp |

The Pair column replaces the single Asset column. Badge styling uses the existing pattern from WithdrawalFeeLevelList (blue for CRYPTO, amber for FIAT).

### 3.4 Create Modal

Form fields:

1. **Level Code** — uppercase alphanumeric + hyphen input (same)
2. **Name** — text input (same)
3. **From Asset** — asset dropdown (replaces single Asset)
4. **To Asset** — asset dropdown (new)
5. **Is Default** — checkbox (same)
6. **Fee Tiers** — `TierEditor` with `mode="swap"` (see Section 5)
7. **Reason** — textarea (same)

From/To asset dropdowns render side-by-side in a 2-column grid. The `defaultCurrency` for TierEditor is derived from the selected `toAsset` code (fees are in the received currency).

Submit payload:

```json
{
  "levelCode": "SWP-USDT-AED",
  "name": "Standard USDT to AED",
  "fromAssetId": "uuid",
  "toAssetId": "uuid",
  "isDefault": false,
  "tiersJson": "...",
  "reason": "Initial setup"
}
```

---

## 4. Frontend — SwapFeeLevelDetail.tsx

Mirrors `WithdrawalFeeLevelDetail.tsx` with these changes:

### 4.1 Hero Section

```
Level Code (large amber)    [ACTIVE badge]  [DEFAULT badge if applicable]
Name (subtitle)
Pair: USDT (CRYPTO) → AED (FIAT) · 2 tiers
```

Replaces `Asset: USDT (CRYPTO) · 2 tiers`.

### 4.2 Tier Card — rateMarkupBps Display

Each tier card adds a `Rate Markup` line next to the Amount Range:

```
Amount Range: 0 — ∞     Rate Markup: 200 bps (2.00%)
```

The `rateMarkupBps` value is read from the parsed tier JSON. Display format: `{value} bps ({value/100}%)`. Highlighted with amber background.

### 4.3 Sidebar Identity Section

Replace `Asset` KV with `From Asset` and `To Asset` KVs:

```
From Asset    USDT (CRYPTO)
To Asset      AED (FIAT)
```

### 4.4 Change Modal (Edit Tiers)

Same as withdrawal, but uses `TierEditor` with `mode="swap"` (swap item codes + rateMarkupBps input).

### 4.5 Bind/Unbind

Identical to withdrawal. No changes.

---

## 5. TierEditor Extension

Currently hardcoded with withdrawal item codes and no `rateMarkupBps`. Make it configurable:

### 5.1 New Props

```typescript
interface TierEditorProps {
  tiers: TierState[];
  onChange: (tiers: TierState[]) => void;
  defaultCurrency?: string;
  mode?: 'withdrawal' | 'swap';  // default: 'withdrawal'
}
```

### 5.2 Mode-Driven Behavior

| Aspect | `mode='withdrawal'` (default) | `mode='swap'` |
|--------|------|------|
| Item codes dropdown | `WITHDRAW_SERVICE_FEE`, `NETWORK_FEE_EST` | `SWAP_SERVICE_FEE`, `COMPLIANCE_FEE` |
| rateMarkupBps input | Hidden | Shown per tier (between name row and amount range row) |

### 5.3 TierState Extension

Add optional field to `TierState`:

```typescript
export interface TierState {
  // ... existing fields
  rateMarkupBps?: string;  // new, only used in swap mode
}
```

### 5.4 Serialization/Parsing

`serializeTiers()` — when `rateMarkupBps` is present on a tier, include it in the output JSON.

`parseTiersJson()` — read `rateMarkupBps` from tier if present, default to `''`.

### 5.5 UI Addition (swap mode only)

Between the tier name row and amount range row, render:

```
Rate Markup (bps): [____] input
```

Label style: mono 10px, adm-t3. Input style: same `fi` class, width 80px, type=number.

---

## 6. Routing & Navigation

### 6.1 App.tsx Routes

```tsx
<Route
  path="pricing/swap-fee-levels"
  element={withPermission(<SwapFeeLevelList />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
/>
<Route
  path="pricing/swap-fee-levels/:levelCode"
  element={withPermission(<SwapFeeLevelDetail />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
/>
```

### 6.2 Permission Constant

```typescript
SWAP_FEE_LEVELS_READ: 'api.get.admin_swap_fee_levels',
```

### 6.3 Navigation Menu

Add entry in DashboardLayout Pricing section, after Withdrawal Fee Levels:

```typescript
{
  path: '/dashboard/pricing/swap-fee-levels',
  label: 'Swap Fee Levels',
  requiredPermissions: [PERMISSIONS.SWAP_FEE_LEVELS_READ],
}
```

---

## 7. API Endpoints Summary

All endpoints require JWT + AdminPermissionGuard.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/admin/swap-fee-levels` | `?fromAssetId&toAssetId&status&skip&take` | `{ items: SwapFeeLevel[], total: number }` |
| GET | `/admin/swap-fee-levels/:levelCode` | — | `SwapFeeLevel` (with fromAsset, toAsset relations) |
| POST | `/admin/swap-fee-levels` | `{ levelCode, name, fromAssetId, toAssetId, isDefault, tiersJson, reason }` | `{ approvalNo }` |
| POST | `/admin/swap-fee-levels/:levelCode/change` | `{ proposedTiersJson, changeReason }` | `{ approvalNo }` |
| GET | `/admin/swap-fee-levels/:levelCode/bindings` | — | `BindingItem[]` |
| POST | `/admin/swap-fee-levels/bindings/bind` | `{ customerId, levelId }` | `Binding` |
| DELETE | `/admin/swap-fee-levels/bindings/unbind` | `{ customerId, levelId }` | `void` |

---

## 8. What Is NOT Changing

- `AdminBadge`, `PageTitleBar`, `DetailPageHeader`, `Pagination` — used as-is
- `adminFetch`, `getApiErrorMessage` — used as-is
- `adminButtonClass` styles — used as-is
- Sidebar layout primitives (`Cap`, `SidebarGroup`, `SidebarKV`) — copied inline (same pattern as Withdrawal)
- Existing WithdrawalFeeLevel pages — not touched
- Existing `PricingSwapConfigPage` — not touched (separate legacy page)

# Client Withdrawal Page Fix — Design Spec

> **Scope:** Fix Withdraw.tsx API integration + split backend controller for security
> **Date:** 2026-05-28

---

## Problem Summary

`client-web/src/pages/Withdraw.tsx` has 6 functional issues, 1 UX issue, and 1 security issue that together make the client-side withdrawal flow non-functional.

### Root Cause

Withdraw.tsx was built against the old `Wallet` model. The backend has since migrated to a separate `WithdrawalAddress` model and a `CustomerPortfolio` service backed by TigerBeetle. The client was never updated to match.

### Issue Inventory

| # | Category | Issue |
|---|---|---|
| ① | API URL | Balance endpoint calls admin-only `GET /treasury/customer/${id}/assets` instead of `GET /client/portfolio/balances` |
| ② | API URL | Address endpoint calls `GET /wallets?direction=OUTBOUND&walletRole=GENERAL` (invalid params) instead of `GET /client/withdrawal-addresses?assetId=xxx&status=ACTIVE` |
| ③ | Payload | Create withdrawal sends `toWalletId` (Wallet table FK) instead of `toAddress`/`toIban` from WithdrawalAddress |
| ④ | Interface | `AssetBalance` fields (`clientCredit`, `lockedBalance`, `assetDecimals`) don't match server response (`available`, `locked`, `decimals`) |
| ⑤ | Interface | `WalletItem` interface doesn't match `WithdrawalAddress` model (`id` vs `addressNo`, `direction` doesn't exist, etc.) |
| ⑥ | Data Flow | Addresses created in WithdrawalAddresses.tsx (→ `WithdrawalAddress` table) never appear in Withdraw.tsx (reads from `Wallet` table) |
| ⑦ | UX | Balance fetch failure is silently swallowed — user sees $0 with no error indication |
| ⑧ | Security | `WithdrawTransactionsController` uses `AdminPermissionGuard` which lets customer JWT through — customers can call `PATCH :id/status`, `POST :id/simulate/*`, `POST /mock` |

---

## Solution: Two-Part Fix

### Part 1: Withdraw.tsx Client Fixes

All changes are in `client-web/src/pages/Withdraw.tsx`.

#### 1A. Interface Replacements

**`AssetBalance` (line 21-27) → match `CustomerPortfolioItem`:**

```typescript
interface AssetBalance {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;   // string from server, parseFloat when used as number
  locked: string;
  decimals: number;
}
```

**`WalletItem` (line 29-41) → replace with `WithdrawalAddressItem`:**

```typescript
interface WithdrawalAddressItem {
  id: string;
  addressNo: string;
  assetId: string;
  address: string;
  addressType: string;   // CRYPTO_ADDRESS | FIAT_BANK
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  iban?: string;
  bankName?: string;
  status: string;
  asset: { id: string; code: string; type: string; decimals?: number };
}
```

#### 1B. State Variable Changes

| Old | New |
|---|---|
| `wallets: WalletItem[]` | `addresses: WithdrawalAddressItem[]` |
| `selectedWalletId: string` | `selectedAddressNo: string` |
| — (new) | `balanceError: string \| null` |

#### 1C. API URL Changes (5 locations)

| # | Function | Old URL | New URL |
|---|---|---|---|
| 1 | Balance fetch (line 123) | `GET /treasury/customer/${user.id}/assets` | `GET /client/portfolio/balances` |
| 2 | Address fetch (line 160) | `GET /wallets?ownerType=CUSTOMER&ownerId=${id}&direction=OUTBOUND&walletRole=GENERAL&assetId=${assetId}` | `GET /client/withdrawal-addresses?assetId=${assetId}&status=ACTIVE` |
| 3 | Create withdraw (line 333) | `POST /withdraw-transactions` | `POST /client/withdraw-transactions` |
| 4 | Balance refresh (line 347) | `GET /treasury/customer/${user?.id}/assets` | `GET /client/portfolio/balances` |
| 5 | History fetch (line 200) | `GET /withdraw-transactions/my` | `GET /client/withdraw-transactions` |

#### 1D. Field Reference Changes (9 locations)

| Line | Old | New |
|---|---|---|
| 218 | `selectedBalance.clientCredit` | `parseFloat(selectedBalance.available)` |
| 321 | `wallets.find(w => w.id === selectedWalletId)` | `addresses.find(a => a.addressNo === selectedAddressNo)` |
| 327 | `toWalletId: isManualInput ? undefined : selectedWalletId` | Remove this line |
| 328 | `wallet?.address` | `selectedAddr?.address` |
| 329 | `wallet?.iban` | `selectedAddr?.iban` |
| 342 | `setSelectedWalletId('')` | `setSelectedAddressNo('')` |
| 380 | `const filteredWallets = wallets` | `const filteredAddresses = addresses` |
| 381 | `Boolean(selectedWalletId)` | `Boolean(selectedAddressNo)` |
| 386 | `selectedWalletId` in useEffect deps | `selectedAddressNo` |

#### 1E. UI Rendering Changes (8 locations)

| Line(s) | Change |
|---|---|
| 460, 479 | Tab switch reset: `setSelectedWalletId('')` → `setSelectedAddressNo('')` |
| 648 | Asset select onChange: same rename |
| 682 | Manual/saved toggle: same rename |
| 698 | Dropdown condition: `filteredWallets.length > 0` → `filteredAddresses.length > 0` |
| 701-710 | Dropdown: `value={selectedWalletId}` → `value={selectedAddressNo}`; option `key/value` use `a.addressNo`; display text uses `a.label ? \`${a.label} (${a.address})\` : a.address` for crypto, `a.bankName + ' - ' + a.iban` for fiat |
| 719 | Empty-state link: `navigate('/wallet')` → `navigate('/withdrawal-addresses')` |
| 1004-1005 | Confirm modal destination: use `addresses.find(a => a.addressNo === selectedAddressNo)` |

#### 1F. Error Handling Addition

New `balanceError` state. On balance fetch failure, set error. Display error banner above amount input:

```tsx
{balanceError && (
  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
    <AlertTriangle size={16} />
    {balanceError}
  </div>
)}
```

---

### Part 2: Backend Controller Split

#### 2A. New File: `customer-withdraw.controller.ts`

**Route prefix:** `/client/withdraw-transactions`
**Guard:** `@UseGuards(AuthGuard('jwt'))` — JWT only, no AdminPermissionGuard

| Method | Route | Behavior |
|---|---|---|
| `POST /` | Create withdrawal | Checks `req.user.type === 'CUSTOMER'`, calls `assertTradingEligibility`, then `service.create()` |
| `GET /` | List my withdrawals | Auto-scopes `ownerId = req.user.userId` |
| `GET /:id` | Get detail | Fetches then verifies `ownerId === req.user.userId`, else 403 |

#### 2B. Modified: `withdraw-transactions.controller.ts`

Remove customer-facing routes (`POST /`, `GET /my`). Add explicit admin type check to remaining handlers.

Remaining admin-only routes:

| Method | Route |
|---|---|
| `GET /` | List all withdrawals |
| `GET /:id` | Get any withdrawal detail |
| `PATCH /:id/status` | Update status |
| `POST /mock` | Create mock data |
| `POST /:id/simulate/*` | Simulation endpoints |

Each handler adds: `if (req.user.type !== 'ADMIN') throw new ForbiddenException('Admin only');`

#### 2C. Modified: `withdraw-transactions.module.ts`

Register `CustomerWithdrawController` in the `controllers` array.

---

## File Change Summary

| # | File | Op | Description |
|---|---|---|---|
| 1 | `client-web/src/pages/Withdraw.tsx` | Modify | 2 interfaces, 3 states, 5 API URLs, 9 field refs, 8 UI points, 1 error banner |
| 2 | `src/.../withdraw-transactions/customer-withdraw.controller.ts` | Create | Customer-facing create/list/detail |
| 3 | `src/.../withdraw-transactions/withdraw-transactions.controller.ts` | Modify | Remove create + findMy, add admin type checks |
| 4 | `src/.../withdraw-transactions/withdraw-transactions.module.ts` | Modify | Register new controller |

## Explicitly Out of Scope

| Item | Reason |
|---|---|
| `WithdrawTransactionsService` (L1) | No changes needed |
| `WithdrawWorkflowService` (L3) | No changes needed |
| `PricingCenterCustomerController` (quotes) | Independent module, works correctly |
| `CustomerPortfolioController` (balances) | Already exists, works correctly |
| `WithdrawalAddressController` (address CRUD) | Already exists, works correctly |
| `WithdrawalAddresses.tsx` (address management page) | Independent page, works correctly |
| L1 audit log placement issue | Separate concern, separate fix |
| `AdminPermissionGuard` itself | Guard design is intentional (RBAC for admin); problem is controller mixing |

## Verification

1. **Balance loads:** Login as customer → /withdraw → see TB-backed balances (not $0)
2. **Addresses load:** Select asset → dropdown shows ACTIVE WithdrawalAddress records
3. **Create works:** Quote → confirm → withdrawal created, appears in history
4. **Security — admin status:** Customer JWT calls `PATCH /withdraw-transactions/:id/status` → 403
5. **Security — simulate:** Customer JWT calls `POST /withdraw-transactions/:id/simulate/kyt-phase1` → 403
6. **Security — mock:** Customer JWT calls `POST /withdraw-transactions/mock` → 403

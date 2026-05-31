# Phase B: SwapQuoteService Integration + PricingCenterService Elimination

## Overview

Complete SwapQuoteService as the sole owner of swap quote lifecycle (create, validate, consume, cancel). Eliminate PricingCenterService entirely — move the 2 useful tools (`PricingEngineService`, `BinanceRateProvider`) to standalone exports, delete all PricingCenterService code and its admin controller.

Update all callers (customer controller, orchestrator, admin controller) to use SwapQuoteService directly. Update frontend pages to call the new endpoints.

---

## 1. SwapQuoteService — Complete the Lifecycle

### 1.1 Current State (Phase A)

SwapQuoteService has:
- ✅ `resolveBestLevel()` — fee level matching from SwapFeeLevel table
- ✅ `getActiveQuoteOrThrow()` — validate quote ownership/status/expiry
- ✅ `consumeQuote()` — mark USED
- ✅ `cancelQuote()` — mark CANCELLED
- ❌ `createQuote()` — resolves fees but sets rate/amountOut to 0 (no Binance call)

### 1.2 Complete `createQuote()`

The current `createQuote()` creates a SwapQuote with `amountOut=0, rateAllIn=0, marketRate=0`. It needs to:

1. Call `resolveBestLevel()` → get tier (spreadBps + feeItems)
2. Call `BinanceRateProvider.getRate()` → get market rate
3. Call `PricingEngineService.buildSwapQuote()` → calculate amountOut, apply spread, compute fees
4. Create SwapQuote record with full pricing data
5. Record audit log

**New dependencies to inject:**
- `BinanceRateProvider` — already exported from PricingCenterModule
- `AuditLogsService` — already available

**Method signature stays the same**, but the implementation fills in rate/amount fields properly.

### 1.3 Add `resolveOwnerNo()`

Simple 15-line helper (prisma lookup for customerNo/userNo). Inline into SwapQuoteService as a private method, called during `createQuote()`.

### 1.4 Add Unique QuoteNo Retry

Move the retry-on-collision logic from PricingCenterService's `createSwapQuoteWithUniqueNo()` into SwapQuoteService. Replace the current `SQ-${Date.now()}-${random}` with the retry pattern.

### 1.5 Add `markExpired()`

Move `markSwapQuoteExpired()` into SwapQuoteService — called by `getActiveQuoteOrThrow()` when a quote is past its TTL.

### 1.6 Add Admin Query Methods

Add two simple query methods for the admin page:

- `findAllForAdmin(query)` — list swap quotes with filters (status, quoteNo, ownerNo, pagination)
- `findOneForAdmin(id)` — get swap quote detail with asset relations

These are straightforward prisma queries, much simpler than PricingCenterService's generic multi-business implementation.

---

## 2. Caller Migration

### 2.1 `swap-transactions-customer.controller.ts`

| Before | After |
|--------|-------|
| `pricingCenterService.createSwapQuote(ownerType, ownerId, dto)` | `swapQuoteService.createQuote({...})` |
| `pricingCenterService.cancelSwapQuote(quoteId, ownerType, ownerId)` | `swapQuoteService.cancelQuote(quoteId, ownerType, ownerId)` |

Remove `PricingCenterService` injection. Add `SwapQuoteService` injection.

### 2.2 `swap-workflow.orchestrator.ts`

| Before | After |
|--------|-------|
| `pricingCenterService.getActiveSwapQuoteOrThrow(...)` | `swapQuoteService.getActiveQuoteOrThrow(...)` |
| `pricingCenterService.assertSwapProductAllowedForOwner(...)` | **Delete** — SwapFeeLevel pair matching is the product gate |
| `pricingCenterService.consumeSwapQuoteForSwap(tx, ...)` | `swapQuoteService.consumeQuote(quoteId, ownerType, ownerId, amount, tx)` |

Remove `PricingCenterService` injection. Add `SwapQuoteService` injection.

### 2.3 `swap-transactions.service.ts`

| Before | After |
|--------|-------|
| `pricingCenterService.resolveSwapQuoteForExecution({...})` | **Delete call** — this was for the ephemeral rate endpoint; replace with `swapQuoteService.resolveBestLevel()` or remove the endpoint |

Remove `PricingCenterService` injection.

### 2.4 `swap-transactions.controller.ts` (admin)

| Before | After |
|--------|-------|
| `pricingCenterService.listAdminPricingQuotes({business: SWAP, ...})` | `swapQuoteService.findAllForAdmin(query)` |
| `pricingCenterService.getAdminPricingQuoteDetail(SWAP, id)` | `swapQuoteService.findOneForAdmin(id)` |

Remove `PricingCenterService` injection. Add `SwapQuoteService` injection.

Change endpoint path from `quotes` to keep consistency — or keep the same path since admin controller is at `/admin/swap-transactions/quotes`.

---

## 3. Frontend Admin Page Endpoint Update

The rewritten `SwapQuoteList.tsx` and `SwapQuoteDetail.tsx` currently call:
- `GET /admin/pricing/quotes?business=SWAP`
- `GET /admin/pricing/quotes/SWAP/:id`

These are served by `pricing-center.admin.controller.ts` which is being deleted.

**Change to use the swap admin controller's existing routes:**
- `GET /admin/swap-transactions/quotes` (already exists at swap-transactions.controller.ts line 50)
- `GET /admin/swap-transactions/quotes/:id` (already exists at line 59)

Update `SwapQuoteList.tsx` and `SwapQuoteDetail.tsx` to call these endpoints instead.

Similarly, `WithdrawQuoteList.tsx` and `WithdrawQuoteDetail.tsx` currently call `/admin/pricing/quotes`. These need a new endpoint on the withdrawal side, or keep a minimal route. Since withdrawal is out of scope, add a simple pass-through on the withdrawal admin controller or keep the pricing endpoint for withdrawal only.

**Decision:** Add `GET /admin/withdrawal-fee-levels/quotes` and `GET /admin/withdrawal-fee-levels/quotes/:id` endpoints on the existing `WithdrawalFeeLevelController`, delegating to `WithdrawQuoteService`. Update the withdrawal quote admin pages to call these.

---

## 4. Withdrawal Side — Minimal Changes

### 4.1 `pricing-center.customer.controller.ts`

This controller is at route prefix `withdraw-transactions` and has 2 endpoints:
- `POST /withdraw-transactions/quotes` → `withdrawQuoteService.createQuote()`
- `POST /withdraw-transactions/quotes/:id/cancel` → `withdrawQuoteService.cancelQuote()`

These already bypass PricingCenterService (call WithdrawQuoteService directly). **Rename file** to `withdraw-quote-customer.controller.ts` and **move to the withdrawal-fee-level module**. Remove the `resolveOwnerNo` call to PricingCenterService — inline the lookup.

### 4.2 `withdraw-transactions.service.ts`

Remove 2 calls to PricingCenterService:
- `pricingCenterService.resolveOwnerNo()` → inline the prisma query
- `pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked()` → **delete** (legacy config check, replaced by FeeLevel system)

### 4.3 `payouts.service.ts`

Remove call to `pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked()` → **delete**.

### 4.4 `business-config.service.ts`

Remove calls to `pricingCenterService.assertSwapPolicyConfig()` and `assertWithdrawalPolicyConfig()` → **delete** (legacy config validation).

---

## 5. Delete PricingCenterService + Admin Controller

After all callers are migrated:

**Delete files:**
- `src/modules/trading/pricing-center/pricing-center.service.ts` (2926 lines)
- `src/modules/trading/pricing-center/pricing-center.admin.controller.ts`

**Keep files (in pricing-center module):**
- `pricing-engine.service.ts` — pure calculation engine, used by SwapQuoteService + WithdrawQuoteService
- `binance-rate-provider.ts` — rate fetching, used by SwapQuoteService
- `pricing-center.module.ts` — exports PricingEngineService + BinanceRateProvider only
- Types/DTOs still referenced by the engine

**Update `pricing-center.module.ts`:**
- Remove `PricingCenterService` from providers and exports
- Remove controller registration
- Keep `PricingEngineService` and `BinanceRateProvider` exports

---

## 6. Module Wiring

### SwapFeeLevelModule updates
- Add `SwapQuoteService` to exports (already exported)
- SwapQuoteService gains: `BinanceRateProvider`, `AuditLogsService` injections

### SwapTransactionsModule updates
- Remove `PricingCenterModule` import (or keep for PricingEngineService if needed)
- Import `SwapFeeLevelModule` to get `SwapQuoteService`

### WithdrawalFeeLevelModule updates
- Register the moved customer controller
- Add admin quote endpoints to `WithdrawalFeeLevelController`

---

## 7. What Is NOT Changing

- `SwapQuote` Prisma model — no schema changes
- `SwapTransaction` Prisma model — no schema changes
- `PricingEngineService` — stays as-is, just moved out of PricingCenterService's shadow
- `BinanceRateProvider` — stays as-is
- Customer-facing swap flow (2-step: create quote → create swap from quote) — same UX
- Approval workflows — not touched
- SwapFeeLevel admin pages — not touched

---

## 8. Summary of File Changes

### Create
None — all work is modifications.

### Modify
| File | Change |
|------|--------|
| `swap-fee-level/swap-quote.service.ts` | Complete createQuote() with Binance + PricingEngine; add resolveOwnerNo, markExpired, uniqueNo retry, admin query methods, audit logging |
| `swap-fee-level/swap-fee-level.module.ts` | Add BinanceRateProvider + AuditLogsService to imports/providers |
| `swap-transactions/swap-transactions-customer.controller.ts` | Replace PricingCenterService with SwapQuoteService |
| `swap-transactions/swap-workflow.orchestrator.ts` | Replace PricingCenterService with SwapQuoteService; remove assertSwapProductAllowed |
| `swap-transactions/swap-transactions.service.ts` | Remove PricingCenterService; swap quote resolution uses SwapQuoteService |
| `swap-transactions/swap-transactions.controller.ts` | Replace PricingCenterService quote methods with SwapQuoteService |
| `swap-transactions/swap-transactions.module.ts` | Replace PricingCenterModule import with SwapFeeLevelModule |
| `withdraw-transactions/withdraw-transactions.service.ts` | Inline resolveOwnerNo; remove volatility check |
| `asset-treasury/payouts/payouts.service.ts` | Remove volatility check |
| `governance/business-config/business-config.service.ts` | Remove assertSwapPolicyConfig/assertWithdrawalPolicyConfig |
| `pricing-center/pricing-center.module.ts` | Remove PricingCenterService + admin controller; keep engine + rate provider |
| `admin-web/src/pages/SwapQuoteList.tsx` | Change API endpoint to `/admin/swap-transactions/quotes` |
| `admin-web/src/pages/SwapQuoteDetail.tsx` | Change API endpoint to `/admin/swap-transactions/quotes/:id` |
| `admin-web/src/pages/WithdrawQuoteList.tsx` | Change API endpoint to new withdrawal quote admin endpoint |
| `admin-web/src/pages/WithdrawQuoteDetail.tsx` | Change API endpoint to new withdrawal quote admin endpoint |

### Delete
| File | Reason |
|------|--------|
| `pricing-center/pricing-center.service.ts` | All responsibilities moved to domain services |
| `pricing-center/pricing-center.admin.controller.ts` | Endpoints moved to domain controllers |

### Move
| File | From → To |
|------|-----------|
| `pricing-center/pricing-center.customer.controller.ts` | → `withdrawal-fee-level/withdraw-quote-customer.controller.ts` (rename + move) |

# Client Swap Page — Contract Fix + Brand Restyle

## Overview

Two bundled changes to the customer Swap experience:

1. **Contract fix (functional bug):** The `POST /swap-transactions/quotes` response was trimmed in Phase B and no longer matches the client's `FirmQuoteResult`. The confirm modal reads `netAmountOut`, `currencyIn`, `currencyOut` — all missing — so the "You receive (net)" amount and currency labels render blank/undefined. Fix the backend response to fully match the client contract.

2. **Brand restyle:** `client-web/src/pages/Swap.tsx` uses an off-brand blue/slate/gray palette. Re-color it to the "Desert Monolith" brand tokens (obsidian surfaces, brass-gold accents, sand text), consistent with Withdraw/Deposit. Keep the existing layout and interaction logic.

**Service note:** The client already hits the new services — `/swap-transactions/quotes` → `SwapQuoteService.createQuote()`, `/swap-transactions` → `SwapWorkflowService.executeSwap()`. URLs are unchanged; only the quote response shape needs realignment. The `rate` and `/my` endpoints were verified to match the client and need no change.

**Scope:** 2 files — `swap-transactions-customer.controller.ts` (backend response), `Swap.tsx` (frontend styling).

---

## Part A — Backend Contract Fix

### A.1 Problem

Current `createQuote` returns:
```
{ quoteId, quoteNo, status, fromAssetCode, toAssetCode, amountIn, amountOut,
  rateAllIn, marketRate, spreadBps, feeTotal, feeCurrency, createdAt, expiresAt }
```
with numeric fields stringified (`.toString()`).

Client `FirmQuoteResult` needs (fields actually read by the confirm modal in bold):
`quoteId, quoteType, status, createdAt, expiresAt, usedAt, baseCurrency, quoteCurrency, side, amountType, `**`amountIn`**`, `**`currencyIn`**`, `**`amountOut`**`, `**`netAmountOut`**`, `**`currencyOut`**`, rateDisplay, `**`rateAllIn`**`, marketRate, spreadPercent, spreadBps, rateSource, fetchedAt, `**`feeTotal`**`, `**`feeCurrency`**`, feeBreakdown, matched?, pricingSource?`

### A.2 Fix

In `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`, replace the inline return object in `createQuote` with a call to a private mapper `toCustomerQuoteResponse(quote)` that returns the full shape from the `SwapQuote` record. All fields exist on the model (`currencyIn`, `currencyOut`, `quoteType`, `side`, `amountType`, `rateDisplay`, `spreadPercent`, `rateSource`, `fetchedAt`, `feeBreakdown`, `totalsJson`); `netAmountOut` comes from `JSON.parse(totalsJson).amountOutNet`.

Mapper:
```typescript
private toCustomerQuoteResponse(quote: SwapQuote) {
  const totals = this.parseJson<Record<string, string>>(quote.totalsJson, {});
  const netAmountOut = Number(totals.amountOutNet ?? quote.amountOut);
  return {
    quoteId: quote.id,
    quoteNo: quote.quoteNo,
    quoteType: quote.quoteType,
    status: quote.status,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    usedAt: quote.usedAt,
    baseCurrency: quote.fromAssetCode,
    quoteCurrency: quote.toAssetCode,
    side: quote.side,
    amountType: quote.amountType,
    amountIn: Number(quote.amountIn),
    currencyIn: quote.currencyIn,
    amountOut: Number(quote.amountOut),
    netAmountOut,
    currencyOut: quote.currencyOut,
    rateDisplay: Number(quote.rateDisplay),
    rateAllIn: Number(quote.rateAllIn),
    marketRate: Number(quote.marketRate),
    spreadPercent: Number(quote.spreadPercent),
    spreadBps: quote.spreadBps,
    rateSource: quote.rateSource,
    fetchedAt: quote.fetchedAt,
    feeTotal: Number(quote.feeTotal),
    feeCurrency: quote.feeCurrency,
    feeBreakdown: this.parseJson<unknown[]>(quote.feeBreakdown, []),
  };
}
```
Add a `parseJson<T>(value, fallback)` helper (mirrors the workflow service's). `matched`/`pricingSource` are optional in the client (`matched?`, `pricingSource?`) and omitted — the confirm modal does not depend on them.

`createQuote` body's `return {...}` becomes `return this.toCustomerQuoteResponse(quote);`.

Import `SwapQuote` type from `@prisma/client`.

---

## Part B — Swap.tsx Brand Restyle

### B.1 Direction

Full alignment to the Desert Monolith brand (chosen: option A). Keep the current layout, interaction logic, and dark/light theme support (existing `ThemeContext`). Only re-color and tighten.

### B.2 Token mapping (Tailwind classes already defined in `tailwind.config.js`)

| Current (off-brand) | Replace with |
|---------------------|--------------|
| `bg-white`, `bg-slate-50`, `bg-gray-*` (card surfaces) | `bg-fx-ink`, `bg-fx-charcoal` (dark) / keep light surfaces neutral via existing dark: variants |
| `text-slate-*`, `text-gray-*` (primary/secondary text) | `text-fx-sand` (primary), `text-fx-dune` (secondary), `text-fx-dust` (muted) |
| `text-blue-*`, `bg-blue-*` (accents, swap arrow, confirm button) | `text-fx-brass` / `bg-fx-brass` (primary gold), `text-fx-ember` (highlight) |
| `border-slate-*`, `border-gray-*` | `border-fx-rule` (hairline gold) |
| `text-emerald-*` (positive) | `text-fx-sage` |
| `text-red-*`, `bg-red-*` (error/destructive) | `text-fx-rust`, `bg-fx-rust` |
| Confirm button `bg-blue-600 text-white` | `bg-fx-brass text-fx-obsidian` (gold fill, dark text) |
| "You receive (net)" emphasis | `text-fx-ember` (highlight gold) |

### B.3 Affected regions in `Swap.tsx`

All visual, no logic change:
1. **Swap input card** — from/to asset selectors, amount input, swap-direction toggle, live rate row
2. **Confirm modal** — pay/receive rows, fee/rate detail rows, confirm/cancel buttons
3. **History tab** — transaction rows, status badges, filter controls
4. **Live rate display** — market/executable rate, spread, fee preview

Preserve all existing `dark:` variants where present; where the page used a single light-mode color, add the brand equivalent. Match the spacing/hierarchy conventions of `Withdraw.tsx` where they diverge (tighten oversized paddings).

### B.4 Constraints

- Do NOT change layout structure, component hierarchy, or interaction handlers.
- Do NOT change API endpoints or request/response handling (Part A covers the contract).
- Keep `formatAssetAmount` / `formatRate8` usage as-is.
- Verify the page builds (`tsc`) and renders in both light and dark themes.

---

## What Is NOT Changing

- Backend services (SwapQuoteService / SwapWorkflowService) — already new
- `rate` and `/my` endpoints — already match the client
- Other client pages (Withdraw, Deposit, etc.)
- Swap interaction logic, routing, auth
- Admin swap pages

# Client Swap Restyle + Contract Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the swap quote response contract so the customer confirm modal renders correctly, and restyle the customer Swap page to the Desert Monolith brand palette.

**Architecture:** Part A is a backend response-shape fix in the customer controller (add a `toCustomerQuoteResponse` mapper returning the full `FirmQuoteResult` shape from the SwapQuote record). Part B re-colors `Swap.tsx` from blue/slate/gray to the brand `fx-*` tokens, keeping layout and logic untouched.

**Tech Stack:** NestJS, Prisma, React, TypeScript, Tailwind CSS

---

### Task 1: Backend — Fix createQuote Response Contract

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`

The current `createQuote` returns a trimmed object with stringified numbers and missing `netAmountOut`, `currencyIn`, `currencyOut`. Replace it with a full mapper.

- [ ] **Step 1: Add the SwapQuote import**

In `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`, the line:
```typescript
import { Prisma } from '@prisma/client';
```
becomes:
```typescript
import { Prisma, SwapQuote } from '@prisma/client';
```

- [ ] **Step 2: Replace the inline return with a mapper call**

Find this block in `createQuote`:
```typescript
    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      fromAssetCode: quote.fromAssetCode,
      toAssetCode: quote.toAssetCode,
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      rateAllIn: quote.rateAllIn.toString(),
      marketRate: quote.marketRate.toString(),
      spreadBps: quote.spreadBps,
      feeTotal: quote.feeTotal.toString(),
      feeCurrency: quote.feeCurrency,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
    };
  }
```

Replace with:
```typescript
    return this.toCustomerQuoteResponse(quote);
  }

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

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

- [ ] **Step 3: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 4: Verify the response shape via a quick smoke check**

The `SwapQuote` model fields used (`currencyIn`, `currencyOut`, `quoteType`, `side`, `amountType`, `rateDisplay`, `spreadPercent`, `rateSource`, `fetchedAt`, `totalsJson`, `feeBreakdown`) all exist — confirm:

Run: `grep -E "currencyIn|currencyOut|quoteType|amountType|rateDisplay|totalsJson|feeBreakdown" prisma/schema.prisma | head`
Expected: shows these fields on the SwapQuote model.

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts
git commit -m "fix: return full FirmQuoteResult shape from swap createQuote (netAmountOut, currencyIn/Out)"
```

---

### Task 2: Frontend — Restyle Swap.tsx to Brand Palette

**Files:**
- Modify: `client-web/src/pages/Swap.tsx`

Re-color all off-brand classes to the Desert Monolith `fx-*` tokens (already defined in `client-web/tailwind.config.js`). Keep layout, hierarchy, and all logic/handlers unchanged. Apply the mapping below by semantic role.

**Brand token reference (from tailwind.config.js):**
- `fx-obsidian #0B0908` (bg), `fx-ink #141110` (surface), `fx-charcoal #1E1A16` (card), `fx-shadow #2A231C` (hover row)
- `fx-sand #F5EDE0` (primary text), `fx-dune #C8B896` (secondary text), `fx-dust #8B7B6A` (muted text)
- `fx-brass #C89B3C` (primary accent), `fx-copper #B07530` (hover), `fx-ember #E5B85F` (highlight)
- `fx-sage #739477` (positive), `fx-rust #B85A4A` (error), `fx-rule` (hairline border)

- [ ] **Step 1: Apply the class mapping**

Apply these replacements throughout `client-web/src/pages/Swap.tsx`. Group by semantic role; the left column lists the exact off-brand classes currently present.

**Accent — primary (blue → brass/ember):**
- `text-blue-600` → `text-fx-brass`
- `text-blue-900`, `text-blue-800`, `text-blue-800/80` → `text-fx-copper`
- `dark:text-blue-400`, `dark:text-blue-300`, `dark:text-blue-200/80`, `dark:text-blue-200`, `dark:text-blue-100` → `dark:text-fx-ember`
- `bg-blue-100`, `bg-blue-50` → `bg-fx-brass/10`
- `dark:bg-blue-900/30`, `dark:bg-blue-900/20`, `dark:bg-blue-800/30` → `dark:bg-fx-brass/10`
- `border-blue-600` → `border-fx-brass`
- `border-blue-100` → `border-fx-brass/20`
- `dark:border-blue-900/30` → `dark:border-fx-brass/25`

**Positive (emerald → sage):**
- `text-emerald-600`, `text-emerald-800` → `text-fx-sage`
- `dark:text-emerald-300` → `dark:text-fx-sage`
- `bg-emerald-100` → `bg-fx-sage/15`
- `dark:bg-emerald-900/30` → `dark:bg-fx-sage/20`

**Error (red → rust):**
- `text-red-500`, `text-red-600`, `text-red-800` → `text-fx-rust`
- `dark:text-red-300`, `dark:text-red-400` → `dark:text-fx-rust`
- `bg-red-100` → `bg-fx-rust/15`
- `dark:bg-red-900/30` → `dark:bg-fx-rust/20`

**Primary text (gray-900 → obsidian/sand):**
- `text-gray-900` → `text-fx-obsidian`
- `dark:text-gray-200`, `dark:text-slate-200` → `dark:text-fx-sand`
- `text-gray-200` (already light, used on dark bg) → `text-fx-sand`
- `text-slate-800`, `text-slate-700`, `text-gray-700` → `text-fx-ink dark:text-fx-dune`

**Secondary / muted text (slate/gray 400–500 → dune/dust):**
- `text-slate-500`, `text-gray-500` → `text-fx-dust`
- `dark:text-slate-400`, `dark:text-gray-400` → `dark:text-fx-dune`
- `text-slate-400`, `text-gray-400` → `text-fx-dust`
- `dark:text-slate-500`, `dark:text-gray-500` → `dark:text-fx-dust`

**Surfaces (white/slate/gray bg → sand-tint light / ink-charcoal dark):**
- `bg-slate-50`, `bg-gray-50`, `bg-slate-100` → `bg-fx-sand/40`
- `dark:bg-gray-800`, `dark:bg-slate-800/50`, `dark:bg-gray-800/60`, `dark:bg-slate-700` → `dark:bg-fx-charcoal`
- `dark:bg-gray-900/50`, `dark:bg-slate-900/50`, `dark:bg-slate-900/40` → `dark:bg-fx-ink`
- `dark:bg-gray-700` → `dark:bg-fx-shadow`

**Borders (slate/gray → rule):**
- `border-slate-200`, `border-gray-200`, `border-gray-100` → `border-fx-rule`
- `dark:border-slate-700`, `dark:border-gray-700`, `dark:border-gray-600`, `dark:border-slate-600`, `dark:border-gray-800` → `dark:border-fx-rule`

**Hover states (slate → shadow/dune):**
- `hover:bg-slate-50`, `hover:bg-slate-100` → `hover:bg-fx-sand/60`
- `dark:hover:bg-slate-700`, `dark:hover:bg-slate-700/50` → `dark:hover:bg-fx-shadow`
- `hover:text-slate-600` → `hover:text-fx-copper`
- `dark:hover:text-slate-300` → `dark:hover:text-fx-dune`

- [ ] **Step 2: Restyle the primary action / confirm button**

The confirm/submit button(s) currently use a blue fill. Change the fill to brass with obsidian text. Find the swap confirm button (look for the button with `bg-blue-600` or similar primary fill in the confirm modal and the main "Get Quote"/"Swap" action) and set its classes to:
```
bg-fx-brass hover:bg-fx-copper text-fx-obsidian
```
The swap-direction toggle circle (the `↓`/`⇅` button between pay/receive) that used `bg-blue-*`: set to `bg-fx-brass text-fx-obsidian`.

The "You receive (net)" emphasis value: set its text color to `text-fx-ember` for highlight.

- [ ] **Step 3: Verify no off-brand classes remain**

Run:
```bash
grep -oE "(dark:)?(bg|text|border|ring|from|to|via|hover:bg|hover:text|placeholder)-(blue|slate|gray|indigo|sky|emerald|red|green)-[0-9]+(/[0-9]+)?" client-web/src/pages/Swap.tsx | sort | uniq -c
```
Expected: empty (no off-brand color classes remain). If any remain, map them using the same semantic rules (accent→brass/ember, positive→sage, error→rust, primary text→obsidian/sand, secondary→dune/dust, surface→ink/charcoal, border→rule).

- [ ] **Step 4: Verify the client builds**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors. (Pure className string changes do not affect types; this confirms no accidental JSX breakage.)

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add client-web/src/pages/Swap.tsx
git commit -m "style: restyle customer Swap page to Desert Monolith brand palette"
```

---

### Task 3: End-to-End Verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Backend build clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -3`
Expected: No errors.

- [ ] **Step 2: Client build clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: No errors.

- [ ] **Step 3: Confirm the contract mapper returns the client-needed fields**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
grep -E "netAmountOut|currencyIn:|currencyOut:|toCustomerQuoteResponse" src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts
```
Expected: shows the mapper and the three previously-missing fields.

- [ ] **Step 4: Confirm no off-brand classes remain in Swap.tsx**

Run:
```bash
grep -coE "(dark:)?(bg|text|border)-(blue|slate|gray|emerald|red)-[0-9]+" client-web/src/pages/Swap.tsx
```
Expected: `0`.

- [ ] **Step 5: Visual check in the running client (both themes)**

The dev stack is running (client at http://localhost:3502). Open the Swap page, and visually confirm in BOTH light and dark theme:
- Surfaces, text, accents use brand gold/sand/obsidian — no blue/slate remnants
- The confirm modal shows a non-blank "You receive (net)" amount with correct currency labels (contract fix working)
- Contrast is acceptable in both themes (adjust any `fx-dust`/`fx-dune` text that reads too low-contrast on light surfaces to `fx-ink`)

If any contrast issue is found, fix it in `Swap.tsx` and amend the Task 2 commit:
```bash
git add client-web/src/pages/Swap.tsx && git commit --amend --no-edit
```

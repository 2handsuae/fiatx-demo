# Client Withdraw Visual Alignment — Design Spec

**Goal:** Align `Withdraw.tsx` visual style with `Deposit.tsx` — same `fx-*` dark theme, same page header pattern, customer-facing status labels. No business logic changes.

**Scope:** Single-file change to `client-web/src/pages/Withdraw.tsx`. No backend changes. No new components.

---

## Changes

### 1. Remove Hero Banner → Simple Header

Delete the ~40-line decorative hero banner (gradient background, grid overlay, blur effects, 3 stat cards). Replace with the Deposit-style simple header:

```tsx
<h1 className="text-2xl font-bold text-fx-sand">Withdraw</h1>
<p className="mt-1 text-sm text-fx-dust">Send funds to your wallet or bank account</p>
```

### 2. Theme Token Replacement

Replace all `slate/gray/blue/brand-primary` classes with `fx-*` tokens to match Deposit.

| Element | Before | After |
|---------|--------|-------|
| Main card | `bg-white dark:bg-gray-800` | `bg-fx-ink/40` |
| Card border | `border-slate-200 dark:border-slate-700` | `border-fx-rule` |
| Tab active | `border-blue-600 text-blue-600 bg-white dark:bg-gray-800` | `border-fx-brass text-fx-brass bg-fx-ink/40` |
| Tab inactive | `text-slate-500 dark:text-slate-400` | `text-fx-dust hover:text-fx-sand` |
| Heading text | `text-gray-900 dark:text-white` | `text-fx-sand` |
| Secondary text | `text-slate-500 dark:text-slate-400` | `text-fx-dust` |
| Body text | `text-gray-700 dark:text-gray-300` | `text-fx-dune` |
| Input fields | `bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-gray-900 dark:text-white` | `bg-fx-charcoal border-fx-rule text-fx-sand placeholder:text-fx-dust` |
| Select fields | `bg-white dark:bg-slate-700` | `bg-fx-charcoal border-fx-rule text-fx-sand` |
| Primary button | `bg-gradient-to-r from-brand-primary to-brand-primary/80 text-white` | `bg-fx-brass text-fx-obsidian hover:bg-fx-brass/90` |
| Secondary button | Various slate/gray | `border-fx-rule text-fx-dust hover:text-fx-sand` |
| Instructions panel bg | `bg-blue-50 dark:bg-blue-900/20` | `bg-fx-ink/60` |
| Instructions panel text | `text-blue-800 dark:text-blue-300` | `text-fx-dust` |
| Instructions panel title | `text-blue-900 dark:text-blue-200` | `text-fx-brass` |
| Instructions panel icon | `text-blue-600 dark:text-blue-400` | `text-fx-brass` |
| Modal background | `bg-white dark:bg-gray-800` | `bg-fx-ink border-fx-rule` |
| Modal overlay | `bg-black/50` | `bg-black/60` |
| Table row hover | `hover:bg-slate-50 dark:hover:bg-slate-700/50` | `hover:bg-fx-ink/60` |
| Dividers | `border-slate-200 dark:border-slate-700` | `border-fx-rule` |
| Error text | `text-red-500 dark:text-red-400` | `text-fx-rust` |
| Success text | Various green | `text-fx-sage` |

### 3. Customer-Facing Status Labels

Add a status mapping function (inline in Withdraw.tsx, same pattern as Deposit):

```typescript
const getCustomerFacingWithdrawStatus = (status: string): { label: string; className: string } => {
  const s = status?.toUpperCase() || '';
  if (['SUCCESS'].includes(s))
    return { label: 'Completed', className: 'text-fx-sage bg-fx-sage/10' };
  if (['REJECTED', 'CANCELLED'].includes(s))
    return { label: 'Declined', className: 'text-rose-400 bg-rose-500/10' };
  if (['FAILED', 'RETURNED'].includes(s))
    return { label: 'Failed', className: 'text-fx-rust bg-fx-rust/10' };
  if (['EXPIRED'].includes(s))
    return { label: 'Expired', className: 'text-fx-dust bg-fx-dust/10' };
  // CREATED, PENDING_COMPLIANCE, UNDER_REVIEW, APPROVED, PAYOUT_PENDING, FROZEN
  return { label: 'Processing', className: 'text-fx-brass bg-fx-brass/10' };
};
```

Use this in:
- History table status column (replace raw status display)
- Transaction detail modal status display
- History filter dropdown options (use customer-facing labels: "Processing", "Completed", "Declined", "Failed")

### 4. Remove Unused State

Remove `const [, setLoading] = useState(false)` and all its `setLoading(...)` call sites. The component already has `balanceLoading`, `quoteLoading`, `submitting`, and `historyLoading` for specific loading states.

### 5. Detail Modal Bottom Close Button

Add a "Close" button at the bottom of the transaction detail modal, matching Deposit's pattern:

```tsx
<button
  onClick={() => setSelectedTx(null)}
  className="mt-4 w-full rounded-xl bg-fx-charcoal py-2.5 text-sm font-medium text-fx-sand hover:bg-fx-charcoal/80"
>
  Close
</button>
```

### 6. Confirm Modal Theme Alignment

The confirmation modal also needs theme alignment:
- Background: `bg-fx-ink border-fx-rule`
- Text: `text-fx-sand`, `text-fx-dust`
- Fee breakdown section: `bg-fx-charcoal` background
- Confirm button: `bg-fx-brass text-fx-obsidian`
- Cancel button: `border-fx-rule text-fx-dust`

---

## What Does NOT Change

- All API calls (assets, balances, addresses, quotes, submit, history)
- All state management (except removing unused `loading`)
- Form validation logic
- Amount/balance calculation
- Quote preview and confirmation flow
- Address selection (saved vs manual toggle)
- Navigation to `/withdrawal-addresses`
- Tab structure (crypto / fiat / history)
- Pagination logic

## File Summary

| Action | Path |
|--------|------|
| Modify | `client-web/src/pages/Withdraw.tsx` |

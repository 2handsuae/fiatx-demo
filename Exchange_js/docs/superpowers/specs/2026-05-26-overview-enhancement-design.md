# Overview Page Enhancement — Design Spec

> **Scope:** Add AED portfolio total, per-asset AED valuation, and indicative rates table to client Overview page.
> **Goal:** Let customers see their total portfolio value in AED at a glance, with per-asset breakdown and rate transparency.

---

## Design Decisions

1. **Hardcoded rates** — USDT pegged at 3.6725 AED/USD. No backend endpoint, no external API calls. Sufficient for current 2-asset system (AED + USDT-TRON). When volatile crypto (BTC, ETH) are added, this should be replaced with a backend `/pricing/rates` endpoint reusing `BinanceRateProvider`.
2. **No ACTIONS section** — Remove Deposit/Withdraw/Swap/History quick-action buttons. Page is pure data display. Navigation lives in the sidebar.
3. **AED as reporting currency** — All valuations expressed in AED. This matches the UAE VARA licensing context.
4. **Indicative disclaimer** — Rates are labeled "indicative" to avoid implying executable pricing.

---

## Page Structure

Three sections, top to bottom:

### Section 1: Portfolio Value

- Position: top of page, replacing the current title area
- Shows: `≈ {total} AED` in large monospace text
- Below: `{n} assets with balance · {m} supported`
- Refresh button (right-aligned in section header)

### Section 2: Holdings Table

Existing table with one new column:

| Column | Source | Format |
|--------|--------|--------|
| Asset (icon + code) | `platformAsset.code` | Existing |
| Type badge | `platformAsset.type` | Existing |
| Available | `userAsset.clientCredit` | Existing |
| Locked | `userAsset.lockedBalance` | Existing |
| **≈ AED** (new) | `(available + locked) × rate` | `formatAssetAmount(value, 2)` |
| Ledger link | navigate | Existing |

Table footer row: `Total {sum} AED` right-aligned under the ≈ AED column.

### Section 3: Indicative Rates

- Section title: `INDICATIVE RATES`
- One row per platform asset: `{currency}  →  {rate} AED`
- Footer note: `Indicative · AED pegged at 3.6725 AED/USD`
- Styled with `text-fx-dust` (low-key reference data)

---

## Rate Logic

```typescript
const RATES_TO_AED: Record<string, number> = {
  'AED': 1.0,
  'USDT': 3.6725,
  'USDC': 3.6725,
  'USD': 3.6725,
};

function getAedRate(assetCode: string, currency: string): number | null {
  return RATES_TO_AED[assetCode] ?? RATES_TO_AED[currency] ?? null;
}
```

- Lookup order: full asset code first (e.g. `USDT-TRON`), then currency (e.g. `USDT`)
- `null` means no rate available → display `—` in AED column, exclude from total
- Total = Σ (available + locked) × rate, only for assets with known rates

---

## What Changes

| Area | Change |
|------|--------|
| `DashboardOverview.tsx` | Remove ACTIONS section. Add Portfolio Value section. Add ≈ AED column to holdings. Add total row. Add Indicative Rates section. Add `RATES_TO_AED` constant. |

**No new files. No backend changes. No new dependencies.**

---

## Error Handling

- API failure: existing error state (fx-rust alert + retry) remains unchanged
- Missing rate for an asset: show `—` in AED column, don't include in total
- All balances zero: total shows `0.00 AED`, holdings table shows all rows dimmed (existing behavior)

---

## Not In Scope

- Backend rate endpoint (future: when volatile crypto assets are added)
- Real-time rate updates / WebSocket
- Portfolio history / P&L tracking
- Rate source configuration by admin

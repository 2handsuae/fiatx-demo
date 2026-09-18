# Sumsub Withdraw Simulation UI — Design Spec

**Goal:** Extend the existing KYT Check and Travel Rule tabs in `SumsubEventsPage.tsx` to support Withdraw transactions (Pre-KYT, Post-KYT, Travel Rule), using backend endpoints already in place.

**Scope:** Single-file change to `admin-web/src/pages/SumsubEventsPage.tsx`. No backend changes. No new tabs.

---

## Context

The Sumsub Events page (`/dashboard/sumsub-events`) has a simulation modal with 7 tabs. The KYT Check and Travel Rule tabs currently only support Deposit transactions (input: `depositNo`, hard-coded PASS).

Backend endpoints for withdraw simulation already exist:
- `POST /admin/sumsub/simulate/withdraw-kyt` — body: `{ withdrawNo, stage: 'PRE'|'POST', result: 'PASS'|'FAIL', riskScore? }`
- `POST /admin/sumsub/simulate/withdraw-tr` — body: `{ withdrawNo, result: 'PASS'|'FAIL' }`

## Design

### New State Variables

```typescript
const [simTxnType, setSimTxnType] = useState<'deposit' | 'withdraw'>('deposit');
const [simWithdrawNo, setSimWithdrawNo] = useState('');
const [simKytStage, setSimKytStage] = useState<'PRE' | 'POST'>('PRE');
```

Reset `simTxnType` to `'deposit'`, `simWithdrawNo` to `''`, and `simKytStage` to `'PRE'` when switching tabs (in the tab click handler).

### KYT Check Tab Changes

**Layout (top to bottom):**

1. **Description text** — unchanged intro paragraph
2. **Transaction Type radio** — Deposit / Withdraw (new)
3. **Identifier input:**
   - Deposit selected → show `depositNo` input (existing)
   - Withdraw selected → show `withdrawNo` input (new)
4. **KYT Stage radio** (only when Withdraw selected):
   - Pre-broadcast / Post-broadcast, default Pre
   - Uses same radio card styling as onboarding scenarios
5. **Submit button** — dynamic label:
   - Deposit → "Simulate KYT PASS"
   - Withdraw + PRE → "Simulate Pre-KYT PASS"
   - Withdraw + POST → "Simulate Post-KYT PASS"

**API call logic:**
- Deposit: `POST /admin/sumsub/simulate/kyt-check` with `{ depositNo: simDepositNo, result: 'PASS' }` (unchanged)
- Withdraw: `POST /admin/sumsub/simulate/withdraw-kyt` with `{ withdrawNo: simWithdrawNo, stage: simKytStage, result: 'PASS' }`

**Success message:**
- Deposit: `"KYT check simulated: PASSED for {depositNo}"` (unchanged)
- Withdraw: `"Withdraw {stage} KYT simulated: PASSED for {withdrawNo}"`

### Travel Rule Tab Changes

**Layout (top to bottom):**

1. **Description text** — unchanged intro paragraph
2. **Transaction Type radio** — Deposit / Withdraw (new, same component as KYT tab)
3. **Identifier input:**
   - Deposit → `depositNo` input (existing)
   - Withdraw → `withdrawNo` input (new)
4. **Submit button** — "Simulate TR PASS" (same label for both)

**API call logic:**
- Deposit: `POST /admin/sumsub/simulate/tr-check` with `{ depositNo: simDepositNo, result: 'PASS' }` (unchanged)
- Withdraw: `POST /admin/sumsub/simulate/withdraw-tr` with `{ withdrawNo: simWithdrawNo, result: 'PASS' }`

**Success message:**
- Deposit: `"Travel Rule check simulated: PASSED for {depositNo}"` (unchanged)
- Withdraw: `"Withdraw Travel Rule simulated: PASSED for {withdrawNo}"`

### Transaction Type Radio Styling

Reuse the existing radio card pattern from onboarding scenarios:

```tsx
<div className="flex gap-2">
  {(['deposit', 'withdraw'] as const).map((t) => (
    <label
      key={t}
      className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center transition-colors ${
        simTxnType === t
          ? 'border-adm-amber bg-adm-amber/6'
          : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
      }`}
    >
      <input
        type="radio"
        name="txnType"
        value={t}
        checked={simTxnType === t}
        onChange={() => setSimTxnType(t)}
        className="sr-only"
      />
      <span className="font-mono text-[11px] text-adm-t1">
        {t === 'deposit' ? 'Deposit' : 'Withdraw'}
      </span>
    </label>
  ))}
</div>
```

### KYT Stage Radio Styling (Withdraw only)

Same pattern, shown only when `simTxnType === 'withdraw'` in KYT tab:

```tsx
<div className="flex gap-2">
  {(['PRE', 'POST'] as const).map((s) => (
    <label
      key={s}
      className={`flex-1 cursor-pointer rounded border px-3 py-2 text-center transition-colors ${
        simKytStage === s
          ? 'border-adm-amber bg-adm-amber/6'
          : 'border-adm-border bg-adm-bg hover:border-adm-bhi'
      }`}
    >
      <input type="radio" name="kytStage" value={s} checked={simKytStage === s}
        onChange={() => setSimKytStage(s)} className="sr-only" />
      <span className="font-mono text-[11px] text-adm-t1">
        {s === 'PRE' ? 'Pre-broadcast' : 'Post-broadcast'}
      </span>
    </label>
  ))}
</div>
```

### Validation

- Deposit mode: require `simDepositNo` non-empty (existing behavior)
- Withdraw mode: require `simWithdrawNo` non-empty
- Submit button disabled when the required identifier field is empty

### What Does NOT Change

- Other 5 tabs (Onboarding, Material Refresh, CRA Result, Ongoing Monitoring, Level 2 Complete) — untouched
- Tab count remains 7
- Backend endpoints — no changes needed
- No new files created
- No FAIL option (result always PASS)

---

## File Summary

| Action | Path |
|--------|------|
| Modify | `admin-web/src/pages/SumsubEventsPage.tsx` |

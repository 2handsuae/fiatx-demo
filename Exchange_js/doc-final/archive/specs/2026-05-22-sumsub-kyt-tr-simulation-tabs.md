# Sumsub Events — KYT & Travel Rule Simulation Tabs

> **Scope:** Backend endpoint update + frontend tab additions to SumsubEventsPage
> **Goal:** Allow operators to simulate KYT and Travel Rule gate passage by depositNo from the Sumsub Events page, triggering deposit auto-approval when all gates pass.

---

## 1. Backend Changes

### Endpoint: `POST /admin/sumsub/simulate/kyt-check`

Add `depositNo` as an alternative lookup parameter alongside existing `txHash`.

**Updated body:**
```typescript
{
  depositNo?: string;   // NEW — lookup deposit by business key
  txHash?: string;      // existing — lookup deposit by txHash
  result: 'PASS' | 'FAIL';
  riskScore?: number;
}
```

**Lookup logic:**
1. If `depositNo` provided → `findFirst({ where: { depositNo } })`
2. Else if `txHash` provided → `findFirst({ where: { txHash } })` (existing behavior)
3. Neither → `BadRequestException('depositNo or txHash is required')`
4. Not found → `NotFoundException`

Post-lookup behavior unchanged: `updateKytStatus()` → `checkAutoApproval()`.

### Endpoint: `POST /admin/sumsub/simulate/tr-check`

Same pattern — add `depositNo` as alternative lookup.

**Updated body:**
```typescript
{
  depositNo?: string;   // NEW
  txHash?: string;      // existing
  result: 'PASS' | 'FAIL';
}
```

Same lookup logic as kyt-check. Post-lookup behavior unchanged: `updateTravelRuleStatus()` → `checkAutoApproval()`.

---

## 2. Frontend Changes

### File: `admin-web/src/pages/SumsubEventsPage.tsx`

**SimTab type extension:**
```typescript
type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation' | 'kyt' | 'travelRule';
```

**New state:**
```typescript
const [simDepositNo, setSimDepositNo] = useState('');
```

This state is shared between both tabs — when the operator enters a depositNo on the KYT tab, switching to the Travel Rule tab retains the value.

### KYT Check Tab

- Tab label: `KYT Check`
- Input: `depositNo` text field (placeholder: "DEP-…")
- Button: `Simulate KYT PASS` (calls `POST /admin/sumsub/simulate/kyt-check` with `{ depositNo, result: 'PASS' }`)
- Success message: `"KYT check simulated: PASSED for {depositNo}"`
- Error: displayed in existing `simError` state

### Travel Rule Tab

- Tab label: `Travel Rule`
- Input: same shared `simDepositNo` field (placeholder: "DEP-…")
- Button: `Simulate TR PASS` (calls `POST /admin/sumsub/simulate/tr-check` with `{ depositNo, result: 'PASS' }`)
- Success message: `"Travel Rule check simulated: PASSED for {depositNo}"`
- Error: same pattern

### Tab Rendering

Both tabs follow the existing simulation tab pattern:
1. Descriptive hint text explaining what the simulation does
2. Input field for depositNo
3. Action button

KYT hint: `"Simulate a KYT (Know Your Transaction) check PASS for a deposit. After both KYT and Travel Rule pass, the deposit auto-approves."`

Travel Rule hint: `"Simulate a Travel Rule check PASS for a deposit. After both KYT and Travel Rule pass, the deposit auto-approves."`

### handleSimulate Extension

Add two new branches to the existing `handleSimulate` function:

```typescript
} else if (simTab === 'kyt') {
  if (!simDepositNo.trim()) { setSimError('Deposit No is required'); return; }
  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/kyt-check`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }) },
  );
  // ... error handling, setMessage, close modal
} else if (simTab === 'travelRule') {
  if (!simDepositNo.trim()) { setSimError('Deposit No is required'); return; }
  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/tr-check`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }) },
  );
  // ... same pattern
}
```

---

## 3. Operator Workflow

```
1. Open Sumsub Events → click "Simulate Event"
2. Switch to "KYT Check" tab → enter depositNo → click "Simulate KYT PASS"
   → Banner: "KYT check simulated: PASSED for DEP-xxx"
3. Switch to "Travel Rule" tab → depositNo already filled → click "Simulate TR PASS"
   → Banner: "Travel Rule check simulated: PASSED for DEP-xxx"
4. Backend checkAutoApproval() fires after each call.
   After step 3, all 3 gates pass → deposit transitions to SUCCESS automatically.
```

---

## 4. Non-Goals

- No FAIL simulation button (only PASS for now)
- No changes to `checkAutoApproval()` logic
- No changes to Deposit Detail page (existing compliance gate display already reflects updated status on refresh)
- No new shared components needed

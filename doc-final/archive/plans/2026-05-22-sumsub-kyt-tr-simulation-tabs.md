# KYT & Travel Rule Simulation Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add depositNo-based KYT and Travel Rule simulation to the Sumsub Events page so operators can pass compliance gates without curl/Postman.

**Architecture:** Backend endpoints gain a `depositNo` alternative to `txHash` for deposit lookup. Frontend adds two tabs to the existing simulation modal, sharing a `depositNo` input and calling the updated endpoints with `result: 'PASS'`.

**Tech Stack:** NestJS (backend controller), React + Tailwind (frontend page)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Modify (lines 349–425) | Add `depositNo` lookup to `kyt-check` and `tr-check` endpoints |
| `admin-web/src/pages/SumsubEventsPage.tsx` | Modify | Add `kyt` and `travelRule` tabs, `simDepositNo` state, handleSimulate branches |

---

### Task 1: Backend — Add depositNo parameter to kyt-check and tr-check

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts:349-425`

- [ ] **Step 1: Update the `simulateKytCheck` method to accept depositNo**

In `admin-sumsub-simulation.controller.ts`, replace the existing `simulateKytCheck` method (lines 349–387) with:

```typescript
@Post('kyt-check')
@ApiOperation({ summary: 'Simulate KYT (Know Your Transaction) check result' })
async simulateKytCheck(
  @Req() req: any,
  @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL'; riskScore?: number },
) {
  this.ensureAdmin(req);

  if (!body.depositNo && !body.txHash) {
    throw new BadRequestException('depositNo or txHash is required');
  }
  if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const where = body.depositNo
    ? { depositNo: body.depositNo }
    : { txHash: body.txHash };
  const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
  if (!deposit) {
    throw new NotFoundException(
      body.depositNo
        ? `No deposit found with depositNo: ${body.depositNo}`
        : `No deposit found with txHash: ${body.txHash}`,
    );
  }

  const kytStatus = body.result === 'PASS' ? 'PASSED' : 'FAILED';
  await this.depositTransactionsService.updateKytStatus(
    deposit.id,
    kytStatus,
    body.riskScore ?? null,
  );

  await this.depositWorkflowService.checkAutoApproval(deposit.id);

  return {
    depositId: deposit.id,
    depositNo: deposit.depositNo,
    kytStatus,
    riskScore: body.riskScore ?? null,
    message: `KYT check simulated: ${kytStatus}`,
  };
}
```

- [ ] **Step 2: Update the `simulateTrCheck` method to accept depositNo**

Replace the existing `simulateTrCheck` method (lines 389–425) with:

```typescript
@Post('tr-check')
@ApiOperation({ summary: 'Simulate Travel Rule (TR) check result' })
async simulateTrCheck(
  @Req() req: any,
  @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL' },
) {
  this.ensureAdmin(req);

  if (!body.depositNo && !body.txHash) {
    throw new BadRequestException('depositNo or txHash is required');
  }
  if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const where = body.depositNo
    ? { depositNo: body.depositNo }
    : { txHash: body.txHash };
  const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
  if (!deposit) {
    throw new NotFoundException(
      body.depositNo
        ? `No deposit found with depositNo: ${body.depositNo}`
        : `No deposit found with txHash: ${body.txHash}`,
    );
  }

  const trStatus = body.result === 'PASS' ? 'PASSED' : 'FAILED';
  await this.depositTransactionsService.updateTravelRuleStatus(
    deposit.id,
    trStatus,
  );

  await this.depositWorkflowService.checkAutoApproval(deposit.id);

  return {
    depositId: deposit.id,
    depositNo: deposit.depositNo,
    travelRuleStatus: trStatus,
    message: `Travel Rule check simulated: ${trStatus}`,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts
git commit -m "feat(api): add depositNo parameter to kyt-check and tr-check simulation endpoints"
```

---

### Task 2: Frontend — Add KYT and Travel Rule simulation tabs

**Files:**
- Modify: `admin-web/src/pages/SumsubEventsPage.tsx`

- [ ] **Step 1: Extend SimTab type (line 48)**

Replace:
```typescript
type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation';
```

With:
```typescript
type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation' | 'kyt' | 'travelRule';
```

- [ ] **Step 2: Add simDepositNo state (after line 155, near other sim state)**

After the `const [simResult, setSimResult] = useState('');` line, add:

```typescript
// KYT / Travel Rule simulation — shared depositNo
const [simDepositNo, setSimDepositNo] = useState('');
```

- [ ] **Step 3: Add KYT and Travel Rule branches to handleSimulate (lines 243–244)**

Inside `handleSimulate`, after the `material` branch's closing brace (line 243, before `void fetchEvents(1, filters);`), add these two branches:

```typescript
} else if (simTab === 'kyt') {
  if (!simDepositNo.trim()) { setSimError('Deposit No is required'); setSimLoading(false); return; }
  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/kyt-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }),
    },
  );
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'KYT simulation failed.'));
  const res = await response.json();
  setShowSimulate(false);
  setMessage(`KYT check simulated: PASSED for ${res.depositNo ?? simDepositNo}`);
} else if (simTab === 'travelRule') {
  if (!simDepositNo.trim()) { setSimError('Deposit No is required'); setSimLoading(false); return; }
  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/tr-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositNo: simDepositNo, result: 'PASS' }),
    },
  );
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Travel Rule simulation failed.'));
  const res = await response.json();
  setShowSimulate(false);
  setMessage(`Travel Rule check simulated: PASSED for ${res.depositNo ?? simDepositNo}`);
}
```

- [ ] **Step 4: Add two tab entries to the tabs array (lines 450–456)**

Replace the existing tab array:
```typescript
{([
  { key: 'onboarding' as SimTab, label: 'Onboarding' },
  { key: 'material' as SimTab, label: 'Material Refresh' },
  { key: 'craSimulation' as SimTab, label: 'CRA Result' },
  { key: 'ongoingMonitoring' as SimTab, label: 'Ongoing Monitoring' },
  { key: 'level2Simulation' as SimTab, label: 'Level 2 Complete' },
]).map((tab) => (
```

With:
```typescript
{([
  { key: 'onboarding' as SimTab, label: 'Onboarding' },
  { key: 'material' as SimTab, label: 'Material Refresh' },
  { key: 'craSimulation' as SimTab, label: 'CRA Result' },
  { key: 'ongoingMonitoring' as SimTab, label: 'Ongoing Monitoring' },
  { key: 'level2Simulation' as SimTab, label: 'Level 2 Complete' },
  { key: 'kyt' as SimTab, label: 'KYT Check' },
  { key: 'travelRule' as SimTab, label: 'Travel Rule' },
]).map((tab) => (
```

- [ ] **Step 5: Add KYT tab content (after the level2Simulation block, around line 721)**

After the closing `)}` of the `{simTab === 'level2Simulation' && (` block (line 721), add:

```typescript
{/* KYT Check tab */}
{simTab === 'kyt' && (
  <div className="space-y-4">
    <p className="font-mono text-[10px] text-adm-t3">
      Simulate a KYT (Know Your Transaction) check PASS for a deposit.
      After both KYT and Travel Rule pass, the deposit auto-approves.
    </p>
    <div>
      <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Deposit No</label>
      <input
        value={simDepositNo}
        onChange={e => setSimDepositNo(e.target.value)}
        placeholder="DEP-…"
        className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
      />
    </div>
  </div>
)}
```

- [ ] **Step 6: Add Travel Rule tab content (right after the KYT block)**

```typescript
{/* Travel Rule tab */}
{simTab === 'travelRule' && (
  <div className="space-y-4">
    <p className="font-mono text-[10px] text-adm-t3">
      Simulate a Travel Rule check PASS for a deposit.
      After both KYT and Travel Rule pass, the deposit auto-approves.
    </p>
    <div>
      <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Deposit No</label>
      <input
        value={simDepositNo}
        onChange={e => setSimDepositNo(e.target.value)}
        placeholder="DEP-…"
        className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
      />
    </div>
  </div>
)}
```

- [ ] **Step 7: Update modal footer to include kyt/travelRule tabs (lines 737, 754)**

Replace the first footer condition (line 737):
```typescript
{(simTab === 'onboarding' || simTab === 'material') && (
```

With:
```typescript
{(simTab === 'onboarding' || simTab === 'material' || simTab === 'kyt' || simTab === 'travelRule') && (
```

Replace the Send Event button label (line 750):
```typescript
{simLoading ? 'Sending…' : 'Send Event'}
```

With:
```typescript
{simLoading ? 'Sending…' : simTab === 'kyt' ? 'Simulate KYT PASS' : simTab === 'travelRule' ? 'Simulate TR PASS' : 'Send Event'}
```

Replace the second footer condition (line 754):
```typescript
{(simTab === 'craSimulation' || simTab === 'ongoingMonitoring' || simTab === 'level2Simulation') && (
```

With (unchanged, just confirming no kyt/travelRule here):
```typescript
{(simTab === 'craSimulation' || simTab === 'ongoingMonitoring' || simTab === 'level2Simulation') && (
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/SumsubEventsPage.tsx
git commit -m "feat(admin): add KYT Check and Travel Rule simulation tabs to Sumsub Events page"
```

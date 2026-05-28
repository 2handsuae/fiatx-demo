# Admin Withdraw Pages Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign admin Withdraw Transaction list & detail pages to mirror Deposit pattern (3 gates + sidebar actions), plus 2 Sumsub simulation endpoints.

**Architecture:** Pure mirror of Deposit pages. New `withdrawActionMap.ts` for actions/badges. Backend adds 2 simulation endpoints to existing controller + wires them into existing `updateKytStatus`/`updateTravelRuleStatus` methods.

**Tech Stack:** React + TypeScript (admin-web), NestJS + Prisma (backend), existing shared components

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `admin-web/src/utils/withdrawActionMap.ts` | Action definitions, badge colors, gate style reuse |
| Rewrite | `admin-web/src/pages/WithdrawTransactionList.tsx` | List page mirroring Deposit |
| Rewrite | `admin-web/src/pages/WithdrawTransactionDetail.tsx` | Detail page with 3 gates + sidebar |
| Modify | `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Add 2 withdraw simulation endpoints |
| Modify | `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Add dispatch routing for withdraw KYT/TR events |
| Modify | `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` | Fix `findOne` to include `customer.complianceStatus` |

---

### Task 1: `withdrawActionMap.ts` — Action Definitions & Badge Colors

**Files:**
- Create: `admin-web/src/utils/withdrawActionMap.ts`

- [ ] **Step 1: Create the action map file**

```typescript
// admin-web/src/utils/withdrawActionMap.ts

/* ── Withdraw Action Map ────────────────────────────────────────
   State-machine-aware action availability for the Withdraw Detail
   sidebar. Mirrors depositActionMap.ts structure.
   ────────────────────────────────────────────────────────────── */

export interface WithdrawAction {
  action: string;
  label: string;
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
  requiresReason: boolean;
  enabledStatuses: Set<string>;
}

export const WITHDRAW_ACTIONS: WithdrawAction[] = [
  {
    action: 'approve',
    label: 'Approve',
    variant: 'workflowPrimary',
    requiresReason: false,
    enabledStatuses: new Set(['PENDING_APPROVAL']),
  },
  {
    action: 'freeze',
    label: 'Freeze',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['PENDING_COMPLIANCE', 'PENDING_APPROVAL']),
  },
  {
    action: 'resume',
    label: 'Resume',
    variant: 'workflowSecondary',
    requiresReason: false,
    enabledStatuses: new Set(['FROZEN']),
  },
  {
    action: 'reject',
    label: 'Reject',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['PENDING_COMPLIANCE', 'PENDING_APPROVAL']),
  },
  {
    action: 'cancel',
    label: 'Cancel',
    variant: 'workflowNegative',
    requiresReason: true,
    enabledStatuses: new Set(['CREATED']),
  },
];

const TERMINAL_STATUSES = new Set([
  'SUCCESS', 'REJECTED', 'CANCELLED', 'FAILED', 'RETURNED',
]);

export function getWithdrawActionsForStatus(
  currentStatus: string,
): Array<WithdrawAction & { enabled: boolean }> {
  const isTerminal = TERMINAL_STATUSES.has(currentStatus);
  return WITHDRAW_ACTIONS.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus),
  }));
}

/* ── Withdraw Status Badge Colors ────────────────────────────── */

const WITHDRAW_BADGE_MAP: Record<string, string> = {
  CREATED:              'bg-gray-100 text-gray-800',
  PENDING_COMPLIANCE:   'bg-purple-100 text-purple-800',
  PENDING_APPROVAL:     'bg-amber-100 text-amber-800',
  APPROVED:             'bg-blue-100 text-blue-800',
  PAYOUT_PENDING:       'bg-blue-100 text-blue-800',
  PROCESSING:           'bg-blue-100 text-blue-800',
  SUCCESS:              'bg-green-100 text-green-800',
  REJECTED:             'bg-red-100 text-red-800',
  CANCELLED:            'bg-red-100 text-red-800',
  FAILED:               'bg-orange-100 text-orange-800',
  FROZEN:               'bg-cyan-100 text-cyan-800',
  RETURNED:             'bg-red-100 text-red-800',
};

export function getWithdrawStatusBadgeClass(status: string): string {
  return WITHDRAW_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}
```

- [ ] **Step 2: Verify file created**

Run: `ls -la admin-web/src/utils/withdrawActionMap.ts`
Expected: file exists

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/withdrawActionMap.ts
git commit -m "feat(admin): add withdrawActionMap with actions and badge colors"
```

---

### Task 2: `WithdrawTransactionList.tsx` — Full Rewrite

**Files:**
- Rewrite: `admin-web/src/pages/WithdrawTransactionList.tsx`

**Reference:** Copy structure from `admin-web/src/pages/DepositTransactionList.tsx` (347 lines)

- [ ] **Step 1: Rewrite the list page**

Replace entire contents of `WithdrawTransactionList.tsx`. Mirror `DepositTransactionList.tsx` exactly but with these substitutions:

1. **Interface:** `WithdrawItem` with fields: `id`, `withdrawNo`, `ownerNo`, `ownerId`, `ownerType`, `status`, `amount`, `type` (nullable), `asset: { code, type, decimals? }`, `createdAt`
2. **FilterState:** `withdrawNo` (not `depositNo`), `ownerNo`, `status`, `type`, `startDate`, `endDate`
3. **WITHDRAW_STATUSES constant:**
```typescript
const WITHDRAW_STATUSES = [
  'CREATED', 'PENDING_COMPLIANCE', 'PENDING_APPROVAL', 'APPROVED',
  'PAYOUT_PENDING', 'PROCESSING', 'FROZEN',
  'SUCCESS', 'REJECTED', 'CANCELLED', 'FAILED', 'RETURNED',
];
```
4. **API endpoint:** `/withdraw-transactions` (not `/deposit-transactions`)
5. **Imports:** Use `getWithdrawStatusBadgeClass` from `../utils/withdrawActionMap` instead of `getDepositStatusBadgeClass`
6. **Navigation:** `/exchange/withdraw-transactions/${item.id}` for row click
7. **PageTitleBar:** title="Withdraw Transactions", meta uses "withdrawal" count
8. **Table columns:** Same 6 columns as deposit but header says "Withdraw No"
9. **Filter input placeholders:** "Withdraw No" and "Owner No"

The rest (PageTitleBar, filter bar, table structure, Pagination footer, loading/empty states, refresh button) is identical to Deposit.

- [ ] **Step 2: Verify build**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors related to WithdrawTransactionList

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WithdrawTransactionList.tsx
git commit -m "feat(admin): rewrite WithdrawTransactionList mirroring deposit pattern"
```

---

### Task 3: `WithdrawTransactionDetail.tsx` — Full Rewrite

**Files:**
- Rewrite: `admin-web/src/pages/WithdrawTransactionDetail.tsx`

**Reference:** Copy structure from `admin-web/src/pages/DepositTransactionDetail.tsx` (484 lines)

- [ ] **Step 1: Define the interface**

```typescript
interface WithdrawDetail {
  id: string;
  withdrawNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type?: string | null;
  status: string;
  assetId: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
  toWalletId: string | null;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  // KYT Phase 1 (pre-broadcast)
  preKytStatus: string;
  preKytRiskScore: number | null;
  preKytCheckedAt: string | null;
  // KYT Phase 2 (post-broadcast)
  kytStatus: string;
  kytRiskScore: number | null;
  kytCheckedAt: string | null;
  // Travel Rule
  travelRuleRequired: boolean;
  travelRuleStatus: string;
  travelRuleCheckedAt: string | null;
  // Timings
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  // Relations
  payoutId: string | null;
  payoutNo: string | null;
  traceId?: string | null;
  statusHistory: string | null;
  asset: { code: string; type: string; network: string | null; decimals: number };
  customer?: { complianceStatus?: string | null; customerNo?: string } | null;
  payout?: { payoutNo: string; status: string } | null;
}
```

- [ ] **Step 2: Rewrite the page component**

Full rewrite of `WithdrawTransactionDetail.tsx` mirroring `DepositTransactionDetail.tsx` structure:

**Imports:**
```typescript
import { getWithdrawActionsForStatus, getWithdrawStatusBadgeClass } from '../utils/withdrawActionMap';
import { getComplianceGateStyle } from '../utils/depositActionMap'; // reuse generic gate styling
```

**Sections (same order as deposit):**

1. **DetailPageHeader** — `onBack` → `/exchange/withdraw-transactions`, backLabel="Withdrawals"
2. **Hero** — `data.withdrawNo` (amber mono), Status badge, Amount, Type, Owner link
3. **Compliance Gates** — 3-column grid:
   - **Gate 0 · Customer**: `getComplianceGateStyle(data.customer?.complianceStatus)`, subtitle "Internal"
   - **Gate 1 · KYT**: Single card with TWO progress rows:
     ```tsx
     {/* Gate 1: KYT — two-stage progress in one card */}
     <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${kytGate.borderColor}`}>
       <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Gate 1 · KYT</div>
       <div className={`mt-1 text-sm font-bold ${kytGate.textColor}`}>{kytGate.label}</div>
       {/* Pre-broadcast row */}
       <div className="mt-2 flex items-center gap-2">
         <span className="font-mono text-[9px] text-adm-t3 w-24">Pre-broadcast:</span>
         <span className={`text-[11px] font-semibold ${getComplianceGateStyle(data.preKytStatus).textColor}`}>
           {data.preKytStatus}
         </span>
         <span className="font-mono text-[10px] text-adm-t3">
           Risk: {data.preKytRiskScore ?? '—'}
         </span>
       </div>
       {/* Post-broadcast row */}
       <div className="mt-1 flex items-center gap-2">
         <span className="font-mono text-[9px] text-adm-t3 w-24">Post-broadcast:</span>
         <span className={`text-[11px] font-semibold ${getComplianceGateStyle(data.kytStatus).textColor}`}>
           {data.kytStatus}
         </span>
         <span className="font-mono text-[10px] text-adm-t3">
           Risk: {data.kytRiskScore ?? '—'}
         </span>
       </div>
     </div>
     ```
   - **Gate 2 · Travel Rule**: Same as deposit
   - **KYT gate border color logic** — use the "worse" status:
     ```typescript
     const GATE_FAIL = new Set(['FAILED', 'REJECTED', 'SUSPENDED', 'BLOCKED']);
     const GATE_PENDING = new Set(['PENDING', 'CREATED', 'RECEIVED']);
     const worstKytStatus = GATE_FAIL.has(data.preKytStatus) || GATE_FAIL.has(data.kytStatus)
       ? (GATE_FAIL.has(data.preKytStatus) ? data.preKytStatus : data.kytStatus)
       : GATE_PENDING.has(data.preKytStatus) || GATE_PENDING.has(data.kytStatus)
         ? 'PENDING'
         : data.kytStatus;
     const kytGate = getComplianceGateStyle(worstKytStatus);
     ```

4. **Transaction Details** (DetailCard) — Asset, Amount, Fee, Net Amount, Destination Address (toAddress), From Wallet, Tx Hash, Reference No
5. **Linked Payout** (conditional) — `LinkedRelationCard` if `data.payoutNo`
6. **Status History** — `StatusTimeline` component (copy from deposit, adapt colors)
7. **Technical Detail** — Trace ID + raw JSON

**Sidebar (right 272px):**
- Actions group — `getWithdrawActionsForStatus(data.status)`, same button rendering as deposit
- Identity group — Withdraw No, Status (AdminBadge), Owner link, Owner Type, Asset
- Lifecycle group — Created, Approved (if approvedAt), Completed (if completedAt)

**Action handler:** `PATCH /withdraw-transactions/${id}/status` with `{ action, reason }` — same pattern as deposit's `PATCH /deposit-transactions/${id}/status`

**Reason modal:** Same as deposit — copy the modal JSX.

- [ ] **Step 3: Verify build**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors related to WithdrawTransactionDetail

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/WithdrawTransactionDetail.tsx
git commit -m "feat(admin): rewrite WithdrawTransactionDetail with 3 gates and sidebar actions"
```

---

### Task 4: Backend — Fix `findOne` Customer Relation

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` (line ~404)

The `findOne` method already includes `customer: true`, which returns all customer fields. But we need to verify the response includes `complianceStatus` for Gate 0 rendering.

- [ ] **Step 1: Check and fix findOne include**

Read `findOne` at line 404. It already does `include: { asset: true, customer: true, payout: true }`. The `customer: true` inclusion already returns `complianceStatus`. No change needed if this is the case.

If `customer` include is missing or doesn't include `complianceStatus`, add:
```typescript
customer: { select: { complianceStatus: true, customerNo: true } },
```

- [ ] **Step 2: Verify API response**

Run: `curl -s http://localhost:3500/withdraw-transactions/<some-id> -H "Authorization: Bearer <token>" | jq '.customer.complianceStatus'`
Expected: returns a complianceStatus value (e.g., "CLEAR")

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
git commit -m "fix(withdraw): ensure findOne includes customer.complianceStatus for Gate 0"
```

---

### Task 5: Backend — Simulation Endpoints

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

- [ ] **Step 1: Add withdraw-kyt simulation endpoint to controller**

Add after the existing `simulateTrCheck` method (around line 420):

```typescript
@Post('withdraw-kyt')
@ApiOperation({ summary: 'Simulate KYT check result for a withdraw transaction' })
async simulateWithdrawKytCheck(
  @Req() req: any,
  @Body() body: { withdrawNo: string; stage: 'PRE' | 'POST'; result: 'PASS' | 'FAIL'; riskScore?: number },
) {
  this.ensureAdmin(req);

  if (!body.withdrawNo) {
    throw new BadRequestException('withdrawNo is required');
  }
  if (!body.stage || !['PRE', 'POST'].includes(body.stage)) {
    throw new BadRequestException('stage must be PRE or POST');
  }
  if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const withdraw = await (this.prisma as any).withdrawTransaction.findFirst({
    where: { withdrawNo: body.withdrawNo },
  });
  if (!withdraw) {
    throw new NotFoundException(`No withdraw found with withdrawNo: ${body.withdrawNo}`);
  }

  const { event, dispatchResult } = await this.ingestionService.ingest(
    {
      type: 'withdrawKytCheckSimulated',
      externalUserId: withdraw.withdrawNo,
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo,
      stage: body.stage,
      result: body.result,
      riskScore: body.riskScore ?? null,
    },
    { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'WITHDRAW_KYT_CHECK' },
  );
  const dr = dispatchResult as any;
  return {
    withdrawId: withdraw.id,
    withdrawNo: withdraw.withdrawNo,
    stage: body.stage,
    kytStatus: dr?.kytStatus,
    riskScore: dr?.riskScore ?? null,
    message: `Withdraw KYT check simulated (${body.stage}): ${dr?.kytStatus}`,
    eventNo: event.eventNo,
  };
}
```

- [ ] **Step 2: Add withdraw-tr simulation endpoint to controller**

Add after the withdraw-kyt endpoint:

```typescript
@Post('withdraw-tr')
@ApiOperation({ summary: 'Simulate Travel Rule check result for a withdraw transaction' })
async simulateWithdrawTrCheck(
  @Req() req: any,
  @Body() body: { withdrawNo: string; result: 'PASS' | 'FAIL' },
) {
  this.ensureAdmin(req);

  if (!body.withdrawNo) {
    throw new BadRequestException('withdrawNo is required');
  }
  if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const withdraw = await (this.prisma as any).withdrawTransaction.findFirst({
    where: { withdrawNo: body.withdrawNo },
  });
  if (!withdraw) {
    throw new NotFoundException(`No withdraw found with withdrawNo: ${body.withdrawNo}`);
  }

  const { event, dispatchResult } = await this.ingestionService.ingest(
    {
      type: 'withdrawTravelRuleCheckSimulated',
      externalUserId: withdraw.withdrawNo,
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo,
      result: body.result,
    },
    { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'WITHDRAW_TR_CHECK' },
  );
  const dr = dispatchResult as any;
  return {
    withdrawId: withdraw.id,
    withdrawNo: withdraw.withdrawNo,
    travelRuleStatus: dr?.travelRuleStatus,
    message: `Withdraw TR check simulated: ${dr?.travelRuleStatus}`,
    eventNo: event.eventNo,
  };
}
```

- [ ] **Step 3: Add dispatch routing in `sumsub-ingestion.service.ts`**

In the `dispatch` method, add two new `else if` branches after the existing `travelRuleCheckSimulated` block (around line 122):

```typescript
} else if (event.eventType === 'withdrawKytCheckSimulated') {
  const withdrawId = String(payload.withdrawId ?? '');
  const stage = String(payload.stage ?? 'PRE');
  const kytStatus = String(payload.result) === 'PASS' ? 'PASSED' : 'FAILED';
  const riskScore = (payload.riskScore as number | null) ?? null;
  const phase = stage === 'PRE' ? 1 : 2;
  await this.withdrawService.updateKytStatus(withdrawId, kytStatus, null, riskScore, phase);
  result = { withdrawId, kytStatus, riskScore, phase };
  dispatchedContext = 'WITHDRAW_KYT_CHECK';
} else if (event.eventType === 'withdrawTravelRuleCheckSimulated') {
  const withdrawId = String(payload.withdrawId ?? '');
  const trStatus = String(payload.result) === 'PASS' ? 'PASSED' : 'FAILED';
  await this.withdrawService.updateTravelRuleStatus(withdrawId, trStatus, null);
  result = { withdrawId, travelRuleStatus: trStatus };
  dispatchedContext = 'WITHDRAW_TR_CHECK';
}
```

This requires `SumsubIngestionService` to have `withdrawService` injected. Check if it already has it; if not, add to constructor:
```typescript
private readonly withdrawService: WithdrawTransactionsService,
```
And add the import + module provider if needed.

- [ ] **Step 4: Verify build**

Run: `cd /path/to/Exchange_js && npx ts-node -e "console.log('compile check')"` or restart backend.
Expected: no compile errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "feat(simulation): add withdraw-kyt and withdraw-tr simulation endpoints"
```

---

### Task 6: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Restart backend**

Run: `npm run dev:start` (or restart the backend process)

- [ ] **Step 2: Verify list page**

Open `http://localhost:3501/exchange/withdraw-transactions` in the browser.
Expected: New list page with PageTitleBar, filter bar, table with 6 columns, Pagination footer, matching Deposit style.

- [ ] **Step 3: Verify detail page**

Click on a withdraw transaction row.
Expected:
- Hero section with withdrawNo, status badge, amount, type, owner
- 3 compliance gate cards (Customer/KYT/Travel Rule)
- Transaction Details card
- Linked Payout card (if applicable)
- Status History timeline
- Right sidebar with Actions, Identity, Lifecycle sections

- [ ] **Step 4: Verify action buttons**

Find a transaction in PENDING_COMPLIANCE status.
Expected: Approve button disabled, Freeze enabled, Reject enabled.
Find a transaction in PENDING_APPROVAL status.
Expected: Approve enabled (green), Freeze enabled, Reject enabled.

- [ ] **Step 5: Test simulation endpoints**

```bash
# Get admin token
TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r '.accessToken')

# Find a withdraw in PENDING_COMPLIANCE
WITHDRAW_NO=$(curl -s http://localhost:3500/withdraw-transactions -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].withdrawNo')

# Simulate KYT pre-broadcast
curl -s http://localhost:3500/admin/sumsub/simulate/withdraw-kyt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"withdrawNo\":\"$WITHDRAW_NO\",\"stage\":\"PRE\",\"result\":\"PASS\",\"riskScore\":15}"

# Simulate Travel Rule
curl -s http://localhost:3500/admin/sumsub/simulate/withdraw-tr \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"withdrawNo\":\"$WITHDRAW_NO\",\"result\":\"PASS\"}"
```

Expected: Both return success responses with updated status fields.

- [ ] **Step 6: Verify gate status update in UI**

Refresh the detail page after simulation.
Expected: Gate 1 KYT shows "PASSED" for pre-broadcast row with risk score 15. Gate 2 Travel Rule shows "PASSED".

- [ ] **Step 7: Commit verification notes (if any fixes needed)**

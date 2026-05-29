# Admin Payout Pages Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite admin Payout list & detail pages to mirror Payin pattern (adm-* design system, sidebar simulation controls). No compliance gates. No repair actions.

**Architecture:** Pure mirror of Payin pages. New `payoutActionMap.ts` for badges + simulation actions. Payout simulation uses existing `PATCH /payouts/:id/status` endpoint (not mock-event like Payin).

**Tech Stack:** React + TypeScript (admin-web), existing shared components, existing backend API

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `admin-web/src/utils/payoutActionMap.ts` | Badge colors + simulation actions by status |
| Rewrite | `admin-web/src/pages/PayoutList.tsx` | List page mirroring PayinList |
| Rewrite | `admin-web/src/pages/PayoutDetail.tsx` | Detail page mirroring PayinDetail with sidebar sim controls |

No backend changes required.

---

### Task 1: `payoutActionMap.ts` — Badge Colors & Simulation Actions

**Files:**
- Create: `admin-web/src/utils/payoutActionMap.ts`

- [ ] **Step 1: Create the file**

```typescript
// admin-web/src/utils/payoutActionMap.ts

/* ── Payout Status Badge Colors ──────────────────────────────── */

const PAYOUT_BADGE_MAP: Record<string, string> = {
  CREATED:      'bg-gray-100 text-gray-800',
  SIGNING:      'bg-amber-100 text-amber-800',
  BROADCASTED:  'bg-blue-100 text-blue-800',
  CONFIRMING:   'bg-amber-100 text-amber-800',
  CONFIRMED:    'bg-green-100 text-green-800',
  CLEARED:      'bg-green-100 text-green-800',
  FAILED:       'bg-red-100 text-red-800',
  TIMEOUT:      'bg-gray-100 text-gray-800',
  RETURNED:     'bg-red-100 text-red-800',
};

export function getPayoutStatusBadgeClass(status: string): string {
  return PAYOUT_BADGE_MAP[status.toUpperCase()] || 'bg-gray-100 text-gray-800';
}

/* ── Payout Simulation Action Map ───────────────────────────── */

export interface PayoutSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SIGN',             label: '⚡ Sign',              enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',        label: '⚡ Broadcast',         enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',        label: '⚡ Sign Fail',         enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL',  label: '⚡ Seen in Mempool',   enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',             label: '⚡ Drop',              enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',           enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',            label: '⚡ Clear (system)',     enabledStatuses: new Set(['CONFIRMED']) },
];

const FIAT_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SUBMIT',           label: '⚡ Submit',            enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM',          label: '⚡ Confirm',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',             label: '⚡ Fail',              enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT',          label: '⚡ Timeout',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',            label: '⚡ Clear (system)',     enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'RETURN',           label: '⚡ Return',            enabledStatuses: new Set(['CONFIRMED', 'CLEARED']) },
];

const PAYOUT_TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT', 'RETURNED']);

export function getPayoutSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayoutSimAction & { enabled: boolean }> {
  const isTerminal = PAYOUT_TERMINAL.has(currentStatus.toUpperCase());
  const actions = type.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}
```

- [ ] **Step 2: Verify file**

Run: `ls -la admin-web/src/utils/payoutActionMap.ts`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/payoutActionMap.ts
git commit -m "feat(admin): add payoutActionMap with badge colors and simulation actions"
```

---

### Task 2: `PayoutList.tsx` — Full Rewrite

**Files:**
- Rewrite: `admin-web/src/pages/PayoutList.tsx`

**Reference:** `admin-web/src/pages/PayinList.tsx` (344 lines)

- [ ] **Step 1: Read PayinList.tsx and current PayoutList.tsx**

- [ ] **Step 2: Rewrite PayoutList.tsx mirroring PayinList with these substitutions:**

| PayinList | PayoutList |
|-----------|-----------|
| `PayinItem` interface | `PayoutItem` interface |
| `payinNo` field | `payoutNo` field |
| `FilterState.payinNo` | `FilterState.payoutNo` |
| `PAYIN_STATUSES` | `PAYOUT_STATUSES` = `['CREATED','SIGNING','BROADCASTED','CONFIRMING','CONFIRMED','CLEARED','FAILED','TIMEOUT','RETURNED']` |
| API: `/treasury/payins` | API: `/payouts` |
| `getPayinStatusBadgeClass` | `getPayoutStatusBadgeClass` from `../utils/payoutActionMap` |
| Navigate: `/dashboard/treasury/payins/${id}` | Navigate: `/dashboard/treasury/payouts/${id}` |
| PageTitleBar title="Payin Transactions" | title="Payout Transactions" |
| Placeholder "Payin No" | "Payout No" |
| Count "payin/payins" | "payout/payouts" |
| Column "Deposit" showing `deposit.depositNo` | Column "Withdraw" showing `withdraw.withdrawNo` |
| Deposit link: `/exchange/deposit-transactions/${depositId}` | Withdraw link: `/exchange/withdraw-transactions/${withdrawId}` |

**PayoutItem interface:**
```typescript
interface PayoutItem {
  id: string;
  payoutNo: string;
  status: string;
  displayStatus?: string | null;
  type: string;
  amount: string;
  asset: { code: string; type: string; decimals?: number };
  txHash: string | null;
  withdrawId: string | null;
  transactionNo: string | null;
  withdraw?: { withdrawNo: string } | null;
  createdAt?: string;
}
```

**Filter params mapping** — the existing `GET /payouts` API accepts: `withdrawId`, `status`, `type`, `assetId`. For `payoutNo` and `txHash` text search, pass as query params — if the backend doesn't support them yet, do client-side filtering (same as Payin does for `type`).

**Key difference from Payin:** use `formatRailStatusLabel` for status display (same as Payin). Use `getPayoutStatusBadgeClass` for badge colors.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0 errors"`

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/PayoutList.tsx
git commit -m "feat(admin): rewrite PayoutList mirroring payin pattern"
```

---

### Task 3: `PayoutDetail.tsx` — Full Rewrite

**Files:**
- Rewrite: `admin-web/src/pages/PayoutDetail.tsx`

**Reference:** `admin-web/src/pages/PayinDetail.tsx` (475 lines)

- [ ] **Step 1: Read PayinDetail.tsx and current PayoutDetail.tsx**

- [ ] **Step 2: Rewrite PayoutDetail.tsx mirroring PayinDetail with payout-specific data**

**Interface:**
```typescript
interface PayoutDetailData {
  id: string;
  payoutNo: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  customer?: { customerNo: string; firstName: string | null; lastName: string | null };
  withdrawId: string | null;
  transactionNo: string | null;
  withdraw?: { withdrawNo: string } | null;
  type: string;
  status: string;
  displayStatus?: string | null;
  assetId: string;
  asset: { currency: string; code: string; type: string; network: string | null; decimals: number };
  amount: string;
  toWalletId: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  providerTxnId: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: string | null;
}
```

**Imports:**
```typescript
import { getPayoutStatusBadgeClass, getPayoutSimActionsForStatus } from '../utils/payoutActionMap';
import { useSimulationMode } from '../utils/simulationMode';
```

**Layout:** Same as PayinDetail — `flex h-full flex-col` → Header → Body (`flex min-h-0 flex-1 overflow-hidden`) with main + 272px sidebar.

**Main Sections (in order):**

1. **DetailPageHeader** — `onBack` → `/dashboard/treasury/payouts`, backLabel="Payouts"

2. **Hero** — payoutNo (amber mono), Status badge (`getPayoutStatusBadgeClass`), Amount, Type, Asset

3. **Chain Details** (DetailCard, 2 columns) — Same fields as Payin: Tx Hash (copyable + etherscan link), Confirmations, From Address, To Address, From IBAN, To IBAN, Reference No, Provider Txn ID

4. **Linked Withdraw** (conditional on `withdraw.withdrawNo` or `transactionNo`):
```tsx
{linkedWithdrawNo && (
  <div className="px-6 py-5">
    <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
      Linked Withdraw
    </h3>
    <LinkedRelationCard
      cap="Withdraw"
      identifier={linkedWithdrawNo}
      onClick={data.withdrawId
        ? () => navigate(`/exchange/withdraw-transactions/${data.withdrawId}`)
        : undefined
      }
    />
  </div>
)}
```

5. **Status History** — `PayoutTimeline` component (copy from PayinTimeline, update dot/badge color maps to include payout-specific statuses: SIGNING, BROADCASTED, TIMEOUT, RETURNED, CLEARED)

6. **Technical** — raw JSON

**Sidebar:**

- **Simulation Controls** (only when `simulationModeEnabled && simActions.length > 0`):
  - Same amber dashed-border styling as PayinDetail
  - Each button calls `PATCH /payouts/${id}/status` with `{ action: a.action }` (NOT mock-event like Payin)
  - Handler:
  ```typescript
  const handleSimAction = async (action: string) => {
    setSimSubmitting(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/payouts/${id}/status`,
        { method: 'PATCH', body: JSON.stringify({ action }) },
      );
      if (response.ok) {
        await fetchData(); // full refresh
      } else {
        alert(await getApiErrorMessage(response, 'Simulation failed'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Sim failed', error);
    } finally {
      setSimSubmitting(false);
    }
  };
  ```

- **Identity** — Payout No, Status (AdminBadge), Type, Asset, Owner (link), Withdraw (link)

- **Lifecycle** — Created, Sent (if sentAt), Completed (if completedAt)

**Timeline dot/badge color maps (PayoutTimeline):**
```typescript
const dotColor: Record<string, string> = {
  CREATED:      'bg-gray-300',
  SIGNING:      'bg-amber-500',
  BROADCASTED:  'bg-blue-500',
  CONFIRMING:   'bg-amber-500',
  CONFIRMED:    'bg-green-500',
  CLEARED:      'bg-green-500',
  FAILED:       'bg-red-500',
  TIMEOUT:      'bg-gray-500',
  RETURNED:     'bg-red-500',
};
const badgeCls: Record<string, string> = {
  CREATED:      'bg-gray-50 text-gray-700 border-gray-200',
  SIGNING:      'bg-amber-50 text-amber-700 border-amber-200',
  BROADCASTED:  'bg-blue-50 text-blue-700 border-blue-200',
  CONFIRMING:   'bg-amber-50 text-amber-700 border-amber-200',
  CONFIRMED:    'bg-green-50 text-green-700 border-green-200',
  CLEARED:      'bg-green-50 text-green-700 border-green-200',
  FAILED:       'bg-red-50 text-red-700 border-red-200',
  TIMEOUT:      'bg-gray-50 text-gray-700 border-gray-200',
  RETURNED:     'bg-red-50 text-red-700 border-red-200',
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0 errors"`

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/PayoutDetail.tsx
git commit -m "feat(admin): rewrite PayoutDetail mirroring payin with sidebar simulation"
```

---

### Task 4: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Verify list page**

Open `http://localhost:3501/dashboard/treasury/payouts`.
Expected: New list page with PageTitleBar, filter bar, 7-column table, footer count, adm-* design.

- [ ] **Step 2: Verify detail page**

Click a payout row.
Expected: Hero + Chain Details + Linked Withdraw + Status History + Technical. Sidebar with Identity + Lifecycle.

- [ ] **Step 3: Verify simulation controls**

Enable simulation mode (if toggle exists), check sidebar shows sim buttons appropriate to current payout status.

- [ ] **Step 4: Test simulation action**

Click a sim button (e.g., "Sign" for CREATED payout).
Expected: Status updates, page refreshes, simulation controls show next available actions.

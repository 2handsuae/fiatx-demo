# Admin Withdraw Transaction Pages Redesign

## Goal

Redesign the admin Withdraw Transaction list and detail pages to mirror the Deposit pattern: 3 compliance gates + right sidebar action buttons. Payout page is out of scope.

## Approach

**Pure mirror of Deposit** — copy Deposit's component structure, swap fields for Withdraw-specific data. No shared abstractions (YAGNI).

---

## 1. List Page — `WithdrawTransactionList.tsx`

Full rewrite mirroring `DepositTransactionList.tsx`.

### Columns

| Column | Field | Notes |
|--------|-------|-------|
| Withdraw No | `withdrawNo` | Link to detail, amber mono |
| Status | `status` | Badge with color mapping |
| Amount | `amount` + `asset.code` | Right-aligned, formatted by `asset.decimals` |
| Type | `type` or `asset.type` | CRYPTO=amber, FIAT=blue |
| Owner | `ownerNo` | Blue mono, links to customer detail |
| Created | `createdAt` | Formatted datetime |

### Filters

- `withdrawNo` — text input
- `ownerNo` — text input
- `status` — dropdown (all withdraw statuses)
- `type` — dropdown (ALL / CRYPTO / FIAT)
- `startDate` / `endDate` — date pickers
- Search + Reset buttons

### Withdraw Statuses

```
CREATED, PENDING_COMPLIANCE, PENDING_APPROVAL, APPROVED, PAYOUT_PENDING,
PROCESSING, SUCCESS, REJECTED, CANCELLED, FAILED, FROZEN, RETURNED
```

### Badge Color Mapping (`getWithdrawStatusBadgeClass`)

| Color | Statuses |
|-------|----------|
| green | `SUCCESS` |
| red | `REJECTED`, `CANCELLED`, `FAILED`, `RETURNED` |
| purple | `PENDING_COMPLIANCE` |
| amber | `PENDING_APPROVAL` |
| blue | `APPROVED`, `PROCESSING`, `PAYOUT_PENDING` |
| gray | `CREATED` |
| cyan | `FROZEN` |

### Pagination

Reuse `Pagination` component, `PAGE_SIZE = 20`, same footer pattern as Deposit.

---

## 2. Detail Page — `WithdrawTransactionDetail.tsx`

Full rewrite mirroring `DepositTransactionDetail.tsx`.

### Layout

Left main body + right 272px sidebar. Same `flex` layout as Deposit.

### 2.1 Hero Section

- `withdrawNo` — large amber mono
- Status badge (`getWithdrawStatusBadgeClass`)
- Amount + asset code
- Type (Crypto / Fiat)
- Owner (link to customer detail)

### 2.2 Compliance Gates (3-column grid)

**Gate 0 — Customer Compliance**
- Data: `customer.complianceStatus` (read from CustomerMain relation)
- Styling: `getComplianceGateStyle(data.customer?.complianceStatus)` — reuse from `depositActionMap.ts`
- Subtitle: "Internal"
- No Sumsub simulation — purely internal system check

**Gate 1 — KYT (Know Your Transaction)**
- **Single card with two-stage progress**:
  - **Pre-broadcast**: `preKytStatus`, `preKytRiskScore`, `preKytCheckedAt`
  - **Post-broadcast**: `kytStatus`, `kytRiskScore`, `kytCheckedAt`
- Styling: border color from `getComplianceGateStyle()` using the worse status (priority: FAIL > PENDING > PASS; if either is FAIL → red, if either is PENDING → amber, both PASS → green)
- Display: two rows inside one card, each with status label + risk score + checked timestamp
- If `preKytStatus` is PENDING and `kytStatus` is PENDING, show single "PENDING" state

**Gate 2 — Travel Rule**
- Data: `travelRuleRequired`, `travelRuleStatus`, `travelRuleCheckedAt`
- Styling: `getComplianceGateStyle(data.travelRuleRequired ? data.travelRuleStatus : null)`
- Shows "NOT REQUIRED" for non-crypto or when `travelRuleRequired === false`

### 2.3 Transaction Details Card

| Field | Source | Notes |
|-------|--------|-------|
| Asset | `asset.code · asset.type · asset.network` | |
| Amount | `amount` | Formatted, accented |
| Fee | `feeAmount` | Formatted |
| Net Amount | `netAmount` | Formatted, accented |
| Destination Address | `toAddress` | Copyable, mono (crypto only) |
| From Wallet | `fromWalletNo` | Mono |
| Tx Hash | `txHash` | Copyable, mono (crypto only) |
| Reference No | `referenceNo` | Mono |

### 2.4 Linked Payout (conditional)

If `payoutNo` exists, render `LinkedRelationCard` with:
- Cap: "Payout"
- Identifier: `payoutNo`
- Status: payout status (if available from response)
- Click: navigate to payout detail (placeholder route, payout page out of scope)

### 2.5 Status History Timeline

Reuse `StatusTimeline` component pattern from Deposit (parse `statusHistory` JSON). Timeline dot/badge colors adapted for withdraw statuses.

### 2.6 Technical Detail

- Trace ID display
- Raw status history JSON block

---

## 3. Sidebar

### 3.1 Actions (`SidebarGroup`)

Mirror Deposit's action pattern using `withdrawActionMap.ts`.

| Action | Variant | Requires Reason | Enabled Statuses |
|--------|---------|-----------------|------------------|
| `approve` | workflowPrimary | No | `PENDING_APPROVAL` |
| `freeze` | workflowSecondary | No | `PENDING_COMPLIANCE`, `PENDING_APPROVAL` |
| `resume` | workflowSecondary | No | `FROZEN` |
| `reject` | workflowNegative | Yes | `PENDING_COMPLIANCE`, `PENDING_APPROVAL` |
| `cancel` | workflowNegative | Yes | `CREATED` |

Terminal statuses (no actions): `SUCCESS`, `REJECTED`, `CANCELLED`, `FAILED`, `RETURNED`.

Action endpoint: `PATCH /withdraw-transactions/:id/status` with `{ action, reason }` — **already exists** in `WithdrawTransactionsController`.

### 3.2 Identity (`SidebarGroup`)

- Withdraw No
- Status (AdminBadge)
- Owner (link)
- Owner Type
- Asset

### 3.3 Lifecycle (`SidebarGroup`)

- Created
- Approved (if `approvedAt`)
- Completed (if `completedAt`)

### 3.4 Reason Modal

Same pattern as Deposit — modal with textarea, Cancel/Confirm buttons. Shown for actions with `requiresReason: true`.

---

## 4. New File: `withdrawActionMap.ts`

Mirror `depositActionMap.ts` structure:

- `WITHDRAW_ACTIONS` — array of `WithdrawAction` objects (same interface pattern as `DepositAction`)
- `getWithdrawActionsForStatus(status)` — returns actions annotated with `enabled: boolean`
- `getWithdrawStatusBadgeClass(status)` — badge color mapping
- Reuse `getComplianceGateStyle()` from `depositActionMap.ts` (already generic)

---

## 5. Backend: Sumsub Simulation Endpoints

Extend `AdminSumsubSimulationController` with **2 new endpoints** for withdraw:

### `POST /admin/sumsub/simulate/withdraw-kyt`

```typescript
Body: {
  withdrawNo: string;
  stage: 'PRE' | 'POST';  // PRE = pre-broadcast, POST = post-broadcast
  result: 'PASS' | 'FAIL';
  riskScore?: number;
}
```

- Look up WithdrawTransaction by `withdrawNo`
- Create `SumsubWebhookEvent` with `isSimulated: true`
- Dispatch to `WithdrawWorkflowService`:
  - `stage: 'PRE'` → update `preKytStatus`, `preKytRiskScore`, `preKytCheckedAt`
  - `stage: 'POST'` → update `kytStatus`, `kytRiskScore`, `kytCheckedAt`

### `POST /admin/sumsub/simulate/withdraw-tr`

```typescript
Body: {
  withdrawNo: string;
  result: 'PASS' | 'FAIL';
}
```

- Look up WithdrawTransaction by `withdrawNo`
- Create `SumsubWebhookEvent` with `isSimulated: true`
- Dispatch to `WithdrawWorkflowService`:
  - Update `travelRuleStatus`, `travelRuleCheckedAt`
  - If crypto: set `travelRuleRequired = true`

### Gate 0 — No Simulation Endpoint

Gate 0 reads `CustomerMain.complianceStatus` directly. No simulation needed — it's an internal system value already set during KYC onboarding.

### 3 Sumsub Events Satisfied

1. `withdraw-kyt` with `stage: 'PRE'` — pre-broadcast wallet+rules check
2. `withdraw-kyt` with `stage: 'POST'` — post-broadcast txHash enrichment
3. `withdraw-tr` — travel rule check

---

## 6. Backend: WithdrawWorkflowService Additions

Add two methods to handle simulation dispatch:

### `applyWithdrawKytResult(withdrawId, stage, result, riskScore)`

- Updates the inline fields (`preKytStatus`/`kytStatus` etc.)
- Creates/updates `KytCase` record via `TransactionComplianceService`
- Writes audit log event
- Calls `checkAutoApproval()` if applicable

### `applyWithdrawTrResult(withdrawId, result)`

- Updates `travelRuleStatus`, `travelRuleCheckedAt`
- Creates/updates `TravelRuleCase` record
- Writes audit log event
- Calls `checkAutoApproval()` if applicable

---

## 7. Backend: Detail API Enhancement

`GET /withdraw-transactions/:id` — ensure the response includes the `customer` relation for Gate 0:

```typescript
include: {
  asset: true,
  payout: true,
  customer: { select: { complianceStatus: true, customerNo: true } },
}
```

Currently the `findOne` method may not include the customer relation — verify and add if missing.

---

## 8. Scope

### In Scope
- ✅ `WithdrawTransactionList.tsx` — full rewrite
- ✅ `WithdrawTransactionDetail.tsx` — full rewrite with 3 gates + sidebar
- ✅ `withdrawActionMap.ts` — new file
- ✅ 2 simulation endpoints (`withdraw-kyt`, `withdraw-tr`)
- ✅ 2 workflow methods (`applyWithdrawKytResult`, `applyWithdrawTrResult`)
- ✅ Detail API enhancement (customer relation)

### Out of Scope
- ❌ Payout page / payout detail
- ❌ Shared component abstraction (Deposit + Withdraw)
- ❌ Client-side withdraw pages (already done)
- ❌ Gate 0 simulation endpoint (internal check)

# Admin Payout Pages Redesign — Design Spec

## Goal

Rewrite admin Payout list and detail pages to mirror the Payin pattern (adm-* design system, sidebar simulation controls). Focus on crypto payout. No compliance gates (payout is execution layer). No repair actions (out of scope).

## Scope

- ✅ `PayoutList.tsx` — full rewrite mirroring PayinList
- ✅ `PayoutDetail.tsx` — full rewrite mirroring PayinDetail
- ✅ `payoutActionMap.ts` — badge colors + simulation actions by status
- ❌ Compliance gates (not applicable — payout is pure execution)
- ❌ Repair actions (re-closeout / re-compensate — out of scope)
- ❌ Backend changes (existing API already sufficient)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Simulation controls placement | Sidebar | Mirror Payin pattern |
| Compliance gates | Not shown | Payout is execution layer; gates are on Withdraw |
| Repair actions | Out of scope | Deferred to future work |
| List filters | Mirror Payin | payoutNo, txHash, status, type, date range |

---

## List Page — `PayoutList.tsx`

### Columns

| Column | Field | Notes |
|--------|-------|-------|
| Payout No | `payoutNo` | Link to detail page |
| Status | `status` | Badge with color |
| Amount | `amount` + `asset.code` | Formatted |
| Type | `type` | crypto / fiat |
| Tx Hash | `txHash` | Truncated, copyable |
| Withdraw | `withdraw.withdrawNo` | Link to withdraw detail |
| Created | `createdAt` | Formatted time |

### Filters

- `payoutNo` — text input
- `txHash` — text input
- `status` — dropdown: CREATED, SIGNING, BROADCASTED, CONFIRMING, CONFIRMED, CLEARED, FAILED, TIMEOUT, RETURNED
- `type` — dropdown: Crypto / Fiat / All
- `startDate`, `endDate` — date pickers

### Badge Color Mapping

| Color | Statuses |
|-------|----------|
| green | CONFIRMED, CLEARED |
| red | FAILED, RETURNED |
| yellow | SIGNING, CONFIRMING |
| blue | BROADCASTED |
| gray | CREATED, TIMEOUT |

---

## Detail Page — `PayoutDetail.tsx`

### Layout

Left main + right 272px sidebar. Mirror PayinDetail structure.

### Left Main Sections

1. **DetailPageHeader** — `onBack` → `/treasury/payouts`, backLabel="Payouts"

2. **Hero** — payoutNo (amber mono), Status badge, Amount, Type, Asset code, Owner link

3. **Chain Details** (DetailCard, 2 columns):
   - Tx Hash (copyable, etherscan link)
   - Confirmations
   - To Address (copyable)
   - From Address (copyable)
   - To IBAN (fiat only)
   - From IBAN (fiat only)
   - Reference No (copyable)
   - Provider Txn ID

4. **Linked Withdraw** — LinkedRelationCard, cap="Withdraw", shows withdrawNo + status, click navigates

5. **Status History** — StatusTimeline + AuditEventList (same pattern as Payin)

6. **Technical Detail** — Payout ID, Trace ID, raw JSON

### Right Sidebar

**Simulation Controls** (SidebarGroup):

| Current Status | Available Actions |
|---------------|-------------------|
| CREATED | Sign |
| SIGNING | Broadcast, Sign Fail |
| BROADCASTED | Seen in Mempool, Drop, Timeout |
| CONFIRMING | Confirm, Fail, Timeout |
| CONFIRMED | Clear |

Each button calls `PATCH /payouts/:id/status` with `{ action }`.

**Identity** (SidebarGroup):
- Payout No, Status (AdminBadge), Type, Asset, Owner (link), Withdraw (link)

**Lifecycle** (SidebarGroup):
- Created, Sent (if sentAt), Completed (if completedAt)

---

## New File: `payoutActionMap.ts`

Contains:
- `PayoutSimAction` interface — `{ action, label, variant, enabledStatuses }`
- `PAYOUT_SIM_ACTIONS` array — all crypto simulation actions mapped to source statuses
- `getPayoutSimActionsForStatus(status)` — returns actions with `enabled: boolean`
- `getPayoutStatusBadgeClass(status)` — badge color mapping

---

## Backend

No backend changes required. Existing endpoints cover all needs:
- `GET /payouts` — list with filters (withdrawId, status, type, assetId)
- `GET /payouts/:id` — detail with includes (asset, withdraw, customer, clearings, audit logs)
- `PATCH /payouts/:id/status` — status transition with action validation

Note: the list API currently filters by `withdrawId` not `payoutNo` or `txHash`. If these filters are needed server-side, a minor backend tweak to the `findAll` query may be required. Otherwise, client-side filtering on the returned results is acceptable for the current data volume.

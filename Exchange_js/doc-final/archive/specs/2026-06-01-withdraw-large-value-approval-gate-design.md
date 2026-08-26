# Withdraw Large-Value Approval Gate — Design

Date: 2026-06-01
Scope: V5 (Withdrawal) — add an executive approval gate before the L2 compliance screen.
Status: Approved (design), pending implementation plan.

---

## 1. Goal & Decisions

Add a senior-management approval gate to the **withdrawal** flow for high-value withdrawals.

| Item | Decision |
|---|---|
| Scope | **Withdrawal only.** Swap (V6) is explicitly out of scope — see §7. |
| Threshold | Withdrawal **gross** amount valued in AED **≥ 200,000 AED** |
| Valuation rate | `BinanceRateProvider.fetchRate(assetCurrency, 'AED')` (already supports the AED/USD peg 3.6725 and USDT routing — no new rate source) |
| Rate-fetch failure | **Fail-closed** → route to approval (cannot prove it is under threshold ⇒ treat as over) |
| Approver | `SENIOR_MANAGEMENT_OFFICER` (SMO), **single step**, 48h timeout |
| Placement | Approval resolves **before** `PENDING_COMPLIANCE` — i.e. approve first, then run the L2 compliance screen |
| Threshold storage | Named constant `WITHDRAW_APPROVAL_AED_THRESHOLD = 200000` (MVP). Config-governance deferred to ADVANCED. |

The comparison is `>=` (a withdrawal valued at exactly 200,000 AED triggers approval).

---

## 2. State Machine

Reuse the existing `CREATED` initial state; insert one new state `PENDING_APPROVAL` ahead of compliance.

```
create()  → CREATED                  (TB pending lock + WITHDRAW_REQUESTED audit, emits WITHDRAWAL_CREATED)
   │
   │  [workflow valuates: grossAed = amount × Binance(assetCurrency→AED); fail-closed]
   │
   ├─ < 200K AED ──→ PENDING_COMPLIANCE ──→ L2 Transaction Screen ──→ … (today's path, unchanged)
   │
   └─ ≥ 200K AED ──→ PENDING_APPROVAL
                         │   open SMO approval case (WITHDRAW_LARGE_VALUE_APPROVAL)
                         ├─ SMO APPROVED      ──→ PENDING_COMPLIANCE ──→ L2 … (merges with small-value path)
                         └─ DECLINED/EXPIRED/CANCELLED ──→ REJECTED  (void TB pending → unlock balance)
```

New transitions added to `WithdrawTransactionsService.transitions`:

| From | Action | To |
|---|---|---|
| `CREATED` | `REQUIRE_APPROVAL` | `PENDING_APPROVAL` |
| `CREATED` | `CHECK` (existing) | `PENDING_COMPLIANCE` |
| `PENDING_APPROVAL` | `GATE_APPROVE` | `PENDING_COMPLIANCE` |
| `PENDING_APPROVAL` | `REJECT` | `REJECTED` |
| `PENDING_APPROVAL` | `CANCEL` | `CANCELLED` |

`GATE_APPROVE` is a distinct action from the existing `APPROVE` (which means `PENDING_COMPLIANCE → PAYOUT_PENDING`); reusing `APPROVE` here would overload one action across two semantically different transitions.

---

## 3. Three-Layer Placement (backend-platform rules)

### Domain Service — `WithdrawTransactionsService`
- Add `PENDING_APPROVAL` status and the transitions in §2.
- `create()` now persists the record in the **`CREATED`** state (no longer hardcodes `PENDING_COMPLIANCE`). TB pending lock and the `WITHDRAW_REQUESTED` audit are unchanged; still emits `WITHDRAWAL_CREATED`.
- Persist the valuation snapshot fields written by the workflow (see §4).
- **Must NOT** call `BinanceRateProvider`, `ApprovalsService`, or `AccountingService` for flow decisions — those are cross-module flow logic and belong in the workflow. The reject **status transition** (`PENDING_APPROVAL → REJECTED`) lives here; the TB void itself is orchestrated by the workflow (§3 Workflow).

### Workflow — `WithdrawWorkflowService`
- `handleWithdrawalCreated` (existing `@OnEvent(WITHDRAWAL_CREATED)`) becomes the **branch point**:
  1. Valuate: `grossAed = amount × fetchRate(asset.currency,'AED').rate`. On throw → treat as `≥ threshold` (fail-closed).
  2. Write valuation snapshot to the record (§4).
  3. `grossAed ≥ 200000` (or fetch failed) → transition `CREATED → REQUIRE_APPROVAL → PENDING_APPROVAL`, then `approvalsService.createAndSubmit({ actionType: WITHDRAW_LARGE_VALUE_APPROVAL, entityRef: withdrawId, traceId, objectSnapshot })`, link the case to the withdrawal, write `WITHDRAW_APPROVAL_REQUESTED` audit.
  4. else → transition `CREATED → CHECK → PENDING_COMPLIANCE`, then `initializeTransactionScreen` (today's behaviour).
  - **Idempotency**: guard on current status so an event replay does not double-open an approval case or double-run L2. If the record is no longer `CREATED`, return.
- New `@OnEvent('workflow.withdraw-large-value-approval.decided')`:
  - `APPROVED` → `GATE_APPROVE` (→ `PENDING_COMPLIANCE`) → `initializeTransactionScreen` → `WITHDRAW_APPROVAL_GRANTED` audit.
  - `DECLINED` / `EXPIRED` / `CANCELLED` → `REJECT` (→ `REJECTED`) → void TB pending → `WITHDRAW_APPROVAL_DECLINED` audit.
  - Guard on `PENDING_APPROVAL` status for idempotency.

### Approval Sub-Workflow — `WithdrawLargeValueApprovalService`
- `extends ApprovalHandlerBase`; provides only the constants:
  - `actionType = ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL`
  - `workflowType = AuditBusinessWorkflowTypes.WITHDRAW_LARGE_VALUE_APPROVAL`
- New `ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL`.
- New `DEFAULT_APPROVAL_POLICIES[WITHDRAW_LARGE_VALUE_APPROVAL] = { steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48 }`.
- New `AuditBusinessWorkflowTypes.WITHDRAW_LARGE_VALUE_APPROVAL` — its kebab form yields the secondary decided event `workflow.withdraw-large-value-approval.decided` (the base re-emits `governance.approval.{approved,rejected,cancelled,expired}` → secondary event filtered by `actionType`).

The SMO decision is recorded through the **existing Approval Center** (it emits `governance.approval.approved/rejected`). No new approval-action API or UI.

---

## 4. Valuation Evidence Snapshot

Stored on the `WithdrawTransaction` record for audit/replay (VARA: approval decisions must be auditable):

| Field | Meaning |
|---|---|
| `grossAedValue` | `amount × aedRate` at submission |
| `aedRate` | Binance `assetCurrency → AED` rate used |
| `rateFetchedAt` | when the rate was fetched |
| `rateFetchFailed` | boolean; true when fail-closed routed to approval without a rate |

For a fiat withdrawal already in AED, `fetchRate('AED','AED') = 1` (the peg divides then multiplies back), so `grossAedValue = amount`.

---

## 5. Funds, Audit, UX

- **Funds**: TB pending lock stays at `create()` time — balance is reserved throughout the approval wait. The reject path voids the pending transfers (existing compensation).
- **Audit actions** (new, traceId threaded end-to-end): `WITHDRAW_APPROVAL_REQUESTED` → `WITHDRAW_APPROVAL_GRANTED` | `WITHDRAW_APPROVAL_DECLINED`.
- **Admin UI**: SMO approves via the existing Approval Center. The Withdraw detail page gains an "Approval Gate" card showing `approvalNo`, gate status, and the AED valuation (gross AED, rate, fetched-at / fail flag).
- **Client UI**: `PENDING_APPROVAL` maps via the existing tipping-off-safe pattern to a calm "Under review" / "Processing" state. No compliance internals exposed.

---

## 6. Known Trade-off

During a Binance outage, fail-closed routes **even small withdrawals** into the SMO approval queue. This is the accepted cost of choosing fail-closed over fail-open; it favors never letting a large withdrawal slip the gate.

---

## 7. Out of Scope — Swap (V6)

A swap approval gate was considered and **deliberately dropped**:
- Funds never leave the platform during a swap; the only egress (withdrawal) is already gated, so a swap AML gate is largely redundant.
- The intent for a swap gate would have been **treasury / position-risk authorization**, not AML — but the team chose not to build it this round.
- Adding a blocking gate would break the swap's synchronous-atomic model and create a 30s-quote-vs-approval-window staleness problem.

If treasury visibility into large swaps is wanted later, the lightweight path is a **non-blocking post-trade large-swap flag/notification** that does not touch the atomic settlement path. Not in this round.

---

## 8. Delivery Checklist (per backend-platform §Version Sign-off)

- [ ] Audit coverage: `WITHDRAW_APPROVAL_REQUESTED/GRANTED/DECLINED` written via `AuditLogsService`, traceId threaded.
- [ ] Approval SoD: `WITHDRAW_LARGE_VALUE_APPROVAL` policy step config + SMO role + 48h timeout defined; no implicit self-approval.
- [ ] RBAC: SMO mapped to decide this approval action type.
- [ ] State machine: `PENDING_APPROVAL` + new transitions documented and enforced; invalid transitions rejected.
- [ ] Idempotency: `handleWithdrawalCreated` and the decided handler guard on current status (no double-open / double-L2 on replay).
- [ ] Repair surface: reject/expire path voids TB pending; compensation narrower than the happy path.
- [ ] Read model: Withdraw detail exposes approval gate fields + valuation snapshot.
- [ ] Tests: small-value path unchanged; large-value → approval → compliance; reject → void + REJECTED; fail-closed routes to approval.

# Phase C (Redesign): Swap Transaction Workflow — Synchronous, Three-Layer Compliant

## Overview

Rebuild the swap transaction flow as a **synchronous, atomic, eligibility-gated** operation that conforms to the backend three-layer architecture (`doc-final/rules/backend-platform.md`). Replace the broken legacy structure (orchestrator writing Prisma directly, a state-machine sub-workflow, and a synchronous risk-bridge compliance path that is inconsistent with the rest of the platform).

**Core insight:** A swap is an internal balance exchange. No funds leave the platform, there is no external counterparty, and there is no Sumsub/KYT/Travel-Rule screening. The only compliance gate is **L1 Eligibility** — the customer's platform-internal status — checked synchronously before creation. If eligibility fails, no swap is created. A persisted swap is therefore always `SUCCESS`.

This is fundamentally different from withdrawal (which is async, Sumsub-webhook-driven, with KYT + Travel Rule gates because funds leave the platform).

**Scope:** Domain service (1), workflow service (1 new), controllers (2), module wiring (1), schema (1), risk-engine cleanup (cross-module), TB transfer codes (1). Deletions: orchestrator, state-machine workflow, swap risk-bridge path.

---

## 1. Architecture — Two Clean Layers

### L1 Domain Service — `swap-transactions.service.ts`

Owns the SwapTransaction entity, data operations, and invariants.

**Methods:**
- `create(input, tx): SwapTransaction` — creates the entity (status `SUCCESS`). Accepts `tx`. NO audit logs, NO cross-entity orchestration.
- `findAll(query)` — list (existing)
- `findOne(id)` — detail (existing)
- `getExecutableRate(...)` — pricing read (existing)
- `preview(...)` — pricing read (existing)

**Invariants declared:**
1. Allowed status: only `SUCCESS` (terminal-on-create). No transitions.
2. Uniqueness: `swapNo` unique, `quoteId` unique (one swap per quote).
3. Preconditions before `create()`: caller must have passed eligibility, consumed the quote, and completed TB accounting within the same `tx`.

### L3 Workflow — `swap-workflow.service.ts` (NEW)

Single synchronous journey. Replaces both the orchestrator and the state-machine sub-workflow.

**Method:** `executeSwap(ownerId: string, quoteId: string): Promise<SwapResult>`

Orchestration sequence:
1. **Eligibility gate** — `onboardingService.assertTradingEligibility(ownerId, 'SWAP')` + `ensureCustomerCanTransact(customer)`. Throws `ForbiddenException` if blocked → no swap created.
2. **Prisma `$transaction`:**
   a. `swapQuoteService.getActiveQuoteOrThrow(quoteId, 'CUSTOMER', ownerId, now, tx)`
   b. `swapQuoteService.consumeQuote(quoteId, 'CUSTOMER', ownerId, amount, tx)`
   c. TB accounting — three pending transfers (see §3)
   d. `swapTransactionsService.create({...}, tx)` with status `SUCCESS` + TB refs + traceId
   e. `outstandingsService.createForSwapSuccess(tx, swap)`
   f. TB post all three pending transfers
   g. Business audit log (`SWAP_CREATED` / `SWAP_SUCCESS`) via `auditLogsService.recordByActor`
3. **Compensation** — on any failure: `voidPendingTransferBestEffort` for each created pending transfer; rethrow.

**Responsibilities (per rules):** writes ALL business audit logs, threads `traceId` from journey start, calls `AccountingService` directly and synchronously, never writes the SwapTransaction Prisma table directly (goes through L1 `create`).

### Controllers

- **Customer** (`swap-transactions-customer.controller.ts`): `create` → `swapWorkflowService.executeSwap(ownerId, dto.quoteId)`. Remove the inline `assertTradingEligibility` call (moved into L3). Keep quote create/cancel and reads.
- **Admin** (`swap-transactions.controller.ts`): read-only — `findAll`, `findOne`, swap-quote queries. **Remove `updateStatus`** (no transitions exist).

---

## 2. Compliance Model

| Gate | Mechanism | Timing | On fail |
|------|-----------|--------|---------|
| L1 Eligibility | `assertTradingEligibility(customerId, 'SWAP')` — checks `onboardingStatus===APPROVED && adminStatus===ACTIVE && complianceStatus!==FROZEN` | Synchronous, before creation | `ForbiddenException`, no swap record |

No Sumsub. No KYT. No Travel Rule. No async screening. No risk-bridge. No `PENDING_COMPLIANCE` / `UNDER_REVIEW` / `REJECTED` states.

---

## 3. TigerBeetle Accounting

All legs route through `TRADE_CLEARING` regardless of asset type (crypto/fiat). Settlement of `TRADE_CLEARING → CUSTODY/BANK` is handled by the Outstanding settlement pipeline (out of scope).

### Transfer codes (`tb-transfer-codes.constant.ts`)

```typescript
// Swap (30–34)
SWAP_CREDIT_TO_CLEARING_PENDING: 30,  // from-leg lock
SWAP_CREDIT_TO_CLEARING_POST: 31,     // from-leg confirm
SWAP_CREDIT_TO_CLEARING_VOID: 32,     // from-leg release (compensation)
SWAP_CLEARING_TO_CREDIT: 33,          // to-leg credit (+ its pending/post)
SWAP_CLEARING_TO_FEE: 34,             // fee (+ its pending/post)
```

### Sequence (inside the Prisma `$transaction`)

For `USDT → AED` (from-leg ledger = USDT, to-leg ledger = AED):

```
1. executePendingTransfer: CLIENT_CREDIT(USDT) → TRADE_CLEARING(USDT), fromAmount   [from-lock]
2. executePendingTransfer: TRADE_CLEARING(AED) → CLIENT_CREDIT(AED), netToAmount     [to-credit]
3. executePendingTransfer: TRADE_CLEARING(AED) → FEE_RECEIVABLE(AED), feeAmount      [fee] (if fee > 0)
   → store the three transfer IDs on the swap record
4. postPendingTransfer × 3  → customer balances settle immediately
```

For `AED → USDT`, the same logic applies with ledgers swapped — no asset-type branching in code; ledger resolved from currency via `TB_LEDGERS`.

**Balance check is implicit:** if step 1 exceeds the customer's available balance, TB rejects it → the transaction throws → no swap record.

**Ledger resolution:** `TB_LEDGERS[assetCurrency]`; throw `BadRequestException` if unsupported.

**Compensation:** if the Prisma transaction throws after any pending transfer is created, `voidPendingTransferBestEffort` each one. Residual gap (post succeeds, Prisma commit fails) is covered by deterministic transfer IDs + the reconciliation pipeline.

---

## 4. Schema Changes (SwapTransaction)

**Add:**
```prisma
tbFromTransferId  String?   // from-leg pending/posted transfer ID
tbToTransferId    String?   // to-leg transfer ID
tbFeeTransferId   String?   // fee transfer ID (null if no fee)
traceId           String?   // journey trace ID
```

**Deprecate (leave nullable; remove in a later cleanup after confirming no external readers):**
`riskDecisionRef`, `alertId`, `caseId`, `failureCode`, `failureReason`, `statusHistory` — these belonged to the removed review/state-machine model.

`status` stays; persisted records are always `SUCCESS`.

---

## 5. Cross-Module Cleanup (risk-engine)

Remove the swap-specific synchronous compliance path:
- `TransactionComplianceService.evaluateSwapFinalReview()` — delete
- `TransactionRiskBridgeService.handleSwapFinalReview()` and `clearSwapIfApproved()` (swap path) — delete
- `WorkflowTransitionService` ModuleRef lookup of `SwapTransactionWorkflowService` — delete the swap branch

Withdrawal-side usage of these services is untouched. Only swap-specific methods are removed.

---

## 6. State Model

```
Customer executeSwap
  ├─ eligibility fail        → ForbiddenException (no record)
  ├─ quote invalid/expired   → BadRequestException (no record)
  ├─ insufficient balance    → TB rejects (no record)
  ├─ accounting/system error → rollback + void pending (no record)
  └─ all succeed             → SwapTransaction(SUCCESS)
```

A persisted swap is immutable and final. Post-hoc corrections are separate compensating transactions, not status changes.

`SwapTransactionStatus` enum reduces to `SUCCESS` (and `FAILED` retained only as a defensive constant; never persisted in the happy design). Remove `PENDING_COMPLIANCE`, `UNDER_REVIEW`, `REJECTED` usage. `SwapTransactionAction` enum and `swap-events` for rejected/failed become unused.

---

## 7. Files

### Create
| File | Responsibility |
|------|----------------|
| `swap-transactions/swap-workflow.service.ts` | L3 synchronous journey orchestration |

### Modify
| File | Change |
|------|--------|
| `swap-transactions/swap-transactions.service.ts` | Add L1 `create(input, tx)` |
| `swap-transactions/swap-transactions-customer.controller.ts` | `create` → `swapWorkflowService.executeSwap`; remove inline eligibility |
| `swap-transactions/swap-transactions.controller.ts` | Remove `updateStatus` |
| `swap-transactions/swap-transactions.module.ts` | Add TigerBeetleModule, OnboardingModule; provide SwapWorkflowService; drop risk-bridge wiring |
| `swap-transactions/dto/swap-transaction.dto.ts` | Trim status/action enums |
| `accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` | Add swap codes 30–34 |
| `prisma/schema.prisma` | Add TB ref + traceId fields |
| `risk-engine/transaction-compliance/transaction-compliance.service.ts` | Remove `evaluateSwapFinalReview` |
| `risk-engine/transaction-compliance/transaction-risk-bridge.service.ts` | Remove swap final-review path |
| `identity/onboarding/workflow-transition.service.ts` | Remove swap ModuleRef branch |

### Delete
| File | Reason |
|------|--------|
| `swap-transactions/swap-workflow.orchestrator.ts` | Replaced by SwapWorkflowService |
| `swap-transactions/swap-transaction-workflow.service.ts` | State machine no longer needed |

---

## 8. What Is NOT Changing

- SwapQuoteService — done in Phase B
- Outstanding creation (`createForSwapSuccess`) — reused
- Outstanding → CUSTODY/BANK settlement pipeline — separate, out of scope
- Withdrawal / deposit compliance flows — untouched
- SwapFeeLevel admin pages, Swap Quote admin pages — untouched
- Customer two-step UX (create quote → execute swap from quote) — preserved

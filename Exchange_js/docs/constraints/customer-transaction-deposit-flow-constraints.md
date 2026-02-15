# Customer Transaction Deposit Flow Constraints

## 1) Scope and Ownership
- MUST limit scope to customer deposit workflow only.
- MUST cover these routes/modules:
1. `/treasury/payins/*`
2. `/deposit-transactions/*`
3. `DepositWorkflowService`
4. `DepositTransactionsService`
5. `JournalsService`
6. `TransactionComplianceService`
- MUST NOT treat this document as swap/withdraw workflow guidance.

## 2) Canonical Trigger Path
- MUST use `PATCH /treasury/payins/:id/status` with `action=confirm` as the canonical customer deposit trigger.
- MUST treat `PATCH /deposit-transactions/:id/status` with `action=payin_confirmed` as manual/compensation operation only.
- MUST NOT replace canonical payin orchestration with direct deposit status patching in normal customer flow.

## 3) Reset Baseline Preconditions
- MUST verify workflow behavior on reset baseline from `npm run dev:reset`.
- MUST keep meaning of `dev:reset`: reset business data only; preserve base configuration.
- MUST require active accounting config baseline for deposit confirmed flow:
1. `EVT_DEPOSIT_CONFIRMED__FIAT`
2. `EVT_DEPOSIT_CONFIRMED__CRYPTO`
3. matching active journal templates for both event codes
- MUST keep runtime ports/env aligned with runtime constraints (`3000/3001/3002` and `VITE_API_URL`/backend env contract).

## 4) State Machine Contract
- MUST keep payin transition path for confirmed flow:
1. `DETECTED` or `CONFIRMING`
2. `CONFIRMED`
3. `CLEARED`
- MUST keep deposit transition path for confirmed flow:
1. `PAYIN_PENDING`
2. `COMPLIANCE_PENDING`
3. terminal progression through `SUCCESS` or `UNDER_REVIEW` or `REJECTED` or `FAILED`
- MUST NOT skip `COMPLIANCE_PENDING` when the payin confirmed orchestration is used.

## 5) Payin Confirmed Orchestration Contract
- MUST execute these ordered effects after payin is confirmed:
1. move linked deposit to `COMPLIANCE_PENDING`
2. create/sync transaction compliance cases and snapshot
3. trigger deposit confirmed accounting event and post journal for `CUSTOMER` owner scope
4. set payin to `CLEARED` only after upstream orchestration steps complete
- MUST keep failures observable and diagnosable with logs, error responses, and audit records.
- MUST NOT silently swallow orchestration failures.

## 6) Accounting and Compliance Coupling
- MUST trigger deposit accounting on `toStatus=COMPLIANCE_PENDING` for `CUSTOMER` owner deposits in this flow.
- MUST treat missing accounting event/template match as configuration error, not as successful completion.
- MUST keep compliance snapshot lifecycle consistent with deposit status lifecycle to avoid status/snapshot drift.

## 7) Asynchronous Consistency Contract (Strong MUST)
- MUST acknowledge that confirm API response may show immediate state (`CONFIRMED`) while orchestration continues asynchronously.
- MUST require frontend final-state convergence after confirm (refresh and/or short polling) until `CLEARED` or explicit failure/timeout handling.
- MUST require user-visible in-progress status during convergence window to avoid false "not completed" interpretation.

## 8) Idempotency and Safety
- MUST make confirm action idempotent-safe in UI:
1. disable confirm button while submitting
2. prevent duplicate confirm clicks
- MUST keep orchestration idempotency so repeated events do not create duplicate journals or invalid clear operations.
- MUST preserve payin/deposit audit trail completeness for critical status transitions.

## 9) Public Contract Clarification (No API Shape Change)
- MUST keep API path and payload shape unchanged.
- MUST treat the following as public behavior contract:
1. `PATCH /treasury/payins/:id/status` with `action=confirm` means immediate response plus asynchronous convergence.
2. deposit target intermediate state in this flow is `COMPLIANCE_PENDING`.
3. accounting posting and payin clearing are coupled steps of the same orchestration chain.

## 10) Test Cases and Scenarios
- Reset baseline FIAT deposit: after confirm, deposit reaches `COMPLIANCE_PENDING`, journal exists, payin converges to `CLEARED`.
- Reset baseline CRYPTO deposit: same as FIAT with CRYPTO event suffix.
- Eventual consistency: confirm returns `CONFIRMED` first, then payin converges to `CLEARED` in short window.
- Config guardrail: if event/template is missing, failure is diagnosable and is not treated as successful flow completion.
- Non-customer owner path: should not apply customer deposit accounting template.
- Repeat safety: duplicate confirm attempts do not create duplicate journal entries.

## 11) Thread Delivery Checklist (Deposit)
- Canonical route entry usage confirmed.
- `COMPLIANCE_PENDING` reachability verified.
- Accounting event match and journal creation verified.
- Payin eventual auto-clear to `CLEARED` verified.
- Reset baseline revalidation completed.
- Frontend convergence and user-facing error/loading handling covered.

## 12) Assumptions and Defaults
- Language: English to stay consistent with existing constraints docs.
- Scope: deposit workflow only (no swap/withdraw expansion).
- This document defines constraints and behavior contract only; it does not mandate code refactor in this change.
- Asynchronous convergence requirements are `MUST`, not `SHOULD`.

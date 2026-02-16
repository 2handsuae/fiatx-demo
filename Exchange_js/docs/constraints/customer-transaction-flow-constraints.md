# Customer Transaction Flow Constraints

## 1) Scope and Ownership
- MUST cover customer transaction workflows only: deposit, swap, and withdraw.
- MUST apply to these modules and routes:
1. Deposit: `/treasury/payins/*`, `/deposit-transactions/*`, `DepositWorkflowService`, `DepositTransactionsService`
2. Swap: `/swap-transactions/*`, `SwapTransactionsService`, `SwapWorkflowOrchestrator`, `SwapQuotesService`
3. Withdraw: `/withdraw-transactions/*`, `/payouts/*`, `WithdrawTransactionsService`, `WithdrawWorkflowOrchestrator`, `PayoutsService`
4. Shared accounting/compliance: `JournalsService`, `TransactionComplianceService`
- MUST NOT use this document for LP liquidity-only workflows.

## 2) Canonical Entry Paths
- Deposit canonical trigger MUST be `PATCH /treasury/payins/:id/status` with `action=confirm`.
- Deposit `PATCH /deposit-transactions/:id/status` with `action=payin_confirmed` MUST be manual/compensation only.
- Swap customer price display MUST use `GET /swap-transactions/rate`.
- Swap order placement MUST use `POST /swap-transactions/quotes` then `POST /swap-transactions` with `quoteId`.
- Withdraw customer request MUST use `POST /withdraw-transactions`; payout progression MUST use `PATCH /payouts/:id/status`.

## 3) Reset Baseline Preconditions
- MUST validate behavior under reset baseline:
1. `npm run db:base:sync`
2. `npm run dev:reset`
- MUST keep `dev:reset` semantics: reset business data only, preserve base config.
- MUST require active accounting event/template matching for all critical states:
1. Deposit confirmed/success
2. Swap created/success/reject
3. Withdraw created/approved/success/failed/returned
- MUST keep runtime env/ports aligned with runtime constraints.

## 4) State Machine Contracts
- Deposit MUST follow:
1. `PAYIN_PENDING`
2. `COMPLIANCE_PENDING`
3. terminal progression (`SUCCESS` / `UNDER_REVIEW` / `REJECTED` / `FAILED`)
- Swap MUST follow quote-driven path:
1. rate polling (indicative)
2. `quote ACTIVE` within TTL
3. quote consume for swap create
4. swap terminal progression (`SUCCESS` / `REJECTED` / `FAILED`)
- Withdraw MUST follow:
1. `CREATED`
2. `PENDING_COMPLIANCE` or `UNDER_REVIEW`
3. `PAYOUT_PENDING`
4. terminal progression (`SUCCESS` / `FAILED` / `RETURNED` / `REJECTED` / `CANCELLED`)

## 5) Orchestration Ordering MUST
- Deposit confirmed orchestration MUST order:
1. move deposit to `COMPLIANCE_PENDING`
2. sync compliance case/snapshot
3. post accounting event
4. clear payin after upstream steps complete
- Swap execution MUST order:
1. resolve executable rate
2. generate firm quote snapshot
3. consume quote exactly once
4. create swap from quote snapshot
5. on success create dual outstandings (`OUT` + `IN`)
- Withdraw approved orchestration MUST order:
1. trigger clearing
2. post approved accounting
3. create/bind payout
4. MUST NOT run second withdraw approve transition
- Withdraw success path MUST order atomically:
1. withdraw -> `SUCCESS`
2. success accounting posting
3. payout -> `CLEAR`

## 6) Accounting and Compliance Coupling
- MUST treat missing event/template configuration as explicit failure, not success.
- MUST keep compliance status/snapshot and transaction status transitions consistent.
- MUST preserve owner scope coupling (`CUSTOMER` workflows use customer accounting contract).

## 7) Failure and Return Reversal Contract
- Withdraw `FAILED` and `RETURNED` MUST use source-level bulk reversal.
- Bulk reversal contract MUST be `BULK_REVERSAL_BY_SOURCE`:
1. enumerate original journals by `sourceType + sourceId`
2. skip already reversed journals
3. reverse each original event idempotently
- MUST ensure repeated fail/return events do not create duplicate reversals.

## 8) Asynchronous Consistency and UI Contract
- Frontend MUST treat confirm/execute responses as intermediate when orchestration is async.
- Frontend MUST implement convergence strategy:
1. short polling or refresh after action
2. in-progress status display
3. explicit failure/expired/used quote messaging
- Frontend MUST disable repeated submit during in-flight critical actions.

## 9) Idempotency and Audit Contract
- MUST keep deterministic orchestrator markers for idempotency checks.
- MUST preserve full audit chain for deposit/swap/withdraw and payout.
- MUST preserve `id + No` model:
1. internal linking by `id`
2. external/admin display by `No`
3. missing `No` display as `N/A`

## 10) Thread Delivery Checklist
- Deposit checklist:
1. canonical payin confirm route used
2. `COMPLIANCE_PENDING` reached
3. accounting posted
4. payin converged to `CLEARED`
- Swap checklist:
1. executable rate is config-driven
2. quote TTL and consume rules enforced
3. swap-from-quote consistency validated
4. success creates both outstandings
- Withdraw checklist:
1. approved flow has no double approve transition
2. payout confirmed atomic success path validated
3. failed/returned bulk reversal validated
4. repeated events remain idempotent

## 11) Public Contract Clarification (No API Shape Change)
- This document defines behavior contract; API schema/path changes are not required.
- Behavior MUST guarantee consistency across create, status transitions, accounting, and eventual settlement state.

## 12) Assumptions and Defaults
- Language: English (consistent with constraints folder style).
- Scope: customer transaction flows only (deposit/swap/withdraw).
- Security/auth hardening is out of scope unless explicitly required by a separate task.
- Async convergence and idempotency are strong MUST constraints.

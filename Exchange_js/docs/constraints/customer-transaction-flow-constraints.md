# Customer Transaction Flow Constraints

## 1) Scope and Ownership
- MUST cover customer transaction workflows only: deposit, swap, and withdraw.
- MUST apply to these modules and routes:
1. Deposit: `/treasury/payins/*`, `/deposit-transactions/*`, `DepositWorkflowService`, `DepositTransactionsService`
2. Swap: `/swap-transactions/*`, `SwapTransactionsService`, `SwapWorkflowOrchestrator`, `SwapQuotesService`, outstanding projection
3. Withdraw: `/withdraw-transactions/*`, `/payouts/*`, `WithdrawTransactionsService`, `WithdrawWorkflowOrchestrator`, `PayoutsService`
4. Shared accounting/compliance: `JournalsService`, `TransactionComplianceService`
- MUST NOT use this document for LP liquidity-only workflows.

## 2) Canonical Entry Paths
- Deposit canonical trigger MUST be `PATCH /treasury/payins/:id/status` with `action=confirm`.
- Deposit `PATCH /deposit-transactions/:id/status` with `action=payin_confirmed` MUST be manual/compensation only.
- Swap customer indicative price MUST use `GET /swap-transactions/rate`.
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

## 4) State Machine Contracts
- Deposit MUST follow:
1. `PAYIN_PENDING`
2. `COMPLIANCE_PENDING`
3. terminal progression (`SUCCESS` / `UNDER_REVIEW` / `REJECTED` / `FAILED`)
- Swap MUST follow quote-driven path:
1. rate polling (indicative)
2. `quote ACTIVE` within TTL
3. quote consume for swap create
4. terminal progression (`SUCCESS` / `REJECTED` / `FAILED`)
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

## 6) Swap Data Contract (UI + API)
- Swap API responses used by UI MUST include asset decimals for amount rendering:
1. transaction list/detail: `fromAsset.decimals`, `toAsset.decimals`
2. quote list/detail: `fromAsset.decimals`, `toAsset.decimals`
3. outstanding list/detail: `asset.decimals`
- Outstanding records MUST return `asset` relation for display (not only asset id/code).
- Missing `asset` or missing decimals in swap/outstanding response is considered a contract violation.

## 7) Swap Display Precision Contract
- Asset amount display in swap-related pages MUST use asset decimals from master data.
- Swap amount fields MUST be fixed to asset decimals (trailing zeros preserved).
- Swap rate fields MUST remain fixed 8 decimals.
- Decimal fallback policy MUST be `8` only when source decimals is missing/null.
- This precision policy applies to:
1. client swap page
2. admin swap transactions list/detail
3. admin swap quotes list/detail
4. admin swap outstanding list/detail

## 8) Accounting and Compliance Coupling
- MUST treat missing event/template configuration as explicit failure, not success.
- MUST keep compliance status/snapshot and transaction status transitions consistent.
- MUST preserve owner scope coupling (`CUSTOMER` workflows use customer accounting contract).

## 9) Failure and Return Reversal Contract
- Withdraw `FAILED` and `RETURNED` MUST use source-level bulk reversal.
- Bulk reversal contract MUST be `BULK_REVERSAL_BY_SOURCE`:
1. enumerate original journals by `sourceType + sourceId`
2. skip already reversed journals
3. reverse each original event idempotently
- MUST ensure repeated fail/return events do not create duplicate reversals.

## 10) Asynchronous Consistency and UI Contract
- Frontend MUST treat confirm/execute responses as intermediate when orchestration is async.
- Frontend MUST implement convergence strategy:
1. short polling or refresh after action
2. in-progress status display
3. explicit failure/expired/used quote messaging
- Frontend MUST disable repeated submit during in-flight critical actions.

## 11) Idempotency and Audit Contract
- MUST keep deterministic orchestrator markers for idempotency checks.
- MUST preserve full audit chain for deposit/swap/withdraw and payout.
- MUST preserve `id + No` model:
1. internal linking by `id`
2. external/admin display by `No`
3. missing `No` display as `N/A`

## 12) Quality Gate and Verification
- Precision regression gate MUST be executable via `npm run check:asset:decimals`.
- Verification MUST include:
1. swap/outstanding amount precision equals asset decimals
2. swap rates display at 8 decimals
3. outstanding responses include `asset.decimals`
4. deposit/withdraw behavior remains unchanged functionally after precision updates

## 13) Assumptions and Defaults
- Language: English (consistent with constraints folder style).
- Scope: customer transaction flows only (deposit/swap/withdraw).
- Security/auth hardening is out of scope unless explicitly required by a separate task.
- Async convergence and idempotency remain strong MUST constraints.

## 14) Transaction Compliance Case Boundary
- PRE-KYT/KYT/TRAVEL RULE MUST be treated as transaction evidence cases, not approval workflows.
- Transaction release/reject authority MUST stay in transaction state actions only:
1. withdraw/deposit/swap approve or reject actions
2. compliance case records are read-only evidence from provider callbacks
- Auto-case creation timing MUST follow:
1. `WITHDRAW` + `CRYPTO`: create `PRE-KYT` (`screeningStage=PRE_TXN`) immediately on withdraw `CREATED`
2. `DEPOSIT` + `CRYPTO`: create `MAIN-KYT` + `TRAVEL_RULE` on `payin CONFIRMED`
3. `WITHDRAW` + `CRYPTO`: create `MAIN-KYT` + `TRAVEL_RULE` on `payout CONFIRMED`
4. `FIAT` deposit/withdraw MUST NOT auto-create PRE-KYT
- The following callback upsert endpoints are the canonical production ingestion path:
1. `POST /admin/compliance/tx-kyt-cases/callback`
2. `POST /admin/compliance/tx-travel-rule-cases/callback`
- Callback idempotency MUST be enforced by provider reference + source scope:
1. KYT: `providerCaseId + sourceType + sourceId + screeningStage`
2. Travel Rule: `providerTransferId + sourceType + sourceId`
- Compliance detail retrieval MUST support aggregated source-level read model:
1. `GET /admin/compliance/tx-cases/:sourceType/:sourceId`
2. response includes `preKytCase`, `mainKytCase`, `travelRuleCase`, `derivedComplianceStatus`
- Withdraw approval gate contract MUST follow:
1. `CRYPTO` withdraw approve/success only checks `preKytStatus=PASS`
2. `FIAT` withdraw approve/success does not enforce PRE-KYT gate
- Manual override of provider case decision at case API level is forbidden in current phase.
- Admin Compliance Center MUST expose read-only pages:
1. `Tx Evidence Bundles`
2. `KYT Cases`
3. `Travel Rule Cases`

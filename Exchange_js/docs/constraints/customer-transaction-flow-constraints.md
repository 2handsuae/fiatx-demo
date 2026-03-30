# Customer Transaction Flow Constraints

## 1) Scope and Ownership
- MUST cover customer transaction workflows only: deposit, swap, and withdraw.
- MUST apply to these modules and routes:
1. Deposit: `/treasury/payins/*`, `/deposit-transactions/*`, `DepositWorkflowService`, `DepositTransactionsService`
2. Swap: `/swap-transactions/*`, `SwapTransactionsService`, `SwapWorkflowOrchestrator`, `PricingCenterService`, outstanding projection
3. Withdraw: `/withdraw-transactions/*`, `/payouts/*`, `WithdrawTransactionsService`, `WithdrawWorkflowOrchestrator`, `PayoutsService`
4. Shared accounting/compliance: `JournalsService`, `TransactionComplianceService`
- MUST NOT use this document for LP liquidity-only workflows.

## 2) Canonical Entry Paths
- Deposit customer-side inbound detection MUST use:
1. `GET /deposit-transactions/my/inbound-signals`
2. `POST /deposit-transactions/my/inbound-signals`
3. `POST /deposit-transactions/my/inbound-signals/scan`
- Deposit canonical trigger MUST be `PATCH /treasury/payins/:id/status` with `action=confirm`.
- Deposit `PATCH /deposit-transactions/:id/status` with `action=payin_confirmed` MUST be manual/compensation only.
- Swap customer indicative price MUST use `GET /swap-transactions/rate`.
- Swap order placement MUST use `POST /swap-transactions/quotes` then `POST /swap-transactions` with `quoteId`.
- Swap `PATCH /admin/swap-transactions/:id/status` with `action=success|reject|flag|fail` MUST be operator fallback/manual-compensation only.
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
4. swap create enters `PENDING_COMPLIANCE`
5. create pending `TX_SWAP_FINAL` decision record
6. Admin `Risk Policy Executions` simulates `LOW / MEDIUM / HIGH`
7. swap final review routes to `SUCCESS` or `UNDER_REVIEW`
8. terminal progression (`SUCCESS` / `REJECTED` / `FAILED`)
- Withdraw MUST follow:
1. quote create + second confirmation
2. withdraw create enters `PENDING_COMPLIANCE`
3. final-review driven progression to `UNDER_REVIEW` or `PAYOUT_PENDING`
4. terminal progression (`SUCCESS` / `FAILED` / `RETURNED` / `REJECTED` / `CANCELLED`)

## 5) Orchestration Ordering MUST
- Deposit confirmed orchestration MUST order:
1. optional inbound signal scan may create or reuse `PayIn`
2. canonical payin confirm moves deposit to `COMPLIANCE_PENDING`
3. for crypto payin, sync deposit-side `KYT` / `TRAVEL_RULE` evidence containers and derived lifecycle snapshot
4. when terminal screening states are ready, create pending `TX_DEPOSIT_FINAL` decision record
5. Admin `Risk Policy Executions` simulates `LOW / MEDIUM / HIGH`
6. post required confirmed accounting event
7. clear payin only after upstream steps complete and confirmed accounting succeeds
- Deposit workflow callback MUST order:
1. transaction hit creates or escalates alert/case first
2. workflow-bound callback may drive deposit only through canonical deposit actions
3. `FLAG` maps to deposit `flag`
4. `CLEAR` maps to deposit `success`
5. `REJECT` maps to deposit `reject`
- Deposit callback idempotency MUST ensure:
1. no duplicate `UNDER_REVIEW` write for repeated `FLAG`
2. no duplicate release/reject for repeated alert/case outcome
3. terminal `SUCCESS / REJECTED / FAILED` deposit ignores repeated callback writes
- Swap execution MUST order:
1. resolve executable rate
2. generate firm quote snapshot
3. consume quote exactly once
4. create swap from quote snapshot
5. post `EVT_SWAP_CREATED`
6. create pending `TX_SWAP_FINAL` decision record
7. Admin `Risk Policy Executions` simulates `LOW / MEDIUM / HIGH`
8. low risk clears to `SUCCESS`; medium/high enters `UNDER_REVIEW`
9. on success create dual outstandings (`OUT` + `IN`)
- Swap review resolution MUST order:
1. normal alert/case outcomes SHOULD drive swap through workflow-bound callback first
2. `PATCH /admin/swap-transactions/:id/status` is reserved for callback unavailable, repair, or operator compensation scenarios
3. fallback admin actions MUST still execute canonical swap workflow transitions and unified event execution
- Withdraw approved orchestration MUST order:
1. trigger clearing
2. post approved accounting
3. create/bind payout
4. MUST NOT run second withdraw approve transition
- Withdraw success path MUST order atomically:
1. withdraw -> `SUCCESS`
2. success accounting posting
3. payout -> `CLEARED`
- Withdraw terminal compensation MUST order canonically:
1. payout terminal status is already recorded on `Payout`
2. withdraw moves to target terminal business status if still missing
3. terminal accounting executes on `sourceType=WITHDRAW`
4. linked clearings close on `sourceType=WITHDRAWAL` with `clearingStatus=CANCELLED`
- `POST /payouts/:id/re-compensate` is the payout-root manual repair surface for terminal compensation replay only.

## 6) Swap Data Contract (UI + API)
- Swap API responses used by UI MUST include asset decimals for amount rendering:
1. transaction list/detail: `fromAsset.decimals`, `toAsset.decimals`
2. quote list/detail: `fromAsset.decimals`, `toAsset.decimals`
3. outstanding list/detail: `asset.decimals`
- Swap transaction / quote read models SHOULD also expose:
1. `quoteId`, `quoteNo`
2. `netToAmount`
3. `feeAmount`, `feeCurrency`
4. `riskDecisionRef`, `alertId`, `caseId`
5. `failureCode`, `failureReason`
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
- Deposit required accounting points MUST remain:
1. `payin.confirmed -> deposit COMPLIANCE_PENDING`
2. `deposit.success -> deposit SUCCESS`
- Required deposit accounting points MUST NOT silently skip when:
1. event config is missing or inactive
2. journal template is missing
3. posting returns `null`
4. posting throws
- `DEPOSIT_ACCOUNTING_BLOCKED` MUST be the canonical block audit signal for the above failures.
- `payin.confirmed` accounting block MUST keep:
1. deposit at `COMPLIANCE_PENDING`
2. payin not cleared to `CLEARED`
- `deposit.success` accounting block MUST keep:
1. deposit status unchanged from the already-applied success transition
2. no fake `journalId` or fake accounting success audit
- Deposit reject path MUST NOT create a dedicated reject posting or reversal contract in current runtime truth.
- Swap created / success / reject / fail MUST route through unified event execution. Direct journal creation plus a second replay path is forbidden.
- Compliance modules MUST NOT write `swap.status` directly outside canonical swap workflow execution.
- Swap fallback admin actions MUST NOT bypass canonical workflow execution and MUST NOT introduce direct journal shortcuts.

## 8A) Swap Product Restriction And Evidence Contract
- Swap product restriction MUST be re-evaluated at:
1. quote creation
2. quote consumption
- Restriction failure MUST:
1. return machine-readable `restrictionCode`
2. write canonical audit log
- Swap evidence export MUST support replay by:
1. `swapId`
2. `quoteId`

## 9) Failure and Return Reversal Contract
- Withdraw `FAILED` and `RETURNED` MUST use source-level bulk reversal.
- Bulk reversal contract MUST be `BULK_REVERSAL_BY_SOURCE`:
1. enumerate original journals by `sourceType + sourceId`
2. skip already reversed journals
3. reverse each original event idempotently
- MUST ensure repeated fail/return events do not create duplicate reversals.
- Terminal withdraw accounting source pairing is fixed:
1. journal source = `WITHDRAW`
2. clearing source = `WITHDRAWAL`
- Canonical no-op for repeated fail/return replay requires all of the following:
1. payout already holds the same terminal outcome
2. withdraw already holds the mapped terminal business status
3. all original `WITHDRAW` journals already have reversal journals
4. all linked `WITHDRAWAL` clearings are already `CANCELLED`
- If any of the above is missing, replay MUST continue instead of silently skipping.

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

## 14) Transaction Compliance Evidence Container Boundary
- PRE-KYT/KYT/TRAVEL RULE MUST be treated as transaction evidence containers, not approval workflows and not the platform compliance `Case`.
- Provider response semantic roles are fixed:
1. `PRE-KYT` = wallet screening
2. `KYT` = transaction screening
3. `TRAVEL_RULE` = counterparty information exchange
- Transaction release/reject authority MUST stay in transaction state actions only:
1. withdraw/deposit/swap approve or reject actions
2. provider response records are read-only evidence from provider callbacks
- Auto-record creation timing MUST follow:
1. `WITHDRAW` + `CRYPTO`: create `PRE-KYT` + `TRAVEL_RULE` on withdraw create
2. `DEPOSIT` + `CRYPTO`: create `KYT` + `TRAVEL_RULE` on `payin CONFIRMED`
3. `WITHDRAW` + `CRYPTO`: create `KYT` on payout `CONFIRM`
4. `FIAT` deposit/withdraw MUST NOT auto-create response containers
- Provider response-to-transaction binding MUST remain on transaction identity (`sourceType=DEPOSIT|WITHDRAW`, `sourceId=<transactionId>`), while trigger origin (`payinId` / `payoutId` / `withdrawId`) is stored in report payload.
- The following callback upsert endpoints are the canonical production ingestion path:
1. `POST /admin/compliance/tx-kyt-cases/callback`
2. `POST /admin/compliance/tx-travel-rule-cases/callback`
- Callback idempotency MUST be enforced by provider reference + source scope:
1. KYT: `providerCaseId + sourceType + sourceId + screeningStage`
2. Travel Rule: `providerTransferId + sourceType + sourceId`
- Compliance detail retrieval MUST support aggregated source-level read model:
1. `GET /admin/compliance/tx-cases/:sourceType/:sourceId`
2. response includes `preKytCase`, `mainKytCase`, `travelRuleCase`, `derivedComplianceStatus`
- Withdraw release gate contract MUST follow:
1. new withdraw flow is final-review driven; `TX_WITHDRAW_FINAL` is the only active withdraw risk context
2. `CRYPTO` withdraw creates `Pre-KYT + Travel Rule` response containers at create time and `KYT` at `payout CONFIRM`, but these are evidence containers only and MUST NOT be treated as workflow truth
3. `FIAT` withdraw does not auto-create response containers and relies on the same final-review-driven business release path
4. withdraw quote create / withdraw create / payout dispatch start MUST all honor the shared extreme-volatility restriction gate when it is enabled in `WITHDRAWAL_PRICING`
5. extreme-volatility gate MUST NOT roll back already `CONFIRMED` payouts
- Withdraw workflow-bound callback contract MUST follow:
1. `CLEAR` is the only workflow disposition that may release active withdraw final review
2. `REJECT` may move withdraw into `REJECTED`
3. `FREEZE_TRANSACTION` may move withdraw into `UNDER_REVIEW`
4. `REPORT` / `STR` follow-up is evidence and governance trace only; it MUST NOT directly mutate withdraw status
5. historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` records may remain visible in audit / evidence / historical detail, but MUST NOT be used for new manual simulation or workflow resolution
- Manual override of provider response decision at the read-model API level is forbidden in current phase.
- Admin Compliance Center MUST expose read-only pages:
1. `Tx Evidence Bundles`
2. `KYT Cases` (legacy implementation label for provider response records)
3. `Travel Rule Cases` (legacy implementation label for provider response records)
- `Tx Evidence Bundles` page is the source-level read model and MUST:
1. aggregate one row per `sourceType + sourceId`
2. show `preKytCase` / `mainKytCase` / `travelRuleCase` + `derivedComplianceStatus`
3. provide navigation to provider response details only, without any approval action

## 15) Deposit Transaction Risk And Callback Contract
- `TX_DEPOSIT_FINAL` is the active deposit transaction risk context.
- Historical provider callback handlers may still ingest deposit-bound `KYT / TRAVEL_RULE` evidence updates, but they are compatibility ingestion paths, not the primary operator decision surface.
- Deposit transaction risk readiness MUST follow response lifecycle truth:
1. `KYT`: `CREATED | RECEIVED | FINAL`
2. `TRAVEL_RULE`: `CREATED | RECEIVED | FINAL`
3. only lifecycle `FINAL` is terminal-ready for final-review creation
- `KYT / TRAVEL_RULE` states `CREATED | RECEIVED` MUST sync evidence container and snapshot only; they MUST NOT be treated as final risk disposition.
- Transaction recommendation output for deposit MUST drive workflow-bound triage only through:
1. alert upsert
2. optional case escalation
3. canonical deposit callback action
- Business modules and compliance modules MUST NOT write `deposit.status` directly outside canonical deposit action execution.

## 16) Deposit Release Gate And Evidence Export Contract
- Deposit release to `SUCCESS` MUST pass:
1. `customer.onboardingStatus = APPROVED`
2. `customer.operatingStatus = ACTIVE`
3. `customer.restrictionStatus = CLEAR`
4. `customer.complianceHoldStatus = ACTIVE`
5. existing deposit compliance gate for `KYT / TRAVEL_RULE`
- Gate failure on workflow `CLEAR` MUST:
1. keep deposit in `COMPLIANCE_PENDING` or `UNDER_REVIEW`
2. write canonical release-blocked audit
3. avoid minting a fake success accounting outcome
- Deposit evidence export MUST be able to replay:
1. `InboundTransferSignal`
2. `PayIn`
3. `Deposit`
4. `KYT / TRAVEL_RULE`
5. `RiskDecisionRecord`
6. `Alert / Case`
7. `Journal`
8. `Internal Collection`
- Evidence export MUST preserve a chain that can resolve, at minimum:
1. `payinId -> depositId`
2. `depositId -> decisionRecordIds`
3. `depositId -> alertIds / caseIds`
4. `depositId -> journalIds`
5. `depositId -> internalTransactionIds / internalFundIds`

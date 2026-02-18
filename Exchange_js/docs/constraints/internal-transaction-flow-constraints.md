# Internal Transaction Flow Constraints

## 1) Scope and Intent
- MUST define constraints for internal treasury movements represented by:
1. `internal_transactions` (order layer)
2. `internal_funds` (fund-fact layer)
- MUST treat `internal_funds` as the smallest immutable movement fact (`from -> to -> amount/fee/net`).
- MUST keep relation `internal_transactions (1) : internal_funds (N)`.
- MUST keep this flow independent from customer deposit workflow implementation files.

## 2) Supported Scenario (Current Baseline)
- MUST support crypto collection from deposit address to platform master custody wallet.
- MUST trigger only when:
1. event: `deposit.status.changed`
2. `newStatus = SUCCESS`
3. `deposit.asset.type = CRYPTO`
- MUST skip FIAT deposits for internal collection.

## 3) Canonical Data Contract
- `internal_transactions` MUST keep:
1. external/admin identifier: `internalTxNo`
2. idempotency key: `(sourceType, sourceId, type)` unique
3. display/business status and aggregated amounts
- `internal_funds` MUST keep:
1. external/admin identifier: `internalFundNo`
2. blockchain transfer facts (`txHash`, confirmations, nonce/block/gas fields)
3. status machine and audit trail
- `internal_funds` MUST NOT introduce business `type`; movement semantics come from linked `internal_transaction`.

## 4) Type and Status Contracts
- Internal transaction type enum MUST remain:
1. `DEP_TO_MASTER`
2. `MASTER_TO_PAYOUT`
3. `PAYOUT_TO_MASTER`
4. `MASTER_TO_LIQ`
5. `LIQ_TO_MASTER`
6. `LIQ_TO_PAYOUT`
7. `PAYOUT_TO_LIQ`
8. `CLIENT_BANK_TO_LIQ_BANK`
9. `LIQ_BANK_TO_CLIENT_BANK`
- Collection scenario MUST use `DEP_TO_MASTER`.
- Internal transaction status MUST remain:
1. `INTERNAL_FUNDS_PENDING` (initial)
2. `SUCCESS`
3. `FAILED`
4. `CANCELLED`
- Internal fund status/action machine MUST follow `internal-funds.service.ts` transition map; ad-hoc transitions are forbidden.

## 5) Orchestration and Ordering
- Collection orchestration MUST run through `InternalCollectionWorkflowOrchestrator`.
- Creation sequence MUST be:
1. idempotency check by `(sourceType=DEPOSIT, sourceId, type=DEP_TO_MASTER)`
2. resolve `SYS_CUST_CRYPTO_MASTER_<CODE>_<NETWORK>` wallet (ownerType `CUSTOMER`, ownerId `NULL`)
3. create `internal_transaction` with status `INTERNAL_FUNDS_PENDING`
4. create one `internal_fund` with status `CREATED`
- MUST trigger created accounting event on internal transaction creation.
- Success sequence MUST be:
1. internal fund reaches `CONFIRMED`
2. aggregate internal transaction to `SUCCESS`
3. trigger clearing (`EVT_INTERNAL_TX_SUCCESS`)
4. trigger journal event for transaction success
5. auto-update confirmed internal fund(s) to `CLEAR`

## 6) Aggregation Rules (Funds -> Transaction)
- Transaction becomes `SUCCESS` when all funds are in `{CONFIRMED, CLEAR}`.
- Transaction becomes `FAILED` when at least one fund is `{FAILED, TIMEOUT}` and no progressing fund exists.
- Transaction becomes `CANCELLED` when all funds are `CANCELLED`.
- MUST be idempotent: if computed status equals current status, no event/clearing re-trigger.

## 7) Accounting and Clearing Contracts
- Event set MUST remain:
1. `EVT_INTERNAL_TX_CREATED`
2. `EVT_INTERNAL_TX_SUCCESS`
3. `EVT_INTERNAL_TX_FAILED`
4. `EVT_INTERNAL_TX_CANCELLED`
- `EVT_INTERNAL_TX_SUCCESS` MUST use clearing template `INTERNAL_TX_COLLECTION_V1`.
- Internal collection clearing template MUST always emit two lines:
1. `OUTGOING` with `netAmount`
2. `FEE` with `feeAmount` (line MUST exist even when fee is `0`)
- Journal templates MUST preserve wallet dimension tags (`walletId`) and ownerType derived from wallet (`fromWalletOwnerType`/`toWalletOwnerType`) for INTERNAL_TX postings.
- Internal collection COA baseline MUST include:
1. `A.CUSTODY`
2. `A.CUSTODY_IN_TRANSIT`
3. `E.NETWORK_FEE`

## 8) Wallet Baseline Dependency
- Base seed MUST provide active system wallets for each CRYPTO asset:
1. `SYS_CUST_CRYPTO_MASTER_<CODE>_<NETWORK>` (`ownerType=CUSTOMER`, `ownerId=NULL`)
2. `SYS_CUST_CRYPTO_PAYOUT_<CODE>_<NETWORK>` (`ownerType=CUSTOMER`, `ownerId=NULL`)
3. `SYS_PLATFORM_CRYPTO_LIQ_<CODE>_<NETWORK>` (`ownerType=PLATFORM`, `ownerId=NULL`)
- Missing master wallet MUST cause collection skip with explicit reason (not silent success).

## 9) Admin API and UI Contract
- Admin routes MUST remain:
1. `GET /admin/internal-transactions`
2. `GET /admin/internal-transactions/:id`
3. `GET /admin/internal-funds`
4. `GET /admin/internal-funds/:id`
5. `PATCH /admin/internal-funds/:id/status`
6. `POST /admin/internal-funds/mock`
- Menu placement MUST remain:
1. `Internal Transactions` under exchange/customer transaction group
2. `Internal Funds` under treasury group

## 10) Compatibility Constraints
- Withdraw DB `type` column remains removed; runtime branch selection derives from asset type.
- Internal transaction behavior changes MUST NOT reintroduce withdraw `type` persistence.

## 11) Reset and Verification Baseline
- Any flow change MUST be verified under:
1. `npm run db:base:sync`
2. `npm run db:biz:init` or `reset-main` script path
- Verification MUST include:
1. created event posting exists after transaction creation
2. success triggers both clearing and journals
3. FIAT deposit success does not create internal records
4. idempotent re-trigger does not duplicate records

## 12) Assumptions and Defaults
- Current productionized scope is crypto collection; additional internal routes are future extensions.
- Constraint language follows existing constraints folder style (English).
- This document is behavioral contract; API/path/schema expansion requires explicit owner approval.

# Internal Transaction Flow Constraints

## 1) Scope and Intent
- MUST define constraints for platform internal treasury movements represented by:
1. `internal_transactions` (order layer)
2. `internal_funds` (fund-fact layer)
- MUST treat `internal_funds` as the smallest movement fact (`from -> to -> amount/fee/net`).
- MUST keep relation `internal_transactions (1) : internal_funds (N)`.
- MUST keep internal workflow orchestration independent from customer deposit workflow files.

## 2) Supported Initiation Modes
- MUST support two internal initiation modes:
1. auto collection from deposit wallet to master wallet (`DEP_TO_MASTER`)
2. manual internal transfer submission from admin (`INTERNAL_MANUAL` source)
- Auto collection MUST trigger only on:
1. event: `deposit.status.changed`
2. `newStatus = SUCCESS`
3. `deposit.asset.type = CRYPTO`
- FIAT deposit MUST NOT trigger internal collection.

## 3) Canonical Data Contract
- `internal_transactions` MUST keep:
1. external/admin identifier: `internalTxNo`
2. idempotency key: `(sourceType, sourceId, type)` unique
3. status + approval status + aggregated amounts
4. approval/audit fields: `approvalStatus`, `makerUserId`, `checkerUserId`, `checkedAt`, `reviewReason`
- `internal_funds` MUST keep:
1. external/admin identifier: `internalFundNo`
2. transfer facts (`txHash`, confirmations, nonce/block/gas fields)
3. status history + audit trail
- `internal_funds` MUST NOT carry business `type`; movement semantics come from linked `internal_transaction`.

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
- Manual crypto creation whitelist MUST remain:
1. `MASTER_TO_LIQ`
2. `LIQ_TO_MASTER`
3. `MASTER_TO_PAYOUT`
4. `PAYOUT_TO_MASTER`
5. `LIQ_TO_PAYOUT`
6. `PAYOUT_TO_LIQ`
- Manual fiat creation whitelist MUST be enabled:
1. `CLIENT_BANK_TO_LIQ_BANK`
2. `LIQ_BANK_TO_CLIENT_BANK`
- Internal transaction status enum MUST remain:
1. `INTERNAL_FUNDS_PENDING` (initial)
2. `SUCCESS`
3. `FAILED`
4. `CANCELLED`
5. `REJECTED`
- Internal transaction approval status enum MUST remain:
1. `PENDING`
2. `APPROVED`
3. `REJECTED`
- Internal fund transition machine MUST follow `internal-funds.service.ts`; ad-hoc transitions are forbidden.

## 5) Wallet Routing and System Wallet Baseline
- Internal wallet routing MUST be role-based (`walletRole`) and type-mapped (`fromRole -> toRole`).
- System crypto wallets MUST be resolved by deterministic walletNo:
1. `buildCryptoSystemWalletNo('MASTER', code, network)`
2. `buildCryptoSystemWalletNo('PAYOUT', code, network)`
3. `buildCryptoSystemWalletNo('LIQ', code, network)`
- Fiat pool wallets MUST be resolved by deterministic walletNo:
1. `buildFiatPoolWalletNo('CUST_BANK', code)`
2. `buildFiatPoolWalletNo('LIQ_BANK', code)`
- System wallet owner contract MUST remain:
1. master/payout customer pool: `ownerType=CUSTOMER`, `ownerId=NULL`
2. platform liquidity pool: `ownerType=PLATFORM`, `ownerId=NULL`
- Missing required target wallet MUST be explicit skip/failure with reason; silent success is forbidden.

## 6) Orchestration and Ordering
- Auto collection ordering MUST be:
1. idempotency check by `(sourceType=DEPOSIT, sourceId, type=DEP_TO_MASTER)`
2. resolve master wallet
3. create `internal_transaction` with `status=INTERNAL_FUNDS_PENDING`
4. create initial `internal_fund` with `status=CREATED`
5. trigger created accounting event at transaction creation
- Manual submit ordering MUST be:
1. validate type whitelist + wallet role route + asset precision + wallet active
2. create `internal_transaction` with `status=INTERNAL_FUNDS_PENDING`, `approvalStatus=PENDING`
3. trigger created accounting event at transaction creation
4. MUST NOT create fund before review approve
- Manual review approve ordering MUST be:
1. validate `approvalStatus=PENDING`
2. set checker fields + `approvalStatus=APPROVED`
3. create first `internal_fund(status=CREATED)`
- Manual review reject ordering MUST be:
1. set transaction terminal status `REJECTED`
2. set `approvalStatus=REJECTED`
3. trigger asset-type aligned auto-reversal event:
   - CRYPTO: `EVT_INTERNAL_TX_REJECTED__CRYPTO`
   - FIAT: `EVT_INTERNAL_TX_REJECTED__FIAT`

## 7) Aggregation Rules (Funds -> Transaction)
- Transaction becomes `SUCCESS` when all linked funds are in `{CONFIRMED, CLEAR}`.
- Transaction becomes `FAILED` when at least one fund is `{FAILED, TIMEOUT}` and no progressing fund exists.
- Transaction becomes `CANCELLED` when all linked funds are `CANCELLED`.
- On success path MUST keep ordering:
1. aggregate transaction to `SUCCESS`
2. trigger success clearing + success journal event
3. auto-update confirmed fund(s) to `CLEAR`
- MUST be idempotent: if computed status equals current status, no duplicate event/clearing trigger.

## 8) Accounting and Clearing Contracts
- Event set MUST remain:
1. CRYPTO:
   - `EVT_INTERNAL_TX_CREATED__CRYPTO`
   - `EVT_INTERNAL_TX_SUCCESS__CRYPTO`
   - `EVT_INTERNAL_TX_FAILED__CRYPTO`
   - `EVT_INTERNAL_TX_CANCELLED__CRYPTO`
   - `EVT_INTERNAL_TX_REJECTED__CRYPTO`
2. FIAT:
   - `EVT_INTERNAL_TX_CREATED__FIAT`
   - `EVT_INTERNAL_TX_SUCCESS__FIAT`
   - `EVT_INTERNAL_TX_FAILED__FIAT`
   - `EVT_INTERNAL_TX_CANCELLED__FIAT`
   - `EVT_INTERNAL_TX_REJECTED__FIAT`
- Success events MUST use clearing template `INTERNAL_TX_COLLECTION_V1`:
1. `EVT_INTERNAL_TX_SUCCESS__CRYPTO`
2. `EVT_INTERNAL_TX_SUCCESS__FIAT`
- `INTERNAL_TX_COLLECTION_V1` MUST always emit 2 lines:
1. `OUTGOING` with `netAmount`
2. `FEE` with `feeAmount` (line MUST exist even when fee is `0`)
- Journal templates for INTERNAL_TX asset lines MUST include wallet dimension (`walletId`) and ownerType derived from from/to wallet.
- Internal collection COA baseline MUST include:
1. CRYPTO:
   - `A.CUSTODY`
   - `A.CUSTODY_IN_TRANSIT`
   - `E.NETWORK_FEE`
2. FIAT:
   - `A.BANK`
   - `A.BANK_IN_TRANSIT`
   - `E.BANK_FEE`

## 9) Admin API and UI Contract
- Admin routes MUST include:
1. `GET /admin/internal-transactions`
2. `GET /admin/internal-transactions/:id`
3. `POST /admin/internal-transactions` (manual submit)
4. `PATCH /admin/internal-transactions/:id/review` (approve/reject)
5. `GET /admin/internal-funds`
6. `GET /admin/internal-funds/:id`
7. `PATCH /admin/internal-funds/:id/status`
8. `POST /admin/internal-funds/mock`
- Menu placement MUST remain:
1. `Internal Transactions` under exchange/customer transaction group
2. `Internal Funds` under treasury group

## 10) Compatibility Constraints
- Withdraw DB `type` column remains removed; runtime branching derives from asset type.
- Internal transaction changes MUST NOT reintroduce withdraw `type` persistence.

## 11) Verification Baseline
- Any flow change MUST be verified under:
1. `npm run db:base:sync`
2. `npm run db:biz:init` (or reset script path)
- Verification MUST include:
1. auto collection creates tx/fund only for `SUCCESS + CRYPTO` deposit
2. manual submit creates tx only (no fund)
3. manual approve creates first fund
4. manual reject moves tx to `REJECTED` and reverses created posting
5. success triggers both clearing + journals and then auto-clears confirmed funds
6. idempotent re-trigger does not duplicate records

## 12) Assumptions and Defaults
- Constraint language is English (aligned with constraints folder style).
- Current default implementation enables fiat manual and outstanding-settlement routes only for `CUST_BANK <-> LIQ_BANK`.
- This document is behavioral contract; schema/path expansion requires explicit owner approval.

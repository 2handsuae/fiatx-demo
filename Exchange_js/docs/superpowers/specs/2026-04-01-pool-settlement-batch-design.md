# Pool Settlement Batch Design

Date: 2026-04-01
Status: Draft reviewed with user
Scope: `FeeOccurrence -> ReimbursementObligation -> PoolSettlementBatch -> InternalTransaction -> InternalFund`

## 1. Goal

Introduce a unified daily settlement batch for platform-to-customer and customer-to-platform pool flows.

This batch is responsible for:

- consuming all eligible open settlement sources
- netting opposite directions within the same asset and wallet pair
- submitting one shared approval case per batch
- creating post-approval execution transactions
- closing or releasing sources based on final execution outcome

This design intentionally does not change the source truth objects:

- `FeeOccurrence` remains the platform fee truth
- `ReimbursementObligation` remains the customer-pool reimbursement duty
- `Outstanding` remains the open settlement duty from upstream business flows

## 2. Non-Goals

This v1 does not include:

- execution-layer conflict or serialization checks between batches
- partial settlement of a single source row
- manual editing of batch composition after creation
- manual retry of failed items inside the same batch
- zero-net execution items
- storing settlement routing intent directly on source objects

## 3. Canonical Model

### 3.1 Source truth

The source layer stays unchanged in meaning:

- `FeeOccurrence`
  - platform fee fact
- `ReimbursementObligation`
  - created only when a `FeeOccurrence` hits a safeguarded pool
  - relationship is `FeeOccurrence 1 -> 0/1 ReimbursementObligation`
- `Outstanding`
  - open settlement duty from upstream business completion

### 3.2 Batch layer

Add a new unified batch family:

- `PoolSettlementBatch`
- `PoolSettlementBatchItem`
- `PoolSettlementBatchItemSource`

This family becomes the canonical settlement batch for:

- `OUTSTANDING`
- `REIMBURSEMENT_OBLIGATION`

The existing `OutstandingSettlement` family stays as historical or legacy logic and is not extended for this new design.

## 4. Core Design Decisions

### 4.1 Reimbursement creation

Not every `FeeOccurrence` creates a reimbursement.

Rule:

- if `FeeOccurrence.reimbursementImpact != SAFEGUARDED_POOL`
  - no reimbursement is created
- if `FeeOccurrence.reimbursementImpact == SAFEGUARDED_POOL`
  - exactly one `ReimbursementObligation` is created or maintained

### 4.2 Batch scope

Batch creation always snapshots all currently eligible open sources.

Rule:

- manual batch creation:
  - consume all currently `OPEN` and routable sources
- scheduled batch creation:
  - every day at `23:59`
  - consume all currently `OPEN` and routable sources

`cutoffAt` is always the actual creation timestamp of the batch.

If there are no eligible routable sources:

- no batch is created
- create request should fail fast

### 4.3 Source freezing

Batch creation immediately freezes included sources.

Rule:

- included sources are locked to the batch at creation time
- skipped sources remain `OPEN`
- after creation, batch composition cannot be manually changed

### 4.4 Routing derivation

Settlement routing is derived at batch creation time, not stored on source objects.

Rule:

- `Outstanding` and `ReimbursementObligation` remain business-truth objects
- `fromWalletId` and `toWalletId` are resolved by settlement rules when building the batch
- batch-local routing lives only in `PoolSettlementBatchItemSource`

### 4.5 Item grouping

Items are grouped by:

- `assetId`
- unordered `walletPair`

`A -> B` and `B -> A` belong to the same bucket.

Within a bucket:

- flows are netted by direction
- only non-zero net results create a `PoolSettlementBatchItem`
- zero-net buckets do not create items

### 4.6 Cross-family netting

Cross-family netting is allowed.

Rule:

- `OUTSTANDING`
- `REIMBURSEMENT_OBLIGATION`

can net against each other if they fall into the same:

- `assetId`
- unordered `walletPair`

Auditability is preserved by `PoolSettlementBatchItemSource`.

### 4.7 Approval model

Approval is batch-level, not item-level.

Rule:

- one `PoolSettlementBatch` creates one shared approval case
- item-level execution is blocked until batch approval passes
- `InternalTransaction` created from approved batch items does not require additional approval

### 4.8 Failure handling

Failure is tracked at batch history level and source release level separately.

Rule:

- batch may end as `PARTIAL_FAILED`
- failed item sources remain held until batch closeout
- on batch closeout:
  - successful sources are closed
  - netted sources are closed
  - failed sources are released back to `OPEN`

### 4.9 Multiple open batches

Multiple unfinished batches are allowed.

Rule:

- source locking prevents duplicate inclusion
- new open sources can enter later batches
- v1 does not add execution-layer conflict checks between different batches

## 5. Data Model

### 5.1 `PoolSettlementBatch`

Minimal fields:

- `id`
- `batchNo`
- `status`
- `cutoffAt`
- `submittedAt`
- `approvedAt`
- `closedAt`
- `approvalCaseId`
- `createdByUserId`
- `autoCreated`
- `summaryJson`
- `metadataJson`
- `createdAt`
- `updatedAt`

Purpose:

- one logical settlement run root
- one approval root
- one closeout root

### 5.2 `PoolSettlementBatchItem`

Minimal fields:

- `id`
- `batchId`
- `status`
- `assetId`
- `walletPairKey`
- `walletAId`
- `walletBId`
- `netDirection`
- `netAmount`
- `submittedAmount`
- `settledAmount`
- `failedReason`
- `internalTransactionId`
- `createdAt`
- `updatedAt`

Purpose:

- one non-zero net execution task
- one derived `InternalTransaction`

### 5.3 `PoolSettlementBatchItemSource`

Minimal fields:

- `id`
- `batchId`
- `batchItemId` nullable
- `sourceFamily`
- `sourceId`
- `assetId`
- `fromWalletId`
- `toWalletId`
- `direction`
- `sourceAmount`
- `nettedAmount`
- `settledAmount`
- `status`
- `closeReason`
- `createdAt`
- `updatedAt`

Purpose:

- batch-local attribution layer
- records how each source participates in netting and settlement
- stores routing snapshot without polluting the source truth object

### 5.4 Source locking fields

Add only minimal lock linkage to source tables.

For `Outstanding`:

- `lockedByPoolSettlementBatchId` nullable

For `ReimbursementObligation`:

- `lockedByPoolSettlementBatchId` nullable

No other batch-local routing, netting, or item linkage fields should be stored on source truth tables.

## 6. Status Model

### 6.1 `PoolSettlementBatch.status`

States:

- `CREATED`
- `APPROVAL_PENDING`
- `APPROVED`
- `EXECUTING`
- `SUCCESS`
- `PARTIAL_FAILED`
- `FAILED`
- `CANCELLED`

Main transitions:

- `CREATED -> APPROVAL_PENDING`
- `APPROVAL_PENDING -> APPROVED`
- `APPROVED -> EXECUTING`
- `EXECUTING -> SUCCESS`
- `EXECUTING -> PARTIAL_FAILED`
- `EXECUTING -> FAILED`
- `APPROVAL_PENDING -> FAILED`
- `CREATED -> CANCELLED`
- `APPROVAL_PENDING -> CANCELLED`

### 6.2 `PoolSettlementBatchItem.status`

States:

- `READY`
- `TX_CREATED`
- `FUND_CREATED`
- `EXECUTING`
- `SUCCESS`
- `FAILED`
- `CANCELLED`

Main transitions:

- `READY -> TX_CREATED`
- `TX_CREATED -> FUND_CREATED`
- `FUND_CREATED -> EXECUTING`
- `EXECUTING -> SUCCESS`
- `EXECUTING -> FAILED`

### 6.3 `PoolSettlementBatchItemSource.status`

States:

- `LINKED`
- `NETTED`
- `SETTLED`
- `RELEASED`

Close reasons:

- `NETTED`
- `EXECUTED`
- `BATCH_RELEASED`

### 6.4 Source truth status projection

For `Outstanding`:

- initial: `OPEN`
- after batch-executed settlement: `CLOSED`
- after batch-approved netting: `CLOSED`
- after approval rejection/cancellation or failed batch closeout: back to `OPEN`

For `ReimbursementObligation`:

- initial: `OPEN`
- after batch-executed settlement: `REIMBURSED`
- after batch-approved netting: `REIMBURSED`
- after approval rejection/cancellation or failed batch closeout: back to `OPEN`

Netting reason is recorded in `PoolSettlementBatchItemSource`, not as a separate source truth terminal state.

## 7. End-to-End Flow

### 7.1 Fee to reimbursement

1. A platform fee is confirmed and recorded as `FeeOccurrence`.
2. System evaluates `reimbursementImpact`.
3. If impact is `SAFEGUARDED_POOL`:
   - create or maintain one `ReimbursementObligation(OPEN)`.
4. Otherwise:
   - no reimbursement object is created.

### 7.2 Outstanding creation

1. Upstream business flow succeeds.
2. System creates `Outstanding(OPEN)`.
3. It waits for future batch intake.

### 7.3 Batch creation

1. Operator clicks `Create Pool Settlement Batch`, or scheduler triggers at `23:59`.
2. System scans all current `OPEN` sources:
   - `Outstanding`
   - `ReimbursementObligation`
3. For each source:
   - derive normalized routing:
     - `assetId`
     - `fromWalletId`
     - `toWalletId`
   - if unroutable:
     - skip and keep source `OPEN`
   - if routable:
     - lock source to batch
     - create batch-local source attribution record
4. Batch starts in `CREATED`.

### 7.4 Netting and item creation

1. System groups batch-local source records by:
   - `assetId`
   - unordered `walletPair`
2. Within each bucket:
   - opposite directions net against each other
3. If net result is zero:
   - do not create `PoolSettlementBatchItem`
   - mark related source records as pending `NETTED`
4. If net result is non-zero:
   - create one `PoolSettlementBatchItem`
   - attach the relevant source attribution records to that item

If a batch contains only zero-net source records:

- the batch is still valid
- it can be submitted for approval
- it will close without creating `InternalTransaction`

### 7.5 Approval submission

1. Operator submits the batch.
2. System creates one shared approval case.
3. Batch enters `APPROVAL_PENDING`.

### 7.6 Approval passed

1. Batch approval passes.
2. Batch enters `APPROVED`.
3. All zero-net source records are immediately closed as `NETTED`.
4. Source truth is projected:
   - `Outstanding -> CLOSED`
   - `ReimbursementObligation -> REIMBURSED`
5. For every non-zero item:
   - create one `InternalTransaction`
   - link it back to the batch item
6. For every created transaction:
   - create first `InternalFund`
7. If at least one non-zero item exists:
   - batch enters `EXECUTING`
8. If no non-zero items exist:
   - batch closes directly as `SUCCESS`

### 7.7 Execution success

1. `InternalFund` reaches successful final state.
2. Corresponding item enters `SUCCESS`.
3. Related source attribution records enter `SETTLED`.
4. Source truth is projected:
   - `Outstanding -> CLOSED`
   - `ReimbursementObligation -> REIMBURSED`
5. If all items succeed:
   - batch enters `SUCCESS`

### 7.8 Approval rejected, cancelled, or expired

1. Batch approval fails or is cancelled.
2. All batch-held source attribution records are marked `RELEASED`.
3. All locked sources are unlocked.
4. Source truth returns to `OPEN`.
5. Batch enters `FAILED` or `CANCELLED`.

### 7.9 Partial failure

1. Some items succeed and some fail.
2. Successful items settle their sources normally.
3. Failed item sources remain held until batch closeout.
4. During batch closeout:
   - successful sources stay closed
   - failed item sources are released back to `OPEN`
5. Batch enters `PARTIAL_FAILED`.

## 8. API Shape

### 8.1 Create batch

`POST /admin/pool-settlement-batches`

Behavior:

- scans current `OPEN` sources
- skips unroutable sources
- locks eligible sources
- creates:
  - `PoolSettlementBatch`
  - `PoolSettlementBatchItem`
  - `PoolSettlementBatchItemSource`

Request body minimal shape:

- `autoCreated?`
- `metadataJson?`

No manual source selection is part of v1.

If no eligible routable sources are found:

- return a business error
- do not create an empty batch

### 8.2 Batch list

`GET /admin/pool-settlement-batches`

Should support listing by:

- `status`
- `autoCreated`
- `createdAt / cutoffAt`

### 8.3 Batch detail

`GET /admin/pool-settlement-batches/:id`

Should include:

- batch summary
- approval info
- items
- item sources
- skipped source summary
- derived internal transactions

### 8.4 Submit batch

`POST /admin/pool-settlement-batches/:id/submit`

Behavior:

- valid only from `CREATED`
- creates one shared approval case
- moves batch to `APPROVAL_PENDING`

### 8.5 Projection-driven closeout

No dedicated v1 manual closeout endpoint is required.

State changes should be driven by:

- approval projection
- internal transaction projection
- internal fund projection

## 9. Admin UI

### 9.1 List page

Menu:

- `Treasury Center -> Pool Settlement Batches`

Columns:

- `batchNo`
- `status`
- `cutoffAt`
- `approval status`
- `source count`
- `item count`
- `success item count`
- `failed item count`
- `autoCreated`
- `createdAt`

Primary action:

- `Create Batch`

### 9.2 Create behavior

No dedicated create form is needed in v1.

The create button:

- immediately creates a batch
- then navigates to batch detail

### 9.3 Detail page sections

Section 1: `Batch Summary`

- batch number
- status
- cutoff
- auto created flag
- approval case
- source summary
- item summary

Section 2: `Items`

- asset
- wallet pair
- net direction
- net amount
- status
- linked internal transaction

Section 3: `Item Sources`

- grouped by item where applicable
- also shows pure netted sources
- source family
- source number
- from wallet
- to wallet
- source amount
- netted amount
- settled amount
- status
- close reason

Section 4: `Skipped Sources Summary`

- skipped count
- top routing failure reasons

Section 5: `Derived Transactions`

- linked `InternalTransaction`
- linked `InternalFund`

### 9.4 Detail page actions

Only v1 actions:

- `Submit for Approval`
- `View Approval`

Do not add:

- edit composition
- delete item
- retry failed item
- force closeout

## 10. Scheduler

Daily automation rule:

- every day at `23:59`
- create one new batch
- immediately submit it for approval

This does not depend on older unfinished batches having completed.

## 11. Testing and Acceptance

### 11.1 Source intake

- safeguarded `FeeOccurrence` creates one reimbursement
- non-safeguarded `FeeOccurrence` creates none
- open `Outstanding` is discoverable by batch creation
- unroutable sources are skipped and stay `OPEN`
- no eligible routable source means no batch is created

### 11.2 Batch composition

- source is locked immediately at batch creation
- same source cannot enter two batches
- grouping key is `asset + unordered walletPair`
- opposite directions net within the bucket
- zero-net buckets create no item
- a batch with only zero-net buckets is valid and should complete without `InternalTransaction`

### 11.3 Approval

- one batch creates one approval case
- batch cannot dispatch items before approval
- approval reject/cancel/expire releases all held sources back to `OPEN`

### 11.4 Execution

- approved batch creates one `InternalTransaction` per non-zero item
- those transactions do not need separate approval
- each transaction auto-creates first `InternalFund`
- successful execution closes the linked source truth

### 11.5 Failure and closeout

- partial item failure results in `PARTIAL_FAILED`
- failed item sources are not released immediately
- failed item sources are released during batch closeout
- successful sources remain closed

## 12. Implementation Notes

This design intentionally keeps v1 simple:

- no execution-layer conflict checks
- no dispatch queue
- no same-pair serialization
- no partial settlement

These can be added in a later optimization cycle without changing the source truth model.

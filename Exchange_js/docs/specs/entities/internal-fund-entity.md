Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/internal-transaction-flow-constraints.md`
Source of Truth Level: specs-entity

# Internal Fund Entity

## Purpose
- This document defines `InternalFund` as the smallest durable movement fact under an internal treasury transaction.

## Canonical Fields
- `id`
- `internalFundNo`
- `internalTransactionId`
- `status`
- `assetId`
- `amount`
- `feeAmount`
- `netAmount`
- `fromWalletId`
- `toWalletId`
- `txHash`
- `confirmations`
- `referenceNo`
- `providerTxnId`
- `nonce`
- `blockNo`
- `gasUsed`
- `effectiveGasPrice`
- `sentAt`
- `confirmedAt`
- `completedAt`
- `statusHistory`

## Canonical Meaning
- `InternalFund` is the execution fact layer for one internal movement attempt or completion.
- `internalFundNo` is the operator-facing fund identifier.
- Movement semantics come from the linked `InternalTransaction.type`; `InternalFund` does not own a separate business type.

## Write Owners
- Internal funds workflow owns execution-state progression and transfer facts.
- Internal transaction aggregation consumes fund terminal results, but does not replace fund execution truth.

## Relationship Rules
- One internal transaction may own many internal funds.
- Outstanding closeout and treasury reconciliation may consume internal fund terminal evidence.

## Historical / Retired Notes
- Fund-level fields record transfer execution facts and MUST NOT replace the linked transaction as the business order root.

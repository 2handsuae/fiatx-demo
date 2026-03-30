Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/internal-transaction-flow-constraints.md`
Source of Truth Level: specs-entity

# Internal Transaction Entity

## Purpose
- This document defines `InternalTransaction` as the internal treasury order and aggregation root.

## Canonical Fields
- Identity:
  - `id`
  - `internalTxNo`
- Classification and source:
  - `type`
  - `sourceType`
  - `sourceId`
  - `sourceNo`
- Ownership:
  - `ownerType`
  - `ownerId`
  - `ownerNo`
- Lifecycle:
  - `status`
  - `approvalStatus`
  - `createdAt`
  - `completedAt`
  - `updatedAt`
- Review:
  - `makerUserId`
  - `checkerUserId`
  - `checkedAt`
  - `reviewReason`
- Amount / routing:
  - `assetId`
  - `amount`
  - `feeAmount`
  - `netAmount`
  - `fromWalletId`
  - `toWalletId`
  - `referenceNo`

## Canonical Meaning
- `InternalTransaction` is the business/root record for one internal treasury move or batchable internal collection intent.
- `internalTxNo` is the operator-facing transaction identifier.
- `InternalTransaction` is upstream of `InternalFund`; it is not the smallest transfer fact.

## Write Owners
- Internal transaction workflow owns transaction lifecycle truth.
- Internal fund execution consumes approved transaction intent and reports execution facts back to the transaction aggregate.

## Aggregation Rule
- Transaction terminal state is derived from linked internal funds according to the internal treasury workflow contract.

## Historical / Retired Notes
- `InternalTransaction` remains independent from customer-facing deposit or withdraw state machines even when it is triggered downstream from them.

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`
Source of Truth Level: specs-entity

# Outstanding Entity

## Purpose
- This document defines `Outstanding` as the durable open obligation record used by swap closeout and settlement orchestration.

## Canonical Fields
- `id`
- `outstandingNo`
- `sourceType`
- `sourceId`
- `sourceNo`
- `ownerType`
- `ownerId`
- `ownerNo`
- `direction`
- `assetId`
- `assetCode`
- `amount`
- `status`
- `swapTransactionId`
- `settlementId`
- `settlementItemId`
- `lockedAt`
- `closedAt`
- `closedByInternalFundId`

## Canonical Meaning
- `Outstanding` represents an amount that still needs operational closeout after the originating business event.
- `Outstanding` is not a customer-facing transaction root.
- `outstandingNo` is the operator-facing reference when present.

## Write Owners
- Swap closeout/orchestration logic owns outstanding creation.
- Settlement orchestration and linked internal fund execution own closeout progression.

## Relationship Rules
- `Outstanding` may bind to:
  - a swap root
  - a settlement batch
  - a settlement item
  - a closing internal fund

## Historical / Retired Notes
- Outstanding tracking remains an operational settlement construct and MUST NOT replace swap business truth.

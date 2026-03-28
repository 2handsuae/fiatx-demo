Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
Source of Truth Level: specs-entity

# Reconciliation Break Entity

## Purpose
- Define the minimum Wave 7 daily-diff break register.

## Canonical Fields
- Identity
  - `id`
  - `breakNo`
  - `businessDate`
  - `sourceType`
  - `sourceId`
  - `sourceNo`
- Workflow linkage
  - `withdrawId`
  - `withdrawNo`
  - `payoutId`
  - `payoutNo`
- Asset / delta
  - `assetId`
  - `assetCode`
  - `expectedNetDelta`
  - `observedNetDelta`
  - `deltaAmount`
  - `reasonCode`
- Handling
  - `status`
  - `linkedAlertId`
  - `linkedCaseId`
  - `detailsJson`
- Timestamps
  - `detectedAt`
  - `resolvedAt`
  - `reopenedAt`
  - `createdAt`
  - `updatedAt`

## Field Semantics
- One break row represents one durable mismatch observation for one business date and workflow root.
- Break status is handling truth, not transaction business truth.
- Unique key is fixed to `businessDate + sourceType + sourceId`.
- `sourceType` is fixed to `WITHDRAW` in Wave 7.
- `expectedNetDelta` is the canonical business expectation for the withdraw root on that date.
- `observedNetDelta` is the operationally observed outbound delta from clearing / payout evidence.
- `deltaAmount` is `observedNetDelta - expectedNetDelta`.
- `reasonCode` is limited to:
  - `DELTA_MISMATCH`
  - `SUCCESS_CLOSEOUT_INCOMPLETE`
  - `COMPENSATION_INCOMPLETE`
- `linkedAlertId` is automatically managed by the reconciliation runtime.
- `linkedCaseId` is optional and only appears when the linked alert is escalated to case.
- `detailsJson` stores machine-readable diagnostic context; it is not a customer-facing narrative field.

## Write Owners
- Reconciliation job owns creation and reopen.
- Operator workflow owns handling status transitions.
- Alert service owns linked alert creation.
- Case service may backfill `linkedCaseId` indirectly through alert escalation.

## Read-Model Outputs
- Break list must expose:
  - business date
  - status
  - withdraw / payout nos
  - expected / observed / delta
  - linked alert / case summary
  - detected timestamp
- Break detail must expose:
  - parsed `detailsJson`
  - linked withdraw / payout snapshots
  - linked alert / case references
  - immutable diff values from the latest detection run

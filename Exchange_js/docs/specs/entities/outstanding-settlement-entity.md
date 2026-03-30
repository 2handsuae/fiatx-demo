Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/internal-transaction-flow-constraints.md`, `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
Source of Truth Level: specs-entity

# Outstanding Settlement Entity

## Purpose
- This document defines `OutstandingSettlement` as the batch closeout root for grouped outstanding obligations.

## Canonical Fields
- `id`
- `settlementNo`
- `sourceType`
- `rangeStartAt`
- `cutoffAt`
- `status`
- `requestId`
- `makerUserId`
- `note`
- `totalOutstandingCount`
- `closedOutstandingCount`
- `totalAssetCount`
- `closedAssetCount`
- `completedAt`
- `items[]`
- `outstandings[]`

## Canonical Meaning
- `OutstandingSettlement` groups a closeout batch across one source class and one cutoff horizon.
- `settlementNo` is the operator-facing settlement identifier.
- `OutstandingSettlementItem` is a subordinate per-asset grouping, not a separate first-class product subject.

## Write Owners
- Outstanding settlement orchestration owns batch lifecycle truth.
- Internal transaction execution is the downstream operational consumer used to close grouped obligations.

## Relationship Rules
- A settlement batch may own many outstanding rows and many settlement items.
- Batch status is orchestration truth, not the business status of the originating swap or transaction roots.

## Historical / Retired Notes
- Settlement remains a reconciliation/operations domain construct and MUST NOT bypass internal execution layers.

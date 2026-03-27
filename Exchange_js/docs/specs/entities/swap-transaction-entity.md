Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/README.md`, `docs/specs/workflows/swap-canonical-workflow.md`
Source of Truth Level: specs-entity

# Swap Transaction Entity

## Purpose
- Define the durable meaning of `swapTransaction`.

## Identity
- Internal primary key: `id`
- Business display key: `swapNo`
- Quote binding:
1. `quoteId` = consumed firm quote id
2. `quoteNo` = consumed firm quote no
3. `quoteSnapshotRef` = immutable reference used by evidence replay

## Status Contract
- Valid canonical statuses:
1. `PENDING_COMPLIANCE`
2. `UNDER_REVIEW`
3. `SUCCESS`
4. `REJECTED`
5. `FAILED`

## Amount Contract
- `fromAmount`
  - sell-side customer amount
- `toAmount`
  - gross buy-side amount before swap fee
- `netToAmount`
  - customer net receivable after swap fee
- `feeAmount`
  - fee deducted from buy-side proceeds in Wave 6 V1
- `feeCurrency`
  - fee settlement asset code; Wave 6 V1 supports receive-asset fee only
- `feeBreakdown`
  - frozen quote-time fee snapshot

## Pricing Contract
- `exchangeRate`
  - all-in executable rate used for the swap
- `quoteId + quoteSnapshotRef`
  - tie the transaction to the frozen pricing snapshot; the swap MUST NOT recalculate price during execution

## Compliance Contract
- `riskDecisionRef`
  - latest `workflowDecisionRecord` id used by `TX_SWAP_FINAL`
- `alertId`
  - latest workflow-bound alert for this swap
- `caseId`
  - latest workflow-bound case for this swap

## Failure Contract
- `failureCode`
  - machine-readable system failure reason
- `failureReason`
  - operator-facing detail for the failed path

## Read Model Notes
- Admin/detail responses SHOULD expose:
1. gross / fee / net trio
2. quote binding
3. risk decision / alert / case references
4. failure detail when terminal status is `FAILED`

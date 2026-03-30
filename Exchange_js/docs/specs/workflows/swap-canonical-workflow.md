Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/customer-transaction-flow-constraints.md`, `docs/specs/entities/swap-transaction-entity.md`, `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
Source of Truth Level: specs-workflow

# Swap Canonical Workflow

## Purpose
- Define the canonical Wave 6 swap workflow from customer pricing request to final transaction outcome.
- Freeze the ordering between quote usage, accounting event execution, transaction risk routing, and outstanding creation.

## Actors
- Customer
- `Price Center`
- `SwapWorkflowOrchestrator`
- `SwapTransactionWorkflowService`
- `TransactionComplianceService`
- `Compliance Center`
- `Accounting Engine`
- `Outstanding Projection`

## State Model
- Pre-transaction states:
1. `RATE_PREVIEW`
2. `QUOTE_CREATED`
3. `QUOTE_CONSUMED`
- Swap states:
1. `PENDING_COMPLIANCE`
2. `UNDER_REVIEW`
3. `SUCCESS`
4. `REJECTED`
5. `FAILED`

## Canonical Order
1. Customer passes trading eligibility and product restriction gates.
2. Customer requests executable rate preview through `GET /swap-transactions/rate`.
3. Customer requests a firm quote through `POST /swap-transactions/quotes`.
4. `Price Center` freezes:
   - `policyRef`
   - market source snapshot
   - pair/tier match
   - `grossAmountOut`
   - `feeBreakdown`
   - `netAmountOut`
   - TTL
5. Customer confirms within TTL through `POST /swap-transactions`.
6. Quote is consumed exactly once.
7. `swapTransaction` is created in `PENDING_COMPLIANCE`.
8. `EVT_SWAP_CREATED` posts the held-balance accounting move.
9. `TransactionComplianceService.evaluateSwapFinalReview()` creates a pending `TX_SWAP_FINAL` decision record.
10. Admin `Risk Policy Executions` simulates `LOW / MEDIUM / HIGH`.
11. Low risk:
    - swap clears to `SUCCESS`
    - `EVT_SWAP_SUCCESS` posts release + settlement + fee lines
    - dual outstanding rows are created
12. Medium risk:
    - alert is upserted
    - swap moves to `UNDER_REVIEW`
13. High risk:
    - alert is upserted
    - case is auto-escalated
    - swap moves to `UNDER_REVIEW`
14. Compliance false positive / clear:
    - workflow callback maps to swap `CLEAR`
    - swap transitions to `SUCCESS`
15. Compliance reject / confirmed issue:
    - workflow callback maps to swap `REJECT`
    - swap transitions to `REJECTED`
16. System-side orchestration failure:
    - swap transitions to `FAILED`

## Accounting Contract
- `PENDING_COMPLIANCE`
  - `CLIENT_CREDIT -> CLIENT_HELD` on the sell asset
- `SUCCESS`
  - release held amount
  - recognize buy-side customer receivable
  - recognize LP side settlement legs
  - recognize swap fee revenue when `feeAmount > 0`
- `REJECTED`
  - reverse the `CREATED` hold
- `FAILED`
  - reverse the `CREATED` hold

## Compliance Contract
- Swap final review context is fixed to `TX_SWAP_FINAL`.
- `sourceType=SWAP` is the canonical compliance source binding.
- `REVIEW_SWAP_FINAL` is the canonical transaction review stage for swap.
- Admin `Risk Policy Executions` is the canonical operator surface for final swap risk simulation.
- Compliance modules MUST NOT directly mutate `swapTransaction.status`.
- Status changes MUST route through `SwapTransactionWorkflowService`.

## Fallback Operator Path
- `PATCH /admin/swap-transactions/:id/status` is the documented fallback operator path for swap repair / manual compensation only.
- Allowed operator actions are fixed to:
1. `success`
2. `reject`
3. `flag`
4. `fail`
- This path is not the standard Wave 6 review happy path.
- Normal review outcomes SHOULD resolve through workflow callback first.
- Fallback operator actions MUST still route through `SwapTransactionWorkflowService` and MUST NOT bypass unified event execution.

## Product Restriction Contract
- Restriction evaluation MUST run:
1. before quote creation
2. again before quote consumption
- V1 restriction rules are deterministic allow/block checks:
1. pair enabled
2. tier enabled
3. online channel allowed
4. customer trading eligibility
5. blocked investor classification
- Restriction failures MUST emit canonical audit events and machine-readable `restrictionCode`.

## Best Execution Evidence Contract
- Current runtime proves `policy-consistent execution evidence`, not “best market execution across all venues”.
- The swap evidence package MUST be initiated from `swapId` or `swapNo`.
- `quoteId / quoteNo` remain linked evidence inside the package and MUST NOT be treated as the active swap export root.

## Non-Goals
- This workflow does not define a multi-LP smart order router.
- This workflow does not define real blockchain asset movement.
- This workflow does not authorize manual UI shortcuts as the standard happy path.

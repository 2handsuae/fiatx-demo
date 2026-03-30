Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
Source of Truth Level: constraints

# Safeguarding Reconciliation Constraints

## Scope
- Wave 7 minimum customer-funds daily reconciliation for withdraw-driven outbound deltas.
- Scope is limited to `WF-16 Phase A`, not Wave 8 full safeguarding.

## Non-Negotiables
- Daily reconciliation is break-based, not report-only.
- Every detected break must be traceable to a workflow root and processing status.
- Break detection must not mutate customer withdraw / payout status directly.
- Break root identity is fixed to `businessDate + sourceType=WITHDRAW + sourceId=withdrawId`.
- The system MUST upsert one linked alert per break family using:
  - `stage = REVIEW_WITHDRAW_RECONCILIATION`
  - `ruleCode = TX_RECONCILIATION_BREAK_DETECTED`
- Reconciliation alerts are non-workflow-bound:
  - they may be closed
  - they may be marked false positive
  - they may be escalated to case
  - they MUST NOT directly drive withdraw / payout workflow disposition

## Invariants
- Reconciliation evidence must preserve:
  - business date
  - source root id
  - calculated delta
  - current handling status
- Candidate set is fixed to payout-linked withdraw roots that are already terminal by the requested `businessDate` cutoff.
- `expectedNetDelta` contract is fixed:
  - `withdraw.status = SUCCESS` => `withdraw.netAmount`
  - `withdraw.status in FAILED | RETURNED | REJECTED | CANCELLED` => `0`
- `observedNetDelta` contract is fixed:
  - prefer active `WITHDRAWAL` clearings summed by `inAmount`
  - else `payout.amount` when payout is `CONFIRMED | CLEARED`
  - else `0` when payout is `FAILED | TIMEOUT | RETURNED` and all linked clearings are `CANCELLED`
- Allowed `reasonCode` values are fixed:
  - `DELTA_MISMATCH`
  - `SUCCESS_CLOSEOUT_INCOMPLETE`
  - `COMPENSATION_INCOMPLETE`
- Allowed break status values are fixed:
  - `OPEN`
  - `UNDER_REVIEW`
  - `RESOLVED`
  - `ACCEPTED_DIFFERENCE`
- Reconciliation break handling is audit-visible.
- Break closure does not rewrite historical daily diff values.
- A repeated run for the same root MUST reopen the same break when the mismatch reappears; it MUST NOT create a second row.
- A clean rerun without mismatch MUST NOT silently auto-close an existing break.
- Withdraw evidence export MUST include reconciliation break snapshots for the selected withdraw root.

## Forbidden Patterns
- No silent break overwrite.
- No delete-and-recreate of resolved breaks for the same business date and source root.
- No use of reconciliation break status as a substitute for payout or withdraw status.
- No direct workflow transition from reconciliation alert resolution.
- No use of reconciliation break status update endpoints to repair accounting or payout execution.

## Change Protocol
- Wave 7 may extend list/detail/export fields, but MUST NOT change the above invariants without updating:
  - `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
  - `docs/specs/entities/reconciliation-break-entity.md`
  - `docs/acceptance/wave-7-minimum-daily-reconciliation-runbook.md`
- Wave 8 full safeguarding work may add threshold / escalation / treasury coverage, but MUST preserve Wave 7 break root identity and non-workflow-bound handling semantics unless explicitly superseded.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/safeguarding-reconciliation-constraints.md`
Source of Truth Level: specs-workflow

# Safeguarding Reconciliation Workflow

## Purpose
- Describe the minimum Wave 7 daily reconciliation lifecycle for withdraw-driven customer-funds deltas.
- Keep reconciliation handling separate from withdraw / payout business-state authority.

## Actors
- `System`
- `Finance Operator`
- `Compliance Operator`
- `Audit / Demo Operator`

## Workflow Root
- `ReconciliationBreak`
  - durable break register keyed by `businessDate + WITHDRAW + withdrawId`
- linked read-model objects:
  - `WithdrawTransaction`
  - `Payout`
  - `ComplianceAlert`
  - optional `ComplianceIncident`

## Canonical Flow
1. operator submits `businessDate`
2. system loads payout-linked terminal withdraw roots up to that business-date cutoff
3. system computes `expectedNetDelta` and `observedNetDelta`
4. system checks terminal invariants
5. when mismatch exists:
   - create or update `ReconciliationBreak`
   - reopen the same break if a resolved difference reappears
   - upsert one linked reconciliation alert
6. operator reviews break detail
7. operator moves break to:
   - `UNDER_REVIEW`
   - `RESOLVED`
   - `ACCEPTED_DIFFERENCE`
8. audit evidence export may replay the same withdraw root together with linked reconciliation breaks

## Reason Model
- `DELTA_MISMATCH`
  - expected and observed net delta are different
- `SUCCESS_CLOSEOUT_INCOMPLETE`
  - withdraw is `SUCCESS` but payout / closeout invariants are incomplete
- `COMPENSATION_INCOMPLETE`
  - withdraw is terminal failed / returned / rejected / cancelled but linked clearings are not fully cancelled

## Minimum State Model
- `OPEN`
- `UNDER_REVIEW`
- `RESOLVED`
- `ACCEPTED_DIFFERENCE`

## State Transition Rules
- `OPEN -> UNDER_REVIEW`
  - operator acknowledges investigation started
- `OPEN -> RESOLVED`
  - operator confirms the diff is fixed and no longer requires active handling
- `OPEN -> ACCEPTED_DIFFERENCE`
  - operator accepts the difference as understood / tolerated for Wave 7 minimum closeout
- `RESOLVED | ACCEPTED_DIFFERENCE -> OPEN`
  - system reopen only; happens when a later daily diff detects the mismatch again
- Break status changes never mutate:
  - `withdraw.status`
  - `payout.status`
  - journal / clearing objects

## API / UI Projection
- Admin API:
  - `POST /admin/reconciliation/safeguarding-breaks/generate-daily-diff`
  - `GET /admin/reconciliation/safeguarding-breaks`
  - `GET /admin/reconciliation/safeguarding-breaks/:id`
  - `PATCH /admin/reconciliation/safeguarding-breaks/:id/status`
- Admin UI:
  - `Reconciliation Center -> Safeguarding Breaks`
  - list page for business-date generation and break browsing
  - detail page for diff review and status handling

## Alert Boundary
- Every new or reopened break upserts one alert with:
  - `stage = REVIEW_WITHDRAW_RECONCILIATION`
  - `ruleCode = TX_RECONCILIATION_BREAK_DETECTED`
- The reconciliation alert family is non-workflow-bound and is not a substitute for transaction-risk review stages.
- Alert resolution may close or escalate to case, but cannot directly release, reject, fail, or return the withdraw.

## Wave 7 Boundary
- Daily diff generation is in scope.
- Break register and handling state are in scope.
- Threshold escalation and full safeguarding inventory are out of scope.
- Deposit / swap / treasury-wide safeguarding coverage is out of scope.

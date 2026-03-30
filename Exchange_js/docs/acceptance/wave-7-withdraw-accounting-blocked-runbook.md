Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`, `docs/constraints/posting-clearing-balance-projection-constraints.md`
Source of Truth Level: acceptance

# Wave 7 Withdraw Accounting Blocked Runbook

## Environment
- local main runtime with Wave 7 withdraw / payout code enabled
- admin access to `Withdraw Detail`, `Payout Detail`, `Journal`, and `Clearing`

## Purpose
- This runbook explains the operator-facing repair boundary when Wave 7 payout receipt exists but closeout or compensation is incomplete.
- It is the acceptance-layer companion to the canonical `re-closeout / re-compensate` payout-root repair contract.

## Diagnosis Entry
- Start from `Payout Detail`.
- Record:
  1. `payoutId`, `payoutNo`, `payout.status`
  2. linked `withdrawId`, `withdrawNo`, `withdraw.status`
  3. journal list by `sourceType=WITHDRAW, sourceId=withdrawId`
  4. clearing list by `sourceType=WITHDRAWAL, sourceId=withdrawId`

## Compensation Boundary
- If payout is `CONFIRMED` and withdraw is still `PAYOUT_PENDING`:
  - use `POST /payouts/:id/re-closeout`
  - do not mutate payout `CLEARED` directly
- If payout is `FAILED` or `TIMEOUT` and withdraw is still `PAYOUT_PENDING`:
  - use `POST /payouts/:id/re-compensate`
  - do not write withdraw `FAILED` manually
- If payout is `RETURNED` and withdraw is still `SUCCESS`:
  - use `POST /payouts/:id/re-compensate`
  - do not write withdraw `RETURNED` manually
- If withdraw is already terminal but reversal or clearing close is missing:
  - `re-compensate` remains the correct repair root
  - do not fabricate journal or clearing rows manually

## Do Not
- Do not call direct withdraw terminal actions from admin UI or scripts for normal payout recovery.
- Do not set payout `CLEARED` manually.
- Do not create ad hoc reversal journals outside canonical reversal-by-source.
- Do not leave `WITHDRAWAL` clearings non-`CANCELLED` after fail / return compensation is complete.

## Exit Criteria
- Operator can explain whether the issue belongs to:
  1. success closeout (`re-closeout`)
  2. terminal compensation (`re-compensate`)
- After repair:
  1. withdraw business status matches payout terminal outcome
  2. reversal journals are complete without duplication
  3. linked withdraw clearings are `CANCELLED`
  4. no direct admin terminal mutation was used as a shortcut

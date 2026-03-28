Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
Source of Truth Level: specs-entity

# Payout Entity

## Purpose
- Define payout as the execution and receipt root for outbound money movement.

## Canonical Fields
- `status`
  - execution lifecycle truth
- `displayStatus`
  - admin display/read-model truth that mirrors `CLEAR` as `CLEARED`
- `withdrawId`
  - parent withdraw root
- `ownerNo`
  - mirrored operator/customer identifier for list/detail read models
- `transactionType`, `transactionId`, `transactionNo`
  - mirrored linkage back to withdraw root
- `type`
  - crypto or fiat execution branch
- `txHash`, `referenceNo`
  - provider or network receipt references
- `sentAt`, `completedAt`
  - dispatch / terminal timing anchors

## Field Semantics
- `CONFIRMED` means external receipt observed.
- `CLEAR` means internal success closeout completed after withdraw success posting.
- `FAILED`, `TIMEOUT`, and `RETURNED` remain payout execution outcomes that back-propagate into withdraw business outcomes.
- Admin display may use `Cleared` while raw payout status stays `CLEAR`.
- Raw type casing may remain uppercase internally; admin read-models should still normalize to `CRYPTO | FIAT`.

## Write Owners
- Payout service owns payout state transitions.
- Withdraw orchestrator owns the success-close boundary that moves payout from `CONFIRMED` to `CLEAR`.

## Read-Model Expectations
- Payout detail must surface execution receipt evidence and linked withdraw identity.
- Payout list/detail should mirror payin read-model fields where conceptually equivalent:
  - `ownerNo`
  - `transactionType / transactionId / transactionNo`
  - `displayStatus`
  - canonical `audit_log_events`
- Repair surfaces remain payout-only true asymmetry:
  - `re-closeout`
  - `re-compensate`

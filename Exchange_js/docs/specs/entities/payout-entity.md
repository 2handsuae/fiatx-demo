Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
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
- `withdrawId`
  - parent withdraw root
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

## Write Owners
- Payout service owns payout state transitions.
- Withdraw orchestrator owns the success-close boundary that moves payout from `CONFIRMED` to `CLEAR`.

## Read-Model Expectations
- Payout detail must surface execution receipt evidence and linked withdraw identity.

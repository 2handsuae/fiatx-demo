Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/constraints/customer-transaction-flow-constraints.md`
Source of Truth Level: specs-entity

# PayIn Entity

## Purpose
- This document defines the canonical entity semantics for `PayIn`.
- `PayIn` is the inbound-arrival root between detected incoming value and the deposit business transaction.

## Canonical Fields
- Identity:
  - `id`
  - `payinNo`
- Binding:
  - `depositId`
  - `ownerId`
  - `toWalletId`
  - `fromWalletId`
  - `assetId`
- Transfer fingerprint:
  - `type`
  - `amount`
  - `txHash`
  - `referenceNo`
  - `providerTxnId`
  - `toAddress`
  - `toIban`
  - `fromAddress`
  - `fromIban`
- Lifecycle:
  - `status`
  - `confirmations`
  - `receivedAt`
  - `confirmedAt`
  - `statusHistory`

## Lifecycle Anchor
- Canonical status values are:
  - `DETECTED`
  - `CONFIRMING`
  - `CONFIRMED`
  - `CLEARED`
  - `FAILED`
- `FIAT` does not require a mandatory `CONFIRMING` phase in the current runtime path.
- `CRYPTO` may pass through `CONFIRMING` before `CONFIRMED`.
- `CLEARED` means the upstream payin root has completed its required confirmed-side steps and no longer needs to hold the deposit chain open.

## Canonical Meaning
- `PayIn` is not the customer-visible success state.
- `PayIn` is the upstream root that:
  - binds detected inbound value to one deposit flow
  - carries upstream confirmation identity
  - emits the canonical payin-to-deposit trigger
- `providerTxnId` is the reusable upstream provider/detector reference field in the current phase.

## Deposit Binding
- One payin may be linked to one deposit.
- `payin.created` creates or reuses one `Deposit`.
- `payin.confirmed` is the canonical upstream trigger that advances deposit to `COMPLIANCE_PENDING`.
- Payin clear happens only after confirmed-side orchestration completes.

## Write Owners
- Payin service owns payin lifecycle progression.
- Detector or provider ingestion may create or reuse payin.
- Deposit workflow consumes payin events, but does not become the owner of payin state truth.

## Dedupe / Reuse Notes
- Current runtime may reuse payin through:
  - direct linkage from detector source
  - `providerTxnId`
  - current business lookup on transaction fingerprint
- Reuse logic is ingestion-path specific and MUST remain idempotent.

## Non-Negotiable Rules
- `PATCH /treasury/payins/:id/status?action=confirm` is the canonical deposit trigger.
- Payin MUST NOT be cleared while required confirmed-side accounting is blocked.
- Payin MUST NOT be replaced by deposit as the upstream arrival root.

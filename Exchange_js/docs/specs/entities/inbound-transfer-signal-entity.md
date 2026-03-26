Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/payin-deposit-canonical-workflow.md`
Source of Truth Level: specs-entity

# Inbound Transfer Signal Entity

## Purpose
- This document defines the canonical entity semantics for `InboundTransferSignal`.
- It is the detector-source object for customer-submitted inbound transfer discovery in the current Wave 5 runtime.

## Canonical Fields
- Identity:
  - `id`
  - `signalNo`
- Ownership:
  - `ownerId`
  - `walletId`
  - `assetId`
- Transfer fingerprint:
  - `channelType`
  - `amount`
  - `txHash`
  - `referenceNo`
  - `fromAddress`
  - `fromIban`
  - `dedupeKey`
- Lifecycle:
  - `status`
  - `linkedPayinId`
  - `submittedAt`
  - `lastScannedAt`
  - `scanResult`

## Lifecycle Anchor
- Canonical status values are:
  - `PENDING_SCAN`
  - `PAYIN_CREATED`
  - `IGNORED`
  - `FAILED`
- The entity is created by the customer-side submit flow.
- It is consumed by the scan flow.
- It is not the payin business object itself.

## Canonical Meaning
- `InboundTransferSignal` represents a claim that customer funds have already been sent to one deposit wallet.
- `channelType` distinguishes:
  - `CRYPTO`
  - `FIAT`
- `dedupeKey` is the current submit-surface dedupe root for the signal record.
- `linkedPayinId` binds the signal to the reused or newly created `PayIn`.

## Dedupe Rule
- Current runtime dedupe is signal-level and source-specific:
  - crypto signal dedupe uses wallet/asset plus `txHash`
  - fiat signal dedupe uses wallet/asset plus `referenceNo`
- Dedupe prevents duplicate signal records before payin orchestration.

## Write Owners
- Customer deposit submit flow writes the record.
- Inbound transfer scanner updates:
  - `status`
  - `linkedPayinId`
  - `lastScannedAt`
  - `scanResult`

## Read-Model Meaning
- Customer list/detail reads use this object to show:
  - pending inbound submissions
  - recently scanned submissions
  - linked payin and deposit when available
- It is an operator/demo aid for inbound discovery, not the canonical deposit business transaction.

## Non-Negotiable Rules
- `InboundTransferSignal` MUST NOT bypass payin orchestration and create deposit directly.
- `InboundTransferSignal` MUST NOT be used as the final accounting or compliance root.
- `InboundTransferSignal` MUST remain customer-scoped to the submitting owner and deposit wallet.

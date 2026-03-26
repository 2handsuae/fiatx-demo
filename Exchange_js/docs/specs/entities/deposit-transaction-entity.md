Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/constraints/customer-transaction-flow-constraints.md`
Source of Truth Level: specs-entity

# Deposit Transaction Entity

## Purpose
- This document defines the canonical entity semantics for `DepositTransaction`.
- `Deposit` is the customer-visible transaction root for the Wave 5 deposit business lifecycle.

## Canonical Fields
- Identity:
  - `id`
  - `depositNo`
- Ownership:
  - `ownerType`
  - `ownerId`
  - `assetId`
  - `toWalletId`
  - `fromWalletId`
  - `payinId`
- Amount / transfer identity:
  - `amount`
  - `netAmount`
  - `feeAmount`
  - `txHash`
  - `referenceNo`
  - `fromAddress`
  - `fromIban`
  - `toAddress`
  - `toIban`
- Compliance snapshot:
  - `kytStatus`
  - `kytScreeningId`
  - `kytRiskScore`
  - `kytCheckedAt`
  - `travelRuleRequired`
  - `travelRuleStatus`
  - `travelRuleTransferId`
  - `counterpartyVasp`
  - `travelRuleCheckedAt`
- Lifecycle:
  - `status`
  - `statusHistory`
  - `createdAt`
  - `updatedAt`
  - `completedAt`

## Lifecycle Anchor
- Canonical status values are:
  - `PAYIN_PENDING`
  - `COMPLIANCE_PENDING`
  - `UNDER_REVIEW`
  - `SUCCESS`
  - `REJECTED`
  - `FAILED`

## Canonical Meaning
- `Deposit` is the business transaction that customers and operators reason about.
- `Deposit` is downstream of `PayIn`, but upstream of:
  - transaction evidence containers
  - transaction decision records
  - workflow-bound alert/case
  - accounting output
  - downstream internal collection

## Workflow Authority
- Current canonical deposit state actions are:
  - `payin_confirmed`
  - `success`
  - `flag`
  - `reject`
  - `fail`
- `payin_confirmed` is compensation-only on the deposit surface.
- Release/hold/reject authority stays on deposit state actions, not on provider response containers or case rows directly.

## Customer Gate And Compliance Gate
- `Deposit.SUCCESS` is gated by customer canonical control fields:
  - `onboardingStatus`
  - `operatingStatus`
  - `restrictionStatus`
  - `complianceHoldStatus`
- `Deposit.SUCCESS` for crypto also depends on transaction compliance snapshot:
  - `kytStatus = PASS`
  - `travelRuleStatus = ACCEPTED` when required

## Accounting And Evidence Semantics
- Required accounting points exist at:
  1. `payin.confirmed -> COMPLIANCE_PENDING`
  2. `deposit.success -> SUCCESS`
- `DEPOSIT_ACCOUNTING_BLOCKED` is the canonical audit signal for failed required accounting.
- Deposit-root evidence export may aggregate:
  - payin
  - decision record
  - KYT / Travel Rule response containers
  - alert / case
  - journal
  - internal collection

## Trace Binding
- Deposit-root audit replay resolves to:
  - `workflowType = DEPOSIT`
  - `workflowNo = depositNo`
- Transaction alert/case callbacks still normalize back to the same deposit-root replay surface in Audit Center.

## Write Owners
- Deposit transactions service owns deposit state truth.
- Deposit workflow orchestrator owns payin-driven and success/reject side effects.
- Transaction workflow callback service may request canonical deposit actions, but does not become the owner of deposit state truth.

## Non-Negotiable Rules
- `Deposit` MUST NOT be directly released or rejected by provider response records.
- `Deposit` MUST NOT bypass customer/compliance gate on `SUCCESS`.
- `Deposit.REJECTED` remains a compliance outcome and does not create a dedicated reject posting/reversal contract in the current phase.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: specs-workflow

# PayIn / Deposit Canonical Workflow

## Purpose
- This document defines the canonical Wave 5 deposit workflow after implementation closeout.
- It covers:
  - inbound-signal detection
  - payin progression
  - deposit progression
  - transaction compliance and risk binding
  - alert/case callback
  - accounting and downstream collection
  - audit replay and evidence export

## Actors
- `Customer`
- `Compliance Operator`
- `MLRO`
- `System`

## Workflow Roots
- `InboundTransferSignal`
  - detector-source root used by the current customer-side demo and scan flow
- `PayIn`
  - external-arrival root for detected inbound value
- `Deposit`
  - customer-visible transaction root for the deposit business lifecycle

## Canonical State Model

### InboundTransferSignal
- `PENDING_SCAN`
- `PAYIN_CREATED`
- `IGNORED`
- `FAILED`

### PayIn
- `DETECTED`
- `CONFIRMING`
- `CONFIRMED`
- `CLEARED`
- `FAILED`

### Deposit
- `PAYIN_PENDING`
- `COMPLIANCE_PENDING`
- `UNDER_REVIEW`
- `SUCCESS`
- `REJECTED`
- `FAILED`

## Canonical Entry Paths
- Customer-side detector source:
  - `GET /deposit-transactions/my/inbound-signals`
  - `POST /deposit-transactions/my/inbound-signals`
  - `POST /deposit-transactions/my/inbound-signals/scan`
- Canonical payin progression:
  - `PATCH /treasury/payins/:id/status?action=confirm`
- Deposit state-action surface:
  - `PATCH /deposit-transactions/:id/status`
- Compensation-only boundary:
  - `PATCH /deposit-transactions/:id/status?action=payin_confirmed` is manual/compensation only

## Main Paths

### 1. Signal -> PayIn -> Deposit
- Customer submits one `InboundTransferSignal`.
- Customer scan evaluates the signal under customer deposit eligibility gate.
- System reuses or creates `PayIn`.
- `payin.created` creates or reuses one `Deposit` in `PAYIN_PENDING`.
- Scan then uses the canonical payin confirm path.

### 2. PayIn Confirmed -> Compliance Pending
- `payin.confirmed` moves deposit to `COMPLIANCE_PENDING`.
- Fiat payin creates no response container at this step.
- Crypto payin creates:
  - `KYT`
  - `Travel Rule`
- System-generated response containers are evidence holders only and are auto-filled directly to `FINAL`.
- Confirmed accounting point is required at this step.
- Payin is cleared only after upstream confirmed-side steps complete.

### 3. Compliance Evidence -> Risk -> Alert / Case
- Transaction compliance evidence containers remain provider-response objects, not platform cases.
- Deposit transaction risk is workflow-bound through the decision record path, not through response lifecycle.
- Canonical deposit-side transaction risk context is:
  - `TX_DEPOSIT_FINAL`
- Risk output may:
  - create no workflow-bound object
  - upsert alert
  - auto-escalate to case

### 4. Release / Hold / Reject Authority
- Provider response containers do not directly release or reject the deposit.
- Workflow-bound alert/case handling does not write deposit state ad hoc.
- Deposit release/hold/reject authority stays in canonical deposit state actions:
  - `success`
  - `flag`
  - `reject`
  - `fail`
- Transaction workflow callback delegates through canonical deposit actions only.

### 5. No-Hit Release Path
- For crypto deposit, no-hit evidence means `KYT` and `Travel Rule` containers exist in `FINAL`.
- For fiat deposit, there are no response containers; only the decision record path is evaluated.
- No alert/case is required by the current runtime contract.
- Deposit still reaches `SUCCESS` only through canonical deposit success action.

### 6. Hit / Review / Case Path
- `KYT REVIEW` produces alert-driven review handling.
- `KYT FAIL` and `Travel Rule REJECTED|EXPIRED` produce alert and case handling.
- Review-hit paths move deposit to `UNDER_REVIEW` through canonical `flag`.
- Alert `FALSE_POSITIVE` maps to transaction workflow `CLEAR`.
- Case MLRO-approved `CLEAR` maps to transaction workflow `CLEAR`.
- Case MLRO-approved `REJECT` maps to transaction workflow `REJECT`.

## Customer Gate And Release Gate
- Deposit success requires customer canonical gate to pass:
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`
  - `restrictionStatus = CLEAR`
  - `complianceHoldStatus = ACTIVE`
- Crypto deposit success also requires transaction compliance gate to pass:
  - response snapshots are lifecycle-only and should be `FINAL` when present
  - business release authority remains the transaction workflow clear path
- Gate failure does not silently release the deposit.

## Accounting And Internal Collection
- Required deposit accounting points are:
  1. `payin.confirmed -> COMPLIANCE_PENDING`
  2. `deposit.success -> SUCCESS`
- `DEPOSIT_ACCOUNTING_BLOCKED` is the canonical audit signal for failed required accounting.
- Deposit reject path remains a compliance outcome and does not mint a dedicated reject posting or reversal event.
- Crypto `Deposit.SUCCESS` triggers downstream `DEP_TO_MASTER`.
- Internal collection remains a downstream treasury side effect, not a customer-visible deposit state root.

## Audit And Evidence
- Deposit-root audit replay normalizes to:
  - `workflowType = DEPOSIT`
  - `workflowNo = depositNo`
- The exportable evidence chain is expected to replay:
  - inbound signal
  - payin
  - deposit
  - transaction decision record
  - transaction alert/case
  - journal
  - internal transaction / internal fund when present

## Non-Goals
- This document does not redefine swap or withdraw workflow truth.
- This document does not redefine provider connector signature or webhook transport details beyond current runtime entry surfaces.

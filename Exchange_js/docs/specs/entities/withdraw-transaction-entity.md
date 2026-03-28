Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
Source of Truth Level: specs-entity

# Withdraw Transaction Entity

## Purpose
- Define customer-visible outbound transaction semantics and compliance-gate fields.
- Withdraw is the Wave 7 outbound business root created through quote-confirm and progressed by final-review truth plus payout receipt.

## Canonical Fields
- `status`
  - withdraw business lifecycle truth
- `ownerNo`
  - mirrored operator/customer identifier for list/detail read models
- `type`
  - mirrored `CRYPTO | FIAT` display/read-model field
- `payoutId`, `payoutNo`
  - linked payout execution root
- `preKytStatus`
  - compatibility snapshot for `Pre-KYT` response lifecycle
- `kytStatus`
  - compatibility snapshot for `KYT` response lifecycle
- `travelRuleRequired`, `travelRuleStatus`
  - response requirement + compatibility snapshot for `Travel Rule` lifecycle
- `complianceStatus`
  - retained compatibility snapshot only; not primary workflow truth
- `derivedComplianceStatus`
  - primary read-model compliance truth for list/detail and callback interpretation
- `approvedAt`, `payoutRequestedAt`, `completedAt`
  - workflow timing anchors

## Field Semantics
- `PAYOUT_PENDING` means payout execution exists or is ready to start; it does not mean payout receipt was confirmed.
- `SUCCESS` means payout receipt exists and withdraw success posting has completed.
- `FAILED` and `RETURNED` are customer-visible compensation outcomes, not payout-only states.
- `preKyt*`, `kyt*`, and `travelRule*` fields are response lifecycle / evidence mirrors.
- `derivedComplianceStatus`, decision records, and alert / case callback are the active withdraw compliance truth.
- `CREATED`, `APPROVED`, and `HELD` may still exist on historical records but are legacy compatibility statuses, not current-flow truth.

## Write Owners
- Withdraw workflow service owns `status`.
- Transaction compliance sync owns `preKyt*`, `kyt*`, `travelRule*`, `complianceStatus`.
- Withdraw orchestrator owns success / fail / return accounting-close timing updates.

## Compatibility Shell
- `complianceStatus` is retained for compatibility only and MUST NOT replace `derivedComplianceStatus` in operator-facing truth.
- Legacy status/action vocabulary such as:
  - `CREATED`
  - `APPROVED`
  - `HELD`
  - `CHECK`
  - `APPROVE`
  remains historical-readability inventory only.
- Historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` records may remain attached to evidence/audit, but they are not live workflow authority.

## Read-Model Expectations
- Withdraw detail pages must expose payout linkage and compliance breakdown.
- Audit / evidence readers must be able to trace from withdraw to payout and decision records.
- Withdraw list/detail should prefer:
  - `derivedComplianceStatus`
  - normalized response lifecycle labels
  - `Legacy` tagging when historical compatibility statuses are shown

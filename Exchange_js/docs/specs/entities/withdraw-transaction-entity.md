Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
Source of Truth Level: specs-entity

# Withdraw Transaction Entity

## Purpose
- Define customer-visible outbound transaction semantics and compliance-gate fields.

## Canonical Fields
- `status`
  - withdraw business lifecycle truth
- `payoutId`, `payoutNo`
  - linked payout execution root
- `preKytStatus`
  - precheck gate result
- `kytStatus`
  - main KYT result for dispatch gate
- `travelRuleRequired`, `travelRuleStatus`
  - final dispatch gate boundary
- `complianceStatus`
  - derived outbound transaction compliance gate result
- `approvedAt`, `payoutRequestedAt`, `completedAt`
  - workflow timing anchors

## Field Semantics
- `PAYOUT_PENDING` means payout execution exists or is ready to start; it does not mean payout receipt was confirmed.
- `SUCCESS` means payout receipt exists and withdraw success posting has completed.
- `FAILED` and `RETURNED` are customer-visible compensation outcomes, not payout-only states.
- `preKyt*` fields are pre-dispatch screening evidence mirrors.
- `kyt*` and `travelRule*` fields are dispatch-gate mirrors.

## Write Owners
- Withdraw workflow service owns `status`.
- Transaction compliance sync owns `preKyt*`, `kyt*`, `travelRule*`, `complianceStatus`.
- Withdraw orchestrator owns success / fail / return accounting-close timing updates.

## Read-Model Expectations
- Withdraw detail pages must expose payout linkage and compliance breakdown.
- Audit / evidence readers must be able to trace from withdraw to payout and decision records.

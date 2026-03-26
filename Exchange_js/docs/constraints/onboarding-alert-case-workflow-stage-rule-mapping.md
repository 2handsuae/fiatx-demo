# Onboarding Alert / Case Workflow-Stage-Rule Mapping

## Purpose

This document defines the current Wave 2 hardening mapping for onboarding-only `alert / case`.
The canonical organizing language is:

- `workflow`
- `stage`
- `rule`

This document does **not** use `triggerType` for `alert / case`.

## Fixed Scope

- `workflow` is fixed to `ONBOARDING`
- current `alert / case` stages are fixed to:
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- `FINAL_APPROVAL` remains a workflow-level status and is **not** an `alert / case` stage

## Fixed Rule Set

Valid rules in current onboarding-only scope:

- `ONB_CDD_REVIEW_REQUIRED`
- `ONB_EDD_REVIEW_REQUIRED`

Notes:

- `rule` explains why an `alert / case` appears in this stage.
- finer-grained risk detail continues to live in `reasonCodes / metadata`.
- legacy runtime rule `ONB_ONBOARDING_JOURNEY_REVIEW` is treated as the compatibility alias of the canonical stage rules.
- `PEP_HIT / SANCTIONS_HIT` no longer appear as standalone runtime rules; they are expressed through `reasonCodes / metadata`.

## Action and Disposition Rules

- `Alert Handling` is the only canonical alert interaction surface.
- `Alert Handling` combines:
  - assignment ownership actions
  - alert-level resolution actions
- `Direct Disposition` is the only alert-level path that executes a single-object onboarding proposal.
- onboarding alert `primaryObject` is fixed to `Onboarding Journey` and MUST NOT be user-selectable.
- `Case Actions` control case ownership and relation management.
- `Interim Measures` control customer restriction/freeze measures.
- `Workflow Proposal` on case is proposal-only and does not immediately execute transition.
- `Disposition` is conclusion-only and MUST NOT be used as a synonym for workflow decision.
- `ESCALATE_TO_CASE` is triage-only and does not advance onboarding workflow.
- `REPORT` is historical compatibility vocabulary only; active runtime filing semantics are modeled through:
  - final disposition
  - filing required
  - external filing lifecycle
- `FALSE_POSITIVE` on workflow-bound case is no longer a direct case action; it must be proposed through the report / MLRO path.
- `Audit Center` is the canonical audit store for this mapping.
- All objects produced inside one onboarding journey MUST share the same trace root:
  - `traceId = ONBOARDING:<journeyId>`
- This shared trace MUST cover:
  - `CDD/EDD Response`
  - onboarding alert
  - onboarding case
  - MLRO review
  - onboarding final approval（when `REVIEW_EDD + CLEAR` enters `FINAL_APPROVAL`）

## Workflow Transition Consumer

- `REVIEW_CDD`
  - `CLEAR -> APPROVED`
  - `REJECT -> REJECTED`
  - `REQUIRE_EDD -> PENDING_EDD_INPUT`
- `REVIEW_EDD`
  - `CLEAR -> FINAL_APPROVAL`
  - `REJECT -> REJECTED`
- `ESCALATE_TO_CASE`
  - stays inside compliance center and does **not** advance onboarding workflow
- `RESTRICT / FALSE_POSITIVE`
  - produce `NO_TRANSITION` for onboarding workflow

## Mapping

### 1. `workflow = ONBOARDING`, `stage = REVIEW_CDD`

- valid rules
  - `ONB_CDD_REVIEW_REQUIRED`
- alert handling
  - `ASSIGN`
  - `REASSIGN`
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
  - `ESCALATE_TO_CASE`
- alert direct disposition proposals
  - `REJECT`
  - `REQUIRE_EDD`
- alert resolution outcomes
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
- case actions
  - `ASSIGN`
  - `REASSIGN`
  - `LINK_ALERT`
- case interim measures
  - `FREEZE`
  - `UNFREEZE`
  - `RESTRICT`
  - `UNRESTRICT`
- case workflow proposal
  - `CLEAR`
  - `REJECT`
  - `REQUIRE_EDD`
- case MLRO review
  - `RETURN_FOR_INVESTIGATION`
  - `APPROVE_FINAL_DISPOSITION`
- case final disposition
  - `CLEAR`
  - `FALSE_POSITIVE`
  - `RISK_CONFIRMED`
- case filing note
  - filing required may be proposed independently from final disposition and workflow proposal

### 2. `workflow = ONBOARDING`, `stage = REVIEW_EDD`

- valid rules
  - `ONB_EDD_REVIEW_REQUIRED`
- alert handling
  - `ASSIGN`
  - `REASSIGN`
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
  - `ESCALATE_TO_CASE`
- alert direct disposition proposals
  - `REJECT`
- alert resolution outcomes
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
- case actions
  - `ASSIGN`
  - `REASSIGN`
  - `LINK_ALERT`
- case interim measures
  - `FREEZE`
  - `UNFREEZE`
  - `RESTRICT`
  - `UNRESTRICT`
- case workflow proposal
  - `CLEAR`
  - `REJECT`
- case MLRO review
  - `RETURN_FOR_INVESTIGATION`
  - `APPROVE_FINAL_DISPOSITION`
- case final disposition
  - `CLEAR`
  - `FALSE_POSITIVE`
  - `RISK_CONFIRMED`
- case filing note
  - filing required may be proposed independently from final disposition and workflow proposal
- audit / trace
  - `REVIEW_EDD + CLEAR` closes case under MLRO gate, moves customer to `FINAL_APPROVAL`, and creates approval under the same onboarding trace
  - alert -> case -> approval MUST remain queryable in `Audit Center` by one `traceId`

## Out of Current Scope

The following are not part of the current onboarding-only mapping:

- transaction/generic `alert / case` rules
- `TX_KYT_*`
- `TX_TRAVEL_RULE_*`
- `TX_COMPLIANCE_*`
- `ONB_CDD_REJECTED`
- `ONB_EDD_REJECTED`
- `ONB_FINAL_REJECTED`
- `ONB_COMPLIANCE_BLOCKED_OR_RESTRICTED`
- `ONB_PEP_HIT`
- `ONB_SANCTIONS_HIT`
- `FINAL_APPROVAL` as an `alert / case` stage

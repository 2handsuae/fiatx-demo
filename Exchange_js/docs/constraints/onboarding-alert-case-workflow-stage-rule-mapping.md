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

- `Work Item Action` controls the container itself.
- `Compliance Action` expresses compliance handling or compliance-driven escalation.
- `Disposition` is conclusion-only and does not include pure state-machine operations.
- `alert / case` are disposition producers; onboarding workflow is the transition consumer.
- `ESCALATE_TO_CASE` is shown under `Compliance Action`.
- `CLOSE` is not a disposition.
- `FREEZE` maps to disposition `RESTRICT`.
- `REPORT` maps to disposition `REPORT`.
- `UNFREEZE` is a `Compliance Action` but does not create a new positive disposition on its own.

## Workflow Transition Consumer

- `REVIEW_CDD`
  - `APPROVE_STAGE -> ACTIVE`
  - `REJECT_STAGE -> REJECTED`
  - `REQUIRE_EDD -> PENDING_EDD`
- `REVIEW_EDD`
  - `APPROVE_STAGE -> FINAL_APPROVAL`
  - `REJECT_STAGE -> REJECTED`
- `ESCALATE_TO_CASE`
  - stays inside compliance center and does **not** advance onboarding workflow
- `RESTRICT / REPORT / FALSE_POSITIVE / NO_ACTION`
  - produce `NO_TRANSITION` for onboarding workflow

## Mapping

### 1. `workflow = ONBOARDING`, `stage = REVIEW_CDD`

- valid rules
  - `ONB_CDD_REVIEW_REQUIRED`
- alert work item actions
  - `ASSIGN`
  - `REASSIGN`
  - `CLOSE`
- alert compliance actions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `REQUIRE_EDD`
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `NO_ACTION`
- alert dispositions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `REQUIRE_EDD`
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `NO_ACTION`
- case work item actions
  - `ASSIGN`
  - `REASSIGN`
  - `LINK_ALERT`
  - `CLOSE`
- case compliance actions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `REQUIRE_EDD`
  - `FREEZE`
  - `UNFREEZE`
  - `REPORT`
  - `FALSE_POSITIVE`
- case dispositions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `REQUIRE_EDD`
  - `RESTRICT`
  - `REPORT`
  - `FALSE_POSITIVE`

### 2. `workflow = ONBOARDING`, `stage = REVIEW_EDD`

- valid rules
  - `ONB_EDD_REVIEW_REQUIRED`
- alert work item actions
  - `ASSIGN`
  - `REASSIGN`
  - `CLOSE`
- alert compliance actions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `NO_ACTION`
- alert dispositions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `ESCALATE_TO_CASE`
  - `FALSE_POSITIVE`
  - `NO_ACTION`
- case work item actions
  - `ASSIGN`
  - `REASSIGN`
  - `LINK_ALERT`
  - `CLOSE`
- case compliance actions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `FREEZE`
  - `UNFREEZE`
  - `REPORT`
  - `FALSE_POSITIVE`
- case dispositions
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `RESTRICT`
  - `REPORT`
  - `FALSE_POSITIVE`

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

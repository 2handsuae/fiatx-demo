Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md`
Source of Truth Level: specs-workflow

# Onboarding Canonical Workflow

## Purpose
- This document defines the canonical onboarding workflow after Wave 2 / Wave 3 completion.

## Actors
- `Customer`
- `Compliance Operator`
- `MLRO`
- `SM`

## Canonical State Model
- `NONE`
- `PENDING_CDD_INPUT`
- `CDD_UNDER_REVIEW`
- `PENDING_EDD_INPUT`
- `EDD_UNDER_REVIEW`
- `FINAL_APPROVAL`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`

## Main Paths
- `CDD evidence submitted`
  - customer completes CDD response
  - system creates a pending `workflowDecisionRecord`
  - customer moves to `CDD_UNDER_REVIEW`
- `ONBOARDING_CDD -> LOW`
  - operator opens `Risk Policy Executions`
  - operator simulates `LOW`
  - no review alert is created
  - customer moves directly to `APPROVED`
- `REVIEW_CDD -> REQUIRE_EDD`
  - workflow-bound alert or case records `REQUIRE_EDD`
  - customer moves to `PENDING_EDD_INPUT`
- `REVIEW_CDD -> CLEAR`
  - workflow-bound alert or case records `CLEAR`
  - customer moves to `APPROVED`
- `REVIEW_EDD -> CLEAR`
  - case closes under MLRO gate
  - customer moves to `FINAL_APPROVAL`
  - `ONBOARDING_FINAL_APPROVAL` is created
- `FINAL_APPROVAL -> APPROVED`
  - approval passes through approvals module
  - customer becomes `APPROVED`
- `REVIEW_CDD / REVIEW_EDD -> REJECT`
  - customer moves to `REJECTED`

## Simulation Operation Chain
- Customer evidence collection stays on client `/verification`:
  - `Bootstrap CDD`
  - `Regenerate Session`
  - `Mock Complete CDD`
  - `Start EDD`
  - `Reinitiate CDD / EDD`
  - `Mock Complete EDD`
- Customer-side mock-complete actions are visible only when shared `Simulation Mode` is enabled.
- `Mock Complete CDD` no longer selects a risk result on the client; it only completes evidence intake and queues a pending `ONBOARDING_CDD` decision record.
- Admin `Risk Policy Executions` becomes the canonical operator surface for final onboarding CDD risk simulation:
  - `Simulate Low`
  - `Simulate Medium`
  - `Simulate High`
- Admin surfaces after evidence collection continue as:
  - `Risk Policy Executions`
  - `Alert Handling`
  - `Case / MLRO`
  - `Final Approval`
  - `Simulate Expired`
- Admin `CDD Response / EDD Response` pages remain evidence-browse surfaces and do not introduce a second onboarding mock-complete entry.

## Response / Alert / Case Binding
- `CDD Response` and `EDD Response` are evidence containers.
- Review-stage workflow decisions are executed through workflow-bound alert or case handling.
- `FINAL_APPROVAL` is a workflow state, not an alert/case stage.

## Audit And Trace
- One onboarding journey uses one trace root:
  - `traceId = ONBOARDING:<journeyId>`
- The same trace must cover:
  - response
  - alert
  - case
  - MLRO
  - final approval

## Non-Goals
- This document does not redefine customer field semantics.
- This document does not replace compliance case lifecycle semantics.

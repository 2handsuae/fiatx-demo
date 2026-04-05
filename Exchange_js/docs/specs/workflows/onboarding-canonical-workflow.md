Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-05
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/specs/workflows/mlro-and-final-approval-governance.md`
Source of Truth Level: specs-workflow

# Onboarding Canonical Workflow

## Purpose
- This document defines the canonical onboarding workflow after the Wave 3 Sumsub redesign.
- Sumsub workflow execution is the verification truth source.
- Customer lifecycle activation is still owned by this system.

## Actors
- `Customer`
- `Sumsub`
- `Compliance Operator`
- `SM`

## Canonical State Model
- `NONE`
- `PENDING_VERIFICATION`
- `FINAL_APPROVAL`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`

## Provider Verification Projection
- Provider verification details are projected from customer fields and are not a second customer lifecycle.
- Current onboarding projection substatus values are:
  - `CREATED`
  - `SUBMITTED`
  - `UNDER_REVIEW`
  - `RESUBMIT_REQUIRED`
  - `NEXT_LEVEL_REQUIRED`
  - `PROCESSING`
  - `COMPLETED`
  - `FAILED`

## Main Paths
- `Verification started`
  - customer calls `POST /onboarding/verification/start`
  - system creates or reuses Sumsub applicant
  - system issues SDK token for the active level
  - customer moves to `PENDING_VERIFICATION`
- `Verification submitted`
  - Sumsub sends `applicantPending`
  - customer remains `PENDING_VERIFICATION`
  - provider substatus becomes `SUBMITTED`
- `Manual review required`
  - Sumsub sends `applicantOnHold`
  - customer remains `PENDING_VERIFICATION`
  - provider substatus becomes `UNDER_REVIEW`
- `Same-level resubmission required`
  - Sumsub sends `applicantReviewed` with `RED + RETRY`
  - customer remains `PENDING_VERIFICATION`
  - provider substatus becomes `RESUBMIT_REQUIRED`
  - customer may continue verification on the same provider workflow
- `Next level required`
  - Sumsub sends `applicantLevelChanged`
  - customer remains `PENDING_VERIFICATION`
  - provider substatus becomes `NEXT_LEVEL_REQUIRED`
  - when the new level is `level2`, customer records `experiencedLevel2 = true`
- `Workflow completed without level2`
  - Sumsub sends `applicantWorkflowCompleted`
  - if customer did not experience `level2`, customer moves directly to `APPROVED`
  - `operatingStatus` becomes `ACTIVE`
- `Workflow completed after level2`
  - Sumsub sends `applicantWorkflowCompleted`
  - if customer experienced `level2`, customer moves to `FINAL_APPROVAL`
  - system auto-creates pending `ONBOARDING_FINAL_APPROVAL`
- `Legacy EDD compatibility path`
  - legacy review-stage onboarding path may still move customer from `REVIEW_EDD` to `FINAL_APPROVAL`
  - this is compatibility runtime residue and is not the active provider-first canonical path
- `Final approval -> approved`
  - approval passes through approvals module
  - customer becomes `APPROVED`
  - `operatingStatus` becomes `ACTIVE`
- `Workflow failed`
  - Sumsub sends `applicantWorkflowFailed`
  - customer moves to `REJECTED`
- `Final approval -> rejected`
  - approval rejects through approvals module
  - customer moves to `REJECTED`
- `Reinitiation`
  - in the active provider-first flow, rejected or withdrawn customers may reinitiate verification
  - reinitiation clears the latest final approval binding and resets provider review projection
- `Expiry compatibility`
  - approved-customer expiry still falls back to a legacy raw pending state in the current runtime
  - provider-first expiry re-entry is a follow-up cleanup item

## Simulation Operation Chain
- Customer `/verification` is the provider-backed onboarding surface:
  - `Start Verification`
  - `Continue Verification`
  - `Wait Review`
  - `Wait Final Approval`
  - `Reinitiate Verification`
- Real provider callbacks enter from:
  - `POST /onboarding/sumsub/webhook`
- Development simulation enters from:
  - `POST /onboarding/sumsub/simulate`
- Real webhook and simulation MUST reuse the same onboarding event handler.
- Customer-side simulation submits a compact DTO and controller code converts it into a Sumsub-style webhook payload before dispatch.
- Legacy response bootstrap/session/mock-complete endpoints may remain for compatibility, but they are not part of the active canonical onboarding path.

## Response / Alert / Case Binding
- Sumsub workflow is the active verification truth source.
- `CDD Response` and `EDD Response` remain legacy evidence containers and compatibility browse surfaces.
- Onboarding alert/case routing is no longer the canonical verification path.
- `FINAL_APPROVAL` is still a workflow state, but it is created only after `level2` was experienced and the provider workflow completed successfully.
- Legacy EDD review compatibility may still reach `FINAL_APPROVAL` until the old transition path is fully retired.
- Compatibility `finalApprovalStatus` remains a projection field only and is not the canonical onboarding state machine.

## Audit And Trace
- One onboarding journey uses one trace root:
  - `traceId = ONBOARDING:<journeyId>`
- The same trace root is reserved for:
  - provider-backed onboarding lifecycle
  - final approval when applicable
- In the current runtime, final-approval audit is explicitly emitted on the canonical onboarding trace.
- Provider verification start, webhook progression, and workflow terminal audit coverage is part of the ongoing Wave 3 foundation reset and is not yet fully emitted by the current runtime.
- Optional alert/case/governance investigation objects may still inherit the same trace, but they are no longer required canonical onboarding stages.

## Non-Goals
- This document does not redefine customer field semantics.
- This document does not redefine periodic review workflow semantics.
- This document does not require legacy response/session compatibility endpoints to remain part of the active onboarding UI.

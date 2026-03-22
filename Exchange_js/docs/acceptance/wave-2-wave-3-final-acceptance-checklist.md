Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`, `docs/specs/entities/compliance-case-entity.md`, `docs/specs/entities/customer-entity.md`
Source of Truth Level: acceptance

# Wave 2 / Wave 3 Final Acceptance Checklist

## Purpose
- This document is the final cross-wave operator runbook for Wave 2 compliance center kernel and Wave 3 onboarding / periodic review runtime.
- It teaches testers, operators, and demo owners how to validate the current finished runtime without relying on archived cleanup context.

## Audience
- QA / UAT operator
- product demo owner
- engineering smoke-check owner

## Environment Baseline
- API, admin web, and client web are up and healthy.
- Admin operator can access:
  - `Alerts`
  - `Cases`
  - `Approvals`
  - `Audit Center`
- Customer/operator test data can trigger:
  - onboarding CDD
  - onboarding EDD
  - periodic review
  - MLRO review
  - external filing follow-up

## Required Companion Docs
- Workflow truth:
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - `docs/specs/workflows/alert-triage-and-case-escalation.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- Entity truth:
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/compliance-case-entity.md`
  - `docs/specs/entities/compliance-case-report-entity.md`
  - `docs/specs/entities/compliance-external-filing-entity.md`
- Module usage:
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/periodic-review-module.md`
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/specs/modules/approvals-module.md`
  - `docs/specs/modules/audit-logging-module.md`

## Core Chains
1. `LOW_RISK CDD -> APPROVED`
2. `REVIEW_CDD -> REQUIRE_EDD`
3. `REVIEW_EDD -> CLEAR -> FINAL_APPROVAL`
4. `FINAL_APPROVAL -> APPROVED`
5. `REVIEW_EDD -> REJECT`
6. `Periodic Review Due -> Restrict -> Review -> Clear`
7. `MLRO + External Filing`
8. `Audit Center` trace replay

## Validation Steps

### 1. Low-Risk Onboarding Auto-Pass
- Trigger onboarding `CDD Response` with low-risk profile.
- Confirm:
  - no workflow-bound review alert is created
  - customer moves to `onboardingStatus = APPROVED`
  - customer moves to `operatingStatus = ACTIVE`
  - no final approval is created

### 2. Onboarding CDD Requires EDD
- Trigger onboarding `CDD Response` with review outcome that recommends `REQUIRE_EDD`.
- In `Alerts`, assign the onboarding review alert to the current operator.
- Execute workflow action `REQUIRE_EDD`.
- Confirm:
  - customer moves to `PENDING_EDD_INPUT`
  - `EDD Response` can be started or reused
  - no onboarding final approval exists yet

### 3. Onboarding EDD Clear To Final Approval
- Complete `EDD Response` and drive review to `CLEAR`.
- If triage escalates to case, verify investigator path on the case; if triage resolves on the alert, verify direct workflow transition.
- For case path, finalize report and submit to MLRO.
- As MLRO, approve final disposition.
- Confirm:
  - case closes immediately after MLRO approval
  - customer moves to `FINAL_APPROVAL`
  - exactly one `ONBOARDING_FINAL_APPROVAL` is created
  - approval carries the same onboarding workflow trace

### 4. Final Approval To Approved
- Open the created approval in `Approvals`.
- Approve it as the correct checker role.
- Confirm:
  - customer moves to `APPROVED`
  - customer `operatingStatus = ACTIVE`
  - approval status is terminal and auditable

### 5. Onboarding Reject Paths
- Validate both:
  - `REVIEW_CDD -> REJECT`
  - `REVIEW_EDD -> REJECT`
- Confirm:
  - customer ends in `REJECTED`
  - no onboarding final approval is created for rejected flows
  - audit trail remains on one onboarding trace

### 6. Periodic Review Due To Restrict To Clear
- Trigger periodic review due processing for a customer.
- Confirm:
  - a `PeriodicReviewCycle` exists
  - customer becomes restricted according to cycle policy
  - workflow-bound alert/case is created on the same periodic-review trace
- Complete the review path to `CLEAR`.
- Confirm:
  - restriction is released according to current review outcome rules
  - cycle reaches resolved state
  - onboarding status is not rewritten by periodic review

### 7. MLRO And External Filing
- Use a case path that requires MLRO review and external filing.
- Finalize report, submit to MLRO, approve final disposition.
- If filing is required, continue through submit / acknowledge / return / close actions.
- Confirm:
  - `Case Report` remains separate from `External Filing`
  - filing status and filing actions come from canonical filing model only
  - historical `report*` mirror fields do not drive current filing UI behavior

### 8. Audit Center Trace Replay
- For one onboarding journey, query `Audit Center` by:
  - `traceId = ONBOARDING:<journeyId>`
  - or `workflowType + workflowNo`
- Confirm replay covers:
  - response events
  - alert or case triage
  - MLRO review when applicable
  - onboarding final approval
- For one periodic review cycle, query `Audit Center` by:
  - `traceId = PERIODIC_REVIEW:<cycle.id>`
  - or `workflowType + workflowNo`
- Confirm replay covers:
  - cycle events
  - response events
  - alert/case events
  - final disposition
  - filing follow-up when present

## Minimum Verification
- Wave 2 alert / case / MLRO / filing uses canonical contract only.
- Wave 3 onboarding / periodic review uses canonical response identity and canonical customer status only.
- `/cases/**` is the only active runtime case surface.
- `Audit Center` can replay:
  - onboarding `response -> alert -> case -> MLRO -> approval`
  - periodic review `cycle -> response -> alert -> case -> final disposition`

## Expected Results
- `Response` is treated as evidence container, not as compliance case.
- `Case Report` is treated as independent investigation record.
- `External Filing` is treated as independent follow-up object.
- `Approvals` only govern final approval or other explicit governance objects; they do not replace customer lifecycle itself.
- Historical aliases such as `incidentNo`, `ownerUserId`, `publicStatus`, `caseNo/caseType` response aliases, and `onboarding_audit_logs` are not needed to complete runtime validation.

## Pass Criteria
- Historical mirrors may still exist in storage or archived docs, but they do not drive active runtime meaning.
- A new engineer or tester can validate the full flow by reading:
1. this acceptance document
2. the referenced workflow/entity/module docs
without needing archived cleanup documents or chat context.

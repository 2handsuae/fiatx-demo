# Onboarding Flow Constraints

## 1) Scope and Ownership
- Scope module: `src/modules/identity/onboarding/**`.
- Customer endpoints under `/onboarding/**`.
- Provider webhook endpoints under `/onboarding/sumsub/**`.
- Customer and admin authority MUST remain separated by token type.
- This document follows current implementation names.
- Sumsub workflow is the verification truth source for active onboarding runtime.

## 1.1) Related Canonical Docs
- Workflow truth:
1. `docs/specs/workflows/onboarding-canonical-workflow.md`
2. `docs/specs/workflows/mlro-and-final-approval-governance.md`
3. `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- Entity truth:
1. `docs/specs/entities/customer-entity.md`
2. `docs/specs/entities/review-response-entity.md`
3. `docs/specs/entities/approval-case-entity.md`
- Module integration truth:
1. `docs/specs/modules/customer-onboarding-module.md`
2. `docs/specs/modules/approvals-module.md`

## 2) Canonical Identities
- Active onboarding runtime MUST treat these as primary identities:
1. `customer`
2. `sumsub applicant`
3. `verification projection`
4. `approval`
- Legacy onboarding evidence identities MAY remain for compatibility and browse use cases:
1. `cddResponse`
2. `eddResponse`
3. `workflowDecisionRecord`
4. `alert`
5. `case`
- Final approval MUST be approval-backed and projected back to customer lifecycle.
- Approval runtime semantics are defined by the approvals module; onboarding MUST consume approval result projection instead of inventing a second final-review lifecycle.

## 3) Next-Step Contract
- `getNextStep` is the single source for onboarding guidance.
- Contract output MUST be:
1. `actions[]`
2. `blockedReason`
3. `activeCaseId`
4. `requiresEdd`
5. `verification`
- Allowed action types:
1. `START_VERIFICATION`
2. `CONTINUE_VERIFICATION`
3. `WAIT_VERIFICATION`
4. `WAIT_FINAL_APPROVAL`
5. `REINITIATE_VERIFICATION`
6. `NONE`
- `verification` MUST remain the active provider read model and include:
1. `provider`
2. `applicantId`
3. `currentLevelName`
4. `latestReviewId`
5. `latestAttemptId`
6. `substatus`
7. `customerActionRequired`
8. `canContinue`
9. `latestEventType`
10. `latestEventAt`
11. `experiencedLevel2`
- `activeCaseId` MAY remain present for backward compatibility but is not the primary Sumsub workflow driver.
- MUST NOT add competing next-step logic in controller or frontend page layers.
- Frontend MAY use `actions[]`, `blockedReason`, and `verification`, but onboarding primary state MUST be derived from canonical customer fields.
- Legacy compatibility paths MAY still emit historical next-step actions while the old flow remains readable.

## 4) State Machine Constraints
- Customer lifecycle MUST stay progress-only:
1. `NONE -> PENDING_VERIFICATION -> APPROVED`
2. `NONE -> PENDING_VERIFICATION -> FINAL_APPROVAL -> APPROVED`
- Customer terminal status MUST stay:
1. `REJECTED`
2. `WITHDRAWN`
- `FINAL_APPROVAL` MUST only be reachable when provider workflow completed after the customer experienced `level2`.
- Legacy EDD compatibility transition MAY still reach `FINAL_APPROVAL`; this is cleanup residue and not the active provider-first path.
- `applicantWorkflowCompleted` without `level2` experience MUST move customer directly to `APPROVED + ACTIVE`.
- `applicantWorkflowFailed` MUST move customer to `REJECTED + INACTIVE`.
- Legacy raw onboarding states such as `PENDING_CDD_INPUT`, `CDD_UNDER_REVIEW`, `PENDING_EDD_INPUT`, and `EDD_UNDER_REVIEW` MAY still be recognized for normalization or compatibility, but active runtime MUST NOT transition back into them.
- Approved-customer expiry currently remains a compatibility exception and still falls back to a legacy raw pending state until provider-first expiry re-entry is implemented.
- State fields MUST express customer lifecycle only, not provider step-by-step detail.

## 5) Provider Verification Constraints
- Active onboarding verification MUST be driven by Sumsub workflow events.
- `startVerification` MUST:
1. create or reuse applicant
2. issue SDK token
3. move customer to `PENDING_VERIFICATION`
- Current onboarding-driving provider events are:
1. `applicantPending`
2. `applicantOnHold`
3. `applicantReviewed`
4. `applicantLevelChanged`
5. `applicantWorkflowCompleted`
6. `applicantWorkflowFailed`
- `applicantReviewed + RED + RETRY` MUST map to:
1. customer stays `PENDING_VERIFICATION`
2. `verification.substatus = RESUBMIT_REQUIRED`
3. `verification.canContinue = true`
- `applicantLevelChanged` MUST map to:
1. customer stays `PENDING_VERIFICATION`
2. `verification.substatus = NEXT_LEVEL_REQUIRED`
3. `sumsubExperiencedLevel2 = true` only when the new level is `level2`
- Unsupported or non-terminal provider events MAY be projected as `PROCESSING`, but they MUST NOT invent new customer lifecycle states.
- Starting verification MUST be rejected for:
1. `APPROVED`
2. `FINAL_APPROVAL`
3. invalid raw legacy onboarding states

## 6) Legacy Response / Session Compatibility
- `CDD Response` and `EDD Response` remain legacy evidence containers only.
- Response/session completion MUST NOT be treated as the active canonical onboarding pass/fail signal.
- Legacy bootstrap/reinitiate/session/mock-complete endpoints MAY remain for compatibility, fixtures, or archived cleanup context.
- Active onboarding UI MUST NOT depend on legacy response/session mock-complete flow.
- Legacy review-stage transitions MAY still write raw onboarding statuses as compatibility residue until fully removed.

## 7) Final Approval Constraints
- Final approval MUST remain approval-backed.
- Only onboarding workflows that completed after `level2` experience MAY auto-create `ONBOARDING_FINAL_APPROVAL`.
- Approval submit / approve / reject MUST stay inside approvals module semantics.
- Final approval rejection MUST resolve customer to `REJECTED`.
- Final approval MUST NOT be created for `level1`-only workflow completion.

## 8) Trading Gate and Legacy Snapshot
- Trading eligibility gate MUST use canonical customer state:
1. `onboardingStatus = APPROVED`
2. `operatingStatus = ACTIVE`
3. `restrictionStatus != RESTRICTED`
4. `complianceHoldStatus != FROZEN`
- Legacy fields (`complianceStatus`, `cddStatus`, `eddStatus`) have been removed from customer schema/payload and MUST NOT be reintroduced as customer lifecycle truth.
- Provider-first reinitiation via `startVerification` currently applies to rejected/withdrawn scenarios.
- Expired approved customers still follow the legacy compatibility path until provider-first expiry handling is implemented.

## 9) Auditability (Mandatory)
- Canonical onboarding / periodic review audit store MUST be `audit_log_events`.
- `onboarding_audit_logs` is historical compatibility residue only and MUST NOT be treated as:
1. canonical source for trace queries
2. canonical source for evidence export
3. active runtime audit truth
- Workflow-bound onboarding trace root MUST remain:
1. `workflowType = ONBOARDING`
2. `workflowId = journeyId`
3. `workflowNo = journeyId`
4. `traceId = ONBOARDING:<journeyId>`
- Key onboarding actions SHOULD write canonical audit events with:
1. actor id/role
2. customer id
3. provider object identifiers when applicable
4. from/to lifecycle state when applicable
5. detail payload
- Current runtime MUST include:
1. final approval submitted / approved / rejected when applicable
- Verification-start and provider-webhook audit emission is a remaining Wave 3 foundation reset follow-up and is not yet mandatory in the current implementation.

## 10) Thread Delivery Checklist (Onboarding)
- `getNextStep` contract changes explicitly versioned/documented when touched.
- Customer/provider transition handling validated with tests.
- Webhook simulation and real webhook reuse the same handler.
- Audit log records verified for critical actions.
- `Audit Center` trace query verified for onboarding flow when work touches:
1. final approval
2. provider-event replay only when that audit gap is explicitly closed in the same work
- Cross-module read-model stability verified for `GET /customers/:id` onboarding snapshot fields:
1. canonical customer status fields
2. `verification`
3. legacy response projections only where still intentionally exposed

## 11) Client Verification Projection Rules
- Client `/verification` UI MUST treat canonical customer fields as the primary onboarding state source.
- `getNextStep` MAY still be consumed for action guidance, `blockedReason`, and `verification`, but MUST NOT be treated as a second independent onboarding state machine.
- Client `/verification` MUST remain the provider-backed start / continue / wait surface.
- Shared `Simulation Mode` MUST gate customer-side Sumsub event simulation on `/verification`.
- When shared `Simulation Mode` is disabled, `/verification` MUST NOT expose Sumsub simulation actions.
- Projection baseline MUST keep these canonical mappings:
1. `onboardingStatus = NONE` -> `START_VERIFICATION`
2. `onboardingStatus = PENDING_VERIFICATION` and `verification.canContinue = true` -> `CONTINUE_VERIFICATION`
3. `onboardingStatus = PENDING_VERIFICATION` and `verification.canContinue != true` -> `WAIT_VERIFICATION`
4. `onboardingStatus = FINAL_APPROVAL` -> `WAIT_FINAL_APPROVAL`
5. `onboardingStatus = REJECTED | WITHDRAWN` -> `REINITIATE_VERIFICATION`
6. `onboardingStatus = APPROVED` and `operatingStatus = ACTIVE` -> terminal completion and client redirect
- Legacy projection actions such as `COMPLETE_CDD`, `WAIT_REVIEW`, and `COMPLETE_EDD` may still appear through compatibility runtime residue and MUST NOT be treated as the active provider-first path.
- Provider projection guidance MUST follow:
1. `substatus = CREATED | RESUBMIT_REQUIRED | NEXT_LEVEL_REQUIRED` -> customer may continue verification
2. `substatus = SUBMITTED | UNDER_REVIEW | PROCESSING` -> customer waits
3. `substatus = COMPLETED` with `onboardingStatus = FINAL_APPROVAL` -> customer waits for final approval
4. `substatus = FAILED` -> customer may reinitiate only after lifecycle moves to `REJECTED` or `WITHDRAWN`

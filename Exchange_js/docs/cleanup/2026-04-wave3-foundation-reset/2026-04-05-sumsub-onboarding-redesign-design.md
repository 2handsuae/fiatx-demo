# Wave 3 Onboarding Sumsub Redesign

Date: 2026-04-05
Status: Draft reviewed with user
Scope: `Wave 3 onboarding canonical workflow`, `Sumsub-backed verification`, `Final approval retention`, `onboarding-only simulation`

## 1. Goal

Redesign Wave 3 onboarding so that Sumsub becomes the verification workflow truth for onboarding, while this system retains:

- customer lifecycle truth
- final approval governance
- audit trace
- customer-facing onboarding projection

This redesign intentionally replaces the current `CDD/EDD response -> pending decision record -> alert/case -> final approval` onboarding path with:

- `Sumsub workflow in progress`
- `Sumsub workflow completed`
- `Sumsub workflow failed`
- optional local `FINAL_APPROVAL` only for applicants that passed `level2`

The target outcome is:

- onboarding no longer models `CDD` and `EDD` as canonical customer runtime stages
- `level1`, `level2`, retry, manual review, and applicant action become provider-side verification details
- the platform remains unavailable while Sumsub verification is still in progress
- only `level2 clear` leads to local `FINAL_APPROVAL`
- `level1-only clear` can directly activate the customer

## 2. Non-Goals

This redesign does not include:

- periodic review refactor
- deposit, withdraw, or swap Sumsub integration
- replacing all historical `cddResponse / eddResponse` physical tables in one step
- removing old risk-engine, alert, or case code outside onboarding
- introducing a shared cross-domain Sumsub platform module
- production-ready Sumsub credentials or live provider connectivity

The first implementation slice is onboarding-only.

## 3. Current Problem

Current Wave 3 onboarding assumes:

- `CDD Response` and `EDD Response` are canonical evidence containers
- customer state progresses through:
  - `PENDING_CDD_INPUT`
  - `CDD_UNDER_REVIEW`
  - `PENDING_EDD_INPUT`
  - `EDD_UNDER_REVIEW`
  - `FINAL_APPROVAL`
- provider completion only means evidence intake
- local risk simulation and local alert/case handling decide the final onboarding route

This no longer matches the intended Sumsub architecture.

Under Sumsub:

- verification routing, retry, manual review, level change, and applicant action are provider-side workflow details
- local onboarding should not model provider-internal stages as canonical customer states
- the platform should wait for Sumsub workflow completion, not a local fake `CDD/EDD` chain

## 4. Canonical Redesign

### 4.1 New canonical onboarding state model

Replace the Wave 3 onboarding runtime states with:

- `NONE`
- `PENDING_VERIFICATION`
- `FINAL_APPROVAL`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`

Canonical main path:

- `NONE -> PENDING_VERIFICATION -> APPROVED`
- `NONE -> PENDING_VERIFICATION -> FINAL_APPROVAL -> APPROVED`

Canonical terminal states:

- `REJECTED`
- `WITHDRAWN`

### 4.2 Verification routing rule

Provider-side verification details do not become canonical customer states.

These concepts stay provider-side only:

- `level1`
- `level2`
- retry / resubmission
- manual review
- applicant action
- provider pending / awaiting service

They are exposed to the product only through a customer-facing verification projection.

### 4.3 Final approval rule

`FINAL_APPROVAL` is retained, but only for customers that:

- entered `level2`
- and ultimately passed that verification path

Rules:

- if Sumsub workflow completes after `level1` only:
  - customer moves directly to `APPROVED`
  - `operatingStatus = ACTIVE`
- if Sumsub workflow completes after `level2`:
  - customer moves to `FINAL_APPROVAL`
  - local approval flow remains required
- if Sumsub workflow fails:
  - customer moves to `REJECTED`

This preserves local governance while removing fake local `CDD/EDD` state-machine ownership.

## 5. Provider Event Model

### 5.1 Verification truth source

For onboarding, the primary provider-side inputs become Sumsub user verification events:

- `applicantCreated`
- `applicantPending`
- `applicantPrechecked` (optional)
- `applicantOnHold`
- `applicantAwaitingService`
- `applicantAwaitingUser`
- `applicantReviewed`
- `applicantLevelChanged`
- `applicantStepsReset`
- `applicantActionPending`
- `applicantActionOnHold`
- `applicantActionReviewed`
- `applicantWorkflowCompleted`
- `applicantWorkflowFailed`

The local system must treat:

- `applicantReviewed` as current-level result
- `applicantLevelChanged` as transition to a new verification level
- `applicantWorkflowCompleted / Failed` as workflow-level termination

### 5.2 Canonical provider-to-business mapping

| Sumsub event | Meaning | Local onboarding state | Local verification projection |
|---|---|---|---|
| `applicantCreated` | applicant exists | `PENDING_VERIFICATION` once onboarding starts | `CREATED` |
| `applicantPending` | current level submitted | `PENDING_VERIFICATION` | `SUBMITTED` |
| `applicantPrechecked` | optional precheck | `PENDING_VERIFICATION` | `PROCESSING` |
| `applicantAwaitingService` | waiting on external service | `PENDING_VERIFICATION` | `PROCESSING` |
| `applicantOnHold` | manual review | `PENDING_VERIFICATION` | `UNDER_REVIEW` |
| `applicantAwaitingUser` | user must continue action | `PENDING_VERIFICATION` | `CUSTOMER_ACTION_REQUIRED` |
| `applicantReviewed + RED + RETRY` | resubmit same level | `PENDING_VERIFICATION` | `RESUBMIT_REQUIRED` |
| `applicantLevelChanged` | next level entered | `PENDING_VERIFICATION` | `NEXT_LEVEL_REQUIRED` |
| `applicantActionPending` | extra action started | `PENDING_VERIFICATION` | `CUSTOMER_ACTION_REQUIRED` |
| `applicantActionOnHold` | extra action manually reviewed | `PENDING_VERIFICATION` | `ACTION_UNDER_REVIEW` |
| `applicantWorkflowCompleted` after `level1` only | onboarding verification fully clear | `APPROVED` | `COMPLETED` |
| `applicantWorkflowCompleted` after `level2` | provider verification clear, governance still required | `FINAL_APPROVAL` | `COMPLETED` |
| `applicantWorkflowFailed` | provider verification failed | `REJECTED` | `FAILED` |

### 5.3 Important rule

The system must not treat `applicantReviewed + GREEN` as onboarding completion by itself.

Reason:

- `applicantReviewed` only closes the current level
- the workflow may still continue to another level
- the true onboarding termination is `applicantWorkflowCompleted / Failed`

## 6. New Customer-Facing Projection

### 6.1 Projection purpose

The customer `/verification` UI still needs rich onboarding feedback even though canonical customer state becomes simpler.

Therefore onboarding must expose a verification projection separate from canonical customer status.

### 6.2 Proposed projection fields

Minimum runtime projection:

- `provider = SUMSUB`
- `applicantId`
- `currentLevelName`
- `latestReviewId`
- `latestAttemptId`
- `latestWorkflowName` if available
- `substatus`
- `customerActionRequired`
- `canContinue`
- `latestEventType`
- `latestEventAt`
- `experiencedLevel2`

### 6.3 Verification substatus enum

Recommended onboarding projection enum:

- `NOT_STARTED`
- `CREATED`
- `SUBMITTED`
- `PROCESSING`
- `UNDER_REVIEW`
- `RESUBMIT_REQUIRED`
- `NEXT_LEVEL_REQUIRED`
- `CUSTOMER_ACTION_REQUIRED`
- `ACTION_UNDER_REVIEW`
- `COMPLETED`
- `FAILED`

This projection is not a replacement for canonical customer lifecycle. It is a UI and operational read model.

## 7. Local Data Ownership

### 7.1 Keep

The local system must keep:

- `customer.onboardingStatus`
- `customer.operatingStatus`
- `customer.restrictionStatus`
- final approval records
- audit trace
- Sumsub identity mapping
- latest provider event snapshot
- verification projection data needed for UI and troubleshooting

When onboarding is explicitly re-initiated from `REJECTED` or `WITHDRAWN`, the local system must clear provider run-specific projection fields from the previous run before starting the new one. That includes:

- `latestReviewId`
- `latestAttemptId`
- `latestEventType`
- `latestEventAt`

### 7.2 De-emphasize

The local system must stop treating these as onboarding runtime truth:

- `cddResponse`
- `eddResponse`
- local onboarding decision record as provider-result interpreter
- onboarding alert/case chain for provider-internal review routing

Historical tables may remain temporarily for compatibility and migration, but they are no longer canonical onboarding control objects.

## 8. Minimal Integration Architecture

This redesign intentionally does not introduce a full Wave 2 replacement platform layer.

### 8.1 Thin shared components

Create only two thin onboarding-scoped building blocks:

1. `SumsubClient`
- responsibility:
  - request signing
  - authentication
  - minimal onboarding API calls
- initial methods:
  - `createApplicant`
  - `createSdkToken`
  - `getApplicantReviewStatus`
  - `changeLevel`

2. `OnboardingSumsubWebhookController`
- responsibility:
  - accept Sumsub user verification webhooks
  - verify signature
  - normalize transport envelope
  - dispatch event to onboarding service

No shared cross-domain translation middleware is required in v1.

### 8.2 Business ownership

`OnboardingService` remains the owner of:

- starting onboarding verification
- updating customer lifecycle
- deciding whether workflow completion goes to `APPROVED` or `FINAL_APPROVAL`
- writing audit events
- maintaining the customer-facing verification projection

## 9. Simulation Strategy

### 9.1 Why simulation changes

The current onboarding simulation is session-based:

- bootstrap response
- create mock session
- mock-complete session
- create local decision record

That simulation no longer matches the new provider-first onboarding design.

### 9.2 New simulation rule

Simulation must mimic Sumsub webhooks, not fake response-session completion.

### 9.3 New simulation component

Add:

- `OnboardingSumsubSimulationController`

Responsibility:

- accept a small set of predefined Sumsub onboarding events in Simulation Mode
- generate a payload compatible with the real webhook handler
- call the same internal event-processing path as the real webhook controller

### 9.4 Supported simulated events

Minimum simulation event set:

- `applicantPending`
- `applicantOnHold`
- `applicantReviewed(GREEN)`
- `applicantReviewed(RED + RETRY)`
- `applicantReviewed(RED + FINAL)`
- `applicantLevelChanged`
- `applicantWorkflowCompleted`
- `applicantWorkflowFailed`

### 9.5 Hard rule

Simulation must not mutate onboarding state through a side path.

Both:

- real Sumsub webhook
- simulated Sumsub event

must end in the same onboarding event handler.

## 10. Audit and Trace

The redesign keeps existing onboarding trace semantics:

- `traceId = ONBOARDING:<journeyId>`

But provider events become part of that trace.

Mandatory audit writes:

- onboarding verification started
- Sumsub applicant created
- Sumsub webhook received
- provider event applied
- level changed
- workflow completed
- workflow failed
- final approval created
- final approval passed / failed

## 11. Required Documentation Changes

The redesign requires updating these canonical docs:

- `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
- `docs/specs/modules/customer-onboarding-module.md`
- `docs/specs/workflows/onboarding-canonical-workflow.md`
- `docs/constraints/onboarding-flow-constraints.md`
- `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`

Key changes to reflect:

- remove `CDD/EDD` as canonical onboarding stages
- define Sumsub workflow as verification truth
- retain `FINAL_APPROVAL` only after `level2`
- replace session/mock-complete centric onboarding semantics with webhook-driven semantics

## 12. Required Code Changes

Initial implementation slice should touch only onboarding:

- `src/modules/identity/onboarding/onboarding.module.ts`
- `src/modules/identity/onboarding/onboarding.service.ts`
- add `src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`
- add `src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts`
- add `src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts`
- update onboarding tests to cover webhook-driven state transitions

### 12.1 Compatibility expectation

The first slice may temporarily keep old entities and endpoints alive, but:

- new onboarding start path should be Sumsub applicant/workflow-driven
- old mock response session path should be marked legacy and stop being the canonical onboarding progression path

## 13. Migration Notes

### 13.1 Customer lifecycle migration

Current customer rows in:

- `PENDING_CDD_INPUT`
- `CDD_UNDER_REVIEW`
- `PENDING_EDD_INPUT`
- `EDD_UNDER_REVIEW`

must be reinterpreted under the new model.

Initial migration rule for active development is:

- any non-terminal pre-approval onboarding state maps to `PENDING_VERIFICATION`

### 13.2 Experienced level2

Because `FINAL_APPROVAL` depends on whether the customer passed `level2`, the system must persist a stable flag such as:

- `experiencedLevel2`
- or equivalent provider projection evidence

This must not be inferred only from the latest event at read time.

## 14. Acceptance Criteria

The redesign is complete when:

- onboarding canonical docs consistently describe `PENDING_VERIFICATION` instead of `CDD/EDD` customer stages
- `level1 clear` does not grant platform access if workflow continues
- `applicantWorkflowCompleted` after `level1` only moves customer directly to `APPROVED`
- `applicantWorkflowCompleted` after `level2` moves customer to `FINAL_APPROVAL`
- `applicantWorkflowFailed` moves customer to `REJECTED`
- real and simulated Sumsub events share one processing path
- customer `/verification` can show verification progress without reading old `CDD/EDD` stage semantics
- existing final approval governance remains intact

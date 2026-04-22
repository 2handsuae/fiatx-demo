# Sumsub Webhook Ingestion Workflow

Wave: 2/3 | Source verified: src/modules/sumsub-ingestion/sumsub-ingestion.service.ts, admin-sumsub-simulation.controller.ts, sumsub-ingestion.controller.ts, sumsub-ingestion-admin.controller.ts, sumsub-ingestion-retry.service.ts, dto/sumsub-ingestion.dto.ts
Last Updated: 2026-04-21

## Purpose

Receive, persist, deduplicate, and route Sumsub webhook events to the correct domain handler (onboarding, AML assessment, material refresh, or tier upgrade).

## Actors / Systems

| Actor | Role |
|---|---|
| Sumsub | External KYC/AML provider; sends signed webhook POSTs |
| SumsubIngestionController | Verifies signature and calls ingest() |
| SumsubIngestionService | Persists event record, deduplicates, dispatches to domain handler |
| OnboardingService | Handles verification events for PENDING_VERIFICATION customers |
| ClientRiskAssessmentService | Handles AML check results and spontaneous AML hits |
| MaterialRefreshService | Handles ongoing doc-monitoring fire and action review results |
| TierUpgradeCaseService | Handles Level 2 workflow completion for restricted customers |
| SumsubRetryService | Cron job: retries FAILED events every 2 minutes (max 3 attempts) |
| AdminSumsubSimulationController | Allows admins to fire simulated events without a real Sumsub integration |

## Event Status State Machine

| Status | Meaning | Transitions to |
|---|---|---|
| PENDING | Event persisted, not yet dispatched | PROCESSED, FAILED |
| PROCESSED | Dispatch succeeded | (terminal) |
| FAILED | Dispatch threw, retry eligible (retryCount < 3) | PROCESSED, DEAD |
| DEAD | 3 failed attempts exhausted | FAILED (via admin replay) |

## Dispatch Routing (5 Clues, evaluated in order)

| Priority | Clue | Condition | Handler | dispatchedContext |
|---|---|---|---|---|
| 1 | reviewMode | `reviewMode === 'ongoingDocExpired'` | `MaterialRefreshService.handleSumsubDocMonitoringFire` | MATERIAL_REFRESH_MONITORING |
| 2 | inspectionId | `inspectionId` matches a `ClientRiskAssessment` with status `PENDING_SUMSUB_RESULT` | `ClientRiskAssessmentService.handleSumsubAmlResult` | AML_ASSESSMENT |
| 3 | actionId | `actionId` matches a `MaterialRefreshCycle` with status `PENDING_CUSTOMER_EVIDENCE` or `PENDING_SUMSUB_REVIEW` | `MaterialRefreshService.handleSumsubActionResult` | MATERIAL_REFRESH_ACTION |
| 4a | applicantId → PENDING_VERIFICATION customer | Customer found by `sumsubApplicantId` and `onboardingStatus === 'PENDING_VERIFICATION'` | `OnboardingService.handleSumsubVerificationEvent` | ONBOARDING |
| 4b | applicantId → APPROVED + RESTRICTED + applicantWorkflowCompleted | Customer is APPROVED + RESTRICTED and event type is `applicantWorkflowCompleted` | `TierUpgradeCaseService.handleLevel2WorkflowComplete` | TIER_UPGRADE |
| 5 | spontaneous AML hit | Customer is APPROVED + event is `applicantReviewed` + reviewAnswer=RED | `ClientRiskAssessmentService.recordAssessmentFromKnownAmlResult` | AML_ASSESSMENT |

Note: Clues 1–3 are checked before applicantId lookup. Clue 3 does not block clue 2 (uses `if (!result && ...)` guard). Unmatched events are logged as warnings and left with status PROCESSED (no domain action taken).

## Deduplication

Real (non-simulated) events are deduplicated by key `type:applicantId:externalUserId:reviewId:attemptId`. If an identical PROCESSED event already exists, the duplicate is returned without re-dispatching. Simulated events skip dedup so admins can re-run scenarios freely.

## Retry Policy

- Cron: every 2 minutes (`*/2 * * * *`, Asia/Dubai TZ)
- Exponential backoff: attempt 1 → 30 s, attempt 2 → 5 min, attempt 3 → 30 min
- After 3 failures the event becomes DEAD. Admin must call `POST /admin/sumsub-events/:id/replay` to retry.

## Simulation Scenarios (SimulationScenario enum)

| Scenario | Webhook Event Type | reviewResult |
|---|---|---|
| LOW_RISK_PASS | `applicantWorkflowCompleted` | GREEN / FINAL |
| MANUAL_REVIEW | `applicantOnHold` | — |
| RESUBMIT_REQUIRED | `applicantReviewed` | RED / RETRY |
| EDD_ESCALATE | `applicantLevelChanged` | levelName: level2 |
| EDD_PASS | `applicantWorkflowCompleted` | GREEN / FINAL (requires prior EDD_ESCALATE) |
| WORKFLOW_FAIL | `applicantWorkflowFailed` | RED / FINAL |

## Flow

1. Sumsub POSTs to `POST /webhooks/sumsub` with `x-payload-digest` and `x-payload-digest-alg` headers.
2. `SumsubIngestionController` verifies HMAC signature via `SumsubClient.verifyWebhookSignature`. Rejects with 401 if invalid.
3. `ingest()` is called with `isSimulated: false`.
4. Event record is created in `SumsubWebhookEvent` table with status PENDING and `eventNo` prefixed `SWH`.
5. Deduplication check runs against PROCESSED events with same type+applicantId+reviewId+attemptId key.
6. Dispatch is fired in the background (fire-and-forget); HTTP 200 is returned to Sumsub immediately.
7. `dispatch()` evaluates the 5 routing clues in order and calls the matching domain handler.
8. On success: event status set to PROCESSED, `dispatchedTo` and `processedAt` recorded.
9. On failure: `retryCount` incremented; status set to FAILED (or DEAD if retryCount >= 3).
10. `SumsubRetryService` cron retries FAILED events with exponential backoff.

## Key Rules

- Real webhooks use fire-and-forget dispatch; simulated events use synchronous dispatch so callers see the result immediately.
- Dispatch clue 3 (actionId) does not prevent clue 2 (inspectionId) from also matching; both can fire in the same event if both conditions are met.
- Simulated events always use `isSimulated: true` and record `simulatedByUserId`.
- DEAD events can only be replayed by an admin via `POST /admin/sumsub-events/:id/replay`; replay resets retryCount to 0.
- The `context` field on the event record is always initialized to `'ONBOARDING'` at creation; `dispatchedTo` is updated on successful dispatch to reflect the actual domain.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /webhooks/sumsub | None (HMAC signature) | Receive real Sumsub webhook |
| GET | /admin/sumsub-events | Admin JWT | List webhook events with filters |
| GET | /admin/sumsub-events/:id | Admin JWT | Get event detail with raw payload |
| POST | /admin/sumsub-events/simulate | Admin JWT | Simulate a scenario (SimulationScenario enum) |
| POST | /admin/sumsub-events/:id/replay | Admin JWT | Replay a DEAD event |
| POST | /admin/sumsub/simulate/aml-check-result | Admin JWT | Simulate `applicantReviewed` for a pending ClientRiskAssessment |
| POST | /admin/sumsub/simulate/applicant-action-result | Admin JWT | Simulate `applicantActionReviewed` for a pending MaterialRefreshCycle |
| POST | /admin/sumsub/simulate/sumsub-case-decision | Admin JWT | Simulate Sumsub MLRO case final decision (APPROVE/REJECT) for an ESCALATED_TO_SUMSUB assessment |
| POST | /admin/sumsub/simulate/risk-assessment-scenario | Admin JWT | Trigger risk assessment + simulate AML result in one call |
| POST | /admin/sumsub/simulate/level2-workflow-complete | Admin JWT | Simulate Level 2 workflow completion for a tier upgrade case |
| POST | /admin/sumsub/simulate/ongoing-doc-monitoring-fire | Admin JWT | Simulate Ongoing Document Monitoring document expiry fire |

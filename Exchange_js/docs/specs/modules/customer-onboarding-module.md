Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-05
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/onboarding-canonical-workflow.md`, `docs/specs/entities/customer-entity.md`, `docs/specs/entities/review-response-entity.md`
Source of Truth Level: specs-module

# Customer Onboarding Module

## Purpose
- This module owns customer onboarding runtime:
  - customer onboarding status progression
  - provider-backed onboarding verification orchestration
  - verification projection returned to customer `/verification`
  - automatic final approval creation after `level2` workflow completion
  - legacy onboarding response/session compatibility surfaces

## Canonical Entrypoints
- Customer-facing:
  - `GET /onboarding/me`
  - `GET /onboarding/next-step`
  - `POST /onboarding/entity`
  - `POST /onboarding/verification/start`
- Provider-facing:
  - `POST /onboarding/sumsub/webhook`
- Development simulation:
  - `POST /onboarding/sumsub/simulate`
- Legacy compatibility customer-facing:
  - `GET /onboarding/responses`
  - `POST /onboarding/cdd-responses/bootstrap`
  - `POST /onboarding/cdd-responses/reinitiate`
  - `POST /onboarding/edd-responses/start`
  - `POST /onboarding/edd-responses/reinitiate`
  - `POST /onboarding/responses/:id/sessions`
  - `POST /onboarding/response-sessions/:sessionId/mock-complete`
- Legacy browse / operator surfaces still related to onboarding evidence:
  - `GET /admin/compliance/cdd-responses*`
  - `GET /admin/compliance/edd-responses*`

## Integration Contract
- Customer onboarding consumes Sumsub workflow as verification truth source.
- Customer `/verification` is now a provider-backed start / continue / wait surface, not the primary CDD/EDD evidence mock-complete surface.
- Real provider webhooks and development simulation MUST flow through the same onboarding event handler.
- `getNextStep()` remains the single contract for onboarding guidance.
- `verification` projection returned from onboarding APIs is the active provider read model for customer UI.
- Legacy `CDD Response / EDD Response` and response-session APIs remain compatibility-only and are no longer the canonical onboarding progression surface.
- Legacy alert/case review routing remains an active compatibility runtime path and may still emit legacy raw onboarding statuses while cleanup is incomplete.
- `applicantWorkflowCompleted` without `level2` experience MUST move customer directly to `APPROVED`.
- `applicantWorkflowCompleted` after `level2` experience MUST move customer to `FINAL_APPROVAL` and auto-create pending `ONBOARDING_FINAL_APPROVAL`.
- Legacy `REVIEW_EDD -> FINAL_APPROVAL` transition remains available through compatibility review surfaces until the old path is retired.
- Canonical customer state is driven by customer fields plus provider projection, not by legacy risk-engine or alert/case review staging.

## Historical Aliases / Retired Names
- `caseNo / caseType` response aliases are retired from active external contract.
- Legacy public-status helpers are retired from active runtime.
- `onboarding_audit_logs` is historical audit residue only and is not the canonical runtime audit source.
- `PENDING_CDD_INPUT / CDD_UNDER_REVIEW / PENDING_EDD_INPUT / EDD_UNDER_REVIEW` are legacy onboarding states only and are not part of the active canonical flow.
- Legacy onboarding actions and raw states may still appear through compatibility endpoints while cleanup remains in progress.

## MUST / MUST NOT
- MUST start active onboarding verification through provider-backed flow.
- MUST persist provider projection fields on customer:
  - `verificationProvider`
  - `sumsubApplicantId`
  - `sumsubCurrentLevelName`
  - `sumsubLatestReviewId`
  - `sumsubLatestAttemptId`
  - `sumsubExperiencedLevel2`
- MUST auto-create final approval only when provider workflow completes after `level2`.
- MUST NOT require alert/case handling to advance active onboarding verification.
- MUST NOT treat `applicantReviewed + GREEN` alone as final platform activation when provider workflow still has remaining levels.

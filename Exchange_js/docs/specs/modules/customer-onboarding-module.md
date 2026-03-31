Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-31
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/onboarding-canonical-workflow.md`, `docs/specs/entities/customer-entity.md`, `docs/specs/entities/review-response-entity.md`
Source of Truth Level: specs-module

# Customer Onboarding Module

## Purpose
- This module owns customer onboarding runtime:
  - customer onboarding status progression
  - CDD / EDD response intake
  - onboarding-specific workflow decisions
  - automatic final approval creation when EDD clear transitions a customer into `FINAL_APPROVAL`

## Canonical Entrypoints
- Customer-facing:
  - `GET /onboarding/me`
  - `GET /onboarding/responses`
  - `GET /onboarding/next-step`
  - `POST /onboarding/entity`
  - `POST /onboarding/cdd-responses/bootstrap`
  - `POST /onboarding/cdd-responses/reinitiate`
  - `POST /onboarding/edd-responses/start`
  - `POST /onboarding/edd-responses/reinitiate`
  - `POST /onboarding/responses/:id/sessions`
  - `POST /onboarding/response-sessions/:sessionId/mock-complete`
- Admin-facing onboarding operations:
  - `GET /admin/compliance/cdd-responses*`
  - `GET /admin/compliance/edd-responses*`
  - `POST /admin/compliance/alerts/:id/resolve`
  - `POST /admin/compliance/cases/:id/onboarding-decision`
  - `GET /admin/risk/decision-records`
  - `GET /admin/risk/decision-records/:id`
  - `POST /admin/risk/decision-records/:id/simulate`

## Integration Contract
- Customer onboarding consumes:
  - response containers as evidence
  - compliance center for review-stage decisions
  - approvals module for final approval
- Customer `/verification` remains the evidence collection and mock-complete surface under shared `Simulation Mode`.
- Final `ONBOARDING_CDD` and `ONBOARDING_EDD` risk simulation is executed from admin `Risk Policy Executions`, not from a client-side risk selection surface.
- Admin `CDD Response / EDD Response` surfaces remain evidence-browse surfaces and MUST NOT duplicate customer-side onboarding mock-complete actions.
- Workflow-bound onboarding alerts are resolved through the unified alert resolution surface rather than onboarding-specific alert routes.
- Onboarding `REVIEW_EDD -> CLEAR -> FINAL_APPROVAL` MUST auto-create a pending `ONBOARDING_FINAL_APPROVAL`; operators MUST NOT manually submit it from customer screens.
- `ONBOARDING_EDD` low-risk simulation with canonical reason `EDD_CLEAR` MUST bypass alert/case creation and move directly into `FINAL_APPROVAL`.
- Canonical customer state is driven by customer fields, not by legacy public-status projections.

## Historical Aliases / Retired Names
- `caseNo / caseType` response aliases are retired from active external contract.
- Legacy public-status helpers are retired from active runtime.
- `onboarding_audit_logs` is historical audit residue only and is not the canonical runtime audit source.

## MUST / MUST NOT
- MUST use canonical response identity:
  - `responseNo`
  - `responseType`
- MUST call compliance center decision surfaces for review-stage governance.
- MUST NOT mutate customer onboarding status directly inside ad-hoc alert/case handlers.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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
  - final approval request submission

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
  - `POST /admin/compliance/alerts/:id/onboarding-decision`
  - `POST /admin/compliance/cases/:id/onboarding-decision`
  - `GET /admin/compliance/decision-records*`
  - `POST /admin/compliance/customers/:id/final-approval/submit`

## Integration Contract
- Customer onboarding consumes:
  - response containers as evidence
  - compliance center for review-stage decisions
  - approvals module for final approval
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

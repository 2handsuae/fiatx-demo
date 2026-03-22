Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/periodic-review-canonical-workflow.md`, `docs/specs/entities/periodic-review-cycle-entity.md`
Source of Truth Level: specs-module

# Periodic Review Module

## Purpose
- This module owns periodic review runtime:
  - due-cycle creation
  - review response intake
  - periodic-review-specific workflow decisions
  - restriction lifecycle around due review

## Canonical Entrypoints
- Customer-facing:
  - `GET /periodic-review/me`
  - `GET /periodic-review/responses`
  - `GET /periodic-review/next-step`
  - `POST /periodic-review/cdd-responses/start`
  - `POST /periodic-review/edd-responses/start`
  - `POST /periodic-review/responses/:id/sessions`
  - `POST /periodic-review/response-sessions/:sessionId/mock-complete`
- Admin-facing:
  - `POST /admin/compliance/customers/:id/periodic-review/trigger`
  - `POST /admin/compliance/alerts/:id/periodic-review-decision`
  - `POST /admin/compliance/cases/:id/periodic-review-decision`

## Integration Contract
- Periodic review consumes:
  - response containers
  - compliance center review kernel
  - customer restriction state
- `PeriodicReviewCycle` is the workflow root.

## Historical Aliases / Retired Names
- Periodic review is not onboarding continuation.
- Response identity uses response-named contract; case-named response alias is historical only.
- `onboarding_audit_logs` is historical audit residue only and MUST NOT be treated as periodic-review audit truth.

## MUST / MUST NOT
- MUST keep periodic review trace rooted at cycle.
- MUST use case-bound review governance for restriction changes that depend on investigation.
- MUST NOT rewrite customer onboarding status as periodic review state.

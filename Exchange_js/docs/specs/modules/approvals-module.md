Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/entities/approval-case-entity.md`, `docs/specs/workflows/mlro-and-final-approval-governance.md`
Source of Truth Level: specs-module

# Approvals Module

## Purpose
- This module owns approval-backed governance actions, including Wave 3 onboarding final approval.

## Canonical Entrypoints
- `POST /admin/control-gates/approvals`
- `POST /admin/control-gates/approvals/:id/submit`
- `POST /admin/control-gates/approvals/:id/approve`
- `POST /admin/control-gates/approvals/:id/reject`
- `POST /admin/control-gates/approvals/:id/cancel`
- `GET /admin/control-gates/approvals/:id`
- `GET /admin/control-gates/approvals`

## Integration Contract
- Business modules request approval creation through approval action types.
- Approvals module owns:
  - approval state
  - checker role handling
  - execution result tracking
  - approval audit
- Workflow-bound approvals must persist workflow trace dimensions.

## Historical Aliases / Retired Names
- Onboarding final approval is no longer a standalone custom final-review flow.
- Canonical governance object is `Approval Case`.

## MUST / MUST NOT
- MUST use approvals module for `ONBOARDING_FINAL_APPROVAL`.
- MUST NOT invent a separate customer final-review entity or direct status mutation path outside approval consumption.

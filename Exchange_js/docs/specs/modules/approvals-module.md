Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-approval-constraints.md`, `docs/specs/entities/approval-case-entity.md`
Source of Truth Level: specs-module

# Approvals Module

## Purpose
- This module owns the Wave 1 approval shell for approval-backed governance actions.
- Specialised workflows bind to this shell, but they do not redefine its source-of-truth scope here.

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
- Approval Case remains the canonical governance object for the module, regardless of which workflow binds to it.

## Historical Aliases / Retired Names
- Onboarding final approval is one binding that uses the shared approval shell, not the module's defining purpose.
- Canonical governance object is `Approval Case`.

## MUST / MUST NOT
- MUST use approvals module for approval-backed governance actions, including `ONBOARDING_FINAL_APPROVAL`.
- MUST NOT invent a separate customer final-review entity or direct status mutation path outside approval consumption.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/modules/risk-engine-module.md`
Source of Truth Level: specs-entity

# Risk Decision Record Entity

## Purpose
- This document defines the canonical semantics for risk decision records as the root evaluation record behind orchestration, recommendation, and downstream alert/case creation.

## Canonical Fields
- Current physical model is `WorkflowDecisionRecord`.
- Canonical fields are:
  - `id`
  - `customerId`
  - `contextType`
  - `subjectId`
  - `policyVersion`
  - `status`
  - `inputPayload`
  - `inputHash`
  - `outputDecision`
  - `recommendedActions`
  - `outputs`
  - `reasonCodes`
  - `errorMessage`
  - `createdAt`
  - `completedAt`

## Lifecycle Anchor
- Current runtime status values are:
  - `CREATED`
  - `COMPLETED`
  - `FAILED`

## Write Owners
- Risk engine evaluation writes the decision record.
- Orchestration consumers may derive:
  - alert creation
  - workflow transition projection
  - evidence snapshots
- Downstream modules must not rewrite decision record outcome ad hoc.

## Related Workflow Binding
- Decision record is the root explanation object for:
  - recommendation
  - alert orchestration
  - workflow transition projection
- It is not itself an alert, case, or approval object.

## Historical / Retired Notes
- Current physical model name remains `WorkflowDecisionRecord`.
- That physical name does not change the canonical meaning of this entity as risk decision record.

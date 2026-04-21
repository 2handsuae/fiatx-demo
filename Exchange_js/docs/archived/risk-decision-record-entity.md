> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
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

## Current Transaction Contexts
- Deposit-side transaction contexts currently include:
  - `TX_DEPOSIT_KYT_MAIN`
  - `TX_DEPOSIT_TRAVEL_RULE`
- For these contexts, the decision record remains the explanation root before:
  - alert upsert
  - case escalation
  - workflow-bound deposit callback
- The presence of transaction contexts does not change the rule that decision record is not the case or alert object itself.

## Historical / Retired Notes
- Current physical model name remains `WorkflowDecisionRecord`.
- That physical name does not change the canonical meaning of this entity as risk decision record.

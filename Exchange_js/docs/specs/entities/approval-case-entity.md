Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/mlro-and-final-approval-governance.md`
Source of Truth Level: specs-entity

# Approval Case Entity

## Purpose
- This document defines the canonical semantics for `Approval Case` as the governance approval object used by Wave 3 final approval and other approval-backed controls.

## Canonical Fields
- `id`
- `approvalNo`
- `actionType`
- `entityRef`
- `makerUserId`
- `status`
- `executionStatus`
- `riskLevel`
- `checkerRoles`
- `selectedCheckerRole`
- `allowCancel`
- `allowRetry`
- `docRef`
- `metadataJson`
- `traceId`
- `workflowType`
- `workflowId`
- `workflowNo`
- `submittedAt`
- `timeoutAt`
- `decidedAt`
- `executedAt`
- `decisionByUserId`
- `decisionByRole`
- `decisionReason`

## Lifecycle Anchor
- Approval lifecycle is owned by the approvals module.
- Current runtime actions are:
  - create draft
  - submit
  - approve
  - reject
  - cancel

## Write Owners
- Approvals module owns approval state and approval-step progression.
- Business modules may request approval creation, but must not own approval lifecycle directly.

## Related Workflow Binding
- `ONBOARDING_FINAL_APPROVAL` is the Wave 3 binding of this entity.
- Workflow-bound approval must carry:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`

## Historical / Retired Notes
- Approval case is not a customer status mirror.
- Approval result may project to customer or case outcome, but it remains a separate governance entity.

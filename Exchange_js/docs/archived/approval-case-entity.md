> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. See current audit contract.
>
> Replacement: `docs/constraints/audit-trace-context-constraints.md`

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-approval-constraints.md`
Source of Truth Level: specs-entity

# Approval Case Entity

## Purpose
- This document defines the canonical semantics for `Approval Case` as the shared governance approval shell used by approval-backed controls in Wave 1.
- Later-wave workflow specializations may bind to this shell, but they do not redefine the entity purpose here.

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
- `ONBOARDING_FINAL_APPROVAL` is one workflow binding of this entity.
- Workflow-bound approval must carry:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`

## Historical / Retired Notes
- Approval case is not a customer status mirror.
- Approval result may project to customer or case outcome, but it remains a separate governance entity.
- Approval case is a generic approval shell, not a workflow-specific final-review construct.

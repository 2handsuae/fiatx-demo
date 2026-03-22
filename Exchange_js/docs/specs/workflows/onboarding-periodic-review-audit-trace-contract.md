Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-21
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/compliance-alert-incident-constraints.md`, `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md`
Source of Truth Level: specs-workflow

# Onboarding And Periodic Review Audit Trace Contract

## Purpose
- This document defines the canonical audit and trace contract shared by:
  - onboarding
  - periodic review
  - workflow-bound alert / case
  - onboarding final approval
- It exists to ensure that one customer workflow can be replayed in `Audit Center` through a single trace instead of fragmented audit silos.

## Related Canonical Docs
- Workflow truth:
1. `docs/specs/workflows/onboarding-canonical-workflow.md`
2. `docs/specs/workflows/periodic-review-canonical-workflow.md`
3. `docs/specs/workflows/mlro-and-final-approval-governance.md`
- Entity truth:
1. `docs/specs/entities/review-response-entity.md`
2. `docs/specs/entities/approval-case-entity.md`
3. `docs/specs/entities/periodic-review-cycle-entity.md`
- Module truth:
1. `docs/specs/modules/customer-onboarding-module.md`
2. `docs/specs/modules/periodic-review-module.md`
3. `docs/specs/modules/approvals-module.md`
4. `docs/specs/modules/audit-logging-module.md`

## Canonical Audit Store
- Canonical audit store is:
  - `audit_log_events`
- Historical compatibility mirror is:
  - `onboarding_audit_logs`
- `onboarding_audit_logs` may remain stored as historical residue, but:
  - it is not canonical truth
  - it is not the primary source for evidence export
  - it is not the primary source for trace replay
  - it is not an active runtime mirror write target

## Trace Root Rules

### Onboarding
- `workflowType = ONBOARDING`
- `workflowId = journeyId`
- `workflowNo = journeyId`
- `traceId = ONBOARDING:<journeyId>`

### Periodic Review
- `workflowType = PERIODIC_REVIEW`
- `workflowId = cycle.id`
- `workflowNo = cycle.cycleNo`
- `traceId = PERIODIC_REVIEW:<cycle.id>`

## Non-Negotiables
- `traceId` MUST be derived from workflow root and MUST NOT be generated randomly by downstream workflow-bound objects.
- Workflow-bound `alert / case / approval / filing` MUST inherit upstream workflow trace.
- Only non-workflow-bound approvals MAY continue to generate their own approval-scoped trace.
- `Audit Center` queries, replay, and evidence export MUST prefer `traceId + workflowType + workflowNo`.

## Object Inheritance Rules

### Response / Session Layer
- `CDD Response` and `EDD Response` events MUST write canonical audit with workflow root trace.
- Session lifecycle events such as created/completed/submitted MUST stay on the same trace.

### Alert Layer
- Workflow-bound onboarding or periodic review alert MUST inherit trace from:
  - onboarding journey
  - periodic review cycle
- `ESCALATE_TO_CASE` MUST preserve trace; it does not start a new chain.

### Case Layer
- Workflow-bound case MUST continue the same upstream trace.
- Case investigation, report finalize, submit-to-MLRO, MLRO return, MLRO approve, and filing follow-up MUST all preserve that trace.

### Approval Layer
- `ONBOARDING_FINAL_APPROVAL` created after onboarding `REVIEW_EDD + CLEAR` MUST inherit:
  - `traceId = ONBOARDING:<journeyId>`
- Workflow-bound approval main record MUST persist:
  - `workflowType`
  - `workflowId`
  - `workflowNo`
- Approval submitted / approved / rejected audit events MUST stay on the same onboarding trace.

## Required Canonical Audit Fields
- For workflow-bound actions, canonical audit event MUST include:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`
  - `entityOwnerType`
  - `entityOwnerId`
  - `entityOwnerNo`
- When applicable, canonical audit SHOULD also carry subject identifiers such as:
  - `responseNo`
  - `alertNo`
  - `caseNo`
  - `approvalNo`

## Minimum Event Coverage

### Onboarding
- CDD session created / completed
- EDD session created / completed
- CDD / EDD submitted
- alert created / triaged
- case escalated / investigated
- report finalized
- submit to MLRO
- MLRO returned / approved
- final approval submitted / approved / rejected

### Periodic Review
- cycle created / due / started
- CDD / EDD submitted
- alert created / triaged
- case escalated / investigated
- report finalized
- submit to MLRO
- MLRO returned / approved

## Replay Expectations

### Onboarding Replay
- One `traceId` query in `Audit Center` MUST be able to show:
  - response submit
  - alert triage
  - case investigation
  - MLRO review
  - onboarding final approval

### Periodic Review Replay
- One `traceId` query in `Audit Center` MUST be able to show:
  - cycle creation
  - response submit
  - alert triage
  - case investigation
  - final approved disposition

## Historical Compatibility Note
- Historical `onboarding_audit_logs` rows may still carry a subset of canonical workflow audit fields.
- Where present, mirror rows SHOULD carry:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`
- Active runtime no longer depends on mirror writes.
- Historical mirror backfill MUST remain deterministic:
  - onboarding rows may be backfilled only when `journeyId` can be resolved from linked `CDD/EDD response`
  - periodic review rows may be backfilled only when `periodicReviewCycleId` and `cycleNo` can be resolved from linked `CDD/EDD response`
  - rows without deterministic workflow root remain `null` and are treated as residual compatibility debt

## Non-Goals
- This spec does not define Audit Center UI filtering behavior in detail.
- This spec does not define evidence package export file layout.
- This spec does not define how non-workflow-bound approvals should be traced beyond allowing their own trace.

> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Periodic review redesigned in Wave 3 Layer 2/3.
>
> Replacement: `docs/specs/wave3-layer2-risk-assessment.md` / `docs/specs/wave3-layer3-material-refresh.md`

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-31
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
Source of Truth Level: specs-workflow

# Periodic Review Canonical Workflow

## Purpose
- This document defines the canonical periodic review workflow after Wave 3 completion.

## Actors
- `System Scheduler`
- `Customer`
- `Compliance Operator`
- `MLRO`

## Canonical Cycle State Model
- `PENDING_CDD_INPUT`
- `CDD_UNDER_REVIEW`
- `PENDING_EDD_INPUT`
- `EDD_UNDER_REVIEW`
- `CLEARED`
- `REJECTED`

## Main Path
1. due customer triggers `PeriodicReviewCycle`
2. cycle is created and customer becomes `RESTRICTED`
3. customer completes `CDD Response`
4. system creates a pending `PERIODIC_REVIEW_CDD` decision record and moves cycle to `CDD_UNDER_REVIEW`
5. operator completes manual simulation in `Risk Policy Executions`
6. workflow-bound alert/case is created from the simulated result
7. if `REQUIRE_EDD`, customer moves to `PENDING_EDD_INPUT`
8. customer completes `EDD Response`
9. system creates a pending `PERIODIC_REVIEW_EDD` decision record and moves cycle to `EDD_UNDER_REVIEW`
10. operator completes manual simulation in `Risk Policy Executions`
11. compliance review proceeds through alert/case and MLRO
12. `CLEAR` removes restriction and marks cycle `CLEARED`
13. `REJECT` keeps restriction and marks cycle `REJECTED`

## Non-Negotiables
- Periodic review is not an extension of onboarding status.
- Periodic review uses independent workflow root:
  - `workflowType = PERIODIC_REVIEW`
  - `traceId = PERIODIC_REVIEW:<cycle.id>`
- Restriction changes must remain case-bound when driven by compliance investigation.

## Response / Alert / Case Binding
- `CDD Response` and `EDD Response` remain evidence containers.
- `PeriodicReviewCycle` is the workflow root entity.
- Alert and case handling reuse the shared Wave 2 kernel.
- Periodic review risk simulation is manual for active customer flow:
  - `PERIODIC_REVIEW_CDD`
  - `PERIODIC_REVIEW_EDD`
- Periodic review read-models and transition outputs use canonical response identity only.
- Compatibility `finalApprovalStatus` is not part of the active periodic-review workflow output; customer final-approval truth remains `latestFinalApproval*` plus canonical customer state.

## Audit And Trace
- One periodic review cycle must replay in Audit Center as:
  - cycle
  - response
  - alert
  - case
  - final disposition

## Non-Goals
- This document does not define funding or transaction compliance workflow.

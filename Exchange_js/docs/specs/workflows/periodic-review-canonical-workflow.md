Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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
4. if risk review is required, workflow-bound alert/case is created
5. if `REQUIRE_EDD`, customer moves to `PENDING_EDD_INPUT`
6. customer completes `EDD Response`
7. compliance review proceeds through alert/case and MLRO
8. `CLEAR` removes restriction and marks cycle `CLEARED`
9. `REJECT` keeps restriction and marks cycle `REJECTED`

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

## Audit And Trace
- One periodic review cycle must replay in Audit Center as:
  - cycle
  - response
  - alert
  - case
  - final disposition

## Non-Goals
- This document does not define funding or transaction compliance workflow.

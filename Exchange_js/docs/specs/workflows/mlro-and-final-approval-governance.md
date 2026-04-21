> **PARTIALLY OUTDATED** — Some sections of this document no longer match the current code.
> Last verified: 2026-04-11. See notes below for specific outdated sections.
>
> Updated specs: `docs/specs/wave3-layer2-risk-assessment.md`, `docs/specs/wave3-layer3-material-refresh.md`, `docs/specs/wave3-onboarding-integration.md`
>
> **Note:** Periodic review MLRO path replaced by Layer 2 scenarios

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`, `docs/specs/workflows/onboarding-canonical-workflow.md`
Source of Truth Level: specs-workflow

# MLRO And Final Approval Governance

## Purpose
- This document defines the governance boundary between case-internal MLRO review and downstream onboarding final approval.

## MLRO Gate
- Every workflow-bound case reaches its final governance gate inside the case.
- MLRO may:
  - `RETURN_FOR_INVESTIGATION`
  - `APPROVE_FINAL_DISPOSITION`
- When MLRO approves:
  - case final disposition becomes effective
  - workflow transition executes if applicable
  - case closes

## Onboarding EDD Clear Path
- Only onboarding `REVIEW_EDD + CLEAR` creates downstream final approval.
- Order is fixed:
  1. MLRO approves inside case
  2. case closes
  3. customer moves to `FINAL_APPROVAL`
  4. one `ONBOARDING_FINAL_APPROVAL` is created
  5. `SM` approves or rejects the approval case

## Approval Boundary
- `ONBOARDING_FINAL_APPROVAL` is a governance approval object.
- It is not part of case lifecycle itself.
- It must inherit the same onboarding trace as the upstream case.

## Filing Boundary
- External filing remains downstream of the case.
- Filing follow-up does not reopen the case.
- Filing and approval are separate governance objects with different owners.

## Non-Goals
- This document does not define multi-step approval chains beyond current `SM` final approval.

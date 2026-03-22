# Workflow Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/README.md`
Source of Truth Level: specs-workflow

## Purpose
- One document per workflow.
- Explain states, transitions, actors, trigger points, and contract outputs.
- Workflow specs explain how a durable flow behaves; field ownership and object identity belong in entity specs, not here.

## Recommended Topics
- purpose
- actors
- state model
- transitions
- triggers
- read/write ownership
- API / UI projection notes

## Current Workflow Specs
- `docs/specs/workflows/onboarding-canonical-workflow.md`
  - Canonical onboarding state machine and review/final-approval paths.
- `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - Canonical periodic review cycle, restriction, review, and clear/reject flow.
- `docs/specs/workflows/alert-triage-and-case-escalation.md`
  - Alert triage, assignment, false-positive, and case escalation semantics.
- `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - MLRO gate, case close boundary, and onboarding EDD clear final-approval governance.
- `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - Case report, workflow proposal, final disposition, measure, and external filing separation.
- `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - Unified trace and Audit Center replay contract for onboarding and periodic review.

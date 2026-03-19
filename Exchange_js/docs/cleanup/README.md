# Cleanup Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: cleanup

## Purpose
- Use this folder for staged legacy cleanup and compatibility removal plans.
- Cleanup documents explain how the codebase converges from old semantics to target semantics.

## Required Reading Order
1. `docs/cleanup/wave-3-cleanup-master-plan.md`
2. then the current active stage document
3. then any later-stage documents only if the thread needs forward-looking context

## Current Wave 3 Cleanup Documents
- Master plan:
  - `docs/cleanup/wave-3-cleanup-master-plan.md`
- Stage documents:
  - `docs/cleanup/stage-1-canonical-runtime-cutover.md`
  - `docs/cleanup/stage-2-response-naming-and-contract-convergence.md`
  - `docs/cleanup/stage-3-deprecated-alias-retirement.md`
  - `docs/cleanup/stage-4-customer-auth-and-read-model-convergence.md`
  - `docs/cleanup/stage-5-physical-schema-and-model-cleanup.md`
  - `docs/cleanup/stage-6-compatibility-contract-cleanup.md`
  - `docs/cleanup/stage-7-physical-rename.md`
  - `docs/cleanup/stage-8-frontend-bundling-optimization.md`

## Current Status
- Wave 3 cleanup is complete through `Stage 8`.
- `Stage 1` to `Stage 8` are all completed.
- Use `docs/cleanup/wave-3-cleanup-master-plan.md` as the canonical historical summary and completion record.

## Update When
- A legacy alias is introduced or removed.
- A cleanup stage starts, advances, or completes.
- A field or route changes from compatibility-only to removable.

## Minimum Stage Structure
- current debt
- target end state
- in-scope
- out-of-scope
- preconditions
- implementation notes
- acceptance / exit criteria
- blockers / rollback note

## Do Not Use For
- Long-term source-of-truth behavior.
- Product roadmap sequencing unless cleanup itself is the subject.

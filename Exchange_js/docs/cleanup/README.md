# Cleanup Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: cleanup

## Purpose
- Use this folder for staged legacy cleanup and compatibility removal history.
- Cleanup documents explain how the codebase converged from old semantics to canonical runtime truth.

## Required Reading Order
1. `docs/specs/entities/**` and `docs/specs/workflows/**` for current truth
2. `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md` for final runtime validation
3. `docs/cleanup/wave-2-wave-3-final-closure-plan.md` for final retirement history
4. `docs/cleanup/wave-2-cleanup-master-plan.md` for historical Wave 2 stage context
5. `docs/cleanup/wave-3-cleanup-master-plan.md` for historical Wave 3 stage context

## Current Cleanup Documents
- Wave 1 master:
  - `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`
- Wave 2 master:
  - `docs/cleanup/wave-2-cleanup-master-plan.md`
- Wave 3 master:
  - `docs/cleanup/wave-3-cleanup-master-plan.md`
- Wave 4 master:
  - `docs/cleanup/wave-4-cleanup-master-plan.md`
- Wave 4 retirement inventory:
  - `docs/cleanup/wave-4-field-retirement-inventory.md`
- Final closure:
  - `docs/cleanup/wave-2-wave-3-final-closure-plan.md`
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
- `Wave 1` governance / audit cleanup master 已重新启用，作为当前 active staged cleanup 入口。
- `Wave 2` 与 `Wave 3` 的 cleanup 文档都已退为历史完成记录。
- `Wave 4` cleanup master 与 retirement inventory 已进入 round 3 schema retirement，作为当前 ledger / pricing / wallet shadow balance 退役入口。
- `Wave 4` cleanup round 1-3 之后，又完成了 post-cleanup remediation，用于补齐 governance audit logging 与 core runtime type conformance。
- 当前长期真相不在 cleanup 层，而在：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`

## Update When
- A legacy alias is introduced or removed.
- A cleanup stage starts, advances, or completes.
- A field or route changes from compatibility-only to physically deleted or migration-ready.

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

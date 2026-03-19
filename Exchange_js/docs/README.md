# Documentation Index

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: `Exchange_js`
Supersedes: none
Depends On: `AGENTS.md`, `docs/constraints/README.md`
Source of Truth Level: documentation-governance-index

## Purpose
- This file is the top-level documentation index for `Exchange_js`.
- It defines document layers, reading order, precedence, update triggers, and minimum templates.
- Read this file after `AGENTS.md` and before any task-specific documentation work.

## Source Of Truth Order
- When documents conflict, the precedence is:
1. `docs/constraints/**`
2. `docs/specs/**`
3. `docs/adr/**`
4. `docs/cleanup/**`
5. `docs/roadmap/**`
6. `docs/acceptance/**`
- `docs/glossary/**` supports naming consistency but does not override higher-order documents.
- Historical or migration-reference documents must explicitly say when they are not current implementation truth.

## Required Reading Order
1. `AGENTS.md`
2. `docs/README.md`
3. `docs/constraints/README.md`
4. task-relevant files under `docs/constraints/**`
5. then task-relevant files under `docs/specs/**`, `docs/roadmap/**`, `docs/cleanup/**`, `docs/adr/**`, and `docs/acceptance/**`

## Thread Completion Rule
- Every completed thread must perform a documentation impact check.
- Update documentation in the same thread when the work changes:
1. workflow semantics
2. entity or field semantics
3. API or page contract meaning
4. constraints or invariants
5. cleanup stage / deprecation boundary
6. runtime, DB, or migration semantics
- Documentation usually does not need updates for:
1. pure styling changes
2. wording-only UI tweaks without semantic change
3. test-only additions
4. refactors with no behavior or contract change
- Every final response must include one of:
1. `Documentation updated: ...`
2. `Documentation update not needed: ...`

## Standard Documentation Structure
- `docs/roadmap/`
  - purpose: project, wave, and phase planning
  - update when: scope, sequencing, or delivery milestones change
  - do not use for: long-term behavior truth
- `docs/cleanup/`
  - purpose: staged legacy removal, compatibility convergence, debt retirement
  - update when: a cleanup stage starts, advances, or is completed
  - do not use for: permanent workflow semantics
- `docs/constraints/`
  - purpose: hard rules, invariants, and forbidden patterns
  - update when: a hard boundary or non-negotiable rule changes
  - do not use for: temporary implementation notes
- `docs/specs/entities/`
  - purpose: field semantics, ownership, and read/write meaning per entity
  - update when: entity shape or field meaning changes
- `docs/specs/workflows/`
  - purpose: workflow states, transitions, actors, and contract meaning
  - update when: workflow lifecycle or routing meaning changes
- `docs/specs/modules/`
  - purpose: module-level behavior, subsystem design, and bounded-context implementation notes
  - update when: a durable module contract or subsystem structure meaning changes
- `docs/adr/`
  - purpose: explain why major design decisions were made
  - update when: a major architecture or product decision is locked
- `docs/acceptance/`
  - purpose: runbooks, E2E validation, demo steps, operator checklists
  - update when: validation steps or expected behavior changes
- `docs/glossary/`
  - purpose: define terms and naming boundaries
  - update when: new durable terminology is introduced or renamed

## Metadata Convention
- Normative documents should start with:
1. `Status`
2. `Owner`
3. `Last Updated`
4. `Applies To`
5. `Supersedes`
6. `Depends On`
7. `Source of Truth Level`
- Allowed `Status` values:
1. `draft`
2. `active`
3. `deprecated`
4. `archived`

## Minimum Templates
### Roadmap
- goal
- scope
- non-goals
- milestones / waves / phases
- dependencies

### Cleanup
- current debt
- target end state
- stages
- preconditions
- deletion order
- rollback / compatibility note

### Constraints
- scope
- non-negotiables
- invariants
- forbidden patterns
- change protocol

### Specs
- purpose
- state model
- field semantics
- transitions
- read / write owners
- API / read-model mapping

### ADR
- context
- decision
- consequences
- alternatives considered

### Acceptance
- environment
- validation steps
- expected results
- known caveats

## Current Entry Documents
- Project planning reference:
  - `docs/roadmap/project-version-plan.md`
  - `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
- Cleanup reference:
  - `docs/cleanup/wave-3-cleanup-master-plan.md`
- Constraints index:
  - `docs/constraints/README.md`
- Runtime / validation examples:
  - `docs/acceptance/local-main-runtime-runbook.md`
  - `docs/acceptance/onboarding-compliance-center-wave3-acceptance-checklist.md`

## Current Wave 3 Follow-ups
- Wave 3 cleanup `Stage 1` 到 `Stage 8` 已全部完成。
- 当前没有剩余的 Wave 3 cleanup follow-up stages。
- 如需查看完成态与历史分阶段记录，读：
1. `docs/cleanup/wave-3-cleanup-master-plan.md`
2. `docs/cleanup/stage-6-compatibility-contract-cleanup.md`
3. `docs/cleanup/stage-7-physical-rename.md`
4. `docs/cleanup/stage-8-frontend-bundling-optimization.md`

## Migration Note
- Existing documents do not need to be fully moved in one pass.
- New threads should follow this structure from now on.
- When touching an existing document, prefer:
1. keep the current file if it is still the right source-of-truth layer
2. add metadata and clarify status / precedence
3. move or split only when necessary to reduce ambiguity

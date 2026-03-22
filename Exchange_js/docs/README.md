# Documentation Index

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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
4. `docs/acceptance/**`
5. `docs/roadmap/**`
6. `docs/cleanup/**`
- `docs/glossary/**` supports naming consistency but does not override higher-order documents.
- Historical or migration-reference documents must explicitly say when they are not current implementation truth.

## Required Reading Order
1. `AGENTS.md`
2. `docs/README.md`
3. `docs/constraints/README.md`
4. task-relevant files under `docs/roadmap/**` when the thread is wave / phase / delivery scoped
5. task-relevant files under `docs/constraints/**`
6. task-relevant files under `docs/specs/workflows/**`, `docs/specs/entities/**`, and `docs/specs/modules/**`
7. task-relevant files under `docs/acceptance/**` when validation, operator usage, or demo behavior matters
8. archived cleanup files under `docs/cleanup/**` only when retirement history or historical compatibility context matters

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
  - purpose: module-level behavior, subsystem boundaries, canonical entrypoints, and historical alias handling
  - update when: a durable module contract, integration entrypoint, or bounded-context meaning changes
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
  - `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`
- Constraints index:
  - `docs/constraints/README.md`
- Workflow semantics reference:
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - `docs/specs/workflows/alert-triage-and-case-escalation.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- Entity semantics reference:
  - `docs/specs/entities/compliance-case-entity.md`
  - `docs/specs/entities/compliance-alert-entity.md`
  - `docs/specs/entities/compliance-case-report-entity.md`
  - `docs/specs/entities/compliance-external-filing-entity.md`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/periodic-review-cycle-entity.md`
  - `docs/specs/entities/approval-case-entity.md`
  - `docs/specs/entities/risk-decision-record-entity.md`
- Module integration reference:
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/specs/modules/risk-engine-module.md`
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/periodic-review-module.md`
  - `docs/specs/modules/approvals-module.md`
  - `docs/specs/modules/audit-logging-module.md`
- Runtime / validation examples:
  - `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`
  - `docs/acceptance/local-main-runtime-runbook.md`
  - `docs/acceptance/onboarding-compliance-center-wave3-acceptance-checklist.md`
- Archived cleanup history:
  - `docs/cleanup/wave-2-wave-3-final-closure-plan.md`
  - `docs/cleanup/wave-2-cleanup-master-plan.md`
  - `docs/cleanup/wave-3-cleanup-master-plan.md`

## Wave 2 / Wave 3 Recommended Reading Order
1. roadmap / phase context
2. relevant constraints
3. workflow specs
4. entity specs
5. module specs
6. final acceptance checklist
7. archived cleanup docs only if retirement history matters

## Wave Completion Documentation Rule
- A wave MUST NOT be treated as documentation-complete until all of the following exist and point to each other:
1. roadmap completion note
2. constraints final-state check
3. workflow specs
4. entity specs
5. module specs
6. acceptance or final runbook
- `cleanup` documents record how compatibility and legacy runtime were retired.
- `cleanup` documents MUST NOT remain the long-term source of truth after a wave is complete.
- Durable post-wave truth MUST be migrated into:
1. `docs/constraints/**`
2. `docs/specs/**`
3. `docs/acceptance/**`
- If a wave closes without this documentation set, the wave is implementation-complete but not documentation-complete.

## Completion Note
- `Wave 2` 与 `Wave 3` 的主体能力和最终收口已经完成。
- 当前长期真相层是：
1. `docs/constraints/**`
2. `docs/specs/workflows/**`
3. `docs/specs/entities/**`
4. `docs/specs/modules/**`
5. `docs/acceptance/**`
- `docs/cleanup/**` 现在只保留清理历史、退役边界和 archived context，不再承担永久语义真相。

## Migration Note
- Existing documents do not need to be fully moved in one pass.
- New threads should follow this structure from now on.
- When touching an existing document, prefer:
1. keep the current file if it is still the right source-of-truth layer
2. add metadata and clarify status / precedence
3. move or split only when necessary to reduce ambiguity

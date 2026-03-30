Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/constraints/README.md`, `docs/adr/README.md`
Source of Truth Level: constraints

# Documentation Filing And ADR Constraints

## 1) Purpose
- This document defines how new work must be filed into the documentation system.
- It also fixes the ADR policy for this repo so future threads do not have to re-decide whether ADRs should exist, when they are required, or whether historical gaps must be backfilled.

## 2) Filing Rule: Start From Change Type, Not From Folder Habit
- Every new feature, cleanup, or refactor thread MUST first classify what changed.
- The filing target is determined by semantic impact, not by whichever folder feels convenient.
- Use this order:
1. did a hard rule or invariant change?
2. did durable entity meaning change?
3. did workflow meaning or action routing change?
4. did module/canonical entrypoint ownership change?
5. did wave scope, sequencing, or milestone planning change?
6. did validation/runbook/operator usage change?
7. did retirement or compatibility boundary change?
8. was there a major cross-domain design decision whose rationale must survive beyond code and constraints?

## 3) Canonical Filing Targets
- Use `docs/constraints/**` when the thread changes:
1. hard rules
2. invariants
3. forbidden patterns
4. shared UI/backend governance
- Use `docs/specs/entities/**` when the thread changes:
1. field meaning
2. ownership
3. lifecycle semantics of a durable subject
- Use `docs/specs/workflows/**` when the thread changes:
1. states
2. transitions
3. actor responsibilities
4. action meaning
- Use `docs/specs/modules/**` when the thread changes:
1. bounded-context ownership
2. canonical module entrypoints
3. allowed/disallowed module integrations
- Use `docs/roadmap/**` when the thread changes:
1. wave scope
2. phase sequencing
3. milestone planning
- Use `docs/acceptance/**` when the thread changes:
1. E2E validation steps
2. operator runbooks
3. demo behavior expectations
- Use `docs/cleanup/**` when the thread changes:
1. compatibility boundaries
2. retirement order
3. staged cleanup decisions

## 4) Default Filing Pattern For New Features
- Most new features SHOULD land in one of these combinations:
1. `constraints + specs + acceptance`
2. `specs + acceptance`
3. `acceptance` only
- A thread MUST NOT skip `constraints/specs` when semantic truth changed.
- A thread SHOULD NOT touch `roadmap` or `cleanup` unless the work actually changes planning or retirement boundaries.

## 5) Thread Filing Workflow
- Every feature thread SHOULD follow this order:
1. identify the domain package
2. read active `constraints`
3. read relevant `specs`
4. read `roadmap/acceptance/cleanup` only when planning, validation, or historical context matters
5. implement the change
6. perform documentation impact check
7. update the correct filing targets in the same thread
- The documentation impact check MUST explicitly ask:
1. did workflow semantics change?
2. did entity or field semantics change?
3. did API or page contract meaning change?
4. did constraints or invariants change?
5. did cleanup/deprecation boundary change?
6. did runtime, DB, or migration semantics change?

## 6) ADR Policy
- `docs/adr/**` SHOULD be retained.
- ADRs are valid in this repo, but they are intentionally sparse.
- ADRs are not for routine feature work, page cleanup, or ordinary contract convergence.
- ADRs exist only to capture major decisions whose rationale would otherwise be lost if someone reads only code, constraints, and specs.

## 7) When ADR Is Required
- Write or update an ADR only when all of the following are true:
1. the decision is major
2. it is cross-domain, architectural, or product-foundational
3. alternatives were meaningfully available
4. future readers would reasonably ask “why did we choose this model?”
- Typical ADR candidates include:
1. major authoring/governance model choices
2. cross-domain source-of-truth model choices
3. platform-wide product architecture decisions
4. a durable split or merge between major subsystems

## 8) When ADR Is Not Required
- ADR is not required for:
1. routine feature implementation
2. normal entity/workflow additions
3. naming cleanup
4. frontend stylistic convergence
5. ordinary API or page contract updates
6. acceptance/runbook updates
- If `constraints/specs` already fully answer both “what” and “how” and no long-lived “why” ambiguity remains, ADR is unnecessary.

## 9) Historical ADR Backfill Policy
- This repo MUST NOT backfill ADRs just to make the ADR folder look complete.
- Historical ADR backfill is optional and SHOULD happen only when:
1. an old foundational decision keeps causing repeated confusion
2. the rationale is still recoverable
3. writing it down will materially reduce future re-litigation
- Cleanup work SHOULD prioritize active truth, compatibility retirement, and runtime convergence before optional ADR backfill.
- In other words:
1. keep ADR
2. keep it sparse
3. backfill only when it solves a real recurring problem

## 10) Practical Decision Table
- If the answer is “the rule changed” -> update `constraints`.
- If the answer is “the object meaning changed” -> update `entities`.
- If the answer is “the flow changed” -> update `workflows`.
- If the answer is “the subsystem contract changed” -> update `modules`.
- If the answer is “the plan changed” -> update `roadmap`.
- If the answer is “the validation path changed” -> update `acceptance`.
- If the answer is “the retirement boundary changed” -> update `cleanup`.
- If the answer is “future readers will not understand why this major model exists” -> consider `ADR`.

## 11) Current Repo Decision
- For the current `Exchange_js` phase:
1. keep `ADR`
2. keep it minimal
3. do not treat “ADR count is low” as documentation debt by itself
4. only add ADRs during future work when a major decision actually needs durable rationale

## 12) Change Protocol
- Any change to this filing policy MUST include:
1. updated filing rules
2. ADR policy impact
3. affected entry documents
4. examples of what now files differently

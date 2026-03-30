# Wave 1 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/acceptance/wave-1-foundation-final-acceptance.md`, `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`, `docs/cleanup/README.md`
Source of Truth Level: cleanup

## Purpose
- This file records the only cleanup work that may still be executed under the `Wave 1` label after Wave 1 reached `implementation-complete` and `documentation-complete`.
- It is an inventory and boundary file, not a semantic redesign plan.
- Its job is to prevent future threads from reopening completed Wave 1 behavior under the name of cleanup.

## Current Judgment
- `Wave 1` is already complete in the current official scope:
  - `implementation-complete`
  - `documentation-complete`
- `runtime compat debt = 0`
- Long-term truth remains in:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- `docs/cleanup/**` remains a lower-order layer used only for retirement history, staged cleanup order, and residual cleanup boundaries.

## What Wave 1 Cleanup Still Means
- `Wave 1 cleanup` now means only:
1. physical-only convergence
2. doc/index-only convergence
3. dead-code-only retirement
- It does not mean:
1. changing canonical taxonomy
2. changing workflow meaning
3. changing acceptance behavior
4. reopening already-closed Wave 1 design decisions

## Allowed Residual Cleanup Classes
### A. `doc/index-only`
- Update stale indexes or cleanup notes whose wording still implies that a cleanup master is an active source of runtime truth.
- Tighten reading order so future threads land in `constraints/specs/acceptance` first.
- Remove old wording that suggests Wave 1 remains an active staged convergence track.

### B. `physical-only`
- Execute narrowly scoped physical rename or physical model convergence that was explicitly left out of Wave 1 final acceptance.
- Such work must preserve canonical runtime behavior exactly as already documented.
- Any physical-only change must prove that:
  - API contract meaning is unchanged
  - workflow meaning is unchanged
  - acceptance steps remain valid
  - audit/governance behavior is unchanged

### C. `dead-code-only`
- Remove compatibility shells or retired branches only when they are proven unused by:
  - active UI paths
  - active API handlers
  - acceptance scripts
  - smoke checks
  - runtime repair scripts
- If a candidate still has a live reader or writer, it is not dead code and must not be removed under this inventory.

## Explicitly Out Of Scope
- The following are not valid `Wave 1 cleanup` work:
1. changing approval types
2. changing change ticket taxonomy
3. changing delete request target taxonomy
4. changing SLA timer types or timing semantics
5. changing admin member / invitation / login acceptance behavior
6. changing evidence export approval or delete behavior
7. introducing new governance scope that belongs to later waves
- If a thread needs any of the above, it is a new design or delivery thread and must file into active `constraints/specs/acceptance`, not this inventory.

## Residual Candidate Inventory
| Candidate | Class | Current Scope | Entry Condition | Required Proof Before Execution | Status |
| --- | --- | --- | --- | --- | --- |
| stale doc wording that still presents the Wave 1 cleanup master as active truth | `doc/index-only` | `docs/README.md`, `docs/cleanup/README.md`, nearby index notes | wording mismatch found | updated index wording; no truth moved out of `constraints/specs/acceptance` | ready |
| Wave 1 reading-order guidance for future cleanup threads | `doc/index-only` | doc indexes and cleanup entry docs | a new Wave 1 cleanup thread starts | reading order explicitly points to completion note, constraints/specs, final acceptance, then residual cleanup inventory | ready |
| concrete code-level scan results for Wave 1 residual cleanup | `dead-code-only` and `legacy naming only` inventory support | `docs/cleanup/wave-1-code-cleanup-candidate-list.md` | a code-scan thread runs against governance / audit / admin-boundary modules | candidates are classified as ready, blocked, or non-Wave-1 with evidence | ready |
| legacy internal naming residue in comments, tests, helper labels, or archived notes | `physical-only` or `doc/index-only` | non-canonical internal labels only | residue is confirmed non-runtime and non-contract | no API/UI/acceptance contract change; canonical term remains unchanged | inventory-needed |
| retired branches related to old export bypass, shared approval delete path, or generic change types | `dead-code-only` | code paths only if still present | candidate branch is proven unreachable from current runtime and checks | search evidence plus relevant smoke/unit checks show no live dependency | inventory-needed |
| physical rename intentionally deferred by final acceptance | `physical-only` | storage/model/file naming only | explicit target and blast radius are documented | migration path, unchanged runtime contract, unchanged acceptance behavior | not-started |
| physical model merge intentionally deferred by final acceptance | `physical-only` | schema/model consolidation only | explicit target and blast radius are documented | unchanged canonical semantics, unchanged delete/audit behavior, migration and rollback notes | not-started |

## Execution Gate For Any Candidate
- A Wave 1 residual cleanup item may proceed only if all answers are `yes`:
1. is it one of `doc/index-only`, `physical-only`, or `dead-code-only`?
2. can we explain it without changing canonical Wave 1 behavior?
3. can we point to the exact current source of truth that remains unchanged?
4. can we verify that acceptance behavior still holds after the change?
- If any answer is `no`, stop and refile the work as a normal design/implementation thread.

## Recommended Order
1. finish `doc/index-only` convergence first
2. then build a precise inventory of any real `dead-code-only` candidates
3. only after that evaluate whether any `physical-only` rename or model convergence is worth doing
- Do not start with schema surgery just because residual cleanup exists in theory.

## Filing Rule
- Threads using this inventory SHOULD usually update:
1. `docs/cleanup/**`
2. `docs/README.md` or `docs/constraints/README.md` when reading order changes
- Threads using this inventory MUST also update active `constraints/specs/acceptance` if they discover the proposed work was actually semantic.

## Exit Condition
- `Wave 1 residual cleanup` is complete when:
1. no stale Wave 1 cleanup wording remains in active indexes
2. no live candidate remains in the residual inventory
3. any remaining items are explicitly deferred as unnecessary physical convergence
- At that point this file may be kept as a closure inventory or marked `archived`.

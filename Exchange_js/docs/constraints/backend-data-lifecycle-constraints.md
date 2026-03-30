Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-domain-model-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`
Source of Truth Level: constraints

# Backend Data Lifecycle Constraints

## 1) Purpose
- This document defines what kinds of backend data may be updated, repaired, deleted, archived, rebuilt, or treated as immutable.

## 2) Canonical Lifecycle Classes
- Backend data MUST be reasoned about as one of:
1. master data
2. workflow/governance execution data
3. config history data
4. subordinate/supporting data
5. execution-result data
6. audit/evidence data
7. snapshot/projection data

## 3) Update and Repair Rules
- Master data MAY be maintained through canonical admin/config surfaces.
- Workflow and governance execution data MAY be repaired only through documented repair surfaces.
- Config history data MUST NOT be edited in place once released or historically effective; new versions or releases MUST replace old ones.
- Execution-result data such as journals and clearings MUST be treated as immutable historical outputs.
- Audit/evidence data MUST be treated as immutable except where an explicit governed delete path exists.
- Snapshot/projection data MAY be rebuilt; direct manual edits are forbidden.

## 4) Delete Rule
- Delete is not a default right.
- Subjects are deletable only when an active constraint explicitly defines:
1. allowed target scope
2. delete workflow
3. read filtering
4. retention and audit expectations

## 5) Retirement Rule
- Old concepts MUST follow staged retirement:
1. active truth
2. compatibility only
3. historical read only
4. retired
- For the current demo baseline, retired concepts MUST NOT return to active DTO, UI, or test language.

## 6) Invariants
- Historical evidence MUST stay replayable.
- Immutable execution history MUST be corrected by compensation or reversal, not overwrite.
- Rebuildable projections MUST be derivable from their documented source of truth.

## 7) Forbidden Patterns
- MUST NOT mutate released config history in place.
- MUST NOT hand-edit audit, journal, or clearing outputs as a normal workflow.
- MUST NOT delete unsupported target types through ad-hoc admin actions.

## 8) Change Protocol
- Any lifecycle-policy change MUST include:
1. target subject class
2. update/delete/archive/rebuild impact
3. audit and retention impact
4. compatibility and retirement impact

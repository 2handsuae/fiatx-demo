Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-api-contract-constraints.md`
Source of Truth Level: constraints

# Backend Read Model Constraints

## 1) Purpose
- This document fixes the backend responsibility for operator-facing list/detail payloads.

## 2) Read-Model Ownership
- Backend services own operator-facing read models.
- Frontend pages MUST NOT become the primary place where subject truth is joined, normalized, or inferred.

## 3) Required Read-Model Content
- A first-class subject detail SHOULD expose:
1. operator-facing identity
2. canonical lifecycle status
3. key timestamps
4. linked subject keys
5. important derived display truth
6. allowed actions
- A first-class subject list SHOULD expose the minimum stable decision surface for operators.

## 4) Canonical vs Derived Display
- Read-models MAY include derived or display-only fields.
- Derived fields MUST NOT replace canonical source-of-truth fields.
- Compatibility or display labels MUST be clearly subordinate to canonical truth.

## 5) Linkage Rule
- Operator-facing read models SHOULD mirror linked subject `No/Code` values whenever those links are operationally relevant.
- Raw foreign keys MAY exist in detail payloads, but operator navigation MUST NOT depend on raw UUID visibility alone.

## 6) Invariants
- If a page requires repeated client-side stitching to understand a subject, the backend read model is incomplete.
- If a subject can be acted on by operators, the read model MUST provide enough context to understand the action safely.

## 7) Forbidden Patterns
- MUST NOT treat database table shape as the final admin detail contract.
- MUST NOT expose only IDs when the operator decision depends on human-readable linked identities.
- MUST NOT hide lifecycle meaning behind undocumented display-only fields.

## 8) Change Protocol
- Any read-model change MUST include:
1. impacted pages or consumers
2. canonical vs derived field impact
3. regression verification path

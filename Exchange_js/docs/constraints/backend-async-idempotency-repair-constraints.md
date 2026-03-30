Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-workflow-state-machine-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: constraints

# Backend Async Idempotency Repair Constraints

## 1) Purpose
- This document defines the baseline rules for asynchronous execution, replay safety, and repair surfaces.

## 2) Async Responsibility
- Any backend flow that uses callbacks, jobs, retries, delayed completion, or compensating re-entry MUST define:
1. trigger source
2. idempotency key
3. replay behavior
4. failure behavior
5. repair surface

## 3) Idempotency Rule
- Repeated deliveries of the same semantic event MUST NOT create duplicate durable business results.
- Idempotency MAY be enforced by source keys, composite source identity, or dedicated idempotency keys, but it MUST be explicit.

## 4) Repair Surface Rule
- Repair is allowed only through explicit actions such as:
1. retry
2. replay
3. recalc
4. re-scan
5. re-link
6. re-closeout
7. re-compensate
- Repair MUST NOT mean direct database editing as a normal operator practice.

## 5) Audit Rule
- Every repair action MUST capture:
1. who triggered it
2. why it was needed
3. what subject it targeted
4. what the result was

## 6) Invariants
- A repair path MUST be narrower than the normal workflow path.
- A repeated repair MUST remain replay-safe.
- A failed async chain MUST fail explicitly rather than degrading into silent partial success.

## 7) Forbidden Patterns
- MUST NOT rely on manual SQL as the canonical repair mechanism.
- MUST NOT allow repair actions that bypass lifecycle ownership or audit.
- MUST NOT let callback retries mint duplicate outputs.

## 8) Change Protocol
- Any new repair surface or async callback path MUST document:
1. idempotency key or replay boundary
2. allowed operator roles
3. audit behavior
4. compensation or rollback strategy

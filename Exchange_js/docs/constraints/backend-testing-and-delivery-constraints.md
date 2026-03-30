Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-architecture-constraints.md`, `docs/README.md`
Source of Truth Level: constraints

# Backend Testing And Delivery Constraints

## 1) Purpose
- This document defines the backend delivery bar for new behavior, refactors with semantic impact, and documentation truth changes.

## 2) Minimum Delivery Questions
- A backend change is not delivery-complete until it answers:
1. which subject/domain changed
2. which API or read-model changed
3. which workflow or lifecycle changed
4. which audit behavior changed
5. which tests or verification steps prove it

## 3) Test Expectations
- Behavior changes SHOULD add or update the fastest relevant automated checks available in the repo.
- Workflow changes SHOULD validate:
1. valid transition path
2. invalid transition rejection
3. side effects
4. idempotency when relevant
- Read-model or API changes SHOULD validate payload stability or at least the critical non-500 contract path.

## 4) Documentation Expectations
- Semantic backend changes MUST update:
1. relevant horizontal constraints when shared rules changed
2. relevant vertical constraints/specs when domain truth changed
3. acceptance docs when operator validation changed
- Documentation-only threads still require index consistency when the documentation architecture changes.

## 5) Verification Expectations
- The fastest relevant verification MUST run before claiming completion.
- No thread may claim backend success while skipping known required audit, transition, or contract verification without calling that out explicitly.

## 6) Forbidden Patterns
- MUST NOT treat implementation as complete when audit integration is missing for required surfaces.
- MUST NOT change backend semantic truth without documentation impact review.
- MUST NOT rely on manual memory instead of recorded verification evidence for critical behavior changes.

## 7) Change Protocol
- Any delivery-bar change MUST include:
1. newly required checks
2. affected domains or workflows
3. documentation update impact

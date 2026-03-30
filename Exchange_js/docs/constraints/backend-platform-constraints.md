Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/constraints/backend-domain-model-constraints.md`, `docs/constraints/backend-identity-and-operator-key-constraints.md`, `docs/constraints/backend-api-contract-constraints.md`, `docs/constraints/backend-read-model-constraints.md`, `docs/constraints/backend-workflow-state-machine-constraints.md`, `docs/constraints/backend-async-idempotency-repair-constraints.md`, `docs/constraints/backend-data-lifecycle-constraints.md`, `docs/constraints/backend-provider-integration-constraints.md`, `docs/constraints/backend-auth-and-authorization-constraints.md`, `docs/constraints/backend-testing-and-delivery-constraints.md`
Source of Truth Level: constraints

# Backend Platform Constraints

## 1) Purpose and Positioning
- This document is the backend constitution for `Exchange_js`.
- It defines the common rules that every backend domain, entity, workflow, and API contract MUST follow.
- It does not replace domain constraints or entity/workflow specs; it sits above them and fixes shared language and boundaries.

## 2) Scope
- Applies to:
1. `src/**`
2. `prisma/**`
3. `scripts/**`
4. backend-facing docs under `docs/constraints/**` and `docs/specs/**`
- Applies to all current and future waves.
- `roadmap`, `acceptance`, and `cleanup` MAY describe planning, validation, and retirement history, but they MUST NOT override this document or any active domain truth under `constraints/specs`.

## 3) Non-Negotiable Platform Rules
- Every backend change MUST identify:
1. which domain package it belongs to
2. which subject class it changes
3. what the operator-facing identifier is
4. who owns write authority
5. whether state-machine, audit, repair, or retirement semantics changed
- Every durable backend subject MUST follow the domain-model and identity rules from the horizontal backend constraints.
- Every new behavior with durable state, operator-visible action, automatic blocking, or external callback MUST land with:
1. canonical audit coverage
2. explicit lifecycle ownership
3. API/read-model contract definition
4. test and delivery verification
- Active backend truth MUST live in:
1. `docs/constraints/**`
2. `docs/specs/**`
- Completed wave docs MUST point readers back to active truth and MUST NOT become the long-term behavior source.

## 4) Backend Documentation Architecture
- The backend documentation system is fixed to four layers:
1. `总法`
   - `docs/constraints/backend-platform-constraints.md`
2. `横向分则`
   - cross-domain backend constraints under `docs/constraints/backend-*.md`
3. `纵向分则`
   - domain constraints plus domain entity/workflow/module specs
4. `wave 历史层`
   - `docs/roadmap/**`, `docs/acceptance/**`, `docs/cleanup/**`
- `constraints` answer hard rules.
- `specs` answer durable meaning.
- `roadmap` answers sequencing.
- `acceptance` answers validation.
- `cleanup` answers retirement history.

## 5) Invariants
- One concept MUST have one canonical name.
- One subject MUST have one primary lifecycle owner.
- One subject MUST have one primary operator-facing identity contract.
- One workflow root MUST have one canonical state machine.
- One backend surface MUST expose one deterministic read-model contract for operators.
- Historical aliases MAY remain in migration or compatibility layers only; they MUST NOT return to active DTO, UI, or test language.

## 6) Forbidden Patterns
- MUST NOT place long-term backend truth only in wave plans, acceptance scripts, or cleanup notes.
- MUST NOT let one module directly mutate another module's workflow root state outside the root owner service.
- MUST NOT treat raw database tables as product objects before classifying them under the backend domain-model rules.
- MUST NOT expose `id` as the primary operator query contract when a stable operator-facing key exists or is required.
- MUST NOT reintroduce retired concept names into active runtime language.

## 7) Change Protocol
- Any change to the backend documentation architecture MUST include:
1. changed horizontal or vertical doc set
2. impacted domains
3. operator/read-model impact
4. compatibility or retirement impact
- Any thread that changes backend semantics MUST perform a documentation impact check against:
1. this platform document
2. the relevant horizontal backend constraints
3. the relevant vertical domain constraints/specs

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-identity-and-operator-key-constraints.md`, `docs/constraints/backend-architecture-constraints.md`
Source of Truth Level: constraints

# Backend API Contract Constraints

## 1) Purpose
- This document defines the common API contract shape for backend operator and system surfaces.

## 2) Canonical API Surface Types
- Operator and admin APIs SHOULD fit one of:
1. `list`
2. `detail`
3. `action`
4. `export`
- Public/customer APIs MAY use different route placement, but SHOULD still keep deterministic payload and error shapes.

## 3) List Contract
- List endpoints MUST expose operator-facing identity and key lifecycle/status fields.
- List filters SHOULD prioritize exact `No/Code` filters over free-text search.
- List responses MUST stay deterministic in field naming and pagination contract.

## 4) Detail Contract
- Detail endpoints MUST expose:
1. operator-facing identity
2. canonical lifecycle truth
3. key linked subject identities
4. operator-relevant timestamps
5. allowed actions when applicable
- Detail endpoints MUST NOT require the frontend to reconstruct primary business truth from multiple unrelated APIs.

## 5) Action Contract
- Action endpoints MUST represent a named, canonical business/governance action rather than free-form partial mutation.
- Action responses MUST indicate:
1. whether the action was accepted
2. what subject it applied to
3. what the resulting state or next state anchor is
- Unsupported transitions MUST fail explicitly.

## 6) Export Contract
- Export endpoints MUST be explicit export surfaces rather than overloaded list/detail routes.
- Export responses MUST identify the exported subject by operator-facing identity when applicable.

## 7) Error Contract
- Backend error responses MUST include at minimum:
1. machine-readable code
2. HTTP status
3. human-readable message
4. request or trace context when available
- Backend error wording MUST stay stable enough for operator and test use.

## 8) Compatibility Rule
- Active API payloads MUST use canonical concept names.
- Retired aliases MAY appear only in explicitly marked compatibility shells and MUST NOT be introduced in new routes.

## 9) Forbidden Patterns
- MUST NOT expose raw Prisma-shaped records as the long-term API contract.
- MUST NOT mix list/detail/action semantics into one ambiguous endpoint.
- MUST NOT require the frontend to infer core lifecycle truth from undocumented field combinations.

## 10) Change Protocol
- Any API behavior change MUST include:
1. impact list
2. backward compatibility statement
3. migration or rollout note if operator behavior changes

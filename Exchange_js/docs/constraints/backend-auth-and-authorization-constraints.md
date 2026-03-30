Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/governance-approval-constraints.md`
Source of Truth Level: constraints

# Backend Auth And Authorization Constraints

## 1) Purpose
- This document defines the common backend authorization rules that sit above domain-specific role matrices.

## 2) Authorization Layers
- Backend authorization MUST be reasoned about separately as:
1. authentication
2. route permission
3. action permission
4. segregation-of-duties control

## 3) Permission Rule
- Route access and business action authority MUST NOT be treated as the same thing by default.
- High-risk actions SHOULD use explicit action permission checks even when the route is already protected.

## 4) Source of Truth Rule
- Authorization truth MUST come from canonical role binding and permission binding, not compatibility shadow fields.
- Compatibility display fields MAY remain, but MUST NOT decide effective permissions.

## 5) SoD Rule
- Sensitive governance and repair actions MUST respect maker-checker or maker-executor boundaries when those flows define them.
- Any privileged bypass MUST be explicit and auditable.

## 6) Service Boundary Rule
- Cross-module or service-to-service behavior MUST call canonical entrypoints.
- Authorization-sensitive business actions MUST NOT be performed through hidden backdoor service calls that skip policy checks.

## 7) Forbidden Patterns
- MUST NOT hardcode authorization truth into UI assumptions alone.
- MUST NOT grant action authority implicitly just because a user can open the page.
- MUST NOT bypass SoD silently.

## 8) Change Protocol
- Any auth or permission behavior change MUST include:
1. impacted roles
2. impacted routes and actions
3. SoD impact
4. audit or compatibility impact

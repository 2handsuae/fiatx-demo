Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/backend-auth-and-authorization-constraints.md`
Source of Truth Level: specs-entity

# Permission Entity

## Purpose
- This document defines `Permission` as the durable authorization atom used by route and action checks.
- The permission catalog is fixed; runtime member flows consume permissions through role bindings, not direct authoring.

## Canonical Fields
- `id`
- `code`
- `name`
- `description`
- `method`
- `path`

## Canonical Meaning
- `Permission` is the smallest durable grant unit in the backend authorization model.
- `code` is the canonical catalog key.
- `method + path` describe the primary route surface, but a permission may also imply action-level checks in service logic.

## Write Owners
- Base seed and RBAC catalog management own fixed permission catalog truth.
- Role assignment consumes permissions through `role_permissions`.

## Relationship Rules
- `Permission` is a config subject, not a workflow or operator identity root.
- Permission changes are platform-behavior changes and must respect governance/change control where applicable.
- Permission catalog entries are not created by member assignment flows.

## Historical / Retired Notes
- Compatibility display fields or menu assumptions MUST NOT replace permission-catalog truth.

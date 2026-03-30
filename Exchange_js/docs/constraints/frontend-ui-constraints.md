Status: deprecated
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js/admin-web`, `Exchange_js/client-web`
Supersedes: none
Depends On: `docs/constraints/frontend-platform-constraints.md`, `docs/constraints/frontend-admin-ui-constraints.md`, `docs/constraints/frontend-client-ui-constraints.md`
Source of Truth Level: constraints-redirect

# Frontend UI Constraints (Deprecated Redirect)

## Status
- This document is no longer the active frontend rule source.
- It remains only as a redirect for historical references and older threads.

## Replacement
- Active frontend truth is now split into three documents:
1. `docs/constraints/frontend-platform-constraints.md`
2. `docs/constraints/frontend-admin-ui-constraints.md`
3. `docs/constraints/frontend-client-ui-constraints.md`

## Reading Order
- Read `frontend-platform-constraints.md` first.
- Then read the app-specific document:
1. `frontend-admin-ui-constraints.md` for `admin-web`
2. `frontend-client-ui-constraints.md` for `client-web`

## Migration Note
- Rules that used to live here have been redistributed as follows:
1. shared routing, auth, request, contract, and runtime rules -> platform document
2. admin operator-console structure and visual rules -> admin document
3. client journey, onboarding verification, and advanced-fintech product rules -> client document

## Retirement Boundary
- New work MUST NOT cite this file as the sole frontend source of truth.
- Historical thread links MAY still land here, but active updates MUST happen in the replacement documents.

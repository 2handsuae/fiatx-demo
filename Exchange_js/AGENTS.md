# AGENTS (Exchange_js)

## Mandatory Read First
Before any code change in `Exchange_js`, read:
1. `docs/constraints/README.md`
2. `docs/constraints/frontend-ui-constraints.md`
3. `docs/constraints/backend-architecture-constraints.md`
4. `docs/constraints/runtime-config-constraints.md`
5. `docs/constraints/onboarding-flow-constraints.md`
6. `docs/constraints/customer-transaction-flow-constraints.md`
7. `docs/constraints/internal-transaction-flow-constraints.md`

## Scope
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Frontend: `admin-web/**`, `client-web/**`

## Local Workflow Defaults
- Start: `npm run dev:start`
- Stop: `npm run dev:stop`
- Biz reset: `npm run dev:reset`

## Non-Negotiables
- Do not commit secrets or local runtime artifacts.
- Do not bypass onboarding/compliance status gate semantics.
- Do not introduce startup-time implicit data mutation without explicit config gate.

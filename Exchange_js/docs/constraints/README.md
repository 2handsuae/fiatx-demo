# Constraints Index (For Future Threads)

## Purpose
These documents define non-negotiable engineering constraints for all future thread work in `Exchange_js`.
Any agent/thread must read this folder first before proposing or implementing changes.

## Required Reading Order
1. `docs/constraints/frontend-ui-constraints.md`
2. `docs/constraints/backend-architecture-constraints.md`
3. `docs/constraints/runtime-config-constraints.md`
4. `docs/constraints/onboarding-flow-constraints.md`
5. `docs/constraints/compliance-alert-incident-constraints.md`
6. `docs/constraints/customer-transaction-flow-constraints.md`
7. `docs/constraints/internal-transaction-flow-constraints.md`
8. `docs/constraints/audit-logging-constraints.md`

## Scope
- Frontend: `admin-web`, `client-web`
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Runtime: local dev scripts, envs, startup/reset workflow
- Domain flow: onboarding and compliance lifecycle
- Domain flow: compliance alert and incident lifecycle
- Domain flow: customer transaction workflow (deposit/swap/withdraw)
- Domain flow: internal treasury workflow (`internal_transactions` / `internal_funds`)
- Domain flow: unified audit logging and evidence package

## Enforcement Level
- `MUST`: mandatory constraint, no exception unless owner explicitly approves.
- `SHOULD`: preferred default; deviation needs reason in PR/thread notes.
- `MAY`: optional guidance.

## Change Protocol
- Any change to these constraints MUST include:
1. changed file(s)
2. rationale
3. impacted modules/routes/scripts
4. migration plan (if behavior changes)

## Current Local Baseline
- API default: `3000`
- Admin default: `3001`
- Client default: `3002`
- Database URL default in backend `.env`: `DATABASE_URL="file:./dev.db"` (resolved by Prisma to `prisma/dev.db`)

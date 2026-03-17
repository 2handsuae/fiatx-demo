# Constraints Index (For Future Threads)

## Purpose
These documents define non-negotiable engineering constraints for all future thread work in `Exchange_js`.
Any agent/thread must read this folder first before proposing or implementing changes.

## Required Reading Order
1. `docs/constraints/frontend-ui-constraints.md`
2. `docs/constraints/backend-architecture-constraints.md`
3. `docs/constraints/runtime-config-constraints.md`
4. `docs/constraints/onboarding-flow-constraints.md`
5. `docs/constraints/customer-transaction-flow-constraints.md`
6. `docs/constraints/internal-transaction-flow-constraints.md`
7. `docs/constraints/audit-logging-constraints.md`
8. `docs/constraints/rbac-member-management-constraints.md`
9. `docs/constraints/governance-change-ticket-constraints.md`
10. `docs/constraints/governance-delete-request-constraints.md`
11. `docs/constraints/governance-sla-timer-constraints.md`
12. `docs/constraints/compliance-alert-case-foundation-constraints.md`
13. `docs/constraints/compliance-alert-incident-constraints.md`

## Scope
- Frontend: `admin-web`, `client-web`
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Runtime: local dev scripts, envs, startup/reset workflow
- Domain flow: onboarding and compliance lifecycle
- Domain flow: current V1 compliance alert and incident implementation lifecycle
- Domain flow: customer transaction workflow (deposit/swap/withdraw)
- Domain flow: internal treasury workflow (`internal_transactions` / `internal_funds`)
- Domain flow: unified audit logging and evidence package
- Domain flow: admin member management and RBAC seed account baseline
- Domain flow: governance change ticket and release gate workflow
- Domain flow: governance delete request and soft delete gate workflow
- Domain flow: governance SLA timer workflow
- Domain flow: `Wave 2` compliance alert / case foundation semantics
- Domain flow: admin member invitation activation lifecycle (`INACTIVE -> invite -> password setup -> ACTIVE`)

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
- API default: `3500`
- Admin default: `3501`
- Client default: `3502`
- Database URL default in backend `.env`: `DATABASE_URL="file:/tmp/exchange_js_audit_evidence/dev.db"`
- Stack-local SQLite defaults MUST stay on ASCII-safe absolute paths such as `/tmp/exchange_js_<stack>/dev.db`
- Local schema bootstrap entry: `npm run db:migrate:local` (versioned SQL chain runner)

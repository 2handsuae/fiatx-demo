# Constraints Index (For Future Threads)

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `AGENTS.md`, `docs/README.md`
Source of Truth Level: constraints-index

## Purpose
These documents define non-negotiable engineering constraints for all future thread work in `Exchange_js`.
Any agent/thread must read this folder before proposing or implementing changes that touch constrained behavior.
This file is the constraints subtree index under the project-level documentation governance in `docs/README.md`.

## Required Reading Order
1. `docs/constraints/frontend-ui-constraints.md`
2. `docs/constraints/backend-architecture-constraints.md`
3. `docs/constraints/runtime-config-constraints.md`
4. `docs/constraints/onboarding-flow-constraints.md`
5. `docs/constraints/customer-transaction-flow-constraints.md`
6. `docs/constraints/internal-transaction-flow-constraints.md`
7. `docs/constraints/audit-logging-constraints.md`
8. `docs/constraints/rbac-member-management-constraints.md`
9. `docs/constraints/governance-approval-constraints.md`
10. `docs/constraints/governance-change-ticket-constraints.md`
11. `docs/constraints/governance-delete-request-constraints.md`
12. `docs/constraints/governance-sla-timer-constraints.md`
13. `docs/constraints/compliance-alert-case-foundation-constraints.md`
14. `docs/constraints/compliance-alert-incident-constraints.md`
- When work touches `Wave 2` case final lifecycle, also read:
1. `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
2. `docs/specs/workflows/mlro-and-final-approval-governance.md`
- When work touches `Wave 2` alert / case field semantics, also read:
1. `docs/specs/entities/compliance-alert-entity.md`
2. `docs/specs/entities/compliance-case-entity.md`
3. `docs/specs/entities/compliance-case-report-entity.md`
4. `docs/specs/entities/compliance-external-filing-entity.md`
- When work touches compliance-center integration boundaries, also read:
1. `docs/specs/modules/compliance-center-module.md`
2. `docs/specs/modules/risk-engine-module.md`
3. `docs/specs/modules/approvals-module.md`
- When work touches `Wave 2` compatibility / audit / filing cleanup debt, also read:
1. `docs/cleanup/wave-2-cleanup-master-plan.md`
- When work touches onboarding / periodic review audit chain, also read:
1. `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- When work touches onboarding / customer / response entity semantics, also read:
1. `docs/specs/entities/customer-entity.md`
2. `docs/specs/entities/review-response-entity.md`
3. `docs/specs/entities/periodic-review-cycle-entity.md`
4. `docs/specs/entities/approval-case-entity.md`
5. `docs/specs/entities/risk-decision-record-entity.md`
- When work touches onboarding / periodic review module boundaries, also read:
1. `docs/specs/modules/customer-onboarding-module.md`
2. `docs/specs/modules/periodic-review-module.md`
- When work touches final end-to-end validation for Wave 2 / Wave 3, also read:
1. `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`

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
- Domain flow: governance approval workflow
- Domain flow: governance change ticket and release gate workflow
- Domain flow: governance delete request and soft delete gate workflow
- Domain flow: governance SLA timer workflow
- Domain flow: `Wave 2` compliance alert / case foundation semantics
- Domain flow: `Wave 2` case final lifecycle and external filing separation semantics
- Domain flow: onboarding / periodic review unified audit chain and trace contract
- Domain flow: admin member invitation activation lifecycle (`INACTIVE -> invite -> password setup -> ACTIVE`)

## Enforcement Level
- `MUST`: mandatory constraint, no exception unless owner explicitly approves.
- `SHOULD`: preferred default; deviation needs reason in PR/thread notes.
- `MAY`: optional guidance.

## Precedence
- `docs/constraints/**` overrides:
1. `docs/specs/**`
2. `docs/adr/**`
3. `docs/cleanup/**`
4. `docs/roadmap/**`
5. `docs/acceptance/**`
- If a constraint becomes stale because implementation changed, the relevant thread must update it instead of relying on chat-only clarification.

## Change Protocol
- Any change to these constraints MUST include:
1. changed file(s)
2. rationale
3. impacted modules/routes/scripts
4. migration plan (if behavior changes)

## Current Local Baseline
- Standard `main` stack entry: `npm run stack:up:main` or `npm run dev:start`
- API default: `3000`
- Admin default: `3001`
- Client default: `3002`
- Database URL default in backend `.env`: `DATABASE_URL="file:/tmp/exchange_js_main/dev.db"`
- Stack-local SQLite defaults MUST stay on ASCII-safe absolute paths such as `/tmp/exchange_js_<stack>/dev.db`
- Local schema bootstrap entry: `npm run db:migrate:local` (versioned SQL chain runner)
- Governance/runtime repair playbook: `docs/acceptance/local-main-runtime-runbook.md`

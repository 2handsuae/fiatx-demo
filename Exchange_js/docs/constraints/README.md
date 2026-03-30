# Constraints Index (For Future Threads)

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `AGENTS.md`, `docs/README.md`
Source of Truth Level: constraints-index

## Purpose
These documents define non-negotiable engineering constraints for all future thread work in `Exchange_js`.
Any agent/thread must read this folder before proposing or implementing changes that touch constrained behavior.
This file is the constraints subtree index under the project-level documentation governance in `docs/README.md`.

## Constraint Architecture
- Frontend constraints are now organized in two groups:
1. `平台共享硬规则`
   - `docs/constraints/frontend-platform-constraints.md`
2. `应用专属规则`
   - `docs/constraints/frontend-admin-ui-constraints.md`
   - `docs/constraints/frontend-client-ui-constraints.md`
- Backend constraints are organized in two groups:
1. `横向规则`
   - cross-domain backend rules shared by every domain
2. `纵向业务域规则`
   - domain constraints for onboarding, compliance, governance, transactions, ledger, wallet/account, and reconciliation
- `runtime-config-constraints.md` remains an adjacent runtime/stack rule set.
- `docs/constraints/frontend-ui-constraints.md` is deprecated and remains only as a redirect note.

## Required Reading Order
- For documentation-architecture or filing questions:
1. `docs/constraints/documentation-filing-and-adr-constraints.md`
- For frontend-only work:
1. `docs/constraints/frontend-platform-constraints.md`
2. `docs/constraints/frontend-admin-ui-constraints.md` or `docs/constraints/frontend-client-ui-constraints.md`
3. `docs/constraints/runtime-config-constraints.md` when env/runtime wiring matters
4. relevant backend/domain constraints only when the page contract depends on backend truth
- For backend or full-stack work:
1. `docs/constraints/backend-platform-constraints.md`
2. `docs/constraints/backend-domain-model-constraints.md`
3. `docs/constraints/backend-identity-and-operator-key-constraints.md`
4. `docs/constraints/backend-architecture-constraints.md`
5. `docs/constraints/backend-api-contract-constraints.md`
6. `docs/constraints/backend-read-model-constraints.md`
7. `docs/constraints/backend-workflow-state-machine-constraints.md`
8. `docs/constraints/backend-async-idempotency-repair-constraints.md`
9. `docs/constraints/backend-data-lifecycle-constraints.md`
10. `docs/constraints/backend-provider-integration-constraints.md`
11. `docs/constraints/backend-auth-and-authorization-constraints.md`
12. `docs/constraints/backend-testing-and-delivery-constraints.md`
13. `docs/constraints/runtime-config-constraints.md`
- Then read the relevant vertical domain package:
1. `Identity & Access`
   - `docs/constraints/rbac-member-management-constraints.md`
2. `Customer Lifecycle`
   - `docs/constraints/onboarding-flow-constraints.md`
3. `Risk & Compliance`
   - `docs/constraints/compliance-alert-case-foundation-constraints.md`
   - `docs/constraints/compliance-alert-incident-constraints.md`
4. `Governance Control Gates`
   - `docs/constraints/governance-approval-constraints.md`
   - `docs/constraints/governance-change-ticket-constraints.md`
   - `docs/constraints/governance-delete-request-constraints.md`
   - `docs/constraints/governance-sla-timer-constraints.md`
5. `Audit & Evidence`
   - `docs/constraints/audit-logging-constraints.md`
6. `Asset & Treasury Foundation`
   - `docs/constraints/wallet-account-model-constraints.md`
   - `docs/constraints/internal-transaction-flow-constraints.md`
7. `Pricing & Config Release`
   - `docs/constraints/pricing-and-quote-constraints.md`
   - `docs/constraints/business-base-config-release-constraints.md`
8. `Customer Transactions`
   - `docs/constraints/customer-transaction-flow-constraints.md`
9. `Accounting Ledger`
   - `docs/constraints/posting-clearing-balance-projection-constraints.md`
10. `Clearing & Reconciliation`
   - `docs/constraints/safeguarding-reconciliation-constraints.md`
- When work touches domain truth in detail, also read the domain package under `docs/specs/entities/**`, `docs/specs/workflows/**`, and `docs/specs/modules/**`.
- When work touches completed wave validation or historical retirement context, also read the relevant files in `docs/acceptance/**`, `docs/roadmap/**`, or `docs/cleanup/**`.

## Scope
- Documentation filing and ADR policy:
  - where new truth belongs
  - when ADR is required
  - when ADR should stay sparse
- Frontend: `admin-web`, `client-web`
- Frontend shared rules:
  - route/app boundary
  - request/session handling
  - action semantics
  - state surfaces
  - canonical naming
  - accessibility/responsive baseline
- Frontend app-specific rules:
  - admin operator-console structure and visual grammar
  - client advanced-fintech mood, journey, and CTA rules
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Runtime: local dev scripts, envs, startup/reset workflow
- Horizontal backend governance:
  - subject model
  - identity and operator keys
  - API contracts
  - read-model contracts
  - workflow ownership and state machines
  - async/replay/repair rules
  - data lifecycle rules
  - provider integration rules
  - auth and authorization rules
  - testing and delivery rules
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
- Domain flow: Wave 4 wallet/account model, business-config release model, event-driven posting/clearing, and pricing/quote baseline

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

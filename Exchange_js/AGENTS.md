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
8. `docs/constraints/audit-logging-constraints.md`
9. `docs/constraints/rbac-member-management-constraints.md`
10. `docs/constraints/compliance-alert-incident-constraints.md`

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

## Recent Core Decisions (2026-02-18)
- Outstanding settlement is a reconciliation-domain orchestrator and stays in `clearing-settle/outstanding-settlements`; execution remains `internal_transactions` + `internal_funds`.
- Internal transaction accounting naming is normalized by asset domain:
1. same moment + different templates => explicit `__CRYPTO` / `__FIAT`
2. same moment + same template => shared event code (for example `EVT_WITHDRAWAL_FAILED`)
- FIAT internal transaction accounting must mirror CRYPTO lifecycle semantics (created posting, terminal success/reversal, wallet snapshot projection), using FIAT-specific events/templates.
- FIAT withdraw source wallet for posting/binding is `CUST_BANK` pool (AED baseline `WA-CBK-AED-NA`), not `LIQ_BANK`.
- Business reset boundary includes quote/outstanding/rate business tables; base config keeps valuation/accounting templates/events.

## Recent Core Decisions (2026-02-19)
- `Platform Members` is the single member-management entry under `Backend Member Management`; keep create-member and assign-roles workflow in this page.
- Role and permission explanation is split into dedicated `Role Management` page; do not duplicate catalog blocks back into `Platform Members`.
- Platform member onboarding uses invitation activation flow:
1. create member with `INACTIVE` status
2. issue one-time invitation link (`24h` TTL, resend invalidates prior token)
3. invited admin sets password and activates account (`INACTIVE -> ACTIVE`)
- Base seed MUST preserve one fixed admin account per RBAC role (17 total role seed accounts) and keep deterministic role binding on every base sync.
- `SUPER_ADMIN` seed identity remains `admin@fiatx.com` (`ADMIN-001`); no extra `super_admin@...` seed account.
- Seed role binding rule for role accounts is strict single-role convergence: target role MUST exist in `user_roles`, non-target role bindings MUST be removed.
- Transaction compliance keeps three evidence case semantics:
1. `PRE-KYT`: wallet screening
2. `KYT`: transaction screening
3. `TRAVEL_RULE`: counterparty information exchange
- Auto case creation timing is locked for `CRYPTO` flows:
1. withdraw `CREATED` => create `PRE-KYT`
2. deposit `payin CONFIRMED` => create `MAIN-KYT` + `TRAVEL_RULE`
3. withdraw `payout CONFIRMED` => create `MAIN-KYT` + `TRAVEL_RULE`
- Transaction page remains the only approval gate; compliance case pages are evidence-only and MUST NOT expose case-level approve/reject/override.
- Admin compliance navigation is split into `Tx Evidence Bundles`, `KYT Cases`, and `Travel Rule Cases` (with legacy `tx-cases` path compatibility).
- Withdraw compliance gate is locked as:
1. `CRYPTO`: enforce `preKytStatus=PASS`
2. `FIAT`: no PRE-KYT gate

## Recent Core Decisions (2026-02-20)
- Compliance Incident V1 is enabled and is created manually from alert escalation (`POST /admin/compliance/incidents/from-alert/:alertId`).
- Incident mainline is fixed to `NEW -> ASSIGNED -> INVESTIGATING -> RESOLVED -> CLOSED`, with branch to `FALSE_POSITIVE`; terminal states cannot reopen.
- One incident can aggregate multiple alerts, but one alert can belong to only one incident (`compliance_incident_alerts.alertId` global unique).
- Alert escalation to incident must run in one DB transaction: escalate alert to terminal `ESCALATED` and create incident + primary link atomically.

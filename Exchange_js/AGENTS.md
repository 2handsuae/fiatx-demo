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
10. `docs/constraints/governance-change-ticket-constraints.md`
11. `docs/constraints/governance-delete-request-constraints.md`
12. `docs/constraints/governance-sla-timer-constraints.md`
13. `docs/constraints/compliance-alert-incident-constraints.md`

## Scope
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Frontend: `admin-web/**`, `client-web/**`

## Planning Reference
- For roadmap, milestone, wave-planning, or scope-sequencing requests, also read:
  - `docs/project-version-plan.md`
  - `docs/wave1-foundation-migration-from-exchange-java.md`
- This planning reference does not override `docs/constraints/**`; constraints remain the behavioral source of truth.

## Product Demo Context
- This project is primarily a product demo / workflow demonstration system, not a production-security-hardening program.
- The user is acting mainly as product owner, not as implementation/security engineer.
- For future discussion, planning, and code changes, default priority is:
1. clear business logic
2. correct workflow/state-machine semantics
3. control gate meaning and evidence traceability
4. admin/client product experience for demo and review
- Unless explicitly requested, do NOT optimize for production-grade security completeness such as:
1. advanced session management
2. token revocation architecture
3. device-level session controls
4. full zero-trust style auth hardening
5. deep infra/network security design
- Existing auth/RBAC semantics that support workflow meaning SHOULD be preserved, but gaps in security hardening alone are not treated as blocking if the demo/product logic is already clear and correct.
- When evaluating completeness, agents SHOULD distinguish:
1. demo-ready logical completeness
2. production-ready security completeness
- Default discussion baseline: if a capability is logically clear, demonstrable, and supports workflow gating correctly, it is acceptable even if security engineering depth is intentionally simplified.

## Local Workflow Defaults
- Main stack up: `npm run dev:start` (delegates to `stack:up:main`)
- Main stack down: `npm run dev:stop` (delegates to `stack:down:main`)
- Biz reset only: `npm run dev:reset`
- Full local DB rebuild: `npm run dev:rebuild`
- Diagnose runtime / migration drift: `npm run runtime:diagnose`
- Governance/runtime runbook: `docs/local-main-runtime-runbook.md`

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
- Incident mainline is fixed to `NEW -> ASSIGNED -> INVESTIGATING -> RESOLVED -> CLOSED`, with branch to `FALSE_POSITIVE`; terminal states cannot reopen. (superseded by 2026-02-22 flow)
- One incident can aggregate multiple alerts, but one alert can belong to only one incident (`compliance_incident_alerts.alertId` global unique).
- Alert escalation to incident must run in one DB transaction: escalate alert to terminal `ESCALATED` and create incident + primary link atomically.

## Recent Core Decisions (2026-02-22)
- Incident workflow is simplified to `OPEN -> ASSIGNED -> CLOSED`; legacy `RESOLVED` records are read-only compatible and MUST NOT be produced by new transitions.
- Alert and incident recommendation buttons are container-level actions sourced from Risk Engine output and are intentionally repeat-callable; onboarding stage legality is the final gate.
- CDD mock `LOW_RISK` is auto-pass: no onboarding journey alert is created/updated, and customer moves directly to `ACTIVE`.
- CDD mock `MEDIUM_RISK` / `HIGH_RISK_OR_PEP` create/update onboarding journey alert only; no automatic incident creation.
- CDD mock `SANCTION_AND_OTHER` is the only auto-escalation exception: create/update alert, auto-escalate, then auto-create incident with inherited recommendation payload.
- EDD-stage recommendation set is fixed to `APPROVE` / `REJECT`; `REQUIRE_EDD` MUST NOT appear in alert or incident detail after EDD evaluation.
- Incident recommendation rendering MUST follow primary alert latest recommendation first, with incident metadata snapshot as fallback only.

## Recent Core Decisions (2026-02-23)
- `GET /customers/:id` is a critical admin onboarding/compliance read-model endpoint and MUST remain stable for customer detail rendering.
- Customer detail projection queries MUST NOT include Prisma relations that are not defined in current schema (incident example: invalid `include.wallets` caused `500`).
- Customer-detail read path changes MUST include a regression check that validates relation include legality and endpoint availability (`200` with onboarding snapshot fields).

## Recent Core Decisions (2026-02-22 Verification Integration)
- Client `/verification` page uses `main` branch visual baseline (`INTRO` / `GUIDE` / `FLOW`) and keeps intro/guide interaction unchanged.
- Client runtime contract stays `publicStatus + actions[]`; any legacy `step/action` view model is projection-only in frontend and MUST NOT change backend API contract.
- CDD mock completion is dialog-driven with three options (`LOW_RISK`, `MEDIUM_HIGH_MIX`, `SANCTION_AND_OTHER`) and maps to backend `mockDataType` payload.
- EDD mock completion stays non-dialog and posts `{ result: 'PASS' }`; EDD session link creation is manual (`Start EDD`) instead of auto-start side effects.
- `publicStatus === ACTIVE` MUST auto-redirect customer from `/verification` to `/profile`.
- Session id handling in client MUST support both `latestSession.sessionId` and legacy `latestSession.id` for mock-complete compatibility.

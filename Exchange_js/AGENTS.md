# AGENTS (Exchange_js)

## Mandatory Read First
Before any code change in `Exchange_js`, read:
1. `docs/README.md`
2. `docs/constraints/README.md`
3. `docs/constraints/frontend-platform-constraints.md`
4. `docs/constraints/frontend-admin-ui-constraints.md`
5. `docs/constraints/frontend-client-ui-constraints.md`
6. `docs/constraints/backend-architecture-constraints.md`
7. `docs/constraints/runtime-config-constraints.md`
8. `docs/constraints/onboarding-flow-constraints.md`
9. `docs/constraints/customer-transaction-flow-constraints.md`
10. `docs/constraints/internal-transaction-flow-constraints.md`
11. `docs/constraints/audit-logging-constraints.md`
12. `docs/constraints/rbac-member-management-constraints.md`
13. `docs/constraints/governance-approval-constraints.md`
14. `docs/constraints/governance-change-ticket-constraints.md`
15. `docs/constraints/governance-delete-request-constraints.md`
16. `docs/constraints/governance-sla-timer-constraints.md`
17. `docs/constraints/audit-trace-context-constraints.md`
18. `docs/specs/wave3-layer2-risk-assessment.md`
19. `docs/specs/wave3-layer3-material-refresh.md`
20. `docs/specs/wave3-onboarding-integration.md`

> **Note (2026-04-11):** Wave 2 compliance specs (compliance-center, risk-engine, alert/case entities)
> and old periodic-review specs have been archived to `docs/archived/`. See `docs/archived/` for
> deprecated documents with replacement references.

> **Wave 2 Cleanup (2026-04-11):** All Wave 2 compliance alert/incident code has been removed from the codebase.
> - `compliance-alerts/` and `compliance-incidents/` directories deleted; Prisma tables dropped
> - `audit-logging/` is now a standalone `@Global()` module (was `risk-engine/audit-logs/`)
> - `sumsub-ingestion/SumsubIngestionService` is the single canonical Sumsub webhook handler with 5-clue routing; `sumsub-integration/` deleted
> - `RiskDecisionOrchestratorService` deleted
> - Transaction compliance (KYT/Travel Rule) remains in `risk-engine/transaction-compliance/` but compliance alert/incident emission removed; will reconnect via Sumsub webhook in future Wave 5/7

## Scope
- Backend: `src/**`, `prisma/**`, `scripts/**`
- Frontend: `admin-web/**`, `client-web/**`

## Planning Reference
- For roadmap, milestone, wave-planning, or scope-sequencing requests, also read:
  - `docs/roadmap/project-version-plan.md`
  - `docs/roadmap/wave-5-payin-deposit-phase-plan.md`
  - `docs/cleanup/wave-5-cleanup-master-plan.md`
  - `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`
  - `docs/roadmap/wave1-foundation-migration-from-exchange-java.md`
- This planning reference does not override `docs/constraints/**`; constraints remain the behavioral source of truth.
- `docs/roadmap/project-version-plan.md` is the current planning reference for wave scope and sequencing.
- `docs/roadmap/wave-5-payin-deposit-phase-plan.md` is the current detailed planning reference for Wave 5 payin/deposit workflow closure, tx compliance bridge, transaction risk/case sequencing, and evidence-chain delivery scope.
- `docs/cleanup/wave-5-cleanup-master-plan.md` is the current cleanup / closeout reference for Wave 5 resolved truth-hardening milestones and the remaining delivery hygiene backlog.
- `Wave 5` runtime truth is no longer roadmap-only; use the runtime baseline below for durable semantics.
- `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md` is the current planning reference for Wave 4 ledger, wallet/account, pricing, and config-release sequencing.
- `docs/roadmap/wave1-foundation-migration-from-exchange-java.md` is a historical migration-reference document and MUST NOT be treated as the current implementation truth.
- `doc-final/` is the Wave 1 finalized truth; `docs/` remains the working document tree for active development.

### Wave 5 Runtime Baseline
- When work touches `PayIn -> Deposit`, transaction compliance, transaction risk/case callback, deposit accounting, or deposit evidence export, also read:
1. `docs/constraints/customer-transaction-flow-constraints.md`
2. `docs/constraints/internal-transaction-flow-constraints.md`
3. `docs/specs/workflows/payin-deposit-canonical-workflow.md`
4. `docs/specs/entities/inbound-transfer-signal-entity.md`
5. `docs/specs/entities/payin-entity.md`
6. `docs/specs/entities/deposit-transaction-entity.md`
7. ~~`docs/specs/entities/risk-decision-record-entity.md`~~ — archived (Wave 2 → Sumsub)
8. `docs/specs/entities/audit-evidence-package-entity.md`
9. ~~`docs/specs/modules/risk-engine-module.md`~~ — archived (Wave 2 → Sumsub)
10. ~~`docs/specs/modules/compliance-center-module.md`~~ — archived (Wave 2 → Sumsub)
11. `docs/specs/modules/accounting-ledger-module.md`
12. `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
13. `docs/acceptance/wave-5-deposit-accounting-blocked-runbook.md`
14. `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`
- `docs/roadmap/wave-5-payin-deposit-phase-plan.md` remains historical phase planning context.
- `docs/cleanup/wave-5-cleanup-master-plan.md` remains closeout / delivery hygiene context.

## Wave 1 Finalized Documentation

> `doc-final/` is the authoritative finalized documentation tree. It is separate from `docs/` (which contains working/in-progress docs). Always prefer `doc-final/` over `docs/` for Wave 1 truth.

### Wave 1 PRD (Developer Reference)
- `doc-final/PRD/wave1/wave1-data-model.md` — All Wave 1 tables, field definitions, seed data (8 roles, 8 admin accounts, approval policies, SoD rules)
- `doc-final/PRD/wave1/wave1-workflows.md` — 6 governed workflow specifications: state machines, actors, SoD rules, APIs, audit event sequences
- `doc-final/PRD/wave1/wave1-audit-integration.md` — How to call AuditLogsService; Wave 1 audit event dictionary; future wave onboarding rules

### Wave 1 Acceptance Tests (QA Reference)
- `doc-final/acceptance/wave1-acceptance-tests.md` — Step-by-step acceptance tests for all 6 Wave 1 flows + 4 negative cases

### Global Reference (All Waves)
- `doc-final/glossary/global-glossary.md` — Canonical terminology definitions; grows with each wave

### Wave 1 Role Catalog (Final)
8 roles in production: SUPER_ADMIN, SENIOR_MANAGEMENT_OFFICER, CISO, MLRO, DPO, COMPLIANCE_OFFICER, TECH_OFFICER, OPS_OFFICER
- VARA Responsible Individual candidates: CISO + SENIOR_MANAGEMENT_OFFICER (minimum 2 required by VARA Company Rulebook I.C.1)
- All role codes use `_OFFICER` suffix convention (except VARA-mandated acronyms: MLRO, DPO, CISO)

## Documentation Governance
- Documentation rules are mandatory for every future thread in `Exchange_js`.
- Read order for project documentation governance:
1. `AGENTS.md`
2. `docs/README.md`
3. `docs/constraints/README.md`
4. then the task-relevant files under `docs/constraints/**`, `docs/specs/**`, `docs/roadmap/**`, `docs/cleanup/**`, `docs/adr/**`, `docs/acceptance/**`

### Documentation Layers
- Project documentation is split into these layers:
1. `docs/roadmap/`: project / wave / phase planning
2. `docs/cleanup/`: legacy cleanup, compatibility removal, staged convergence plans
3. `docs/constraints/`: non-negotiable rules and hard boundaries
4. `docs/specs/`: workflow, entity, field, and read-model semantics
5. `docs/adr/`: architecture and product decision records
6. `docs/acceptance/`: runbooks, demo flows, validation checklists
7. `docs/glossary/`: shared terminology and naming definitions
8. `docs/archived/`: deprecated documents removed from active tree (2026-04-11+)

### Wave 4 Design Baseline
- When work touches Wave 4 ledger / wallet / pricing / config-release behavior, also read:
1. `docs/constraints/wallet-account-model-constraints.md`
2. `docs/constraints/business-base-config-release-constraints.md`
3. `docs/constraints/posting-clearing-balance-projection-constraints.md`
4. `docs/constraints/pricing-and-quote-constraints.md`
5. `docs/specs/workflows/config-release-activation-workflow.md`
6. `docs/specs/workflows/quote-event-clearing-journal-workflow.md`

### Source Of Truth Order
- If documents conflict, use this precedence:
1. `docs/constraints/**`
2. `docs/specs/**`
3. `docs/adr/**`
4. `docs/acceptance/**`
5. `docs/roadmap/**`
6. `docs/cleanup/**`
- `roadmap` and `phase plan` documents define scope and sequencing only. They MUST NOT silently override active constraints or active specs.
- Historical migration or phase documents MUST be explicitly marked when they are no longer current implementation truth.

### Thread Completion Rule
- Every completed thread MUST perform a documentation impact check before close-out.
- If the thread changes behavior, constraints, scope boundary, cleanup stage, field meaning, workflow meaning, API contract, runtime/migration semantics, or deprecation status, the relevant docs MUST be updated in the same thread.
- If the thread does not require doc changes, the final response MUST explicitly say why documentation was not updated.
- Final response MUST contain one of:
1. `Documentation updated: ...`
2. `Documentation update not needed: ...`

### Mandatory Documentation Update Triggers
- Update docs when the thread does any of the following:
1. add / remove / rename a workflow
2. add / remove canonical fields
3. convert a field between canonical and mirror / compatibility status
4. change constraints or invariants
5. change page, API, DTO, or read-model contract semantics
6. move cleanup to a new stage or remove a legacy alias
7. change runtime, database, migration, or local stack operation semantics
8. change approval, audit, compliance, or onboarding stage meaning

### Usually No Documentation Update Needed
- Documentation updates are usually not required for:
1. pure styling changes
2. wording-only UI changes without semantic change
3. test-only additions
4. internal refactors that do not change behavior or contracts
- If skipped, the final response still MUST explain why.

### Non-Negotiable Documentation Rules
- Do not leave behavior changes undocumented when an active constraints/spec/cleanup/roadmap file has become stale because of the thread.
- Do not treat temporary compatibility aliases as permanent product truth.
- Do not let `README`, `constraints`, `spec`, and `cleanup` documents disagree without explicitly stating which one supersedes the others.
- Do not add a new workflow, field, or status without deciding which doc layer owns its long-term definition.
- Prefer updating the smallest correct source-of-truth document instead of scattering the same rule across many files.

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
- Governance/runtime runbook: `docs/acceptance/local-main-runtime-runbook.md`

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
- Base seed MUST preserve one fixed admin account per active RBAC role (10 total role seed accounts) and keep deterministic role binding on every base sync.
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

## Recent Core Decisions (2026-02-22)
- CDD mock `LOW_RISK` is auto-pass: customer moves directly to `ACTIVE`. No compliance alert or incident is created.
- CDD mock `MEDIUM_RISK` / `HIGH_RISK_OR_PEP` update the customer's risk tier only; no alert or incident is created.
- CDD mock `SANCTION_AND_OTHER` triggers a Layer 2 assessment via Sumsub; no auto-escalation to incident.
- EDD-stage recommendation set is fixed to `APPROVE` / `REJECT`; `REQUIRE_EDD` MUST NOT appear after EDD evaluation.

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

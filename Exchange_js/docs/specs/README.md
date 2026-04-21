# Specs Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/constraints/README.md`
Source of Truth Level: specs

## Purpose
- Use specs for durable system meaning:
1. entity semantics
2. workflow semantics
3. state and field definitions
4. read/write ownership boundaries

## Backend Domain Package Rule
- Backend specs should be read as `纵向业务域包`.
- A domain package combines:
1. relevant `constraints`
2. relevant `entities`
3. relevant `workflows`
4. relevant `modules`
- Completed wave documents may point into these packages, but they do not replace them as long-term truth.

## Subfolders
- `entities/`: field-level and model-level semantics
- `workflows/`: actor/state/transition semantics
- `modules/`: bounded module behavior and subsystem design notes

## Archived Specs (2026-04-11)
> Wave 2 compliance, old periodic review, and Wave 1 audit trace specs have been moved to `docs/archived/`.
> Current replacements: `wave3-layer2-risk-assessment.md`, `wave3-layer3-material-refresh.md`, `wave3-onboarding-integration.md`, `docs/constraints/audit-trace-context-constraints.md`.

## Domain Packages
- `Identity & Access`
  - `admin-user-entity`, `role-entity`, `permission-entity`
  - `admin-member-auth-boundary-workflow`
  - `rbac-member-management-module`
- `Customer Lifecycle`
  - `customer-entity`, `review-response-entity`, ~~`periodic-review-cycle-entity`~~ (archived)
  - `onboarding-canonical-workflow`, ~~`periodic-review-canonical-workflow`~~ (archived)
  - `customer-onboarding-module`, ~~`periodic-review-module`~~ (archived)
- `Risk & Compliance` — **archived to Sumsub (2026-04-11)**
  - ~~`compliance-alert-entity`, `compliance-case-entity`, `compliance-case-report-entity`, `compliance-external-filing-entity`~~
  - ~~`alert-triage-and-case-escalation`, `case-final-lifecycle-and-external-filing`~~
  - `mlro-and-final-approval-governance` (partially outdated, still in place)
  - ~~`compliance-center-module`, `risk-engine-module`~~
- `Governance Control Gates`
  - ~~`approval-case-entity`~~ (archived), `change-ticket-entity`, `delete-request-entity`, `governance-sla-timer-entity`
  - `audit-evidence-export-approval-workflow`, `change-ticket-release-gate-workflow`, `delete-request-soft-delete-workflow`, `governance-sla-timer-workflow`
  - `governance-control-foundation-module`, `approvals-module`
- `Audit & Evidence`
  - ~~`audit-log-event-entity`~~ (archived), `audit-evidence-package-entity`
  - `onboarding-periodic-review-audit-trace-contract`
  - `audit-logging-module`, ~~`audit-logging-product-doc`, `audit-logging-technical-doc`~~ (archived)
- `Asset & Treasury Foundation`
  - `asset-entity`, `wallet-entity`, `liquidity-provider-entity`, `inbound-transfer-signal-entity`, `payin-entity`, `internal-transaction-entity`, `internal-fund-entity`
  - `asset-treasury-foundation-module`
- `Pricing & Config Release`
  - `pricing-policy-entity`, `pricing-quote-entity`, `business-config-release-entity`
  - `config-release-activation-workflow`
  - `pricing-center-module`
- `Customer Transactions`
  - `deposit-transaction-entity`, `swap-transaction-entity`, `withdraw-transaction-entity`, `payout-entity`
  - `payin-deposit-canonical-workflow`, `swap-canonical-workflow`, `withdraw-payout-canonical-workflow`
- `Accounting Ledger`
  - `coa-entity`, `acct-event-entity`, `journal-entity`
  - `quote-event-clearing-journal-workflow`
  - `accounting-ledger-module`
- `Clearing & Reconciliation`
  - `outstanding-entity`, `outstanding-settlement-entity`, `clearing-entity`, `reconciliation-break-entity`
  - `safeguarding-reconciliation-workflow`

## Wave 3 Specs (Active)
- `docs/specs/wave3-layer2-risk-assessment.md`
- `docs/specs/wave3-layer3-material-refresh.md`
- `docs/specs/wave3-onboarding-integration.md`

## Current Key Specs
- Workflow specs (active):
  - `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
  - `docs/specs/workflows/change-ticket-release-gate-workflow.md`
  - `docs/specs/workflows/delete-request-soft-delete-workflow.md`
  - `docs/specs/workflows/governance-sla-timer-workflow.md`
  - `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/payin-deposit-canonical-workflow.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - `docs/specs/workflows/config-release-activation-workflow.md`
  - `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
  - `docs/specs/workflows/swap-canonical-workflow.md`
  - `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
  - `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
- Entity specs (active):
  - `docs/specs/entities/audit-evidence-package-entity.md`
  - `docs/specs/entities/change-ticket-entity.md`
  - `docs/specs/entities/delete-request-entity.md`
  - `docs/specs/entities/governance-sla-timer-entity.md`
  - `docs/specs/entities/admin-user-entity.md`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/inbound-transfer-signal-entity.md`
  - `docs/specs/entities/payin-entity.md`
  - `docs/specs/entities/deposit-transaction-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/wallet-entity.md`
  - `docs/specs/entities/business-config-release-entity.md`
  - `docs/specs/entities/pricing-quote-entity.md`
  - `docs/specs/entities/swap-transaction-entity.md`
  - `docs/specs/entities/withdraw-transaction-entity.md`
  - `docs/specs/entities/payout-entity.md`
  - `docs/specs/entities/reconciliation-break-entity.md`
- Module specs (active):
  - `docs/specs/modules/governance-control-foundation-module.md`
  - `docs/specs/modules/rbac-member-management-module.md`
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/approvals-module.md`
  - `docs/specs/modules/audit-logging-module.md`
  - `docs/specs/modules/accounting-ledger-module.md`
  - `docs/specs/modules/pricing-center-module.md`
  - `docs/specs/modules/asset-treasury-foundation-module.md`

## Practical Reading Rule
- Use `workflows` to understand how things move.
- Use `entities` to understand what each durable object means.
- Use `modules` to understand which entrypoints are canonical, which historical names still exist, and which surfaces new work MUST or MUST NOT call.
- For backend work, prefer reading by domain package rather than by folder alone.

## Update When
- A workflow meaning changes.
- A field meaning changes.
- A canonical source-of-truth model changes.
- Case final lifecycle or external filing semantics change.
- Workflow-bound audit trace or Audit Center replay semantics change.
- Wave 4 ledger, wallet/account, pricing/quote, or config-release semantics change.

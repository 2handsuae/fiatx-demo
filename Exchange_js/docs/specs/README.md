# Specs Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
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

## Subfolders
- `entities/`: field-level and model-level semantics
- `workflows/`: actor/state/transition semantics
- `modules/`: bounded module behavior and subsystem design notes

## Current Key Specs
- Workflow specs:
  - `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
  - `docs/specs/workflows/change-ticket-release-gate-workflow.md`
  - `docs/specs/workflows/delete-request-soft-delete-workflow.md`
  - `docs/specs/workflows/governance-sla-timer-workflow.md`
  - `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - `docs/specs/workflows/payin-deposit-canonical-workflow.md`
  - `docs/specs/workflows/alert-triage-and-case-escalation.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - `docs/specs/workflows/config-release-activation-workflow.md`
  - `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
- Entity specs:
  - `docs/specs/entities/audit-evidence-package-entity.md`
  - `docs/specs/entities/change-ticket-entity.md`
  - `docs/specs/entities/delete-request-entity.md`
  - `docs/specs/entities/governance-sla-timer-entity.md`
  - `docs/specs/entities/admin-user-entity.md`
  - `docs/specs/entities/compliance-alert-entity.md`
  - `docs/specs/entities/compliance-case-entity.md`
  - `docs/specs/entities/compliance-case-report-entity.md`
  - `docs/specs/entities/compliance-external-filing-entity.md`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/inbound-transfer-signal-entity.md`
  - `docs/specs/entities/payin-entity.md`
  - `docs/specs/entities/deposit-transaction-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/periodic-review-cycle-entity.md`
  - `docs/specs/entities/approval-case-entity.md`
  - `docs/specs/entities/risk-decision-record-entity.md`
  - `docs/specs/entities/wallet-entity.md`
  - `docs/specs/entities/business-config-release-entity.md`
  - `docs/specs/entities/pricing-quote-entity.md`
- Module specs:
  - `docs/specs/modules/governance-control-foundation-module.md`
  - `docs/specs/modules/rbac-member-management-module.md`
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/specs/modules/risk-engine-module.md`
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/periodic-review-module.md`
  - `docs/specs/modules/approvals-module.md`
  - `docs/specs/modules/audit-logging-module.md`
  - `docs/specs/modules/accounting-ledger-module.md`
  - `docs/specs/modules/pricing-center-module.md`
  - `docs/specs/modules/asset-treasury-foundation-module.md`

## Practical Reading Rule
- Use `workflows` to understand how things move.
- Use `entities` to understand what each durable object means.
- Use `modules` to understand which entrypoints are canonical, which historical names still exist, and which surfaces new work MUST or MUST NOT call.

## Update When
- A workflow meaning changes.
- A field meaning changes.
- A canonical source-of-truth model changes.
- Case final lifecycle or external filing semantics change.
- Workflow-bound audit trace or Audit Center replay semantics change.
- Wave 4 ledger, wallet/account, pricing/quote, or config-release semantics change.

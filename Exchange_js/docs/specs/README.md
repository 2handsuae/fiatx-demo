# Specs Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - `docs/specs/workflows/alert-triage-and-case-escalation.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- Entity specs:
  - `docs/specs/entities/compliance-alert-entity.md`
  - `docs/specs/entities/compliance-case-entity.md`
  - `docs/specs/entities/compliance-case-report-entity.md`
  - `docs/specs/entities/compliance-external-filing-entity.md`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/periodic-review-cycle-entity.md`
  - `docs/specs/entities/approval-case-entity.md`
  - `docs/specs/entities/risk-decision-record-entity.md`
- Module specs:
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/specs/modules/risk-engine-module.md`
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/periodic-review-module.md`
  - `docs/specs/modules/approvals-module.md`
  - `docs/specs/modules/audit-logging-module.md`

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

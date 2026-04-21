> **PARTIALLY OUTDATED** — Some sections of this document no longer match the current code.
> Last verified: 2026-04-11. See notes below for specific outdated sections.
>
> Updated specs: `docs/specs/wave3-layer2-risk-assessment.md`, `docs/specs/wave3-layer3-material-refresh.md`, `docs/specs/wave3-onboarding-integration.md`
>
> **Note:** Periodic review usage superseded by Layer 2/3

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
Source of Truth Level: specs-entity

# Review Response Entity

## Purpose
- This document defines the canonical semantics for onboarding / periodic review response containers:
  - `CDD Response`
  - `EDD Response`

## Related Canonical Docs
- `docs/specs/entities/risk-decision-record-entity.md`
- `docs/specs/entities/compliance-alert-entity.md`
- `docs/specs/entities/compliance-case-entity.md`
- `docs/specs/workflows/onboarding-canonical-workflow.md`
- `docs/specs/workflows/periodic-review-canonical-workflow.md`
- `docs/specs/modules/customer-onboarding-module.md`
- `docs/specs/modules/periodic-review-module.md`
- `docs/specs/modules/risk-engine-module.md`

## Entity Role
- A `Response` is a provider response and evidence container.
- It is not a compliance case.
- It owns:
  - response identity
  - provider payload snapshot
  - session lifecycle
  - linkage to workflow root and customer

## Canonical Identity
- Canonical response contract uses:
  - `responseNo`
  - `responseType`
- Canonical response lifecycle uses:
  - `CREATED`
  - `COMPLETED`

## Binding Rules
- Response binds to workflow root, customer, and evidence payload.
- Workflow-bound alert/case may be created from response risk evaluation, but response itself remains the evidence container.

## Trace Rule
- Response events stay on the same workflow trace used by downstream alert / case / approval / filing.

## Retired Compatibility Layer
- `caseNo / caseType -> responseNo / responseType` is retired from active runtime contract.
- Case-named response aliases are historical only and must not reappear in active API payloads or UI contracts.

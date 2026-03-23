# Entity Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/README.md`
Source of Truth Level: specs-entity

## Purpose
- One document per durable entity or read model.
- Explain field meaning, ownership, lifecycle anchors, and canonical vs mirror distinctions.

## Recommended Topics
- purpose
- field semantics
- canonical fields
- mirror / compatibility fields
- write owners
- read-model outputs

## Current Entity Specs
- `docs/specs/entities/audit-evidence-package-entity.md`
  - Audit Center evidence package semantics and approval-backed export boundary.
- `docs/specs/entities/change-ticket-entity.md`
  - Wave 1 release-control ticket semantics and gate linkage.
- `docs/specs/entities/delete-request-entity.md`
  - Wave 1 governed soft-delete request semantics.
- `docs/specs/entities/governance-sla-timer-entity.md`
  - Governance SLA timer and notification registry semantics.
- `docs/specs/entities/admin-user-entity.md`
  - Admin user identity, activation, role-truth, and governed deletion semantics.
- `docs/specs/entities/compliance-alert-entity.md`
  - Alert triage entity semantics and assignment boundary.
- `docs/specs/entities/compliance-case-entity.md`
  - Canonical case identity, proposal/disposition boundary, and filing projection boundary.
- `docs/specs/entities/compliance-case-report-entity.md`
  - Investigation report as its own entity, not a loose set of case fields.
- `docs/specs/entities/compliance-external-filing-entity.md`
  - External filing as an independent follow-up entity, not `reportStatus` semantics.
- `docs/specs/entities/customer-entity.md`
  - Canonical customer lifecycle and eligibility fields.
- `docs/specs/entities/review-response-entity.md`
  - Canonical CDD / EDD response identity and evidence-container semantics.
- `docs/specs/entities/periodic-review-cycle-entity.md`
  - Periodic review cycle as its own workflow root.
- `docs/specs/entities/approval-case-entity.md`
  - Approval case as governance object with workflow-bound trace fields.
- `docs/specs/entities/risk-decision-record-entity.md`
  - Risk decision record as orchestration/audit/recommendation root record.
- `docs/specs/entities/wallet-entity.md`
  - Wave 4 wallet/account carrier semantics and balance-boundary rules.
- `docs/specs/entities/business-config-release-entity.md`
  - Wave 4 subject release, item revision, and release-item history semantics.
- `docs/specs/entities/pricing-quote-entity.md`
  - Wave 4 pricing quote snapshot semantics for swap and withdraw consumers.

# Entity Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
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

## Archived Entities (2026-04-11)
The following entity specs have been moved to `docs/archived/`:
- `compliance-alert-entity.md`, `compliance-case-entity.md`, `compliance-case-report-entity.md`, `compliance-external-filing-entity.md`, `risk-decision-record-entity.md` — Wave 2 → Sumsub
- `periodic-review-cycle-entity.md` — replaced by `wave3-layer2-risk-assessment.md` / `wave3-layer3-material-refresh.md`
- `approval-case-entity.md`, `audit-log-event-entity.md` — replaced by `docs/constraints/audit-trace-context-constraints.md`

## Current Entity Specs
- `Identity & Access`
  - `docs/specs/entities/admin-user-entity.md`
  - `docs/specs/entities/role-entity.md`
  - `docs/specs/entities/permission-entity.md`
- `Customer Lifecycle`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/review-response-entity.md`
- `Governance Control Gates`
  - `docs/specs/entities/change-ticket-entity.md`
  - `docs/specs/entities/delete-request-entity.md`
  - `docs/specs/entities/governance-sla-timer-entity.md`
- `Audit & Evidence`
  - `docs/specs/entities/audit-evidence-package-entity.md`
- `Asset & Treasury Foundation`
  - `docs/specs/entities/asset-entity.md`
  - `docs/specs/entities/wallet-entity.md`
  - `docs/specs/entities/liquidity-provider-entity.md`
  - `docs/specs/entities/inbound-transfer-signal-entity.md`
  - `docs/specs/entities/payin-entity.md`
  - `docs/specs/entities/internal-transaction-entity.md`
  - `docs/specs/entities/internal-fund-entity.md`
- `Pricing & Config Release`
  - `docs/specs/entities/pricing-policy-entity.md`
  - `docs/specs/entities/pricing-quote-entity.md`
  - `docs/specs/entities/business-config-release-entity.md`
- `Customer Transactions`
  - `docs/specs/entities/deposit-transaction-entity.md`
  - `docs/specs/entities/swap-transaction-entity.md`
  - `docs/specs/entities/withdraw-transaction-entity.md`
  - `docs/specs/entities/payout-entity.md`
- `Accounting Ledger`
  - `docs/specs/entities/coa-entity.md`
  - `docs/specs/entities/acct-event-entity.md`
  - `docs/specs/entities/journal-entity.md`
- `Clearing & Reconciliation`
  - `docs/specs/entities/outstanding-entity.md`
  - `docs/specs/entities/outstanding-settlement-entity.md`
  - `docs/specs/entities/clearing-entity.md`
  - `docs/specs/entities/reconciliation-break-entity.md`

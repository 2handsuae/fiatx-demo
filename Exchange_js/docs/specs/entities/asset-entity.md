Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/wallet-account-model-constraints.md`, `docs/specs/modules/asset-treasury-foundation-module.md`
Source of Truth Level: specs-entity

# Asset Entity

## Purpose
- This document defines `Asset` as the master-data identity for tradable, priced, or custody-bound assets.

## Canonical Fields
- `id`
- `assetNo`
- `type`
- `code`
- `network`
- `decimals`
- `description`
- `status`

## Canonical Meaning
- `Asset` is the durable asset master root used by wallets, pricing, transactions, ledger, and clearing.
- `assetNo` is the operator-facing stable identifier when present.
- `type + code + network` define the canonical uniqueness boundary.
- `Asset` is master data, not part of the first subject-release governed config batch.

## Write Owners
- Asset-treasury foundation owns asset identity and status truth.
- Downstream modules consume asset facts but do not redefine asset semantics.

## Relationship Rules
- `Asset` binds:
  - wallet carrier identity
  - pricing snapshots
  - transaction settlement units
  - journal and clearing outputs
- Asset valuation and wallet balance projection remain downstream consumers, not replacements for asset master truth.

## Historical / Retired Notes
- Asset governance through release-governed config is explicitly out of scope for the current Wave 4 baseline.

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/entities/business-config-release-entity.md`, `docs/specs/entities/wallet-entity.md`
Source of Truth Level: specs-module

# Accounting Ledger Module

## Purpose
- This document defines the Wave 4 current module semantics for the shared ledger foundation.
- It covers:
  - `COA`
  - `AcctEvent`
  - `JournalTemplate`
  - `Journal`
  - wallet balance projection

## Positioning
- This is a Wave 4 runtime module spec for the delivered ledger foundation slice.
- It records current implemented behavior plus explicit boundaries that remain outside delivered scope.

## Bounded Context
- `COA` defines accounting line destination semantics.
- `AcctEvent` defines business-time posting/clearing trigger semantics.
- `JournalTemplate` defines how journals are rendered for a given event.
- `Journal` is the durable accounting book output.
- `WalletBalanceSnapshot` and `WalletBalanceEntry` are the auditable balance projection outputs.

## Current Implementation Anchors
- `GET /coa`
- `GET /acct-events`
- `GET /journal-header-templates`
- `GET /journal-line-templates`
- `GET /journals`
- `withdraw quote -> withdrawal -> approved event -> clearing + journal`
- `payin.confirmed -> EVT_DEPOSIT_CONFIRMED__CRYPTO|FIAT -> journal`
- `deposit.success -> EVT_DEPOSIT_SUCCESS__CRYPTO|FIAT -> journal`
- balance reads backed by `WalletBalanceSnapshot / WalletBalanceEntry`

## Canonical Responsibilities
- Resolve posting configuration for business events.
- Generate journals from event-bound template bundles.
- Enforce journal balance validation.
- Support reversal and replay-safe posting behavior.
- Project wallet balance snapshots and entries from journal lines.

## Upstream / Downstream Dependencies
- Upstream:
  - transaction workflows
  - internal treasury workflows
  - priced transaction business context
- Downstream:
  - wallet balance read models
  - audit logging
  - reconciliation / outstanding / settlement consumers

## Historical / Transitional Notes
- Release-governed config history is now the current accounting configuration control model.
- Compatibility-era fake-write route and `/acct-events/sync-defaults` have been physically deleted.
- `Withdraw` remains a broad unified event-execution slice.
- `Wave 5` adds required deposit accounting points for:
  - `payin.confirmed`
  - `deposit.success`
- Deposit reject remains a compliance disposition result in current truth; it does not introduce a dedicated deposit reject posting or reversal contract.
- Swap remains outside the current shared event-execution closeout described by this document.

## MUST / MUST NOT
- MUST treat `AcctEvent` as the durable trigger contract for journal behavior.
- MUST project wallet balances from journal lines rather than directly from business services.
- MUST NOT bypass journal balance validation.
- MUST NOT treat clearing records as the accounting book of record.
- Required deposit accounting points MUST NOT silent-skip on missing event/template or failed posting.
- `DEPOSIT_ACCOUNTING_BLOCKED` is the canonical audit signal when a required deposit accounting point cannot complete.

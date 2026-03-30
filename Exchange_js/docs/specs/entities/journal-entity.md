Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/modules/accounting-ledger-module.md`
Source of Truth Level: specs-entity

# Journal Entity

## Purpose
- This document defines `Journal` as the durable accounting book output.

## Canonical Fields
- Identity:
  - `id`
  - `journalNo`
- Source linkage:
  - `sourceType`
  - `sourceId`
  - `sourceNo`
  - `eventCode`
- Lifecycle:
  - `postingStatus`
  - `postedAt`
- Accounting context:
  - `baseAssetId`
  - `reversalOfJournalId`
  - `journalHeaderTemplateId`
  - `description`
  - `totalAmount`
  - `lines[]`

## Canonical Meaning
- `Journal` is the immutable accounting record produced by event-driven posting.
- `journalNo` is the operator-facing journal identifier.
- `JournalLine` is a subordinate accounting line object; it is not a first-class product subject.

## Write Owners
- Unified posting/journal execution owns journal creation and reversal behavior.
- Business services may trigger posting, but MUST NOT bypass journal validation or mint journals directly as shortcuts.

## Relationship Rules
- Wallet balance projection derives from journal lines.
- Clearing is a sibling operational output; it is not the accounting book of record.

## Historical / Retired Notes
- Journal correction must happen through replay-safe reversal or compensation, not by overwriting journal history.

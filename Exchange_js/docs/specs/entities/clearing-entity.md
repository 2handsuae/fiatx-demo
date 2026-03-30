Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
Source of Truth Level: specs-entity

# Clearing Entity

## Purpose
- This document defines `Clearing` as the durable operational settlement record emitted by event-driven clearing execution.

## Canonical Fields
- Identity:
  - `id`
  - `clearingNo`
- Source linkage:
  - `clearingType`
  - `sourceType`
  - `sourceId`
- Value movement:
  - `outAssetId`
  - `outAmount`
  - `inAssetId`
  - `inAmount`
  - `feeAssetId`
  - `feeAmount`
  - `feeMethod`
- Operational linkage:
  - `outPayoutId`
  - `inPayinId`
  - `clearingStatus`
  - `memo`
  - `lines[]`

## Canonical Meaning
- `Clearing` is the operational settlement/clearing output for an event-governed business source.
- `clearingNo` is the operator-facing clearing identifier.
- `ClearingLine` is a subordinate operational line object, not a first-class accounting subject.

## Write Owners
- Canonical event-driven clearing execution owns clearing creation and closeout status.
- Business workflows may trigger clearing through `AcctEvent`, but do not own clearing-template semantics directly.

## Relationship Rules
- Clearing consumes the same source context snapshot as journal execution when both are triggered by the same event.
- Clearing is not the accounting book of record.

## Historical / Retired Notes
- Clearing correction must happen through governed closeout or replay-safe event execution rather than ad-hoc direct mutation.

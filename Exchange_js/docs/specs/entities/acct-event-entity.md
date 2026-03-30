Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/modules/accounting-ledger-module.md`
Source of Truth Level: specs-entity

# Acct Event Entity

## Purpose
- This document defines `AcctEvent` as the durable business-time accounting and clearing trigger object.

## Canonical Fields
- `id`
- `eventCode`
- `entityType`
- `ownerScope`
- `assetType`
- `triggerType`
- `postingMode`
- `clearingMode`
- `postingReversalOfEventCode`
- `clearingReversalOfEventCode`
- `clearingTemplateCode`
- `fromStatus`
- `toStatus`
- `triggerKey`
- `isActive`
- `description`

## Canonical Meaning
- `AcctEvent` answers whether posting and/or clearing should occur for a given business milestone.
- `eventCode` is the canonical natural key.
- Reversal linkage belongs on the event catalog rather than being re-decided ad hoc by transaction services.

## Write Owners
- Ledger configuration governance owns event catalog truth.
- Business workflows trigger events through canonical execution entrypoints; they do not own event semantics.

## Relationship Rules
- `AcctEvent` binds configuration, not runtime result.
- Journal and clearing execution consume event context from a coherent source snapshot.

## Historical / Retired Notes
- Compatibility-era fake sync or ad-hoc default-write paths are retired from active runtime truth.

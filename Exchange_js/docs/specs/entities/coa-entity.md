Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/specs/modules/accounting-ledger-module.md`
Source of Truth Level: specs-entity

# COA Entity

## Purpose
- This document defines `Coa` as the durable chart-of-accounts catalog root.

## Canonical Fields
- `id`
- `code`
- `type`
- `name`
- `status`
- `requiredTags`

## Canonical Meaning
- `Coa` answers the destination/account semantics for journal lines.
- `code` is the canonical natural key.
- `requiredTags` defines required accounting dimensions or metadata expectations for valid posting use.

## Write Owners
- Ledger configuration governance owns COA catalog truth.
- Journal templates and journal lines consume COA definitions; they do not redefine them.

## Relationship Rules
- `Coa` is a config subject, not an execution output.
- Account selection and balance projection are downstream behaviors built on this catalog.

## Historical / Retired Notes
- COA evolution belongs to release-governed configuration history rather than ad-hoc runtime overwrites.

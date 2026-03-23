Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/posting-clearing-balance-projection-constraints.md`, `docs/constraints/pricing-and-quote-constraints.md`, `docs/specs/entities/pricing-quote-entity.md`
Source of Truth Level: specs-workflow

# Quote -> Event -> Clearing / Journal Workflow

## Purpose
- This document defines the Wave 4 current workflow that links pricing output, business transactions, accounting events, clearing, and journal posting.

## Actors
- `Price Center`
- `Business Transaction Service`
- `Accounting Engine`
- `Clearing Engine`

## Scope
- Applies to priced business flows:
  - `SWAP`
  - `WITHDRAWAL`
- Does not define full lifecycle state machines for deposit, swap, or withdraw.
- Current runtime implementation in `Phase 3` is limited to `WITHDRAWAL`.
- `SWAP` remains a documented Wave 4 target consumer, but it is not yet routed through the unified event execution entry.

## Canonical Flow
1. `Price Center` evaluates `PricingPolicy`
2. `Price Center` creates `Quote Snapshot`
3. business transaction consumes the quote snapshot
4. transaction reaches a business milestone
5. milestone triggers `AcctEvent`
6. the same event MAY trigger `ClearingTemplate`
7. the same event MAY trigger `JournalTemplate`
8. journal lines project wallet balance entries and snapshots

## Current Runtime Slice
- `Withdraw` is the first runtime slice that implements this workflow end-to-end.
- The current delivered path is:
1. create withdrawal pricing quote
2. create withdrawal with `quoteId`
3. approved milestone triggers unified event execution
4. the same event drives both `ClearingTemplate` and `JournalTemplate`
5. journal lines project wallet balance entries and snapshots
- Subsequent withdraw status events (`SUCCESS`, `FAILED`, `RETURNED`, `CANCELLED`, `REJECTED`) remain event-governed through the same execution entry.

## Non-Negotiable Semantics
- Quote locks commercial pricing conditions.
- `AcctEvent` is the accounting/clearing trigger root.
- Clearing and journal consume the same source context; they do not derive from each other.
- Wallet balance projection derives from journal lines only.
- For `Withdraw`, that source context comes from the persisted withdrawal row, not from clearing side effects.

## Failure Paths
- expired or already-used quote blocks transaction creation
- missing event/template blocks durable event output
- unbalanced journal blocks posting
- repeated event execution must resolve idempotently without duplicate durable outputs

## Non-Goals
- This workflow does not redefine transaction compliance evidence-container rules.
- This workflow does not define a full fee engine beyond the shared fee skeleton and quote output boundary.

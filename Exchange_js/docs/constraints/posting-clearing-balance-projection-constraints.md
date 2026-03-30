Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`, `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`, `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
Source of Truth Level: constraints

# Posting / Clearing / Balance Projection Constraints (`Wave 4` Runtime Baseline)

## 1) Purpose and Positioning
- This document defines the Wave 4 current contract for event-driven clearing, journal posting, reversal, and wallet balance projection.
- It freezes how `AcctEvent`, `ClearingTemplate`, `JournalTemplate`, and wallet balance projection relate in current Wave 4 runtime.
- Current runtime implementation scope is:
1. `WITHDRAW` / `WITHDRAWAL` first-slice unified event execution
2. `withdraw quote -> withdrawal -> approved event -> clearing + journal`
3. journal-projected wallet balance updates
- `Deposit`, `Swap`, and `InternalTx` are not yet required to use the same unified execution entry in current runtime.

## 2) Canonical Flow Contract
- The canonical Wave 4 orchestration MUST be:
1. business transaction or business source exists
2. priced flows MAY bind a `quote snapshot` first
3. business milestone triggers `AcctEvent`
4. the same event MAY drive `ClearingTemplate`
5. the same event MAY drive `JournalTemplate`
6. wallet balance projection happens from journal lines only
- `Clearing` and `Journal` MUST consume the same source context when triggered by the same event.
- `Clearing` MUST NOT become the source of truth for journal creation.
- `Journal` MUST NOT become the source of truth for clearing creation.

## 3) AcctEvent Contract
- `AcctEvent` MUST remain the business-time trigger object for Wave 4 accounting semantics.
- `AcctEvent` is the canonical place to answer:
1. whether posting is required
2. whether clearing is required
3. which reversal event is linked
4. which template bundle is bound
- New Wave 4 design work MUST NOT let pricing policy or quote objects directly decide journal/clearing side effects.

## 4) Template Resolution Rules
- Missing event or missing referenced template MUST be treated as explicit failure.
- Template evaluation MUST resolve from a deterministic source context.
- The same event execution MUST use one coherent context snapshot for:
1. clearing field resolution
2. journal field resolution
3. downstream audit and replay
- For `Withdraw`, the coherent context snapshot MUST come from the already-persisted withdrawal row, including locked `quoteId`, `amount`, `feeAmount`, `netAmount`, and wallet bindings.
- Template evaluation failure MUST block durable output creation for that event execution.

## 5) Journal Contract
- Journal creation MUST enforce strong debit/credit balance validation.
- Source-level idempotency MUST remain mandatory for event-driven posting.
- Wallet-tracked asset lines MUST include wallet identity when the source path is wallet-bound.
- Asset-line `ownerType` MUST align with resolved wallet owner scope.
- Reversal behavior MUST remain event-governed and replay-safe.

## 6) Clearing Contract
- Clearing creation MUST be event-governed through `AcctEvent -> clearingTemplateCode`.
- Clearing templates MUST be evaluated from the same event source context used by journal creation.
- Clearing is the operational settlement/clearing record, not the accounting book of record.
- Clearing output MUST NOT be used as a substitute for journal balance validation.

## 7) Wallet Balance Projection Contract
- Wallet balance projection MUST derive from journal lines, not from clearing lines.
- Auditable balance structures MUST remain:
1. `WalletBalanceSnapshot`
2. `WalletBalanceEntry`
- Negative resulting wallet bucket balances MUST be blocked as explicit failure.
- Partial balance projection without matching journal durability is forbidden.

## 8) Failure And Transaction Boundary
- Template errors, journal imbalance, or insufficient balance projection MUST fail the event execution explicitly.
- Failure MUST NOT leave dirty partial balance projection behind.
- Multi-entity writes for event-driven posting MUST remain transaction-bound.
- For events that require both clearing and posting, a partial historical state (`only clearing` or `only journal`) MUST be treated as explicit failure and MUST NOT be auto-healed silently.

## 9) Idempotency Rules
- Repeated triggering of the same source event MUST NOT duplicate clearing, journal, or balance projection records.
- Reversal paths MUST remain source-aware and replay-safe.
- Bulk reversal-by-source remains the baseline for source-level terminal compensation paths where already defined.
- `reverseAllBySource` replay MUST skip journals that already have reversal journals and only create missing reversals.
- Repeated reversal replay MUST NOT create a second `WalletBalanceEntry` set for already-reversed journal lines.

## 10) Current Runtime Compatibility Note
- Current customer/internal transaction constraints already define concrete event ordering for delivered flows.
- Wave 4 work MUST extend those contracts without breaking:
1. existing event naming
2. existing idempotency requirements
3. existing reversal guarantees
- `Withdraw` runtime currently keeps durable source compatibility:
1. journal uses `sourceType=WITHDRAW`
2. clearing uses `sourceType=WITHDRAWAL`
3. clearing no longer mutates the withdraw row to backfill fee/net amounts
4. terminal compensation closes existing `WITHDRAWAL` clearings by status update; it does not mint a second clearing object

## 10A) Withdraw Phase 2 Compensation Contract
- `Withdraw SUCCESS` keeps the required order:
1. withdraw business status changes to `SUCCESS`
2. success posting executes on `sourceType=WITHDRAW`
3. payout closes to `CLEARED`
- `Withdraw FAILED / RETURNED` keeps the required order:
1. payout terminal result is already persisted
2. withdraw business status changes to target terminal state if needed
3. terminal reversal executes on `sourceType=WITHDRAW`
4. linked `WITHDRAWAL` clearings close to `CANCELLED`
- Canonical withdraw terminal no-orphan state requires:
1. no unreversed original journal remains on `sourceType=WITHDRAW, sourceId=<withdrawId>`
2. no linked `WITHDRAWAL` clearing remains non-`CANCELLED`
3. no wallet balance projection delta is introduced twice by replay

## 11) Forbidden Patterns
- MUST NOT let `Price Center` directly create clearing or journals.
- MUST NOT mutate wallet balances directly from transaction services when a journal-projected path exists.
- MUST NOT use clearing output as the journal balancing source.
- MUST NOT allow template evaluation failure to degrade into silent success.

## 12) Change Protocol
- Any change to this baseline MUST include:
1. impacted source types or event codes
2. journal/clearing/reversal impact
3. wallet balance projection impact
4. validation and replay impact

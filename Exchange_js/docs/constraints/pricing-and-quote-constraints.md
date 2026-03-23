Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`, `docs/constraints/customer-transaction-flow-constraints.md`, `docs/specs/entities/pricing-quote-entity.md`, `docs/specs/modules/pricing-center-module.md`
Source of Truth Level: constraints

# Pricing And Quote Constraints (`Wave 4` Runtime Baseline)

## 1) Purpose and Positioning
- This document defines the Wave 4 current constraints for `PricingPolicy`, `Price Center`, `quote snapshot`, and fee skeleton semantics.
- It freezes the pricing boundary already implemented for the delivered `swap + withdraw` quote slice.
- It does NOT claim that all downstream pricing-governance/operator UX gaps are closed.

## 2) Price Center Scope
- `Price Center` MUST be limited to:
1. pricing policy read/selection
2. simulation
3. rate lookup
4. fee calculation
5. quote snapshot generation
- `Price Center` MUST NOT own transaction state machine progression.
- `Price Center` MUST NOT own clearing or journal generation.

## 3) Supported Businesses
- Wave 4 pricing baseline MUST directly support:
1. `SWAP`
2. `WITHDRAWAL`
- `DEPOSIT` is explicitly outside the Wave 4 quote baseline.

## 4) Pricing Policy Contract
- `PricingPolicy` MUST remain the durable config root for pricing logic.
- Policy governance for Wave 4 MUST converge into the business base config release model.
- Policy overwrite without revision/release history is forbidden as the long-term Wave 4 target.

## 5) Quote Snapshot Contract
- Quote snapshot MUST freeze the business pricing result before transaction execution.
- At minimum, quote snapshot semantics MUST cover:
1. rate or fee result
2. fee breakdown
3. totals
4. `policyRef`
5. expiry / TTL
6. single-consume or terminal status transition
- A quote is an input snapshot for transaction creation, not an accounting book record.

## 6) Consumer Boundary
- `Swap` consumes quote snapshot as pricing input for order creation/execution.
- `Withdraw` consumes quote snapshot as pricing input for fee binding and transaction creation.
- After transaction creation, later accounting/clearing behavior MUST be event-driven, not quote-driven.

## 7) Fee Skeleton Contract
- Wave 4 MUST freeze one shared fee skeleton contract that can be reused by later business waves.
- The fee skeleton MUST at least stabilize:
1. fee item shape
2. fee calculation type
3. rounding metadata
4. fee breakdown output
5. totals output
- Wave 4 does NOT need to finish a full cross-domain fee engine.

## 8) Current Runtime Compatibility Note
- Admin pricing policy surfaces are read-only plus simulator in current runtime.
- Current runtime already converges `swap` and `withdraw` quote lifecycle ownership into `PricingCenterService`.
- Existing quote tables remain split as `SwapQuote` and `WithdrawPricingQuote`; Wave 4 runtime does NOT introduce a unified quote total table.
- Current runtime already applies:
1. `swap` quote create / consume / cancel through `Price Center`
2. `withdraw` quote create / consume / cancel through `Price Center`
3. admin unified read-only `Quote Center`
4. real TTL for new `withdraw` quotes
5. swap runtime no longer relies on `feeBreakdown -> totals/policyRef` fallback
- Current runtime consumes release-governed active pricing policy projections without redefining pricing as a transaction workflow engine.

## 9) Forbidden Patterns
- MUST NOT let pricing policy directly create clearing or journals.
- MUST NOT use quote as a substitute for `AcctEvent`.
- MUST NOT fold `DEPOSIT` into the first Wave 4 quote baseline.
- MUST NOT bypass pricing policy history once the release-governed model is implemented.

## 10) Change Protocol
- Any change to this baseline MUST include:
1. impacted business (`SWAP` or `WITHDRAWAL`)
2. quote payload or lifecycle impact
3. fee skeleton impact
4. downstream transaction/event impact

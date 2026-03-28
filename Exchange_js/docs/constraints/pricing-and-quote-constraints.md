Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
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
6. `swap` rate preview remains display-only and does NOT emit restriction audit or transaction side effects
- Current runtime consumes release-governed active pricing policy projections without redefining pricing as a transaction workflow engine.
- Wave 6 extends swap pricing with:
1. product restriction gate at quote create and quote consume
2. swap fee capability while allowing empty or zero-fee business config
3. quote snapshot fields for `grossAmountOut`, `netAmountOut`, and `feeCurrency`
4. best execution evidence export based on the frozen quote snapshot

## 8A) Swap Fee Capability Contract
- Swap fee configuration is supported by the pricing contract.
- Business config MAY leave swap fee arrays empty.
- Wave 6 V1 supports receive-asset fee deduction only.
- Quote snapshot MUST freeze both gross and net receive amounts when fee is present.

## 8B) Swap Product Restriction Contract
- Swap product restriction gate MUST run at:
1. quote create
2. quote consume before swap creation
- Product restriction `restrictionCode` is limited to pricing/product gates only:
1. `PAIR_DISABLED`
2. `TIER_DISABLED`
3. `CHANNEL_ONLINE_DISABLED`
4. `INVESTOR_CLASSIFICATION_BLOCKED`
- `customer trading gate` remains an onboarding eligibility gate and MUST NOT be folded into pricing `restrictionCode`.
- `swapConfig.channel.online` MUST be treated as a runtime gate, not metadata-only display state.
- Current single-tier `SWAP` runtime MUST preserve and honor:
1. `tier.enabled`
2. `tier.conditions.amountMin`
3. `tier.conditions.amountMax`
- Tier amount mismatch MAY still fail through the pricing match path instead of emitting `TIER_DISABLED`; `TIER_DISABLED` is reserved for explicitly disabled tier configuration.

## 8C) Withdrawal Runtime Restriction Contract
- Withdrawal pricing policy MAY carry runtime restrictions under `restrictions`.
- Phase 3 runtime restriction contract is limited to:
1. `extremeVolatilityBlocked`
2. `reason`
- `extremeVolatilityBlocked` MUST act as a shared runtime gate for:
1. withdraw quote create
2. withdraw create
3. payout dispatch start
- The restriction gate MUST emit canonical audit with action `WITHDRAW_EXTREME_VOLATILITY_BLOCKED`.
- The restriction gate MUST return machine-readable block payload with code `WITHDRAW_EXTREME_VOLATILITY_BLOCKED`.
- Admin withdrawal simulator remains read-only tooling and MUST NOT be blocked by this runtime restriction.
- Withdrawal runtime restriction MUST remain a pricing / operational gate only and MUST NOT directly mutate withdraw / payout terminal state.

## 9) Forbidden Patterns
- MUST NOT let pricing policy directly create clearing or journals.
- MUST NOT use quote as a substitute for `AcctEvent`.
- MUST NOT fold `DEPOSIT` into the first Wave 4 quote baseline.
- MUST NOT bypass pricing policy history once the release-governed model is implemented.
- MUST NOT hardcode swap tier defaults in a way that discards persisted `tier.enabled` or amount-range values at runtime.

## 10) Change Protocol
- Any change to this baseline MUST include:
1. impacted business (`SWAP` or `WITHDRAWAL`)
2. quote payload or lifecycle impact
3. fee skeleton impact
4. downstream transaction/event impact

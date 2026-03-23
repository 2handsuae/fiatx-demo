Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/pricing-and-quote-constraints.md`, `docs/specs/modules/pricing-center-module.md`
Source of Truth Level: specs-entity

# Pricing Quote Entity

## Purpose
- This document defines the Wave 4 current semantics for pricing quote snapshots.

## Positioning
- This is a Wave 4 runtime entity spec for the delivered quote snapshot model.
- It unifies the durable meaning shared by `SwapQuote` and `WithdrawPricingQuote`.
- Current runtime keeps them as two separate tables and does NOT introduce a global quote total table.

## Canonical Quote Objects
- `SwapQuote`
- `WithdrawPricingQuote`
- Shared conceptual layer: `Quote Snapshot`

## Canonical Fields
- `quoteNo`
- business discriminator at the API/read-model layer
- `status`
- `ownerType`
- `ownerId`
- asset binding fields
- pricing result fields
- `feeBreakdown`
- `totals`
- `policyRef`
- `expiresAt`
- `usedAt`
- `cancelledAt`

## Current Runtime Notes
- `SwapQuote` now persists `totalsJson` and `policyRef` as first-class snapshot fields in addition to `feeBreakdown`.
- Current swap runtime no longer derives `totals` or `policyRef` from legacy `feeBreakdown` fallback.
- `WithdrawPricingQuote` persists `totalsJson` and `policyRef`, and runtime now reads `expiresAt` directly as the durable TTL snapshot.

## Canonical Meaning
- A quote snapshot freezes the pricing result before transaction execution.
- `policyRef` answers which pricing policy context produced the quote.
- `feeBreakdown` and `totals` are commercial pricing outputs, not accounting entries.
- `expiresAt` defines quote validity.
- `usedAt` or terminal status answers whether the quote has already been consumed.

## Relationship To Transactions
- `SwapQuote` is consumed by swap transaction creation.
- `WithdrawPricingQuote` is consumed by withdraw transaction creation/binding.
- After a transaction exists, later accounting and clearing behavior is event-driven rather than quote-driven.

## Non-Negotiable Rules
- Quote snapshots MUST remain immutable after issuance except for lifecycle status changes such as use/cancel/expiry handling.
- Quote snapshots MUST NOT be treated as journals, clearings, or workflow approval objects.

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/pricing-and-quote-constraints.md`, `docs/specs/entities/pricing-quote-entity.md`
Source of Truth Level: specs-module

# Pricing Center Module

## Purpose
- This document defines the Wave 4 current module semantics for pricing, fee calculation, and quote snapshot generation.

## Positioning
- This is a Wave 4 runtime module spec for the delivered pricing slice.
- It describes the current pricing boundary and the implemented Phase 4 runtime slice.

## Bounded Context
- `PricingPolicy` is the durable pricing config root.
- `Price Center` calculates rates and fees.
- `Quote Snapshot` is the transaction-input pricing freeze point.
- Pricing output serves transactions; it does not replace transaction workflow logic.

## Current Implementation Anchors
- Admin policy and simulator surfaces:
  - `GET /admin/pricing/policies`
  - `GET /admin/pricing/policies/swap`
  - `GET /admin/pricing/policies/withdrawal`
  - `POST /admin/pricing/simulator/swap`
  - `POST /admin/pricing/simulator/withdrawal`
- Unified admin quote read surfaces:
  - `GET /admin/pricing/quotes`
  - `GET /admin/pricing/quotes/:business/:id`
- Withdraw quote creation surface:
  - `POST /withdraw-transactions/quotes`
- Withdraw quote cancel surface:
  - `POST /withdraw-transactions/quotes/:id/cancel`
- Swap quote customer surfaces:
  - `POST /swap-transactions/quotes`
  - `POST /swap-transactions/quotes/:id/cancel`
- Legacy swap-only admin quote routes remain compatibility wrappers:
  - `GET /admin/swap-transactions/quotes`
  - `GET /admin/swap-transactions/quotes/:id`

## Canonical Responsibilities
- Select and interpret active pricing policy.
- Resolve provider-backed or policy-backed pricing input.
- Calculate fee breakdown and totals.
- Produce immutable quote snapshots with expiry and usage lifecycle.

## Upstream / Downstream Dependencies
- Upstream:
  - asset master data
  - customer eligibility checks where required
- Downstream:
  - swap transaction creation
  - withdraw transaction creation
  - later event-driven accounting and clearing

## Historical / Transitional Notes
- Admin policy surfaces are read-only plus simulator in current runtime.
- Release-governed policy history is the current control model; runtime consumes active projection rather than online policy editing.
- Runtime currently keeps `SwapQuote` and `WithdrawPricingQuote` as separate durable tables while unifying lifecycle orchestration in `PricingCenterService`.
- Legacy swap-only admin quote routes remain compatibility aliases over unified `Quote Center`.

## MUST / MUST NOT
- MUST keep `Price Center` limited to pricing and quote generation.
- MUST NOT let pricing logic directly create clearing or journals.
- MUST NOT treat quote as the durable transaction workflow root.

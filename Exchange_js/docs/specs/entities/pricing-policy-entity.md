Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/pricing-and-quote-constraints.md`, `docs/constraints/business-base-config-release-constraints.md`
Source of Truth Level: specs-entity

# Pricing Policy Entity

## Purpose
- This document defines `PricingPolicy` as the durable pricing configuration root.

## Canonical Fields
- `id`
- `policyCode`
- `policyName`
- `business`
- `channelOnline`
- `channelStoreSoon`
- `configJson`
- `updatedByUserId`
- `updatedByUserNo`
- `createdAt`
- `updatedAt`

## Canonical Meaning
- `PricingPolicy` is the durable config root for pricing logic, fee skeleton, and restriction gating.
- `policyCode` is the canonical natural key.
- `PricingPolicy` is a config subject; it is not a quote snapshot and not a transaction workflow root.

## Write Owners
- Repository-managed config release flow is the long-term authoring and activation path.
- Pricing runtime consumes active policy projections, but does not mutate policy history.

## Relationship Rules
- Quote snapshots freeze `policyRef` from the effective pricing policy context at issuance time.
- Policy history and release history remain separate from quote and transaction histories.

## Historical / Retired Notes
- Direct overwrite without governed history is forbidden as the long-term contract.

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/modules/asset-treasury-foundation-module.md`, `docs/specs/modules/pricing-center-module.md`
Source of Truth Level: specs-entity

# Liquidity Provider Entity

## Purpose
- This document defines `LiquidityProvider` as the durable provider catalog root for pricing and liquidity configuration.

## Canonical Fields
- `id`
- `name`
- `email`
- `phone`
- `status`
- `configurations[]`

## Canonical Meaning
- `LiquidityProvider` is the catalog identity for a quoted or routed liquidity source.
- It is a config/master-data subject, not a transaction root.
- `status` answers whether the provider may participate in active pricing/liquidity configuration.

## Write Owners
- Asset-treasury and pricing configuration flows own provider catalog truth.
- Transaction execution and quote snapshots may reference provider results, but do not own provider identity.

## Relationship Rules
- Provider-specific pair and fee behavior belongs in configuration and quote snapshot context, not on transaction roots directly.

## Historical / Retired Notes
- Current runtime may operate with a limited LP baseline, but the provider catalog remains the durable identity surface.

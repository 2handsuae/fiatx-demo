Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/wallet-account-model-constraints.md`, `docs/specs/entities/wallet-entity.md`
Source of Truth Level: specs-module

# Asset Treasury Foundation Module

## Purpose
- This document defines the Wave 4 current module semantics for asset master data, wallet/account carrier modeling, and wallet routing foundations.

## Positioning
- This is a Wave 4 runtime module spec for the delivered asset/wallet foundation slice.
- It formalizes the shared foundation reused by later deposit, swap, withdraw, and internal treasury flows without claiming those full lifecycles are all implemented here.

## Bounded Context
- `Asset` is the master-data identity of tradable or custody-bound assets.
- `Wallet` is the unified carrier for crypto and bank-like account surfaces.
- Wallet routing uses deterministic role-based identity for pool and system flows.

## Current Implementation Anchors
- `GET /assets`
- `GET /wallets`
- internal treasury consumers:
  - `GET /admin/internal-transactions`
  - `GET /admin/internal-funds`
  - treasury payin/payout surfaces

## Canonical Responsibilities
- Maintain asset identity and status.
- Maintain wallet structural identity:
  - owner scope
  - wallet type
  - direction
  - wallet role
  - deterministic wallet numbering
- Provide reusable wallet/account surfaces for downstream transaction and accounting modules.

## Upstream / Downstream Dependencies
- Upstream:
  - base seed / sync
  - master-data setup
- Downstream:
  - pricing
  - transaction workflows
  - internal treasury routing
  - accounting and balance projection

## Historical / Transitional Notes
- Current runtime keeps `Wallet` as the unified carrier and rejects a second bank-account root in this wave.
- Cleanup round 3 retired wallet shadow balance fields; asset/wallet runtime now relies on snapshot/entry as the only durable balance truth.

## MUST / MUST NOT
- MUST keep `Wallet` as the single durable carrier for `CRYPTO_ADDRESS` and `FIAT_BANK`.
- MUST keep deterministic system wallet routing.
- MUST NOT introduce a separate top-level bank account aggregate in Wave 4.

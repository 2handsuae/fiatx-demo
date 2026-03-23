Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/wallet-account-model-constraints.md`, `docs/specs/modules/asset-treasury-foundation-module.md`
Source of Truth Level: specs-entity

# Wallet Entity

## Purpose
- This document defines the Wave 4 current semantics for `Wallet` as the unified asset carrier.

## Positioning
- This is a Wave 4 runtime entity spec for the implemented wallet carrier model.
- It defines current durable meaning for wallet fields while leaving downstream business-flow adoption boundaries explicit.

## Canonical Structural Fields
- `walletNo`
- `ownerType`
- `ownerId`
- `ownerNo`
- `type`
- `direction`
- `walletRole`
- `assetId`
- `status`

## Bank-Like Account Fields
- `bankName`
- `bankAccount`
- `bankCode`
- `accountName`
- `beneficiaryName`
- `iban`

## Crypto-Specific Fields
- `address`
- `memo`
- `counterpartyVasp`

## Canonical Meaning
- `Wallet` is the structural identity object for one asset-bound custody or bank-like surface.
- `type` answers whether the wallet is a crypto-address carrier or a bank-like carrier.
- `direction` answers whether the wallet is used inbound, outbound, or both.
- `walletRole` answers how the wallet participates in routing or pool semantics.
- `MASTER`, `PAYOUT`, and `CUST_BANK` together represent customer-pool base surfaces.
- `LIQ` and `LIQ_BANK` together represent company/platform liquidity base surfaces.
- `DEPOSIT` represents an on-demand customer-generated inbound funding surface, not a pre-provisioned base pool wallet.

## Balance Semantics
- Structural wallet identity and auditable balance history are separate concerns.
- `Wallet` is not the long-term audit trail of balance movement.
- Wave 4 ledger-enabled balance truth MUST converge on:
  - `WalletBalanceSnapshot`
  - `WalletBalanceEntry`
- `Wallet.balance / lockedBalance` were retired from the current schema in cleanup round 3 and are no longer part of the runtime contract.
- If a wallet has no snapshot yet, runtime treats it as a snapshot-diagnostic state rather than reading a wallet-row shadow balance.

## Write Owners
- Asset-treasury foundation owns structural wallet setup and lifecycle state.
- Accounting owns auditable balance projection outputs derived from journals.

## Non-Negotiable Rules
- `Wallet` remains the canonical carrier for both `CRYPTO_ADDRESS` and `FIAT_BANK`.
- `walletNo` remains the operator-facing stable identifier.
- `Wallet` MUST NOT be split into separate crypto/bank persistence roots in Wave 4.

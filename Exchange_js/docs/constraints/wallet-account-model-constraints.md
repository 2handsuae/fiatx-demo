Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`, `docs/constraints/internal-transaction-flow-constraints.md`, `docs/specs/entities/wallet-entity.md`
Source of Truth Level: constraints

# Wallet / Account Model Constraints (`Wave 4` Runtime Baseline)

## 1) Purpose and Positioning
- This document defines the Wave 4 current constraints for wallet, account-carrier, and asset-binding semantics.
- It freezes the runtime baseline already implemented for wallet identity, routing, and balance-truth ownership.
- Not every downstream transaction flow has adopted the full Wave 4 model, but the wallet carrier and balance-truth rules below are already the current runtime contract.

## 2) Scope
- MUST cover these durable areas only:
1. `Asset` as master data
2. `Wallet` as the unified carrier for crypto and bank-like accounts
3. wallet ownership and routing identity
4. demo baseline structure for customer and platform asset surfaces
- MUST NOT use this document to redefine transaction state machines or pricing logic.

## 3) Unified Wallet Carrier Rule
- `Wallet` MUST remain the single durable carrier for:
1. `CRYPTO_ADDRESS`
2. `FIAT_BANK`
- Wave 4 MUST NOT introduce a separate top-level `BankAccount` aggregate.
- Bank-like account semantics MUST continue to be expressed on `Wallet` using existing bank/account fields.

## 4) Canonical Wallet Identity Contract
- Every wallet MUST have one durable structural identity:
1. `walletNo`
2. `ownerType`
3. `ownerId`
4. `type`
5. `direction`
6. `walletRole`
7. `assetId`
- `walletNo` MUST remain globally unique.
- `ownerType` MUST remain constrained to active wallet owner scopes:
1. `PLATFORM`
2. `CUSTOMER`
3. `LIQUIDITY_PROVIDER`
- Missing or ambiguous owner scope is forbidden for new Wave 4 design work.

## 5) Wallet Type / Direction / Role Contract
- Supported wallet types MUST remain:
1. `FIAT_BANK`
2. `CRYPTO_ADDRESS`
- Supported wallet directions MUST remain:
1. `INBOUND`
2. `OUTBOUND`
3. `BIDIRECTIONAL`
- Supported wallet roles MUST remain grounded in current routing vocabulary:
1. `GENERAL`
2. `DEPOSIT`
3. `MASTER`
4. `PAYOUT`
5. `LIQ`
6. `CUST_BANK`
7. `LIQ_BANK`
- Wave 4 MUST reuse these role names instead of inventing a second routing taxonomy.

## 6) Asset Binding Rules
- Every wallet MUST bind to exactly one `assetId`.
- `CRYPTO_ADDRESS` wallets MUST be interpreted together with asset `type + code + network`.
- `FIAT_BANK` wallets MUST be interpreted together with fiat asset identity and bank/account metadata.
- Asset master data remains outside the first business-config release model and MUST be treated as master data first.

## 7) Bank-Like Account Field Contract
- `FIAT_BANK` semantics MUST continue to be expressed on `Wallet` with these fields:
1. `bankName`
2. `bankAccount`
3. `bankCode`
4. `accountName`
5. `beneficiaryName`
6. `iban`
- New Wave 4 design work MUST NOT split these fields into a second persistence root unless a later ADR explicitly replaces this model.

## 8) Deterministic System Wallet Routing
- System wallet routing MUST stay role-based and deterministic.
- Existing deterministic wallet identity helpers remain the Wave 4 baseline:
1. `buildCryptoSystemWalletNo('MASTER', code, network)`
2. `buildCryptoSystemWalletNo('PAYOUT', code, network)`
3. `buildCryptoSystemWalletNo('LIQ', code, network)`
4. `buildFiatPoolWalletNo('CUST_BANK', code)`
5. `buildFiatPoolWalletNo('LIQ_BANK', code)`
- Wave 4 MUST NOT rely on ad-hoc random system wallet numbering for pool routing.

## 9) Demo Baseline
- Wallet baseline vocabulary MUST distinguish two durable pool groups:
1. customer pool wallets
2. platform/company liquidity wallets
- Customer pool baseline MUST expose these pre-provisioned roles for every active asset scope that requires them:
1. `MASTER`
2. `PAYOUT`
3. `CUST_BANK`
- Platform/company liquidity baseline MUST expose these pre-provisioned roles for every active asset scope that requires them:
1. `LIQ`
2. `LIQ_BANK`
- `DEPOSIT` MUST remain an on-demand customer-generated inbound surface and MUST NOT be treated as a pre-provisioned base pool wallet.
- The exact UI/read-model presentation MAY evolve, but the underlying demo baseline contract MUST remain stable across Wave 4 implementation.

## 10) Balance Ownership Boundary
- Wallet structure data and wallet balance history are different concerns.
- Structural wallet identity belongs to `Wallet`.
- Auditable balance truth for Wave 4 ledger-enabled flows MUST converge on:
1. `WalletBalanceSnapshot`
2. `WalletBalanceEntry`
- `Wallet.balance / lockedBalance` have been retired from the current schema in cleanup round 3.
- Wave 4 runtime MUST treat `WalletBalanceSnapshot / WalletBalanceEntry` as the only durable balance truth.

## 11) Forbidden Patterns
- MUST NOT add a new top-level `BankAccount` aggregate in Wave 4.
- MUST NOT introduce a second wallet-role naming system.
- MUST NOT route system pools without deterministic `walletNo`.
- MUST NOT fold asset master governance into the first `subject release` model.
- MUST NOT mutate wallet balances directly from business services once a ledger-projected path exists for the same scenario.

## 12) Change Protocol
- Any change to this runtime baseline MUST include:
1. impacted owner scope or wallet role
2. affected routing helpers or wallet numbering rules
3. impact on `internal_transactions`, `deposit`, `withdraw`, or pricing consumers
4. compatibility note for existing wallet data

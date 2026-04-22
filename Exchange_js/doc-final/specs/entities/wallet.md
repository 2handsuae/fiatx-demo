# Wallet
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/asset-treasury/wallets/wallets.service.ts, wallets.controller.ts, dto/wallet.dto.ts, system-wallet.util.ts
Last Updated: 2026-04-21

## Prisma Model: Wallet
Table: `wallets`
Business Key: `walletNo` (unique, optional — see generation rules below)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| walletNo | String | Yes (unique) | Generated business key; prefix encodes role (e.g. `WA-MST-`, `WA-PAY-`, `WA-LIQ-`, `WA-CBK-`, `WA-LBK-`) |
| ownerType | String | No | See OwnerType enum |
| ownerId | String | Yes | Null for PLATFORM wallets; UUID of Customer or LP otherwise |
| ownerNo | String | Yes | Denormalized reference number of the owner |
| type | String | No | See WalletType enum |
| direction | String | No | See WalletDirection enum |
| walletRole | String | No | Default `GENERAL`; see WalletRole enum |
| assetId | String | No | FK → Asset |
| address | String | Yes | Crypto on-chain address (auto-generated mock for INBOUND CUSTOMER CRYPTO wallets) |
| memo | String | Yes | Crypto memo/tag (e.g. XRP tag) |
| bankName | String | Yes | Fiat bank name |
| bankAccount | String | Yes | Fiat bank account number |
| bankCode | String | Yes | Fiat bank code (BIC/routing) |
| accountName | String | Yes | Fiat account holder name |
| beneficiaryName | String | Yes | Beneficiary display name |
| counterpartyVasp | String | Yes | VASP name for Travel Rule (crypto outbound targets) |
| iban | String | Yes | IBAN (auto-generated mock for INBOUND CUSTOMER FIAT wallets) |
| status | String | No | Default `ACTIVE`; see WalletStatus enum |
| regulatoryEnablementStatus | String | No | Default `PENDING`; tracks regulatory gate clearing |
| regulatoryEnabledAt | DateTime | Yes | Timestamp when regulatory gate was cleared |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto |

### Balance Fields (computed from WalletBalanceSnapshot — not stored on Wallet row)
| Field | Type | Notes |
|---|---|---|
| availableBalance | Decimal | Sum of unrestricted entries |
| restrictedBalance | Decimal | Sum of restricted/hold entries |
| totalBalance | Decimal | availableBalance + restrictedBalance |
| balanceUpdatedAt | DateTime \| null | Timestamp of last snapshot update |
| balanceSource | String | `SNAPSHOT` or `SNAPSHOT_MISSING` |
| totalAedEquivalent | Decimal \| null | totalBalance × AED valuation rate (null if rate unavailable) |

### Relations
| Relation | Target | Notes |
|---|---|---|
| asset | Asset | The asset this wallet is denominated in |
| payins | Payin[] | Inbound on-chain/fiat settlement events |
| payinsFrom | Payin[] | |
| internalTransactionsFrom | InternalTransaction[] | |
| internalTransactionsTo | InternalTransaction[] | |
| depositTransactions | DepositTransaction[] | |
| journalLines | JournalLine[] | Accounting lines referencing this wallet |
| balanceSnapshots | WalletBalanceSnapshot[] | Latest balance per wallet+asset |
| balanceEntries | WalletBalanceEntry[] | Ledger entries used to compute snapshot |
| regulatoryGateItems | RegulatoryGateItem[] | Regulatory clearance gate items |
| poolSettlementBatchItems | PoolSettlementBatchItem[] | Pool settlement references |
| feeOccurrences | FeeOccurrence[] | |
| inboundTransferSignals | InboundTransferSignal[] | |

---

## Enum Values

### OwnerType
| Value | Meaning |
|---|---|
| `PLATFORM` | System-owned wallets; no ownerId |
| `CUSTOMER` | Individual or corporate customer |
| `LIQUIDITY_PROVIDER` | External LP settlement accounts |

### WalletType
| Value | Meaning |
|---|---|
| `CRYPTO_ADDRESS` | On-chain wallet; uses `address` field |
| `FIAT_BANK` | Bank/IBAN wallet; uses `iban`, `bankName`, `bankAccount`, `bankCode` |

### WalletDirection
| Value | Meaning |
|---|---|
| `INBOUND` | Receives funds (deposit address, bank IBAN) |
| `OUTBOUND` | Sends funds (payout target) |
| `BIDIRECTIONAL` | Both directions (pool/system wallets only) |

### WalletRole
| Value | Owner context | Protection |
|---|---|---|
| `GENERAL` | Customer outbound payout targets | Manual create allowed |
| `DEPOSIT` | Customer inbound deposit wallets | Manual create allowed |
| `MASTER` | Customer crypto pool (aggregate custody) | Protected — base config only |
| `PAYOUT` | Customer crypto payout pool | Protected — base config only |
| `LIQ` | Platform crypto liquidity pool | Protected — base config only |
| `CUST_BANK` | Customer fiat pool | Protected — base config only |
| `LIQ_BANK` | Platform fiat liquidity pool | Protected — base config only |

### WalletStatus
| Value | Meaning |
|---|---|
| `ACTIVE` | Normal operational state |
| `FROZEN` | Temporarily suspended (compliance hold) |
| `DISABLED` | Permanently deactivated |

### WalletSurfaceCategory (computed)
| Value | Criteria |
|---|---|
| `CUSTOMER_POOL` | ownerType=CUSTOMER, ownerId=null, ownerNo=`CUSTOMER_POOL`, role in [MASTER, PAYOUT, CUST_BANK] |
| `PLATFORM_POOL` | ownerType=PLATFORM, ownerId=null, ownerNo=`PLATFORM`, role in [LIQ, LIQ_BANK] |
| `CUSTOMER_DEPOSIT` | ownerType=CUSTOMER, ownerId set, direction=INBOUND, role=DEPOSIT |
| `CUSTOMER_PAYOUT_TARGET` | ownerType=CUSTOMER, ownerId set, direction=OUTBOUND, role=GENERAL or empty |
| `LIQUIDITY_PROVIDER_ACCOUNT` | ownerType=LIQUIDITY_PROVIDER |
| `OTHER` | All other combinations |

---

## Key Business Rules
- Customer INBOUND wallets are idempotent on create: if an INBOUND wallet already exists for the same `(ownerType, ownerId, assetId, direction, type)`, the existing wallet is returned
- Customer wallets cannot use `BIDIRECTIONAL` direction
- Customer INBOUND wallets automatically get role `DEPOSIT`; customer OUTBOUND wallets get role `GENERAL`
- Protected pool roles (`MASTER`, `PAYOUT`, `LIQ`, `CUST_BANK`, `LIQ_BANK`) cannot be created via the API — they are provisioned by base-config seeding only
- For CUSTOMER CRYPTO_ADDRESS INBOUND wallets, a mock Ethereum-style address is auto-generated if not provided
- For CUSTOMER FIAT_BANK INBOUND wallets, a mock IBAN is auto-generated if not provided
- PLATFORM wallets must have `ownerId = null`
- `walletNo` is unique; generation retries up to 5 times on collision
- Protected pool wallets cannot have their status changed manually
- Status changes emit audit logs (`WALLET_STATUS_UPDATED`, trigger `DATA_UPDATE`)
- Balance is not stored directly on the Wallet row; it is computed from `WalletBalanceSnapshot` and expressed as `availableBalance + restrictedBalance`
- AED equivalent balance is calculated using `AssetValuationRate` (quoteAssetCode=`AED`, status=`ACTIVE`)
- Customer token holders are restricted to querying their own wallets only

---

## Service Methods
- `create(dto)` — creates wallet with role resolution and validation; idempotent for CUSTOMER INBOUND; auto-generates address/IBAN; emits audit log
- `findAll(params)` — paginated list with balance snapshot injection, AED rate enrichment, owner name resolution
- `findOne(id)` — full wallet detail with balance, valuation rate, regulatory gate summary
- `findBalance(id)` — balance-only view for a wallet with AED quote price
- `changeStatus(id, status)` — transitions status; blocked for protected pool roles; emits audit log

---

## API Endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /wallets | Admin or Customer JWT | Create wallet (customers restricted to own CUSTOMER wallets) |
| GET | /wallets | Admin or Customer JWT | List wallets with balance (customers see own wallets only) |
| GET | /wallets/:id | Admin or Customer JWT | Get wallet detail with balance and regulatory gate summary |
| GET | /wallets/:id/balance | Admin or Customer JWT | Get projected balance summary with AED equivalent |
| PATCH | /wallets/:id/status | Admin JWT only | Change wallet status |

# Asset
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/asset-treasury/assets/assets.service.ts, assets.controller.ts, dto/asset.dto.ts, src/config/manifests/asset-config.manifest.ts
Last Updated: 2026-04-21

## Prisma Model: Asset
Table: `assets`
Business Key: `assetNo` (unique, generated with prefix `AS`, e.g. `AS_BTC_ETH`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| assetNo | String | Yes (unique) | Business key, generated `AS-XXXXXX`; also set as deterministic key like `AS_USD` via ASSET_CONFIG release |
| type | String | No | `FIAT` or `CRYPTO` |
| code | String | No | Currency code, e.g. `BTC`, `USD`, `AED`, `USDT` |
| network | String | Yes | Required for CRYPTO; null/empty for FIAT; e.g. `ETH`, `TRON`, `BTC` |
| decimals | Int | No | 0–18 |
| description | String | Yes | Human-readable label |
| status | String | No | Default `ACTIVE`; see enum |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto |

### Computed / Manifest-only Fields (AssetConfigManifestItem — not stored on Asset row)
| Field | Type | Notes |
|---|---|---|
| depositEnabled | Boolean | Whether deposit channel is open |
| withdrawEnabled | Boolean | Whether withdraw channel is open |
| depositMinAmount | String (Decimal) | Minimum deposit amount |
| depositMaxAmount | String \| null | Maximum deposit amount |
| withdrawMinAmount | String (Decimal) | Minimum withdraw amount |
| withdrawMaxAmount | String \| null | Maximum withdraw amount |
| minConfirmations | Int \| null | Null for FIAT; positive integer for CRYPTO (e.g. BTC=6) |

### Relations
| Relation | Target | Notes |
|---|---|---|
| wallets | Wallet[] | All wallets denominated in this asset |
| payins | Payin[] | Incoming on-chain/fiat transactions |
| payouts | Payout[] | Outgoing transactions |
| depositTransactions | DepositTransaction[] | |
| swapFromTransactions | SwapTransaction[] | |
| swapToTransactions | SwapTransaction[] | |
| journalLines | JournalLine[] | Accounting lines |
| internalTransactions | InternalTransaction[] | |
| walletBalanceSnapshots | WalletBalanceSnapshot[] | |
| walletBalanceEntries | WalletBalanceEntry[] | |
| valuationRates | AssetValuationRate[] | AED-denominated rates |

## Enum Values

### AssetType
| Value | Meaning |
|---|---|
| `FIAT` | Fiat currency (USD, AED) |
| `CRYPTO` | On-chain crypto asset (BTC, USDT/TRON, ETH) |

### AssetStatus
| Value | Meaning |
|---|---|
| `ACTIVE` | Asset is live; deposit/withdraw permitted |
| `DISABLED` | Asset is inactive; blocked from new transactions |

## Key Business Rules
- `type + code + network` is a unique composite key — duplicate combinations are rejected
- CRYPTO assets require a non-null, non-empty `network`; FIAT assets must have `network` null
- `assetNo` is the stable operator key for cross-system references (used by ASSET_CONFIG release as `businessKey`)
- Asset lifecycle is config-controlled: the canonical path is staging and publishing an `ASSET_CONFIG` business-config release, not the direct `POST /assets` endpoint (which is deprecated)
- When an ASSET_CONFIG release is published, assets not present in the new release are automatically set to `DISABLED`
- CRYPTO assets in the manifest must have `minConfirmations >= 1`; FIAT assets must have `minConfirmations = null`
- Any status change emits an audit log (`ASSET_CONFIG_UPDATED`, trigger `CONFIG_CHANGE`)

## Service Methods
- `create(dto)` — directly creates an asset (deprecated; validates uniqueness, requires network for CRYPTO, emits audit log)
- `findAll(params)` — paginated list with optional filters: type, status, code
- `findOne(id)` — fetch by PK; throws 404 if missing
- `changeStatus(id, status)` — transitions ACTIVE ↔ DISABLED; emits audit log

## API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | /assets | [DEPRECATED] Create asset directly — use ASSET_CONFIG release |
| GET | /assets | List assets (query: skip, take, type, status, code) |
| GET | /assets/:id | Get asset by ID |
| PATCH | /assets/:id/status | Change asset status |

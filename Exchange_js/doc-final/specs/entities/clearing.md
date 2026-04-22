# Clearing
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/clearing-settle/clearing/clearings.service.ts, src/modules/clearing-settle/clearing/clearings.controller.ts, src/modules/clearing-settle/clearing/dto/clearing.dto.ts, src/config/manifests/clearing-templates.manifest.ts
Last Updated: 2026-04-21

## Prisma Models: Clearing, ClearingLine, ClearingTemplate, ClearingLineTemplate

---

## Model: Clearing (Header)
Table: `clearings`
Business Key: `clearingNo` (format: `CL-<timestamp><random>`, unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK, auto-generated |
| clearingNo | String | No | Unique human-readable reference; generated via `generateReferenceNo('CL')` |
| clearingType | String | No | Maps to AcctEvent.eventCode that triggered this clearing (e.g. `EVT_WITHDRAWAL_APPROVED__CRYPTO`) |
| sourceType | String | No | Source entity type: WITHDRAWAL, DEPOSIT, SWAP, INTERNAL_TX |
| sourceId | String | No | UUID of the source entity |
| outAssetId | String | No | FK to Asset.id; asset going out of the platform pool |
| outAmount | Decimal | No | Total amount leaving the pool |
| inAssetId | String | No | FK to Asset.id; asset entering the pool (may differ for swap clearings) |
| inAmount | Decimal | No | Net amount entering the pool after fees |
| feeAssetId | String | No | FK to Asset.id; asset the fee is denominated in |
| feeAmount | Decimal | No | Fee amount extracted |
| feeMethod | String | No | Fee calculation method: CONFIGURED_FEE or ACTUAL_FEE |
| outPayoutId | String | Yes | FK to Payout.id; linked outbound payout instruction |
| inPayinId | String | Yes | FK to Payin.id; linked inbound payin instruction |
| clearingStatus | String | No | ClearingStatus enum; defaults `CLEARED` on creation |
| memo | String | Yes | Human-readable memo for this clearing |
| createdAt | DateTime | No | Auto-set on creation |
| updatedAt | DateTime | No | Auto-updated |

### Relations
| Relation | Target | Notes |
|---|---|---|
| lines | ClearingLine[] | Individual party-level line breakdown |
| outPayout | Payout? | Linked outbound payout |
| inPayin | Payin? | Linked inbound payin |

---

## Model: ClearingLine
Table: `clearing_lines`
Business Key: `[clearingId, lineNo]` (composite unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK, auto-generated |
| clearingId | String | No | FK to Clearing.id |
| lineNo | Int | No | Sequential line number within clearing |
| lineType | String | No | ClearingLineType enum — see below |
| partyType | String | No | PartyType enum — CUSTOMER, PLATFORM, LIQUIDITY_PROVIDER |
| partyId | String | Yes | UUID of the party (customer or LP id); null for PLATFORM lines |
| assetId | String | No | FK to Asset.id |
| amount | Decimal | No | Amount for this party/line |
| refType | String | Yes | Reference type identifier (e.g. `PAYOUT`) |
| refId | String | Yes | Reference entity UUID |
| createdAt | DateTime | No | Auto-set on creation |

### Relations
| Relation | Target | Notes |
|---|---|---|
| clearing | Clearing | Parent clearing header |

---

## Model: ClearingTemplate
Table: `clearing_templates`
Business Key: `code` (unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| code | String | No | Unique template code (e.g. `WITHDRAWAL_STANDARD_V1`) |
| clearingType | String | No | Logical clearing type label |
| sourceType | String | No | Expected source entity type |
| isEnabled | Boolean | No | Defaults true; disabled templates are skipped |
| description | String | No | Human-readable description |
| feeMethod | String | No | CONFIGURED_FEE or ACTUAL_FEE |
| outAssetSource | String | No | Context expression for outAssetId (e.g. `src.assetId`) |
| outAmountSource | String | No | Context expression for outAmount (e.g. `src.amount`) |
| inAssetSource | String | No | Context expression for inAssetId |
| inAmountSource | String | No | Context expression for inAmount (e.g. `src.netAmount`) |
| feeAssetSource | String | No | Context expression for feeAssetId |
| feeAmountSource | String | No | Context expression for feeAmount (e.g. `src.feeAmount`) |
| outPayoutIdSource | String | Yes | Optional context expression for outPayoutId |
| inPayinIdSource | String | Yes | Optional context expression for inPayinId |
| memoTemplate | String | Yes | Template string for clearing memo |
| createdAt | DateTime | No | Auto-set |
| updatedAt | DateTime | No | Auto-updated |

---

## Model: ClearingLineTemplate
Table: `clearing_line_templates`
Business Key: `[clearingTemplateId, lineNo]` (composite unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| clearingTemplateId | String | No | FK to ClearingTemplate.id |
| lineNo | Int | No | Line order within template |
| lineType | String | No | ClearingLineType enum |
| partyType | String | No | PartyType enum |
| partyIdSource | String | Yes | Context expression to resolve partyId |
| assetSource | String | No | Context expression for assetId |
| amountSource | String | No | Context expression for amount |
| refTypeConst | String | Yes | Constant reference type string |
| refIdSource | String | Yes | Context expression for refId |
| memoTemplate | String | Yes | Line-level memo template |
| isEnabled | Boolean | No | Defaults true |
| createdAt | DateTime | No | Auto-set |

---

## Enum Values

### ClearingLineType (lineType field)
| Value | Meaning |
|---|---|
| INCOMING | Funds flowing into the platform from an external party |
| FEE | Platform fee extraction line |
| OUTGOING | Funds flowing out to a beneficiary (customer or LP) |

### PartyType
| Value | Meaning |
|---|---|
| CUSTOMER | Retail customer party |
| PLATFORM | Exchange platform itself |
| LIQUIDITY_PROVIDER | External liquidity provider |

### FeeMethod
| Value | Meaning |
|---|---|
| CONFIGURED_FEE | Fee taken from pre-configured fee schedule |
| ACTUAL_FEE | Fee taken from actual network/execution cost |

### ClearingStatus
| Value | Meaning |
|---|---|
| OPEN | Clearing record created but not yet settled |
| CLEARED | Clearing resolved (default status on creation) |

## Default Templates (from clearing-templates.manifest.ts)

### WITHDRAWAL_STANDARD_V1
Triggered by: `EVT_WITHDRAWAL_APPROVED__CRYPTO` and `EVT_WITHDRAWAL_APPROVED__FIAT`
- out: `src.amount` of `src.assetId`
- in: `src.netAmount` of `src.assetId`
- fee: `src.feeAmount` of `src.assetId`
- Line 1: FEE / PLATFORM / `src.feeAmount`
- Line 2: OUTGOING / CUSTOMER (`src.ownerId`) / `src.netAmount`

### INTERNAL_TX_COLLECTION_V1
Triggered by: `EVT_INTERNAL_TX_SUCCESS__CRYPTO` and `EVT_INTERNAL_TX_SUCCESS__FIAT`
- out: `src.amount`; in: `src.netAmount`; fee: `src.feeAmount`
- Line 1: OUTGOING / PLATFORM / `src.netAmount`
- Line 2: FEE / PLATFORM / `src.feeAmount`

## Key Business Rules
- **Idempotency**: `triggerClearing()` and `executeResolvedEvent()` check for existing `(sourceType, sourceId, clearingType)` before creating; return existing record
- **Template resolution**: All amount and asset fields are resolved from context using dot-path expressions (e.g. `src.assetId` → `context.src.assetId`); negative resolved amounts throw `CLEARING_TEMPLATE_EVAL_FAILED`
- **clearingType stores eventCode**: The `clearingType` field on `Clearing` stores the triggering AcctEvent.eventCode, not a separate clearing type enum
- **No pool linkage in schema**: Clearing does not have a direct FK to a pool/safeguarding pool; pool settlement is managed by `clearing-settle/pool-settlement-batches` separately
- **Party resolution in findLine**: `partyNo` is enriched at read time by looking up `customerNo` (for CUSTOMER) or `lpNo` (for LIQUIDITY_PROVIDER) from related entities
- **Status update by source**: `updateStatusBySource()` bulk-updates all clearings for a source entity — used for workflow state sync
- All clearing creation runs inside a DB transaction; supports external `tx` injection for atomicity with journal posting

## Service Methods
- `triggerClearing(params, tx?)` — resolves AcctEvent, checks idempotency, delegates to `executeResolvedEvent()`
- `executeResolvedEvent(params, tx?)` — loads ClearingTemplate, evaluates context expressions, creates Clearing header + ClearingLine records atomically
- `findAll(query)` — paginated list filterable by sourceId, clearingStatus; enriches with asset codes and sourceNo
- `findOne(id)` — get clearing by UUID; includes lines, outPayout, inPayin; enriches with asset codes and payout/payin Nos
- `findAllLines(query)` — paginated list of clearing lines, filterable by clearingId; enriches with partyNo and assetCode
- `findLine(id)` — get single clearing line; enriches with partyNo, assetCode, assetDecimals, clearingNo
- `reClear(id)` — placeholder re-clear that touches `updatedAt` (future: recalculate lines from template)
- `updateStatusBySource(sourceType, sourceId, status, tx?)` — bulk status update for all clearings under a source entity

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /clearings | List all clearings (paginated, filterable) |
| GET | /clearings/lines | List all clearing lines (paginated) |
| GET | /clearings/lines/:id | Get single clearing line by UUID |
| GET | /clearings/:id | Get single clearing by UUID |
| POST | /clearings/:id/re-clear | Trigger re-clear for a clearing record |

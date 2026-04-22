# Accounting Event (AcctEvent)
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/accounting/acct-events/acct-events.service.ts, src/modules/accounting/acct-events/acct-events.controller.ts, src/modules/accounting/acct-events/dto/acct-event.dto.ts, src/config/manifests/events.manifest.ts, src/modules/accounting/journals/journals.service.ts
Last Updated: 2026-04-21

## Prisma Model: AcctEvent
Table: `acct_events`
Business Key: `eventCode` (unique, format: `EVT_<ENTITY>_<ACTION>[__<ASSET_TYPE>]`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK, auto-generated |
| eventCode | String | No | Unique business key; must start with `EVT_` |
| entityType | String | No | Source entity type: DEPOSIT, SWAP, WITHDRAW, INTERNAL_TX |
| ownerScope | String | No | OwnerScope enum — CUSTOMER, LP, ALL |
| assetType | String | No | AssetType enum — FIAT, CRYPTO, ALL |
| triggerType | String | No | TriggerType enum — how this event is fired |
| postingMode | String | No | PostingMode enum — controls journal creation strategy |
| clearingMode | String | No | ClearingMode enum — controls clearing creation |
| postingReversalOfEventCode | String | Yes | Required when postingMode=AUTO_REVERSAL; the event whose journal to reverse |
| clearingReversalOfEventCode | String | Yes | Target event code for clearing reversal |
| clearingTemplateCode | String | Yes | FK to ClearingTemplate.code; required when clearingMode=TEMPLATE |
| fromStatus | String | Yes | Source status for STATUS_TRANSITION trigger (null = wildcard) |
| toStatus | String | Yes | Destination status for STATUS_TRANSITION trigger |
| triggerKey | String | Yes | Field name to watch for transition (typically `status`) |
| isActive | Boolean | No | Soft-disable flag; defaults to true |
| description | String | Yes | Human-readable description |
| createdAt | DateTime | No | Auto-set on creation |
| updatedAt | DateTime | No | Auto-updated |

### Relations
| Relation | Target | Notes |
|---|---|---|
| journalHeaderTemplates | JournalHeaderTemplate[] | Templates linked to this event |
| postingReversalEvent | AcctEvent? | Self-ref: the event this reverses |
| reversalOfPosting | AcctEvent[] | Self-ref: events that reverse this one |
| clearingReversalEvent | AcctEvent? | Self-ref: the event this clearing reverses |
| reversalOfClearing | AcctEvent[] | Self-ref: events that clearing-reverse this one |

## Enum Values

### OwnerScope
| Value | Meaning |
|---|---|
| CUSTOMER | Event affects customer-owned funds |
| LP | Event affects liquidity provider funds |
| ALL | No scope restriction |

### AssetType
| Value | Meaning |
|---|---|
| FIAT | Fiat currency only |
| CRYPTO | Cryptocurrency only |
| ALL | Asset-type-agnostic |

### TriggerType
| Value | Meaning |
|---|---|
| STATUS_TRANSITION | Fired when entity transitions between `fromStatus` → `toStatus` |
| EXTERNAL_CALLBACK | Fired by an external webhook/callback |
| COMMAND | Fired by an explicit admin command |
| SYSTEM_RULE | Fired by an automated system rule |
| SCHEDULED | Fired on a schedule |

### PostingMode
| Value | Behavior |
|---|---|
| TEMPLATE | Create a new journal from JournalHeaderTemplate matching `eventCode` |
| AUTO_REVERSAL | Mirror-reverse the journal created by `postingReversalOfEventCode` |
| BULK_REVERSAL_BY_SOURCE | Reverse all non-reversed journals for the same source entity |
| NONE | No journal posting |

### ClearingMode
| Value | Behavior |
|---|---|
| TEMPLATE | Create a Clearing record from the ClearingTemplate identified by `clearingTemplateCode` |
| NONE | No clearing |

## EventCode Catalog (DEFAULT_ACCT_EVENTS)
| EventCode | EntityType | AssetType | toStatus | PostingMode | ClearingMode |
|---|---|---|---|---|---|
| EVT_DEPOSIT_CONFIRMED__CRYPTO | DEPOSIT | CRYPTO | COMPLIANCE_PENDING | TEMPLATE | NONE |
| EVT_DEPOSIT_SUCCESS__CRYPTO | DEPOSIT | CRYPTO | SUCCESS | TEMPLATE | NONE |
| EVT_DEPOSIT_CONFIRMED__FIAT | DEPOSIT | FIAT | COMPLIANCE_PENDING | TEMPLATE | NONE |
| EVT_DEPOSIT_SUCCESS__FIAT | DEPOSIT | FIAT | SUCCESS | TEMPLATE | NONE |
| EVT_SWAP_CREATED | SWAP | ALL | PENDING_COMPLIANCE | TEMPLATE | NONE |
| EVT_SWAP_REJECTED | SWAP | ALL | REJECTED | AUTO_REVERSAL (→EVT_SWAP_CREATED) | NONE |
| EVT_SWAP_FAILED | SWAP | ALL | FAILED | AUTO_REVERSAL (→EVT_SWAP_CREATED) | NONE |
| EVT_SWAP_SUCCESS | SWAP | ALL | SUCCESS | TEMPLATE | NONE |
| EVT_WITHDRAWAL_CREATED | WITHDRAW | ALL | CREATED | TEMPLATE | NONE |
| EVT_WITHDRAWAL_APPROVED__CRYPTO | WITHDRAW | CRYPTO | PAYOUT_PENDING | TEMPLATE | TEMPLATE (WITHDRAWAL_STANDARD_V1) |
| EVT_WITHDRAWAL_APPROVED__FIAT | WITHDRAW | FIAT | PAYOUT_PENDING | TEMPLATE | TEMPLATE (WITHDRAWAL_STANDARD_V1) |
| EVT_WITHDRAWAL_SUCCESS__CRYPTO | WITHDRAW | CRYPTO | SUCCESS | TEMPLATE | NONE |
| EVT_WITHDRAWAL_SUCCESS__FIAT | WITHDRAW | FIAT | SUCCESS | TEMPLATE | NONE |
| EVT_WITHDRAWAL_FAILED | WITHDRAW | ALL | FAILED | BULK_REVERSAL_BY_SOURCE | NONE |
| EVT_WITHDRAWAL_RETURNED__FIAT | WITHDRAW | FIAT | RETURNED | BULK_REVERSAL_BY_SOURCE | NONE |
| EVT_WITHDRAWAL_CANCELLED | WITHDRAW | ALL | CANCELLED | AUTO_REVERSAL (→EVT_WITHDRAWAL_CREATED) | NONE |
| EVT_WITHDRAWAL_REJECTED | WITHDRAW | ALL | REJECTED | AUTO_REVERSAL (→EVT_WITHDRAWAL_CREATED) | NONE |
| EVT_INTERNAL_TX_CREATED__CRYPTO | INTERNAL_TX | CRYPTO | INTERNAL_FUNDS_PENDING | TEMPLATE | NONE |
| EVT_INTERNAL_TX_SUCCESS__CRYPTO | INTERNAL_TX | CRYPTO | SUCCESS | TEMPLATE | TEMPLATE (INTERNAL_TX_COLLECTION_V1) |
| EVT_INTERNAL_TX_FAILED__CRYPTO | INTERNAL_TX | CRYPTO | FAILED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__CRYPTO) | NONE |
| EVT_INTERNAL_TX_CANCELLED__CRYPTO | INTERNAL_TX | CRYPTO | CANCELLED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__CRYPTO) | NONE |
| EVT_INTERNAL_TX_REJECTED__CRYPTO | INTERNAL_TX | CRYPTO | REJECTED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__CRYPTO) | NONE |
| EVT_INTERNAL_TX_CREATED__FIAT | INTERNAL_TX | FIAT | INTERNAL_FUNDS_PENDING | TEMPLATE | NONE |
| EVT_INTERNAL_TX_SUCCESS__FIAT | INTERNAL_TX | FIAT | SUCCESS | TEMPLATE | TEMPLATE (INTERNAL_TX_COLLECTION_V1) |
| EVT_INTERNAL_TX_FAILED__FIAT | INTERNAL_TX | FIAT | FAILED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__FIAT) | NONE |
| EVT_INTERNAL_TX_CANCELLED__FIAT | INTERNAL_TX | FIAT | CANCELLED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__FIAT) | NONE |
| EVT_INTERNAL_TX_REJECTED__FIAT | INTERNAL_TX | FIAT | REJECTED | AUTO_REVERSAL (→EVT_INTERNAL_TX_CREATED__FIAT) | NONE |

## Key Business Rules
- `eventCode` must match pattern `/^EVT_/`; validated at DTO level
- `triggerType: STATUS_TRANSITION` matching uses `entityType`, `triggerKey`, `fromStatus` (null = wildcard), `toStatus`, and `assetType` (exact match or `ALL`); implemented in `JournalsService.triggerEvent()`
- `postingMode: AUTO_REVERSAL` requires `postingReversalOfEventCode` to reference an existing active event
- `postingMode: BULK_REVERSAL_BY_SOURCE` reverses all non-reversed journals for the same `sourceType`+`sourceId` pair
- `clearingMode: TEMPLATE` requires `clearingTemplateCode` to reference an enabled ClearingTemplate
- `isActive: false` is the soft-delete path (used by `remove()` method); event record is retained for audit
- Changes are fully audit-logged with `AuditActions.ACCT_EVENT_UPDATED` and `AuditTriggerType.CONFIG_CHANGE`
- At module init, `AcctConfigService` validates deposit event contract on startup and warns on mismatch

## Service Methods
- `create(dto)` — creates event; enforces `eventCode` uniqueness and validates `postingReversalOfEventCode` existence
- `findAll(query)` — paginated list filterable by eventCode, entityType, ownerScope, assetType, triggerType, isActive
- `findOne(eventCode)` — lookup by business key; includes postingReversalEvent and clearingReversalEvent relations
- `update(eventCode, dto)` — partial update; audits before/after diff
- `remove(eventCode)` — soft-delete by setting `isActive: false`

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /acct-events | List all accounting events (filterable, paginated) |
| GET | /acct-events/:eventCode | Get single event by eventCode |

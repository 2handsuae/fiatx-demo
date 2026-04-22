# Journal (Journal Header + Lines + Templates)
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/accounting/journals/journals.service.ts, src/modules/accounting/journals/journals.controller.ts, src/modules/accounting/journal-lines/journal-lines.controller.ts, src/config/manifests/journal-templates.manifest.ts
Last Updated: 2026-04-21

## Prisma Models: Journal, JournalLine, JournalHeaderTemplate, JournalLineTemplate

---

## Model: Journal (Header)
Table: `journals`
Business Key: `journalNo` (format: `JO-<timestamp><random>`, unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK, auto-generated |
| journalNo | String | No | Unique human-readable reference; generated via `generateReferenceNo('JO')` |
| sourceType | String | No | Source entity type: DEPOSIT, SWAP, WITHDRAWAL, INTERNAL_TX, PAYIN, PAYOUT, CLEARING |
| sourceId | String | No | FK to the source entity's UUID |
| sourceNo | String | Yes | Business reference number of source entity (denormalized for display) |
| eventCode | String | No | The AcctEvent.eventCode that triggered this journal |
| postingStatus | String | No | Always `POSTED` in current implementation |
| postedAt | DateTime | Yes | Timestamp when journal was posted |
| baseAssetId | String | No | FK to Asset; the base/settlement currency of this journal |
| reversalOfJournalId | String | Yes | If set, this is a reversal of another journal |
| description | String | Yes | Human-readable description (may be template-rendered) |
| totalAmount | Decimal | Yes | Sum of source entity amount (denormalized) |
| journalHeaderTemplateId | String | Yes | FK to JournalHeaderTemplate used to generate this journal |
| createdAt | DateTime | No | Auto-set on creation |
| updatedAt | DateTime | No | Auto-updated |

### Relations
| Relation | Target | Notes |
|---|---|---|
| lines | JournalLine[] | All debit/credit line entries |
| baseAsset | Asset | The settlement asset |
| journalHeaderTemplate | JournalHeaderTemplate? | Template used for generation |

---

## Model: JournalLine
Table: `journal_lines`
Business Key: `[journalId, lineNo]` (composite unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String | No | PK; format `JEL_<UUID>` (prefixed) |
| journalId | String | No | FK to Journal.id |
| lineNo | Int | No | Sequential line number within journal |
| accountCode | String | No | FK to Coa.code |
| drCr | String | No | DR or CR — see enum below |
| amount | Decimal | No | Positive absolute value; direction conveyed by drCr |
| assetId | String | No | FK to Asset.id; the asset of this line |
| baseAmount | Decimal | Yes | Amount in base currency (if FX conversion applies) |
| fxRate | Decimal | Yes | FX rate applied if assetId differs from baseAssetId |
| ownerType | String | Yes | Owner category: CUSTOMER, PLATFORM, LP |
| ownerId | String | Yes | Owner entity UUID (e.g. customer UUID) |
| walletId | String | Yes | FK to Wallet.id; required for asset lines on DEPOSIT/WITHDRAW/INTERNAL_TX |
| dimensions | String | No | JSON object; defaults `{}`; contains `walletId`, `assetId`, `client_id` etc. |
| description | String | Yes | Line-level description |
| referenceId | String | Yes | Optional reference to external record |
| journalLineTemplateId | String | Yes | FK to JournalLineTemplate.id; traces which template generated this line |
| createdAt | DateTime | No | Auto-set on creation |

### Relations
| Relation | Target | Notes |
|---|---|---|
| journal | Journal | Parent header |
| account | Coa | The account being debited/credited |
| asset | Asset | The asset of this line |
| wallet | Wallet? | Wallet for balance tracking |
| walletBalanceEntry | WalletBalanceEntry? | Corresponding wallet balance mutation |
| journalLineTemplate | JournalLineTemplate? | Template that generated this line |

---

## Model: JournalHeaderTemplate
Table: `journal_header_templates`
Business Key: `templateCode` (unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| templateCode | String | No | Unique code, e.g. `TPL_EVT_DEPOSIT_CONFIRMED__CRYPTO_V1` |
| eventCode | String | No | FK to AcctEvent.eventCode |
| version | Int | No | Template version, default 1 |
| status | String | No | ACTIVE or DEPRECATED; only ACTIVE templates are used |
| baseAssetId | String | No | FK to Asset.id; sets Journal.baseAssetId |
| description | String | Yes | Human-readable description |
| effectiveFrom | DateTime | Yes | Optional versioning window start |
| effectiveTo | DateTime | Yes | Optional versioning window end |
| createdAt | DateTime | No | Auto-set |
| updatedAt | DateTime | No | Auto-updated |

---

## Model: JournalLineTemplate
Table: `journal_line_templates`
Business Key: `[templateId, lineNo]` (composite unique)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| templateId | String | No | FK to JournalHeaderTemplate.id |
| lineNo | Int | No | Line order within template |
| accountCode | String | No | FK to Coa.code |
| drCr | String | No | DR or CR |
| amountSource | String | No | Amount resolution key — see below |
| assetSource | String | No | Asset resolution key — see below |
| ownerTypeSource | String | Yes | Context path to resolve ownerType (e.g. `src.ownerType`) or literal (e.g. `PLATFORM`) |
| ownerIdSource | String | Yes | Context path to resolve ownerId (e.g. `src.ownerId`) |
| fxRateSource | String | Yes | Context path to resolve FX rate |
| referenceSource | String | Yes | Context path to resolve referenceId |
| dimensionsRule | String | No | Mustache template JSON string; `{{src.walletId}}` style; defaults `{}` |
| conditionExpr | String | Yes | Optional conditional expression (not yet enforced) |
| description | String | Yes | Line description template |
| createdAt | DateTime | No | Auto-set |

---

## Enum Values

### DrCr (Journal Line direction)
| Value | Meaning |
|---|---|
| DR | Debit — increases ASSET accounts, decreases LIABILITY/EQUITY/REVENUE/EXPENSE |
| CR | Credit — decreases ASSET accounts, increases LIABILITY/EQUITY/REVENUE/EXPENSE |

### AmountSource (JournalLineTemplate resolution)
| Value | Resolves to |
|---|---|
| AMOUNT | `context.src.amount` |
| NET_AMOUNT | `context.src.netAmount` |
| FROM_AMOUNT | `context.src.fromAmount` (swap source leg) |
| TO_AMOUNT | `context.src.toAmount` (swap destination leg) |
| FEE_AMOUNT | `context.src.feeAmount` |

### AssetSource (JournalLineTemplate resolution)
| Value | Resolves to |
|---|---|
| ASSET_ID | `context.src.assetId` (default) |
| FROM_ASSET_ID | `context.src.fromAssetId` |
| TO_ASSET_ID | `context.src.toAssetId` |
| FEE_ASSET_ID | `context.src.feeAssetId` |

### WalletBalanceBucket (derived from accountCode)
| accountCode | Bucket |
|---|---|
| A.CUSTODY, A.BANK | AVAILABLE |
| A.CUSTODY_RESTRICTED, A.BANK_RESTRICTED | RESTRICTED |
| A.CUSTODY_IN_TRANSIT, A.BANK_IN_TRANSIT | IN_TRANSIT |

---

## Key Business Rules
- **Idempotency**: `createJournal()` checks for existing `(sourceType, sourceId, eventCode)` before creating; returns existing record if found
- **Balance assertion**: Every journal must balance DR=CR for each `assetId`; enforced by `assertJournalBalancedByAsset()` before write
- **walletId required**: Asset lines (account code starting with `A.`) on source types DEPOSIT, WITHDRAW, WITHDRAWAL, INTERNAL_TX must have a non-null `walletId`; enforced by `assertAssetLinesHaveWalletId()`
- **ownerType alignment**: If a journal line references a `walletId`, ownerType is auto-aligned from the wallet's `ownerType` field
- **Wallet balance projection**: Every committed asset journal line triggers upsert of `WalletBalanceEntry` and `WalletBalanceSnapshot`; negative resulting balance throws `INSUFFICIENT_WALLET_BALANCE`
- **Reversal**: AUTO_REVERSAL flips DR↔CR on each line of the original journal; BULK_REVERSAL_BY_SOURCE reverses all non-reversed journals for a source entity
- **Template lookup**: `createJournal()` finds the first `ACTIVE` JournalHeaderTemplate for the given `eventCode`; throws 404 if not found
- **Dimensions**: `walletId` is extracted from the JSON `dimensions` field (key `walletId`) for wallet balance tracking
- All journal creation runs inside a DB transaction; if called with an external `tx`, joins the external transaction

## Service Methods (JournalsService)
- `createJournal(params, tx?)` — creates a journal entry from template; idempotent; asserts balance and wallet constraints
- `triggerEvent(params, tx?)` — resolves AcctEvent by entityType/triggerKey/fromStatus/toStatus/assetType, then dispatches to `executeResolvedEvent()`
- `executeResolvedEvent(params, tx?)` — routes to `createJournal()`, `reverseJournal()`, or `reverseAllBySource()` based on postingMode
- `reverseJournal(params, tx?)` — creates a mirror journal with flipped DR/CR; idempotent
- `reverseAllBySource(params, tx?)` — reverses all non-reversed journals for a source entity
- `createDepositJournal(depositId, eventCode, amount, assetId, ownerId)` — convenience wrapper for deposit events
- `getCustomerLiabilityBalance(params, tx?)` — aggregates L.CLIENT_CREDIT and L.CLIENT_HELD balances for a customer
- `findAll(query)` — paginated list with filters on sourceType, eventCode, postingStatus, baseAssetId, date ranges
- `findOne(id)` — lookup by UUID; includes baseAsset relation

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /journals | List journal headers (paginated, Admin only) |
| GET | /journals/:id | Get single journal header by UUID |
| GET | /journal-lines | List all journal lines (Admin only) |
| GET | /journal-lines/customer-balance-history | Customer available balance history |
| GET | /journal-lines/:id | Get single journal line by UUID |

# Chart of Accounts (COA)
Wave: 4 | Source verified: prisma/schema.prisma, src/modules/accounting/coa/coa.service.ts, src/modules/accounting/coa/coa.controller.ts, src/modules/accounting/coa/dto/coa.dto.ts, src/config/manifests/coa.manifest.ts
Last Updated: 2026-04-21

## Prisma Model: Coa
Table: `chart_of_accounts`
Business Key: `code` (unique, prefix-namespaced, e.g. `A.CUSTODY`, `L.CLIENT_CREDIT`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK, auto-generated |
| code | String | No | Unique business key; prefix encodes type (A.=Asset, L.=Liability, Q.=Equity, R.=Revenue, E.=Expense) |
| type | String | No | CoaType enum — see below |
| name | String | No | Human-readable account name |
| status | String | No | CoaStatus enum — ACTIVE or DISABLED |
| requiredTags | String | No | JSON array (serialized); defaults to `[]` |
| createdAt | DateTime | No | Auto-set on creation |
| updatedAt | DateTime | No | Auto-updated |

### Relations
| Relation | Target | Notes |
|---|---|---|
| journalLineTemplates | JournalLineTemplate[] | Templates that post to this account |
| journalLines | JournalLine[] | All posted lines on this account |

## Enum Values

### CoaType
| Value | Meaning | Normal Balance | Code Prefix |
|---|---|---|---|
| ASSET | Firm-owned assets (custody, bank) | DR | `A.` |
| LIABILITY | Client-owed balances (credit, held, payables) | CR | `L.` |
| EQUITY | Retained earnings | CR | `Q.` |
| REVENUE | Fee income streams | CR | `R.` |
| EXPENSE | Operational costs (network fees, bank fees, LP cost) | CR | `E.` |

### CoaStatus
| Value | Meaning |
|---|---|
| ACTIVE | Account is live, can receive journal lines |
| DISABLED | Blocked from new postings |

## Default Accounts (from coa.manifest.ts)
| Code | Name | Type |
|---|---|---|
| A.BANK | Bank Account (Fiat) | ASSET |
| A.BANK_RESTRICTED | Bank Account Restricted (Fiat) | ASSET |
| A.BANK_IN_TRANSIT | Bank Account In Transit (Fiat) | ASSET |
| A.CUSTODY | Custody Wallet (Crypto) | ASSET |
| A.CUSTODY_RESTRICTED | Custody Wallet Restricted (Crypto) | ASSET |
| A.CUSTODY_IN_TRANSIT | Custody Wallet In Transit (Crypto) | ASSET |
| L.CLIENT_CREDIT | Client Available Balance | LIABILITY |
| L.CLIENT_HELD | Client Frozen Balance | LIABILITY |
| L.CLIENT_AUDIT | Client Audit Pending Balance | LIABILITY |
| L.PLATFORM_PAYABLE | Platform Payable (Revenue) | LIABILITY |
| L.LP_PAYABLE | Liquidity Provider Payable | LIABILITY |
| Q.RETAINED_EARNINGS | Retained Earnings | EQUITY |
| R.SWAP_FEE | Swap Fee Revenue | REVENUE |
| R.WITHDRAW_FEE | Withdrawal Fee Revenue | REVENUE |
| R.DEPOSIT_FEE | Deposit Processing Fee Revenue | REVENUE |
| E.LP_COST | Liquidity Provider Cost | EXPENSE |
| E.BANK_FEE | Bank Transfer Fee | EXPENSE |
| E.NETWORK_FEE | Blockchain Network Fee | EXPENSE |

## Key Business Rules
- `code` is immutable once created; it is the stable business key used in journal line references
- `type` determines the normal balance direction: ASSET accounts increase on DR, LIABILITY/EQUITY/REVENUE/EXPENSE accounts increase on CR
- The code prefix convention (`A.`, `L.`, `Q.`, `R.`, `E.`) encodes account type — enforced by convention, not DB constraint
- Asset accounts starting with `A.` drive wallet balance bucketing in `JournalsService.resolveWalletBalanceBucket()`: `A.CUSTODY`/`A.BANK` → AVAILABLE, `A.CUSTODY_RESTRICTED`/`A.BANK_RESTRICTED` → RESTRICTED, `A.CUSTODY_IN_TRANSIT`/`A.BANK_IN_TRANSIT` → IN_TRANSIT
- `requiredTags` is a JSON-serialized string array; parsed on every read
- `status: DISABLED` does not cascade-delete existing journal lines; only blocks new template assignment
- Admin CRUD is fully audit-logged with `AuditActions.COA_CONFIG_UPDATED` and `AuditTriggerType.CONFIG_CHANGE`

## Service Methods
- `create(dto)` — creates a new COA account; enforces uniqueness on `code`; audits with beforeData/afterData
- `findAll(query)` — paginated list with `code`/`name` filter and sort; parses `requiredTags` JSON on each item
- `findOne(id)` — lookup by UUID id; parses `requiredTags`
- `update(id, dto)` — partial update of `name`, `status`, `requiredTags`; audits diff
- `remove(id)` — hard deletes (DB cascade to journal lines/templates must not be violated in practice)

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | /coa | List all COAs (paginated, filterable by code/name) |
| GET | /coa/:id | Get single COA by UUID |

> Note: Create/Update/Delete are service-internal (no public controller routes exposed); invoked via direct service injection or seed scripts.

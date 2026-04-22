# Accounting Event Execution Workflow

Wave: 4 | Source verified: `src/orchestrators/accounting-event-execution.service.ts`, `src/modules/accounting/journals/journals.service.ts`, `src/modules/clearing-settle/clearing/clearings.service.ts`, `src/orchestrators/withdraw-workflow.orchestrator.ts`, `src/orchestrators/deposit-workflow.service.ts`, `src/orchestrators/workflows.module.ts`
Last Updated: 2026-04-21

## Purpose

Resolves an accounting event from a status-transition signal and atomically executes the corresponding journal posting and/or clearing record within a single DB transaction.

## Actors

| Actor | Role |
|---|---|
| `WithdrawWorkflowOrchestrator` | Primary caller — fires on every withdrawal status transition event |
| `DepositWorkflowService` | Caller for deposit/payin status transitions (uses `JournalsService` directly, not via this service) |
| `InternalCollectionWorkflowOrchestrator` | Caller for internal-transaction events |
| `AccountingEventExecutionService` | Orchestrator: resolves event, dispatches to JournalsService and ClearingsService |
| `JournalsService` | Creates / reverses journal headers and lines; projects wallet balances |
| `ClearingsService` | Creates clearing record and lines from clearing template |
| `AcctEvent` table | Source of truth for event-to-template mapping (populated by config release) |

## State Machine / Pipeline

This is a stateless execution service (no persistent state machine). The outcome is either a new Journal + optional Clearing (both created), or a no-op (no matching event found).

| Step | Description | Condition | Result |
|---|---|---|---|
| 1. Resolve event | Query `acctEvent` by entityType + triggerKey + toStatus + assetType | `isActive=true`, `triggerType=STATUS_TRANSITION` | Matched event or null |
| 2. No-match | No active event found | — | Warn log; return null result (soft-fail, no throw) |
| 3. Idempotency check | If both journal + clearing exist | `requiresPosting && requiresClearing` both already done | Return existing records |
| 4. Partial check | One of journal/clearing exists but not the other | `requiresPosting && requiresClearing` | Throw `PARTIAL_EVENT_EXECUTION` (hard error) |
| 5. Execute clearing | `ClearingsService.executeResolvedEvent()` | `event.clearingMode === 'TEMPLATE'` | Clearing + lines created |
| 6. Execute journal | `JournalsService.executeResolvedEvent()` | `event.postingMode !== 'NONE'` | Journal + lines created; wallet balances projected |

## Flow

1. **Caller invokes `AccountingEventExecutionService.execute(request, tx?)`** with:
   ```
   entityType         — e.g. 'WITHDRAW', 'INTERNAL_TX'
   triggerKey         — e.g. 'status'
   fromStatus         — optional previous status (nullable wildcard match)
   toStatus           — target status (e.g. 'CREATED', 'APPROVED')
   assetType          — 'FIAT' | 'CRYPTO' | 'ALL'
   sourceId           — entity primary key
   frozenContext      — JSON snapshot of the entity (built by caller at event time)
   journalSourceType  — source type label for journal record (e.g. 'WITHDRAW')
   clearingSourceType — source type label for clearing record (e.g. 'WITHDRAWAL')
   ```

2. **Event resolution** — queries `acctEvent` table:
   - Filters: `entityType`, `triggerType=STATUS_TRANSITION`, `triggerKey`, `isActive=true`, `toStatus`, `assetType IN [assetType, 'ALL']`.
   - `fromStatus`: matches either the provided value OR null (null = wildcard, matches any from-status).
   - If no match: logs warning, returns `{ eventCode: null, matchedEvent: null, journalResult: null, clearingResult: null }`. This is a **soft-fail** — callers are not interrupted.

3. **Check posting and clearing modes**:
   - `requiresPosting = event.postingMode !== 'NONE'`
   - `requiresClearing = event.clearingMode === 'TEMPLATE'`

4. **Idempotency check** (only when both are required): queries for existing journal (`sourceType, sourceId, eventCode`) and existing clearing (`sourceType, sourceId, clearingType=eventCode`) in parallel. If both already exist: return them. If exactly one exists: throw `PARTIAL_EVENT_EXECUTION` (data integrity guard).

5. **Execute clearing** (if required) via `ClearingsService.executeResolvedEvent()`:
   - Looks up `clearingTemplate` by `event.clearingTemplateCode` (hard error if not found).
   - Resolves all amount/asset fields using `evalDecimal(expr, context, field)` — path-walks the `frozenContext` using dot-notation (e.g. `src.amount`, `source.feeAmount`).
   - Creates `clearing` record (status always `CLEARED`) and `clearingLine` records per template line.
   - If clearing template not found: throws `CLEARING_TEMPLATE_EVAL_FAILED`.

6. **Execute journal** (if required) via `JournalsService.executeResolvedEvent()`:
   - Dispatches to `createJournal`, `reverseJournal` (postingMode=`AUTO_REVERSAL`), or `reverseAllBySource` (postingMode=`BULK_REVERSAL_BY_SOURCE`).
   - **Template lookup**: `journalHeaderTemplate.findFirst({ where: { eventCode, status: 'ACTIVE' } })`. If not found: throws `NotFoundException` (hard error).
   - **Per line — amount resolution** (`amountSource` field):
     - `AMOUNT` → `context.src.amount`
     - `NET_AMOUNT` → `context.src.netAmount`
     - `FROM_AMOUNT` → `context.src.fromAmount`
     - `TO_AMOUNT` → `context.src.toAmount`
     - `FEE_AMOUNT` → `context.src.feeAmount`
   - **Per line — asset resolution** (`assetSource` field):
     - default/blank → `context.src.assetId`
     - `FROM_ASSET_ID` → `context.src.fromAssetId`
     - `TO_ASSET_ID` → `context.src.toAssetId`
     - `FEE_ASSET_ID` → `context.src.feeAssetId`
   - **Per line — owner resolution** (`ownerTypeSource`, `ownerIdSource` fields): resolved via `resolveTemplateValue(source, context)`:
     - `FIXED_<VALUE>` prefix → literal value (e.g., `FIXED_CUSTOMER` → `"CUSTOMER"`)
     - dot-path (e.g., `src.ownerId`) → walks context object
     - root key (e.g., `src`) → `context.src`
     - plain literal (no dots, no prefix) → returned as-is (backward compat)
   - **Wallet ID**: extracted from `dimensionsRule` JSON field `{"walletId": "..."}` after template string interpolation (`{{src.walletId}}`-style).
   - **Balance assertion**: DR sum must equal CR sum per assetId across all lines; negative amounts are rejected.
   - **walletId enforcement**: for sourceTypes `DEPOSIT`, `WITHDRAW`, `WITHDRAWAL`, `INTERNAL_TX` — all asset account lines (code starts with `A.`) must have a non-null walletId.
   - **Wallet balance projection**: for asset account lines with walletId — maps accountCode to bucket (AVAILABLE: `A.CUSTODY`/`A.BANK`; RESTRICTED: `A.CUSTODY_RESTRICTED`/`A.BANK_RESTRICTED`; IN_TRANSIT: `A.CUSTODY_IN_TRANSIT`/`A.BANK_IN_TRANSIT`); checks no bucket goes negative; upserts `walletBalanceSnapshot` and creates `walletBalanceEntry`.

7. **Transaction handling**: if the caller passes a `tx` (Prisma.TransactionClient), all operations run within the caller's transaction. If no `tx` is provided, the service opens its own `$transaction`.

## frozenContext Shape

The `frozenContext` is a plain JSON snapshot built by each caller at event time. JournalsService accesses it under the `src` namespace:

```json
{
  "src": {
    "amount":      "<decimal string>",
    "netAmount":   "<decimal string>",
    "fromAmount":  "<decimal string>",
    "toAmount":    "<decimal string>",
    "feeAmount":   "<decimal string>",
    "assetId":     "<uuid>",
    "fromAssetId": "<uuid>",
    "toAssetId":   "<uuid>",
    "feeAssetId":  "<uuid>",
    "ownerId":     "<uuid>",
    "ownerType":   "CUSTOMER | PLATFORM",
    "walletId":    "<uuid>",
    "depositNo":   "<string>",
    ...other entity fields
  }
}
```

ClearingsService accesses fields using the same path convention (`source.X` is normalized to `src.X`).

## Key Rules

- **No matching AcctEvent = soft-fail**: a warning is logged, the caller continues. This is by design for optional accounting coverage.
- **Missing journal template = hard-fail**: `NotFoundException` thrown; the transaction is aborted. Callers must ensure templates are published before triggering events.
- **Missing clearing template = hard-fail**: `BadRequestException` with code `CLEARING_TEMPLATE_EVAL_FAILED`; transaction aborted.
- **Partial execution = hard-fail**: if journal exists but clearing does not (or vice versa) for the same source, `PARTIAL_EVENT_EXECUTION` is thrown to prevent data inconsistency.
- **Clearing always executes before journal** within `execute()` (order: clearing → journal); this means clearing is available as a reference when the journal is written.
- **Idempotency**: both JournalsService and ClearingsService individually check for existing records before creating (safe to call multiple times for the same sourceId + eventCode).
- **Journal balance is enforced at runtime** by asset: `Σ DR = Σ CR` per assetId; imbalanced entries throw `JOURNAL_IMBALANCED`.
- **Wallet balance cannot go negative**: attempted debit that would result in a negative bucket balance throws `INSUFFICIENT_WALLET_BALANCE`.
- `AccountingEventExecutionService` is **only used** by `WithdrawWorkflowOrchestrator` and `InternalCollectionWorkflowOrchestrator`. `DepositWorkflowService` calls `JournalsService.triggerEvent()` directly (no clearing through this service).
- All journal entries use `postingStatus = 'POSTED'` (set on creation; no draft/pending journal state).

## API Endpoints

This service has no HTTP endpoints. It is invoked exclusively by in-process orchestrators via NestJS dependency injection.

For observability, journal and clearing records produced by this service are readable via:

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/accounting/journals` | List journals (filterable by sourceType, eventCode, postingStatus) |
| `GET` | `/admin/accounting/journals/:id` | Journal detail with lines |
| `GET` | `/admin/clearing-settle/clearings` | List clearings (filterable by sourceId, clearingStatus) |

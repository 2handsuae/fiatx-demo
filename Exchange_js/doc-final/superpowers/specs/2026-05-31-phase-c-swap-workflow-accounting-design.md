# Phase C: Swap Transaction Workflow — TigerBeetle Accounting Integration

## Overview

Wire TigerBeetle double-entry accounting into the swap transaction lifecycle. On creation, lock the customer's from-asset balance via a pending transfer. On SUCCESS, post the pending + credit the to-asset + record fee. On REJECT/FAIL, void the pending to release the lock.

All legs go to TRADE_CLEARING regardless of asset type (crypto/fiat). Settlement of TRADE_CLEARING → CUSTODY/BANK is handled by the Outstanding settlement pipeline (out of scope for Phase C).

**Scope:** Schema migration (1), TB constants (1), orchestrator accounting (1), workflow service accounting (1), module wiring (1). Total 5 files.

---

## 1. Design Principles

- **Swap only touches CLIENT_CREDIT ↔ TRADE_CLEARING** — no CUSTODY/BANK branching
- **No asset-type branching in swap code** — crypto vs fiat is a settlement concern, not a swap concern
- **Pending transfer = implicit balance check** — if `executePendingTransfer` fails, creation fails with "Insufficient balance"
- **Outstanding drives settlement** — already created by `outstandingsService.createForSwapSuccess()`, settlement pipeline resolves TRADE_CLEARING → CUSTODY/BANK independently
- **Compensation pattern** — if Prisma tx rolls back after TB pending write, `voidPendingTransferBestEffort` releases the lock

---

## 2. Schema Migration

Add TB fields to `SwapTransaction`:

```prisma
model SwapTransaction {
  // ... existing fields ...
  tbPendingFromId   String?    // hex TB pending transfer ID for from-asset lock
  traceId           String?    // audit trace ID for TB evidence
}
```

Only `tbPendingFromId` is needed — the to-side and fee transfers are posted (non-pending) on SUCCESS, so no IDs to store.

---

## 3. TB_TRANSFER_CODES

New codes in `tb-transfer-codes.constant.ts`:

```typescript
// Swap: from-asset pending lock (30–32)
SWAP_CREDIT_TO_CLEARING_PENDING: 30,   // CLIENT_CREDIT → TRADE_CLEARING (lock)
SWAP_CREDIT_TO_CLEARING_POST: 31,      // post the pending (confirm lock)
SWAP_CREDIT_TO_CLEARING_VOID: 32,      // void the pending (release lock)

// Swap: to-asset credit + fee (33–34)
SWAP_CLEARING_TO_CREDIT: 33,           // TRADE_CLEARING → CLIENT_CREDIT (credit customer)
SWAP_CLEARING_TO_FEE: 34,              // TRADE_CLEARING → FEE_RECEIVABLE (collect fee)
```

---

## 4. Accounting Flow

### 4.1 On CREATE — Lock from-asset (in `swap-workflow.orchestrator.ts`)

Inside the existing `prisma.$transaction` in `createSwapFromQuote()`:

```
1. Resolve TB account IDs:
   - clientCreditId = resolveTbAccountId({ code: CLIENT_CREDIT, ledger: fromAssetLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId })
   - tradeClearingId = resolveTbAccountId({ code: TRADE_CLEARING, ledger: fromAssetLedger, ownerType: 'SYSTEM' })

2. Convert fromAmount to bigint (using asset decimals)

3. executePendingTransfer({
     debitAccountId: clientCreditId,
     creditAccountId: tradeClearingId,
     amount: fromAmountBigint,
     ledger: fromAssetLedger,
     code: SWAP_CREDIT_TO_CLEARING_PENDING,
     timeout: 0,
     evidence: {
       sourceType: 'SWAP',
       sourceNo: swapNo,
       eventCode: 'SWAP_LOCK_FROM',
       debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
       creditCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
       assetCurrency: fromAssetCode,
       traceId,
       actorType: 'CUSTOMER',
       actorId: ownerId,
       memo: 'Swap pending lock: from-asset amount',
     },
     tx,
   })
   → returns { tbTransferId }

4. Store tbPendingFromId = bigintToHex(tbTransferId) on SwapTransaction
```

**Compensation:** If Prisma tx rolls back after TB write:
```typescript
catch (error) {
  if (tbPendingFromBigint) {
    await this.accountingService.voidPendingTransferBestEffort(tbPendingFromBigint, fromAmountBigint);
  }
  throw error;
}
```

### 4.2 On SUCCESS — Post + Credit + Fee (in `swap-transaction-workflow.service.ts`)

In `executeWithClient()`, when `nextStatus === SUCCESS`:

```
1. Post from-side pending:
   postPendingTransfer({
     pendingTransferId: hexToBigint(swap.tbPendingFromId),
     amount: fromAmountBigint,
     evidence: { eventCode: 'SWAP_POST_FROM', ... },
   })

2. Credit to-asset to customer (posted transfer, not pending):
   - Resolve: tradeClearingToId (TRADE_CLEARING, toAsset ledger, SYSTEM)
   - Resolve: clientCreditToId (CLIENT_CREDIT, toAsset ledger, CUSTOMER, ownerId)
   executeTransfer({
     debitAccountId: tradeClearingToId,
     creditAccountId: clientCreditToId,
     amount: netToAmountBigint,
     ledger: toAssetLedger,
     code: SWAP_CLEARING_TO_CREDIT,
     evidence: { eventCode: 'SWAP_CREDIT_TO', ... },
   })

3. Record fee (only if feeAmount > 0):
   - Resolve: feeReceivableId (FEE_RECEIVABLE, toAsset ledger, SYSTEM)
   executeTransfer({
     debitAccountId: tradeClearingToId,
     creditAccountId: feeReceivableId,
     amount: feeAmountBigint,
     ledger: toAssetLedger,
     code: SWAP_CLEARING_TO_FEE,
     evidence: { eventCode: 'SWAP_FEE', ... },
   })
```

### 4.3 On REJECT/FAIL — Void from-side lock

In `executeWithClient()`, when `nextStatus === REJECTED || FAILED`:

```
if (swap.tbPendingFromId) {
  voidPendingTransfer({
    pendingTransferId: hexToBigint(swap.tbPendingFromId),
    amount: fromAmountBigint,
    evidence: { eventCode: 'SWAP_VOID_FROM', ... },
  })
}
```

---

## 5. Ledger Resolution

Use `TB_LEDGERS` to map asset currency → ledger number:

```typescript
const fromAssetLedger = TB_LEDGERS[fromAssetCode]; // e.g., TB_LEDGERS.USDT = 2
const toAssetLedger = TB_LEDGERS[toAssetCode];     // e.g., TB_LEDGERS.AED = 1
```

If ledger not found, throw `BadRequestException('Unsupported asset currency for TB accounting')`.

---

## 6. Module Wiring

`swap-transactions.module.ts`:
- Add `TigerBeetleModule` to imports

`swap-workflow.orchestrator.ts`:
- Inject `AccountingService`

`swap-transaction-workflow.service.ts`:
- `AccountingService` already NOT injected — add it

---

## 7. Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `tbPendingFromId`, `traceId` to SwapTransaction |
| `prisma/migrations/YYYYMMDD_swap_tb_fields/migration.sql` | Migration |
| `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` | Add 5 swap codes |
| `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts` | Lock from-asset on create + compensation |
| `src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts` | Post/credit/fee on SUCCESS; void on REJECT/FAIL |
| `src/modules/trading/swap-transactions/swap-transactions.module.ts` | Add TigerBeetleModule import |

## 8. What Is NOT Changing

- SwapQuoteService — done in Phase B
- Outstanding creation — already works via `createForSwapSuccess()`
- Outstanding → CUSTODY/BANK settlement — separate pipeline, out of scope
- Status machine — same states, same transitions
- Compliance flow — unchanged
- Admin pages — unchanged
- Customer API contract — unchanged

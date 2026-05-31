# Phase C: Swap Transaction TigerBeetle Accounting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire TigerBeetle double-entry accounting into the swap transaction lifecycle — lock customer's from-asset balance on creation, post + credit on SUCCESS, void on REJECT/FAIL. All legs go to TRADE_CLEARING regardless of asset type.

**Architecture:** Follow withdrawal's pending transfer pattern. On create, `executePendingTransfer` locks from-amount (CLIENT_CREDIT → TRADE_CLEARING). This doubles as the balance check. On SUCCESS, `postPendingTransfer` confirms the lock + `executeTransfer` credits to-asset to customer + records fee. On REJECT/FAIL, `voidPendingTransfer` releases the lock. Compensation pattern handles Prisma rollback after TB write.

**Tech Stack:** NestJS, Prisma, TigerBeetle, SQLite

---

### Task 1: Schema Migration — Add TB Fields to SwapTransaction

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to SwapTransaction model**

In `prisma/schema.prisma`, find the SwapTransaction model. After the `statusHistory` field, add:

```prisma
  tbPendingFromId  String?
  traceId          String?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name swap_tb_accounting_fields
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add tbPendingFromId and traceId fields to SwapTransaction"
```

---

### Task 2: Add Swap TB Transfer Codes

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [ ] **Step 1: Add swap transfer codes**

In `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`, add after the fiat withdrawal codes:

```typescript
  // Swap: from-asset pending lock (30–32)
  SWAP_CREDIT_TO_CLEARING_PENDING: 30,
  SWAP_CREDIT_TO_CLEARING_POST: 31,
  SWAP_CREDIT_TO_CLEARING_VOID: 32,

  // Swap: to-asset credit + fee (33–34)
  SWAP_CLEARING_TO_CREDIT: 33,
  SWAP_CLEARING_TO_FEE: 34,
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat: add swap TigerBeetle transfer codes (30–34)"
```

---

### Task 3: Module Wiring — Add TigerBeetleModule to SwapTransactionsModule

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts`

- [ ] **Step 1: Add TigerBeetleModule import**

In `src/modules/trading/swap-transactions/swap-transactions.module.ts`:

Add import at top:
```typescript
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
```

Add `TigerBeetleModule` to the imports array:
```typescript
  imports: [
    PrismaModule,
    OnboardingModule,
    PricingCenterModule,
    forwardRef(() => SwapFeeLevelModule),
    OutstandingsModule,
    TransactionComplianceModule,
    TigerBeetleModule,
  ],
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions.module.ts
git commit -m "feat: add TigerBeetleModule to SwapTransactionsModule"
```

---

### Task 4: Orchestrator — Lock From-Asset on Create

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts`

This is the core accounting task. Add `AccountingService` injection and wire `executePendingTransfer` into `createSwapFromQuote()`.

- [ ] **Step 1: Add imports and injection**

Add imports at top of `swap-workflow.orchestrator.ts`:

```typescript
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
```

Add to constructor:
```typescript
private readonly accountingService: AccountingService,
```

Add private helper:
```typescript
private decimalToBigint(decimalValue: any, decimals: number): bigint {
  const str = String(decimalValue);
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac);
}
```

- [ ] **Step 2: Wire accounting into createSwapFromQuote**

In `createSwapFromQuote()`, inside the `$transaction` callback, replace the TODO comments:

```typescript
// V2 balance check removed — migrated to TigerBeetle
// TODO: re-wire balance guard via TigerBeetle adapter
```

With the TB pending transfer logic. The full replacement block (insert AFTER `const swapNo = ...` and BEFORE `await this.swapQuoteService.consumeQuote(...)`):

```typescript
      const traceId = `SWAP:${swapNo}`;
      const fromAssetCode = quote.fromAssetCode;
      const fromAssetDecimals = transaction?.fromAsset?.decimals ?? 8; // Will be set after create — see below

      // We need asset decimals before creating the record. Fetch asset.
      const fromAssetRecord = await tx.asset.findUnique({ where: { id: quote.fromAssetId }, select: { decimals: true, currency: true } });
      const fromDecimals = fromAssetRecord?.decimals ?? 8;
      const fromCurrency = fromAssetRecord?.currency || fromAssetCode;
      const fromLedger = TB_LEDGERS[fromCurrency as keyof typeof TB_LEDGERS];
      if (!fromLedger) {
        throw new BadRequestException(`Unsupported asset currency for TB accounting: ${fromCurrency}`);
      }

      const fromAmountBigint = this.decimalToBigint(fromAmount, fromDecimals);
      let tbPendingFromBigint: bigint | undefined;
      let tbPendingFromAmountBigint: bigint | undefined;

      if (fromAmountBigint > 0n) {
        const clientCreditId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
          ledger: fromLedger,
          ownerType: 'CUSTOMER',
          ownerUuid: ownerId,
        });

        const tradeClearingId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING,
          ledger: fromLedger,
          ownerType: 'SYSTEM',
        });

        const pendingResult = await this.accountingService.executePendingTransfer({
          debitAccountId: clientCreditId,
          creditAccountId: tradeClearingId,
          amount: fromAmountBigint,
          ledger: fromLedger,
          code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_PENDING,
          timeout: 0,
          evidence: {
            sourceType: 'SWAP',
            sourceNo: swapNo,
            eventCode: 'SWAP_LOCK_FROM',
            debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
            creditCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
            assetCurrency: fromCurrency,
            traceId,
            actorType: 'CUSTOMER',
            actorId: ownerId,
            memo: 'Swap pending lock: from-asset amount',
          },
          tx,
        });

        tbPendingFromBigint = pendingResult.tbTransferId;
        tbPendingFromAmountBigint = fromAmountBigint;
      }
```

Then modify the `tx.swapTransaction.create` call to include the new fields:

Add to the `data` object:
```typescript
          tbPendingFromId: tbPendingFromBigint ? bigintToHex(tbPendingFromBigint) : null,
          traceId,
```

- [ ] **Step 3: Add compensation pattern**

Wrap the entire `$transaction` callback body in a try/catch for TB compensation. The pattern: if Prisma rolls back but TB pending already wrote, void the pending.

After the `this.prisma.$transaction(async (tx) => { ... })` call, add compensation in the catch:

```typescript
    let tbPendingFromForCompensation: bigint | undefined;
    let tbPendingFromAmountForCompensation: bigint | undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      // ... existing code ...
      // After executePendingTransfer, store for compensation:
      // tbPendingFromForCompensation = tbPendingFromBigint;
      // tbPendingFromAmountForCompensation = tbPendingFromAmountBigint;
      // ... rest of transaction ...
    }).catch(async (error) => {
      if (tbPendingFromForCompensation && tbPendingFromAmountForCompensation) {
        this.logger.warn(`Prisma tx rolled back, voiding TB pending from-lock for swap`);
        await this.accountingService.voidPendingTransferBestEffort(
          tbPendingFromForCompensation,
          tbPendingFromAmountForCompensation,
        );
      }
      throw error;
    });
```

Note: The compensation variables need to be set inside the transaction but accessible in the catch. Declare them before `$transaction` and assign inside.

- [ ] **Step 4: Remove old TODO comments**

Delete these lines:
```typescript
      // V2 balance check removed — migrated to TigerBeetle
      // TODO: re-wire balance guard via TigerBeetle adapter
```
and:
```typescript
      // V2 accounting removed — migrated to TigerBeetle
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts
git commit -m "feat: lock from-asset balance via TigerBeetle pending transfer on swap creation"
```

---

### Task 5: Workflow Service — Post/Credit/Fee on SUCCESS, Void on REJECT/FAIL

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts`

- [ ] **Step 1: Add imports and injection**

Add imports at top:

```typescript
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
```

Add to constructor:
```typescript
private readonly accountingService: AccountingService,
```

Add private helper (same as orchestrator):
```typescript
private decimalToBigint(decimalValue: any, decimals: number): bigint {
  const str = String(decimalValue);
  const [whole, frac = ''] = str.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac);
}
```

- [ ] **Step 2: Add accounting on SUCCESS**

In `executeWithClient()`, find the block:

```typescript
    // V2 accounting removed — migrated to TigerBeetle

    if (nextStatus === SwapTransactionStatus.SUCCESS) {
      await this.outstandingsService.createForSwapSuccess(tx, updated);
```

Replace the `// V2 accounting removed` comment and add TB accounting BEFORE the outstandings call:

```typescript
    // TigerBeetle accounting
    if (nextStatus === SwapTransactionStatus.SUCCESS) {
      await this.executeSwapSuccessAccounting(tx, swap, updated);
      await this.outstandingsService.createForSwapSuccess(tx, updated);
```

Add the private method:

```typescript
  private async executeSwapSuccessAccounting(
    tx: Prisma.TransactionClient,
    swap: any,
    updated: any,
  ) {
    // Step 1: Post from-side pending transfer
    if (swap.tbPendingFromId) {
      const fromAsset = await tx.asset.findUnique({ where: { id: swap.fromAssetId }, select: { decimals: true, currency: true } });
      const fromDecimals = fromAsset?.decimals ?? 8;
      const fromCurrency = fromAsset?.currency || swap.fromAssetCode || '';
      const fromAmountBigint = this.decimalToBigint(swap.fromAmount, fromDecimals);
      const traceId = swap.traceId || `SWAP:${swap.id}`;

      await this.accountingService.postPendingTransfer({
        pendingTransferId: hexToBigint(swap.tbPendingFromId),
        amount: fromAmountBigint,
        evidence: {
          sourceType: 'SWAP',
          sourceNo: swap.swapNo || swap.id,
          eventCode: 'SWAP_POST_FROM',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          creditCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
          assetCurrency: fromCurrency,
          traceId,
          actorType: 'SYSTEM',
          actorId: 'SWAP_WORKFLOW',
          memo: 'Swap confirmed: POST from-asset pending transfer',
        },
        tx,
      });
    }

    // Step 2: Credit to-asset to customer (posted transfer)
    const toAsset = await tx.asset.findUnique({ where: { id: swap.toAssetId }, select: { decimals: true, currency: true } });
    const toDecimals = toAsset?.decimals ?? 8;
    const toCurrency = toAsset?.currency || swap.toAssetCode || '';
    const toLedger = TB_LEDGERS[toCurrency as keyof typeof TB_LEDGERS];

    if (toLedger) {
      const netToAmount = swap.netToAmount ?? swap.toAmount;
      const netToAmountBigint = this.decimalToBigint(netToAmount, toDecimals);
      const traceId = swap.traceId || `SWAP:${swap.id}`;

      if (netToAmountBigint > 0n) {
        const tradeClearingToId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING,
          ledger: toLedger,
          ownerType: 'SYSTEM',
        });

        const clientCreditToId = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
          ledger: toLedger,
          ownerType: 'CUSTOMER',
          ownerUuid: swap.ownerId,
        });

        await this.accountingService.executeTransfer({
          debitAccountId: tradeClearingToId,
          creditAccountId: clientCreditToId,
          amount: netToAmountBigint,
          ledger: toLedger,
          code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_CREDIT,
          evidence: {
            sourceType: 'SWAP',
            sourceNo: swap.swapNo || swap.id,
            eventCode: 'SWAP_CREDIT_TO',
            debitCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
            creditCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
            assetCurrency: toCurrency,
            traceId,
            actorType: 'SYSTEM',
            actorId: 'SWAP_WORKFLOW',
            memo: 'Swap confirmed: credit to-asset to customer',
          },
          tx,
        });

        // Step 3: Record fee (only if > 0)
        const feeAmount = swap.feeAmount ?? 0;
        const feeAmountBigint = this.decimalToBigint(feeAmount, toDecimals);

        if (feeAmountBigint > 0n) {
          const feeReceivableId = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
            ledger: toLedger,
            ownerType: 'SYSTEM',
          });

          await this.accountingService.executeTransfer({
            debitAccountId: tradeClearingToId,
            creditAccountId: feeReceivableId,
            amount: feeAmountBigint,
            ledger: toLedger,
            code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_FEE,
            evidence: {
              sourceType: 'SWAP',
              sourceNo: swap.swapNo || swap.id,
              eventCode: 'SWAP_FEE',
              debitCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
              creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE),
              assetCurrency: toCurrency,
              traceId,
              actorType: 'SYSTEM',
              actorId: 'SWAP_WORKFLOW',
              memo: 'Swap confirmed: fee to receivable',
            },
            tx,
          });
        }
      }
    } else {
      this.logger.warn(`Unsupported to-asset currency for TB accounting: ${toCurrency}, skipping to-side entries`);
    }
  }
```

- [ ] **Step 3: Add void on REJECT/FAIL**

In `executeWithClient()`, find the REJECT/FAIL block:

```typescript
    } else if (
      nextStatus === SwapTransactionStatus.REJECTED ||
      nextStatus === SwapTransactionStatus.FAILED
    ) {
      await (tx as any).outstanding.deleteMany({
        where: {
          sourceType: 'SWAP',
          sourceId: updated.id,
        },
      });
    }
```

Add TB void BEFORE the outstanding deleteMany:

```typescript
    } else if (
      nextStatus === SwapTransactionStatus.REJECTED ||
      nextStatus === SwapTransactionStatus.FAILED
    ) {
      // Void from-side pending transfer (release customer balance lock)
      if (swap.tbPendingFromId) {
        try {
          const fromAsset = await tx.asset.findUnique({ where: { id: swap.fromAssetId }, select: { decimals: true, currency: true } });
          const fromDecimals = fromAsset?.decimals ?? 8;
          const fromCurrency = fromAsset?.currency || swap.fromAssetCode || '';
          const fromAmountBigint = this.decimalToBigint(swap.fromAmount, fromDecimals);
          const traceId = swap.traceId || `SWAP:${swap.id}`;

          await this.accountingService.voidPendingTransfer({
            pendingTransferId: hexToBigint(swap.tbPendingFromId),
            amount: fromAmountBigint,
            evidence: {
              sourceType: 'SWAP',
              sourceNo: swap.swapNo || swap.id,
              eventCode: 'SWAP_VOID_FROM',
              debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
              creditCode: String(TB_ACCOUNT_CODES.TRADE_CLEARING),
              assetCurrency: fromCurrency,
              traceId,
              actorType: 'SYSTEM',
              actorId: 'SWAP_WORKFLOW',
              memo: `Swap ${nextStatus.toLowerCase()}: void from-asset pending transfer`,
            },
            tx,
          });
        } catch (voidError) {
          this.logger.error(`Failed to void TB pending from-lock for swap ${swap.id}`, voidError);
        }
      }

      await (tx as any).outstanding.deleteMany({
```

- [ ] **Step 4: Update getSwap select to include new fields**

In the `getSwap()` private method, add `tbPendingFromId` and `traceId` to the select:

Find:
```typescript
        statusHistory: true,
```

Add after:
```typescript
        tbPendingFromId: true,
        traceId: true,
```

- [ ] **Step 5: Remove old TODO comment**

Delete:
```typescript
    // V2 accounting removed — migrated to TigerBeetle
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts
git commit -m "feat: wire TigerBeetle post/credit/fee on SUCCESS and void on REJECT/FAIL for swap"
```

---

### Task 6: End-to-End Verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Verify backend build compiles clean**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 2: Verify all new fields exist in schema**

Run: `grep "tbPendingFromId\|traceId" prisma/schema.prisma | head -5`
Expected: Shows both fields on SwapTransaction.

- [ ] **Step 3: Verify TB transfer codes exist**

Run: `grep "SWAP_" src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
Expected: Shows all 5 swap codes (30–34).

- [ ] **Step 4: Verify AccountingService is injected in both files**

Run:
```bash
grep "accountingService" src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts | head -2
grep "accountingService" src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts | head -2
```
Expected: Shows constructor injection in both.

- [ ] **Step 5: Verify TigerBeetleModule is in SwapTransactionsModule**

Run: `grep "TigerBeetleModule" src/modules/trading/swap-transactions/swap-transactions.module.ts`
Expected: Shows import.

- [ ] **Step 6: Verify no TODO/V2 comments remain**

Run: `grep -n "V2 accounting\|V2 balance\|TODO.*TigerBeetle\|TODO.*balance" src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts`
Expected: Zero results.

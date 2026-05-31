# Phase C (Redesign): Swap Transaction Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the swap transaction flow as a synchronous, atomic, eligibility-gated operation conforming to the three-layer backend architecture — L1 `SwapTransactionsService.create()` + L3 `SwapWorkflowService.executeSwap()` — with TigerBeetle accounting (all legs to TRADE_CLEARING). Delete the legacy orchestrator, state-machine workflow, and risk-bridge swap compliance path.

**Architecture:** A swap is internal balance exchange — no external transaction, so the only compliance gate is synchronous L1 eligibility (`assertTradingEligibility`). The L3 workflow runs everything in one Prisma transaction: consume quote → TB pending transfers → L1 create (SUCCESS) → Outstanding → TB post → audit. On any failure, void pending transfers and roll back; no swap record persists. A persisted swap is always SUCCESS.

**Tech Stack:** NestJS, Prisma, TigerBeetle, SQLite

**Sequencing principle:** additive tasks first (schema, codes, L1 method, new L3 service), then rewiring (controllers, module), then removals (cross-module swap compliance, legacy files), then cleanup (enums). Build stays green at every commit.

---

### Task 1: Schema — Add TB Ref Fields to SwapTransaction

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to SwapTransaction model**

In `prisma/schema.prisma`, find the `model SwapTransaction {` block. After the `statusHistory String?` line, add:

```prisma
  tbFromTransferId String?
  tbToTransferId   String?
  tbFeeTransferId  String?
  traceId          String?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name swap_tb_transfer_refs
```
Expected: Migration created and applied; Prisma Client regenerated.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add TB transfer ref fields and traceId to SwapTransaction"
```

---

### Task 2: Add Swap TB Transfer Codes

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [ ] **Step 1: Add swap transfer codes**

In `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`, inside the `TB_TRANSFER_CODES` object, after the fiat withdrawal codes (`WITHDRAW_CREDIT_TO_BANK_VOID: 22,`) add:

```typescript

  // Swap: from-leg lock + to-leg credit + fee (30–34)
  SWAP_CREDIT_TO_CLEARING_PENDING: 30,
  SWAP_CREDIT_TO_CLEARING_POST: 31,
  SWAP_CREDIT_TO_CLEARING_VOID: 32,
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

### Task 3: L1 Domain — Add `create()` to SwapTransactionsService

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`

The domain service currently has only reads + pricing. Add a `create()` method that persists a swap entity with status SUCCESS. It accepts a `tx` so the L3 workflow can compose it atomically. NO audit logs here.

- [ ] **Step 1: Add the create method**

In `src/modules/trading/swap-transactions/swap-transactions.service.ts`, add this method inside the `SwapTransactionsService` class (e.g., after `findOne`):

```typescript
  async create(
    input: {
      swapNo: string;
      quoteId: string;
      quoteNo: string | null;
      ownerType: string;
      ownerId: string;
      ownerNo: string | null;
      fromAssetId: string;
      fromAssetCode: string | null;
      fromAmount: Prisma.Decimal;
      toAssetId: string;
      toAssetCode: string | null;
      toAmount: Prisma.Decimal;
      netToAmount: Prisma.Decimal;
      feeAmount: Prisma.Decimal;
      feeCurrency: string | null;
      feeBreakdown: string | null;
      exchangeRate: Prisma.Decimal;
      tbFromTransferId: string | null;
      tbToTransferId: string | null;
      tbFeeTransferId: string | null;
      traceId: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.swapTransaction.create({
      data: {
        swapNo: input.swapNo,
        quoteId: input.quoteId,
        quoteNo: input.quoteNo,
        quoteSnapshotRef: input.quoteId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo,
        status: 'SUCCESS',
        fromAssetId: input.fromAssetId,
        fromAssetCode: input.fromAssetCode,
        fromAmount: input.fromAmount,
        toAssetId: input.toAssetId,
        toAssetCode: input.toAssetCode,
        toAmount: input.toAmount,
        netToAmount: input.netToAmount,
        feeAmount: input.feeAmount,
        feeCurrency: input.feeCurrency,
        feeBreakdown: input.feeBreakdown,
        exchangeRate: input.exchangeRate,
        tbFromTransferId: input.tbFromTransferId,
        tbToTransferId: input.tbToTransferId,
        tbFeeTransferId: input.tbFeeTransferId,
        traceId: input.traceId,
        completedAt: new Date(),
        statusHistory: JSON.stringify([
          {
            status: 'SUCCESS',
            timestamp: new Date().toISOString(),
            operator: input.ownerId,
            source: 'CUSTOMER',
            note: `Swap executed from quote ${input.quoteNo || input.quoteId}`,
          },
        ]),
      },
      include: { fromAsset: true, toAsset: true },
    });
  }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions.service.ts
git commit -m "feat: add L1 create() to SwapTransactionsService"
```

---

### Task 4: L3 Workflow — New SwapWorkflowService

**Files:**
- Create: `src/modules/trading/swap-transactions/swap-workflow.service.ts`

This is the core task. A single synchronous journey method `executeSwap`.

- [ ] **Step 1: Create the workflow service**

Create `src/modules/trading/swap-transactions/swap-workflow.service.ts`:

```typescript
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { OutstandingsService } from '../../clearing-settle/outstandings/outstandings.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { SwapTransactionsService } from './swap-transactions.service';

interface PendingRef {
  id: bigint;
  amount: bigint;
}

@Injectable()
export class SwapWorkflowService {
  private readonly logger = new Logger(SwapWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly outstandingsService: OutstandingsService,
    private readonly accountingService: AccountingService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private decimalToBigint(decimalValue: Prisma.Decimal | string | number, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  private resolveLedger(currency: string): number {
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new BadRequestException(`Unsupported asset currency for TB accounting: ${currency}`);
    }
    return ledger;
  }

  async executeSwap(ownerId: string, quoteId: string) {
    // ── L1 Eligibility gate (synchronous) ──
    const customer = await this.prisma.customerMain.findUnique({ where: { id: ownerId } });
    ensureCustomerCanTransact(customer);
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');

    const now = new Date();
    const swapNo = generateReferenceNo('SWP');
    const traceId = `SWAP:${swapNo}`;

    // Track pending transfers for compensation
    const created: PendingRef[] = [];

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Validate + consume quote
        const quote = await this.swapQuoteService.getActiveQuoteOrThrow(quoteId, 'CUSTOMER', ownerId, now, tx);
        const fromAmount = new Prisma.Decimal(quote.amountIn);
        const toAmount = new Prisma.Decimal(quote.amountOut);
        const totals = this.parseTotals(quote.totalsJson);
        const netToAmount = new Prisma.Decimal(totals.amountOutNet || quote.amountOut.toString());
        const feeAmount = new Prisma.Decimal(quote.feeTotal || 0);
        const rate = new Prisma.Decimal(quote.rateAllIn);

        await this.swapQuoteService.consumeQuote(quoteId, 'CUSTOMER', ownerId, fromAmount, tx);

        // 2. Resolve assets for decimals + ledgers
        const [fromAsset, toAsset] = await Promise.all([
          tx.asset.findUnique({ where: { id: quote.fromAssetId }, select: { decimals: true, currency: true } }),
          tx.asset.findUnique({ where: { id: quote.toAssetId }, select: { decimals: true, currency: true } }),
        ]);
        const fromCurrency = fromAsset?.currency || quote.fromAssetCode || '';
        const toCurrency = toAsset?.currency || quote.toAssetCode || '';
        const fromDecimals = fromAsset?.decimals ?? 8;
        const toDecimals = toAsset?.decimals ?? 8;
        const fromLedger = this.resolveLedger(fromCurrency);
        const toLedger = this.resolveLedger(toCurrency);

        const fromAmountBigint = this.decimalToBigint(fromAmount, fromDecimals);
        const netToAmountBigint = this.decimalToBigint(netToAmount, toDecimals);
        const feeAmountBigint = this.decimalToBigint(feeAmount, toDecimals);

        // 3. Resolve TB account IDs
        const clientCreditFrom = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT, ledger: fromLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId,
        });
        const clearingFrom = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger: fromLedger, ownerType: 'SYSTEM',
        });
        const clearingTo = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger: toLedger, ownerType: 'SYSTEM',
        });
        const clientCreditTo = await this.accountingService.resolveTbAccountId({
          code: TB_ACCOUNT_CODES.CLIENT_CREDIT, ledger: toLedger, ownerType: 'CUSTOMER', ownerUuid: ownerId,
        });

        // 4. Pending transfers (voidable). from-leg lock is the implicit balance check.
        const fromPending = await this.accountingService.executePendingTransfer({
          debitAccountId: clientCreditFrom, creditAccountId: clearingFrom, amount: fromAmountBigint,
          ledger: fromLedger, code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_PENDING, timeout: 0,
          evidence: this.evidence(swapNo, 'SWAP_LOCK_FROM', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.TRADE_CLEARING, fromCurrency, traceId, ownerId, 'Swap pending lock: from-leg'),
          tx,
        });
        created.push({ id: fromPending.tbTransferId, amount: fromAmountBigint });

        const toPending = await this.accountingService.executePendingTransfer({
          debitAccountId: clearingTo, creditAccountId: clientCreditTo, amount: netToAmountBigint,
          ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_CREDIT, timeout: 0,
          evidence: this.evidence(swapNo, 'SWAP_CREDIT_TO', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.CLIENT_CREDIT, toCurrency, traceId, ownerId, 'Swap pending: to-leg credit'),
          tx,
        });
        created.push({ id: toPending.tbTransferId, amount: netToAmountBigint });

        let feeTransferIdHex: string | null = null;
        if (feeAmountBigint > 0n) {
          const feeReceivable = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.FEE_RECEIVABLE, ledger: toLedger, ownerType: 'SYSTEM',
          });
          const feePending = await this.accountingService.executePendingTransfer({
            debitAccountId: clearingTo, creditAccountId: feeReceivable, amount: feeAmountBigint,
            ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_FEE, timeout: 0,
            evidence: this.evidence(swapNo, 'SWAP_FEE', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.FEE_RECEIVABLE, toCurrency, traceId, ownerId, 'Swap pending: fee'),
            tx,
          });
          created.push({ id: feePending.tbTransferId, amount: feeAmountBigint });
          feeTransferIdHex = bigintToHex(feePending.tbTransferId);
        }

        // 5. Create swap entity (L1)
        const swap = await this.swapTransactionsService.create({
          swapNo, quoteId: quote.id, quoteNo: quote.quoteNo,
          ownerType: 'CUSTOMER', ownerId, ownerNo: quote.ownerNo,
          fromAssetId: quote.fromAssetId, fromAssetCode: quote.fromAssetCode, fromAmount,
          toAssetId: quote.toAssetId, toAssetCode: quote.toAssetCode, toAmount,
          netToAmount, feeAmount, feeCurrency: quote.feeCurrency || quote.toAssetCode,
          feeBreakdown: quote.feeBreakdown, exchangeRate: rate,
          tbFromTransferId: bigintToHex(fromPending.tbTransferId),
          tbToTransferId: bigintToHex(toPending.tbTransferId),
          tbFeeTransferId: feeTransferIdHex,
          traceId,
        }, tx);

        // 6. Outstanding (both legs)
        await this.outstandingsService.createForSwapSuccess(tx, {
          id: swap.id, swapNo: swap.swapNo, ownerType: swap.ownerType, ownerId: swap.ownerId, ownerNo: swap.ownerNo,
          status: 'SUCCESS', fromAssetId: swap.fromAssetId, fromAssetCurrency: swap.fromAssetCode, fromAmount,
          toAssetId: swap.toAssetId, toAssetCurrency: swap.toAssetCode, toAmount, netToAmount,
        });

        // 7. Post all pending transfers — customer balances settle now
        await this.accountingService.postPendingTransfer({
          pendingTransferId: fromPending.tbTransferId, amount: fromAmountBigint,
          evidence: this.evidence(swapNo, 'SWAP_POST_FROM', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.TRADE_CLEARING, fromCurrency, traceId, ownerId, 'Swap post: from-leg'),
          tx,
        });
        await this.accountingService.postPendingTransfer({
          pendingTransferId: toPending.tbTransferId, amount: netToAmountBigint,
          evidence: this.evidence(swapNo, 'SWAP_POST_TO', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.CLIENT_CREDIT, toCurrency, traceId, ownerId, 'Swap post: to-leg'),
          tx,
        });
        if (feeAmountBigint > 0n && feeTransferIdHex) {
          await this.accountingService.postPendingTransfer({
            pendingTransferId: created[2].id, amount: feeAmountBigint,
            evidence: this.evidence(swapNo, 'SWAP_POST_FEE', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.FEE_RECEIVABLE, toCurrency, traceId, ownerId, 'Swap post: fee'),
            tx,
          });
        }

        // 8. Business audit log
        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.SWAP_CREATED,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: swap.id,
            entityNo: swap.swapNo || undefined,
            traceId,
            workflowType: AuditWorkflowTypes.SWAP,
            entityOwnerType: swap.ownerType,
            entityOwnerId: swap.ownerId,
            entityOwnerNo: swap.ownerNo || undefined,
            reason: `Swap executed from quote ${quote.quoteNo || quote.id}`,
            metadata: { quoteId: quote.id, quoteNo: quote.quoteNo },
            sourcePlatform: 'CUSTOMER_API',
          },
          { actorType: 'CUSTOMER', actorId: ownerId, actorNo: quote.ownerNo || undefined, actorRole: 'CUSTOMER' },
          tx,
        );

        return swap;
      });

      return this.swapTransactionsService.findOne(result.id);
    } catch (error) {
      // Compensation: void any pending transfers created before rollback
      for (const ref of created) {
        await this.accountingService.voidPendingTransferBestEffort(ref.id, ref.amount);
      }
      throw error;
    }
  }

  private parseTotals(value: string | null | undefined): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private evidence(
    swapNo: string, eventCode: string, debitCode: number, creditCode: number,
    assetCurrency: string, traceId: string, ownerId: string, memo: string,
  ) {
    return {
      sourceType: 'SWAP', sourceNo: swapNo, eventCode,
      debitCode: String(debitCode), creditCode: String(creditCode),
      assetCurrency, traceId, actorType: 'CUSTOMER', actorId: ownerId, memo,
    };
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. (Note: not yet wired into module — that's Task 5. The file compiles standalone.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "feat: add L3 SwapWorkflowService with synchronous executeSwap journey"
```

---

### Task 5: Module Wiring — Provide SwapWorkflowService + dependencies

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts`

- [ ] **Step 1: Update module**

Replace `src/modules/trading/swap-transactions/swap-transactions.module.ts` with:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { OutstandingsModule } from '../../clearing-settle/outstandings/outstandings.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelModule } from '../swap-fee-level/swap-fee-level.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    PricingCenterModule,
    forwardRef(() => SwapFeeLevelModule),
    OutstandingsModule,
    TigerBeetleModule,
    AuditLogsModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowService],
  exports: [SwapTransactionsService, SwapWorkflowService],
})
export class SwapTransactionsModule {}
```

Note: this removes `SwapWorkflowOrchestrator`, `SwapTransactionWorkflowService`, and `TransactionComplianceModule` from the module. The controllers still reference the orchestrator — they will fail to compile until Tasks 6 & 7. **Do not run the build between Step 1 and Task 7; this task's commit is deferred.** Instead, proceed directly to Task 6 and 7, then verify + commit all three together.

Actually, to keep commits atomic and the build green, **defer committing this task.** Apply Step 1, then immediately do Tasks 6 and 7, then build + commit Tasks 5–7 together.

- [ ] **Step 2: Apply Tasks 6 and 7, then verify build**

Run after Tasks 6 & 7: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit (after Tasks 6 & 7)**

```bash
git add src/modules/trading/swap-transactions/
git commit -m "refactor: rewire swap module to SwapWorkflowService; drop orchestrator and state-machine"
```

---

### Task 6: Customer Controller — Use executeSwap

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`

- [ ] **Step 1: Replace orchestrator with workflow service**

In `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`:

1. Replace import `import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';` with `import { SwapWorkflowService } from './swap-workflow.service';`

2. In the constructor, replace `private readonly orchestrator: SwapWorkflowOrchestrator,` with `private readonly swapWorkflowService: SwapWorkflowService,`

3. Replace the `create` method body. Find:
```typescript
  async create(@Request() req: any, @Body() dto: CreateSwapFromQuoteDto) {
    const ownerId = req.user.userId;
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');
    return this.orchestrator.createSwapFromQuote(ownerId, dto.quoteId);
  }
```
Replace with:
```typescript
  async create(@Request() req: any, @Body() dto: CreateSwapFromQuoteDto) {
    return this.swapWorkflowService.executeSwap(req.user.userId, dto.quoteId);
  }
```

(The eligibility check now lives inside `executeSwap`. The `onboardingService` is still used by `createQuote`, so keep its injection.)

- [ ] **Step 2: (build verified in Task 5 Step 2)**

---

### Task 7: Admin Controller — Remove updateStatus

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts`

- [ ] **Step 1: Remove orchestrator + updateStatus**

In `src/modules/trading/swap-transactions/swap-transactions.controller.ts`:

1. Remove import `import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';`
2. Remove the constructor param `private readonly orchestrator: SwapWorkflowOrchestrator,`
3. Remove the entire `@Patch(':id/status')` `updateStatus` method.
4. Remove the now-unused imports: `UpdateSwapTransactionStatusDto` (from the dto import), `Patch` (from `@nestjs/common`), and `Request` if no longer used. Keep `CreateSwapTransactionDto` if the `@Post()` stub still uses it.

- [ ] **Step 2: Verify build (covers Tasks 5–7) and commit**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

Then commit Tasks 5–7 together:
```bash
git add src/modules/trading/swap-transactions/
git commit -m "refactor: rewire swap controllers + module to SwapWorkflowService, remove admin status transition"
```

---

### Task 8: Remove Cross-Module Swap Compliance Path

**Files:**
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`
- Modify: `src/modules/identity/onboarding/workflow-transition.service.ts`

These reference the to-be-deleted `SwapTransactionWorkflowService`. Remove the swap-specific paths while preserving withdrawal/deposit.

- [ ] **Step 1: Remove evaluateSwapFinalReview**

In `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`, delete the entire `async evaluateSwapFinalReview(...)` method (around line 63). Verify nothing else in this file references it: `grep -n evaluateSwapFinalReview src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts` should return nothing after deletion.

- [ ] **Step 2: Remove swap path from transaction-risk-bridge.service.ts**

In `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`:
1. Remove the import of `SwapTransactionWorkflowService` (line ~34).
2. Remove the getter/ModuleRef block that does `this.moduleRef?.get(SwapTransactionWorkflowService, ...)` (around line 388).
3. Remove the `private async clearSwapIfApproved(...)` method (around line 1035) and its single call site (around line 1567). At the call site, the surrounding logic dispatches by source type; replace the swap dispatch with a no-op guard: if the disposition targets a SWAP source, log and skip (swaps are synchronous and never enter async compliance).
4. Remove the `async handleSwapFinalReview(...)` method (around line 1633).

After edits, verify: `grep -n "Swap" src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts` — only incidental mentions (comments/log strings) should remain, no references to `SwapTransactionWorkflowService`, `clearSwapIfApproved`, or `handleSwapFinalReview`.

- [ ] **Step 3: Remove swap branch from workflow-transition.service.ts**

In `src/modules/identity/onboarding/workflow-transition.service.ts`:
1. Remove the import of `SwapTransactionWorkflowService` (line ~28).
2. Remove the `getTransactionSwapWorkflowTransitionService()` method (lines ~60–68).
3. In the dispatch logic (around line 155, `if (sourceType === TRANSACTION_SWAP_SOURCE_TYPE)`), replace the swap branch body so it throws a clear error instead of calling the swap workflow service:
```typescript
      if (sourceType === TRANSACTION_SWAP_SOURCE_TYPE) {
        throw new BadRequestException(
          'Swap transactions are synchronous and do not support async compliance transitions',
        );
      }
```
Keep the deposit and withdraw branches untouched.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. (Risk-bridge and workflow-transition no longer import the swap workflow service.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/risk-engine/ src/modules/identity/onboarding/workflow-transition.service.ts
git commit -m "refactor: remove swap-specific async compliance path from risk-engine (swaps are synchronous)"
```

---

### Task 9: Delete Legacy Orchestrator + State-Machine Workflow

**Files:**
- Delete: `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts`
- Delete: `src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts`
- Delete: `src/modules/trading/swap-transactions/swap-orchestrator.spec.ts` (tests deleted orchestrator)

- [ ] **Step 1: Delete files**

```bash
rm src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts
rm src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts
rm -f src/modules/trading/swap-transactions/swap-orchestrator.spec.ts
```

- [ ] **Step 2: Verify no dangling references**

Run: `grep -rn "SwapWorkflowOrchestrator\|SwapTransactionWorkflowService\|swap-workflow.orchestrator\|swap-transaction-workflow.service" src/modules/ --include="*.ts" | grep -v "swap-workflow.service"`
Expected: Zero results.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete legacy swap orchestrator and state-machine workflow"
```

---

### Task 10: Cleanup — Trim DTO Enums

**Files:**
- Modify: `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts`

- [ ] **Step 1: Check remaining usages of removed enum values**

Run:
```bash
grep -rn "SwapTransactionStatus.PENDING_COMPLIANCE\|SwapTransactionStatus.UNDER_REVIEW\|SwapTransactionStatus.REJECTED\|SwapTransactionAction\." src/modules/ --include="*.ts" | grep -v "\.spec\."
```
Expected: Zero results (all removed in prior tasks). If any remain, fix them before trimming.

- [ ] **Step 2: Trim the status enum**

In `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts`, replace:
```typescript
export enum SwapTransactionStatus {
  PENDING_COMPLIANCE = 'PENDING_COMPLIANCE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}
```
with:
```typescript
export enum SwapTransactionStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}
```

Leave `SwapTransactionAction` and `UpdateSwapTransactionStatusDto` only if still imported anywhere; otherwise remove them. Run `grep -rn "SwapTransactionAction\|UpdateSwapTransactionStatusDto" src/modules/ --include="*.ts" | grep -v "\.spec\."` — if zero, delete those two declarations from the dto file.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts
git commit -m "refactor: trim swap status enum to SUCCESS/FAILED"
```

---

### Task 11: End-to-End Verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Build clean**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 2: Verify new structure exists**

Run:
```bash
ls src/modules/trading/swap-transactions/swap-workflow.service.ts
grep -n "async executeSwap" src/modules/trading/swap-transactions/swap-workflow.service.ts
grep -n "async create" src/modules/trading/swap-transactions/swap-transactions.service.ts
```
Expected: workflow service exists with executeSwap; domain service has create.

- [ ] **Step 3: Verify legacy gone**

Run:
```bash
test ! -f src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts && echo "orchestrator DELETED"
test ! -f src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts && echo "state-machine DELETED"
grep -rn "evaluateSwapFinalReview\|handleSwapFinalReview\|clearSwapIfApproved" src/modules/ --include="*.ts" | grep -v "\.spec\." || echo "risk-bridge swap path GONE"
```
Expected: both deletions confirmed; risk-bridge swap path gone.

- [ ] **Step 4: Verify TB codes + schema**

Run:
```bash
grep "SWAP_CREDIT_TO_CLEARING_PENDING\|SWAP_CLEARING_TO_CREDIT\|SWAP_CLEARING_TO_FEE" src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
grep "tbFromTransferId\|tbToTransferId\|tbFeeTransferId\|traceId" prisma/schema.prisma | head -5
```
Expected: swap codes present; TB ref fields on schema.

- [ ] **Step 5: Verify no swap status transitions remain**

Run: `grep -rn "updateStatus\|handleStatusTransition" src/modules/trading/swap-transactions/ --include="*.ts" | grep -v "\.spec\."`
Expected: Zero results (admin status transition removed).

# V5 Crypto Withdrawal Happy Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the crypto withdrawal happy path with TigerBeetle pending transfers, KYT two-phase compliance, and event-driven workflow orchestration.

**Architecture:** 3-Layer pattern: L1 `WithdrawTransactionsService` (domain — CRUD + TB pending on create + domain events), L3 `WithdrawWorkflowService` (workflow — Gate 0/1/2 orchestration, payout creation, TB POST on chain confirm). AccountingService extended with pending/post/void transfer methods.

**Tech Stack:** NestJS, Prisma/SQLite, TigerBeetle (tigerbeetle-node), EventEmitter2 (@nestjs/event-emitter)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add 3 fields to WithdrawTransaction |
| Create | `prisma/migrations/XXXXXX_v5_withdraw_tb_pending/migration.sql` | Auto-generated migration |
| Modify | `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` | 6 new withdrawal transfer codes |
| Modify | `src/modules/accounting/tigerbeetle/types/accounting.types.ts` | New pending transfer param types |
| Modify | `src/modules/accounting/tigerbeetle/accounting.service.ts` | 3 new methods: executePendingTransfer, postPendingTransfer, voidPendingTransfer |
| Modify | `src/common/events/domain-events.constants.ts` | 6 new withdrawal/payout events |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | 8 new WITHDRAW_* audit actions |
| Modify | `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts` | Add TigerBeetleModule import + new service |
| Modify | `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` | Inject AccountingService, TB pending on create, traceId, domain events |
| Create | `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | New L3: event-driven Gate 0/1/2, payout, TB POST |

> **Status naming:** The spec uses `COMPLIANCE_PENDING` but existing code uses `PENDING_COMPLIANCE`. This plan uses the **existing** enum value `PENDING_COMPLIANCE` throughout.

---

### Task 1: Prisma Schema — Add TB Pending Fields + traceId

Add three nullable fields to `WithdrawTransaction` for TB pending transfer tracking and audit trace correlation.

**Files:**
- Modify: `prisma/schema.prisma:2032-2099` (WithdrawTransaction model)

- [ ] **Step 1: Add fields to Prisma schema**

In `prisma/schema.prisma`, add these 3 fields to `WithdrawTransaction` after the `complianceReviewedAt` field (line ~2071):

```prisma
  traceId              String?
  tbPendingNetId       String?
  tbPendingFeeId       String?
```

These go right after `complianceReviewedAt DateTime?` and before `parentType String?`.

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name v5_withdraw_tb_pending
```
Expected: Migration created successfully, `dev.db` updated.

- [ ] **Step 3: Verify schema**

Run:
```bash
cd Exchange_js && npx prisma validate
```
Expected: `Your schema is valid.`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add traceId, tbPendingNetId, tbPendingFeeId to WithdrawTransaction"
```

---

### Task 2: TB Transfer Codes — 6 Withdrawal Codes

Add the six new transfer codes for withdrawal pending/post/void operations.

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [ ] **Step 1: Add withdrawal transfer codes**

Replace the full file content of `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`:

```typescript
/** TB transfer type codes (u16). Immutable once assigned. */
export const TB_TRANSFER_CODES = {
  // Deposit (1–9)
  DEPOSIT_CUSTODY_TO_AUDIT: 1,
  DEPOSIT_AUDIT_TO_CREDIT: 2,

  // Withdrawal: pending lock (10–11)
  WITHDRAW_CREDIT_TO_CUSTODY_PENDING: 10,
  WITHDRAW_CREDIT_TO_FEE_PENDING: 11,

  // Withdrawal: post — chain confirmed (12–13)
  WITHDRAW_CREDIT_TO_CUSTODY_POST: 12,
  WITHDRAW_CREDIT_TO_FEE_POST: 13,

  // Withdrawal: void — cancel/fail (14–15)
  WITHDRAW_CREDIT_TO_CUSTODY_VOID: 14,
  WITHDRAW_CREDIT_TO_FEE_VOID: 15,
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
```

- [ ] **Step 2: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: No errors related to `TB_TRANSFER_CODES`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat(tb): add 6 withdrawal transfer codes (pending/post/void)"
```

---

### Task 3: AccountingService — Pending Transfer Methods

Extend `AccountingService` with `executePendingTransfer`, `postPendingTransfer`, and `voidPendingTransfer`.

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/types/accounting.types.ts`
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts`

- [ ] **Step 1: Add new parameter types**

In `src/modules/accounting/tigerbeetle/types/accounting.types.ts`, add after the `CustomerAvailableBalance` interface (end of file):

```typescript
export interface ExecutePendingTransferParams {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  timeout: number;
  evidence: EvidenceParams;
  tx?: any;
}

export interface PostOrVoidPendingTransferParams {
  pendingTransferId: bigint;
  evidence: EvidenceParams;
  tx?: any;
}
```

- [ ] **Step 2: Import TransferFlags in accounting.service.ts**

In `src/modules/accounting/tigerbeetle/accounting.service.ts`, add `TransferFlags` to the tigerbeetle-node import at line 11:

Change:
```typescript
import { id as tbId, CreateAccountStatus, CreateTransferStatus } from 'tigerbeetle-node';
```
To:
```typescript
import { id as tbId, CreateAccountStatus, CreateTransferStatus, TransferFlags } from 'tigerbeetle-node';
```

Also add the new types to the import from `./types/accounting.types`:

Change:
```typescript
import { CreateTbAccountParams, EvidenceParams, TbBalanceResult, CustomerAvailableBalance } from './types/accounting.types';
```
To:
```typescript
import { CreateTbAccountParams, EvidenceParams, TbBalanceResult, CustomerAvailableBalance, ExecutePendingTransferParams, PostOrVoidPendingTransferParams } from './types/accounting.types';
```

- [ ] **Step 3: Add executePendingTransfer method**

In `src/modules/accounting/tigerbeetle/accounting.service.ts`, add after the `executeTransfer` method (after line 137, before the `// ── Balance Queries ──` comment):

```typescript
  async executePendingTransfer(params: ExecutePendingTransferParams): Promise<{ tbTransferId: bigint }> {
    const transferId = deterministicTransferId(
      params.evidence.sourceType,
      params.evidence.sourceNo,
      params.evidence.eventCode,
      0,
    );

    const errors = await this.tbService.createTransfers([{
      id: transferId,
      debit_account_id: params.debitAccountId,
      credit_account_id: params.creditAccountId,
      amount: params.amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: params.timeout,
      ledger: params.ledger,
      code: params.code,
      flags: TransferFlags.pending,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_PENDING_TRANSFER_FAILED',
        message: `TigerBeetle pending transfer rejected: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(transferId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: Number(params.amount),
      assetCurrency: params.evidence.assetCurrency,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      transferType: 'PENDING',
    }, params.tx);

    return { tbTransferId: transferId };
  }
```

- [ ] **Step 4: Add postPendingTransfer method**

Add immediately after `executePendingTransfer`:

```typescript
  async postPendingTransfer(params: PostOrVoidPendingTransferParams): Promise<void> {
    const postId = tbId();

    const errors = await this.tbService.createTransfers([{
      id: postId,
      debit_account_id: 0n,
      credit_account_id: 0n,
      amount: 0n,
      pending_id: params.pendingTransferId,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 0,
      code: 0,
      flags: TransferFlags.post_pending_transfer,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_POST_PENDING_FAILED',
        message: `TigerBeetle post pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(postId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: 0,
      assetCurrency: params.evidence.assetCurrency,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      pendingId: bigintToHex(params.pendingTransferId),
      transferType: 'POST_PENDING',
    }, params.tx);
  }
```

- [ ] **Step 5: Add voidPendingTransfer method**

Add immediately after `postPendingTransfer`:

```typescript
  async voidPendingTransfer(params: PostOrVoidPendingTransferParams): Promise<void> {
    const voidId = tbId();

    const errors = await this.tbService.createTransfers([{
      id: voidId,
      debit_account_id: 0n,
      credit_account_id: 0n,
      amount: 0n,
      pending_id: params.pendingTransferId,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 0,
      code: 0,
      flags: TransferFlags.void_pending_transfer,
      timestamp: 0n,
    }]);

    const realErrors = errors.filter((e: any) =>
      e.status !== CreateTransferStatus.exists && e.status !== CreateTransferStatus.created,
    );
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_VOID_PENDING_FAILED',
        message: `TigerBeetle void pending transfer failed: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      });
    }

    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(voidId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: 0,
      assetCurrency: params.evidence.assetCurrency,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      pendingId: bigintToHex(params.pendingTransferId),
      transferType: 'VOID_PENDING',
    }, params.tx);
  }
```

- [ ] **Step 6: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounting/tigerbeetle/accounting.service.ts src/modules/accounting/tigerbeetle/types/accounting.types.ts
git commit -m "feat(accounting): add executePendingTransfer, postPendingTransfer, voidPendingTransfer"
```

---

### Task 4: Domain Events Registry — 6 Withdrawal/Payout Events

Register new domain events in the central registry.

**Files:**
- Modify: `src/common/events/domain-events.constants.ts`

- [ ] **Step 1: Add withdrawal and payout events**

Replace the full file content of `src/common/events/domain-events.constants.ts`:

```typescript
/**
 * Internal Domain Events Registry
 *
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
  // ── Deposit ──
  PAYIN_CREATED: {
    name: 'payin.created',
    emitter: 'PayinsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ payinId: string, status: string }',
  },
  PAYIN_STATUS_CHANGED: {
    name: 'payin.status.changed',
    emitter: 'PayinsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ payinId: string, oldStatus: string, newStatus: string, simulationMode?: string }',
  },
  DEPOSIT_STATUS_CHANGED: {
    name: 'deposit.status.changed',
    emitter: 'DepositTransactionsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ depositId: string, oldStatus: string, newStatus: string, ownerType: string, ownerId: string, assetId: string, amount: string, payinId?: string }',
  },

  // ── Withdrawal ──
  WITHDRAWAL_CREATED: {
    name: 'withdrawal.created',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, withdrawNo: string, status: string, ownerType: string, ownerId: string, assetId: string, amount: string, traceId: string }',
  },
  WITHDRAWAL_STATUS_CHANGED: {
    name: 'withdrawal.status.changed',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, oldStatus: string, newStatus: string, ownerType: string, ownerId: string, assetId: string }',
  },
  WITHDRAWAL_KYT_UPDATED: {
    name: 'withdrawal.kyt.updated',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, kytStatus: string, phase: number }',
  },
  WITHDRAWAL_TRAVELRULE_UPDATED: {
    name: 'withdrawal.travelrule.updated',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, travelRuleStatus: string }',
  },
  PAYOUT_CREATED: {
    name: 'payout.created',
    emitter: 'PayoutsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ payoutId: string, withdrawId: string, type: string, status: string }',
  },
  PAYOUT_STATUS_CONFIRMED: {
    name: 'payout.status.confirmed',
    emitter: 'PayoutsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ payoutId: string, withdrawId: string, txHash: string }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  // Deposit
  PAYIN_CREATED: DOMAIN_EVENTS.PAYIN_CREATED.name,
  PAYIN_STATUS_CHANGED: DOMAIN_EVENTS.PAYIN_STATUS_CHANGED.name,
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
  // Withdrawal
  WITHDRAWAL_CREATED: DOMAIN_EVENTS.WITHDRAWAL_CREATED.name,
  WITHDRAWAL_STATUS_CHANGED: DOMAIN_EVENTS.WITHDRAWAL_STATUS_CHANGED.name,
  WITHDRAWAL_KYT_UPDATED: DOMAIN_EVENTS.WITHDRAWAL_KYT_UPDATED.name,
  WITHDRAWAL_TRAVELRULE_UPDATED: DOMAIN_EVENTS.WITHDRAWAL_TRAVELRULE_UPDATED.name,
  PAYOUT_CREATED: DOMAIN_EVENTS.PAYOUT_CREATED.name,
  PAYOUT_STATUS_CONFIRMED: DOMAIN_EVENTS.PAYOUT_STATUS_CONFIRMED.name,
} as const;
```

- [ ] **Step 2: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/common/events/domain-events.constants.ts
git commit -m "feat(events): register 6 withdrawal/payout domain events"
```

---

### Task 5: Audit Actions — Withdrawal Happy Path Actions

Add the 8 new audit actions for the V5 withdrawal happy path.

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add new withdrawal audit actions**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, find the `AuditActions` object. Locate the existing `WITHDRAW_CREATED` entry (line ~257). Add the new actions immediately after `WITHDRAW_FAILED_REVERSED` (line ~262):

```typescript
  // V5 Withdrawal Happy Path
  WITHDRAW_REQUESTED: 'WITHDRAW_REQUESTED',
  WITHDRAW_GATE0_PASSED: 'WITHDRAW_GATE0_PASSED',
  WITHDRAW_KYT_PHASE1_PASSED: 'WITHDRAW_KYT_PHASE1_PASSED',
  WITHDRAW_TRAVEL_RULE_PASSED: 'WITHDRAW_TRAVEL_RULE_PASSED',
  WITHDRAW_COMPLIANCE_PASSED: 'WITHDRAW_COMPLIANCE_PASSED',
  WITHDRAW_KYT_PHASE2_SUBMITTED: 'WITHDRAW_KYT_PHASE2_SUBMITTED',
  WITHDRAW_ACCOUNTING_POSTED: 'WITHDRAW_ACCOUNTING_POSTED',
  WITHDRAW_SUCCESS: 'WITHDRAW_SUCCESS',
```

- [ ] **Step 2: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(audit): add 8 V5 withdrawal happy path audit actions"
```

---

### Task 6: Module Wiring — TigerBeetleModule Import

Add `TigerBeetleModule` to `WithdrawTransactionsModule` imports and register the new `WithdrawWorkflowService`.

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`

- [ ] **Step 1: Update module imports and providers**

Replace the full file content of `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { WithdrawTransactionsController } from './withdraw-transactions.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawTransactionWorkflowService } from './withdraw-transaction-workflow.service';
import { WithdrawWorkflowService } from './withdraw-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    TransactionComplianceModule,
    PricingCenterModule,
    TigerBeetleModule,
  ],
  controllers: [WithdrawTransactionsController],
  providers: [
    WithdrawTransactionsService,
    WithdrawTransactionWorkflowService,
    WithdrawWorkflowService,
  ],
  exports: [
    WithdrawTransactionsService,
    WithdrawTransactionWorkflowService,
    WithdrawWorkflowService,
  ],
})
export class WithdrawTransactionsModule {}
```

> Note: This step will cause a compile error because `WithdrawWorkflowService` does not exist yet. That's expected — Task 8 creates it. If you prefer no intermediate errors, swap Task 6 and Task 8 order.

- [ ] **Step 2: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts
git commit -m "feat(module): add TigerBeetleModule import and WithdrawWorkflowService to withdraw module"
```

---

### Task 7: WithdrawTransactionsService Refactoring — TB Pending + Domain Events

Refactor the `create()` method to:
1. Generate `traceId` on creation
2. Execute 2 TB pending transfers and store their IDs
3. Replace old event with domain event `withdrawal.created`
4. Add domain event methods for KYT and Travel Rule status updates

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

- [ ] **Step 1: Add AccountingService import and injection**

In `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`:

Add imports at the top of the file (after existing imports):

```typescript
import { randomUUID } from 'node:crypto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
```

Add `AccountingService` to the constructor injection. Find the constructor (line ~102) and add `accountingService` parameter:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => TransactionComplianceService))
    private readonly transactionComplianceService: TransactionComplianceService,
    private readonly pricingCenterService: PricingCenterService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
  ) {}
```

- [ ] **Step 2: Add decimalToBigint helper**

Add this private method to the service class (before the `create` method):

```typescript
  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }
```

- [ ] **Step 3: Refactor create() — generate traceId and store TB pending IDs**

In the `create()` method, make these changes inside the `$transaction` callback:

**3a.** After `const netAmount = amountDecimal.sub(quoteFeeAmount);` (line ~525), add traceId generation:

```typescript
        const traceId = randomUUID();
```

**3b.** In the `tx.withdrawTransaction.create({ data: ... })` call, add `traceId` to the data object:

Add after the `complianceStatus: 'PENDING',` line:
```typescript
            traceId,
```

**3c.** After the `tx.withdrawTransaction.create()` call (after `});`), add TB pending transfer execution:

```typescript
        // TB: create 2 pending transfers — lock customer balance
        const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
        if (ledger && ownerType === 'CUSTOMER') {
          const clientCreditId = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: userId,
          });
          const custodyId = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.CUSTODY,
            ledger,
            ownerType: 'SYSTEM',
          });

          const netBigint = this.decimalToBigint(netAmount, asset.decimals);
          const feeBigint = this.decimalToBigint(quoteFeeAmount, asset.decimals);

          const evidenceBase = {
            sourceType: 'WITHDRAWAL',
            sourceNo: withdrawNo,
            debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
            assetCurrency: asset.currency,
            traceId,
            actorType: ownerType,
            actorId: userId,
          };

          // Pending #1: net amount CLIENT_CREDIT → CUSTODY
          const { tbTransferId: pendingNetId } = await this.accountingService.executePendingTransfer({
            debitAccountId: clientCreditId,
            creditAccountId: custodyId,
            amount: netBigint,
            ledger,
            code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_PENDING,
            timeout: 0,
            evidence: {
              ...evidenceBase,
              eventCode: 'WITHDRAW_LOCK_NET',
              creditCode: String(TB_ACCOUNT_CODES.CUSTODY),
              memo: 'Withdrawal pending lock: net amount',
            },
            tx,
          });

          // Pending #2: fee amount CLIENT_CREDIT → FEE_RECEIVABLE
          let pendingFeeId: bigint | undefined;
          if (feeBigint > 0n) {
            const feeReceivableId = await this.accountingService.resolveTbAccountId({
              code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
              ledger,
              ownerType: 'SYSTEM',
            });

            const result = await this.accountingService.executePendingTransfer({
              debitAccountId: clientCreditId,
              creditAccountId: feeReceivableId,
              amount: feeBigint,
              ledger,
              code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_FEE_PENDING,
              timeout: 0,
              evidence: {
                ...evidenceBase,
                eventCode: 'WITHDRAW_LOCK_FEE',
                creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE),
                memo: 'Withdrawal pending lock: fee amount',
              },
              tx,
            });
            pendingFeeId = result.tbTransferId;
          }

          // Store pending transfer IDs on the record
          await tx.withdrawTransaction.update({
            where: { id: record.id },
            data: {
              tbPendingNetId: bigintToHex(pendingNetId),
              tbPendingFeeId: pendingFeeId ? bigintToHex(pendingFeeId) : null,
            },
          });
        }
```

**3d.** Update the audit action from `WITHDRAW_CREATED` to `WITHDRAW_REQUESTED` and add `traceId` + `workflowType`:

Find the `auditLogsService.recordByActor` call inside create (line ~563). Replace the `action` and add `traceId`/`workflowType`:

```typescript
        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.WITHDRAW_REQUESTED,
            entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
            entityId: record.id,
            entityNo: record.withdrawNo,
            entityOwnerType: record.ownerType,
            entityOwnerId: record.ownerId,
            traceId,
            workflowType: AuditWorkflowTypes.WITHDRAW,
            reason: 'Customer initiated withdrawal',
            sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
          },
          {
            actorType: ownerType,
            actorId: userId,
            actorRole: ownerType,
          },
          tx,
        );
```

> Note: Add `AuditWorkflowTypes` to the import from audit-actions if not already present.

- [ ] **Step 4: Replace old event emission with domain event**

After the `$transaction` block, find the old event emission (line ~594):

```typescript
    this.eventEmitter.emit(WithdrawEvents.EVT_WITHDRAWAL_CREATED, {
      withdrawId: created.id,
    });
```

Replace with domain event emission:

```typescript
    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_CREATED, {
      withdrawId: created.id,
      withdrawNo: created.withdrawNo,
      status: created.status,
      ownerType: created.ownerType,
      ownerId: created.ownerId,
      assetId: created.assetId,
      amount: created.amount.toString(),
      traceId: created.traceId,
    });
```

Remove the two `transactionComplianceService` calls that follow (lines ~598-603):

```typescript
    // REMOVE these two lines — compliance gate logic moves to WithdrawWorkflowService
    // await this.transactionComplianceService.ensureWithdrawPreKytCaseOnCreate(created.id);
    // await this.transactionComplianceService.initializeWithdrawFinalDecisionRecord(created.id);
```

- [ ] **Step 5: Add KYT status update method**

Add a new public method to the service for updating KYT status (used by simulation endpoints and future Sumsub callbacks):

```typescript
  async updateKytStatus(
    id: string,
    kytStatus: string,
    kytScreeningId: string | null,
    kytRiskScore: number | null,
    phase: number,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        kytStatus,
        kytScreeningId: kytScreeningId ?? item.kytScreeningId,
        kytRiskScore: kytRiskScore ?? item.kytRiskScore,
        kytCheckedAt: new Date(),
      },
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_KYT_UPDATED, {
      withdrawId: id,
      kytStatus,
      phase,
    });

    return updated;
  }
```

- [ ] **Step 6: Add Travel Rule status update method**

```typescript
  async updateTravelRuleStatus(
    id: string,
    travelRuleStatus: string,
    travelRuleTransferId: string | null,
  ) {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Withdraw transaction not found');

    const updated = await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        travelRuleStatus,
        travelRuleTransferId: travelRuleTransferId ?? item.travelRuleTransferId,
        travelRuleCheckedAt: new Date(),
      },
    });

    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_TRAVELRULE_UPDATED, {
      withdrawId: id,
      travelRuleStatus,
    });

    return updated;
  }
```

- [ ] **Step 7: Add getOwnerComplianceStatus helper**

```typescript
  async getOwnerComplianceStatus(withdrawId: string): Promise<string> {
    const item = await (this.prisma as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      include: { customer: { select: { complianceStatus: true } } },
    });
    if (!item) throw new NotFoundException('Withdraw transaction not found');
    return item.customer?.complianceStatus || 'UNKNOWN';
  }
```

- [ ] **Step 8: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: May show errors about missing `WithdrawWorkflowService` (from Task 6 module wiring). No errors related to this service file.

- [ ] **Step 9: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
git commit -m "feat(withdraw): add TB pending on create, traceId, domain events, KYT/TR update methods"
```

---

### Task 8: WithdrawWorkflowService — Event-Driven Orchestration

Create the new L3 workflow service that:
- Subscribes to `withdrawal.created` → runs Gate 0, then Gate 1 + Gate 2 in parallel
- Subscribes to `withdrawal.kyt.updated` and `withdrawal.travelrule.updated` → checks all gates pass
- When all gates pass → creates Payout, transitions to PAYOUT_PENDING
- Subscribes to `payout.status.confirmed` → TB POST pending × 2 → transitions to SUCCESS

**Files:**
- Create: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`

- [ ] **Step 1: Create the workflow service file**

Create `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import {
  WithdrawTransactionAction,
  WithdrawTransactionStatus,
} from './dto/withdraw-transaction.dto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { hexToBigint } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class WithdrawWorkflowService implements OnModuleInit {
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);

  private readonly logger = new Logger(WithdrawWorkflowService.name);

  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('WithdrawWorkflowService initialized and listening for events.');
  }

  // ── Event Handlers ──

  @OnEvent(DomainEventNames.WITHDRAWAL_CREATED)
  async handleWithdrawalCreated(event: {
    withdrawId: string;
    withdrawNo: string;
    status: string;
    ownerType: string;
    ownerId: string;
    assetId: string;
    amount: string;
    traceId: string;
  }) {
    this.logger.log(`Orchestrating new withdrawal ${event.withdrawId}`);

    const gate0Pass = await this.runGate0(event.withdrawId);
    if (!gate0Pass) return;

    await this.initializeComplianceGates(event.withdrawId);
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_KYT_UPDATED)
  async handleKytUpdated(event: {
    withdrawId: string;
    kytStatus: string;
    phase: number;
  }) {
    this.logger.log(`KYT updated for withdrawal ${event.withdrawId}: phase=${event.phase} status=${event.kytStatus}`);

    if (event.phase === 1) {
      await this.checkAllGatesPass(event.withdrawId);
    }
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_TRAVELRULE_UPDATED)
  async handleTravelRuleUpdated(event: {
    withdrawId: string;
    travelRuleStatus: string;
  }) {
    this.logger.log(`Travel Rule updated for withdrawal ${event.withdrawId}: status=${event.travelRuleStatus}`);
    await this.checkAllGatesPass(event.withdrawId);
  }

  @OnEvent(DomainEventNames.PAYOUT_STATUS_CONFIRMED)
  async handlePayoutConfirmed(event: {
    payoutId: string;
    withdrawId: string;
    txHash: string;
  }) {
    this.logger.log(`Payout confirmed for withdrawal ${event.withdrawId}`);
    await this.finalizeWithdrawal(event.withdrawId);
  }

  // ── Gate 0: Customer Compliance Status ──

  private async runGate0(withdrawId: string): Promise<boolean> {
    const complianceStatus = await this.withdrawService.getOwnerComplianceStatus(withdrawId);

    if (WithdrawWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(`Gate 0 FAIL: withdrawal ${withdrawId} — customer compliance: ${complianceStatus}`);
      return false;
    }

    this.logger.log(`Gate 0 PASS: withdrawal ${withdrawId}`);

    const w = await this.withdrawService.findOne(withdrawId);
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_GATE0_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Customer compliance status: ${complianceStatus}`,
      sourcePlatform: 'SYSTEM',
    });

    return true;
  }

  // ── Gate 1 + Gate 2: Initialize Compliance Gates (Parallel) ──

  private async initializeComplianceGates(withdrawId: string) {
    const w = await this.withdrawService.findOne(withdrawId);

    // Gate 1: KYT Phase 1 — set to PENDING, await simulation/callback
    await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);

    // Gate 2: Travel Rule — set to PENDING, await simulation/callback
    await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);

    this.logger.log(`Compliance gates initialized for withdrawal ${withdrawId} — awaiting KYT Phase 1 + Travel Rule`);
  }

  // ── Gate Convergence Check ──

  private async checkAllGatesPass(withdrawId: string) {
    const w = await this.withdrawService.findOne(withdrawId);

    if (w.status !== WithdrawTransactionStatus.PENDING_COMPLIANCE) {
      this.logger.debug(`Skip gate check: withdrawal ${withdrawId} status is ${w.status}`);
      return;
    }

    const gate1Pass = w.kytStatus === 'PASSED';
    const gate2Pass = w.travelRuleStatus === 'PASSED' || w.travelRuleStatus === 'NOT_REQUIRED';

    if (!gate1Pass || !gate2Pass) {
      this.logger.debug(
        `Gates not yet all passed for ${withdrawId}: kyt=${w.kytStatus} tr=${w.travelRuleStatus}`,
      );
      return;
    }

    this.logger.log(`All gates PASSED for withdrawal ${withdrawId} — initiating payout phase`);

    // Audit: individual gate pass events
    if (gate1Pass) {
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_KYT_PHASE1_PASSED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `KYT Phase 1 passed: score=${w.kytRiskScore}`,
        sourcePlatform: 'SYSTEM',
      });
    }

    if (gate2Pass) {
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_TRAVEL_RULE_PASSED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Travel Rule status: ${w.travelRuleStatus}`,
        sourcePlatform: 'SYSTEM',
      });
    }

    await this.initiatePayoutPhase(withdrawId);
  }

  // ── Payout Phase ──

  private async initiatePayoutPhase(withdrawId: string) {
    const w = await this.withdrawService.findOne(withdrawId);

    // Transition: PENDING_COMPLIANCE → PAYOUT_PENDING
    await this.withdrawService.updateStatus(w.id, {
      action: WithdrawTransactionAction.APPROVE,
    }, {
      source: 'WORKFLOW',
      actorType: 'SYSTEM',
      actorId: 'WITHDRAW_WORKFLOW',
      sourcePlatform: 'SYSTEM',
    });

    // Audit: compliance passed
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_COMPLIANCE_PASSED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'All compliance gates passed, payout initiated',
      sourcePlatform: 'SYSTEM',
    });

    // Create Payout record
    // Note: Payout creation is handled by the existing PayoutsService.
    // For the happy path, the simulation endpoint will drive payout status progression.
    // In production, this would call PayoutsService.create() and link to the withdrawal.
    this.logger.log(`Withdrawal ${withdrawId} now PAYOUT_PENDING — awaiting payout creation`);
  }

  // ── Finalization: TB POST on chain confirmation ──

  private async finalizeWithdrawal(withdrawId: string) {
    const w = await this.withdrawService.findOne(withdrawId);

    if (w.status !== WithdrawTransactionStatus.PAYOUT_PENDING) {
      this.logger.warn(`Cannot finalize withdrawal ${withdrawId}: status is ${w.status}`);
      return;
    }

    // POST pending transfer #1: net amount
    if (w.tbPendingNetId) {
      const pendingNetBigint = hexToBigint(w.tbPendingNetId);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingNetBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_POST_NET',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          creditCode: String(TB_ACCOUNT_CODES.CUSTODY),
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Chain confirmed: POST net pending transfer',
        },
      });
    }

    // POST pending transfer #2: fee amount
    if (w.tbPendingFeeId) {
      const pendingFeeBigint = hexToBigint(w.tbPendingFeeId);
      await this.accountingService.postPendingTransfer({
        pendingTransferId: pendingFeeBigint,
        evidence: {
          sourceType: 'WITHDRAWAL',
          sourceNo: w.withdrawNo,
          eventCode: 'WITHDRAW_POST_FEE',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE),
          assetCurrency: w.asset?.currency || '',
          traceId: w.traceId || w.id,
          actorType: 'SYSTEM',
          actorId: 'WITHDRAW_WORKFLOW',
          memo: 'Chain confirmed: POST fee pending transfer',
        },
      });
    }

    // Audit: accounting posted
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_ACCOUNTING_POSTED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'TB pending transfers posted after chain confirmation',
      sourcePlatform: 'SYSTEM',
    });

    // Transition: PAYOUT_PENDING → SUCCESS
    await this.withdrawService.updateStatus(w.id, {
      action: WithdrawTransactionAction.SUCCESS,
    }, {
      source: 'WORKFLOW',
      actorType: 'SYSTEM',
      actorId: 'WITHDRAW_WORKFLOW',
      sourcePlatform: 'SYSTEM',
    });

    // Audit: withdrawal success
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_SUCCESS,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: 'Withdrawal completed successfully',
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Withdrawal ${withdrawId} finalized: TB posted, status SUCCESS`);
  }
}
```

- [ ] **Step 2: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors (all dependencies from Tasks 1–7 are in place).

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat(withdraw): add WithdrawWorkflowService — event-driven Gate 0/1/2 + TB POST"
```

---

### Task 9: Simulation Endpoints — KYT Phase 1/2 and Payout Confirm

Add simulation endpoints for dev/test that allow driving the happy path manually.

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts` (add simulation endpoints)

- [ ] **Step 1: Read the current controller to understand its structure**

Read `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts` to find where to add new endpoints.

- [ ] **Step 2: Add KYT Phase 1 simulation endpoint**

Add to the controller class:

```typescript
  @Post(':id/simulate/kyt-phase1')
  async simulateKytPhase1(
    @Param('id') id: string,
    @Body() body: { result?: string; riskScore?: number },
  ) {
    const result = body.result || 'PASSED';
    const riskScore = body.riskScore ?? 10;

    const updated = await this.withdrawTransactionsService.updateKytStatus(
      id,
      result,
      `SIM-KYT-${Date.now()}`,
      riskScore,
      1,
    );

    return { message: `KYT Phase 1 simulated: ${result}`, withdrawId: id, kytStatus: result };
  }
```

- [ ] **Step 3: Add Travel Rule simulation endpoint**

```typescript
  @Post(':id/simulate/travel-rule')
  async simulateTravelRule(
    @Param('id') id: string,
    @Body() body: { result?: string },
  ) {
    const result = body.result || 'PASSED';

    const updated = await this.withdrawTransactionsService.updateTravelRuleStatus(
      id,
      result,
      result === 'PASSED' ? `SIM-TR-${Date.now()}` : null,
    );

    return { message: `Travel Rule simulated: ${result}`, withdrawId: id, travelRuleStatus: result };
  }
```

- [ ] **Step 4: Add Payout Confirmed simulation endpoint**

This endpoint simulates the payout chain confirmation event. It emits the `payout.status.confirmed` domain event that `WithdrawWorkflowService` subscribes to.

```typescript
  @Post(':id/simulate/payout-confirmed')
  async simulatePayoutConfirmed(
    @Param('id') id: string,
    @Body() body: { txHash?: string },
  ) {
    const w = await this.withdrawTransactionsService.findOne(id);
    const txHash = body.txHash || `0xSIM${Date.now().toString(16)}`;

    // Update txHash on the withdrawal record
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { txHash },
    });

    // Emit payout.status.confirmed event
    this.eventEmitter.emit(DomainEventNames.PAYOUT_STATUS_CONFIRMED, {
      payoutId: w.payoutId || id,
      withdrawId: id,
      txHash,
    });

    return { message: 'Payout confirmed simulated', withdrawId: id, txHash };
  }
```

> Note: The controller will need `PrismaService` and `EventEmitter2` injected. Add these to the constructor if not already present.

Required imports to add at the top of the controller:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
```

Add to constructor:
```typescript
  constructor(
    private readonly withdrawTransactionsService: WithdrawTransactionsService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    // ... existing params ...
  ) {}
```

- [ ] **Step 5: Verify compilation**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts
git commit -m "feat(withdraw): add KYT/TR/payout simulation endpoints for dev testing"
```

---

### Task 10: End-to-End Verification

Start the dev stack and verify the full happy path works through the simulation endpoints.

- [ ] **Step 1: Start the dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Wait for all services to be ready (backend on 3500, admin on 3501, client on 3502).

- [ ] **Step 2: Reset business data**

```bash
cd Exchange_js && npm run dev:reset
```

- [ ] **Step 3: Create a withdrawal via API**

Prerequisites: You need a customer with active compliance status, a USDT asset, a withdrawal address, and a pricing quote. Use the admin API or existing seed data to set these up.

```bash
# Adjust IDs based on your seed data
curl -X POST http://localhost:3500/client/withdraw-transactions \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "<USDT_ASSET_ID>",
    "amount": "100",
    "toWalletId": "<WALLET_ID>",
    "toAddress": "0xTEST",
    "quoteId": "<ACTIVE_QUOTE_ID>"
  }'
```

Expected: 201 Created with `status: PENDING_COMPLIANCE`.

- [ ] **Step 4: Simulate KYT Phase 1 PASS**

```bash
curl -X POST http://localhost:3500/admin/withdraw-transactions/<WITHDRAW_ID>/simulate/kyt-phase1 \
  -H "Content-Type: application/json" \
  -d '{ "result": "PASSED", "riskScore": 5 }'
```

- [ ] **Step 5: Simulate Travel Rule PASS**

```bash
curl -X POST http://localhost:3500/admin/withdraw-transactions/<WITHDRAW_ID>/simulate/travel-rule \
  -H "Content-Type: application/json" \
  -d '{ "result": "PASSED" }'
```

Expected after both: withdrawal status should transition to `PAYOUT_PENDING` (check via GET detail endpoint).

- [ ] **Step 6: Simulate Payout Confirmed**

```bash
curl -X POST http://localhost:3500/admin/withdraw-transactions/<WITHDRAW_ID>/simulate/payout-confirmed \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "0xHAPPYPATH123" }'
```

Expected: withdrawal status should transition to `SUCCESS`. TB pending transfers should be posted.

- [ ] **Step 7: Verify audit log trail**

```bash
curl http://localhost:3500/admin/audit-logs?entityType=WITHDRAW_TRANSACTION&entityId=<WITHDRAW_ID>
```

Expected audit actions in order: `WITHDRAW_REQUESTED`, `WITHDRAW_GATE0_PASSED`, `WITHDRAW_KYT_PHASE1_PASSED`, `WITHDRAW_TRAVEL_RULE_PASSED`, `WITHDRAW_COMPLIANCE_PASSED`, `WITHDRAW_ACCOUNTING_POSTED`, `WITHDRAW_SUCCESS`.

- [ ] **Step 8: Verify TB evidence records**

Check the TB transfer evidence table shows 4 records: 2 PENDING (net + fee) and 2 POST_PENDING (net + fee).

---

## Implementation Notes

### Status Naming Reconciliation
The spec uses `COMPLIANCE_PENDING` but the existing `WithdrawTransactionStatus` enum uses `PENDING_COMPLIANCE`. This plan uses `PENDING_COMPLIANCE` throughout to avoid breaking changes. The mapping:

| Spec name | Code enum value |
|-----------|----------------|
| `COMPLIANCE_PENDING` | `PENDING_COMPLIANCE` |
| `PAYOUT_PENDING` | `PAYOUT_PENDING` (matches) |
| `SUCCESS` | `SUCCESS` (matches) |

### What's NOT in This Plan
- **Payout creation/linking**: The current plan creates the withdrawal and simulates the payout confirmation. Full Payout integration (create Payout record, link payoutId, payout state machine progression) requires modifications to `PayoutsService` — deferred to a follow-up since the existing `payouts.service.ts` already handles the payout lifecycle.
- **KYT Phase 2**: The txHash enrichment flow (submit txHash back to Sumsub after broadcast) is logged but not fully implemented — requires Sumsub API integration.
- **Exception flows**: FROZEN, CANCELLED, FAILED, VOID pending — all deferred to the exception flows spec.
- **Client API endpoint**: The current `create()` method is called from the existing controller. If the route needs changing from internal to `/client/withdraw-transactions`, that's a controller routing change.

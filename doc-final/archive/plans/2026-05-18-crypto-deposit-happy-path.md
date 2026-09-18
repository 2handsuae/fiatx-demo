# Crypto Deposit Happy Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire TigerBeetle double-entry accounting into the crypto deposit workflow and fix all 11 architecture violations identified in the design spec.

**Architecture:** The deposit workflow moves from `src/orchestrators/` into `src/modules/trading/deposit-transactions/` and becomes the sole L3 orchestrator. L1 `DepositTransactionsService` is purified — audit logging and compliance gates move up to the workflow. Two TB transfers replace the empty accounting stub: CUSTODY→CLIENT_AUDIT on payin confirmed, CLIENT_AUDIT→CLIENT_CREDIT on deposit success.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle (via `AccountingService`), EventEmitter2

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts` | Add new statuses + actions, remove UNDER_REVIEW |
| Modify | `src/common/events/domain-events.constants.ts` | Register 3 domain events |
| Modify | `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | Purify L1: new state machine, remove audit/compliance, add `findByPayinId`, traceId generation |
| Move+Rewrite | `src/orchestrators/deposit-workflow.service.ts` → `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | L3 workflow: TB accounting, audit logging, compliance gates, event orchestration |
| Delete | `src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.ts` | Merged into deposit-workflow |
| Modify | `src/modules/trading/deposit-transactions/deposit-transactions.module.ts` | New imports/providers |
| Modify | `src/orchestrators/workflows.module.ts` | Remove deposit workflow |
| Create | `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` | TB transfer type codes |
| Modify | `prisma/schema.prisma` | Add `traceId` column to DepositTransaction |

---

### Task 1: Prisma Schema — Add traceId to DepositTransaction

**Files:**
- Modify: `prisma/schema.prisma:1512-1557`

- [ ] **Step 1: Add traceId column to DepositTransaction model**

In `prisma/schema.prisma`, inside the `DepositTransaction` model, add `traceId` after `travelRuleCheckedAt`:

```prisma
  travelRuleCheckedAt  DateTime?
  traceId              String?
  statusHistory        String?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js
npx prisma migrate dev --name add-deposit-trace-id
```
Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify generated client**

Run:
```bash
npx prisma generate
```
Expected: Prisma Client generated successfully.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "schema: add traceId column to DepositTransaction"
```

---

### Task 2: DTO — Update Status and Action Enums

**Files:**
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts`

- [ ] **Step 1: Update DepositTransactionStatus enum**

Replace the existing enum with:

```typescript
export enum DepositTransactionStatus {
  PAYIN_PENDING = 'PAYIN_PENDING',
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  ACTION_PENDING = 'ACTION_PENDING',
  SUCCESS = 'SUCCESS',
  FROZEN = 'FROZEN',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CONFISCATED = 'CONFISCATED',
}
```

Note: `UNDER_REVIEW` is removed. `ACTION_PENDING`, `EXPIRED`, `CONFISCATED` are added.

- [ ] **Step 2: Update DepositTransactionAction enum**

Replace the existing enum with:

```typescript
export enum DepositTransactionAction {
  PAYIN_CONFIRMED = 'payin_confirmed',
  APPROVE = 'approve',
  REJECT = 'reject',
  FREEZE = 'freeze',
  ACTION_PENDING = 'action_pending',
  RESUME = 'resume',
  CONFISCATE = 'confiscate',
  EXPIRE = 'expire',
  FAIL = 'fail',
}
```

Note: `SUCCESS` → `APPROVE`, `FLAG` removed. New actions: `ACTION_PENDING`, `RESUME`, `CONFISCATE`, `EXPIRE`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts
git commit -m "feat(deposit): update status/action enums per V4 state machine"
```

---

### Task 3: Domain Events — Register Payin and Deposit Events

**Files:**
- Modify: `src/common/events/domain-events.constants.ts`

- [ ] **Step 1: Add three domain event declarations**

Add three entries to the `DOMAIN_EVENTS` object, after `ASSET_PROVISIONED`:

```typescript
export const DOMAIN_EVENTS = {
  ASSET_PROVISIONED: {
    name: 'asset.provisioned',
    emitter: 'AssetListingWorkflowService',
    subscribers: ['TbAccountBatchService (to be refactored to workflow in Batch 2)'],
    payload: '{ assetId: string, assetNo: string, assetCode: string, tbLedgerId: number }',
  },
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
} as const;
```

- [ ] **Step 2: Update DomainEventNames**

```typescript
export const DomainEventNames = {
  ASSET_PROVISIONED: DOMAIN_EVENTS.ASSET_PROVISIONED.name,
  PAYIN_CREATED: DOMAIN_EVENTS.PAYIN_CREATED.name,
  PAYIN_STATUS_CHANGED: DOMAIN_EVENTS.PAYIN_STATUS_CHANGED.name,
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add src/common/events/domain-events.constants.ts
git commit -m "feat(events): register payin + deposit domain events"
```

---

### Task 4: TB Transfer Codes Constant

**Files:**
- Create: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [ ] **Step 1: Create transfer code constants**

```typescript
/** TB transfer type codes (u16). Immutable once assigned. */
export const TB_TRANSFER_CODES = {
  DEPOSIT_CUSTODY_TO_AUDIT: 1,
  DEPOSIT_AUDIT_TO_CREDIT: 2,
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat(tb): add deposit transfer type codes"
```

---

### Task 5: State Machine Rewrite in L1 Service

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:545-612`

- [ ] **Step 1: Rewrite getNextStatus method**

Replace the entire `getNextStatus` method (lines 545–612) with:

```typescript
  private getNextStatus(
    current: DepositTransactionStatus,
    action: DepositTransactionAction,
  ): DepositTransactionStatus {
    const TERMINAL = new Set([
      DepositTransactionStatus.SUCCESS,
      DepositTransactionStatus.REJECTED,
      DepositTransactionStatus.FAILED,
      DepositTransactionStatus.EXPIRED,
      DepositTransactionStatus.CONFISCATED,
    ]);

    if (TERMINAL.has(current)) {
      throw new BadRequestException(
        `Cannot apply action '${action}' to terminal status '${current}'`,
      );
    }

    const transitions: Record<
      string,
      Partial<Record<DepositTransactionAction, DepositTransactionStatus>>
    > = {
      [DepositTransactionStatus.PAYIN_PENDING]: {
        [DepositTransactionAction.PAYIN_CONFIRMED]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.COMPLIANCE_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.ACTION_PENDING]:
          DepositTransactionStatus.ACTION_PENDING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
      [DepositTransactionStatus.ACTION_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.RESUME]:
          DepositTransactionStatus.COMPLIANCE_PENDING,
        [DepositTransactionAction.EXPIRE]: DepositTransactionStatus.EXPIRED,
      },
      [DepositTransactionStatus.FROZEN]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.CONFISCATE]:
          DepositTransactionStatus.CONFISCATED,
      },
    };

    const nextStatus = transitions[current]?.[action];
    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid action '${action}' for status '${current}'`,
      );
    }

    return nextStatus;
  }
```

- [ ] **Step 2: Verify compile**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```
Expected: Compilation errors related to removed references (UNDER_REVIEW, FLAG, SUCCESS action) in other files. These will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts
git commit -m "feat(deposit): rewrite state machine per V4 spec"
```

---

### Task 6: Purify L1 Service — Remove Audit, Compliance, Deprecated Fields

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`

This task strips the L1 service down to pure domain operations. Audit logging and compliance gates move to the workflow (Task 8).

- [ ] **Step 1: Remove deprecated imports and fields**

Remove `AuditModules` from the import (keep `AuditActions`, `AuditEntityTypes`, `buildStateTransitionAction`). Remove `TransactionComplianceService` import. Remove `workflowId` and `workflowNo` from `DepositStatusUpdateOptions` interface.

Updated imports (replace lines 1-29):

```typescript
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DepositTransactionQueryDto,
  DepositTransactionStatus,
  UpdateDepositTransactionStatusDto,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import { v4 as uuidv4 } from 'uuid';
```

Updated `DepositStatusUpdateOptions` — remove `workflowId` and `workflowNo`:

```typescript
export interface DepositStatusUpdateOptions {
  tx?: Prisma.TransactionClient;
  actor?: DepositStatusUpdateActorContext;
  traceId?: string;
  workflowType?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  statusHistoryContext?: Record<string, unknown>;
  sourcePlatform?: string;
}
```

- [ ] **Step 2: Remove AuditLogsService and TransactionComplianceService from constructor**

Replace the constructor and remove the class fields for these services:

```typescript
@Injectable()
export class DepositTransactionsService {
  private readonly logger = new Logger(DepositTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
```

- [ ] **Step 3: Remove audit and compliance methods from L1**

Delete these methods entirely:
- `recordAuditEvent` (lines 97-115)
- `recordComplianceGateBlockedAudit` (lines 117-146)
- `assertComplianceBeforeSuccess` (lines 148-227)
- `deriveDepositComplianceStatusFromStatus` (lines 78-95)

- [ ] **Step 4: Simplify updateStatus — remove audit writes and compliance checks**

Replace `updateStatus` method. The L1 version only handles: state machine transition, status history, DB update, event emission. No audit logs, no compliance gate.

```typescript
  async updateStatus(
    id: string,
    dto: UpdateDepositTransactionStatusDto,
    options?: DepositStatusUpdateOptions,
  ) {
    const db = this.getDb(options?.tx);
    const transaction = await (db as any).depositTransaction.findUnique({
      where: { id },
    });
    if (!transaction) throw new NotFoundException('Deposit transaction not found');

    const currentStatus = transaction.status as DepositTransactionStatus;
    const action = dto.action;
    const nextStatus = this.getNextStatus(currentStatus, action);

    const historyEntry = {
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operatorId:
        options?.actor?.actorId ||
        this.normalizeOptionalString(options?.sourcePlatform) ||
        'SYSTEM',
      actorType: options?.actor?.actorType || 'SYSTEM',
      actorRole: options?.actor?.actorRole || null,
      reason: options?.reason || dto.reason || action,
      context: options?.statusHistoryContext || null,
    };

    let currentHistory = [];
    try {
      currentHistory = transaction.statusHistory
        ? JSON.parse(transaction.statusHistory)
        : [];
    } catch {
      currentHistory = [];
    }
    currentHistory.push(historyEntry);

    const updateData: any = {
      status: nextStatus,
      statusHistory: JSON.stringify(currentHistory),
    };

    if (
      nextStatus === DepositTransactionStatus.SUCCESS ||
      nextStatus === DepositTransactionStatus.FROZEN
    ) {
      updateData.completedAt = new Date();
    }

    const updated = await (db as any).depositTransaction.update({
      where: { id },
      data: updateData,
    });

    this.eventEmitter.emit(
      'deposit.status.changed',
      new DepositStatusChangedEvent(
        updated.id,
        currentStatus,
        nextStatus,
        updated.ownerType,
        updated.ownerId,
        updated.assetId,
        updated.amount.toString(),
        updated.payinId,
      ),
    );

    return updated;
  }
```

- [ ] **Step 5: Add findByPayinId service method and traceId generation**

Add `findByPayinId` method (replaces direct Prisma in workflow):

```typescript
  async findByPayinId(payinId: string) {
    return (this.prisma as any).depositTransaction.findUnique({
      where: { payinId },
    });
  }
```

Update `createFromPayin` to generate and persist a traceId:

```typescript
  async createFromPayin(
    amount: string,
    assetId: string,
    toWalletId: string,
    txHash?: string,
    fromAddress?: string,
    payinId?: string,
  ) {
    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { id: toWalletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const depositNo = generateReferenceNo('DEP');
    const traceId = uuidv4();
    const created = await (this.prisma as any).depositTransaction.create({
      data: {
        depositNo,
        traceId,
        ownerType: wallet.ownerType,
        ownerId: wallet.ownerId || 'UNKNOWN',
        status: DepositTransactionStatus.PAYIN_PENDING,
        statusHistory: JSON.stringify([
          {
            status: DepositTransactionStatus.PAYIN_PENDING,
            timestamp: new Date().toISOString(),
            operatorId: 'SYSTEM',
            reason: 'Created from Payin',
          },
        ]),
        assetId,
        toWalletId,
        payinId,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
        txHash,
        fromAddress,
        toAddress: wallet.address,
        toIban: wallet.iban,
      },
    });

    return created;
  }
```

Note: `createFromPayin` no longer writes an audit log (that moves to workflow). The returned `created` object now includes `traceId`.

- [ ] **Step 6: Clean up findAll to remove UNDER_REVIEW references**

In `findAll`, remove the `derivedComplianceStatus` computed field that references UNDER_REVIEW. Delete the `deriveDepositComplianceStatusFromStatus` method (already deleted in Step 3). Remove `derivedComplianceStatus` from the findAll return mapping:

```typescript
    return {
      items: items.map((item: any) => ({
        ...item,
        ownerNo:
          item.ownerNo ||
          (item.ownerType === 'CUSTOMER' ? item.customer?.customerNo || null : null),
        type: this.deriveDepositType(item.asset?.type),
      })),
      total,
    };
```

- [ ] **Step 7: Remove getDepositForStatusUpdate method**

This method (lines 229–256) was used by the old `updateStatus`. The new `updateStatus` does a simpler findUnique inline. Delete the entire `getDepositForStatusUpdate` method.

- [ ] **Step 8: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts
git commit -m "refactor(deposit): purify L1 — remove audit/compliance, add findByPayinId + traceId"
```

---

### Task 7: Rewrite and Move Deposit Workflow to Trading Module

**Files:**
- Create: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Delete: `src/orchestrators/deposit-workflow.service.ts`
- Delete: `src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`
- Modify: `src/orchestrators/workflows.module.ts`

This is the largest task. The new workflow service:
- Lives in the trading module (fix F1)
- Merges TransactionDepositWorkflowService functionality (fix F2)
- Uses DepositTransactionsService.findByPayinId instead of direct Prisma (fix L3)
- Uses PayinsService.updateStatus instead of direct tx.payin.update (fix L4)
- Owns all audit logging (fix L1)
- Owns compliance gate checks (fix L2)
- Integrates TB accounting (replaces empty stub)

- [ ] **Step 1: Create the new deposit-workflow.service.ts**

Create `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PayinStatusChangedEvent, PayinCreatedEvent } from '../../asset-treasury/payins/events/payin.events';
import {
  PayinStatus,
  PayinAction,
  PayinSimulationMode,
} from '../../asset-treasury/payins/dto/payin.dto';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
  DepositOwnerType,
} from './dto/deposit-transaction.dto';
import { PayinsService } from '../../asset-treasury/payins/payins.service';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

@Injectable()
export class DepositWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(DepositWorkflowService.name);

  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly payinsService: PayinsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogsService: AuditLogsService,
    private readonly accountingService: AccountingService,
  ) {}

  onModuleInit() {
    this.logger.log('DepositWorkflowService initialized and listening for events.');
  }

  // ── Event Handlers ──

  @OnEvent('payin.created')
  async handlePayinCreated(event: PayinCreatedEvent) {
    const { payinId, status } = event;
    this.logger.log(`Orchestrating new PayIn ${payinId} with status ${status}`);

    if (status === PayinStatus.DETECTED) {
      await this.orchestratePayinDetected(payinId);
    }
  }

  @OnEvent('payin.status.changed')
  async handlePayinStatusChanged(event: PayinStatusChangedEvent) {
    const { payinId, newStatus } = event;
    this.logger.log(`Orchestrating PayIn ${payinId} transition to ${newStatus}`);

    switch (newStatus) {
      case PayinStatus.DETECTED:
        await this.orchestratePayinDetected(payinId);
        break;
      case PayinStatus.FAILED:
        await this.orchestratePayinFailed(payinId);
        break;
      case PayinStatus.CONFIRMED:
        await this.orchestratePayinConfirmed(payinId);
        break;
    }
  }

  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent) {
    const { depositId, oldStatus, newStatus } = event;
    this.logger.log(`Deposit ${depositId} transitioned ${oldStatus} → ${newStatus}`);
  }

  /**
   * Called by the compliance decision function (or manual simulation) when
   * both KYT and Travel Rule checks pass. Does TB Step 2 first, then
   * transitions Deposit to SUCCESS. If TB fails, Deposit stays in current
   * status and enters the repair surface.
   */
  async approveDeposit(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);
    const oldStatus = deposit.status;

    if (
      oldStatus !== DepositTransactionStatus.COMPLIANCE_PENDING &&
      oldStatus !== DepositTransactionStatus.ACTION_PENDING &&
      oldStatus !== DepositTransactionStatus.FROZEN
    ) {
      this.logger.warn(`Deposit ${depositId} in ${oldStatus}, cannot approve.`);
      return;
    }

    // TB Step 2: CLIENT_AUDIT → CLIENT_CREDIT (must succeed before status transition)
    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      const payin = deposit.payinId
        ? await this.payinsService.findOne(deposit.payinId)
        : null;
      try {
        await this.executeDepositAccounting(deposit, payin, 'STEP_2');
      } catch (error) {
        this.logger.error(`TB Step 2 failed for deposit ${depositId}: ${error.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id,
          entityNo: deposit.depositNo,
          entityOwnerType: deposit.ownerType,
          entityOwnerId: deposit.ownerId,
          traceId: deposit.traceId || undefined,
          workflowType: 'DEPOSIT',
          result: AuditResult.FAILED,
          reason: `TB Step 2 failed: ${error.message}`,
          metadata: { eventCode: 'DEPOSIT_AUDIT_TO_CREDIT', step: 'STEP_2' },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }
    }

    // TB succeeded → transition to SUCCESS
    const updated = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.APPROVE,
    });

    await this.recordStateTransitionAudit(
      { ...deposit, ...updated },
      oldStatus,
      DepositTransactionStatus.SUCCESS,
      'Compliance approved, funds credited to client',
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_ACCOUNTING_POSTED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Compliance approved, funds credited to client',
      metadata: { eventCode: 'DEPOSIT_AUDIT_TO_CREDIT', step: 'STEP_2', oldStatus },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Deposit ${depositId} approved and credited.`);
  }

  // ── Orchestration Methods ──

  private async orchestratePayinDetected(payinId: string) {
    let deposit = await this.depositService.findByPayinId(payinId);
    if (!deposit) {
      const payin = await this.payinsService.findOne(payinId);
      deposit = await this.depositService.createFromPayin(
        payin.amount.toString(),
        payin.assetId,
        payin.toWalletId,
        payin.txHash || undefined,
        payin.fromAddress || undefined,
        payin.id,
      );
      await this.payinsService.linkDeposit(payinId, deposit.id);

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_CREATED_FROM_PAYIN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Deposit created from payin detection',
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async orchestratePayinFailed(payinId: string) {
    const deposit = await this.depositService.findByPayinId(payinId);
    if (
      deposit &&
      deposit.status !== DepositTransactionStatus.FAILED &&
      deposit.status !== DepositTransactionStatus.FROZEN &&
      deposit.status !== DepositTransactionStatus.REJECTED
    ) {
      const oldStatus = deposit.status;
      const updated = await this.depositService.updateStatus(deposit.id, {
        action: DepositTransactionAction.FAIL,
        reason: 'PayIn failed',
      });

      await this.recordStateTransitionAudit(updated, oldStatus, updated.status, 'PayIn failed');
    }
  }

  private async orchestratePayinConfirmed(payinId: string) {
    const deposit = await this.depositService.findByPayinId(payinId);
    if (!deposit) return;

    const payin = await this.payinsService.findOne(payinId);
    if (payin.status === PayinStatus.CLEARED) {
      this.logger.debug(`PayIn ${payinId} already CLEARED. Skipping.`);
      return;
    }

    if (deposit.status !== DepositTransactionStatus.PAYIN_PENDING) {
      this.logger.debug(`Deposit ${deposit.id} status ${deposit.status} not eligible for payin_confirmed.`);
      return;
    }

    // 1. TB Step 1: CUSTODY → CLIENT_AUDIT
    if (deposit.ownerType === DepositOwnerType.CUSTOMER) {
      try {
        await this.executeDepositAccounting(deposit, payin, 'STEP_1');
      } catch (error) {
        this.logger.error(`TB Step 1 failed for deposit ${deposit.id}: ${error.message}`);
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_ACCOUNTING_BLOCKED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id,
          entityNo: deposit.depositNo,
          entityOwnerType: deposit.ownerType,
          entityOwnerId: deposit.ownerId,
          traceId: deposit.traceId || undefined,
          workflowType: 'DEPOSIT',
          result: AuditResult.FAILED,
          reason: `TB Step 1 failed: ${error.message}`,
          metadata: {
            eventCode: 'DEPOSIT_CUSTODY_TO_AUDIT',
            step: 'STEP_1',
          },
          sourcePlatform: 'SYSTEM',
        });
        return;
      }
    }

    // 2. Deposit PAYIN_PENDING → COMPLIANCE_PENDING
    const updated = await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.PAYIN_CONFIRMED,
    });

    await this.recordStateTransitionAudit(
      { ...deposit, ...updated },
      DepositTransactionStatus.PAYIN_PENDING,
      DepositTransactionStatus.COMPLIANCE_PENDING,
      'Payin confirmed, deposit entering compliance review',
    );

    // 3. Payin → CLEARED (after TB accounting success)
    await this.payinsService.updateStatus(payinId, PayinAction.CLEAR);

    this.logger.log(`Deposit ${deposit.id} now COMPLIANCE_PENDING. Payin ${payinId} CLEARED.`);
  }

  // orchestrateDepositSuccess removed — TB Step 2 is now handled by
  // approveDeposit() which does accounting BEFORE the status transition,
  // matching the spec requirement that TB failure prevents SUCCESS.

  // ── TB Accounting ──

  private async executeDepositAccounting(
    deposit: any,
    payin: any | null,
    step: 'STEP_1' | 'STEP_2',
  ) {
    const asset = deposit.asset || (await this.getAssetForDeposit(deposit.id));
    if (!asset.tbLedgerId) {
      throw new Error(`Asset ${asset.code} has no tbLedgerId`);
    }

    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);

    if (step === 'STEP_1') {
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CUSTODY,
        ledger,
        ownerType: 'SYSTEM',
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_AUDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_CUSTODY_TO_AUDIT,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_CUSTODY_TO_AUDIT',
          debitCode: String(TB_ACCOUNT_CODES.CUSTODY),
          creditCode: String(TB_ACCOUNT_CODES.CLIENT_AUDIT),
          assetCode: asset.code,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Payin confirmed, funds in audit hold',
        },
      });

      this.logger.log(`TB Step 1 complete: CUSTODY→CLIENT_AUDIT for deposit ${deposit.depositNo}`);
    } else {
      const debitAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_AUDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });
      const creditAccountId = await this.accountingService.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
        ledger,
        ownerType: 'CUSTOMER',
        ownerUuid: deposit.ownerId,
      });

      await this.accountingService.executeTransfer({
        debitAccountId,
        creditAccountId,
        amount: amountBigint,
        ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_AUDIT_TO_CREDIT,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: deposit.depositNo,
          eventCode: 'DEPOSIT_AUDIT_TO_CREDIT',
          debitCode: String(TB_ACCOUNT_CODES.CLIENT_AUDIT),
          creditCode: String(TB_ACCOUNT_CODES.CLIENT_CREDIT),
          assetCode: asset.code,
          traceId: deposit.traceId || deposit.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          memo: 'Compliance approved, funds credited',
        },
      });

      this.logger.log(`TB Step 2 complete: CLIENT_AUDIT→CLIENT_CREDIT for deposit ${deposit.depositNo}`);
    }
  }

  // ── Helpers ──

  private async getAssetForDeposit(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);
    return deposit?.asset;
  }

  private decimalToBigint(decimalValue: any, decimals: number): bigint {
    const str = String(decimalValue);
    const [whole, frac = ''] = str.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  private async recordStateTransitionAudit(
    deposit: any,
    fromStatus: string,
    toStatus: string,
    reason: string,
  ) {
    await this.auditLogsService.recordSystem({
      action: buildStateTransitionAction('DEPOSIT', fromStatus, toStatus),
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason,
      sourcePlatform: 'SYSTEM',
    });
  }
}
```

- [ ] **Step 2: Delete old files**

Delete the old orchestrator:
```bash
rm src/orchestrators/deposit-workflow.service.ts
```

Delete the merged TransactionDepositWorkflowService:
```bash
rm src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.ts
```

Delete associated spec files if they exist:
```bash
rm -f src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.spec.ts
```

- [ ] **Step 3: Update deposit-transactions.module.ts**

Replace the entire file:

```typescript
import { Module } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { PayinsModule } from '../../asset-treasury/payins/payins.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { DepositWorkflowService } from './deposit-workflow.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  imports: [PayinsModule, OnboardingModule, TigerBeetleModule],
  controllers: [DepositTransactionsController],
  providers: [
    DepositTransactionsService,
    InboundTransferSignalsService,
    DepositWorkflowService,
  ],
  exports: [DepositTransactionsService],
})
export class DepositTransactionsModule {}
```

Note: `TransactionComplianceModule` import removed (L2 fix). `TigerBeetleModule` added. `TransactionDepositWorkflowService` removed. `DepositWorkflowService` now lives here.

- [ ] **Step 4: Update workflows.module.ts — remove deposit workflow**

Replace the entire file:

```typescript
import { forwardRef, Module } from '@nestjs/common';
import { WithdrawWorkflowOrchestrator } from './withdraw-workflow.orchestrator';
import { PayinsModule } from '../modules/asset-treasury/payins/payins.module';
import { SwapTransactionsModule } from '../modules/trading/swap-transactions/swap-transactions.module';
import { WithdrawTransactionsModule } from '../modules/trading/withdraw-transactions/withdraw-transactions.module';
import { PayoutsModule } from '../modules/asset-treasury/payouts/payouts.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import { TransactionComplianceModule } from '../modules/risk-engine/transaction-compliance/transaction-compliance.module';
import { InternalTransactionsModule } from '../modules/asset-treasury/internal-transactions/internal-transactions.module';
import { InternalFundsModule } from '../modules/asset-treasury/internal-funds/internal-funds.module';
import { WalletsModule } from '../modules/asset-treasury/wallets/wallets.module';
import { InternalCollectionWorkflowOrchestrator } from './internal-collection-workflow.orchestrator';
import { PayoutCloseoutRepairController } from './payout-closeout-repair.controller';

@Module({
  imports: [
    PayinsModule,
    SwapTransactionsModule,
    WithdrawTransactionsModule,
    PayoutsModule,
    PrismaModule,
    TransactionComplianceModule,
    forwardRef(() => InternalTransactionsModule),
    InternalFundsModule,
    WalletsModule,
  ],
  controllers: [PayoutCloseoutRepairController],
  providers: [
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
  exports: [
    WithdrawWorkflowOrchestrator,
    InternalCollectionWorkflowOrchestrator,
  ],
})
export class WorkflowsModule {}
```

Note: `DepositWorkflowService` removed. `DepositTransactionsModule` import removed (no longer needed).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(deposit): move workflow to trading module, integrate TB accounting, merge transaction-deposit-workflow"
```

---

### Task 8: Fix Remaining References to Removed Types

**Files:**
- Modify: various files referencing `UNDER_REVIEW`, `FLAG`, `SUCCESS` (as action), `AuditModules`, `TransactionDepositWorkflowService`

- [ ] **Step 1: Find all remaining references to removed types**

Run:
```bash
cd Exchange_js
grep -rn "UNDER_REVIEW\|DepositTransactionAction\.FLAG\|DepositTransactionAction\.SUCCESS\|TransactionDepositWorkflowService\|transaction-deposit-workflow" src/ --include="*.ts" | grep -v "node_modules" | grep -v ".spec.ts"
```

Fix each file found:
- Replace `DepositTransactionAction.SUCCESS` → `DepositTransactionAction.APPROVE`
- Replace `DepositTransactionAction.FLAG` → remove or replace with `DepositTransactionAction.ACTION_PENDING`
- Replace `DepositTransactionStatus.UNDER_REVIEW` → `DepositTransactionStatus.COMPLIANCE_PENDING`
- Remove imports of `TransactionDepositWorkflowService`

- [ ] **Step 2: Fix deposit-transactions.controller.ts**

In the controller, update any references to old action/status names. Likely updates:
- Any endpoint that uses `FLAG` action → use `ACTION_PENDING`
- Any endpoint that uses `SUCCESS` action → use `APPROVE`

- [ ] **Step 3: Fix findOne in deposit-transactions.service.ts**

The `findOne` method (lines 326-455) still depends on `TransactionComplianceService`. Since L1 should not depend on compliance, move the compliance-enriched `findOne` into the workflow or a dedicated query service. For now, simplify `findOne` to return raw deposit data without compliance enrichments:

```typescript
  async findOne(id: string) {
    const item = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        wallet: true,
        fromWallet: true,
        payin: true,
        customer: {
          select: {
            customerNo: true,
            firstName: true,
            lastName: true,
            email: true,
            onboardingStatus: true,
            adminStatus: true,
            complianceStatus: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deposit transaction not found');

    const deposit = item as any;
    let ownerNo = deposit.ownerNo;
    if (!ownerNo && deposit.ownerType === 'CUSTOMER' && deposit.customer) {
      ownerNo = deposit.customer.customerNo;
    }

    return {
      ...item,
      ownerNo,
      type: this.deriveDepositType(deposit.asset?.type),
      payinNo: deposit.payin?.payinNo,
      payinStatus: deposit.payin?.status || null,
      payinType: deposit.payin?.type || null,
      toWalletNo: deposit.wallet?.walletNo,
      fromWalletNo: deposit.fromWallet?.walletNo,
    };
  }
```

Note: Compliance-enriched detail (kytCase, travelRuleCase, finalAlert, etc.) should be provided by a separate controller endpoint or query service that the admin UI calls. This is outside the scope of this task but maintains the L1 purity.

- [ ] **Step 4: Remove AuditModules from transaction-deposit-workflow references**

Since `transaction-deposit-workflow.service.ts` is deleted, check that no other file imports from it:

```bash
grep -rn "transaction-deposit-workflow" src/ --include="*.ts" | grep -v ".spec.ts"
```

If any files reference it, update them to use the new `DepositWorkflowService` path.

- [ ] **Step 5: Verify compilation**

Run:
```bash
npx tsc --noEmit 2>&1 | head -50
```
Expected: Clean compilation or only warnings.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(deposit): update all references to new V4 status/action enums"
```

---

### Task 9: Verify — Compile + Start Dev Stack

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript compilation check**

```bash
cd Exchange_js && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Start dev stack**

```bash
npm run dev:start
```
Expected: Backend starts on port 3500, no startup errors related to deposit workflow.

- [ ] **Step 3: Verify module initialization**

Check logs for:
```
DepositWorkflowService initialized and listening for events.
```
This confirms the workflow is properly registered in the trading module.

- [ ] **Step 4: Run existing tests**

```bash
npm run test -- --passWithNoTests 2>&1 | tail -20
```

Review results. Fix any test failures caused by the refactoring.

- [ ] **Step 5: Commit any test fixes**

```bash
git add -A
git commit -m "fix: resolve test failures from deposit V4 refactor"
```

---

### Task 10: E2E Happy Path Verification

**Files:** None (verification only)

Per spec Section 7 — verify using the existing simulation flow:

- [ ] **Step 1: Create Inbound Transfer Signal (simulate chain deposit)**

Use the admin API to create a signal:
```bash
curl -X POST http://localhost:3500/admin/inbound-transfer-signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{ ... }'
```

Or use the admin UI simulation controls.

- [ ] **Step 2: Execute scan → Payin DETECTED → CONFIRMING → CONFIRMED**

Trigger the scan process and observe logs.

- [ ] **Step 3: Verify Deposit created and enters COMPLIANCE_PENDING**

```bash
curl http://localhost:3500/admin/deposit-transactions?status=COMPLIANCE_PENDING \
  -H "Authorization: Bearer <admin-token>"
```

- [ ] **Step 4: Verify TB CUSTODY→CLIENT_AUDIT Transfer exists**

Check via TB admin endpoint or evidence table.

- [ ] **Step 5: Verify Payin status is CLEARED**

```bash
curl http://localhost:3500/admin/payins/<payin-id> \
  -H "Authorization: Bearer <admin-token>"
```

- [ ] **Step 6: Simulate Sumsub KYT APPROVED + TR COMPLETED → Deposit SUCCESS**

Manually trigger deposit approval via the workflow's `approveDeposit` method (since Sumsub webhook integration is not in scope). This can be done via an admin endpoint that calls `DepositWorkflowService.approveDeposit(depositId)`, or via a one-off script/REPL. The key point: approval MUST go through the workflow, not directly via L1 `updateStatus`, because TB Step 2 must execute before the status transition.

- [ ] **Step 7: Verify TB CLIENT_AUDIT→CLIENT_CREDIT Transfer exists**

Check TB evidence table for the second transfer.

- [ ] **Step 8: Verify customer balance reflects deposit**

Use the balance endpoint or TB admin to confirm the customer's CLIENT_CREDIT account balance increased.

---

## Spec Coverage Verification

| Spec Item | Task |
|---|---|
| TB Step 1: CUSTODY→CLIENT_AUDIT | Task 7 (executeDepositAccounting STEP_1) |
| TB Step 2: CLIENT_AUDIT→CLIENT_CREDIT | Task 7 (approveDeposit → executeDepositAccounting STEP_2) |
| F1: Move workflow to trading module | Task 7 |
| F2: Merge TransactionDepositWorkflowService | Task 7 |
| F3: Update module registrations | Task 7 |
| L1: Audit writes move to Workflow | Task 6 + Task 7 |
| L2: Compliance dependency removed from L1 | Task 6 + Task 8 |
| L3: findDepositByPayinId via service | Task 6 (findByPayinId) + Task 7 |
| L4: Payin update via PayinsService | Task 7 (orchestratePayinConfirmed) |
| D1: Remove AuditModules import | Task 6 |
| D2: Remove workflowId/workflowNo | Task 6 |
| D3: traceId → UUID v4 | Task 1 (schema) + Task 6 (generation) |
| S1: Remove UNDER_REVIEW | Task 2 + Task 5 |
| S2: Add ACTION_PENDING/EXPIRED/CONFISCATED | Task 2 + Task 5 |
| S3: Fix FROZEN (only approve/confiscate) | Task 5 |
| S4: Fix FAILED (reject all actions) | Task 5 |
| E1-E3: Domain events registration | Task 3 |
| Happy path verification | Task 10 |

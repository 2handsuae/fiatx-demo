# Withdraw Large-Value Approval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-step SENIOR_MANAGEMENT_OFFICER approval gate to the withdrawal flow that triggers when a withdrawal's gross value is ≥ 200,000 AED (Binance market rate, fail-closed), placed before the L2 compliance screen.

**Architecture:** Reuse the existing event-driven withdraw workflow. The domain service creates the withdrawal in `CREATED` state with the TB pending lock already done, then emits `WITHDRAWAL_CREATED`. The workflow (`WithdrawWorkflowService.handleWithdrawalCreated`) becomes the branch point: it values the gross amount in AED and either opens an approval case (→ `PENDING_APPROVAL`) or proceeds straight to compliance (→ `PENDING_COMPLIANCE`). The SMO decides in the existing Approval Center; `ApprovalHandlerBase` re-emits `workflow.withdraw-large-value-approval.decided`, which the workflow consumes to either start the compliance screen or reject and void the TB lock.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle accounting adapter, `@nestjs/event-emitter`, Jest. Spec: `doc-final/superpowers/specs/2026-06-01-withdraw-large-value-approval-gate-design.md`.

---

## File Structure

**Create:**
- `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.ts` — threshold constant + pure `shouldRequireApproval` helper + system actor.
- `src/modules/trading/withdraw-transactions/withdraw-large-value-approval.service.ts` — `ApprovalHandlerBase` subclass (4 constants).
- `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts` — unit test for the pure helper.

**Modify:**
- `prisma/schema.prisma` — add valuation snapshot + approval link fields to `WithdrawTransaction`.
- `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts` — add `PENDING_APPROVAL` status + `REQUIRE_APPROVAL` / `GATE_APPROVE` actions.
- `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` — new transitions; `create()` initial status `CREATED`; `saveValuationSnapshot()`, `linkApprovalCase()`.
- `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` — valuation branch + decided handler + void-on-reject; inject `BinanceRateProvider`.
- `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts` — import `ApprovalsModule` + `PricingCenterModule`; register the approval service.
- `src/modules/governance/approvals/constants/approval.constants.ts` — `WITHDRAW_LARGE_VALUE_APPROVAL` action type + `DEFAULT_APPROVAL_POLICIES` entry.
- `src/modules/audit-logging/constants/audit-actions.constant.ts` — 3 audit actions + 1 business workflow type.
- `admin-web/src/pages/WithdrawTransactionDetail.tsx` — "Approval Gate" card.
- `client-web/src/pages/Withdraw.tsx` — add `PENDING_APPROVAL` to the "Processing" filter CSV.

---

## Task 1: Prisma schema — valuation snapshot + approval link fields

**Files:**
- Modify: `prisma/schema.prisma` (model `WithdrawTransaction`)

- [ ] **Step 1: Add the fields**

In `model WithdrawTransaction`, immediately after the `traceId String?` line, add:

```prisma
  grossAedValue        Decimal?
  aedRate              Decimal?
  rateFetchedAt        DateTime?
  rateFetchFailed      Boolean               @default(false)
  approvalCaseId       String?
  approvalNo           String?
```

- [ ] **Step 2: Generate the migration and client**

Run: `npx prisma migrate dev --name withdraw_large_value_approval`
Expected: migration created under `prisma/migrations/`, "Your database is now in sync", Prisma Client regenerated. All six fields are nullable / defaulted, so existing rows are unaffected.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `WithdrawTransaction`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(withdraw): add approval-gate valuation + link fields to schema"
```

---

## Task 2: DTO enums + state machine transitions

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:67-107` (the `transitions` map)
- Test: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe('WithdrawTransactionsService', ...)` block in `withdraw-transactions.service.spec.ts`:

```typescript
describe('approval-gate transitions', () => {
  const baseItem = {
    id: 'w1',
    withdrawNo: 'WD-1',
    ownerType: 'CUSTOMER',
    ownerId: 'c1',
    asset: { type: 'CRYPTO' },
    statusHistory: '[]',
    approvedAt: null,
    payoutRequestedAt: null,
    completedAt: null,
  };

  function arrangeItem(status: string) {
    mockTx.withdrawTransaction.findUnique.mockResolvedValue({ ...baseItem, status });
    mockTx.withdrawTransaction.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...baseItem, status: data.status }),
    );
  }

  it('CREATED → REQUIRE_APPROVAL → PENDING_APPROVAL', async () => {
    arrangeItem(WithdrawTransactionStatus.CREATED);
    const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REQUIRE_APPROVAL }, { source: 'WORKFLOW' });
    expect(res.status).toBe(WithdrawTransactionStatus.PENDING_APPROVAL);
  });

  it('PENDING_APPROVAL → GATE_APPROVE → PENDING_COMPLIANCE', async () => {
    arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
    const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' });
    expect(res.status).toBe(WithdrawTransactionStatus.PENDING_COMPLIANCE);
  });

  it('PENDING_APPROVAL → REJECT → REJECTED', async () => {
    arrangeItem(WithdrawTransactionStatus.PENDING_APPROVAL);
    const res = await service.updateStatus('w1', { action: WithdrawTransactionAction.REJECT }, { source: 'WORKFLOW' });
    expect(res.status).toBe(WithdrawTransactionStatus.REJECTED);
  });

  it('rejects GATE_APPROVE from CREATED', async () => {
    arrangeItem(WithdrawTransactionStatus.CREATED);
    await expect(
      service.updateStatus('w1', { action: WithdrawTransactionAction.GATE_APPROVE }, { source: 'WORKFLOW' }),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts -t "approval-gate transitions"`
Expected: FAIL — `WithdrawTransactionStatus.PENDING_APPROVAL` / `WithdrawTransactionAction.REQUIRE_APPROVAL` are `undefined`, transitions missing.

- [ ] **Step 3: Add the enum members**

In `dto/withdraw-transaction.dto.ts`, add to `enum WithdrawTransactionStatus` (after `CREATED = 'CREATED',`):

```typescript
  PENDING_APPROVAL = 'PENDING_APPROVAL',
```

Add to `enum WithdrawTransactionAction` (after `CHECK = 'check',`):

```typescript
  REQUIRE_APPROVAL = 'require_approval',
  GATE_APPROVE = 'gate_approve',
```

- [ ] **Step 4: Add the transitions**

In `withdraw-transactions.service.ts`, in the `transitions` map: extend the `CREATED` entry and add a `PENDING_APPROVAL` entry.

Replace the existing `[WithdrawTransactionStatus.CREATED]: { ... }` block with:

```typescript
    [WithdrawTransactionStatus.CREATED]: {
      [WithdrawTransactionAction.REQUIRE_APPROVAL]: WithdrawTransactionStatus.PENDING_APPROVAL,
      [WithdrawTransactionAction.CHECK]: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
    [WithdrawTransactionStatus.PENDING_APPROVAL]: {
      [WithdrawTransactionAction.GATE_APPROVE]: WithdrawTransactionStatus.PENDING_COMPLIANCE,
      [WithdrawTransactionAction.REJECT]: WithdrawTransactionStatus.REJECTED,
      [WithdrawTransactionAction.CANCEL]: WithdrawTransactionStatus.CANCELLED,
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts -t "approval-gate transitions"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts
git commit -m "feat(withdraw): add PENDING_APPROVAL state + approval-gate transitions"
```

---

## Task 3: Constants — audit actions, approval action type, default policy

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add audit actions**

In `audit-actions.constant.ts`, in the `AuditActions` object, after the line `WITHDRAW_SUCCESS: 'WITHDRAW_SUCCESS',` add:

```typescript
  WITHDRAW_APPROVAL_REQUESTED: 'WITHDRAW_APPROVAL_REQUESTED',
  WITHDRAW_APPROVAL_GRANTED: 'WITHDRAW_APPROVAL_GRANTED',
  WITHDRAW_APPROVAL_DECLINED: 'WITHDRAW_APPROVAL_DECLINED',
```

- [ ] **Step 2: Add the business workflow type**

In `audit-actions.constant.ts`, in the `AuditBusinessWorkflowTypes` object, before the closing `} as const;`, after the `TRADING_TIER_UPGRADE: 'TRADING_TIER_UPGRADE',` line add:

```typescript
  // Withdraw Large-Value Approval Gate (2026-06-01)
  WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
```

> Note: the kebab form of this value (`withdraw-large-value-approval`) determines the `ApprovalHandlerBase` secondary event name `workflow.withdraw-large-value-approval.decided`. Do not rename without updating the workflow subscriber in Task 7.

- [ ] **Step 3: Add the approval action type**

In `approval.constants.ts`, in the `ApprovalActionTypes` object, before the closing `} as const;`, after the `SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',` line add:

```typescript
  // Withdraw Large-Value Approval Gate (2026-06-01)
  WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
```

- [ ] **Step 4: Add the default policy**

In `approval.constants.ts`, in the `DEFAULT_APPROVAL_POLICIES` object, add a new entry (place it next to the other trading entries, before the closing `};`):

```typescript
  [ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```

> `ApprovalPolicyService.getPolicy()` falls back to `DEFAULT_APPROVAL_POLICIES` when no DB override row exists, so no DB seed/backfill is required.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(withdraw): register large-value approval action type, policy, audit actions"
```

---

## Task 4: WithdrawLargeValueApprovalService + module wiring

**Files:**
- Create: `src/modules/trading/withdraw-transactions/withdraw-large-value-approval.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`

- [ ] **Step 1: Create the approval handler**

Create `withdraw-large-value-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class WithdrawLargeValueApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.WITHDRAW_LARGE_VALUE_APPROVAL;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 2: Wire the module**

In `withdraw-transactions.module.ts`:

Add imports at the top:

```typescript
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawLargeValueApprovalService } from './withdraw-large-value-approval.service';
```

Add `ApprovalsModule` and `PricingCenterModule` to the `imports` array (after `WithdrawalFeeLevelModule`):

```typescript
    WithdrawalFeeLevelModule,
    ApprovalsModule,
    PricingCenterModule,
```

Add `WithdrawLargeValueApprovalService` to the `providers` array (after `WithdrawWorkflowService`):

```typescript
    WithdrawWorkflowService,
    WithdrawLargeValueApprovalService,
```

- [ ] **Step 3: Verify the app boots (DI resolves)**

Run: `npx tsc --noEmit`
Expected: no errors. (Full boot is verified in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-large-value-approval.service.ts src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts
git commit -m "feat(withdraw): add large-value approval handler + module wiring"
```

---

## Task 5: Threshold constant + pure decision helper (TDD)

**Files:**
- Create: `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.ts`
- Test: `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `withdraw-approval.constant.spec.ts`:

```typescript
import { Prisma } from '@prisma/client';
import {
  WITHDRAW_APPROVAL_AED_THRESHOLD,
  shouldRequireApproval,
} from './withdraw-approval.constant';

describe('shouldRequireApproval', () => {
  it('threshold is 200000 AED', () => {
    expect(WITHDRAW_APPROVAL_AED_THRESHOLD.toString()).toBe('200000');
  });

  it('returns true at exactly the threshold (>=)', () => {
    expect(shouldRequireApproval({ grossAedValue: new Prisma.Decimal('200000'), rateFetchFailed: false })).toBe(true);
  });

  it('returns false just below the threshold', () => {
    expect(shouldRequireApproval({ grossAedValue: new Prisma.Decimal('199999.99'), rateFetchFailed: false })).toBe(false);
  });

  it('fail-closed: returns true when the rate fetch failed', () => {
    expect(shouldRequireApproval({ grossAedValue: null, rateFetchFailed: true })).toBe(true);
  });

  it('fail-closed: returns true when value is missing', () => {
    expect(shouldRequireApproval({ grossAedValue: null, rateFetchFailed: false })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the constant + helper**

Create `withdraw-approval.constant.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';

/** Gross-value threshold (AED) at or above which a withdrawal requires SMO approval. */
export const WITHDRAW_APPROVAL_AED_THRESHOLD = new Prisma.Decimal(200000);

/** System maker context for opening the gate approval (checker = SMO; no SoD collision). */
export const SYSTEM_APPROVAL_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

/**
 * Decide whether a withdrawal needs the large-value approval gate.
 * Fail-closed: a missing value or a failed rate fetch routes to approval.
 */
export function shouldRequireApproval(input: {
  grossAedValue: Prisma.Decimal | null;
  rateFetchFailed: boolean;
}): boolean {
  if (input.rateFetchFailed) return true;
  if (!input.grossAedValue) return true;
  return input.grossAedValue.gte(WITHDRAW_APPROVAL_AED_THRESHOLD);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.ts src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts
git commit -m "feat(withdraw): add AED threshold + fail-closed approval decision helper"
```

---

## Task 6: Domain service — valuation snapshot, approval link, initial status

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

- [ ] **Step 1: Change `create()` initial status to CREATED**

In `create()`, in the `tx.withdrawTransaction.create({ data: { ... } })` call, change:

```typescript
              status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
```

to:

```typescript
              status: WithdrawTransactionStatus.CREATED,
```

And change the `statusHistory` seed note in the same `create` call from:

```typescript
                status: WithdrawTransactionStatus.PENDING_COMPLIANCE,
                timestamp: new Date().toISOString(),
                operator: 'SYSTEM',
                note: 'Withdrawal created and moved to compliance pending'
```

to:

```typescript
                status: WithdrawTransactionStatus.CREATED,
                timestamp: new Date().toISOString(),
                operator: 'SYSTEM',
                note: 'Withdrawal created — awaiting approval-gate valuation'
```

> The TB pending lock, `WITHDRAW_REQUESTED` audit, and `WITHDRAWAL_CREATED` emit are unchanged. The workflow now decides the next state.

- [ ] **Step 2: Add `saveValuationSnapshot()` and `linkApprovalCase()`**

In `withdraw-transactions.service.ts`, add these two methods near `linkPayout` (around line 1064):

```typescript
  async saveValuationSnapshot(
    id: string,
    snapshot: {
      grossAedValue: Prisma.Decimal | null;
      aedRate: Prisma.Decimal | null;
      rateFetchedAt: Date | null;
      rateFetchFailed: boolean;
    },
  ) {
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: {
        grossAedValue: snapshot.grossAedValue,
        aedRate: snapshot.aedRate,
        rateFetchedAt: snapshot.rateFetchedAt,
        rateFetchFailed: snapshot.rateFetchFailed,
      },
    });
  }

  async linkApprovalCase(id: string, approvalCaseId: string, approvalNo: string) {
    await (this.prisma as any).withdrawTransaction.update({
      where: { id },
      data: { approvalCaseId, approvalNo },
    });
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the existing service tests (no regressions)**

Run: `npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`
Expected: PASS (existing tests + Task 2's approval-gate transitions).

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
git commit -m "feat(withdraw): create in CREATED state + snapshot/link persistence methods"
```

---

## Task 7: Workflow — valuation branch in handleWithdrawalCreated

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`

- [ ] **Step 1: Add imports and inject dependencies**

At the top of `withdraw-workflow.service.ts`, add:

```typescript
import { Prisma } from '@prisma/client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import {
  shouldRequireApproval,
  SYSTEM_APPROVAL_ACTOR,
} from './constants/withdraw-approval.constant';
```

Add to the constructor parameter list (after `payoutsService`):

```typescript
    private readonly approvalsService: ApprovalsService,
    private readonly binanceRateProvider: BinanceRateProvider,
```

Add a reusable system status-update context as a private field on the class (near the `logger` field):

```typescript
  private readonly systemCtx = {
    source: 'WORKFLOW' as const,
    actorType: 'SYSTEM',
    actorId: 'WITHDRAW_WORKFLOW',
    sourcePlatform: 'SYSTEM',
  };
```

- [ ] **Step 2: Replace the body of `handleWithdrawalCreated`**

Replace the existing `handleWithdrawalCreated` method body (the line `await this.initializeTransactionScreen(event.withdrawId);`) with the branch:

```typescript
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
    const w = await this.withdrawService.findOneInternal(event.withdrawId);
    if (w.status !== WithdrawTransactionStatus.CREATED) {
      this.logger.debug(`Skip branch: withdrawal ${event.withdrawId} already ${w.status}`);
      return;
    }

    const valuation = await this.valuateAed(w);
    await this.withdrawService.saveValuationSnapshot(w.id, valuation);

    if (shouldRequireApproval(valuation)) {
      await this.openApprovalGate(w, valuation);
    } else {
      this.logger.log(`Withdrawal ${event.withdrawId} below approval threshold — proceeding to compliance`);
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.CHECK },
        this.systemCtx,
      );
      await this.initializeTransactionScreen(w.id);
    }
  }

  private async valuateAed(w: {
    amount: Prisma.Decimal | string;
    asset?: { currency?: string | null } | null;
  }): Promise<{
    grossAedValue: Prisma.Decimal | null;
    aedRate: Prisma.Decimal | null;
    rateFetchedAt: Date | null;
    rateFetchFailed: boolean;
  }> {
    const amount = new Prisma.Decimal(w.amount);
    const currency = w.asset?.currency || '';
    try {
      const r = await this.binanceRateProvider.fetchRate(currency, 'AED');
      return {
        grossAedValue: amount.mul(r.rate),
        aedRate: r.rate,
        rateFetchedAt: r.fetchedAt,
        rateFetchFailed: false,
      };
    } catch (err) {
      this.logger.warn(`AED valuation failed for ${currency}: ${(err as Error).message} — fail-closed to approval`);
      return { grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: true };
    }
  }

  private async openApprovalGate(
    w: { id: string; withdrawNo: string; ownerType: string; ownerId: string; traceId: string | null },
    valuation: { grossAedValue: Prisma.Decimal | null; rateFetchFailed: boolean },
  ) {
    await this.withdrawService.updateStatus(
      w.id,
      { action: WithdrawTransactionAction.REQUIRE_APPROVAL },
      this.systemCtx,
    );

    const approval = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL,
        entityRef: w.id,
        traceId: w.traceId || undefined,
        objectSnapshot: {
          withdrawNo: w.withdrawNo,
          ownerType: w.ownerType,
          ownerId: w.ownerId,
          grossAedValue: valuation.grossAedValue?.toString() || null,
          rateFetchFailed: valuation.rateFetchFailed,
        },
      },
      { reason: `Withdrawal ${w.withdrawNo} ≥ 200000 AED — senior management approval required`, traceId: w.traceId || undefined },
      SYSTEM_APPROVAL_ACTOR,
    );

    await this.withdrawService.linkApprovalCase(w.id, approval.id, approval.approvalNo);

    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_APPROVAL_REQUESTED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Large-value approval requested (case ${approval.approvalNo})`,
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Withdrawal ${w.id} now PENDING_APPROVAL — approval ${approval.approvalNo} opened`);
  }
```

Add the missing imports for the enums/actions used above to the existing import of the DTO and audit constants (these symbols are already imported in this file; confirm `WithdrawTransactionAction`, `WithdrawTransactionStatus`, `AuditActions`, `AuditEntityTypes`, `AuditWorkflowTypes` are present — they are).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat(withdraw): valuation branch opens SMO gate above 200K AED (fail-closed)"
```

---

## Task 8: Workflow — approval decision handler (approve → compliance, reject → void)

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`

- [ ] **Step 1: Add the decided-event handler and void helper**

In `withdraw-workflow.service.ts`, add these methods to the class (after `openApprovalGate`):

```typescript
  @OnEvent('workflow.withdraw-large-value-approval.decided', { async: true })
  async onLargeValueApprovalDecided(payload: {
    decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
    entityRef: string;
    approvalNo: string;
    decisionReason?: string | null;
  }) {
    const w = await this.withdrawService.findOneInternal(payload.entityRef);
    if (w.status !== WithdrawTransactionStatus.PENDING_APPROVAL) {
      this.logger.debug(`Skip decided: withdrawal ${payload.entityRef} is ${w.status}, not PENDING_APPROVAL`);
      return;
    }

    if (payload.decision === 'APPROVED') {
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.GATE_APPROVE },
        this.systemCtx,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_APPROVAL_GRANTED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Large-value approval granted (case ${payload.approvalNo}) — proceeding to compliance`,
        sourcePlatform: 'SYSTEM',
      });
      await this.initializeTransactionScreen(w.id);
    } else {
      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.REJECT, reason: `Approval ${payload.decision}: ${payload.decisionReason || 'no reason'}` },
        this.systemCtx,
      );
      await this.voidWithdrawPending(w);
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_APPROVAL_DECLINED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Large-value approval ${payload.decision} (case ${payload.approvalNo}) — pending lock voided`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async voidWithdrawPending(w: {
    id: string;
    netAmount: Prisma.Decimal | string;
    feeAmount: Prisma.Decimal | string;
    tbPendingNetId: string | null;
    tbPendingFeeId: string | null;
    asset?: { decimals?: number | null } | null;
  }) {
    const decimals = w.asset?.decimals ?? 8;
    if (w.tbPendingNetId) {
      await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingNetId),
        this.decimalToBigint(w.netAmount, decimals),
      );
    }
    if (w.tbPendingFeeId) {
      await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingFeeId),
        this.decimalToBigint(w.feeAmount, decimals),
      );
    }
  }
```

> `hexToBigint`, `decimalToBigint`, `accountingService`, and `AuditActions`/`AuditEntityTypes`/`AuditWorkflowTypes` are already imported/available in this file (used by `finalizeWithdrawal`).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat(withdraw): handle gate decision — approve to compliance, reject voids lock"
```

---

## Task 9: Frontend — admin Approval Gate card + client filter

**Files:**
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx`
- Modify: `client-web/src/pages/Withdraw.tsx`

- [ ] **Step 1: Extend the admin detail data type**

In `WithdrawTransactionDetail.tsx`, add to the interface that types `data` (the one containing `status: string;` near line 40), after `status: string;`:

```typescript
  grossAedValue?: string | null;
  aedRate?: string | null;
  rateFetchedAt?: string | null;
  rateFetchFailed?: boolean | null;
  approvalNo?: string | null;
```

- [ ] **Step 2: Add the Approval Gate card**

In `WithdrawTransactionDetail.tsx`, immediately before the existing `<DetailCard title="Transaction Details" ...>` (around line 276), add a conditional card:

```tsx
          {(data.approvalNo || data.grossAedValue || data.rateFetchFailed) && (
            <DetailCard title="Approval Gate" columns={2}>
              <InfoField label="Approval No" value={data.approvalNo || '—'} mono />
              <InfoField label="Gross Value (AED)" value={data.grossAedValue ? Number(data.grossAedValue).toLocaleString() : '—'} accent />
              <InfoField label="AED Rate" value={data.aedRate || '—'} mono />
              <InfoField label="Rate Fetched At" value={data.rateFetchedAt ? new Date(data.rateFetchedAt).toLocaleString() : '—'} />
              {data.rateFetchFailed ? (
                <InfoField label="Valuation" value="Rate fetch failed — routed to approval (fail-closed)" />
              ) : null}
            </DetailCard>
          )}
```

- [ ] **Step 3: Add PENDING_APPROVAL to the client "Processing" filter**

In `client-web/src/pages/Withdraw.tsx`, update the filter option value (the `<option value="CREATED,PENDING_COMPLIANCE,...">Processing</option>` near line 480) to include `PENDING_APPROVAL`:

```tsx
                              <option value="CREATED,PENDING_APPROVAL,PENDING_COMPLIANCE,UNDER_REVIEW,APPROVED,PAYOUT_PENDING,FROZEN">Processing</option>
```

> No change to `getCustomerFacingWithdrawStatus` is needed — its catch-all already maps `PENDING_APPROVAL` to the calm "Processing" label.

- [ ] **Step 4: Verify both frontends typecheck/build**

Run: `cd admin-web && npx tsc --noEmit && cd ../client-web && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/WithdrawTransactionDetail.tsx client-web/src/pages/Withdraw.tsx
git commit -m "feat(withdraw): admin approval-gate card + client Processing filter for PENDING_APPROVAL"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full withdraw test suite**

Run: `npx jest src/modules/trading/withdraw-transactions`
Expected: PASS — all existing specs plus the new transition + helper tests.

- [ ] **Step 2: Typecheck the whole backend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Boot the stack and smoke-test the gate**

Run: `npm run dev:start` (API 3500, Admin 3501, Client 3502, TigerBeetle 3503 per CLAUDE.md).

Manual checks:
- Create a customer crypto withdrawal whose `amount × Binance(asset→AED)` ≥ 200,000 AED. Expected: withdrawal status `PENDING_APPROVAL`; an approval case of type `WITHDRAW_LARGE_VALUE_APPROVAL` appears in the Admin Approval Center; the Withdraw detail shows the Approval Gate card.
- As an `SENIOR_MANAGEMENT_OFFICER` user, approve the case. Expected: withdrawal advances to `PENDING_COMPLIANCE` and the L2 screen begins (Pre-KYT/Travel Rule statuses populate); audit log shows `WITHDRAW_APPROVAL_REQUESTED` then `WITHDRAW_APPROVAL_GRANTED`.
- Create a second large withdrawal, then reject its approval case. Expected: withdrawal status `REJECTED`; the TB pending net/fee transfers are voided (customer balance unlocked); audit shows `WITHDRAW_APPROVAL_DECLINED`.
- Create a small withdrawal (< 200,000 AED). Expected: goes straight to `PENDING_COMPLIANCE` (no approval case), exactly as before.

- [ ] **Step 4: Confirm no regression in the existing happy path**

Drive a small crypto + a small fiat withdrawal end-to-end (using the existing simulate endpoints) to `SUCCESS`. Expected: unchanged behaviour.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test(withdraw): verify large-value approval gate end-to-end"
```

---

## Self-Review Notes (for the implementer)

- The secondary event string `workflow.withdraw-large-value-approval.decided` is derived from `AuditBusinessWorkflowTypes.WITHDRAW_LARGE_VALUE_APPROVAL`. If you change that constant's value, update the `@OnEvent(...)` string in Task 8 to match.
- `create()` now leaves the record in `CREATED`; the workflow is the only place that advances it. If `WITHDRAWAL_CREATED` is ever emitted twice, the `status !== CREATED` guard makes the second handling a no-op (idempotent). The decided handler is likewise guarded on `PENDING_APPROVAL`.
- Fail-closed means a Binance outage routes even small withdrawals to SMO approval — intended, see spec §6.

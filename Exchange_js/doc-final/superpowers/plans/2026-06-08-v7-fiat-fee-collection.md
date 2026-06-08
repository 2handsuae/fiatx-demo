# V7 Fiat Fee Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect fiat fees per-event: customer-paid fees (withdrawal fee, swap service fee) move `C_VIBAN→F_FEE` direct per-customer; swap spread moves `F_LIQ→F_FEE` pool-level — all draining a specific amount from `FEE_RECEIVABLE→BANK`.

**Architecture:** The fiat swap IN-settlement is changed to deliver **gross** (net + service fee) so the fee physically lands in the VIBAN. A new `FiatFeeCollectionWorkflowService` (L3) spawns single-hop fee-collect transfers and drains the exact fee amount on completion. Swap fees are triggered when a swap's IN settlement completes (in-process call from the settlement workflow); withdrawal fees are triggered by `WITHDRAWAL_STATUS_CHANGED → SUCCESS`. Crypto fee collection (`C_MAIN→F_OPS` full drain) is untouched.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle, Jest (unit tests, mocked deps).

**Spec:** `doc-final/superpowers/specs/2026-06-08-v7-fiat-fee-collection-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts` | path whitelist | add `FIAT_FEE_COLLECT` (C_VIBAN→F_FEE), `FIAT_SPREAD_COLLECT` (F_LIQ→F_FEE) — single-hop |
| `src/modules/funds-layer/accounting/funds-accounting.service.ts` | TB drain | add `drainFeeReceivableAmount({internalTransferId, amount, tx?})` (specific amount) |
| `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts` | settlement | IN delivers gross (net + swap fee); on IN settlement complete → call fee collection |
| `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts` | **new** L3 | spawn fee/spread collect transfers; drain on completion; withdrawal-fee handler |
| `src/modules/funds-layer/funds-layer.module.ts` | DI | register `FiatFeeCollectionWorkflowService` |
| `scripts/seed-fiat-settle-demo.ts` | demo | extend to show fee + spread collection (or new script) |

Tests run with: `npm test -- <spec-file-name>` (jest). Commit only the files listed per task (working tree has unrelated WIP — never `git add -A`).

---

## Phase 0 — Foundation

### Task 1: Add fee-collect whitelist paths

**Files:**
- Modify: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`
- Test: extend `src/modules/funds-layer/guards/whitelist.guard.spec.ts`

These are **single-hop** (direct, no F_SET), so they use `from`/`to` (resolved by the existing `resolvePathPolicy`/`assertWhitelisted`), not `route`.

- [ ] **Step 1: Write the failing test**

Add to `whitelist.guard.spec.ts`:

```typescript
describe('WhitelistGuard.assertWhitelisted (fiat fee collection)', () => {
  const guard = new WhitelistGuard();

  it('accepts C_VIBAN→F_FEE (FIAT_FEE_COLLECT), class B, BANK, drain FEE_RECEIVABLE', () => {
    const p = guard.assertWhitelisted('C_VIBAN', 'F_FEE');
    expect(p.path).toBe('FIAT_FEE_COLLECT');
    expect(p.class).toBe('B');
    expect(p.medium).toBe('BANK');
    expect(p.drain).toBe('FEE_RECEIVABLE');
  });

  it('accepts F_LIQ→F_FEE (FIAT_SPREAD_COLLECT)', () => {
    const p = guard.assertWhitelisted('F_LIQ', 'F_FEE');
    expect(p.path).toBe('FIAT_SPREAD_COLLECT');
    expect(p.drain).toBe('FEE_RECEIVABLE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- whitelist.guard.spec.ts`
Expected: FAIL — `from=C_VIBAN to=F_FEE is not a whitelisted internal transfer path`.

- [ ] **Step 3: Add the two enum members + whitelist entries**

In `internal-transfer-paths.constant.ts`, add to `enum TransferPath` (after `FIAT_SETTLE_IN`):
```typescript
  FIAT_FEE_COLLECT   = 'FIAT_FEE_COLLECT',
  FIAT_SPREAD_COLLECT = 'FIAT_SPREAD_COLLECT',
```

Add to `TRANSFER_PATH_WHITELIST` (after `FIAT_SETTLE_IN`):
```typescript
  [TransferPath.FIAT_FEE_COLLECT]: {
    path: TransferPath.FIAT_FEE_COLLECT,
    from: 'C_VIBAN',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP', 'WITHDRAW'],
    drain: 'FEE_RECEIVABLE',
  },
  [TransferPath.FIAT_SPREAD_COLLECT]: {
    path: TransferPath.FIAT_SPREAD_COLLECT,
    from: 'F_LIQ',
    to: 'F_FEE',
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'FEE_RECEIVABLE',
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- whitelist.guard.spec.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/constants/internal-transfer-paths.constant.ts src/modules/funds-layer/guards/whitelist.guard.spec.ts
git commit -m "feat(v7): fiat fee-collect whitelist paths (C_VIBAN/F_LIQ -> F_FEE)"
```

---

### Task 2: Specific-amount FEE_RECEIVABLE drain

**Files:**
- Modify: `src/modules/funds-layer/accounting/funds-accounting.service.ts`
- Test: extend `src/modules/funds-layer/accounting/funds-accounting.service.spec.ts`

The existing `applyAccounting` drains the **full** `FEE_RECEIVABLE` balance (sign-driven). Per-event fee collection must drain **only this fee's amount**. Add a dedicated method that posts `debit FEE_RECEIVABLE / credit BANK` (FIAT) for an explicit amount.

- [ ] **Step 1: Write the failing test**

Add to `funds-accounting.service.spec.ts` (mirror the existing harness mocking `AccountingService.resolveTbAccountId` / `executeTransfer`):

```typescript
it('drainFeeReceivableAmount posts FEE_RECEIVABLE->BANK for the given amount (FIAT)', async () => {
  // transfer 't-fee' has asset.type FIAT (AED), amount 0.18
  await service.drainFeeReceivableAmount({ internalTransferId: 't-fee', amount: new Prisma.Decimal('0.18') });
  const codes = accounting.resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
  expect(codes).toContain(TB_ACCOUNT_CODES.FEE_RECEIVABLE);
  expect(codes).toContain(TB_ACCOUNT_CODES.BANK);
  // executeTransfer debits FEE_RECEIVABLE, credits BANK, amount = decimal->tb units
  const xfer = accounting.executeTransfer.mock.calls[0][0];
  expect(xfer.amount).toBe(18n); // 0.18 AED at 2 decimals
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-accounting.service.spec.ts`
Expected: FAIL — `service.drainFeeReceivableAmount is not a function`.

- [ ] **Step 3: Implement the method**

In `funds-accounting.service.ts`, add (uses the same `decimalToBigint` conversion the file already uses for amounts — if the file lacks one, convert via `currency` ledger like `applyAccounting` does; reuse the existing helpers/imports `TB_ACCOUNT_CODES`, `TB_TRANSFER_CODES`, `TB_LEDGERS`, `TB_CODE_TO_COA`):

```typescript
  /**
   * Drain an EXACT fee amount from FEE_RECEIVABLE into the custody account
   * (BANK for fiat, CUSTODY for crypto) for one fee-collection transfer.
   * Unlike applyAccounting (full-balance, sign-driven) this drains only `amount`.
   */
  async drainFeeReceivableAmount(input: {
    internalTransferId: string;
    amount: Prisma.Decimal;
    tx?: Prisma.TransactionClient;
  }): Promise<{ tbApplied: boolean; tbTransferId?: bigint }> {
    const db = input.tx ?? this.prisma;
    const transfer = await db.internalTransaction.findUnique({
      where: { id: input.internalTransferId },
      include: { asset: true },
    });
    if (!transfer) {
      throw new NotFoundException({
        code: 'INTERNAL_TRANSFER_NOT_FOUND',
        message: `Internal transfer ${input.internalTransferId} not found`,
      });
    }

    const currency = transfer.asset.currency;
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new NotFoundException({
        code: 'TB_LEDGER_NOT_FOUND',
        message: `Unsupported asset currency for TB accounting: ${currency}`,
      });
    }

    const decimals = transfer.asset.decimals;
    const amountUnits = this.decimalToTbUnits(input.amount, decimals);
    if (amountUnits <= 0n) return { tbApplied: false };

    const counterpartyCode =
      transfer.asset.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;

    const feeReceivableId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FEE_RECEIVABLE, ledger, ownerType: 'SYSTEM',
    });
    const counterpartyId = await this.accounting.resolveTbAccountId({
      code: counterpartyCode, ledger, ownerType: 'SYSTEM',
    });

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId: feeReceivableId,
      creditAccountId: counterpartyId,
      amount: amountUnits,
      ledger,
      code: TB_TRANSFER_CODES.FEE_DRAIN,
      tx: input.tx,
      evidence: {
        sourceType: 'FIAT_FEE_COLLECTION',
        sourceNo: transfer.internalTxNo,
        eventCode: 'FEE_DRAIN',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FEE_RECEIVABLE],
        creditCode: TB_CODE_TO_COA[counterpartyCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `FEE:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: 'FIAT fee collection drain',
      },
    });
    return { tbApplied: true, tbTransferId };
  }

  private decimalToTbUnits(value: Prisma.Decimal, decimals: number): bigint {
    const str = value.toFixed(decimals);
    const [whole, frac = ''] = str.split('.');
    const padded = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + padded);
  }
```

> If `funds-accounting.service.ts` already has a decimal→units helper, reuse it instead of adding `decimalToTbUnits`. Verify `executeTransfer`'s signature matches the existing `applyAccounting` call in the same file (debitAccountId/creditAccountId/amount/ledger/code/tx/evidence).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-accounting.service.spec.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/accounting/funds-accounting.service.ts src/modules/funds-layer/accounting/funds-accounting.service.spec.ts
git commit -m "feat(v7): drainFeeReceivableAmount (specific-amount FEE_RECEIVABLE drain)"
```

---

## Phase 1 — Gross settlement

### Task 3: IN fiat settlement delivers gross (net + service fee)

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts` (`onSwapSucceeded`)
- Test: extend `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts`

For a **direction IN** fiat outstanding (customer buying fiat — the TO leg, where the fee accrues), settlement must deliver `gross = outstanding.amount(net) + swap.feeAmount`. Direction OUT stays net (no fee on the from-leg). Fetch the source swap once for `feeAmount`.

- [ ] **Step 1: Write the failing test**

Add to `fiat-settlement-workflow.service.spec.ts` (the harness mocks `prisma`, services; add a `prisma.swapTransaction.findUnique` mock):

```typescript
it('IN fiat outstanding settles GROSS = net + swap fee', async () => {
  consumer.findOpenFiatBySwap.mockResolvedValue([
    { id: 'o-aed', direction: 'IN', amount: '36.541375', assetId: 'a-aed', assetCode: 'AED', ownerId: 'c1', ownerType: 'CUSTOMER', ownerNo: 'CUST-1', sourceNo: 'SWP-1' },
  ]);
  prisma.swapTransaction.findUnique.mockResolvedValue({ id: 'swap-1', feeAmount: '0.10', spreadAmount: '0.18' });

  await service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' });

  const tArgs = transfers.createTransfer.mock.calls[0][0];
  // gross = 36.541375 + 0.10
  expect(tArgs.amount.toString()).toBe('36.641375');
  // both funds carry gross too
  expect(fundsFlow.createLeg.mock.calls[0][0].amount.toString()).toBe('36.641375');
});
```
Add `swapTransaction: { findUnique: jest.fn() }` to the `prisma` mock in this spec's `beforeEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts -t "GROSS"`
Expected: FAIL — amount is `36.541375` (net), not gross.

- [ ] **Step 3: Implement gross delivery**

In `onSwapSucceeded`, fetch the swap once before the loop:
```typescript
      const swap = await (this.prisma as any).swapTransaction.findUnique({
        where: { id: event.swapId },
        select: { feeAmount: true, spreadAmount: true },
      });
      const swapFee = new Prisma.Decimal(swap?.feeAmount ?? 0);
```
Inside the loop, replace `const amount = new Prisma.Decimal(o.amount);` with:
```typescript
        // IN (buying fiat) delivers GROSS = net + service fee, so the fee lands in
        // the VIBAN to be collected (VIBAN→F_FEE). OUT stays net (no fee on from-leg).
        const net = new Prisma.Decimal(o.amount);
        const amount = isOut ? net : net.plus(swapFee);
```
(`amount` is already used for both the transfer and the two `createLeg` calls — they all become gross for IN.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts`
Expected: PASS (existing + new; the existing OUT-direction test still settles net).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
git commit -m "feat(v7): fiat IN settlement delivers gross (net + swap service fee)"
```

---

## Phase 2 — Swap fee + spread collection

### Task 4: FiatFeeCollectionWorkflowService.collectSwapFees

**Files:**
- Create: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`
- Test: create `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts`

`collectSwapFees(swapId)` reads the swap, and for the fiat TO leg spawns: (1) `FIAT_FEE_COLLECT` `C_VIBAN→F_FEE` (amount = swap.feeAmount, owner = customer) if fee>0; (2) `FIAT_SPREAD_COLLECT` `F_LIQ→F_FEE` (amount = swap.spreadAmount, owner = PLATFORM) if spread>0. Each = 1 transfer + 1 fund (single hop). Idempotent per `sourceType=FIAT_FEE_COLLECTION` + `sourceId`.

- [ ] **Step 1: Write the failing test**

Create the spec (mirror `fiat-settlement-workflow.service.spec.ts` harness — mock `prisma`, `transfers`, `fundsFlow`, `accounting`, `systemWallets`, `whitelist=new WhitelistGuard()`):

```typescript
it('collectSwapFees spawns VIBAN->F_FEE (fee) and F_LIQ->F_FEE (spread)', async () => {
  prisma.swapTransaction.findUnique.mockResolvedValue({
    id: 'swap-1', swapNo: 'SWP-1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CUST-1',
    toAssetId: 'a-aed', feeAmount: '0.10', spreadAmount: '0.18',
    toAsset: { type: 'FIAT' },
  });
  prisma.internalTransaction.findFirst.mockResolvedValue(null); // not yet collected

  await service.collectSwapFees('swap-1');

  const paths = transfers.createTransfer.mock.calls.map((c: any[]) => c[0].path);
  expect(paths).toContain('FIAT_FEE_COLLECT');
  expect(paths).toContain('FIAT_SPREAD_COLLECT');
  const feeCall = transfers.createTransfer.mock.calls.find((c: any[]) => c[0].path === 'FIAT_FEE_COLLECT')[0];
  expect(feeCall.amount.toString()).toBe('0.1');
  expect(feeCall.fromWalletId).toBe('w-C_VIBAN-c1');
  expect(feeCall.toWalletId).toBe('w-F_FEE');
  const spreadCall = transfers.createTransfer.mock.calls.find((c: any[]) => c[0].path === 'FIAT_SPREAD_COLLECT')[0];
  expect(spreadCall.fromWalletId).toBe('w-F_LIQ');
  expect(spreadCall.toWalletId).toBe('w-F_FEE');
  expect(fundsFlow.createLeg).toHaveBeenCalledTimes(2);
  expect(accounting.drainFeeReceivableAmount).not.toHaveBeenCalled(); // drain happens on completion
});

it('collectSwapFees is a no-op when TO asset is not fiat', async () => {
  prisma.swapTransaction.findUnique.mockResolvedValue({ id: 'swap-2', toAsset: { type: 'CRYPTO' }, feeAmount: '1', spreadAmount: '0' });
  await service.collectSwapFees('swap-2');
  expect(transfers.createTransfer).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts`
Expected: FAIL — cannot resolve `FiatFeeCollectionWorkflowService`.

- [ ] **Step 3: Implement the service (creation half)**

Create `fiat-fee-collection-workflow.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import {
  AccountingClass, TransferMedium, TransferPath,
} from '../constants/internal-transfer-paths.constant';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

const FEE_SOURCE_TYPE = 'FIAT_FEE_COLLECTION';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string; internalTransferId: string | undefined; oldStatus: string; newStatus: string;
}

@Injectable()
export class FiatFeeCollectionWorkflowService {
  private readonly logger = new Logger(FiatFeeCollectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: FundsAccountingService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly whitelist: WhitelistGuard,
  ) {}

  /** Spawn a single-hop fee-collect transfer (1 transfer + 1 fund). Idempotent per sourceId. */
  private async spawnCollect(input: {
    path: TransferPath; fromWalletId: string; toWalletId: string;
    assetId: string; amount: Prisma.Decimal;
    ownerType: string; ownerId: string; ownerNo: string | null;
    sourceId: string; sourceNo: string | null;
  }) {
    const existing = await (this.prisma as any).internalTransaction.findFirst({
      where: { sourceType: FEE_SOURCE_TYPE, sourceId: input.sourceId },
    });
    if (existing) return existing;

    const policy = this.whitelist.assertWhitelisted(
      // resolve from/to roles via the path's policy endpoints
      input.path === TransferPath.FIAT_SPREAD_COLLECT ? 'F_LIQ' : 'C_VIBAN',
      'F_FEE',
    );

    const transfer = await this.transfers.createTransfer({
      path: policy.path,
      accountingClass: AccountingClass.B,
      medium: TransferMedium.BANK,
      triggerSource: 'SWAP',
      sourceType: FEE_SOURCE_TYPE,
      sourceId: input.sourceId,
      sourceNo: input.sourceNo,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ownerNo: input.ownerNo,
      assetId: input.assetId,
      amount: input.amount,
      feeAmount: new Prisma.Decimal(0),
      netAmount: input.amount,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      settlementBatchId: null,
    });
    await this.fundsFlow.createLeg({
      internalTransactionId: transfer.id,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      amount: input.amount,
      status: InternalFundStatus.CREATED,
    });
    return transfer;
  }

  /** Collect a swap's fiat fees: customer fee (VIBAN→F_FEE) + spread (F_LIQ→F_FEE). */
  async collectSwapFees(swapId: string): Promise<void> {
    const swap = await (this.prisma as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: {
        id: true, swapNo: true, ownerType: true, ownerId: true, ownerNo: true,
        toAssetId: true, feeAmount: true, spreadAmount: true,
        toAsset: { select: { type: true } },
      },
    });
    if (!swap || swap.toAsset?.type !== 'FIAT') return; // fee accrues in TO currency; only fiat TO

    const fee = new Prisma.Decimal(swap.feeAmount ?? 0);
    const spread = new Prisma.Decimal(swap.spreadAmount ?? 0);

    if (fee.gt(0)) {
      const viban = await this.systemWallets.resolveCustomer(swap.toAssetId, 'C_VIBAN', swap.ownerId);
      const fFee = await this.systemWallets.resolve(swap.toAssetId, 'F_FEE');
      await this.spawnCollect({
        path: TransferPath.FIAT_FEE_COLLECT,
        fromWalletId: viban.id, toWalletId: fFee.id,
        assetId: swap.toAssetId, amount: fee,
        ownerType: swap.ownerType, ownerId: swap.ownerId, ownerNo: swap.ownerNo,
        sourceId: `${swap.id}:FEE`, sourceNo: swap.swapNo,
      });
    }
    if (spread.gt(0)) {
      const fLiq = await this.systemWallets.resolve(swap.toAssetId, 'F_LIQ');
      const fFee = await this.systemWallets.resolve(swap.toAssetId, 'F_FEE');
      await this.spawnCollect({
        path: TransferPath.FIAT_SPREAD_COLLECT,
        fromWalletId: fLiq.id, toWalletId: fFee.id,
        assetId: swap.toAssetId, amount: spread,
        ownerType: 'PLATFORM', ownerId: 'PLATFORM', ownerNo: null,
        sourceId: `${swap.id}:SPREAD`, sourceNo: swap.swapNo,
      });
    }
  }
}
```

> The test mocks `systemWallets.resolve`/`resolveCustomer` to return `{id:'w-<role>'}` / `{id:'w-<role>-<owner>'}` — match that convention in the spec's `beforeEach`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts
git commit -m "feat(v7): FiatFeeCollectionWorkflowService.collectSwapFees (fee + spread)"
```

---

### Task 5: Fee-collect completion → specific-amount drain

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`
- Test: extend its spec

A fee-collect transfer is single-hop (1 fund). When the fund reaches CLEAR, drain the transfer's exact amount `FEE_RECEIVABLE→BANK`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('onFundsFlowStatusChanged', () => {
  it('CLEAR for a FIAT_FEE_COLLECTION transfer drains the exact amount', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 't-fee', sourceType: 'FIAT_FEE_COLLECTION', amount: '0.10',
    });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f1', internalTransferId: 't-fee', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(accounting.drainFeeReceivableAmount).toHaveBeenCalledWith(
      expect.objectContaining({ internalTransferId: 't-fee' }),
    );
    const arg = accounting.drainFeeReceivableAmount.mock.calls[0][0];
    expect(arg.amount.toString()).toBe('0.1');
  });

  it('ignores non-fee transfers', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({ id: 't-x', sourceType: 'FIAT_SETTLEMENT' });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-x', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(accounting.drainFeeReceivableAmount).not.toHaveBeenCalled();
  });

  it('ignores non-CLEAR', async () => {
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-fee', oldStatus: 'CREATED', newStatus: 'CONFIRMED' });
    expect(prisma.internalTransaction.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts -t onFundsFlowStatusChanged`
Expected: FAIL — `service.onFundsFlowStatusChanged is not a function`.

- [ ] **Step 3: Implement the handler**

Add to `FiatFeeCollectionWorkflowService`:

```typescript
  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent): Promise<void> {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;
    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      if (!transfer || transfer.sourceType !== FEE_SOURCE_TYPE) return;
      // single-hop → single CLEAR; drain the exact fee amount FEE_RECEIVABLE→BANK.
      await this.accounting.drainFeeReceivableAmount({
        internalTransferId: transfer.id,
        amount: new Prisma.Decimal(transfer.amount),
      });
    } catch (err) {
      this.logger.error(
        `Fiat fee drain failed for transfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts
git commit -m "feat(v7): fee-collect completion drains exact FEE_RECEIVABLE amount"
```

---

### Task 6: Trigger swap fee collection on IN settlement completion

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts`
- Test: extend its spec

After the settlement workflow settles an **IN** fiat outstanding (CLEAR completion branch), call `feeCollection.collectSwapFees(swapId)`. The swapId is the first segment of `transfer.sourceId` (`<swapId>:<outstandingId>`).

- [ ] **Step 1: Write the failing test**

Add to `fiat-settlement-workflow.service.spec.ts` (add a `FiatFeeCollectionWorkflowService` mock provider `{ collectSwapFees: jest.fn() }`):

```typescript
it('on IN settlement CLEAR, triggers swap fee collection with the swapId', async () => {
  prisma.internalTransaction.findUnique.mockResolvedValue({
    id: 't-1', sourceType: 'FIAT_SETTLEMENT', settlementBatchId: 'b-1',
    pathLabel: 'FIAT_SETTLE_IN', sourceId: 'swap-1:o-aed',
  });
  consumer.settle.mockResolvedValue({ count: 1 });
  await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop2', internalTransferId: 't-1', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
  expect(feeCollection.collectSwapFees).toHaveBeenCalledWith('swap-1');
});

it('does NOT trigger fee collection for FIAT_SETTLE_OUT', async () => {
  prisma.internalTransaction.findUnique.mockResolvedValue({
    id: 't-2', sourceType: 'FIAT_SETTLEMENT', settlementBatchId: 'b-1',
    pathLabel: 'FIAT_SETTLE_OUT', sourceId: 'swap-2:o-x',
  });
  consumer.settle.mockResolvedValue({ count: 1 });
  await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-2', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
  expect(feeCollection.collectSwapFees).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts -t "fee collection"`
Expected: FAIL — `collectSwapFees` not called (and DI for the new dep).

- [ ] **Step 3: Wire it**

Inject the fee-collection service into `FiatSettlementWorkflowService` constructor:
```typescript
    private readonly feeCollection: FiatFeeCollectionWorkflowService,
```
(import it). In `onFundsFlowStatusChanged`, after the existing `recomputeBatch` in the CLEAR branch:
```typescript
      // Swap fee/spread collection rides along once the IN (buy-fiat) settlement
      // completes — the gross is now in the VIBAN, so the fee can be pulled.
      if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) {
        const swapId = String(transfer.sourceId || '').split(':')[0];
        if (swapId) await this.feeCollection.collectSwapFees(swapId);
      }
```
Add `TransferPath` to the import from the paths constant (the file currently imports `AccountingClass`).

> Watch DI direction: `FiatSettlementWorkflowService → FiatFeeCollectionWorkflowService` (one-way; the fee service does NOT inject the settlement service → no circular dependency).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
git commit -m "feat(v7): trigger swap fee collection on IN settlement completion"
```

---

## Phase 3 — Withdrawal fee collection

### Task 7: Collect withdrawal fee on WITHDRAWAL_STATUS_CHANGED → SUCCESS

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`
- Test: extend its spec

On a fiat withdrawal reaching terminal SUCCESS, the fee is posted to FEE_RECEIVABLE and sits in the VIBAN → spawn `FIAT_FEE_COLLECT` `C_VIBAN→F_FEE` (amount = withdraw.feeAmount).

- [ ] **Step 1: Write the failing test**

```typescript
describe('onWithdrawalStatusChanged', () => {
  it('SUCCESS + FIAT withdrawal → spawns VIBAN->F_FEE for the withdraw fee', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'w-1', withdrawNo: 'WD-1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CUST-1',
      assetId: 'a-aed', feeAmount: '5', asset: { type: 'FIAT' },
    });
    prisma.internalTransaction.findFirst.mockResolvedValue(null);
    await service.onWithdrawalStatusChanged({ withdrawId: 'w-1', oldStatus: 'APPROVED', newStatus: 'SUCCESS', ownerType: 'CUSTOMER', ownerId: 'c1', assetId: 'a-aed', amount: '100' });
    const call = transfers.createTransfer.mock.calls[0][0];
    expect(call.path).toBe('FIAT_FEE_COLLECT');
    expect(call.amount.toString()).toBe('5');
    expect(call.fromWalletId).toBe('w-C_VIBAN-c1');
    expect(call.sourceId).toBe('w-1:FEE');
  });

  it('ignores non-SUCCESS', async () => {
    await service.onWithdrawalStatusChanged({ withdrawId: 'w-1', oldStatus: 'CREATED', newStatus: 'APPROVED', ownerType: 'CUSTOMER', ownerId: 'c1', assetId: 'a-aed', amount: '100' });
    expect(prisma.withdrawTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('ignores crypto withdrawals (fee not fiat)', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({ id: 'w-2', assetId: 'a-usdt', feeAmount: '1', asset: { type: 'CRYPTO' } });
    await service.onWithdrawalStatusChanged({ withdrawId: 'w-2', oldStatus: 'APPROVED', newStatus: 'SUCCESS', ownerType: 'CUSTOMER', ownerId: 'c1', assetId: 'a-usdt', amount: '1' });
    expect(transfers.createTransfer).not.toHaveBeenCalled();
  });
});
```
Add `withdrawTransaction: { findUnique: jest.fn() }` to the prisma mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts -t onWithdrawalStatusChanged`
Expected: FAIL — `service.onWithdrawalStatusChanged is not a function`.

- [ ] **Step 3: Implement the handler**

Add to `FiatFeeCollectionWorkflowService` (the event payload interface mirrors `WITHDRAWAL_STATUS_CHANGED`):

```typescript
  @OnEvent(DomainEventNames.WITHDRAWAL_STATUS_CHANGED)
  async onWithdrawalStatusChanged(event: {
    withdrawId: string; oldStatus: string; newStatus: string;
    ownerType: string; ownerId: string; assetId: string; amount: string;
  }): Promise<void> {
    if (event.newStatus !== 'SUCCESS') return;
    try {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({
        where: { id: event.withdrawId },
        select: {
          id: true, withdrawNo: true, ownerType: true, ownerId: true, ownerNo: true,
          assetId: true, feeAmount: true, asset: { select: { type: true } },
        },
      });
      if (!w || w.asset?.type !== 'FIAT') return;
      const fee = new Prisma.Decimal(w.feeAmount ?? 0);
      if (!fee.gt(0)) return;

      const viban = await this.systemWallets.resolveCustomer(w.assetId, 'C_VIBAN', w.ownerId);
      const fFee = await this.systemWallets.resolve(w.assetId, 'F_FEE');
      await this.spawnCollect({
        path: TransferPath.FIAT_FEE_COLLECT,
        fromWalletId: viban.id, toWalletId: fFee.id,
        assetId: w.assetId, amount: fee,
        ownerType: w.ownerType, ownerId: w.ownerId, ownerNo: w.ownerNo,
        sourceId: `${w.id}:FEE`, sourceNo: w.withdrawNo,
      });
    } catch (err) {
      this.logger.error(
        `Withdrawal fee collection failed for withdraw=${event.withdrawId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
```
> Confirm the actual withdraw model name is `withdrawTransaction` and it has `feeAmount`/`withdrawNo`/`ownerNo` (check the swap/withdraw schema; adjust field names to the real ones if different). `triggerSource` in `spawnCollect` is hardcoded `'SWAP'` — make it a param and pass `'WITHDRAW'` here for accurate provenance.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-fee-collection-workflow.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts
git commit -m "feat(v7): collect fiat withdrawal fee on withdrawal SUCCESS"
```

---

## Phase 4 — Wiring + demo

### Task 8: Register the service in the module

**Files:**
- Modify: `src/modules/funds-layer/funds-layer.module.ts`
- Test: extend `src/modules/funds-layer/funds-layer.module.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('provides FiatFeeCollectionWorkflowService', () => {
  expect(moduleRef.get(FiatFeeCollectionWorkflowService)).toBeDefined();
});
```
(import it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-layer.module.spec.ts`
Expected: FAIL — provider not found.

- [ ] **Step 3: Register**

In `funds-layer.module.ts`, import `FiatFeeCollectionWorkflowService` and add it to `providers` (after `FiatSettlementWorkflowService`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-layer.module.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/funds-layer.module.ts src/modules/funds-layer/funds-layer.module.spec.ts
git commit -m "feat(v7): register FiatFeeCollectionWorkflowService"
```

---

### Task 9: Demo + manual verification

**Files:**
- Modify: `scripts/seed-fiat-settle-demo.ts` (or new `scripts/seed-fiat-fee-demo.ts`)

- [ ] **Step 1: Extend the demo**

Seed a swap with a non-zero service fee AND spread on the AED leg (use a fee tier with a service fee, or plant the swap row with feeAmount/spreadAmount + the matching FEE_RECEIVABLE/TRADE_CLEARING balances), so that after settlement you can observe the two fee-collect transfers.

- [ ] **Step 2: Drive + verify (live, after `npm run build` + backend restart)**

Run a USDT→AED swap with a service fee. Then:
- Settlement IN delivers **gross** to the VIBAN.
- On settlement SUCCESS: a `FIAT_FEE_COLLECT` transfer (`C_VIBAN→F_FEE`, amount = service fee) and a `FIAT_SPREAD_COLLECT` transfer (`F_LIQ→F_FEE`, amount = spread) appear (`sourceType=FIAT_FEE_COLLECTION`).
- Drive each fee-collect fund SUBMIT→CONFIRM (auto-CLEAR). On CLEAR: `FEE_RECEIVABLE(AED)` drains by the exact fee/spread amount to BANK.
- Verify the customer's VIBAN net = TB CLIENT_CREDIT(net); FEE_RECEIVABLE(AED) returns to 0 after both collected.
- Run a fiat withdrawal with a fee → on SUCCESS, a `FIAT_FEE_COLLECT` (`C_VIBAN→F_FEE`) appears; drive to CLEAR; FEE_RECEIVABLE drains.

- [ ] **Step 3: Commit (if a script changed)**

```bash
git add scripts/seed-fiat-fee-demo.ts
git commit -m "chore(v7): demo seed for fiat fee collection"
```

---

## Final verification

- [ ] `npm test -- funds-layer` — all green.
- [ ] `npm run build` — no TS errors.
- [ ] Append a one-line entry to roadmap V7 noting fiat fee collection delivered; end the thread per CLAUDE.md.

---

## Self-Review Notes (spec coverage)

| Spec section | Task |
|---|---|
| §1 sources table (withdrawal fee / swap fee / spread) | Tasks 4, 7 |
| §1 D1 per-event no cron | Tasks 6 (swap ride-along), 7 (withdrawal event) |
| §1 D2 customer fee VIBAN→F_FEE direct | Tasks 1, 4, 7 |
| §1 D3 spread F_LIQ→F_FEE | Tasks 1, 4 |
| §2 D4 swap IN settlement delivers gross (FIAT only) | Task 3 |
| §3 new whitelist paths | Task 1 |
| §4.1 swap fee/spread triggered on IN settlement complete | Task 6 |
| §4.2 withdrawal fee on WITHDRAWAL_STATUS_CHANGED→SUCCESS | Task 7 |
| §5 D5 specific-amount FEE_RECEIVABLE→BANK drain | Tasks 2, 5 |
| §6 data model (fee transfers not attached to batch) | Task 4 (`settlementBatchId: null`) |
| §7 errors/idempotency (source dedup, terminal-only trigger) | Tasks 4 (findFirst dedup), 6/7 (SUCCESS-only) |
| §8 out of scope (crypto unchanged, no cron) | not implemented (by design) |
| §9 module wiring | Task 8 |

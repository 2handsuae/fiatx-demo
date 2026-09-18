# Swap Fee 并行结算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** swap fee（fiat-side）从"等 FIAT_SETTLE_IN hop2 CLEAR 才建"改为"swap.success 瞬间立即建 + 翻 LOCKED"。fee batch 与 principal batch 在同一时刻并立、各自独立推进、互不依赖、失败隔离。

**Architecture:** 改动只动 fiat-side 的"应计 + 立即锁定"触发点。crypto-side 保持现状（ACCRUED 等 EOD 批量 settle）。具体落点：(1) `fee-accrual-listener.onSwapSucceeded` 不再 fiat-only 跳过——fiat 也走 accrue 路径，并额外接 `feeAccrual.settle(...)`；(2) 删除 `fiat-settlement-workflow.onFundsFlowStatusChanged` 中"FIAT_SETTLE_IN CLEAR 时调 collectSwapFees"的链路；(3) 删除已无调用方的 `fiat-fee-collection-workflow.collectSwapFees` 方法。

**Tech Stack:** NestJS + Prisma + jest（后端）；branch SQLite DB `/tmp/exchange_js_branch/dev.db`

**Source spec:** `doc-final/superpowers/specs/2026-06-16-swap-fee-parallel-settlement-design.md`

---

## File Map

**Modify (3 生产文件 + 3 测试文件)：**
- `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts:30-46` — `onSwapSucceeded` 改：fiat 不再跳过 + 接 settle（T1）
- `src/modules/funds-layer/workflow/fee-accrual-listener.service.spec.ts` — 翻转 "FIAT NOT accrued" 测试为"FIAT accrue + settle"（T1）
- `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:174-178` — 删 collectSwapFees 触发块（T2）
- `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts` — 翻转 "called with swap-1" 为 "not called"（T2）
- `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts:17-33` — 删 `collectSwapFees` 方法（T3）
- `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts` — 删 `describe('collectSwapFees', ...)` 3 个 it（T3）

**Dependency DAG**：
- **T1 → T2 严格串行**（不能间隔合并 — T1 单独 land 会"listener + hop2-trigger 都跑 → 双跑 settle 撞 P2002"）→ **建议同一 PR / 连续 2 commit**
- T3 在 T2 之后（T2 删了最后一个调用方、T3 才能安全删方法）
- T4 全部之后

---

## Task 1 — `fee-accrual-listener.onSwapSucceeded` 改动（fiat 不再跳过 + 立即 settle）

**Files:**
- Modify: `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts` (lines 30-46)
- Modify: `src/modules/funds-layer/workflow/fee-accrual-listener.service.spec.ts` (lines 47-55)

### Pre-read

`fee-accrual-listener.service.ts:30-46` 现有：

```ts
@OnEvent(DomainEventNames.SWAP_SUCCEEDED)
async onSwapSucceeded(event: { swapId: string }): Promise<void> {
  try {
    const swap = await (this.prisma as any).swapTransaction.findUnique({
      where: { id: event.swapId },
      select: { toAsset: { select: { type: true } } },
    });
    if (!swap || swap.toAsset?.type !== 'CRYPTO') return;   // ← fiat 跳过

    await this.feeAccrual.accrueForSwap(event.swapId, this.prisma);
  } catch (err) {
    this.logger.error(
      `Crypto swap fee accrual failed for swap=${event.swapId}`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}
```

`fee-accrual.service.ts:185` 的 `settle` 签名为 `settle(accruals: any[], category: string, settlementType: string, tx: Tx)`。spec § 4.2 给定调用：`settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma)`。

测试模式（line 1-30）：`feeAccrual` 是 mock 对象、需要补 `settle: jest.fn()` 字段、`prisma.feeAccrual.findMany` 也要 mock。

### Steps

- [ ] **Step 1: Write the failing test** — 替换 `fee-accrual-listener.service.spec.ts` 中现有的 "FIAT swap → NOT accrued here" 测试（line 47-55）为：

```ts
    it('FIAT swap → accrue + immediate settle (SWAP_FEE / FIAT_SWAP)', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'FIAT' },
      });
      prisma.feeAccrual.findMany.mockResolvedValue([
        { id: 'fa-1', assetId: 'aed-uuid' },
        { id: 'fa-2', assetId: 'aed-uuid' },
      ]);

      await service.onSwapSucceeded({ swapId: 'swap-2' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-2', prisma);
      expect(prisma.feeAccrual.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'SWAP', sourceId: 'swap-2', status: 'ACCRUED' },
      });
      expect(feeAccrual.settle).toHaveBeenCalledWith(
        [
          { id: 'fa-1', assetId: 'aed-uuid' },
          { id: 'fa-2', assetId: 'aed-uuid' },
        ],
        'SWAP_FEE',
        'FIAT_SWAP',
        prisma,
      );
    });

    it('FIAT swap with zero ACCRUED rows → no settle call', async () => {
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'FIAT' },
      });
      prisma.feeAccrual.findMany.mockResolvedValue([]);

      await service.onSwapSucceeded({ swapId: 'swap-3' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-3', prisma);
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });

    it('CRYPTO swap → accrueForSwap only, no settle (EOD pass owns settle)', async () => {
      // This replaces the spec's existing 'CRYPTO swap → accrueForSwap' assertion
      // with an explicit "settle NOT called" tail to lock the crypto path intent.
      prisma.swapTransaction.findUnique.mockResolvedValue({
        toAsset: { type: 'CRYPTO' },
      });

      await service.onSwapSucceeded({ swapId: 'swap-1' });

      expect(feeAccrual.accrueForSwap).toHaveBeenCalledWith('swap-1', prisma);
      expect(feeAccrual.settle).not.toHaveBeenCalled();
    });
```

Also extend the `beforeEach` mocks at the top of the file (around line 11-17) to add `settle` to `feeAccrual` and `feeAccrual.findMany` to `prisma`:

```ts
    feeAccrual = {
      accrueForSwap: jest.fn().mockResolvedValue(undefined),
      accrueForWithdraw: jest.fn().mockResolvedValue(undefined),
      settle: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      swapTransaction: { findUnique: jest.fn() },
      withdrawTransaction: { findUnique: jest.fn() },
      feeAccrual: { findMany: jest.fn() },
    };
```

And **delete** the now-redundant original `it('CRYPTO swap → accrueForSwap(swapId, prisma) (deferred settle)', ...)` test (current spec line 32-45) — the new "no settle" assertion above replaces it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/funds-layer/workflow/fee-accrual-listener.service.spec.ts -t "onSwapSucceeded" --no-coverage`

Expected: FAIL — `feeAccrual.settle is not a function` OR `Expected settle to have been called` (since current code returns early for fiat).

- [ ] **Step 3: Update `onSwapSucceeded` implementation**

Replace `fee-accrual-listener.service.ts:30-46` with:

```ts
  @OnEvent(DomainEventNames.SWAP_SUCCEEDED)
  async onSwapSucceeded(event: { swapId: string }): Promise<void> {
    try {
      const swap = await (this.prisma as any).swapTransaction.findUnique({
        where: { id: event.swapId },
        select: { toAsset: { select: { type: true } } },
      });
      if (!swap) return;

      // (1) Always accrue (was: crypto-only). Crypto-side stays ACCRUED and is
      //     settled by the EOD batch pass (eod-settlement-workflow). Fiat-side
      //     additionally settles immediately below — fee batch must spawn in
      //     parallel with the principal FIAT_SETTLE_IN batch (Spec #6).
      await this.feeAccrual.accrueForSwap(event.swapId, this.prisma);

      if (swap.toAsset?.type === 'FIAT') {
        const accruals = await (this.prisma as any).feeAccrual.findMany({
          where: { sourceType: 'SWAP', sourceId: event.swapId, status: 'ACCRUED' },
        });
        if (accruals.length) {
          await this.feeAccrual.settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma);
        }
      }
    } catch (err) {
      this.logger.error(
        `Swap fee handle failed for swap=${event.swapId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/funds-layer/workflow/fee-accrual-listener.service.spec.ts --no-coverage`

Expected: PASS — all `onSwapSucceeded` tests (4) + existing `onCryptoWithdrawalSucceeded` tests untouched.

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/workflow/fee-accrual-listener.service.ts \
        src/modules/funds-layer/workflow/fee-accrual-listener.service.spec.ts
git commit -m "feat(fee-accrual): listener handles fiat swap fee inline (no fiat skip)

- onSwapSucceeded: always accrueForSwap (was: crypto-only)
- For fiat swaps, immediately settle: build SWAP_FEE batch + fee transfer + flip LOCKED
- Crypto path untouched: ACCRUED only, EOD pass settles
- Pairs with Task 2 which removes the now-duplicate FIAT_SETTLE_IN CLEAR
  trigger in fiat-settlement-workflow (else double-settle would race)
- Spec: doc-final/superpowers/specs/2026-06-16-swap-fee-parallel-settlement-design.md"
```

> ⚠️ **不要在 T2 完成前 push/部署**——T1 单独 live 会导致 listener + hop2-trigger 同时 accrue+settle、撞 P2002 unique 冲突。

---

## Task 2 — 删 `fiat-settlement-workflow.onFundsFlowStatusChanged` 的 collectSwapFees 触发

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts` (lines 174-178)
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts` (lines ~201, ~211)

**Depends on:** Task 1（必须紧跟 T1，避免双跑窗口）

### Pre-read

`fiat-settlement-workflow.service.ts:174-178` 现有块：

```ts
      // Swap fee/spread collection rides along once the IN (buy-fiat) settlement
      // completes. Model A: both fee and spread are pulled from F_OPS (company side).
      if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) {
        const swapId = String(transfer.sourceId || '').split(':')[0];
        if (swapId) await this.feeCollection.collectSwapFees(swapId);
      }
```

Spec 文件 `fiat-settlement-workflow.service.spec.ts` 现有 line 201（断言"called with swap-1"）和 line 211（"not called when not IN"）。

### Steps

- [ ] **Step 1: Update failing tests** — 修改 spec line ~201 测试（"FIAT_SETTLE_IN hop2 CLEAR → calls collectSwapFees with swap-1"），翻转为：

打开 `fiat-settlement-workflow.service.spec.ts`，定位到引用 `feeCollection.collectSwapFees` 的两处。需要把 line ~201 处由 `.toHaveBeenCalledWith('swap-1')` 改为 `.not.toHaveBeenCalled()`，并相应更新 test 描述。

执行：
```bash
grep -nE "collectSwapFees" src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
```

定位两处后：
- 第一处（line ~201）：将 `expect(feeCollection.collectSwapFees).toHaveBeenCalledWith('swap-1');` 改为 `expect(feeCollection.collectSwapFees).not.toHaveBeenCalled();`
- 第二处（line ~211 "not called when not IN"）：保持不变 — 此断言依然正确。
- 测试描述（"calls collectSwapFees on FIAT_SETTLE_IN hop2 CLEAR"）改为 `'does NOT call collectSwapFees on FIAT_SETTLE_IN hop2 CLEAR (Spec #6: fee batch spawns in listener)'`。

- [ ] **Step 2: Run tests to verify failure**

Run: `npx jest src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts -t "FIAT_SETTLE_IN" --no-coverage`

Expected: FAIL — `collectSwapFees` is still called by production code; `not.toHaveBeenCalled()` fails.

- [ ] **Step 3: Delete the trigger block in production code**

In `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts`, **delete** lines 174-178 (the entire `if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) { ... }` block, including the 2 comment lines immediately above):

Lines to delete (old_string):
```ts
      // Swap fee/spread collection rides along once the IN (buy-fiat) settlement
      // completes. Model A: both fee and spread are pulled from F_OPS (company side).
      if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) {
        const swapId = String(transfer.sourceId || '').split(':')[0];
        if (swapId) await this.feeCollection.collectSwapFees(swapId);
      }
```

Result: the surrounding `try { ... } catch (err) { ... }` block is preserved; the inner if-block is removed.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts --no-coverage`

Expected: PASS — all tests including the inverted assertion.

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: no TS errors. `feeCollection` injection is still used elsewhere (for `onFiatWithdrawalSucceeded` flow — keep it).

> Verify: `grep -n "feeCollection" src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts` — if **0** matches outside constructor, the DI can be cleaned up; otherwise leave it.

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts \
        src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
git commit -m "refactor(fiat-settle): remove collectSwapFees trigger on FIAT_SETTLE_IN CLEAR

Fee batch is now spawned in fee-accrual-listener at SWAP_SUCCEEDED (Task 1).
Coupling fee settle to principal hop2 CLEAR is no longer needed — TB already
posted fee income at swap.success, and F_OPS→F_FEE transfer is independent
of the client-facing FIAT_SETTLE_IN transfer.

Failure isolation: principal failure no longer blocks fee, and vice versa."
```

---

## Task 3 — 删 `fiat-fee-collection-workflow.collectSwapFees` 方法（dead code）

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts` (lines 17-33)
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts` (delete `describe('collectSwapFees', ...)` block)

**Depends on:** Task 2 (T2 removed the last caller)

### Pre-read

`fiat-fee-collection-workflow.service.ts:17-33`:

```ts
  /** Collect a swap's fiat fees: accrue (SERVICE_FEE + SPREAD) then immediately settle. */
  async collectSwapFees(swapId: string): Promise<void> {
    const swap = await (this.prisma as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: { toAsset: { select: { type: true } } },
    });
    if (!swap || swap.toAsset?.type !== 'FIAT') return;

    await this.feeAccrual.accrueForSwap(swapId, this.prisma);
    const accruals = await (this.prisma as any).feeAccrual.findMany({
      where: { sourceType: 'SWAP', sourceId: swapId, status: 'ACCRUED' },
    });
    if (accruals.length) {
      await this.feeAccrual.settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma);
    }
  }
```

`fiat-fee-collection-workflow.service.spec.ts:33-71` has 3 tests under `describe('collectSwapFees', ...)`.

### Steps

- [ ] **Step 1: Verify no other callers exist (defense)**

```bash
grep -rn "collectSwapFees" src --include="*.ts" 2>/dev/null | grep -v ".spec." | grep -v "fiat-fee-collection-workflow.service.ts"
```

Expected: **0 results** (Task 2 removed the last). If any non-zero, T2 was incomplete — back-track and fix before proceeding.

- [ ] **Step 2: Delete the method**

Edit `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`. Use Read/Edit to delete the method body (lines 17-33) including the docstring comment immediately above. Result: the class keeps the constructor and `onFiatWithdrawalSucceeded` only.

- [ ] **Step 3: Delete the `describe('collectSwapFees', ...)` block in spec**

Edit `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts`. Read line 33-71 and delete the entire `describe('collectSwapFees', ...) { ... }` block (3 `it` cases). Keep `describe('onFiatWithdrawalSucceeded', ...)` and the file's setup intact.

- [ ] **Step 4: Run tests**

Run: `npx jest src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts --no-coverage`

Expected: PASS — only the `onFiatWithdrawalSucceeded` tests remain (3 tests).

- [ ] **Step 5: Full funds-layer jest + build**

Run: 
```
npx jest src/modules/funds-layer --no-coverage 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

Expected: full funds-layer suite passes; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts \
        src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.spec.ts
git commit -m "chore(fiat-fee-collection): remove now-unused collectSwapFees method

Task 2 deleted the last caller (fiat-settlement-workflow:177 trigger).
Method body and its 3 unit tests removed. onFiatWithdrawalSucceeded path
remains untouched (handles fiat withdraw fee separately, out of Spec #6 scope)."
```

---

## Task 4 — Live recon (1 笔 USDT→AED swap，2 batch 并立 + LOCKED→SETTLED)

**Files:** N/A (verification only)

**Depends on:** Tasks 1-3 all green + branch stack running

### Pre-read

`scripts/sim-one-swap-usdt-aed.ts` (created in previous session) already drives 1 USDT→AED swap on Sim01 (`CU2601017032`). It outputs `swap.swapNo` and `swap.id`. We will re-use it; if it was reset away, this task includes minimal re-creation guidance.

### Steps

- [ ] **Step 1: Confirm branch stack is up**

```bash
for p in 3500 3501 3502 3503; do
  pid=$(lsof -ti:$p 2>/dev/null | head -1)
  if [ -n "$pid" ]; then echo "  $p ✅"; else echo "  $p ❌"; fi
done
```

If 3500 down, restart: `nohup npm run start:dev > logs/backend-t4.log 2>&1 &` then wait 12s.

- [ ] **Step 2: Confirm seed data + swap script**

Run:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT customerNo FROM customer_main WHERE firstName='Sim01';"
```

Expected: at least 1 row. If empty, run `npm run dev:reset:branch` first.

Check script exists:
```bash
ls scripts/sim-one-swap-usdt-aed.ts 2>&1 | head -1
```

If missing, create with this minimal content at `scripts/sim-one-swap-usdt-aed.ts`:

```ts
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const swapQuoteService = app.get(SwapQuoteService);
  const swapWorkflow = app.get(SwapWorkflowService);
  const usdt = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { currency: 'AED' } });
  const cust: any = await prisma.customerMain.findFirst({ where: { firstName: 'Sim01' } });
  if (!usdt || !aed || !cust) throw new Error('missing seed');
  const quote: any = await swapQuoteService.createQuote({
    ownerType: 'CUSTOMER', ownerId: cust.id, ownerNo: cust.customerNo,
    fromAssetId: usdt.id, fromAssetCode: 'USDT', toAssetId: aed.id, toAssetCode: 'AED',
    amount: new Prisma.Decimal(200), customerId: cust.id,
  } as any);
  const swap: any = await swapWorkflow.executeSwap(cust.id, quote.id);
  console.log(`SWAP_NO=${swap.swapNo}`);
  console.log(`SWAP_ID=${swap.id}`);
  await new Promise(r => setTimeout(r, 5000));
  await app.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run swap + capture id**

```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-one-swap-usdt-aed.ts 2>&1 \
  | grep -vE "MaxListeners|trace-warnings|deprec" \
  | tee /tmp/sim-swap-output.log

SWAP_NO=$(grep "SWAP_NO=" /tmp/sim-swap-output.log | cut -d= -f2)
SWAP_ID=$(grep "SWAP_ID=" /tmp/sim-swap-output.log | cut -d= -f2)
echo "SWAP_NO=$SWAP_NO SWAP_ID=$SWAP_ID"
```

Expected: `SWAP_NO` starts with `SWP26...`; `SWAP_ID` is a UUID.

- [ ] **Step 4: SQL ① — swap.success 瞬间双 batch + 双 transfer + FeeAccrual LOCKED**

```bash
DB=/tmp/exchange_js_branch/dev.db
echo "─ ① Settlement batches for this swap ─"
sqlite3 -box $DB "
SELECT category, batchNo, status
FROM settlement_batches
WHERE id IN (
  SELECT DISTINCT settlementBatchId FROM outstandings WHERE swapTransactionId='$SWAP_ID' AND settlementBatchId IS NOT NULL
  UNION
  SELECT DISTINCT settlementBatchId FROM fee_accruals WHERE sourceId='$SWAP_ID' AND settlementBatchId IS NOT NULL
);"

echo "─ ② Internal transactions (transfers) for this swap ─"
sqlite3 -box $DB "
SELECT internalTxNo, pathLabel, status
FROM internal_transactions
WHERE settlementBatchId IN (
  SELECT id FROM settlement_batches WHERE id IN (
    SELECT DISTINCT settlementBatchId FROM outstandings WHERE swapTransactionId='$SWAP_ID'
    UNION
    SELECT DISTINCT settlementBatchId FROM fee_accruals WHERE sourceId='$SWAP_ID'
  )
);"

echo "─ ③ FeeAccrual rows for this swap ─"
sqlite3 -box $DB "SELECT feeAccrualNo, feeKind, amount, status FROM fee_accruals WHERE sourceNo='$SWAP_NO';"

echo "─ ④ Outstanding rows for this swap ─"
sqlite3 -box $DB "SELECT outstandingNo, direction, amount, status FROM outstandings WHERE swapTransactionId='$SWAP_ID';"
```

Expected:
- ① 2 rows: `category='PRINCIPAL'` and `category='SWAP_FEE'`
- ② 2 rows: `pathLabel='FIAT_SETTLE_IN'` and `pathLabel='FIAT_SWAP_FEE_COLLECT'`, both `status='INTERNAL_FUNDS_PENDING'`
- ③ 2 rows: SERVICE_FEE + SPREAD, **both `status='LOCKED'`** (not ACCRUED, not 0 rows)
- ④ 2 rows: OUT OPEN + IN LOCKED

> If ③ shows ACCRUED only or 0 rows, Task 1 didn't land correctly — back-track.
> If ② shows only FIAT_SETTLE_IN, the SWAP_FEE batch wasn't spawned — Task 1 issue.

- [ ] **Step 5: Drive fee transfer's hop to CLEAR + verify SETTLED**

The `FIAT_SWAP_FEE_COLLECT` transfer typically has a single hop (`F_OPS → F_FEE`). Drive it via the simulate API (admin login needed) or directly:

```bash
DB=/tmp/exchange_js_branch/dev.db

FEE_TX_ID=$(sqlite3 $DB "
SELECT id FROM internal_transactions
WHERE settlementBatchId IN (
  SELECT id FROM settlement_batches
  WHERE id IN (SELECT DISTINCT settlementBatchId FROM fee_accruals WHERE sourceId='$SWAP_ID')
);")
echo "fee tx id: $FEE_TX_ID"

FEE_HOP_ID=$(sqlite3 $DB "SELECT id FROM internal_funds WHERE internalTransactionId='$FEE_TX_ID' ORDER BY createdAt LIMIT 1;")
echo "fee hop id: $FEE_HOP_ID"
```

Then drive the hop using the funds-simulate Node helper (write a one-off script `scripts/drive-one-leg.ts` if needed). For verification scope, simpler: directly UPDATE prisma model via a one-off Node REPL or accept "LOCKED is the verifiable state for this run" (the Spec #6 fix is about ACCRUED→LOCKED timing; SETTLED behavior is unchanged from Spec #3).

Pragmatic SETTLED check: assert that **once any fee hop reaches CLEAR**, the corresponding FeeAccrual rows flip to SETTLED. If driving the hop is blocked by environment, document the LOCKED state as recon ✅ and note that SETTLED is governed by pre-existing `settleByTransfer` (DT-T6 covered).

- [ ] **Step 6: Audit trail**

```bash
sqlite3 -box $DB "
SELECT entityType, action
FROM audit_log_events
WHERE traceId=(SELECT traceId FROM swap_transactions WHERE swapNo='$SWAP_NO')
ORDER BY occurredAt;"
```

Expected (minimum):
- SWAP_QUOTE / SWAP_QUOTE_CREATED
- SWAP_QUOTE / SWAP_QUOTE_USED
- SWAP_TRANSACTION / SWAP_CREATED
- SWAP_TRANSACTION / SWAP_SUCCEEDED
- OUTSTANDING / CREATED × 2
- OUTSTANDING / LOCKED × 1
- **FEE_ACCRUAL / CREATED × 2** (new in this swap)
- **FEE_ACCRUAL / LOCKED × 2** (new, from immediate settle)

- [ ] **Step 7: Documentation**

If SQL ①-③ all green, no new commit needed. If something deviated, write the deviation into Spec #6 § 7 (verification) or open backlog entry.

---

## Self-Review

### Spec coverage

| Spec § | Covered by |
|---|---|
| § 2 抓手 (listener 改 + 删 trigger + 删 method) | T1 + T2 + T3 |
| § 3 时序图 (双 batch 并立) | T4 verification SQL ① + ② |
| § 4.1-4.3 文件级改动 | T1 + T2 + T3 |
| § 5 状态机两侧对照 | T4 SQL ③ + ④ |
| § 6 测试覆盖 4 项 | T1 (TX1+2+3) + T2 (TX) + T3 (delete TX) |
| § 7 验收 SQL 三段 | T4 Step 4 + 5 + 6 |

No gap.

### Placeholder scan

No TBD / TODO / 'similar to'. Every step has concrete code or exact commands.

### Type consistency

- `feeAccrual.settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma)` — signature matches `fee-accrual.service.ts:185` `settle(accruals: any[], category: string, settlementType: string, tx: Tx)`
- `feeAccrual.findMany` query shape `{ sourceType, sourceId, status }` — matches existing usage in T3's `collectSwapFees` (now deleted)
- mock additions in T1 spec — `feeAccrual.settle: jest.fn()` and `prisma.feeAccrual.findMany: jest.fn()` — required for T1's TX1+TX2 to compile and pass

### Dependency DAG

```
T1 (listener+test) ──→ T2 (delete trigger) ──→ T3 (delete method) ──→ T4 (recon)
   ↑ must be released together with T2 to avoid double-settle window
```

No cycle. T1+T2 are a "release pair" — if working with separate PRs, they MUST land in the same deployment window.

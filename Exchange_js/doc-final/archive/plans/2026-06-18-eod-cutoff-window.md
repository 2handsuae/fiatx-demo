# EOD Cutoff Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crypto EOD settle a clean T+0 trading-day slice — select only Outstanding/FeeAccrual rows with `createdAt < cutoff` (cutoff = run-day 00:00 Asia/Dubai), and move the cron to T+1 00:30.

**Architecture:** Add a pure `resolveEodCutoff(now)` helper; thread an optional `cutoff` through `runEodSettlement`; add `createdAt < cutoff` to the principal query (`findOpenCryptoByAsset`) and the three fee-pass queries; stamp `SettlementBatch.cutoffAt` with the logical cutoff; change the cron expression. No schema migration (`Outstanding.createdAt` is already indexed; `cutoffAt` field already exists). `fx-eod` and fiat are untouched and stay consistent.

**Tech Stack:** NestJS, Prisma (SQLite), Jest v30 + ts-jest. Tests are colocated `*.spec.ts`; collaborators are mocked as plain objects with `jest.fn()`.

**Spec:** `doc-final/superpowers/specs/2026-06-18-eod-cutoff-window-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/modules/funds-layer/workflow/eod-cutoff.util.ts` | Pure cutoff derivation (Dubai start-of-day → UTC instant) | **Create** |
| `src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts` | Unit tests for the helper | **Create** |
| `src/modules/funds-layer/domain/outstanding-consumer.service.ts` | Principal selection — add `cutoff` param + `createdAt` filter | Modify |
| `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts` | Window assertion | Modify |
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts` | Compute/inject cutoff; window fee pass; stamp `cutoffAt` | Modify |
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts` | Cutoff-threading assertions | Modify |
| `src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts` | Cron `23:59` → `00:30` | Modify |

Callers verified: `findOpenCryptoByAsset` has exactly one caller (the workflow); `runEodSettlement` is called by the sweep (`'CRON'`) and admin controller (`'ADMIN'`) — both unaffected because `cutoff` is optional.

---

## Task 1: `resolveEodCutoff` helper (pure function, TDD)

**Files:**
- Create: `src/modules/funds-layer/workflow/eod-cutoff.util.ts`
- Test: `src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts`:

```ts
import { resolveEodCutoff } from './eod-cutoff.util';

describe('resolveEodCutoff', () => {
  // Asia/Dubai = UTC+4 year-round (no DST). cutoff = start of the run-day in Dubai,
  // expressed as the equivalent UTC instant.

  it('00:30 Dubai run → cutoff is that day 00:00 Dubai (UTC 20:00 previous day)', () => {
    // 2026-06-18 00:30 Dubai == 2026-06-17T20:30:00Z
    const now = new Date('2026-06-17T20:30:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('late-evening Dubai time still floors to the same Dubai midnight', () => {
    // 2026-06-18 23:45 Dubai == 2026-06-18T19:45:00Z
    const now = new Date('2026-06-18T19:45:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('exactly at Dubai midnight → cutoff equals that instant', () => {
    // 2026-06-18 00:00 Dubai == 2026-06-17T20:00:00Z
    const now = new Date('2026-06-17T20:00:00.000Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-17T20:00:00.000Z');
  });

  it('one ms before Dubai midnight → cutoff is the previous Dubai midnight', () => {
    // 2026-06-17 23:59:59.999 Dubai == 2026-06-17T19:59:59.999Z
    const now = new Date('2026-06-17T19:59:59.999Z');
    expect(resolveEodCutoff(now).toISOString()).toBe('2026-06-16T20:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts`
Expected: FAIL — `Cannot find module './eod-cutoff.util'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/funds-layer/workflow/eod-cutoff.util.ts`:

```ts
// Asia/Dubai is UTC+4 year-round (no DST), so a fixed offset is exact and matches
// the EOD cron's `timeZone: 'Asia/Dubai'`.
export const EOD_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * The EOD cutoff = start of `now`'s calendar day in Asia/Dubai, returned as the
 * equivalent UTC instant. EOD selects rows with `createdAt < cutoff` (half-open:
 * a row at exactly the cutoff belongs to the next day).
 */
export function resolveEodCutoff(now: Date): Date {
  const dubaiMs = now.getTime() + EOD_OFFSET_MS;
  const midnightDubaiMs = Math.floor(dubaiMs / 86_400_000) * 86_400_000;
  return new Date(midnightDubaiMs - EOD_OFFSET_MS);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/eod-cutoff.util.ts src/modules/funds-layer/workflow/eod-cutoff.util.spec.ts
git commit -m "feat(funds): add resolveEodCutoff (Dubai start-of-day) for EOD windowing"
```

---

## Task 2: Window the principal pass by `createdAt < cutoff`

**Files:**
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts:41-56`
- Test: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts`

- [ ] **Step 1: Update the existing test + add a windowing test (red)**

In `outstanding-consumer.service.spec.ts`, the existing test `'findOpenCryptoByAsset groups by asset...'` calls `service.findOpenCryptoByAsset()` with no argument. Change that call (around line 75) to pass a cutoff:

```ts
    const cutoff = new Date('2026-06-17T20:00:00.000Z');
    const groups = await service.findOpenCryptoByAsset(cutoff);
```

Then, immediately after the existing `where` assertions in that test (after the `expect(where.settlementBatchId).toBeNull();` line), add:

```ts
    expect(where.createdAt).toEqual({ lt: cutoff });
```

Add a dedicated focused test right after that test block:

```ts
  it('findOpenCryptoByAsset windows selection by createdAt < cutoff', async () => {
    const cutoff = new Date('2026-06-17T20:00:00.000Z');

    await service.findOpenCryptoByAsset(cutoff);

    const where = prisma.outstanding.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.asset).toEqual({ type: 'CRYPTO' });
    expect(where.settlementBatchId).toBeNull();
    expect(where.createdAt).toEqual({ lt: cutoff });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts`
Expected: FAIL — `where.createdAt` is `undefined` (service does not yet add the filter); TypeScript may also flag the now-required argument.

- [ ] **Step 3: Implement the windowing**

In `outstanding-consumer.service.ts`, change the method signature and the `where` clause:

```ts
  async findOpenCryptoByAsset(cutoff: Date): Promise<CryptoOutstandingGroup[]> {
    const rows = await (this.prisma as any).outstanding.findMany({
      where: {
        status: 'OPEN',
        asset: { type: 'CRYPTO' },
        settlementBatchId: null,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        assetId: true,
        assetCode: true,
        asset: { select: { currency: true, decimals: true } },
      },
    });
```

Leave the grouping/netting body below unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts`
Expected: PASS (all tests in the file, including the updated grouping test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/outstanding-consumer.service.ts src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "feat(funds): window EOD principal selection by createdAt < cutoff"
```

---

## Task 3: Thread cutoff through the workflow + window the fee pass + stamp cutoffAt

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts` (lines 60-73, 132, 159-181)
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

- [ ] **Step 1: Add the cutoff-threading tests (red)**

In `eod-settlement-workflow.service.spec.ts`, add this `describe` block inside the top-level `describe('EodSettlementWorkflowService', ...)`, after the existing `describe('runEodSettlement', ...)` block:

```ts
  describe('cutoff windowing', () => {
    const cutoff = new Date('2026-06-17T20:00:00.000Z');

    it('passes the injected cutoff to the principal query and stamps it on the batch', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([groupNetZero]);
      batchService.resolveCryptoDirection.mockReturnValue(null);

      await service.runEodSettlement('TEST', cutoff);

      expect(consumer.findOpenCryptoByAsset).toHaveBeenCalledWith(cutoff);
      expect(batchService.createBatch).toHaveBeenCalledWith({ cutoffAt: cutoff });
    });

    it('windows all three fee-pass queries by createdAt < cutoff', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]); // fee-only path
      prisma.feeAccrual.findMany
        .mockResolvedValueOnce([{ assetId: 'a-btc' }]) // distinct assets
        .mockResolvedValueOnce([{ id: 'fac-s1', assetId: 'a-btc', amount: '0.001' }]) // SWAP_FEE
        .mockResolvedValueOnce([]); // WITHDRAW_FEE

      await service.runEodSettlement('TEST', cutoff);

      const distinctWhere = prisma.feeAccrual.findMany.mock.calls[0][0].where;
      expect(distinctWhere).toMatchObject({
        status: 'ACCRUED',
        asset: { type: 'CRYPTO' },
        createdAt: { lt: cutoff },
      });
      const swapWhere = prisma.feeAccrual.findMany.mock.calls[1][0].where;
      expect(swapWhere).toMatchObject({
        assetId: 'a-btc',
        category: 'SWAP_FEE',
        status: 'ACCRUED',
        createdAt: { lt: cutoff },
      });
      const wdWhere = prisma.feeAccrual.findMany.mock.calls[2][0].where;
      expect(wdWhere).toMatchObject({
        assetId: 'a-btc',
        category: 'WITHDRAW_FEE',
        status: 'ACCRUED',
        createdAt: { lt: cutoff },
      });
    });

    it('defaults the cutoff when none is provided (principal query still receives a Date)', async () => {
      consumer.findOpenCryptoByAsset.mockResolvedValue([]);

      await service.runEodSettlement();

      expect(consumer.findOpenCryptoByAsset).toHaveBeenCalledTimes(1);
      const arg = consumer.findOpenCryptoByAsset.mock.calls[0][0];
      expect(arg).toBeInstanceOf(Date);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "cutoff windowing"`
Expected: FAIL — `findOpenCryptoByAsset` is called with no argument (`undefined`), `createBatch` gets `{ cutoffAt: <Date now> }` not the injected `cutoff`, and fee `where` has no `createdAt`.

- [ ] **Step 3: Implement cutoff threading + fee windowing**

In `eod-settlement-workflow.service.ts`:

(a) Add the import near the other imports at the top:

```ts
import { resolveEodCutoff } from './eod-cutoff.util';
```

(b) Change the `runEodSettlement` signature (line 60) and compute the effective cutoff as the first statement:

```ts
  async runEodSettlement(operatorId = 'SYSTEM', cutoff?: Date): Promise<RunEodSettlementResult> {
    const cut = cutoff ?? resolveEodCutoff(new Date());
    const groups = await this.consumer.findOpenCryptoByAsset(cut);
```

(c) In the empty-groups early-return branch, pass the cutoff to the fee pass:

```ts
    if (groups.length === 0) {
      this.logger.log('EOD settlement: no open crypto outstandings — fee pass only');
      await this.runFeePass(cut);
      return { batchNo: null, assetCount: 0, settledZero: 0, spawned: 0 };
    }
```

(d) Stamp the batch with the logical cutoff (replace `new Date()`):

```ts
    const batch = await this.batchService.createBatch({ cutoffAt: cut });
```

(e) In the post-principal fee pass call (the one currently at line 132), pass the cutoff:

```ts
    await this.runFeePass(cut);
```

(f) Change `runFeePass` to accept the cutoff and add `createdAt: { lt: cutoff }` to all three queries:

```ts
  private async runFeePass(cutoff: Date): Promise<void> {
    const assetRows = await (this.prisma as any).feeAccrual.findMany({
      where: { status: 'ACCRUED', asset: { type: 'CRYPTO' }, createdAt: { lt: cutoff } },
      distinct: ['assetId'],
      select: { assetId: true },
    });

    for (const { assetId } of assetRows) {
      const swapFees = await (this.prisma as any).feeAccrual.findMany({
        where: { assetId, category: 'SWAP_FEE', status: 'ACCRUED', createdAt: { lt: cutoff } },
      });
      if (swapFees.length) {
        await this.feeAccrual.settle(swapFees, 'SWAP_FEE', 'EOD', this.prisma);
      }

      const wdFees = await (this.prisma as any).feeAccrual.findMany({
        where: { assetId, category: 'WITHDRAW_FEE', status: 'ACCRUED', createdAt: { lt: cutoff } },
      });
      if (wdFees.length) {
        await this.feeAccrual.settle(wdFees, 'WITHDRAW_FEE', 'EOD', this.prisma);
      }
    }
  }
```

Leave everything else (the per-group transfer spawn loop, `recomputeBatch`, `fxEod.runEodAccounting`, and the entire `onFundsFlowStatusChanged` handler) unchanged.

- [ ] **Step 4: Run the full workflow spec to verify pass**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`
Expected: PASS — the new `cutoff windowing` tests plus all pre-existing tests (they call `runEodSettlement()` with defaults and don't assert the query argument, so they remain green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "feat(funds): thread EOD cutoff through workflow + fee pass; stamp batch cutoffAt"
```

---

## Task 4: Move the EOD cron to T+1 00:30

**Files:**
- Modify: `src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts:11`

> No sweep `*.spec.ts` exists in this module (the cron expression is decorator metadata, not unit-tested here — consistent with the existing codebase). Verification is by grep + the full build/suite in Task 5.

- [ ] **Step 1: Change the cron expression**

In `eod-settlement-sweep.service.ts`, change the `@Cron` decorator:

```ts
  @Cron('0 30 0 * * *', { timeZone: 'Asia/Dubai' })
  async handle(): Promise<void> {
```

(Was `@Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })`.)

- [ ] **Step 2: Verify the change by grep**

Run: `grep -n "@Cron" src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts`
Expected: `@Cron('0 30 0 * * *', { timeZone: 'Asia/Dubai' })` — i.e. 00:30 Asia/Dubai.

- [ ] **Step 3: Commit**

```bash
git add src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts
git commit -m "feat(funds): move EOD settlement cron to 00:30 Asia/Dubai (T+1)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Type-check / build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (confirms the new required `cutoff` arg has no missed caller and signatures line up).

- [ ] **Step 2: Run the funds-layer test suite**

Run: `npx jest src/modules/funds-layer`
Expected: PASS — all funds-layer specs green, including the three modified/created spec files.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions elsewhere.

- [ ] **Step 4 (integration, if present): two-book end-to-end check**

If `scripts/verify-two-book.ts` is present and has a documented runner, run it to confirm the I1/I2 invariants still hold after windowing (T+1 swaps remain OPEN → stay in the bridge → I2 balances). Run: `npx ts-node -r tsconfig-paths/register scripts/verify-two-book.ts`
Expected: the documented all-PASS summary. If the script is absent or run differently, note it and rely on Steps 1-3.

- [ ] **Step 5: Final commit (only if any verification fix was needed)**

```bash
git add -A
git commit -m "test(funds): verify EOD cutoff windowing — suite + build green"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-18-eod-cutoff-window-design.md`):
- §4 cutoff model + util → Task 1. ✓
- §5① cron 00:30 → Task 4. ✓
- §5② workflow cutoff threading + fee-pass windowing + `cutoffAt` stamp → Task 3. ✓
- §5③ principal `createdAt < cutoff` → Task 2. ✓
- §5④ admin controller unchanged → covered by "callers verified" note + Task 5 build (no new arg required there). ✓
- §5⑤ new util file → Task 1. ✓
- §7 tests: util boundary, consumer window, workflow T+0/T+1 threading → Tasks 1-3; two-book invariant → Task 5 Step 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code and exact run commands with expected output. ✓

**3. Type consistency:** `resolveEodCutoff(now: Date): Date` defined in Task 1, imported/called in Task 3; `findOpenCryptoByAsset(cutoff: Date)` defined in Task 2, called with `cut` in Task 3; `runFeePass(cutoff: Date)` and `runEodSettlement(operatorId, cutoff?)` consistent across Task 3 steps and tests. Cutoff fixture `2026-06-17T20:00:00.000Z` used consistently. ✓

**Note on the "roll-forward" success criterion (§2.4 / §7):** the unit specs assert the *windowing* (T+1 rows excluded via `createdAt < cutoff`). The full "run with next-day cutoff → previously-excluded T+1 rows now settle" behavior is an emergent property of the same `< cutoff` filter (no extra code path) and is exercised end-to-end by Task 5 Step 4; no separate unit task is required.

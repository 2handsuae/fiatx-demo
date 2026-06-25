# Funds-Layer Consolidation — Retire asset-treasury `internal-transactions` + `internal-funds`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `asset-treasury/internal-transactions` (956 L) + `asset-treasury/internal-funds` (744 L) service stack, leaving the V7 `funds-layer` module as the sole owner of the `InternalTransaction`/`InternalFund` tables — without breaking live deposit/swap/withdraw flows.

**Architecture:** funds-layer is already the canonical engine: it's event-driven (`@OnEvent` on `SWAP_SUCCEEDED`/`WITHDRAWAL_SUCCESS_*`/`FUNDSFLOW_STATUS_CHANGED`), serves the live admin UI (`/admin/funds-layer/*`, `pages/funds-layer/*`), and writes both tables via `InternalTransferService` (the port impl) + `FundsFlowService`. The old asset-treasury stack survives only because: (a) its DTOs are still imported by funds-layer, and (b) trading reads one method (`findFundsOrderBySource`) off the old service. Cut both tethers, then delete the old stack. **No prisma schema change** — the `InternalTransaction`/`InternalFund` tables stay; only old *code* is removed.

**Tech Stack:** NestJS + Prisma (SQLite) backend; Jest specs; `nest build` / `tsc` typecheck gates.

---

## Verified facts (from investigation 2026-06-18)

| Fact | Evidence |
|---|---|
| funds-layer `InternalTransferService` owns the `internalTransaction` table | `funds-layer/domain/internal-transfer.service.ts` — `createTransfer`/`syncStatusFromFunds`/`findAllForAdmin`/`findOneForAdmin`/`findOneByNoForAdmin` |
| It lacks `findFundsOrderBySource` (trading's read) | not present in that file; only in old `internal-transactions.service.ts:769` |
| `InternalTransferService` is **not exported** by `FundsLayerModule` | `funds-layer.module.ts:82-86` exports only the 3 workflow services |
| Trading reads old service ×3 (read-only) | swap `:11/:83/:320`, withdraw `:26/:118/:410`, deposit `:19/:49/:161` |
| Old `internal-funds.service` reachable **only** via its orphan-from-UI controller | no `@OnEvent`/`@Cron`; not DI-injected elsewhere; no frontend fetches `/admin/internal-funds` |
| Old `internal-transactions` controller orphan-from-UI | G.1 deleted its pages; no frontend fetch |
| funds-layer imports the 2 old DTOs | `internal-transaction.dto` (`InternalTransactionStatus`,`InternalTransactionApprovalStatus`) + `internal-fund.dto` (`InternalFundAction`,`UpdateInternalFundStatusDto`) — 7 funds-layer files |
| `internal-transaction.constants.ts` + perms `INTERNAL_TX_READ`/`INTERNAL_FUND_READ`/`INTERNAL_FUND_WRITE` orphan after removal | used only within old code + the 6 rbac routes |
| audit-logs.service reads `internalTransaction` via defensive `db:any` directly off the table | unaffected — table stays |

**DTO export inventory (must survive the move):**
- `internal-transaction.dto.ts` (136 L): `InternalTransactionType`, `InternalTransactionSourceType`, `TreasuryTransferPurpose`, `TreasuryTransferInitiationMode`, `InternalTransactionStatus`, `InternalTransactionApprovalStatus`, `InternalTransactionQueryDto`
- `internal-fund.dto.ts` (125 L): `InternalFundStatus`, `InternalFundAction`, `InternalFundQueryDto`, `UpdateInternalFundStatusDto`

---

## File Structure

**Modify:**
- `src/modules/funds-layer/domain/internal-transfer.service.ts` — add `findFundsOrderBySource`
- `src/modules/funds-layer/funds-layer.module.ts` — export `InternalTransferService`
- `src/modules/trading/{swap,withdraw,deposit}-transactions/*.service.ts` + `*.module.ts` — repoint to funds-layer
- `src/app.module.ts` — drop `InternalTransactionsModule` + `InternalFundsModule`
- `src/modules/identity/access-control/rbac.catalog.ts` — drop 6 routes (+ orphan perms)
- 7 funds-layer files importing the 2 DTOs — repoint import paths

**Move:**
- `internal-transaction.dto.ts` + `internal-fund.dto.ts` → `src/modules/funds-layer/dto/`

**Delete (after tethers cut):**
- `src/modules/asset-treasury/internal-transactions/` (entire dir, after DTO moved)
- `src/modules/asset-treasury/internal-funds/` (entire dir, after DTO moved)

**Unchanged:** `prisma/schema.prisma` (tables stay, owned by funds-layer).

---

### Task 1: Add `findFundsOrderBySource` to funds-layer + export the service

**Files:**
- Modify: `src/modules/funds-layer/domain/internal-transfer.service.ts` (insert before final `}` at L447)
- Modify: `src/modules/funds-layer/funds-layer.module.ts:82-86`
- Test: `src/modules/funds-layer/domain/internal-transfer.service.spec.ts`

- [ ] **Step 1: Write the failing test** — append to `internal-transfer.service.spec.ts`:

```ts
describe('findFundsOrderBySource', () => {
  it('maps internalTransaction rows + funds legs by source', async () => {
    const prisma = {
      internalTransaction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'itx-1', internalTxNo: 'ITX-1', type: 'DEPOSIT_AGG', status: 'SUCCESS',
            funds: [{ internalFundNo: 'IF-1', status: 'CONFIRMED' }] },
        ]),
      },
    } as any;
    const svc = new InternalTransferService(prisma, { recordByActor: jest.fn() } as any);

    const result = await svc.findFundsOrderBySource('DEPOSIT', 'dep-1');

    expect(prisma.internalTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceType: 'DEPOSIT', sourceId: 'dep-1' } }),
    );
    expect(result).toEqual([
      { id: 'itx-1', internalTxNo: 'ITX-1', type: 'DEPOSIT_AGG', status: 'SUCCESS',
        legs: [{ internalFundNo: 'IF-1', status: 'CONFIRMED' }] },
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`findFundsOrderBySource is not a function`)

```bash
npx jest src/modules/funds-layer/domain/internal-transfer.service.spec.ts -t findFundsOrderBySource
```

- [ ] **Step 3: Add the method** — insert into `internal-transfer.service.ts` immediately before the closing brace of the class (after `findOneByNoForAdmin`, ~L446):

```ts
  async findFundsOrderBySource(
    sourceType: 'DEPOSIT' | 'WITHDRAW' | 'SWAP',
    sourceId: string,
  ) {
    const orders = await (this.prisma as any).internalTransaction.findMany({
      where: { sourceType, sourceId },
      orderBy: { createdAt: 'asc' },
      include: {
        funds: {
          orderBy: { createdAt: 'asc' },
          select: {
            internalFundNo: true,
            status: true,
            txHash: true,
            confirmations: true,
            blockNo: true,
            nonce: true,
            gasUsed: true,
            effectiveGasPrice: true,
            sentAt: true,
            confirmedAt: true,
          },
        },
      },
    });

    return (orders ?? []).map((order: any) => ({
      id: order.id,
      internalTxNo: order.internalTxNo,
      type: order.type,
      status: order.status,
      legs: order.funds ?? [],
    }));
  }
```

- [ ] **Step 4: Export the service** — in `funds-layer.module.ts`, add `InternalTransferService` to the `exports` array (L82-86):

```ts
  exports: [
    InternalTransferWorkflowService,
    FundTransferWorkflowService,
    EodSettlementWorkflowService,
    InternalTransferService,
  ],
```

- [ ] **Step 5: Run test — expect PASS** + typecheck:

```bash
npx jest src/modules/funds-layer/domain/internal-transfer.service.spec.ts -t findFundsOrderBySource
npx tsc --noEmit -p tsconfig.json
```
Expected: test PASS, tsc EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/
git commit -m "feat(funds-layer): port findFundsOrderBySource + export InternalTransferService"
```

---

### Task 2: Repoint trading (swap/withdraw/deposit) → funds-layer

> Same edit pattern in all three services. Method name `findFundsOrderBySource` is unchanged — only the injected service type/name + module import change. The returned shape is identical (same query, same table), so call sites need no further change beyond the receiver rename.

**Files:** `src/modules/trading/{swap,withdraw,deposit}-transactions/{*.service.ts,*.module.ts}`; their `.service.spec.ts`.

- [ ] **Step 1: swap-transactions** — 3 service edits + 2 module edits:
  - `swap-transactions.service.ts:11` replace import:
    ```ts
    import { InternalTransferService } from '../../funds-layer/domain/internal-transfer.service';
    ```
  - `:83` constructor param:
    ```ts
        private readonly internalTransferService: InternalTransferService,
    ```
  - `:320` call receiver:
    ```ts
          await this.internalTransferService.findFundsOrderBySource(
    ```
  - `swap-transactions.module.ts:13` replace import:
    ```ts
    import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
    ```
  - `:24` imports array — replace `InternalTransactionsModule,` with `FundsLayerModule,`

- [ ] **Step 2: withdraw-transactions** — same pattern:
  - `:26` import → `InternalTransferService` from `'../../funds-layer/domain/internal-transfer.service'`
  - `:118` ctor → `private readonly internalTransferService: InternalTransferService,`
  - `:410` call → `fundsOrders: await this.internalTransferService.findFundsOrderBySource(`
  - `withdraw-transactions.module.ts:16` import → `FundsLayerModule` from `'../../funds-layer/funds-layer.module'`
  - `:28` imports array — `InternalTransactionsModule,` → `FundsLayerModule,`

- [ ] **Step 3: deposit-transactions** — same pattern:
  - `:19` import → `InternalTransferService` from `'../../funds-layer/domain/internal-transfer.service'`
  - `:49` ctor → `private readonly internalTransferService: InternalTransferService,`
  - `:161` call → `await this.internalTransferService.findFundsOrderBySource(`
  - `deposit-transactions.module.ts:9` import → `FundsLayerModule` from `'../../funds-layer/funds-layer.module'`
  - `:12` imports array (inline) — `InternalTransactionsModule` → `FundsLayerModule`

- [ ] **Step 4: Fix the 3 trading specs** — wherever they provide/mock `InternalTransactionsService`, rename the provide token + mock var to `InternalTransferService` (import from funds-layer). Keep the mocked `findFundsOrderBySource` method.

- [ ] **Step 5: Typecheck + boot + trading specs**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading/swap-transactions src/modules/trading/withdraw-transactions src/modules/trading/deposit-transactions
npm run build   # nest build — confirms no circular-module error at compile
```
Expected: tsc EXIT=0, specs PASS, build OK.

> **Circular-dependency check:** `FundsLayerModule` imports `PricingCenterModule` (a trading sub-module). Pricing-center does NOT import deposit/swap/withdraw, so trading→funds-layer is acyclic. If `nest build` or app boot reports a circular dependency, wrap the import both ways with `forwardRef(() => FundsLayerModule)` and document it.

- [ ] **Step 6: Verify app boots** (no DI resolution error)

```bash
node -e "require('child_process').execSync('npx nest start --debug 2>&1 | head -40', {stdio:'inherit', timeout: 25000})" || true
```
Expected: log shows `Nest application successfully started` (or no `UnknownDependenciesException`/circular error). Kill after confirming.

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/
git commit -m "refactor(trading): read funds orders via funds-layer InternalTransferService"
```

---

### Task 3: Delete orphan controllers + `internal-funds` service + rbac routes

> After Task 2, the old `internal-transactions.service` is still referenced by `internal-funds.service`. Deleting `internal-funds.service` here removes that last internal caller. The 2 DTO files stay (moved in Task 5).

**Files:**
- Delete: `internal-funds/{internal-funds.controller.ts, internal-funds.service.ts, internal-funds.service.spec.ts, internal-funds.module.ts}` (KEEP `internal-funds/dto/`)
- Delete: `internal-transactions/internal-transactions.controller.ts` (+ `.controller.spec.ts` if present)
- Modify: `src/app.module.ts` (remove `InternalFundsModule` import L29 + usage L86)
- Modify: `rbac.catalog.ts` (remove 6 routes)

- [ ] **Step 1: Delete internal-funds service+controller+module (keep dto/)**

```bash
cd src/modules/asset-treasury/internal-funds
rm -f internal-funds.controller.ts internal-funds.service.ts internal-funds.service.spec.ts internal-funds.module.ts
ls   # expect: dto  (only)
```

- [ ] **Step 2: Delete orphan internal-transactions controller**

```bash
cd ../internal-transactions
rm -f internal-transactions.controller.ts internal-transactions.controller.spec.ts
```

- [ ] **Step 3: Remove `InternalFundsModule` from app.module.ts** — delete import line 29 (`import { InternalFundsModule } ...`) and its entry in the `imports: [...]` array (L86).

- [ ] **Step 4: Remove the 6 rbac routes** — in `rbac.catalog.ts`, delete the block (currently ~L323-330):

```ts
  // Internal transaction / fund
  route('GET', '/admin/internal-transactions', 'List internal transactions', ['INTERNAL_TX_READ']),
  route('GET', '/admin/internal-transactions/:id', 'Get internal transaction detail', ['INTERNAL_TX_READ']),

  route('GET', '/admin/internal-funds', 'List internal funds', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/internal-funds/:id', 'Get internal fund detail', ['INTERNAL_FUND_READ']),
  route('PATCH', '/admin/internal-funds/:id/status', 'Update internal fund status', ['INTERNAL_FUND_WRITE']),
  route('POST', '/admin/internal-funds/mock', 'Mock internal fund transition', ['INTERNAL_FUND_WRITE']),
```

- [ ] **Step 5: Remove now-orphan perm codes** — grep `INTERNAL_TX_READ|INTERNAL_FUND_READ|INTERNAL_FUND_WRITE` in `rbac.catalog.ts`; remove their permission-definition entries + any role-binding references. (If a `rbac.catalog.spec.ts` asserts presence, add `.toBe(false)` retirement assertions instead — mirror the existing "should retire …" tests.)

- [ ] **Step 6: Typecheck + jest + boot**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/identity/access-control src/modules/asset-treasury
npm run build
```
Expected: tsc EXIT=0, jest PASS, build OK. (tsc will flag any missed `InternalFundsService`/`InternalFundsModule` reference — fix until green.)

- [ ] **Step 7: Commit**

```bash
git add -A src/modules/asset-treasury/internal-funds src/modules/asset-treasury/internal-transactions src/app.module.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "refactor(funds): delete orphan internal-funds service + internal-transactions controller + rbac routes"
```

---

### Task 4: Delete `internal-transactions` service + module

> Now fully orphan (trading repointed in Task 2; internal-funds.service deleted in Task 3).

**Files:**
- Delete: `internal-transactions/{internal-transactions.service.ts, internal-transactions.service.spec.ts, internal-transactions.module.ts, internal-transaction.constants.ts}` (KEEP `dto/`)
- Modify: `src/app.module.ts` (remove `InternalTransactionsModule` import L28 + usage L85)

- [ ] **Step 1: Verify zero remaining references to the service** (must be empty except dto/ + the about-to-be-deleted files):

```bash
rg -rn "InternalTransactionsService|InternalTransactionsModule" src --glob '*.ts' | rg -v "internal-transactions/(internal-transactions|dto)"
```
Expected: no output. If any, STOP and repoint it first.

- [ ] **Step 2: Delete service + module + constants (keep dto/)**

```bash
cd src/modules/asset-treasury/internal-transactions
rm -f internal-transactions.service.ts internal-transactions.service.spec.ts internal-transactions.module.ts internal-transaction.constants.ts
ls   # expect: dto  (only)
```

- [ ] **Step 3: Remove `InternalTransactionsModule` from app.module.ts** — delete import line 28 + its `imports: [...]` entry (L85).

- [ ] **Step 4: Typecheck + jest + boot**

```bash
npx tsc --noEmit -p tsconfig.json && npm run build
npx jest src/modules/trading src/modules/asset-treasury src/modules/funds-layer
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A src/modules/asset-treasury/internal-transactions src/app.module.ts
git commit -m "refactor(funds): delete orphan internal-transactions service + module"
```

---

### Task 5: Relocate the 2 shared DTOs into funds-layer + delete old dir shells

> Only funds-layer imports these DTOs now. Move them in, repoint imports, delete the empty old dirs.

**Files:**
- Move: `internal-transactions/dto/internal-transaction.dto.ts` → `funds-layer/dto/internal-transaction.dto.ts`
- Move: `internal-funds/dto/internal-fund.dto.ts` → `funds-layer/dto/internal-fund.dto.ts`
- Modify: the 7 funds-layer importers
- Delete: the two now-empty `asset-treasury/internal-{transactions,funds}/` dirs

- [ ] **Step 1: Enumerate importers** (record the exact list before moving):

```bash
rg -rln "asset-treasury/internal-transactions/dto/internal-transaction.dto|asset-treasury/internal-funds/dto/internal-fund.dto" src --glob '*.ts'
```
Expected importers (verified): `funds-layer/domain/internal-transfer.service.ts`, `funds-layer/domain/funds-flow.service.ts` (+`.spec`), `funds-layer/dto/simulate-funds-flow.dto.ts`, `funds-layer/controllers/funds-simulate.controller.ts`, `funds-layer/workflow/fiat-settlement-workflow.service.ts` (+`.spec`).

- [ ] **Step 2: Move the files**

```bash
git mv src/modules/asset-treasury/internal-transactions/dto/internal-transaction.dto.ts src/modules/funds-layer/dto/internal-transaction.dto.ts
git mv src/modules/asset-treasury/internal-funds/dto/internal-fund.dto.ts src/modules/funds-layer/dto/internal-fund.dto.ts
```

- [ ] **Step 3: Repoint imports.** New paths are relative to each importer:
  - files in `funds-layer/dto/` → `'./internal-transaction.dto'` / `'./internal-fund.dto'`
  - files in `funds-layer/domain|controllers|workflow/` → `'../dto/internal-transaction.dto'` / `'../dto/internal-fund.dto'`

  Apply with sed across the funds-layer tree:
```bash
grep -rl "asset-treasury/internal-transactions/dto/internal-transaction.dto" src/modules/funds-layer \
  | xargs sed -i '' -e "s#\.\./\.\./asset-treasury/internal-transactions/dto/internal-transaction.dto#../dto/internal-transaction.dto#g"
grep -rl "asset-treasury/internal-funds/dto/internal-fund.dto" src/modules/funds-layer \
  | xargs sed -i '' -e "s#\.\./\.\./asset-treasury/internal-funds/dto/internal-fund.dto#../dto/internal-fund.dto#g"
# fix the in-dto/ self-references (./ not ../dto/)
sed -i '' -e "s#\.\./dto/internal-fund.dto#./internal-fund.dto#g" src/modules/funds-layer/dto/simulate-funds-flow.dto.ts
```
  Then verify no stale paths remain:
```bash
rg -rn "asset-treasury/internal-(transactions|funds)/dto" src --glob '*.ts' || echo "✓ clean"
```

- [ ] **Step 4: Delete the empty old dirs**

```bash
rm -rf src/modules/asset-treasury/internal-transactions src/modules/asset-treasury/internal-funds
```

- [ ] **Step 5: Typecheck + jest + boot**

```bash
npx tsc --noEmit -p tsconfig.json && npm run build
npx jest src/modules/funds-layer
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(funds): relocate internal-transaction/fund DTOs into funds-layer; delete old dirs"
```

---

### Task 6: Final verification + memory

- [ ] **Step 1: Full gates**

```bash
npx tsc --noEmit -p tsconfig.json && echo "backend OK"
( cd admin-web && npx tsc -b ) && echo "admin OK"
( cd client-web && npx tsc -b ) && echo "client OK"
npx jest 2>&1 | tail -15
npm run build
```
Expected: tsc×3 clean; jest all suites pass; build OK.

- [ ] **Step 2: Zero-residual grep**

```bash
rg -rn "InternalTransactionsService|InternalFundsService|InternalTransactionsModule|InternalFundsModule|asset-treasury/internal-transactions|asset-treasury/internal-funds" src --glob '*.ts' | rg -v "\.spec\." || echo "✓ zero residual"
```

- [ ] **Step 3: Confirm prisma untouched** (tables must remain — funds-layer owns them):

```bash
git diff --stat prisma/schema.prisma   # expect: no changes
npx prisma validate
```

- [ ] **Step 4: Render-verify the live admin funds pages** (per `feedback_verify_ui_by_rendering`) — start the branch stack (3500/3501), open `/admin/funds-layer/funds` (InternalFundListPage) + a transfer detail, screenshot, confirm data loads (the `/admin/funds-layer/*` endpoints are unchanged, so this guards against accidental breakage). Also exercise a deposit/swap/withdraw detail page to confirm the `fundsOrders` block (now read via funds-layer) still renders.

- [ ] **Step 5: Update memory** — in `compliance-sumsub-migration-cleanup.md` (or a fresh `funds-layer-consolidation.md`): record old stack retired, funds-layer sole owner, the commit chain, and that no schema change was needed.

---

## Risk notes for the executor

- **The one behavior-touching change is Task 2** (trading reads via funds-layer). Everything else is dead-code removal or a compile-only DTO move. Verify Task 2 with the trading specs + app boot before proceeding.
- **Module cycle:** trading→funds-layer is expected to be acyclic; if `nest build`/boot disagrees, use `forwardRef`. Don't skip the boot check.
- **Do NOT touch `prisma/schema.prisma`** — the `InternalTransaction`/`InternalFund`/`*AuditLog` tables stay; funds-layer reads/writes them.
- **Audit-module constants** (`INTERNAL_TRANSACTIONS`/`INTERNAL_FUNDS` in `audit-actions.constant.ts`): leave them — they map historical audit rows (same rationale as the compliance cleanup's Phase E).
- **Commit/push:** commit per task (as above). Do NOT push or open a PR unless the user asks.

## Self-Review

- **Coverage:** every old-stack component (2 services, 2 controllers, 2 modules, 2 DTOs, 6 rbac routes, 3 trading tethers, 2 app.module registrations) maps to a task. ✓
- **Type consistency:** the ported method signature/return matches the old one verbatim (`{id,internalTxNo,type,status,legs}`); trading consumes the identical shape. ✓
- **Placeholder scan:** new-method code, module-export edit, and rbac block are shown in full; deletions are exact paths; DTO move shows exact sed. ✓

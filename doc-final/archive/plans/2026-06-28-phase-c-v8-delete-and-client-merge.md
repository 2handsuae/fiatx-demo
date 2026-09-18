# Phase C — V8 Hard-Delete + Client Transaction Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Hard-delete the V8 reconciliation engine (7 service files + spec, Module wiring, frontend type residue, schema column + table). (2) Build the customer-facing transaction-history endpoint with backend group-by so a withdrawal (principal + fee) renders as one row and a swap (4 legs) renders as one row in `client-web/TransactionHistory.tsx`.

**Architecture:** Two independent sub-projects under one plan file. Section A is pure removal (no business risk; verified by `verify:coa`, `recon:demo:break`, jest). Section B adds a new backend grouping service on top of `account_flows`, exposes `/journal-lines/customer-balance-history` (currently 404), and updates `client-web/TransactionHistory.tsx` to consume the grouped rows.

**Tech Stack:** NestJS · Prisma (SQLite) · TigerBeetle (already on `account_flows` projection) · React (admin-web + client-web) · jest

---

## Section A — V8 Engine Hard Delete

Independent of Section B. All tasks here are backend cleanup + frontend type-residue + Prisma migration. Each task ends in a commit. After Task A.10 the entire V8 engine is gone.

### Task A.1: Drop V8 imports from `reconciliation.module.ts`

**Files:**
- Modify: `Exchange_js/src/modules/clearing-settle/reconciliation/reconciliation.module.ts`

- [ ] **Step 1: Edit module to drop V8 imports**

Remove these `import` statements:
```ts
import { InvariantCheckerService } from './engine/invariant-checker.service';
import { CreditNetService } from './engine/credit-net.service';
import { FormulaCheckerService } from './engine/formula-checker.service';
import { ReconciliationRunWorkflowService } from './workflow/reconciliation-run-workflow.service';
import { RedesignReconRunService } from './workflow/redesign-recon-run.service';
import { ReconciliationRunService } from './domain/reconciliation-run.service';
import { ReconciliationCaseService } from './domain/reconciliation-case.service';
```

Remove these classes from `providers` and `exports` arrays:
- `InvariantCheckerService`, `CreditNetService`, `FormulaCheckerService`
- `ReconciliationRunWorkflowService`, `RedesignReconRunService`
- `ReconciliationRunService`, `ReconciliationCaseService`

Also drop any `forwardRef(() => RedesignReconRunService)` references.

- [ ] **Step 2: Verify build fails on dangling imports elsewhere**

Run: `cd Exchange_js && npm run build 2>&1 | head -40`
Expected: TypeScript errors listing each remaining consumer of the deleted classes.

- [ ] **Step 3: Fix every dangling consumer**

For every `error TS2304: Cannot find name 'X'` or `error TS2307: Cannot find module './X'`:
- If in another service: delete that consumer too (it's V8 chain) — record in commit message.
- If in `reconciliation-sweep.service.ts`: already uses `WalletReconRunService`, so no change expected.
- If in `controllers/reconciliation-admin.controller.ts`: drop the route handler and its constructor injection.

- [ ] **Step 4: Rerun build to confirm clean**

Run: `npm run build`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/reconciliation.module.ts \
        src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts
git commit -m "refactor(recon): unwire V8 services from module + controllers"
```

---

### Task A.2: Delete V8 engine service files

**Files:**
- Delete: `src/modules/clearing-settle/reconciliation/engine/credit-net.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/engine/credit-net.service.spec.ts`
- Delete: `src/modules/clearing-settle/reconciliation/engine/formula-checker.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/engine/formula-checker.service.spec.ts`
- Delete: `src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.spec.ts`

- [ ] **Step 1: Confirm no other code imports these**

Run:
```bash
cd Exchange_js
grep -rn "CreditNetService\|FormulaCheckerService\|InvariantCheckerService" src 2>/dev/null \
  | grep -v node_modules
```
Expected: only the self-references inside the 6 files about to be deleted.

- [ ] **Step 2: Delete the files**

```bash
rm src/modules/clearing-settle/reconciliation/engine/credit-net.service.ts
rm src/modules/clearing-settle/reconciliation/engine/credit-net.service.spec.ts
rm src/modules/clearing-settle/reconciliation/engine/formula-checker.service.ts
rm src/modules/clearing-settle/reconciliation/engine/formula-checker.service.spec.ts
rm src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.ts
rm src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.spec.ts
```

- [ ] **Step 3: Build + test**

```bash
npm run build && npx jest src/modules/clearing-settle/reconciliation
```
Expected: build exit 0; jest passes (some spec count drop is expected).

- [ ] **Step 4: Commit**

```bash
git add -A src/modules/clearing-settle/reconciliation/engine
git commit -m "refactor(recon): delete V8 engine — credit-net, formula-checker, invariant-checker"
```

---

### Task A.3: Delete V8 workflow service files

**Files:**
- Delete: `src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.spec.ts`
- Delete: `src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.spec.ts`

- [ ] **Step 1: Confirm no live consumers**

```bash
grep -rn "ReconciliationRunWorkflowService\|RedesignReconRunService" src 2>/dev/null \
  | grep -v -E '\.spec\.|node_modules' | head -5
```
Expected: empty (sweep already on wallet engine; module already unwired in A.1).

- [ ] **Step 2: Delete the files**

```bash
rm src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.ts \
   src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.spec.ts \
   src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.ts \
   src/modules/clearing-settle/reconciliation/workflow/redesign-recon-run.service.spec.ts
```

- [ ] **Step 3: Build + test**

```bash
npm run build && npx jest src/modules/clearing-settle/reconciliation
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A src/modules/clearing-settle/reconciliation/workflow
git commit -m "refactor(recon): delete V8 workflow — reconciliation-run-workflow + redesign-recon-run shim"
```

---

### Task A.4: Delete legacy domain CRUD services

**Files:**
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts`
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts`
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts`

- [ ] **Step 1: Confirm no live consumers**

```bash
grep -rn "ReconciliationRunService\|ReconciliationCaseService" src 2>/dev/null \
  | grep -v -E '\.spec\.|node_modules' | head -5
```
Expected: empty (the wallet engine has its own inline upsert helpers).

- [ ] **Step 2: Delete the files**

```bash
rm src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.ts \
   src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts \
   src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts \
   src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts
```

- [ ] **Step 3: Build + test**

```bash
npm run build && npx jest src/modules/clearing-settle/reconciliation
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A src/modules/clearing-settle/reconciliation/domain
git commit -m "refactor(recon): delete legacy domain CRUD — ReconciliationRunService + ReconciliationCaseService"
```

---

### Task A.5: Strip frontend InvariantCheck residue

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/ReconciliationRunsDetailPage.tsx`

- [ ] **Step 1: Find the residue lines**

```bash
grep -n "InvariantCheck\|invariantChecks" Exchange_js/admin-web/src/pages/ReconciliationRunsDetailPage.tsx
```
Expected: ~2 hits (interface declaration + ReconRunDetail member).

- [ ] **Step 2: Remove the interface and the member**

Delete the entire `interface InvariantCheck { ... }` block.
Delete `invariantChecks: InvariantCheck[];` from `ReconRunDetail`.

- [ ] **Step 3: Build admin-web**

```bash
cd Exchange_js/admin-web && npm run build && cd ..
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/ReconciliationRunsDetailPage.tsx
git commit -m "refactor(recon UI): drop dead InvariantCheck interface from Run detail page"
```

---

### Task A.6: Drop `engineVersion` column from `ReconciliationRun` model

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`

- [ ] **Step 1: Edit the model**

In `model ReconciliationRun { ... }`:
- Delete the line `engineVersion   String   @default("V8_FORMULA")` and its preceding 2-line comment.
- Delete the line `@@index([engineVersion])`.

- [ ] **Step 2: Generate prisma client**

Run: `cd Exchange_js && npm run prisma:generate`
Expected: regenerated client, no errors.

- [ ] **Step 3: Update wallet engine reads to not reference engineVersion**

```bash
grep -rn "engineVersion" src 2>/dev/null | grep -v -E '\.spec\.|node_modules'
```
Expected: matches in `wallet-recon-run.service.ts`, `reconciliation-query.service.ts`. For each: delete the `engineVersion: ...` assignment / read; keep wallet engine writing only the rest.

- [ ] **Step 4: Update specs**

```bash
grep -rn "engineVersion" src 2>/dev/null
```
For each spec hit: delete the line (data fixtures only — no test logic depends on it).

- [ ] **Step 5: Build + jest**

```bash
npm run build && npx jest src/modules/clearing-settle/reconciliation
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src
git commit -m "refactor(recon): drop reconciliation_runs.engineVersion column (single-engine only)"
```

---

### Task A.7: Drop `ReconciliationInvariantCheck` model

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`

- [ ] **Step 1: Edit the model**

In `model ReconciliationRun`:
- Delete the relation: `invariantChecks ReconciliationInvariantCheck[]`

Delete the entire `model ReconciliationInvariantCheck { ... }` block.

- [ ] **Step 2: Update consumers**

```bash
grep -rn "invariantChecks\|ReconciliationInvariantCheck" src 2>/dev/null \
  | grep -v -E '\.spec\.|node_modules'
```
For each remaining match: delete the line / property.

Specifically: in `reconciliation-query.service.ts`, the `include: { invariantChecks: true }` on `findUnique` for `getRun` — delete the include and the spread `...run` is fine without it.

- [ ] **Step 3: Generate prisma client**

```bash
npm run prisma:generate
```
Expected: regenerated, no errors.

- [ ] **Step 4: Build + jest**

```bash
npm run build && npx jest src/modules/clearing-settle/reconciliation
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src
git commit -m "refactor(recon): drop ReconciliationInvariantCheck model (V8 five-formula residue)"
```

---

### Task A.8: Author the destructive migration

**Files:**
- Create: `Exchange_js/prisma/migrations/20260628120000_drop_v8_engine_residue/migration.sql`

- [ ] **Step 1: Reset main stack DB to a fresh slate**

```bash
cd Exchange_js && bash scripts/stack.sh reset-main
```
Expected: DB wiped, base seed re-applied, stack restarted.

- [ ] **Step 2: Generate the migration via `prisma migrate dev`**

```bash
npx prisma migrate dev --name drop_v8_engine_residue --create-only
```
Expected: a new directory under `prisma/migrations/` with a `migration.sql` containing `DROP TABLE` for `reconciliation_invariant_checks` and `ALTER TABLE reconciliation_runs DROP COLUMN engineVersion`.

If `--create-only` is unavailable, manually create `prisma/migrations/20260628120000_drop_v8_engine_residue/migration.sql` with:
```sql
-- Drop V8 five-formula engine residue.
DROP TABLE IF EXISTS "reconciliation_invariant_checks";
-- SQLite: drop column via table-rebuild (Prisma generates this automatically when --create-only is used).
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reconciliation_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runNo" TEXT NOT NULL DEFAULT 'TEMP',
    "businessDate" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "triggerType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'APPLY',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "invariantStatus" TEXT NOT NULL DEFAULT 'PASS',
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "reObservedCount" INTEGER NOT NULL DEFAULT 0,
    "closedCount" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demoManifest" TEXT
);
INSERT INTO "new_reconciliation_runs" SELECT
  "id","runNo","businessDate","layer","seq","triggerType","mode","status",
  "invariantStatus","openedCount","reObservedCount","closedCount","traceId",
  "startedAt","completedAt","createdAt","demoManifest"
FROM "reconciliation_runs";
DROP TABLE "reconciliation_runs";
ALTER TABLE "new_reconciliation_runs" RENAME TO "reconciliation_runs";
CREATE UNIQUE INDEX "reconciliation_runs_runNo_key" ON "reconciliation_runs"("runNo");
CREATE INDEX "reconciliation_runs_businessDate_layer_idx" ON "reconciliation_runs"("businessDate", "layer");
PRAGMA foreign_keys=ON;
```

- [ ] **Step 3: Apply migration**

```bash
npx prisma migrate dev
```
Expected: migration applied, prisma client regenerated.

- [ ] **Step 4: Verify schema state**

```bash
sqlite3 /tmp/exchange_js_main/dev.db ".schema reconciliation_runs" \
  | grep -E "engineVersion|invariantChecks"
sqlite3 /tmp/exchange_js_main/dev.db ".tables" | grep invariant_checks
```
Expected: both empty (column gone, table gone).

- [ ] **Step 5: Smoke wallet engine end to end**

```bash
DATABASE_URL=file:/tmp/exchange_js_main/dev.db TB_ADDRESS=127.0.0.1:3003 \
  npx ts-node -r tsconfig-paths/register scripts/recon-demo.ts --mode=break 2>&1 | tail -10
npm run verify:coa
```
Expected: `recon:demo:break` reports ALL 5 ANOMALIES DETECTED; `verify:coa` ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260628120000_drop_v8_engine_residue/
git commit -m "feat(prisma): migration — drop reconciliation_runs.engineVersion + reconciliation_invariant_checks"
```

---

### Task A.9: Drop RBAC catalog entries for retired routes

**Files:**
- Modify: `Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Search for V8-only routes still listed**

```bash
grep -n "redesign\|reconciliation/runs.*redesign" \
  src/modules/identity/access-control/rbac.catalog.ts
```
Expected: any line referencing the deleted V8 route — delete that line.

If A.1 already removed the controller route, this catalog clean-up may be a no-op. Either way, confirm.

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: exit 0.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "chore(rbac): drop catalog entries for retired V8 reconciliation routes"
```

---

### Task A.10: Full-stack smoke + e2e proof

- [ ] **Step 1: Restart detached stack with the fresh schema**

```bash
bash /tmp/exchange_js_main/start-stack.sh
sleep 3
curl -s "http://localhost:3000/admin/reconciliation/runs" \
  -H "Authorization: Bearer $(cat /tmp/exchange_js_main/admin.tok)" \
  | python3 -c "import sys, json; print(len(json.load(sys.stdin)))"
```
Expected: prints `1` (the latest WALLET_V1 run produced by Task A.8 smoke).

- [ ] **Step 2: Full jest pass**

```bash
cd Exchange_js && npm test 2>&1 | tail -5
```
Expected: All reconciliation specs pass. (Some pre-existing deposit/withdraw spec failures are out of scope for Phase C; record any new failures.)

- [ ] **Step 3: Admin UI render check**

Open `/admin/reconciliation/runs/RUN20260628-1` in the preview, then `/admin/reconciliation/cases/REC20260628-001`. Confirm: no console errors, no missing fields, no `InvariantCheck` UI element.

- [ ] **Step 4: Commit smoke artifacts (no code change)**

If everything passes, leave a final marker commit:
```bash
git commit --allow-empty -m "chore(recon): Phase C-1 V8 hard-delete complete + smoke green"
```

---

## Section B — Client Transaction History Merge

Builds the customer-facing flow API and updates `client-web/TransactionHistory.tsx`. The `/journal-lines/customer-balance-history` endpoint does NOT exist today — Task B.2 creates it.

### Task B.1: Sketch the response shape via a type module

**Files:**
- Create: `Exchange_js/src/modules/clearing-settle/customer-history/dto/customer-history.dto.ts`

- [ ] **Step 1: Write the shape**

```ts
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';

export class CustomerHistoryQueryDto {
  @IsString() customerId!: string;
  @IsString() assetId!: string;
  @IsOptional() @IsInt() @Min(0) skip?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) take?: number;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}

export interface CustomerHistoryLeg {
  journalLineId: string;
  amount: string;
  direction: 'IN' | 'OUT';
  eventCode: string;
  sourceType: string;
  sourceNo: string | null;
  createdAt: string;
  description: string | null;
}

export interface CustomerHistoryItem {
  id: string;            // sourceNo for grouped, leg.id for ungrouped
  sourceType: string;    // WITHDRAWAL | SWAP | PAYIN | DEPOSIT | OTHER
  sourceNo: string | null;
  eventCode: string;     // representative leg's eventCode
  description: string;   // business sentence
  direction: 'IN' | 'OUT';
  totalAmount: string;   // signed sum of legs' amounts in wallet-balance terms
  createdAt: string;     // earliest leg's createdAt
  legs: CustomerHistoryLeg[];
  // Withdraw-specific:
  principalAmount?: string;
  feeAmount?: string;
  // Swap-specific:
  swapFromAmount?: string;
  swapToAmount?: string;
  swapFromAsset?: string;
  swapToAsset?: string;
}

export interface CustomerHistoryResponse {
  items: CustomerHistoryItem[];
  total: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/clearing-settle/customer-history/dto/customer-history.dto.ts
git commit -m "feat(customer-history): DTO shapes for grouped customer flow history"
```

---

### Task B.2: Implement `CustomerHistoryService`

**Files:**
- Create: `Exchange_js/src/modules/clearing-settle/customer-history/customer-history.service.ts`
- Create: `Exchange_js/src/modules/clearing-settle/customer-history/customer-history.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { CustomerHistoryService } from './customer-history.service';
import { Prisma } from '@prisma/client';
const D = (n: any) => new Prisma.Decimal(n);

describe('CustomerHistoryService.list — grouping', () => {
  function mkPrisma(rows: any[], total: number) {
    return {
      accountFlow: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(total),
      },
      asset: { findUnique: jest.fn().mockResolvedValue({ code: 'AED', currency: 'AED' }) },
    } as any;
  }
  const baseFlow = {
    id: 'f', direction: 'OUT', amount: D('100'), eventCode: 'EVT', sourceType: 'X',
    sourceNo: 'X1', createdAt: new Date(), externalRef: null,
  };

  it('collapses a Withdrawal (principal + fee) into one item with two legs', async () => {
    const principal = { ...baseFlow, id: 'p', sourceType: 'WITHDRAWAL', sourceNo: 'WD1', eventCode: 'WITHDRAW_NET_POST', amount: D('100') };
    const fee = { ...baseFlow, id: 'f', sourceType: 'WITHDRAWAL', sourceNo: 'WD1', eventCode: 'WITHDRAW_FEE_POST', amount: D('5') };
    const svc = new CustomerHistoryService(mkPrisma([principal, fee], 2));
    const r = await svc.list({ customerId: 'c1', assetId: 'a1', skip: 0, take: 25 });
    expect(r.total).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].sourceType).toBe('WITHDRAWAL');
    expect(r.items[0].totalAmount).toBe('-105');
    expect(r.items[0].principalAmount).toBe('100');
    expect(r.items[0].feeAmount).toBe('5');
    expect(r.items[0].legs).toHaveLength(2);
  });

  it('collapses a Swap (4 legs) into one item with four legs', async () => {
    const legs = [1,2,3,4].map((i) => ({ ...baseFlow, id: 'l'+i, sourceType: 'SWAP', sourceNo: 'SWP1', amount: D(String(i * 10)) }));
    const svc = new CustomerHistoryService(mkPrisma(legs, 4));
    const r = await svc.list({ customerId: 'c1', assetId: 'a1', skip: 0, take: 25 });
    expect(r.total).toBe(1);
    expect(r.items[0].sourceType).toBe('SWAP');
    expect(r.items[0].legs).toHaveLength(4);
  });

  it('keeps Deposit / Payin as 1 row per leg (no grouping)', async () => {
    const deposit = { ...baseFlow, id: 'd1', sourceType: 'PAYIN', sourceNo: 'PI1', amount: D('1000'), direction: 'IN' };
    const svc = new CustomerHistoryService(mkPrisma([deposit], 1));
    const r = await svc.list({ customerId: 'c1', assetId: 'a1', skip: 0, take: 25 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].sourceType).toBe('PAYIN');
    expect(r.items[0].legs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest customer-history.service.spec
```
Expected: FAIL — `Cannot find module './customer-history.service'`.

- [ ] **Step 3: Implement the service**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CustomerHistoryQueryDto,
  CustomerHistoryItem,
  CustomerHistoryLeg,
  CustomerHistoryResponse,
} from './dto/customer-history.dto';

@Injectable()
export class CustomerHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: CustomerHistoryQueryDto): Promise<CustomerHistoryResponse> {
    const where: any = {
      ownerType: 'CUSTOMER',
      ownerNo: q.customerId,
      assetId: q.assetId,
      transferType: 'POSTED',
    };
    if (q.startDate || q.endDate) {
      where.createdAt = {};
      if (q.startDate) where.createdAt.gte = new Date(q.startDate);
      if (q.endDate) where.createdAt.lte = new Date(q.endDate);
    }
    const flows = await (this.prisma as any).accountFlow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Group by (sourceType, sourceNo) for WITHDRAWAL and SWAP only.
    const groups = new Map<string, any[]>();
    const out: CustomerHistoryItem[] = [];
    for (const f of flows) {
      if ((f.sourceType === 'WITHDRAWAL' || f.sourceType === 'SWAP') && f.sourceNo) {
        const key = `${f.sourceType}|${f.sourceNo}`;
        const arr = groups.get(key) ?? [];
        arr.push(f);
        groups.set(key, arr);
        continue;
      }
      out.push(this.toUngrouped(f));
    }
    for (const [, arr] of groups) out.push(this.toGrouped(arr));

    out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const total = out.length;
    const sliced = out.slice(q.skip ?? 0, (q.skip ?? 0) + (q.take ?? 25));
    return { items: sliced, total };
  }

  private toUngrouped(f: any): CustomerHistoryItem {
    return {
      id: f.id,
      sourceType: f.sourceType,
      sourceNo: f.sourceNo,
      eventCode: f.eventCode,
      description: f.description ?? f.eventCode,
      direction: f.direction,
      totalAmount: this.signed(f),
      createdAt: f.createdAt.toISOString?.() ?? String(f.createdAt),
      legs: [this.toLeg(f)],
    };
  }

  private toGrouped(arr: any[]): CustomerHistoryItem {
    const first = arr[0];
    const sumIn = arr.filter((x) => x.direction === 'IN').reduce((a, b) => a + Number(b.amount), 0);
    const sumOut = arr.filter((x) => x.direction === 'OUT').reduce((a, b) => a + Number(b.amount), 0);
    const total = sumIn - sumOut;
    if (first.sourceType === 'WITHDRAWAL') {
      const principalLeg = arr.find((x) => x.eventCode?.includes('NET'));
      const feeLeg = arr.find((x) => x.eventCode?.includes('FEE'));
      return {
        id: first.sourceNo,
        sourceType: 'WITHDRAWAL',
        sourceNo: first.sourceNo,
        eventCode: principalLeg?.eventCode ?? first.eventCode,
        description: `Withdraw ${Math.abs(total)}`,
        direction: total < 0 ? 'OUT' : 'IN',
        totalAmount: String(total),
        createdAt: this.minDate(arr),
        legs: arr.map((f) => this.toLeg(f)),
        principalAmount: principalLeg ? String(principalLeg.amount) : undefined,
        feeAmount: feeLeg ? String(feeLeg.amount) : undefined,
      };
    }
    // SWAP
    return {
      id: first.sourceNo,
      sourceType: 'SWAP',
      sourceNo: first.sourceNo,
      eventCode: first.eventCode,
      description: 'Swap',
      direction: total < 0 ? 'OUT' : 'IN',
      totalAmount: String(total),
      createdAt: this.minDate(arr),
      legs: arr.map((f) => this.toLeg(f)),
    };
  }

  private signed(f: any): string {
    return f.direction === 'IN' ? String(f.amount) : '-' + String(f.amount);
  }
  private toLeg(f: any): CustomerHistoryLeg {
    return {
      journalLineId: f.id,
      amount: String(f.amount),
      direction: f.direction,
      eventCode: f.eventCode,
      sourceType: f.sourceType,
      sourceNo: f.sourceNo,
      createdAt: f.createdAt.toISOString?.() ?? String(f.createdAt),
      description: f.description ?? null,
    };
  }
  private minDate(arr: any[]): string {
    const d = arr.reduce((a, b) => +new Date(a.createdAt) < +new Date(b.createdAt) ? a : b);
    return d.createdAt.toISOString?.() ?? String(d.createdAt);
  }
}
```

- [ ] **Step 4: Rerun test**

```bash
npx jest customer-history.service.spec
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/customer-history
git commit -m "feat(customer-history): service collapses withdrawal/swap into grouped rows"
```

---

### Task B.3: Wire controller + module

**Files:**
- Create: `Exchange_js/src/modules/clearing-settle/customer-history/customer-history.controller.ts`
- Create: `Exchange_js/src/modules/clearing-settle/customer-history/customer-history.module.ts`
- Modify: `Exchange_js/src/app.module.ts` (register the module)

- [ ] **Step 1: Write the controller**

```ts
import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerHistoryService } from './customer-history.service';
import { CustomerHistoryQueryDto } from './dto/customer-history.dto';

@Controller('journal-lines')
@UseGuards(AuthGuard('jwt'))
export class CustomerHistoryController {
  constructor(private readonly svc: CustomerHistoryService) {}

  @Get('customer-balance-history')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  list(@Query() q: CustomerHistoryQueryDto) {
    return this.svc.list(q);
  }
}
```

- [ ] **Step 2: Write the module**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CustomerHistoryService } from './customer-history.service';
import { CustomerHistoryController } from './customer-history.controller';

@Module({
  imports: [PrismaModule],
  providers: [CustomerHistoryService],
  controllers: [CustomerHistoryController],
})
export class CustomerHistoryModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

In the `imports` array of the root `@Module({...})` add: `CustomerHistoryModule,` and `import { CustomerHistoryModule } from './modules/clearing-settle/customer-history/customer-history.module';` at the top.

- [ ] **Step 4: Build + jest**

```bash
npm run build && npx jest customer-history
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(customer-history): expose /journal-lines/customer-balance-history endpoint"
```

---

### Task B.4: Endpoint smoke via curl

- [ ] **Step 1: Restart backend so the new endpoint is loaded**

```bash
PID=$(lsof -ti:3000 -sTCP:LISTEN); [ -n "$PID" ] && kill $PID; sleep 1
bash /tmp/exchange_js_main/start-stack.sh
sleep 3
```

- [ ] **Step 2: Pick a customer + asset that has flows**

```bash
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT DISTINCT ownerNo, assetId FROM account_flows WHERE ownerType='CUSTOMER' LIMIT 3;"
```
Pick one customer / asset pair, e.g. `CU2601019430` + AED asset id.

- [ ] **Step 3: Get a customer JWT (sign in via existing seed credentials)**

```bash
curl -s "http://localhost:3000/auth/customer/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"123456"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token','NO_TOKEN'))"
```
Save the token.

- [ ] **Step 4: Hit the endpoint**

```bash
TOKEN=<the token from step 3>
curl -s "http://localhost:3000/journal-lines/customer-balance-history?customerId=CU2601019430&assetId=<aedAssetId>&skip=0&take=25" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool | head -40
```
Expected: JSON with `items[]` and `total`; each Withdrawal collapses 2 legs into 1 item with `principalAmount` + `feeAmount`.

- [ ] **Step 5: No commit needed — but record the curl output**

Save to `/tmp/exchange_js_main/phase-c-b4-curl.json` for later reference.

---

### Task B.5: Update `client-web/TransactionHistory.tsx` for grouped rows

**Files:**
- Modify: `Exchange_js/client-web/src/pages/TransactionHistory.tsx`

- [ ] **Step 1: Replace the legacy item type with the new grouped shape**

Replace the existing `interface TransactionItem` (or equivalent) with:

```ts
interface CustomerHistoryLeg {
  journalLineId: string;
  amount: string;
  direction: 'IN' | 'OUT';
  eventCode: string;
  sourceType: string;
  sourceNo: string | null;
  createdAt: string;
  description: string | null;
}
interface TransactionItem {
  id: string;
  sourceType: string;
  sourceNo: string | null;
  eventCode: string;
  description: string;
  direction: 'IN' | 'OUT';
  totalAmount: string;
  createdAt: string;
  legs: CustomerHistoryLeg[];
  principalAmount?: string;
  feeAmount?: string;
  swapFromAmount?: string;
  swapToAmount?: string;
  swapFromAsset?: string;
  swapToAsset?: string;
}
```

- [ ] **Step 2: Render the main row using `totalAmount`**

In the JSX where each item renders, replace `item.amount` reads with `item.totalAmount`. The description column should show:
- For `WITHDRAWAL`: `Withdraw {formatAmount(totalAmount)}`
- For `SWAP`: `Swap {item.swapFromAmount ?? ''} for {item.swapToAmount ?? ''}`
- Else: `item.description || item.eventCode.replace('EVT_','').replace(/_/g,' ')`

- [ ] **Step 3: Add expand/collapse for grouped rows**

Track per-row open state:
```tsx
const [open, setOpen] = useState<Record<string, boolean>>({});
const toggle = (id: string) => setOpen((s) => ({ ...s, [id]: !s[id] }));
```

For items where `legs.length > 1`, render a chevron button that toggles `open[item.id]`. When open, render a sub-table beneath the row listing each leg with: timestamp, eventCode, amount, direction.

- [ ] **Step 4: Build client-web**

```bash
cd Exchange_js/client-web && npm run build && cd ../..
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add client-web/src/pages/TransactionHistory.tsx
git commit -m "feat(client): TransactionHistory consumes grouped rows + expandable legs"
```

---

### Task B.6: Render verify in client-web + final commit

- [ ] **Step 1: Open client-web in preview, sign in as a customer with both withdrawals and swaps**

Use `preview_start` with the client-web launch config, sign in as `alice@example.com / 123456`, navigate to Transaction History.

- [ ] **Step 2: Capture and confirm**

Screenshot the list. Confirm:
- Withdrawals appear as ONE row with totalAmount (e.g. "Withdraw -105 AED").
- Expanding the row shows two legs (principal + fee).
- Swaps appear as ONE row with the "Swap X for Y" description.
- Expanding shows 4 legs.
- Pagination still works.

- [ ] **Step 3: Final marker commit**

```bash
git commit --allow-empty -m "chore(phase-c): C-2 client transaction merge complete + render verified"
```

---

## Spec Coverage Self-Review (writer's checklist)

- [x] **C-1 backend service delete (7 files+spec)** — Tasks A.2 + A.3 + A.4
- [x] **C-1 Module unwire** — Task A.1
- [x] **C-1 Controller route + RBAC catalog clean** — Tasks A.1 + A.9
- [x] **C-1 Frontend InvariantCheck residue** — Task A.5
- [x] **C-1 Schema drop column + drop table + migration** — Tasks A.6 + A.7 + A.8
- [x] **C-1 jest + verify:coa + recon:demo:break smoke** — Task A.10
- [x] **C-2 group-by sourceType+sourceNo for WITHDRAWAL + SWAP** — Task B.2
- [x] **C-2 endpoint creation (was 404)** — Task B.3
- [x] **C-2 response with legs + principalAmount/feeAmount/swapFrom/To** — Task B.1
- [x] **C-2 frontend totalAmount + expand legs** — Task B.5
- [x] **C-2 pagination on grouped rows (server-side)** — Task B.2 (slice happens after grouping)
- [x] **C-2 render verify** — Task B.6

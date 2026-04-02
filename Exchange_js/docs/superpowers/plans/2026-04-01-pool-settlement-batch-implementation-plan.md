# Pool Settlement Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full `FeeOccurrence -> ReimbursementObligation -> PoolSettlementBatch -> InternalTransaction -> InternalFund` settlement chain with batch-level approval, cross-family netting, admin APIs, scheduler, and admin-web list/detail pages.

**Architecture:** Keep `Outstanding` and `ReimbursementObligation` as source truth objects, add a new `PoolSettlementBatch / PoolSettlementBatchItem / PoolSettlementBatchItemSource` family under `clearing-settle`, and project approved batch items into `InternalTransaction` and `InternalFund`. Batch-local routing, netting, and closeout live outside source truth; source truth only receives a minimal batch lock field and final status projection.

**Tech Stack:** NestJS, Prisma, PostgreSQL, EventEmitter, shared approval engine, React admin-web, Jest, npm

---

## File Structure

### Backend files to create

- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/dto/pool-settlement-batch.dto.ts`
  - DTOs for create/list/detail/submit endpoints and admin read model enums.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.ts`
  - Admin endpoints under `/admin/pool-settlement-batches`.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
  - Core batch creation, source locking, routing, netting, item creation, submit flow.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.ts`
  - Listens to approval decision events and dispatches or releases batch sources.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.ts`
  - Handles item success/failure projection and final batch closeout after fund events.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts`
  - Daily `23:59` auto-create and auto-submit.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module.ts`
  - Nest module wiring imports/providers/controllers/exports.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts`
  - Batch creation, zero-net, skip-unroutable, no-empty-batch coverage.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts`
  - Admin endpoint and permission coverage.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts`
  - Approval approved/rejected/cancelled/expired projection coverage.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts`
  - Batch closeout and source release coverage.

### Backend files to modify

- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/prisma/schema.prisma`
  - Add new models, indexes, enums-as-strings, source lock fields, and internal transaction linkage fields.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/app.module.ts`
  - Import new `PoolSettlementBatchesModule`.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/governance/approvals/constants/approval.constants.ts`
  - Add `POOL_SETTLEMENT_BATCH_APPROVAL` action type and policy.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`
  - Add list/detail/create/submit permissions for pool settlement batches.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/reimbursement-obligations/reimbursement-obligations.service.ts`
  - Respect source locking and expose records needed by batch creation.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/outstandings/outstandings.service.ts`
  - Respect source locking and expose records needed by batch creation.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-transactions/dto/internal-transaction.dto.ts`
  - Add pool-settlement source type/fields to admin read models.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts`
  - Accept pool settlement source metadata and expose it in admin detail.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-funds/internal-funds.service.ts`
  - Notify pool settlement closeout on fund status change using the existing event.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-funds/internal-funds.module.ts`
  - Export dependencies as needed if new closeout service needs them.

### Frontend files to create

- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/pages/PoolSettlementBatchListPage.tsx`
  - List page with create button.
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/pages/PoolSettlementBatchDetailPage.tsx`
  - Detail page with summary, items, item sources, skipped source summary, derived transactions, and submit button.

### Frontend files to modify

- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/App.tsx`
  - Add routes.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/components/DashboardLayout.tsx`
  - Add menu entry under `Treasury Center`.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/rbac/permissions.ts`
  - Add frontend permission constants.
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/pages/ApprovalDetailPage.tsx`
  - Optional: ensure pool settlement approval entity link renders cleanly if current page uses source labels.

### Other files

- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/prisma/migrations/20260401120000_pool_settlement_batches/migration.sql`
  - New migration generated after schema change.

---

### Task 1: Add Prisma Models and Source Lock Fields

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/prisma/schema.prisma`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/prisma/migrations/20260401120000_pool_settlement_batches/migration.sql`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/prisma/schema.prisma`

- [ ] **Step 1: Add the failing schema diff**

Insert these models and fields into `schema.prisma` near `OutstandingSettlement`:

```prisma
model PoolSettlementBatch {
  id             String   @id @default(uuid())
  batchNo        String   @unique
  status         String
  cutoffAt       DateTime
  submittedAt    DateTime?
  approvedAt     DateTime?
  closedAt       DateTime?
  approvalCaseId String?
  createdByUserId String?
  autoCreated    Boolean  @default(false)
  summaryJson    String   @default("{}")
  metadataJson   String   @default("{}")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  items          PoolSettlementBatchItem[]
  itemSources    PoolSettlementBatchItemSource[]

  @@index([status])
  @@index([cutoffAt])
  @@index([approvalCaseId])
  @@index([autoCreated, createdAt])
  @@map("pool_settlement_batches")
}

model PoolSettlementBatchItem {
  id                   String   @id @default(uuid())
  batchId              String
  status               String
  assetId              String
  walletPairKey        String
  walletAId            String
  walletBId            String
  netDirection         String
  netAmount            Decimal
  submittedAmount      Decimal  @default(0)
  settledAmount        Decimal  @default(0)
  failedReason         String?
  internalTransactionId String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  batch                PoolSettlementBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  asset                Asset    @relation(fields: [assetId], references: [id])
  walletA              Wallet   @relation("PoolSettlementBatchItemWalletA", fields: [walletAId], references: [id])
  walletB              Wallet   @relation("PoolSettlementBatchItemWalletB", fields: [walletBId], references: [id])
  internalTransaction  InternalTransaction? @relation("PoolSettlementBatchItemTx", fields: [internalTransactionId], references: [id], onDelete: SetNull)
  itemSources          PoolSettlementBatchItemSource[]

  @@index([batchId])
  @@index([status])
  @@index([assetId, walletPairKey])
  @@index([internalTransactionId])
  @@map("pool_settlement_batch_items")
}

model PoolSettlementBatchItemSource {
  id            String   @id @default(uuid())
  batchId        String
  batchItemId    String?
  sourceFamily   String
  sourceId       String
  assetId        String
  fromWalletId   String
  toWalletId     String
  direction      String
  sourceAmount   Decimal
  nettedAmount   Decimal  @default(0)
  settledAmount  Decimal  @default(0)
  status         String
  closeReason    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  batch          PoolSettlementBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  batchItem      PoolSettlementBatchItem? @relation(fields: [batchItemId], references: [id], onDelete: SetNull)
  asset          Asset    @relation(fields: [assetId], references: [id])
  fromWallet     Wallet   @relation("PoolSettlementBatchItemSourceFromWallet", fields: [fromWalletId], references: [id])
  toWallet       Wallet   @relation("PoolSettlementBatchItemSourceToWallet", fields: [toWalletId], references: [id])

  @@index([batchId])
  @@index([batchItemId])
  @@index([sourceFamily, sourceId])
  @@index([assetId, fromWalletId, toWalletId])
  @@map("pool_settlement_batch_item_sources")
}
```

Add these nullable lock fields:

```prisma
lockedByPoolSettlementBatchId String?
```

to both `Outstanding` and `ReimbursementObligation`, and add indexes:

```prisma
@@index([lockedByPoolSettlementBatchId])
```

Add these internal transaction fields:

```prisma
poolSettlementBatchItemId String?
```

with relation:

```prisma
poolSettlementBatchItem PoolSettlementBatchItem? @relation("PoolSettlementBatchItemTx")
```

- [ ] **Step 2: Run Prisma format and generate to verify the schema is valid**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm run prisma:format
npm run prisma:generate
```

Expected:

- `Prisma schema loaded`
- `Generated Prisma Client`

- [ ] **Step 3: Create the migration**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npx prisma migrate dev --name pool_settlement_batches --create-only
```

Expected:

- a new folder under `prisma/migrations/`
- SQL that creates the three new tables and nullable lock/link columns

- [ ] **Step 4: Review and normalize the generated migration**

Ensure the migration contains:

```sql
ALTER TABLE "reimbursement_obligations"
ADD COLUMN "lockedByPoolSettlementBatchId" TEXT;

ALTER TABLE "outstandings"
ADD COLUMN "lockedByPoolSettlementBatchId" TEXT;

ALTER TABLE "internal_transactions"
ADD COLUMN "poolSettlementBatchItemId" TEXT;
```

and `CREATE TABLE` statements for:

- `pool_settlement_batches`
- `pool_settlement_batch_items`
- `pool_settlement_batch_item_sources`

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add prisma/schema.prisma prisma/migrations/20260401120000_pool_settlement_batches
git commit -m "feat: add pool settlement batch persistence"
```

### Task 2: Add DTOs, Module Skeleton, and Admin Controller

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/dto/pool-settlement-batch.dto.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/app.module.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts`

- [ ] **Step 1: Write the failing controller spec**

Create this spec skeleton:

```ts
import { Test } from '@nestjs/testing';
import { PoolSettlementBatchesController } from './pool-settlement-batches.controller';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

describe('PoolSettlementBatchesController', () => {
  it('delegates create and submit calls to the service', async () => {
    const service = {
      createBatch: jest.fn().mockResolvedValue({ id: 'batch-1', status: 'CREATED' }),
      submitBatch: jest.fn().mockResolvedValue({ id: 'batch-1', status: 'APPROVAL_PENDING' }),
      findAllForAdmin: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findDetailForAdmin: jest.fn().mockResolvedValue({ id: 'batch-1', items: [] }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PoolSettlementBatchesController],
      providers: [{ provide: PoolSettlementBatchesService, useValue: service }],
    }).compile();

    const controller = moduleRef.get(PoolSettlementBatchesController);

    await controller.create({ autoCreated: false }, { user: { id: 'admin-1' } } as any);
    await controller.submit('batch-1', { user: { id: 'admin-1' } } as any);

    expect(service.createBatch).toHaveBeenCalled();
    expect(service.submitBatch).toHaveBeenCalledWith('batch-1', 'admin-1');
  });
});
```

- [ ] **Step 2: Run the spec to verify the module is missing**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts
```

Expected:

- `Cannot find module` for the new controller/service paths

- [ ] **Step 3: Add DTOs, controller, module, and RBAC skeleton**

Create DTOs:

```ts
export enum PoolSettlementBatchStatus {
  CREATED = 'CREATED',
  APPROVAL_PENDING = 'APPROVAL_PENDING',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  PARTIAL_FAILED = 'PARTIAL_FAILED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class CreatePoolSettlementBatchDto {
  @IsOptional()
  @IsBoolean()
  autoCreated?: boolean;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}

export class PoolSettlementBatchQueryDto {
  @IsOptional()
  @IsString()
  skip?: string;

  @IsOptional()
  @IsString()
  take?: string;

  @IsOptional()
  @IsEnum(PoolSettlementBatchStatus)
  status?: PoolSettlementBatchStatus;

  @IsOptional()
  @IsString()
  autoCreated?: string;
}
```

Create the controller:

```ts
@Controller('admin/pool-settlement-batches')
export class PoolSettlementBatchesController {
  constructor(private readonly service: PoolSettlementBatchesService) {}

  @Get()
  findAll(@Query() query: PoolSettlementBatchQueryDto) {
    return this.service.findAllForAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findDetailForAdmin(id);
  }

  @Post()
  create(@Body() dto: CreatePoolSettlementBatchDto, @Req() req: any) {
    return this.service.createBatch(dto, req.user?.id || 'SYSTEM');
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Req() req: any) {
    return this.service.submitBatch(id, req.user?.id || 'SYSTEM');
  }
}
```

Create the module:

```ts
@Module({
  imports: [
    PrismaModule,
    ApprovalsModule,
    InternalTransactionsModule,
    InternalFundsModule,
    WalletsModule,
  ],
  controllers: [PoolSettlementBatchesController],
  providers: [
    PoolSettlementBatchesService,
    PoolSettlementBatchApprovalProjectionService,
    PoolSettlementBatchCloseoutService,
    PoolSettlementBatchSchedulerService,
  ],
  exports: [PoolSettlementBatchesService],
})
export class PoolSettlementBatchesModule {}
```

Add to `app.module.ts`:

```ts
import { PoolSettlementBatchesModule } from './modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module';
```

and add `PoolSettlementBatchesModule` to `imports`.

Add RBAC constants using the existing route-derived naming style:

```ts
api.get.admin_pool_settlement_batches
api.get.admin_pool_settlement_batches_id
api.post.admin_pool_settlement_batches
api.post.admin_pool_settlement_batches_id_submit
```

- [ ] **Step 4: Run the controller spec again**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/clearing-settle/pool-settlement-batches src/app.module.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat: add pool settlement batch module skeleton"
```

### Task 3: Build Batch Creation, Routing, Source Locking, and Netting

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/reimbursement-obligations/reimbursement-obligations.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/outstandings/outstandings.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/wallets/system-wallet.util.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts`

- [ ] **Step 1: Write failing batch-creation tests**

Create tests covering:

```ts
it('creates a batch from open outstanding and reimbursement sources', async () => {
  const result = await service.createBatch({ autoCreated: false }, 'admin-1');
  expect(result.status).toBe('CREATED');
  expect(result.items).toHaveLength(1);
  expect(result.itemSources.length).toBe(2);
});

it('does not create zero-net items', async () => {
  const result = await service.createBatch({ autoCreated: false }, 'admin-1');
  expect(result.items).toHaveLength(0);
  expect(result.nettedSourceCount).toBe(2);
});

it('skips unroutable sources and fails when no eligible source exists', async () => {
  await expect(service.createBatch({ autoCreated: false }, 'admin-1')).rejects.toThrow(
    'No eligible routable source found for pool settlement batch',
  );
});
```

- [ ] **Step 2: Run the new service spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts
```

Expected:

- FAIL because `createBatch` logic does not exist

- [ ] **Step 3: Implement routing normalization and item grouping**

Add these service helpers:

```ts
type SourceFamily = 'OUTSTANDING' | 'REIMBURSEMENT_OBLIGATION';

interface NormalizedPoolSettlementSource {
  sourceFamily: SourceFamily;
  sourceId: string;
  sourceNo: string | null;
  assetId: string;
  fromWalletId: string;
  toWalletId: string;
  direction: 'FORWARD' | 'REVERSE';
  amount: Prisma.Decimal;
}

private buildWalletPairKey(a: string, b: string) {
  return [a, b].sort().join('::');
}

private normalizeDirection(walletAId: string, walletBId: string, fromWalletId: string) {
  return fromWalletId === walletAId ? 'A_TO_B' : 'B_TO_A';
}
```

Implement batch creation shape:

```ts
async createBatch(dto: CreatePoolSettlementBatchDto, actorUserId: string) {
  const normalized = await this.collectEligibleSources();

  if (!normalized.items.length) {
    throw new BadRequestException('No eligible routable source found for pool settlement batch');
  }

  return this.prisma.$transaction(async (tx) => {
    const batch = await tx.poolSettlementBatch.create({
      data: {
        batchNo: await this.nextBatchNo(tx),
        status: PoolSettlementBatchStatus.CREATED,
        cutoffAt: new Date(),
        createdByUserId: actorUserId,
        autoCreated: Boolean(dto.autoCreated),
        metadataJson: JSON.stringify(dto.metadataJson ?? {}),
        summaryJson: JSON.stringify(normalized.summary),
      },
    });

    await this.lockSources(normalized.lockTargets, batch.id, tx);
    await this.createItemSources(normalized.items, batch.id, tx);
    await this.createItemsFromBuckets(normalized.items, batch.id, tx);

    return this.findDetailForAdmin(batch.id, tx);
  });
}
```

Implement a bucket pass that:

- groups by `assetId + unordered walletPair`
- nets opposite directions
- creates no item for zero-net buckets

Example item creation block:

```ts
await tx.poolSettlementBatchItem.create({
  data: {
    batchId,
    status: 'READY',
    assetId: bucket.assetId,
    walletPairKey: bucket.walletPairKey,
    walletAId: bucket.walletAId,
    walletBId: bucket.walletBId,
    netDirection: bucket.netDirection,
    netAmount: bucket.netAmount,
    submittedAmount: bucket.netAmount,
  },
});
```

- [ ] **Step 4: Add source locking safeguards**

In `reimbursement-obligations.service.ts` and `outstandings.service.ts`, add list helpers with `lockedByPoolSettlementBatchId: null` filters:

```ts
where: {
  status: 'OPEN',
  lockedByPoolSettlementBatchId: null,
}
```

Add lock updates:

```ts
await tx.reimbursementObligation.updateMany({
  where: { id: { in: obligationIds }, lockedByPoolSettlementBatchId: null },
  data: { lockedByPoolSettlementBatchId: batchId },
});
```

and equivalent for `Outstanding`.

- [ ] **Step 5: Run the service spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts src/modules/asset-treasury/reimbursement-obligations/reimbursement-obligations.service.ts src/modules/clearing-settle/outstandings/outstandings.service.ts src/modules/asset-treasury/wallets/system-wallet.util.ts
git commit -m "feat: add pool settlement batch creation and netting"
```

### Task 4: Add Submit Flow and Batch-Level Approval

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts`

- [ ] **Step 1: Write failing approval projection tests**

Create spec coverage:

```ts
it('marks batch approved and dispatches items on approval approved', async () => {
  await service.handleApproved({
    actionType: 'POOL_SETTLEMENT_BATCH_APPROVAL',
    entityRef: 'batch-1',
    approvalId: 'approval-1',
    decidedAt: new Date().toISOString(),
    status: 'APPROVED',
  } as any);

  expect(dispatchSpy).toHaveBeenCalledWith('batch-1');
});

it('releases held sources on approval rejected', async () => {
  await service.handleRejected({
    actionType: 'POOL_SETTLEMENT_BATCH_APPROVAL',
    entityRef: 'batch-1',
    approvalId: 'approval-1',
    status: 'REJECTED',
  } as any);

  expect(releaseSpy).toHaveBeenCalledWith('batch-1', 'BATCH_RELEASED');
});
```

- [ ] **Step 2: Run the new spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts
```

Expected:

- FAIL because the approval action and projection service do not exist

- [ ] **Step 3: Add the approval action type and submit logic**

In `approval.constants.ts`, add:

```ts
[ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL]: {
  riskLevel: ApprovalRiskLevels.HIGH,
  checkerRoles: ['SM', 'TECH_ADMIN'],
  timeoutHours: 24,
  allowCancel: true,
  allowRetry: true,
},
```

and:

```ts
POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
```

In `pool-settlement-batches.service.ts`, implement:

```ts
async submitBatch(batchId: string, actorUserId: string) {
  return this.prisma.$transaction(async (tx) => {
    const batch = await tx.poolSettlementBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== 'CREATED') {
      throw new BadRequestException('Only CREATED batch can be submitted');
    }

    const approval = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
        entityRef: batch.id,
        workflowType: 'POOL_SETTLEMENT_BATCH',
        workflowId: batch.id,
        workflowNo: batch.batchNo,
        traceId: `POOL-SETTLEMENT:${batch.batchNo}`,
      },
      {
        reason: 'Pool settlement batch submitted',
        traceId: `POOL-SETTLEMENT:${batch.batchNo}`,
        workflowType: 'POOL_SETTLEMENT_BATCH',
        workflowId: batch.id,
        workflowNo: batch.batchNo,
      },
      {
        actorType: 'ADMIN',
        userId: actorUserId,
        roleCodes: [],
      },
      tx,
      { emitSideEffects: true },
    );

    return tx.poolSettlementBatch.update({
      where: { id: batchId },
      data: {
        status: 'APPROVAL_PENDING',
        approvalCaseId: approval.id,
        submittedAt: new Date(),
      },
    });
  });
}
```

- [ ] **Step 4: Add approval projection service**

Create an event listener using the same pattern as `internal-transaction-approval-projection.service.ts`:

```ts
@Injectable()
export class PoolSettlementBatchApprovalProjectionService {
  constructor(private readonly poolSettlementBatchesService: PoolSettlementBatchesService) {}

  private isBatchApproval(event: ApprovalDecisionEvent) {
    return String(event.actionType || '').trim().toUpperCase() === 'POOL_SETTLEMENT_BATCH_APPROVAL';
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (!this.isBatchApproval(event)) return;
    await this.poolSettlementBatchesService.handleApprovalApproved(event.entityRef, event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (!this.isBatchApproval(event)) return;
    await this.poolSettlementBatchesService.handleApprovalRejected(event.entityRef, event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (!this.isBatchApproval(event)) return;
    await this.poolSettlementBatchesService.handleApprovalCancelled(event.entityRef, event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (!this.isBatchApproval(event)) return;
    await this.poolSettlementBatchesService.handleApprovalExpired(event.entityRef, event);
  }
}
```

- [ ] **Step 5: Run approval tests**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts
git commit -m "feat: add pool settlement batch approval flow"
```

### Task 5: Dispatch Approved Items into Internal Transactions

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-transactions/dto/internal-transaction.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-funds/internal-funds.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts`

- [ ] **Step 1: Add failing dispatch tests**

Add to service spec:

```ts
it('creates one internal transaction per non-zero item after approval', async () => {
  await service.handleApprovalApproved('batch-1', approvedEvent as any);
  const items = await prisma.poolSettlementBatchItem.findMany({ where: { batchId: 'batch-1' } });
  expect(items[0].internalTransactionId).toBeTruthy();
});

it('does not create internal transactions for zero-net source-only batches', async () => {
  await service.handleApprovalApproved('batch-2', approvedEvent as any);
  const txCount = await prisma.internalTransaction.count({
    where: { sourceType: 'POOL_SETTLEMENT_BATCH_ITEM' },
  });
  expect(txCount).toBe(0);
});
```

- [ ] **Step 2: Run the dispatch spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts
```

Expected:

- FAIL because dispatch logic does not exist

- [ ] **Step 3: Extend internal transaction DTOs and persistence**

Add to `internal-transaction.dto.ts` source enums or response fields:

```ts
export enum InternalTransactionSourceType {
  INTERNAL_MANUAL = 'INTERNAL_MANUAL',
  DEPOSIT = 'DEPOSIT',
  POOL_SETTLEMENT_BATCH_ITEM = 'POOL_SETTLEMENT_BATCH_ITEM',
}
```

Add detail response fields:

```ts
poolSettlementBatchItemId?: string | null;
```

Update create call in `pool-settlement-batches.service.ts`:

```ts
const createdTx = await this.internalTransactionsService.createStandaloneTransaction(
  {
    type: this.resolveInternalType(item),
    purpose: TreasuryTransferPurpose.POOL_REBALANCING,
    initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
    sourceType: 'POOL_SETTLEMENT_BATCH_ITEM',
    sourceId: item.id,
    sourceNo: batch.batchNo,
    ownerType: 'SYSTEM',
    ownerId: 'SYSTEM',
    assetId: item.assetId,
    amount: item.netAmount,
    feeAmount: new Prisma.Decimal(0),
    netAmount: item.netAmount,
    fromWalletId: this.resolveFromWalletId(item),
    toWalletId: this.resolveToWalletId(item),
    status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
    approvalStatus: InternalTransactionApprovalStatus.APPROVED,
  },
  event.decisionByUserId || 'SYSTEM',
  tx,
);
```

Then create the first fund immediately:

```ts
await this.internalFundsService.createFromInternalTransaction(
  {
    internalTransactionId: createdTx.id,
    status: InternalFundStatus.CREATED,
    referenceNo: createdTx.referenceNo ?? null,
  },
  event.decisionByUserId || 'SYSTEM',
  tx,
);
```

- [ ] **Step 4: Implement no-item direct success path**

In `handleApprovalApproved`, branch like this:

```ts
if (!items.length) {
  await this.markNettedSourcesSettled(batchId, tx);
  await tx.poolSettlementBatch.update({
    where: { id: batchId },
    data: {
      status: 'SUCCESS',
      approvedAt: approvedAt,
      closedAt: new Date(),
    },
  });
  return;
}
```

- [ ] **Step 5: Run the service tests**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/asset-treasury/internal-transactions/dto/internal-transaction.dto.ts src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts src/modules/asset-treasury/internal-funds/internal-funds.service.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts
git commit -m "feat: dispatch approved pool settlement items"
```

### Task 6: Add Fund-Driven Closeout and Source Release

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/asset-treasury/internal-funds/internal-funds.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts`

- [ ] **Step 1: Write failing closeout tests**

Create coverage:

```ts
it('closes successful sources when the item fund reaches CLEAR', async () => {
  await service.handleInternalFundStatusChanged({
    internalFundId: 'fund-1',
    internalTransactionId: 'tx-1',
    oldStatus: 'CONFIRMING',
    newStatus: 'CLEAR',
  });

  expect(await prisma.outstanding.findUnique({ where: { id: 'out-1' } })).toMatchObject({
    status: 'CLOSED',
  });
});

it('releases failed item sources only during batch closeout', async () => {
  await service.handleInternalFundStatusChanged({
    internalFundId: 'fund-2',
    internalTransactionId: 'tx-2',
    oldStatus: 'CONFIRMING',
    newStatus: 'FAILED',
  });

  expect(await prisma.reimbursementObligation.findUnique({ where: { id: 'rob-1' } })).toMatchObject({
    lockedByPoolSettlementBatchId: 'batch-1',
    status: 'OPEN',
  });
});
```

- [ ] **Step 2: Run the closeout spec**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts
```

Expected:

- FAIL because the closeout service does not exist

- [ ] **Step 3: Implement the closeout service**

Use the existing internal-fund event pattern:

```ts
@Injectable()
export class PoolSettlementBatchCloseoutService {
  @OnEvent('internal-fund.status.changed')
  async handleInternalFundStatusChanged(event: {
    internalFundId: string;
    internalTransactionId: string;
    oldStatus: string;
    newStatus: string;
  }) {
    const txRow = await this.prisma.internalTransaction.findUnique({
      where: { id: event.internalTransactionId },
      select: { poolSettlementBatchItemId: true },
    });

    if (!txRow?.poolSettlementBatchItemId) return;

    await this.syncItemByFundStatus(txRow.poolSettlementBatchItemId, event.newStatus);
  }
}
```

Inside `syncItemByFundStatus`:

- mark item `SUCCESS` on `CLEAR`
- mark item `FAILED` on `FAILED / TIMEOUT / RETURNED / CANCELLED`
- call `finalizeBatchIfTerminal(batchId)`

Closeout rule:

```ts
if (allItemsSucceeded) {
  batch.status = 'SUCCESS';
} else if (hasSucceeded && hasFailed) {
  batch.status = 'PARTIAL_FAILED';
} else if (allItemsFailed) {
  batch.status = 'FAILED';
}
```

Release failed sources only in the closeout branch:

```ts
await tx.poolSettlementBatchItemSource.updateMany({
  where: {
    batchId,
    batchItem: { status: 'FAILED' },
    status: 'LINKED',
  },
  data: {
    status: 'RELEASED',
    closeReason: 'BATCH_RELEASED',
  },
});
```

Then unlock source truth rows and restore them to `OPEN`.

- [ ] **Step 4: Wire the closeout service into the module**

In `pool-settlement-batches.module.ts`, ensure:

```ts
providers: [
  PoolSettlementBatchesService,
  PoolSettlementBatchApprovalProjectionService,
  PoolSettlementBatchCloseoutService,
  PoolSettlementBatchSchedulerService,
]
```

- [ ] **Step 5: Run closeout tests**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.module.ts src/modules/asset-treasury/internal-funds/internal-funds.service.ts
git commit -m "feat: add pool settlement batch closeout"
```

### Task 7: Add the Daily 23:59 Scheduler

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/app.module.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts`

- [ ] **Step 1: Write a failing scheduler test**

Add a service-level test:

```ts
it('auto creates and auto submits a batch at the scheduled time', async () => {
  await scheduler.runDaily();
  expect(createSpy).toHaveBeenCalledWith({ autoCreated: true }, 'SYSTEM');
  expect(submitSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts
```

Expected:

- FAIL because scheduler service does not exist

- [ ] **Step 3: Implement the scheduler**

Create:

```ts
@Injectable()
export class PoolSettlementBatchSchedulerService {
  constructor(private readonly poolSettlementBatchesService: PoolSettlementBatchesService) {}

  @Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })
  async runDaily() {
    try {
      const batch = await this.poolSettlementBatchesService.createBatch(
        { autoCreated: true, metadataJson: { trigger: 'daily-23-59' } },
        'SYSTEM',
      );
      await this.poolSettlementBatchesService.submitBatch(batch.id, 'SYSTEM');
    } catch (error: any) {
      if (String(error?.message || '').includes('No eligible routable source found')) {
        return;
      }
      throw error;
    }
  }
}
```

If `ScheduleModule.forRoot()` is not present, add it to `app.module.ts`:

```ts
import { ScheduleModule } from '@nestjs/schedule';
```

and:

```ts
ScheduleModule.forRoot(),
```

- [ ] **Step 4: Run the scheduler-related tests**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts src/app.module.ts
git commit -m "feat: schedule daily pool settlement batch"
```

### Task 8: Add Admin-Web List and Detail Pages

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/pages/PoolSettlementBatchListPage.tsx`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/pages/PoolSettlementBatchDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/App.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/components/DashboardLayout.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web/src/rbac/permissions.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web`

- [ ] **Step 1: Add frontend permission constants**

In `permissions.ts`, add:

```ts
POOL_SETTLEMENT_BATCH_READ: 'api.get.admin_pool_settlement_batches',
POOL_SETTLEMENT_BATCH_DETAIL: 'api.get.admin_pool_settlement_batches_id',
POOL_SETTLEMENT_BATCH_CREATE: 'api.post.admin_pool_settlement_batches',
POOL_SETTLEMENT_BATCH_SUBMIT: 'api.post.admin_pool_settlement_batches_id_submit',
```

- [ ] **Step 2: Add routes and menu entry**

In `App.tsx`, add:

```tsx
<Route
  path="/dashboard/treasury/pool-settlement-batches"
  element={withPermission(<PoolSettlementBatchListPage />, permissions.POOL_SETTLEMENT_BATCH_READ)}
/>
<Route
  path="/dashboard/treasury/pool-settlement-batches/:id"
  element={withPermission(<PoolSettlementBatchDetailPage />, permissions.POOL_SETTLEMENT_BATCH_DETAIL)}
/>
```

In `DashboardLayout.tsx`, add a menu entry under `Treasury Center`:

```tsx
{
  label: 'Pool Settlement Batches',
  path: '/dashboard/treasury/pool-settlement-batches',
  permission: permissions.POOL_SETTLEMENT_BATCH_READ,
}
```

- [ ] **Step 3: Implement the list page**

Create a page with:

```tsx
export default function PoolSettlementBatchListPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const result = await adminFetch('/admin/pool-settlement-batches');
      setRows(result.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function createBatch() {
    const result = await adminFetch('/admin/pool-settlement-batches', {
      method: 'POST',
      body: JSON.stringify({ autoCreated: false }),
    });
    navigate(`/dashboard/treasury/pool-settlement-batches/${result.id}`);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1>Pool Settlement Batches</h1>
      <button onClick={() => void createBatch()}>Create Batch</button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the detail page**

Create a page that loads batch detail and renders sections:

```tsx
export default function PoolSettlementBatchDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<any>(null);

  async function load() {
    const result = await adminFetch(`/admin/pool-settlement-batches/${id}`);
    setDetail(result);
  }

  async function submit() {
    await adminFetch(`/admin/pool-settlement-batches/${id}/submit`, {
      method: 'POST',
    });
    await load();
  }

  useEffect(() => {
    void load();
  }, [id]);

  if (!detail) return <div>Loading...</div>;

  return (
    <div>
      <h1>{detail.batchNo}</h1>
      <div>Status: {detail.status}</div>
      <div>Cutoff: {detail.cutoffAt}</div>
      {detail.status === 'CREATED' ? (
        <button onClick={() => void submit()}>Submit for Approval</button>
      ) : null}
    </div>
  );
}
```

Add sections for:

- summary
- items
- item sources
- skipped sources summary
- derived transactions

- [ ] **Step 5: Run the frontend build**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web
npm run build
```

Expected:

- frontend production build succeeds

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx admin-web/src/rbac/permissions.ts admin-web/src/pages/PoolSettlementBatchListPage.tsx admin-web/src/pages/PoolSettlementBatchDetailPage.tsx
git commit -m "feat: add pool settlement batch admin pages"
```

### Task 9: End-to-End Verification and Documentation Sweep

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/docs/superpowers/specs/2026-04-01-pool-settlement-batch-design.md` only if implementation differences emerge
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js`

- [ ] **Step 1: Run the focused backend test suite**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm test -- \
  src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.spec.ts \
  src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.controller.spec.ts \
  src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-approval-projection.service.spec.ts \
  src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-closeout.service.spec.ts \
  src/modules/asset-treasury/reimbursement-obligations/reimbursement-obligations.service.spec.ts \
  src/modules/clearing-settle/outstandings/outstandings.service.spec.ts \
  src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts
```

Expected:

- PASS

- [ ] **Step 2: Run schema migration locally and build backend**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm run db:migrate:local
npm run build
```

Expected:

- migration applies cleanly
- backend build succeeds

- [ ] **Step 3: Run the frontend build**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js/admin-web
npm run build
```

Expected:

- PASS

- [ ] **Step 4: Do a manual smoke**

Run:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
npm run dev:start
```

Then verify in admin:

- create one safeguarded `FeeOccurrence`
- confirm one `ReimbursementObligation`
- create one `PoolSettlementBatch`
- confirm batch detail shows source rows and item rows
- submit batch and approve it
- confirm one `InternalTransaction` per non-zero item
- progress fund and confirm batch closes correctly

- [ ] **Step 5: Commit the final implementation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/dev/Exchange_js
git add prisma src admin-web
git commit -m "feat: add pool settlement batch end-to-end flow"
```

## Self-Review

### Spec coverage

- source truth unchanged: covered in Tasks 1, 3, 6
- `FeeOccurrence -> 0/1 ReimbursementObligation`: existing service reused; verified in Task 9
- new batch family: covered in Tasks 1 and 2
- `asset + unordered walletPair` grouping and cross-family netting: covered in Task 3
- one approval case per batch: covered in Task 4
- approved batch dispatches item-level internal transactions without second approval: covered in Task 5
- netted source closes without execution item: covered in Tasks 3 and 5
- failed item sources release only during closeout: covered in Task 6
- daily `23:59` auto-create and auto-submit: covered in Task 7
- admin-web list/detail and submit flow: covered in Task 8

### Placeholder scan

- no `TODO`
- no `TBD`
- no “similar to Task N”
- every code-writing step includes explicit code snippets

### Type consistency

Consistent names used across tasks:

- `PoolSettlementBatch`
- `PoolSettlementBatchItem`
- `PoolSettlementBatchItemSource`
- `lockedByPoolSettlementBatchId`
- `poolSettlementBatchItemId`
- `POOL_SETTLEMENT_BATCH_APPROVAL`

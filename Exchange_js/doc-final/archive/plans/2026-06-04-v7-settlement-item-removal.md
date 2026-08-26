# V7 Funds-Layer 结构简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `SettlementBatchItem` 让 SettlementBatch 直连 InternalTransaction，并把资金单(InternalFund)拆成独立的 admin 列表/详情页(挂 Treasury 菜单组)。

**Architecture:** B 类结算从 `Batch→Item→Transfer→Fund` 四层压成 `Batch→Transfer→Fund` 三层(Transfer 兼任逐币种结算单，承接 Item 的轧差快照 + outstanding 消费链)。资金单的执行细节(含 Manual Simulation)从 Transfer 详情页迁到自己的 InternalFund 详情页；Transfer 详情页只留紧凑绑定行。Transfer→Fund 保持 1:1(法币 per-VA/1:N 不在本轮)。

**Tech Stack:** NestJS + Prisma + SQLite + TigerBeetle(后端)；React + Vite + TS(admin-web)。后端测试 jest；前端门禁 `tsc -b`。

**Spec:** `doc-final/superpowers/specs/2026-06-04-v7-settlement-item-removal-design.md`（commit fb2f5bf）

**Working dir:** `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js`（git 分支 `branch`）

---

## File Structure

**后端(src/modules/funds-layer)**
- `domain/outstanding-consumer.service.ts` — 锁定/结算口径由 itemId 改 transferId
- `domain/settlement-batch.service.ts` — 删 item 方法；recomputeBatch 遍历 transfers；findOneByNoForAdmin include transfers
- `domain/internal-transfer.service.ts` — `createTransfer` 接受并写入结算字段
- `domain/funds-flow.service.ts` — 新增 `findOneByNoForAdmin`
- `workflow/internal-transfer-workflow.service.ts` — `initiate` 透传结算字段
- `workflow/eod-settlement-workflow.service.ts` — 新流程 + CLEAR 改按 transfer
- `workflow/fee-collection-workflow.service.ts` — 新流程 + CLEAR 改按 transfer
- `controllers/funds-admin.controller.ts` — **新建** GET 列表/详情
- `funds-layer.module.ts` — 注册新 controller
- `dto/funds-query.dto.ts` — **新建** 资金单列表查询 DTO
- `prisma/schema.prisma` + 新 migration

**RBAC:** `src/modules/identity/access-control/rbac.catalog.ts`

**前端(admin-web/src)**
- `pages/funds-layer/InternalFundListPage.tsx` — **新建**
- `pages/funds-layer/InternalFundDetailPage.tsx` — **新建**(含 Manual Simulation)
- `pages/funds-layer/InternalTransferDetailPage.tsx` — 瘦身(删 Execution Legs 全量 + simulate，换紧凑绑定行)
- `pages/funds-layer/SettlementDetailPage.tsx` — items → transfers
- `components/DashboardLayout.tsx` — Treasury 组加 Internal Funds 入口
- `App.tsx` — 加新路由、删遗留 InternalFund 路由/导入
- `rbac/permissions.ts` — 加 funds 权限常量
- 删 `pages/InternalFundList.tsx`、`pages/InternalFundDetail.tsx`

---

## Phase 0：基线确认

### Task 0：确认起点全绿

- [ ] **Step 1：跑 funds-layer 测试**

Run: `npx jest src/modules/funds-layer --silent 2>&1 | tail -5`
Expected: `Tests: 82 passed, 82 total`（若数字不同，记下当前基线数）

- [ ] **Step 2：确认前端构建干净**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: `EXIT=0`

---

## Phase 1：Schema + 迁移

### Task 1：schema 改动 + 破坏性迁移

**Files:**
- Modify: `prisma/schema.prisma`（model `InternalTransaction` / `SettlementBatch` / `SettlementBatchItem` / `Outstanding`）

- [ ] **Step 1：`InternalTransaction` 加结算字段**

在 `model InternalTransaction` 里，`updatedAt` 字段之后、关系区之前，加：
```prisma
  settlementBatchId          String?
  grossInAmount              Decimal?
  grossOutAmount             Decimal?
```
关系区(`asset ...` 那组)里加：
```prisma
  settlementBatch            SettlementBatch?              @relation("SettlementBatchTransfers", fields: [settlementBatchId], references: [id], onDelete: SetNull)
```
索引区加：
```prisma
  @@index([settlementBatchId])
```

- [ ] **Step 2：删除 `SettlementBatchItem` 模型**

删除整个 `model SettlementBatchItem { ... }` 块（`@@map("settlement_batch_items")`）。

- [ ] **Step 3：`SettlementBatch` 改关系**

`model SettlementBatch` 里：
- 删 `items                    SettlementBatchItem[]`
- 加 `transfers                InternalTransaction[]        @relation("SettlementBatchTransfers")`
- 保留 `outstandings             Outstanding[]`

- [ ] **Step 4：`Outstanding` 换 FK**

`model Outstanding` 里：
- 删 `settlementBatchItemId         String?` 及其关系行 `settlementBatchItem ... @relation(...)` 及索引 `@@index([settlementBatchItemId])`
- 加字段 `settledByTransferId           String?`
- 加关系 `settledByTransfer             InternalTransaction?       @relation("OutstandingSettledByTransfer", fields: [settledByTransferId], references: [id], onDelete: SetNull)`
- 加索引 `@@index([settledByTransferId])`

并在 `InternalTransaction` 关系区补反向关系：
```prisma
  settledOutstandings        Outstanding[]                 @relation("OutstandingSettledByTransfer")
```

- [ ] **Step 5：生成迁移 + rebuild**

Run:
```bash
npx prisma migrate dev --name v7_remove_settlement_item --create-only
npm run dev:rebuild
```
Expected: migration 文件生成；rebuild 跑完无报错；SQLite 无 `settlement_batch_items` 表。

- [ ] **Step 6：验证 schema 编译**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "settlementBatchItem|error" | head`
Expected: 仅剩"引用已删 model/字段"的编译错误（这些将在 Phase 2-3 修掉）；无 prisma generate 报错。

- [ ] **Step 7：提交**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(v7): drop SettlementBatchItem; Batch→Transfer + Outstanding.settledByTransferId"
```

---

## Phase 2：Domain 服务

### Task 2：OutstandingConsumerService 改按 transfer 键

**Files:**
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts`
- Test: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts`

- [ ] **Step 1：改 spec（先红）**

把 spec 里对 `linkItem` / `settle(itemId,...)` / `markNettedZero(itemId,...)` / `lock(...)` 的用例改成新方法。新增/改写这些断言：
```ts
// lockToTransfer: OPEN → LOCKED + settlementBatchId + settledByTransferId
it('lockToTransfer sets LOCKED + batch + transfer', async () => {
  const r = await service.lockToTransfer(['o1', 'o2'], 'batch1', 'tx1');
  // 期望 updateMany 被调用，where status OPEN，data 含 status LOCKED / settlementBatchId batch1 / settledByTransferId tx1 / lockedAt
});

// settle(transferId): LOCKED(该 transfer) → SETTLED + closedByInternalFundId
it('settle marks SETTLED by transferId', async () => {
  await service.settle('tx1', 'fund1');
  // where { settledByTransferId: 'tx1', status: 'LOCKED' }; data SETTLED + closedByInternalFundId fund1 + closedAt
});

// markSettledNettedZero(batchId, assetId): LOCKED 无 transfer → SETTLED
it('markSettledNettedZero settles netted-zero outstandings', async () => {
  await service.markSettledNettedZero('batch1', 'asset1');
  // where { settlementBatchId:'batch1', assetId:'asset1', settledByTransferId:null, status:'LOCKED' }; data SETTLED + closedAt
});
```
（用现有 spec 的 prisma mock 风格——查 mock `outstanding.updateMany` 的入参。）

- [ ] **Step 2：跑测试确认红**

Run: `npx jest src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts 2>&1 | tail -10`
Expected: FAIL（方法不存在）

- [ ] **Step 3：实现新方法**

把 `lock` / `linkItem` / `settle` / `markNettedZero` 四个方法替换为：
```ts
  async lockToTransfer(
    outstandingIds: string[],
    settlementBatchId: string,
    settledByTransferId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: {
        status: 'LOCKED',
        settlementBatchId,
        settledByTransferId,
        lockedAt: new Date(),
      },
    });
  }

  async lockToBatch(
    outstandingIds: string[],
    settlementBatchId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: { status: 'LOCKED', settlementBatchId, lockedAt: new Date() },
    });
  }

  async settle(
    settledByTransferId: string,
    internalFundId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { settledByTransferId, status: 'LOCKED' },
      data: {
        status: 'SETTLED',
        closedByInternalFundId: internalFundId,
        closedAt: new Date(),
      },
    });
  }

  async markSettledNettedZero(
    settlementBatchId: string,
    assetId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: {
        settlementBatchId,
        assetId,
        settledByTransferId: null,
        status: 'LOCKED',
      },
      data: { status: 'SETTLED', closedAt: new Date() },
    });
  }
```
`findOpenCryptoByAsset` 不动。

- [ ] **Step 4：跑测试确认绿**

Run: `npx jest src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/modules/funds-layer/domain/outstanding-consumer.service.ts src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "feat(v7): outstanding consumer keyed by transferId (lockToTransfer/settle/markSettledNettedZero)"
```

### Task 3：SettlementBatchService 删 item、recompute 遍历 transfers

**Files:**
- Modify: `src/modules/funds-layer/domain/settlement-batch.service.ts`
- Test: `src/modules/funds-layer/domain/settlement-batch.service.spec.ts`

- [ ] **Step 1：改 spec（先红）**

删除 `createItem` / `linkItemTransfer` / `closeItem` 的用例。改写 recomputeBatch 用例为按 transfer：
```ts
it('recomputeBatch SUCCESS when all transfers SUCCESS and all outstandings SETTLED', async () => {
  // mock: internalTransaction.findMany → [{status:'SUCCESS', assetId:'a1'}]
  //       outstanding.findMany → [{status:'SETTLED', settledByTransferId:'t1', assetId:'a1'}]
  const r = await service.recomputeBatch('batch1');
  // 期望 settlementBatch.update data.status === 'SUCCESS' + completedAt 非空
});
it('recomputeBatch PROCESSING when a transfer not yet SUCCESS', async () => {
  // internalTransaction.findMany → [{status:'INTERNAL_FUNDS_PENDING', assetId:'a1'}]
  // 期望 status === 'PROCESSING' + completedAt null
});
```
保留 `resolveCryptoDirection` / `createBatch` 用例。

- [ ] **Step 2：跑测试确认红**

Run: `npx jest src/modules/funds-layer/domain/settlement-batch.service.spec.ts 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3：删方法 + 重写 recompute + findOne**

删除 `createItem`、`linkItemTransfer`、`closeItem` 三个方法，以及 `TERMINAL_ITEM_STATUSES` 常量。
把 `recomputeBatch` 整体替换为：
```ts
  async recomputeBatch(settlementBatchId: string, tx?: TxClient) {
    const execute = async (client: TxClient) => {
      const transfers = await (client as any).internalTransaction.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true },
      });
      const outstandings = await (client as any).outstanding.findMany({
        where: { settlementBatchId },
        select: { status: true, assetId: true, settledByTransferId: true },
      });

      const nettedZeroAssets = new Set<string>(
        outstandings
          .filter((o: any) => !o.settledByTransferId)
          .map((o: any) => o.assetId),
      );
      const transferAssets = new Set<string>(
        transfers.map((t: any) => t.assetId),
      );

      const totalAssetCount = transferAssets.size + nettedZeroAssets.size;
      const settledTransferAssets = transfers.filter(
        (t: any) => t.status === 'SUCCESS',
      ).length;
      const settledAssetCount = settledTransferAssets + nettedZeroAssets.size;

      const totalOutstandingCount = outstandings.length;
      const settledOutstandingCount = outstandings.filter(
        (o: any) => o.status === 'SETTLED',
      ).length;

      const allDone =
        totalAssetCount > 0 &&
        settledAssetCount === totalAssetCount &&
        settledOutstandingCount === totalOutstandingCount;
      const status = allDone ? 'SUCCESS' : 'PROCESSING';

      return (client as any).settlementBatch.update({
        where: { id: settlementBatchId },
        data: {
          status,
          totalAssetCount,
          settledAssetCount,
          totalOutstandingCount,
          settledOutstandingCount,
          completedAt: allDone ? new Date() : null,
        },
      });
    };
    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }
```
> 说明：`settledTransferAssets` 计 transfer 条数即资产数（per-asset 1 transfer，1:1）；net=0 资产没有 transfer，用 nettedZeroAssets 计。

把 `findOneByNoForAdmin` 的 `include` 从 `items: {...}` 改为：
```ts
      include: {
        transfers: {
          include: { asset: true, funds: { select: { id: true, internalFundNo: true, status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
```
删除 `CreateItemInput` interface（已无用）。

- [ ] **Step 4：跑测试确认绿**

Run: `npx jest src/modules/funds-layer/domain/settlement-batch.service.spec.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add src/modules/funds-layer/domain/settlement-batch.service.ts src/modules/funds-layer/domain/settlement-batch.service.spec.ts
git commit -m "feat(v7): SettlementBatch recompute over transfers; drop item methods"
```

---

## Phase 3：Workflow

### Task 4：initiate 透传结算字段

**Files:**
- Modify: `src/modules/funds-layer/domain/internal-transfer.service.ts`
- Modify: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts`

- [ ] **Step 1：`CreateTransferInput` + create data 加字段**

`internal-transfer.service.ts` 的 `CreateTransferInput` 末尾加：
```ts
  settlementBatchId?: string | null;
  grossInAmount?: Prisma.Decimal | null;
  grossOutAmount?: Prisma.Decimal | null;
```
`createTransfer` 的 `internalTransaction.create({ data: {...} })` 里 `statusHistory,` 之后加：
```ts
              settlementBatchId: input.settlementBatchId ?? null,
              grossInAmount: input.grossInAmount ?? null,
              grossOutAmount: input.grossOutAmount ?? null,
```

- [ ] **Step 2：`initiate` 入参透传**

`internal-transfer-workflow.service.ts` 的 `InitiateTransferInput` 末尾加：
```ts
  settlementBatchId?: string | null;
  grossInAmount?: string | null;
  grossOutAmount?: string | null;
```
`initiate` 内 `this.transfers.createTransfer({ ... })` 的对象里 `toWalletId: input.toWalletId,` 之后加：
```ts
          settlementBatchId: input.settlementBatchId ?? null,
          grossInAmount:
            input.grossInAmount != null ? new Prisma.Decimal(input.grossInAmount) : null,
          grossOutAmount:
            input.grossOutAmount != null ? new Prisma.Decimal(input.grossOutAmount) : null,
```

- [ ] **Step 3：编译检查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "internal-transfer" | head`
Expected: 无 internal-transfer 相关错误

- [ ] **Step 4：提交**

```bash
git add src/modules/funds-layer/domain/internal-transfer.service.ts src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts
git commit -m "feat(v7): initiate threads settlementBatchId + gross in/out into transfer"
```

### Task 5：EOD workflow 新流程

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

- [ ] **Step 1：改 spec（先红）**

改写 spec：
- net≠0：断言 `transferWorkflow.initiate` 收到 `settlementBatchId`/`grossInAmount`/`grossOutAmount`；`consumer.lockToTransfer(ids, batchId, transfer.id)` 被调；**不再**有 createItem/linkItem/linkItemTransfer。
- net=0：断言 `consumer.lockToBatch` + `consumer.markSettledNettedZero(batchId, assetId)`；无 transfer。
- CLEAR 处理器：断言 `consumer.settle(transfer.id, fundId)` + `recomputeBatch(transfer.settlementBatchId)`；**不再** findFirst settlementBatchItem。

- [ ] **Step 2：跑测试确认红**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts 2>&1 | tail -12`
Expected: FAIL

- [ ] **Step 3：重写 `runEodSettlement` 循环体**

把 `for (const group of groups) { ... }` 整段替换为：
```ts
    for (const group of groups) {
      const dir = this.batchService.resolveCryptoDirection(group.net);

      if (dir == null) {
        // net == 0：锁到 batch 后直接结清，无 transfer。
        await this.consumer.lockToBatch(group.outstandingIds, batch.id);
        await this.consumer.markSettledNettedZero(batch.id, group.assetId);
        settledZero += 1;
        continue;
      }

      const from = await this.systemWallets.resolve(group.assetId, dir.fromRole);
      const to = await this.systemWallets.resolve(group.assetId, dir.toRole);

      const sourceId = `${batch.id}:${group.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: EOD_SOURCE_TYPE, sourceId },
      });

      const transfer = existing
        ? existing
        : await this.transferWorkflow.initiate(
            {
              fromRole: dir.fromRole,
              toRole: dir.toRole,
              sourceType: EOD_SOURCE_TYPE,
              sourceId,
              sourceNo: batch.batchNo,
              ownerType: 'PLATFORM',
              ownerId: 'PLATFORM',
              assetId: group.assetId,
              amount: dir.amount.toString(),
              fromWalletId: from.id,
              toWalletId: to.id,
              triggerSource: 'EOD',
              settlementBatchId: batch.id,
              grossInAmount: group.inAmount.toString(),
              grossOutAmount: group.outAmount.toString(),
            },
            operatorId,
          );

      await this.consumer.lockToTransfer(
        group.outstandingIds,
        batch.id,
        transfer.id,
      );
      spawned += 1;
    }
```
删除原来对 `batchService.createItem` / `consumer.lock` / `consumer.linkItem` / `batchService.linkItemTransfer` 的调用。

- [ ] **Step 4：重写 CLEAR 处理器**

把 `onFundsFlowStatusChanged` 里 `const item = ... settlementBatchItem.findFirst(...)` 到 `recomputeBatch(...)` 这段替换为：
```ts
      // 找到该 transfer 锁定的 outstanding，标 SETTLED，再重算 batch。
      await this.consumer.settle(event.internalTransferId, event.fundsFlowId);
      await this.batchService.recomputeBatch(transfer.settlementBatchId);
```
（保留前面 `transfer = findUnique(...)` + `sourceType !== EOD_SOURCE_TYPE` return 的判断；`transfer.settlementBatchId` 现已是字段。）

- [ ] **Step 5：跑测试确认绿**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 6：提交**

```bash
git add src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "feat(v7): EOD workflow spawns transfer under batch, settles by transfer (no item)"
```

### Task 6：Fee collection workflow 新流程

**Files:**
- Modify: `src/modules/funds-layer/workflow/fee-collection-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts`

- [ ] **Step 1：改 spec（先红）**

断言：每候选 `initiate` 收到 `settlementBatchId` + `grossOutAmount=费额`；**不再** createItem/linkItemTransfer；CLEAR 处理器只 `recomputeBatch`（不 closeItem、不动 outstanding）。

- [ ] **Step 2：跑测试确认红**

Run: `npx jest src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts 2>&1 | tail -12`
Expected: FAIL

- [ ] **Step 3：重写候选循环**

把 `for (const candidate of candidates) { ... }` 整段替换为：
```ts
    for (const candidate of candidates) {
      const amount = bigintToDecimal(candidate.netBigint, candidate.decimals);
      const from = await this.systemWallets.resolve(candidate.assetId, 'C_MAIN');
      const ops = await this.systemWallets.resolve(candidate.assetId, 'F_OPS');

      const sourceId = `${batch.id}:${candidate.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: FEE_SOURCE_TYPE, sourceId },
      });

      if (!existing) {
        await this.transferWorkflow.initiate(
          {
            fromRole: 'C_MAIN',
            toRole: 'F_OPS',
            sourceType: FEE_SOURCE_TYPE,
            sourceId,
            sourceNo: batch.batchNo,
            ownerType: 'PLATFORM',
            ownerId: 'PLATFORM',
            assetId: candidate.assetId,
            amount: amount.toString(),
            fromWalletId: from.id,
            toWalletId: ops.id,
            triggerSource: 'CRON',
            settlementBatchId: batch.id,
            grossInAmount: '0',
            grossOutAmount: amount.toString(),
          },
          operatorId,
        );
      }
      collected += 1;
    }
```
删除对 `batchService.createItem` / `linkItemTransfer` 的调用。

- [ ] **Step 4：重写 CLEAR 处理器**

把 `onFundsFlowStatusChanged` 里 `const item = ... settlementBatchItem.findFirst(...)` 到 `recomputeBatch` 这段替换为：
```ts
      await this.batchService.recomputeBatch(transfer.settlementBatchId);
```
（保留 `transfer = findUnique` + `sourceType !== FEE_SOURCE_TYPE` return。）

- [ ] **Step 5：跑测试确认绿**

Run: `npx jest src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 6：全模块回归 + 提交**

Run: `npx jest src/modules/funds-layer --silent 2>&1 | tail -5`
Expected: 全绿（≥ Phase 0 基线条数）
```bash
git add src/modules/funds-layer/workflow/fee-collection-workflow.service.ts src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts
git commit -m "feat(v7): fee-collection workflow spawns transfer under batch (no item)"
```

---

## Phase 4：后端资金单端点 + RBAC

### Task 7：FundsFlowService.findOneByNoForAdmin

**Files:**
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts`
- Test: `src/modules/funds-layer/domain/funds-flow.service.spec.ts`（若无则建）

- [ ] **Step 1：加 spec（先红）**

```ts
it('findOneByNoForAdmin returns fund by internalFundNo', async () => {
  // mock internalFund.findUnique({ where: { internalFundNo } }) → {...}
  const r = await service.findOneByNoForAdmin('IFD123');
  expect(r).toBeDefined();
});
it('findOneByNoForAdmin throws when missing', async () => {
  // findUnique → null
  await expect(service.findOneByNoForAdmin('NOPE')).rejects.toThrow();
});
```

- [ ] **Step 2：跑测试确认红**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts -t findOneByNoForAdmin 2>&1 | tail -8`
Expected: FAIL

- [ ] **Step 3：实现**

在 `findOneForAdmin` 之后加：
```ts
  async findOneByNoForAdmin(internalFundNo: string) {
    const item = await (this.prisma as any).internalFund.findUnique({
      where: { internalFundNo },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        internalTransaction: {
          select: { id: true, internalTxNo: true, pathLabel: true, status: true },
        },
        auditLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal fund not found');
    }
    return item;
  }
```

- [ ] **Step 4：跑测试确认绿 + 提交**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts -t findOneByNoForAdmin 2>&1 | tail -8`
Expected: PASS
```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(v7): FundsFlowService.findOneByNoForAdmin"
```

### Task 8：funds 列表/详情 controller + DTO + 模块注册

**Files:**
- Create: `src/modules/funds-layer/dto/funds-query.dto.ts`
- Create: `src/modules/funds-layer/controllers/funds-admin.controller.ts`
- Modify: `src/modules/funds-layer/funds-layer.module.ts`

- [ ] **Step 1：建查询 DTO**

`dto/funds-query.dto.ts`：
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class FundsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() txHash?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() internalFundNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
}
```
> `FundsFlowService.findAllForAdmin` 已接受 `InternalFundQueryDto`(同形)；此 DTO 仅为 funds-layer 自有契约，字段子集兼容。controller 直接把它传给 `findAllForAdmin`。

- [ ] **Step 2：建 controller**

`controllers/funds-admin.controller.ts`：
```ts
import {
  Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsQueryDto } from '../dto/funds-query.dto';

@ApiTags('Admin - Funds Layer Funds')
@Controller('admin/funds-layer/funds')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FundsAdminController {
  constructor(private readonly fundsFlow: FundsFlowService) {}

  @Get()
  @ApiOperation({ summary: 'List funds flows' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/funds-layer/funds'))
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: FundsQueryDto) {
    return this.fundsFlow.findAllForAdmin(query as any);
  }

  @Get(':internalFundNo')
  @ApiOperation({ summary: 'Get funds flow detail' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/funds-layer/funds/:internalFundNo'),
  )
  findOne(@Param('internalFundNo') internalFundNo: string) {
    return this.fundsFlow.findOneByNoForAdmin(internalFundNo);
  }
}
```

- [ ] **Step 3：模块注册**

`funds-layer.module.ts`：import `FundsAdminController` 并加进 `controllers: [...]` 数组。

- [ ] **Step 4：编译 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "funds-admin|funds-query" | head`
Expected: 无错
```bash
git add src/modules/funds-layer/dto/funds-query.dto.ts src/modules/funds-layer/controllers/funds-admin.controller.ts src/modules/funds-layer/funds-layer.module.ts
git commit -m "feat(v7): admin GET /admin/funds-layer/funds list + detail"
```

### Task 9：RBAC catalog 登记

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1：加两条 route**

在现有 funds-layer 段（`route('GET', '/admin/funds-layer/settlements', ...)` 附近，约 809-811 行）加：
```ts
  route('GET', '/admin/funds-layer/funds', 'List funds flows', ['INTERNAL_FUND_READ']),
  route('GET', '/admin/funds-layer/funds/:internalFundNo', 'Get funds flow detail', ['INTERNAL_FUND_READ']),
```
> 复用已存在的 `INTERNAL_FUND_READ` action bucket（遗留 `/admin/internal-funds` 路由也用它，已映射到相关角色）。

- [ ] **Step 2：编译 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "rbac.catalog" | head`
Expected: 无错
```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(v7): RBAC catalog entries for funds-layer funds list/detail"
```

---

## Phase 5：前端 — 新 InternalFund 页 + 导航/路由/权限

### Task 10：前端权限常量

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`

- [ ] **Step 1：加常量**

在 `FUNDS_LAYER_SETTLEMENT_RUN:` 那条之后加：
```ts
  FUNDS_LAYER_FUNDS_READ: 'api.get.admin_funds_layer_funds',
  FUNDS_LAYER_FUND_DETAIL_READ:
    'api.get.admin_funds_layer_funds_internalfundno',
```

- [ ] **Step 2：编译**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
- [ ] **Step 3：提交**
```bash
git add admin-web/src/rbac/permissions.ts
git commit -m "feat(v7): admin perms FUNDS_LAYER_FUNDS_READ/FUND_DETAIL_READ"
```

### Task 11：InternalFundListPage（新）

**Files:**
- Create: `admin-web/src/pages/funds-layer/InternalFundListPage.tsx`

- [ ] **Step 1：建页面（克隆 SettlementListPage 模式）**

新建 `InternalFundListPage.tsx`，照 `SettlementListPage.tsx` 结构改：
- 列表请求 `GET ${VITE_API_URL}/admin/funds-layer/funds?skip&take&status&internalFundNo&txHash`（response `{items,total}`）。
- 过滤框：Fund No / Status / Tx Hash。
- 表头列：`Fund No`（amber，点击 `navigate('/funds-layer/funds/'+item.internalFundNo)`）/ `Status`(AdminBadge) / `Asset`(item.asset?.code) / `Amount`(formatAssetAmount) / `Transfer`(item.internalTransaction?.internalTxNo) / `Created`。
- 标题 `Internal Funds`，meta `${total} fund(s)`，右上 Refresh 图标按钮。
- import 复用：`Pagination` / `adminButtonClass,adminIconButtonClass` / `PageTitleBar` / `AdminBadge` / `adminFetch,getApiErrorMessage,AdminSessionError` / `formatAssetAmount`。

- [ ] **Step 2：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
```bash
git add admin-web/src/pages/funds-layer/InternalFundListPage.tsx
git commit -m "feat(v7): admin InternalFund list page"
```

### Task 12：InternalFundDetailPage（新，含 Manual Simulation）

**Files:**
- Create: `admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx`

- [ ] **Step 1：建页面**

新建，结构参考 `InternalTransferDetailPage.tsx`：
- 路由参数 `internalFundNo`；请求 `GET ${VITE_API_URL}/admin/funds-layer/funds/${internalFundNo}`。
- 主体展示完整执行信息：fundNo(hero) / Status(AdminBadge) / Asset / Amount / **txHash / confirmations / blockNo / nonce / gasUsed / effectiveGasPrice** / `LegStatusTimeline`(复用 InternalTransferDetailPage 里那个时间线渲染——把它抽到这里或复制) 解析 `data.statusHistory`。
- 侧栏 Actions → **Manual Simulation**（搬自 InternalTransferDetailPage）：动作下拉 `['SIGN','BROADCAST','SEEN_IN_MEMPOOL','CONFIRM','CLEAR','FAIL','DROP','TIMEOUT','CANCEL']` + reason，提交调
  `POST ${VITE_API_URL}/admin/funds-layer/transfers/${data.internalTransaction.internalTxNo}/simulate`，body `{ fundsFlowId: data.id, action, reason }`，成功后 refetch。
  > 后端 simulate 端点不变；这里用本资金单的 `id` + 父 transfer 的 `internalTxNo`。
- 侧栏 Identity：Fund No / Status / Asset / **所属 Transfer**（`data.internalTransaction.internalTxNo`，点击 `navigate('/funds-layer/transfers/'+no)`）。
- DetailPageHeader `onBack={() => navigate('/funds-layer/funds')}` backLabel `Internal Funds`。

- [ ] **Step 2：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
```bash
git add admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx
git commit -m "feat(v7): admin InternalFund detail page with Manual Simulation"
```

### Task 13：路由 + 导航接线，删遗留 InternalFund 路由

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1：App.tsx lazy import**

加：
```ts
const InternalFundListPage = lazy(() => import('./pages/funds-layer/InternalFundListPage'));
const InternalFundDetailPage = lazy(() => import('./pages/funds-layer/InternalFundDetailPage'));
```
删遗留：`const InternalFundDetail = lazy(() => import('./pages/InternalFundDetail'));` 及（若存在）`InternalFundList` 的 lazy 行。

- [ ] **Step 2：App.tsx 路由**

在 `<Route path="/funds-layer">` 块内、`settlements/:batchNo` 之后加：
```tsx
            <Route
              path="funds"
              element={withPermission(<InternalFundListPage />, [PERMISSIONS.FUNDS_LAYER_FUNDS_READ])}
            />
            <Route
              path="funds/:internalFundNo"
              element={withPermission(<InternalFundDetailPage />, [PERMISSIONS.FUNDS_LAYER_FUND_DETAIL_READ])}
            />
```
删掉遗留的 `/admin/internal-funds` 相关 `<Route>`（指向旧 InternalFundList/Detail 的路由块）。

- [ ] **Step 3：DashboardLayout 导航**

Treasury 组（`label: 'Payout Records'` 那条之后）加：
```tsx
        {
          path: '/funds-layer/funds',
          label: 'Internal Funds',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_LAYER_FUNDS_READ],
        },
```
> `Activity` 图标已在文件 import（之前 Internal Funds 用过）；若 tsc 报未使用/未导入再调整 import。

- [ ] **Step 4：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
```bash
git add admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(v7): wire InternalFund routes + Treasury nav; drop legacy internal-funds route"
```

---

## Phase 6：前端 — Transfer 详情瘦身 + Settlement 详情换源

### Task 14：InternalTransferDetailPage 瘦身

**Files:**
- Modify: `admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx`

- [ ] **Step 1：删 Manual Simulation 状态 + 控件**

删除：`SIMULATE_ACTIONS` 常量、`simFundId/simAction/simReason/simSubmitting/simError` state、`handleSimulate` 函数、侧栏 `SidebarGroup title="Actions"` 整块。

- [ ] **Step 2：Execution Legs 改紧凑绑定行**

把主体 "Execution Legs" 区块（遍历 `data.funds` 渲染 leg + `LegStatusTimeline`）替换为紧凑行：
```tsx
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Funds
            </h3>
            {data.funds.length === 0 ? (
              <div className="p-4 text-center text-sm italic text-adm-t3">No funds bound</div>
            ) : (
              <div className="divide-y divide-adm-border rounded-lg border border-adm-border">
                {data.funds.map((leg) => (
                  <div key={leg.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">{leg.internalFundNo}</span>
                    <AdminBadge value={leg.status} />
                    <span className="font-mono text-[10px] text-adm-t2">
                      {formatAssetAmount(leg.amount, decimals)} {data.asset?.code || ''}
                    </span>
                    <span
                      className="cursor-pointer font-mono text-[10px] text-adm-blue hover:underline"
                      onClick={() => navigate(`/funds-layer/funds/${leg.internalFundNo}`)}
                    >
                      View →
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
```
删除 `LegStatusTimeline` 组件定义（已无引用）。`JsonBlock`/技术详情区可保留或精简（保留不影响）。清理因删除而未使用的 import（`User` 等——若 tsc 报未使用再删）。

- [ ] **Step 3：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0（如报未使用 import/变量，按提示删除后再跑）
```bash
git add admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx
git commit -m "feat(v7): slim Transfer detail to compact funds binding rows; simulate moved to Fund page"
```

### Task 15：SettlementDetailPage items → transfers

**Files:**
- Modify: `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx`

- [ ] **Step 1：改类型**

把 `SettlementBatchItem` interface 改名/改字段为 transfer 形态（或新增 `SettlementTransfer`）：
```ts
interface SettlementTransfer {
  internalTxNo: string;
  assetCode: string | null;
  asset?: { code?: string | null; currency?: string | null } | null;
  grossInAmount: string | null;
  grossOutAmount: string | null;
  netAmount: string;
  pathLabel: string | null;
  status: string;
}
```
`SettlementDetail` 里 `items: SettlementBatchItem[]` → `transfers: SettlementTransfer[]`。

- [ ] **Step 2：渲染改遍历 transfers**

把 `items.map(...)` 区块改为 `transfers.map(...)`，每行：
- 标题 `assetCode || asset?.code`；右侧 `AdminBadge value={t.status}`。
- 明细：`In: {grossInAmount ?? '0'}` / `Out: {grossOutAmount ?? '0'}` / `Net: {netAmount}` / `Direction: {pathLabel}` / 链接 `Transfer: {internalTxNo}` → `navigate('/funds-layer/transfers/'+internalTxNo)`。
- 顶部 "Settlement Context" 的 `Assets Settled` / `Outstanding Settled` 继续读 batch 级 `data.settledAssetCount` 等（不变）。
把 `const items = data.items ?? []` 改为 `const transfers = data.transfers ?? []`。

- [ ] **Step 3：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
```bash
git add admin-web/src/pages/funds-layer/SettlementDetailPage.tsx
git commit -m "feat(v7): Settlement detail renders transfers instead of items"
```

---

## Phase 7：清理 + 终检

### Task 16：删遗留前端 InternalFund 页

**Files:**
- Delete: `admin-web/src/pages/InternalFundList.tsx`
- Delete: `admin-web/src/pages/InternalFundDetail.tsx`

- [ ] **Step 1：确认无引用后删除**

Run: `grep -rn "pages/InternalFundList\|pages/InternalFundDetail" admin-web/src | grep -v "funds-layer"`
Expected: 空（Task 13 已移除 App.tsx 引用）。若空则：
```bash
git rm admin-web/src/pages/InternalFundList.tsx admin-web/src/pages/InternalFundDetail.tsx
```

- [ ] **Step 2：编译 + 提交**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0
```bash
git commit -m "chore(v7): remove legacy admin InternalFund pages"
```

### Task 17：终检（后端 + 前端 + 活体）

- [ ] **Step 1：后端全模块测试**

Run: `npx jest src/modules/funds-layer --silent 2>&1 | tail -5`
Expected: 全绿（≥ Phase 0 基线）

- [ ] **Step 2：后端整体编译**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i error | head`
Expected: 空（无残留 `settlementBatchItem` / `createItem` 等引用）

- [ ] **Step 3：前端构建**

Run: `cd admin-web && npx tsc -b 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]:-$?}"`
Expected: EXIT=0

- [ ] **Step 4：活体冒烟（可选，需整栈在跑）**

按 spec 的 EOD 路径手动验：seed 一个 USDT swap（或用真链路）→ admin Settlement Batches 点 Run → 进 batch 详情确认"按 transfer 渲染"→ 进 Internal Funds 页找到那条资金单 → 在 Fund 详情页 SIGN→…→CONFIRM 推到 CLEAR → 回 batch 看 SUCCESS、Outstanding SETTLED；Ledger TRADE_CLEARING 被 drain。

- [ ] **Step 5：最终提交（若 Step 1-3 有顺带修复）**

```bash
git add -A
git commit -m "test(v7): funds-layer green after settlement-item removal + InternalFund page split"
```

---

## 备注

- **范围红线**：本计划不实现法币 per-VA / Transfer→Fund 1:N / 路由选源 / asset-treasury 遗留后端模块退役。`grossInAmount/grossOutAmount` 为可空快照，A 类转账留空。
- **迁移**：破坏性（drop 表），靠 `dev:rebuild` 重铺；无数据搬迁脚本。
- **审计**：无新增 action；资金单 `INTERNAL_FUND_*`、transfer REQUESTED/COMPLETED/FAILED 不变。
- **simulate 端点不动**：UI 从 Transfer 详情迁到 Fund 详情，仍调 `POST /admin/funds-layer/transfers/:internalTxNo/simulate`。

# Outstanding + FeeAccrual 双 traceId + 全生命周期 audit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。复选框 `- [ ]` 跟踪进度。

**Goal:** Outstanding/FeeAccrual 持 `originTraceId` 字段（=swap.traceId）；全生命周期 5 个事件中的 4 个本轮做（created/locked/settled，不做 reopened —— 当前无实现路径）；created 主串 swap.traceId，locked/settled 主串 batch.traceId + `metadata.originTraceId` 携带 swap 根；audit 全部显式带 traceId、不依赖 fallback。

**Architecture:** 与 TR/SW/ST 同构——入表+继承；本轮新增"metadata 双根携带 + 跨域事件分配规则"。`reopened` 留待 Spec #5（与 REORG 异常路径一起做）。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest。branch 栈 / DB `/tmp/exchange_js_branch/dev.db`。

**Spec:** `doc-final/superpowers/specs/2026-06-16-outstanding-feeaccrual-dual-traceid-design.md`

---

## Plan-时发现的 spec 修正（实施时澄清）

1. **`lockToBatch` 是 pre-lock**（虚拟币 EOD 先按 batch 锁、后按 transfer 实质 lock）；`lockToTransfer` 是 settlementBatchId + settledByTransferId 双绑的实质 lock。**只在 lockToTransfer 发 LOCKED audit、避免重复**。
2. **`markSettledNettedZero`** 是净零 outstanding 的 SETTLED 路径（与 `settle` 并列）。两条都需补 audit。
3. **`reopen` 当前不存在**（grep 全仓零匹配）——本轮 spec 列举语义但 plan **不实装** reopen 方法或 audit；推到 Spec #5 与 REORG 异常路径一并做。
4. **`createForSwapSuccess` 用 upsert 模式**（findUnique→update or create）——audit 仅在 create 路径发（避免重入重复发 CREATED）。
5. **FeeAccrual.createAccrual 也是 upsert 模式**（findExisting → create with P2002 retry）——同上、仅 create 成功路径发 audit。
6. **`originTraceId` 继承来源**：Outstanding 从 swap.traceId；FeeAccrual 从 swap.traceId（accrueForSwap）或 withdraw.traceId（accrueForWithdraw）——需要在 caller 取 traceId 并传入。

---

## 文件结构

- Modify: `prisma/schema.prisma`（Outstanding + FeeAccrual 各加 `originTraceId String?`）
- Add: `prisma/migrations/<ts>_outstanding_fee_accrual_origin_trace_id/migration.sql`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（加 OUTSTANDING/FEE_ACCRUAL entityTypes + CREATED/LOCKED/SETTLED 3 actions）
- Modify: `src/modules/clearing-settle/outstandings/outstandings.service.ts`
  - `createForSwapSuccess` 写 originTraceId、create 路径发 OUTSTANDING.CREATED audit
  - 构造注入 AuditLogsService
- Modify: `src/modules/clearing-settle/outstandings/outstandings.service.spec.ts`
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts`
  - `lockToTransfer`：补 LOCKED audit（每 outstanding 一条）
  - `settle`：补 SETTLED audit
  - `markSettledNettedZero`：补 SETTLED audit
  - 构造注入 AuditLogsService
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts`
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.ts`
  - `createAccrual` 入参加 `originTraceId`，写入；create 路径发 FEE_ACCRUAL.CREATED audit
  - `accrueForSwap`/`accrueForWithdraw`：从 swap.traceId / withdraw.traceId 传 originTraceId
  - `settle`：补 LOCKED audit（按 batch.traceId + metadata.originTraceId）
  - `settleByTransfer`：补 SETTLED audit
  - 构造已注入 batchService（ST-T6 完成）+ AuditLogsService
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.spec.ts`

---

# Task 1：schema + 迁移

**Files:** `prisma/schema.prisma` + 新迁移

- [ ] **Step 1：在 `model Outstanding {}` 加列**

```prisma
  originTraceId          String?
```

同时在 `model FeeAccrual {}` 加：

```prisma
  originTraceId          String?
```

- [ ] **Step 2：生成迁移（create-only 先 inspect）**

```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev --name outstanding_fee_accrual_origin_trace_id --create-only
```

Inspect `prisma/migrations/<ts>/migration.sql` — 期望**仅** 2 条 `ALTER TABLE … ADD COLUMN "originTraceId" TEXT;`（或 RedefineTables 拷数据保留）。**任何 DROP 丢数据 BLOCKED**。

Apply：
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate dev
```

- [ ] **Step 3：验证**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema outstandings" | grep originTraceId
sqlite3 /tmp/exchange_js_branch/dev.db ".schema fee_accruals" | grep originTraceId
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM outstandings; SELECT COUNT(*) FROM fee_accruals;"
```
Expected: 两列都存在；行数 == 迁移前。

- [ ] **Step 4：build + jest**

```bash
npm run build 2>&1 | tail -3
npx jest 2>&1 | tail -6
```
Expected: 0 error / 0 failed。

- [ ] **Step 5：commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): outstandings.originTraceId + fee_accruals.originTraceId columns (additive)"
```

---

# Task 2：audit-actions 常量（加 OUTSTANDING + FEE_ACCRUAL + 3 actions）

**Files:** `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1：加 AuditEntityTypes**

```ts
OUTSTANDING: 'OUTSTANDING',
FEE_ACCRUAL: 'FEE_ACCRUAL',
```

- [ ] **Step 2：加 AuditActions（用短名）**

```ts
// Outstanding & FeeAccrual lifecycle (shared verbs, entityType differentiates)
CREATED: 'CREATED',
LOCKED: 'LOCKED',
SETTLED: 'SETTLED',
```

> 注：`CREATED` 这个短名可能与现有的 swap/quote/payin CREATED 重名——但它们走的是各自的 `XXX_CREATED` 全拼装名（SWAP_CREATED / SWAP_QUOTE_CREATED 等），所以新增 `CREATED` 短名只用于 OUTSTANDING/FEE_ACCRUAL entityType 下，**不冲突**。

- [ ] **Step 3：build + jest**

```bash
npm run build 2>&1 | tail -3
npx jest 2>&1 | tail -6
```
Expected: 0 error / 0 failed。

- [ ] **Step 4：commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(traceid): add OUTSTANDING + FEE_ACCRUAL entities + CREATED/LOCKED/SETTLED short actions"
```

---

# Task 3：Outstanding 写入面（createForSwapSuccess + audit CREATED）（TDD）

**Files:** `outstandings.service.ts` + `.spec.ts`

构造改动：注入 `AuditLogsService`。

- [ ] **Step 1：写失败测试**

读现有 spec setup。加入：

```ts
it('createForSwapSuccess: writes originTraceId from swap.traceId + emits OUTSTANDING.CREATED audit', async () => {
  const captured: any[] = [];
  const auditCalls: any[] = [];

  prisma.outstanding.findUnique = jest.fn().mockResolvedValue(null);
  prisma.outstanding.create = jest.fn((args: any) => {
    captured.push(args.data);
    return Promise.resolve({ id: `o-${captured.length}`, outstandingNo: `OTS${captured.length}`, ...args.data });
  });
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  await service.createForSwapSuccess(prisma, {
    id: 'swp1', swapNo: 'SWP1', status: 'SUCCESS', traceId: 'SWAP-TRACE',
    ownerType: 'CUSTOMER', ownerId: 'c1',
    fromAssetId: 'a-aed', fromAmount: '100',
    toAssetId: 'a-usdt', toAmount: '27', netToAmount: '27',
  } as any);

  expect(captured).toHaveLength(2); // IN + OUT
  expect(captured.every((c: any) => c.originTraceId === 'SWAP-TRACE')).toBe(true);

  expect(auditCalls).toHaveLength(2);
  expect(auditCalls.every((a: any) =>
    a.action === 'CREATED' && a.entityType === 'OUTSTANDING' && a.traceId === 'SWAP-TRACE'
  )).toBe(true);
});

it('createForSwapSuccess: when outstanding already exists (idempotent), does NOT emit CREATED audit', async () => {
  prisma.outstanding.findUnique = jest.fn().mockResolvedValue({ id: 'existing-1' });
  prisma.outstanding.update = jest.fn().mockResolvedValue({ id: 'existing-1' });
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  await service.createForSwapSuccess(prisma, {
    id: 'swp2', swapNo: 'SWP2', status: 'SUCCESS', traceId: 'SWAP-TRACE-2',
    ownerType: 'CUSTOMER', ownerId: 'c1',
    fromAssetId: 'a-aed', fromAmount: '50',
    toAssetId: 'a-usdt', toAmount: '14', netToAmount: '14',
  } as any);

  expect(auditCalls).toHaveLength(0);
});
```

- [ ] **Step 2：跑红**

```bash
npx jest outstandings.service.spec -t "originTraceId|emits OUTSTANDING.CREATED|already exists" 2>&1 | tail -15
```
Expected: 第一个 FAIL。

- [ ] **Step 3：实现**

`outstandings.service.ts`:
- 顶部加 `import { AuditLogsService } from '../../audit-logging/audit-logs.service';` + `import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';`
- 构造改：`constructor(private readonly prisma: PrismaService, private readonly auditLogsService: AuditLogsService) {}`
- `createForSwapSuccess` 内、每条 outstanding：
  - 写 originTraceId（在 `data` 中加 `originTraceId: swap.traceId ?? null`）
  - **仅在 create 分支**（else 分支，非 existing update）发 audit：
    ```ts
    await this.auditLogsService.recordSystem({
      action: AuditActions.CREATED,
      entityType: AuditEntityTypes.OUTSTANDING,
      entityId: created.id,
      entityNo: created.outstandingNo,
      workflowType: 'SWAP', // outstanding 创建归属 swap 域
      reason: `Outstanding ${row.direction} ${row.assetCurrency} ${row.amount} created from ${swap.swapNo}`,
      sourcePlatform: 'SYSTEM',
      traceId: swap.traceId,
    });
    ```

- [ ] **Step 4：跑绿 + 全段**

```bash
npx jest outstandings.service.spec 2>&1 | tail -10
```

- [ ] **Step 5：commit**

```bash
git add src/modules/clearing-settle/outstandings/outstandings.service.ts \
        src/modules/clearing-settle/outstandings/outstandings.service.spec.ts
git commit -m "feat(traceid): outstanding inherits swap.traceId + emits CREATED audit (TDD)"
```

---

# Task 4：Outstanding LOCKED + SETTLED audit（TDD）

**Files:** `outstanding-consumer.service.ts` + `.spec.ts`

构造改动：注入 `AuditLogsService`。

- [ ] **Step 1：写失败测试**

```ts
it('lockToTransfer: emits OUTSTANDING.LOCKED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  // Mock outstanding rows after the update — service needs to query post-update or pre-query for originTraceId
  prisma.outstanding.findMany = jest.fn().mockResolvedValue([
    { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'SWAP-T1' },
    { id: 'o2', outstandingNo: 'OTS2', originTraceId: 'SWAP-T2' },
  ]);
  prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' });
  prisma.outstanding.updateMany = jest.fn().mockResolvedValue({ count: 2 });

  await service.lockToTransfer(['o1', 'o2'], 'b1', 't1', prisma);

  expect(auditCalls).toHaveLength(2);
  auditCalls.forEach((a: any) => {
    expect(a.action).toBe('LOCKED');
    expect(a.entityType).toBe('OUTSTANDING');
    expect(a.traceId).toBe('BATCH-T1');
    expect(JSON.parse(a.metadata).originTraceId).toMatch(/^SWAP-T/);
    expect(a.workflowType).toBe('SETTLEMENT');
  });
});

it('settle: emits OUTSTANDING.SETTLED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
  // settle 接收 settledByTransferId — need to look up outstanding rows that match
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  prisma.outstanding.findMany = jest.fn().mockResolvedValue([
    { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'SWAP-T1', settlementBatchId: 'b1' },
  ]);
  prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' });
  prisma.outstanding.updateMany = jest.fn().mockResolvedValue({ count: 1 });

  await service.settle('t1', 'fund1', prisma);

  expect(auditCalls).toHaveLength(1);
  expect(auditCalls[0].action).toBe('SETTLED');
  expect(auditCalls[0].traceId).toBe('BATCH-T1');
  expect(JSON.parse(auditCalls[0].metadata).originTraceId).toBe('SWAP-T1');
});

it('markSettledNettedZero: emits SETTLED audit for the netted-zero outstandings', async () => {
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  prisma.outstanding.findMany = jest.fn().mockResolvedValue([
    { id: 'o-nz', outstandingNo: 'OTS-NZ', originTraceId: 'SWAP-T9' },
  ]);
  prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({ id: 'b-nz', traceId: 'BATCH-T9' });
  prisma.outstanding.updateMany = jest.fn().mockResolvedValue({ count: 1 });

  await service.markSettledNettedZero('b-nz', 'asset1', prisma);

  expect(auditCalls).toHaveLength(1);
  expect(auditCalls[0].action).toBe('SETTLED');
  expect(auditCalls[0].traceId).toBe('BATCH-T9');
  expect(JSON.parse(auditCalls[0].metadata).originTraceId).toBe('SWAP-T9');
});
```

- [ ] **Step 2：跑红**

- [ ] **Step 3：实现**

`outstanding-consumer.service.ts`:
- 构造注入 AuditLogsService
- 每个方法（`lockToTransfer / settle / markSettledNettedZero`）：
  - 在 update 前/后 query 受影响的 outstanding 行（取 originTraceId）
  - query 关联的 batch.traceId
  - update 完成后 forEach 发 audit

伪代码（lockToTransfer）：
```ts
async lockToTransfer(outstandingIds, settlementBatchId, settledByTransferId, tx) {
  const client = (tx ?? this.prisma) as any;

  // Capture origin trace for audit BEFORE update (status='OPEN'; after update they become 'LOCKED')
  const rows = await client.outstanding.findMany({
    where: { id: { in: outstandingIds }, status: 'OPEN' },
    select: { id: true, outstandingNo: true, originTraceId: true },
  });

  const result = await client.outstanding.updateMany({
    where: { id: { in: outstandingIds }, status: 'OPEN' },
    data: { status: 'LOCKED', settlementBatchId, settledByTransferId, lockedAt: new Date() },
  });

  // Get batch.traceId for the settlement-domain root
  const batch = await client.settlementBatch.findUnique({
    where: { id: settlementBatchId }, select: { traceId: true },
  });

  for (const row of rows) {
    await this.auditLogsService.recordSystem({
      action: AuditActions.LOCKED,
      entityType: AuditEntityTypes.OUTSTANDING,
      entityId: row.id,
      entityNo: row.outstandingNo,
      workflowType: 'SETTLEMENT',
      reason: `Locked to transfer ${settledByTransferId}`,
      sourcePlatform: 'SYSTEM',
      traceId: batch?.traceId,
      metadata: JSON.stringify({ originTraceId: row.originTraceId }),
    });
  }

  return result;
}
```

`settle` 类似：先 findMany 拿到 `originTraceId` + `settlementBatchId`、再 update、再 join batch → audit。
`markSettledNettedZero`：先 findMany 拿到、再 update、再 audit。

> 注：audit 字段 `metadata` 实际是字符串列（`JSON.stringify(obj)`）—— 现有 audit 调用都这么用；spec 中 SQL `json_extract(metadata, '$.originTraceId')` 也基于此。

- [ ] **Step 4：跑绿**

```bash
npx jest outstanding-consumer.service.spec 2>&1 | tail -10
npx jest 2>&1 | tail -6
```

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/outstanding-consumer.service.ts \
        src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "feat(traceid): outstanding LOCKED/SETTLED audit + metadata-carried originTraceId (TDD)"
```

---

# Task 5：FeeAccrual originTraceId 入表 + CREATED audit（TDD）

**Files:** `fee-accrual.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

```ts
it('createAccrual: writes originTraceId + emits FEE_ACCRUAL.CREATED audit', async () => {
  const captured: any[] = [];
  const auditCalls: any[] = [];

  prisma.feeAccrual.findUnique = jest.fn().mockResolvedValue(null);
  prisma.feeAccrual.create = jest.fn((args: any) => {
    captured.push(args.data);
    return Promise.resolve({ id: 'fa1', feeAccrualNo: 'FAC1', ...args.data });
  });
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  // accrueForSwap should pass swap.traceId to createAccrual
  prisma.swapTransaction.findUnique = jest.fn().mockResolvedValue({
    id: 's1', swapNo: 'SWP1', traceId: 'SWAP-TRACE',
    ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
    toAssetId: 'a-aed', feeAmount: '10', spreadAmount: '2.42',
    toAsset: { code: 'AED' },
  });

  await service.accrueForSwap('s1', prisma);

  expect(captured.every((c: any) => c.originTraceId === 'SWAP-TRACE')).toBe(true);
  expect(auditCalls.every((a: any) =>
    a.action === 'CREATED' && a.entityType === 'FEE_ACCRUAL' && a.traceId === 'SWAP-TRACE'
  )).toBe(true);
});

it('createAccrual: existing (idempotent) — no audit', async () => {
  prisma.feeAccrual.findUnique = jest.fn().mockResolvedValue({ id: 'existing' });
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  prisma.swapTransaction.findUnique = jest.fn().mockResolvedValue({
    id: 's2', swapNo: 'SWP2', traceId: 'SWAP-T2',
    ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
    toAssetId: 'a', feeAmount: '3', spreadAmount: '0', toAsset: { code: 'X' },
  });

  await service.accrueForSwap('s2', prisma);
  expect(auditCalls).toHaveLength(0);
});
```

- [ ] **Step 2：跑红**

- [ ] **Step 3：实现**

构造注入 AuditLogsService。
- `createAccrual` 入参加 `originTraceId?: string | null`：
  ```ts
  private async createAccrual(tx: Tx, d: AccrualInput & { originTraceId?: string | null }) {
    // existing findUnique idempotent check
    if (existing) return existing;
    // P2002 retry loop
    ...
    const created = await (tx as any).feeAccrual.create({
      data: { feeAccrualNo: generateReferenceNo('FAC'), ...d, status: 'ACCRUED' },
    });

    // audit only on actual create
    await this.auditLogsService.recordSystem({
      action: AuditActions.CREATED,
      entityType: AuditEntityTypes.FEE_ACCRUAL,
      entityId: created.id,
      entityNo: created.feeAccrualNo,
      workflowType: 'SWAP', // FeeAccrual.created 归属 trade 域
      reason: `${d.feeKind} accrual for ${d.sourceType}/${d.sourceNo}`,
      sourcePlatform: 'SYSTEM',
      traceId: d.originTraceId ?? null,
    });

    return created;
  }
  ```
- `accrueForSwap`：从 swap.traceId 传入：
  ```ts
  await this.createAccrual(tx, { ...base, feeKind:'SERVICE_FEE', amount: fee, originTraceId: swap.traceId });
  ```
- `accrueForWithdraw`：从 withdraw.traceId 传入。

- [ ] **Step 4：跑绿**

```bash
npx jest fee-accrual.service.spec 2>&1 | tail -10
```

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/fee-accrual.service.ts \
        src/modules/funds-layer/domain/fee-accrual.service.spec.ts
git commit -m "feat(traceid): fee_accrual inherits swap/withdraw.traceId + emits CREATED audit (TDD)"
```

---

# Task 6：FeeAccrual LOCKED + SETTLED audit（TDD）

**Files:** `fee-accrual.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

```ts
it('settle: emits FEE_ACCRUAL.LOCKED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  const accruals = [
    { id: 'fa1', feeAccrualNo: 'FAC1', originTraceId: 'SWAP-T1', assetId: 'usdt', category: 'SWAP_FEE', amount: '3', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
    { id: 'fa2', feeAccrualNo: 'FAC2', originTraceId: 'SWAP-T2', assetId: 'usdt', category: 'SWAP_FEE', amount: '1', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
  ];
  // Reuse existing settle mocks (batch, transfer, leg, systemWallets) — see existing spec
  // After settle, audit LOCKED for each
  // ... (full mock setup as in existing settle test)

  await service.settle(accruals, 'SWAP_FEE', 'EOD', prisma);

  const lockedCalls = auditCalls.filter((a: any) => a.action === 'LOCKED');
  expect(lockedCalls).toHaveLength(2);
  lockedCalls.forEach((a, i) => {
    expect(a.traceId).toBe('mock-batch-traceId'); // from batchService.createBatch mock returning traceId
    expect(JSON.parse(a.metadata).originTraceId).toMatch(/^SWAP-T/);
  });
});

it('settleByTransfer: emits FEE_ACCRUAL.SETTLED for each, traceId=batch.traceId + metadata.originTraceId', async () => {
  const auditCalls: any[] = [];
  auditLogsService.recordSystem = jest.fn((args: any) => { auditCalls.push(args); return Promise.resolve(); });

  prisma.feeAccrual.findMany = jest.fn().mockResolvedValue([
    { id: 'fa1', feeAccrualNo: 'FAC1', originTraceId: 'SWAP-T1', settlementBatchId: 'b1' },
  ]);
  prisma.internalTransaction.findUnique = jest.fn().mockResolvedValue({ settlementBatchId: 'b1' });
  prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({ id: 'b1', traceId: 'BATCH-T1' });
  prisma.feeAccrual.updateMany = jest.fn().mockResolvedValue({ count: 1 });

  await service.settleByTransfer('t1', 'fund1', prisma);

  const settledCalls = auditCalls.filter((a: any) => a.action === 'SETTLED' && a.entityType === 'FEE_ACCRUAL');
  expect(settledCalls).toHaveLength(1);
  expect(settledCalls[0].traceId).toBe('BATCH-T1');
  expect(JSON.parse(settledCalls[0].metadata).originTraceId).toBe('SWAP-T1');
});
```

- [ ] **Step 2：跑红**

- [ ] **Step 3：实现**

- `settle`：在 updateMany 设置 LOCKED 之后，forEach 发 audit（traceId=batch.traceId、metadata.originTraceId=accrual.originTraceId）
- `settleByTransfer`：findMany 拿到受影响的 accrual + originTraceId、updateMany、批次 join、forEach 发 audit

- [ ] **Step 4：跑绿**

```bash
npx jest fee-accrual.service.spec 2>&1 | tail -10
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
```

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/fee-accrual.service.ts \
        src/modules/funds-layer/domain/fee-accrual.service.spec.ts
git commit -m "feat(traceid): fee_accrual LOCKED/SETTLED audit + metadata-carried originTraceId (TDD)"
```

---

# Task 7：live recon 验证

- [ ] **Step 1：全量终验 + 重启栈**

```bash
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
(cd admin-web && npx tsc --noEmit 2>&1 | tail -3)
npm run dev:stop && nohup npm run dev:start > /tmp/dev-restart-dt.log 2>&1 & disown
sleep 18
for p in 3500 3501 3502 3503; do
  found=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2,$1}' | head -1)
  echo "$p: ${found:-(off)}"
done
```

- [ ] **Step 2：clean reset + sim**

```bash
bash scripts/reset-branch.sh > /tmp/reset-dt.log 2>&1
sleep 18
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-deposits-only.ts > /tmp/dep-dt.log 2>&1
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-swaps-only.ts > /tmp/swap-dt.log 2>&1
```

- [ ] **Step 3：5 条 SQL 实证**（来自 spec H）

```bash
DB=/tmp/exchange_js_branch/dev.db

echo "① 每条新 Outstanding/FeeAccrual 都有 originTraceId（应为 0/0）："
sqlite3 -header $DB "
SELECT 'outstandings' tbl, COUNT(*) missing FROM outstandings WHERE originTraceId IS NULL AND createdAt > datetime('now','-30 minutes')
UNION ALL
SELECT 'fee_accruals', COUNT(*) FROM fee_accruals WHERE originTraceId IS NULL AND createdAt > datetime('now','-30 minutes');"

echo ""
echo "② originTraceId == swap.traceId（应全 match）："
sqlite3 $DB "
SELECT o.outstandingNo || ' | o=' || substr(o.originTraceId,1,8) || ' | s=' || substr(s.traceId,1,8) || ' | ' ||
  CASE WHEN o.originTraceId = s.traceId THEN 'match' ELSE 'mismatch' END
FROM outstandings o JOIN swap_transactions s ON s.id = o.swapTransactionId LIMIT 5;"

echo ""
echo "③ CREATED 事件主串 swap.traceId："
sqlite3 -header $DB "SELECT entityType, action, COUNT(*) FROM audit_log_events WHERE entityType IN ('OUTSTANDING','FEE_ACCRUAL') AND action='CREATED' GROUP BY entityType, action;"

echo ""
echo "④ LOCKED + SETTLED 事件主串 batch.traceId 且 metadata 含 originTraceId："
sqlite3 -header $DB "
SELECT entityType, action, substr(traceId,1,8) AS t, json_extract(metadata,'\$.originTraceId') AS origin
FROM audit_log_events
WHERE entityType IN ('OUTSTANDING','FEE_ACCRUAL') AND action IN ('LOCKED','SETTLED')
LIMIT 5;"

echo ""
echo "⑤ 双向命中实证（方案 A 核心）："
sqlite3 $DB "
WITH s AS (SELECT id, traceId AS swap_trace FROM swap_transactions ORDER BY createdAt DESC LIMIT 1)
SELECT 'by swap=' || (SELECT COUNT(*) FROM audit_log_events e, s
  WHERE entityType='OUTSTANDING' AND (e.traceId = s.swap_trace OR json_extract(e.metadata,'\$.originTraceId') = s.swap_trace));
SELECT 'by batch=' || COUNT(*) FROM audit_log_events
WHERE entityType='OUTSTANDING' AND action='SETTLED'
  AND traceId IN (SELECT traceId FROM settlement_batches WHERE createdAt > datetime('now','-30 minutes'));"
```

Expected:
- ① 0/0
- ② 全 match
- ③ OUTSTANDING.CREATED N 条 + FEE_ACCRUAL.CREATED N 条
- ④ traceId 是 batch UUID、origin 是 swap UUID
- ⑤ by swap = by batch（双向命中数相等）

---

## 验收（Definition of Done）

1. `npx jest` 0 failed + build + admin tsc 0 error
2. 5 条 SQL 实证全部通过
3. 不动 TR/SW/ST 已落地的 traceId/audit（背景一致性）
4. `reopened` 未实装（暂留 Spec #5）

## 非目标

- ❌ 不实装 `reopened` 事件（推 Spec #5）
- ❌ 不冗余存 `settlementTraceId` 字段
- ❌ 不写 `buildOutstandingTraceId / buildFeeAccrualTraceId` fallback（Spec #5）
- ❌ 不动 audit_log_events 表结构
- ❌ 不动 ST 已落地的 `BATCH_CREATED/SUCCEEDED` 全拼装名（Spec #4 改名一并做）
- ❌ 不动 Outstanding/FeeAccrual UI
- ❌ 不回填历史 `originTraceId`

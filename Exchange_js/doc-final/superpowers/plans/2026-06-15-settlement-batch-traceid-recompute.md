# Settlement 域 traceId 治本 + Batch 闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。复选框 `- [ ]` 跟踪进度。

**Goal:** settlement_batch 是 settlement 域的根、UUID 入表；transfer 从 batch 继承 traceId；fee-accrual.settleByTransfer 末尾调 recomputeBatch（治本 SWAP_FEE batch 卡 CREATED）；BATCH_CREATED + BATCH_SUCCEEDED audit；audit fallback 按 input > batch > legacy 顺序。

**Architecture:** 与 deposit/payin TR + swap Spec #1 同构——入口生成 UUID 入表、下游继承、所有 audit 显式带、fallback 兜底。BATCH_SUCCEEDED 仅在 recomputeBatch 首次推到 SUCCESS 时发（防重）；BATCH_RECOMPUTED 不发（噪音）。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest。branch 栈 / DB `/tmp/exchange_js_branch/dev.db`。

**Spec:** `doc-final/superpowers/specs/2026-06-15-settlement-batch-traceid-recompute-design.md`

---

## Plan-时发现的 spec 修正（实施时澄清）

1. **`AuditEntityTypes.SETTLEMENT_BATCH` 不存在** —— audit-actions.constant.ts 里的 entity 枚举没有这一项。Task 4 新增。
2. **`resolveSettlementWorkflowContext` 不存在** —— audit-logs.service.ts 没有 SETTLEMENT workflow 分支。Task 5 在 resolveDepositWorkflowContext 旁**新增**整段 if-branch（不是改造现有）。
3. **`internal-transfer.service.ts:114` 当前每 transfer 自己 `randomUUID()`** —— 不读 batch.traceId。Task 3 改为：有 settlementBatchId 时从 batch 表查 traceId；无 settlementBatchId 时（如 SWAP fee 等非 batch transfer）保留 randomUUID 兜底。
4. **`fee-accrual.settleByTransfer` 当前只 updateMany、不查 transfer** —— 没有 settlementBatchId 来调 recompute。Task 6 补一次 query 拿 settlementBatchId 后调用 recompute。
5. **`recomputeBatch` 当前 update 时不区分 old vs new status** —— Task 2 改为先 `findUnique` 取旧 status，update 后比较，旧≠SUCCESS && 新=SUCCESS → audit BATCH_SUCCEEDED。

---

## 文件结构

- Modify: `prisma/schema.prisma`（`SettlementBatch` 加 `traceId String?`）
- Add: `prisma/migrations/<ts>_settlement_batch_trace_id/migration.sql`
- Modify: `src/modules/funds-layer/domain/settlement-batch.service.ts`
  - `createBatch`：生成 UUID 入表 + audit `BATCH_CREATED`
  - `recomputeBatch`：判旧 status；旧≠SUCCESS && 新=SUCCESS → audit `BATCH_SUCCEEDED`
  - 构造注入 `AuditLogsService`
- Modify: `src/modules/funds-layer/domain/settlement-batch.service.spec.ts`（traceId + audit 断言）
- Modify: `src/modules/funds-layer/domain/internal-transfer.service.ts`
  - `createTransfer`：有 settlementBatchId 时从 batch.traceId 继承（替代 randomUUID）
- Modify: `src/modules/funds-layer/domain/internal-transfer.service.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
  - 加 `SETTLEMENT_BATCH` 到 `AuditEntityTypes`
  - 加 `BATCH_CREATED`、`BATCH_SUCCEEDED` 到 `AuditActions`
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.ts`
  - `settleByTransfer`：先 query transfer.settlementBatchId、调 `recomputeBatch`（治本一行）
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.spec.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
  - 新增 `buildSettlementTraceId(batch?)`
  - 在 resolveDepositWorkflowContext 旁加 SETTLEMENT workflow 分支
- Modify: `src/modules/audit-logging/audit-logs.service.spec.ts`

---

# Task 1：schema + 迁移（settlement_batches.traceId 列）

**Files:** `prisma/schema.prisma` + 新迁移

- [ ] **Step 1：在 `model SettlementBatch {}` 加列**

```prisma
  traceId        String?
```

- [ ] **Step 2：生成迁移（create-only 先 inspect）**

```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev --name settlement_batch_trace_id --create-only
```

Inspect `prisma/migrations/<ts>_settlement_batch_trace_id/migration.sql` — 期望**仅** `ALTER TABLE "settlement_batches" ADD COLUMN "traceId" TEXT;` 或 SQLite RedefineTables（INSERT…SELECT 完整拷数据）。**任何 DROP 丢数据 BLOCKED**。

Apply：
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate dev
```

- [ ] **Step 3：验证**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema settlement_batches" | grep traceId
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM settlement_batches;"
```
Expected: `"traceId" TEXT` 在 schema 内；行数 == 迁移前数。

- [ ] **Step 4：build**

`npm run build 2>&1 | tail -3` → 0 error。

- [ ] **Step 5：commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): settlement_batches.traceId column for audit traceability (additive)"
```

---

# Task 2：audit-actions 常量（加 SETTLEMENT_BATCH + BATCH_CREATED + BATCH_SUCCEEDED）

**Files:** `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1：加 AuditEntityTypes**

在 `AuditEntityTypes` 对象中（找现有的、与 SWAP_TRANSACTION/DEPOSIT_TRANSACTION 邻位）加：
```ts
SETTLEMENT_BATCH: 'SETTLEMENT_BATCH',
```

- [ ] **Step 2：加 AuditActions**

在 `AuditActions` 对象中（与 SWAP_* / DEPOSIT_* 邻位）加：
```ts
BATCH_CREATED: 'BATCH_CREATED',
BATCH_SUCCEEDED: 'BATCH_SUCCEEDED',
```

- [ ] **Step 3：build + jest（无新逻辑、应直接绿）**

```bash
npm run build 2>&1 | tail -3
npx jest 2>&1 | tail -6
```
Expected: 0 error / 0 failed。

- [ ] **Step 4：commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(traceid): add SETTLEMENT_BATCH entity + BATCH_CREATED/SUCCEEDED actions"
```

---

# Task 3：createBatch 生成 UUID + BATCH_CREATED audit（TDD）

**Files:** `settlement-batch.service.ts` + `.spec.ts`

构造改动：注入 `AuditLogsService`。

- [ ] **Step 1：写失败测试**

读 `settlement-batch.service.spec.ts` 现有 setup。加入 `createBatch` 段：

```ts
it('createBatch generates UUID traceId, persists it, and emits BATCH_CREATED audit', async () => {
  const capturedCreate: any[] = [];
  const capturedAudit: any[] = [];

  (prisma as any).settlementBatch.create = jest.fn((args: any) => {
    capturedCreate.push(args.data);
    return Promise.resolve({ id: 'b1', batchNo: 'OSB1', ...args.data });
  });
  (auditLogsService as any).recordSystem = jest.fn((args: any) => {
    capturedAudit.push(args);
    return Promise.resolve();
  });

  await service.createBatch({ cutoffAt: new Date(), category: 'SWAP_FEE', settlementType: 'FIAT_SWAP' });

  expect(capturedCreate).toHaveLength(1);
  expect(capturedCreate[0].traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  expect(capturedAudit).toHaveLength(1);
  expect(capturedAudit[0]).toMatchObject({
    action: 'BATCH_CREATED',
    entityType: 'SETTLEMENT_BATCH',
    traceId: capturedCreate[0].traceId,
  });
});
```

适配 spec 现有变量名（`service` / `prisma` / `auditLogsService`）。如果 audit 服务未注入，按 SW-T3/TR-T2 模式在 Test.createTestingModule 中加 mock provider。

- [ ] **Step 2：跑红**

```bash
npx jest settlement-batch.service.spec -t "createBatch generates UUID" 2>&1 | tail -12
```
Expected: FAIL（service 不生成 traceId、不调 audit）。

- [ ] **Step 3：实现**

`settlement-batch.service.ts` 顶部加：
```ts
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
```

构造改：
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly auditLogsService: AuditLogsService,
) {}
```

`createBatch` 内、`settlementBatch.create({ data: {...} })` data 加 `traceId: randomUUID(),`：
```ts
const traceId = randomUUID();
return await (client as any).settlementBatch.create({
  data: { batchNo, settlementType: ..., category: ..., status: 'CREATED', cutoffAt, requestId, traceId },
});
```

`createBatch` 末尾（execute 函数返回 batch 之后、createBatch 本体 return 之前）：
```ts
await this.auditLogsService.recordSystem({
  action: AuditActions.BATCH_CREATED,
  entityType: AuditEntityTypes.SETTLEMENT_BATCH,
  entityId: batch.id,
  entityNo: batch.batchNo,
  workflowType: 'SETTLEMENT',
  reason: `Batch created: ${batch.category}/${batch.settlementType}`,
  sourcePlatform: 'SYSTEM',
  traceId: batch.traceId,
});
```

注意：execute 返回值就是 batch；retry 循环里第一个成功的 batch 即为 result。把 audit 放在 createBatch 顶层方法（`if (tx) return execute(tx); else return $transaction(...)`）之后、return 之前（提取出 batch、记 audit、return）。

- [ ] **Step 4：跑绿 + 全段**

```bash
npx jest settlement-batch.service.spec 2>&1 | tail -10
```
Expected: 全绿。

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/settlement-batch.service.ts \
        src/modules/funds-layer/domain/settlement-batch.service.spec.ts
git commit -m "feat(traceid): SettlementBatchService.createBatch UUID+BATCH_CREATED audit (TDD)"
```

---

# Task 4：recomputeBatch 首次进 SUCCESS 时发 BATCH_SUCCEEDED + 防重（TDD）

**Files:** `settlement-batch.service.ts` + `.spec.ts`

- [ ] **Step 1：写 3 个失败测试**

```ts
it('recomputeBatch: PROCESSING→SUCCESS 首次推到 SUCCESS 时发 BATCH_SUCCEEDED audit', async () => {
  // 让 transfers/outstandings/feeAccruals 全 settled
  (prisma as any).settlementBatch.findUnique = jest.fn().mockResolvedValue({
    id: 'b1', batchNo: 'OSB1', status: 'CREATED', traceId: 'TRACE-1',
  });
  (prisma as any).internalTransaction.findMany = jest.fn().mockResolvedValue([{ status: 'SUCCESS', assetId: 'a1' }]);
  (prisma as any).outstanding.findMany = jest.fn().mockResolvedValue([]);
  (prisma as any).feeAccrual.findMany = jest.fn().mockResolvedValue([{ status: 'SETTLED' }]);
  (prisma as any).settlementBatch.update = jest.fn().mockResolvedValue({ id: 'b1' });
  const capturedAudit: any[] = [];
  (auditLogsService as any).recordSystem = jest.fn((args: any) => { capturedAudit.push(args); return Promise.resolve(); });

  await service.recomputeBatch('b1');

  expect(capturedAudit).toHaveLength(1);
  expect(capturedAudit[0]).toMatchObject({ action: 'BATCH_SUCCEEDED', traceId: 'TRACE-1' });
});

it('recomputeBatch: 已 SUCCESS 再调用 不重复发 audit', async () => {
  (prisma as any).settlementBatch.findUnique = jest.fn().mockResolvedValue({
    id: 'b2', batchNo: 'OSB2', status: 'SUCCESS', traceId: 'TRACE-2',
  });
  (prisma as any).internalTransaction.findMany = jest.fn().mockResolvedValue([{ status: 'SUCCESS', assetId: 'a1' }]);
  (prisma as any).outstanding.findMany = jest.fn().mockResolvedValue([]);
  (prisma as any).feeAccrual.findMany = jest.fn().mockResolvedValue([{ status: 'SETTLED' }]);
  (prisma as any).settlementBatch.update = jest.fn().mockResolvedValue({ id: 'b2' });
  const capturedAudit: any[] = [];
  (auditLogsService as any).recordSystem = jest.fn((args: any) => { capturedAudit.push(args); return Promise.resolve(); });

  await service.recomputeBatch('b2');

  expect(capturedAudit).toHaveLength(0);
});

it('recomputeBatch: 未达 allDone 不发 audit', async () => {
  (prisma as any).settlementBatch.findUnique = jest.fn().mockResolvedValue({
    id: 'b3', batchNo: 'OSB3', status: 'CREATED', traceId: 'TRACE-3',
  });
  (prisma as any).internalTransaction.findMany = jest.fn().mockResolvedValue([{ status: 'PENDING', assetId: 'a1' }]);
  (prisma as any).outstanding.findMany = jest.fn().mockResolvedValue([]);
  (prisma as any).feeAccrual.findMany = jest.fn().mockResolvedValue([{ status: 'LOCKED' }]);
  (prisma as any).settlementBatch.update = jest.fn().mockResolvedValue({ id: 'b3' });
  const capturedAudit: any[] = [];
  (auditLogsService as any).recordSystem = jest.fn((args: any) => { capturedAudit.push(args); return Promise.resolve(); });

  await service.recomputeBatch('b3');

  expect(capturedAudit).toHaveLength(0);
});
```

- [ ] **Step 2：跑红**

```bash
npx jest settlement-batch.service.spec -t "recomputeBatch" 2>&1 | tail -15
```
Expected: 第一个 FAIL（不发 audit），其他 2 个可能 PASS（确实不发，但要确保新代码不破）。

- [ ] **Step 3：实现**

`recomputeBatch` 内 execute 函数顶部加旧 status 查询：
```ts
const existing = await (client as any).settlementBatch.findUnique({
  where: { id: settlementBatchId },
  select: { status: true, traceId: true, batchNo: true },
});
const wasSuccess = existing?.status === 'SUCCESS';
```

（注：retry/transaction 已成熟、不再赘述）

update 之后、execute 返回前加：
```ts
if (allDone && !wasSuccess) {
  await this.auditLogsService.recordSystem({
    action: AuditActions.BATCH_SUCCEEDED,
    entityType: AuditEntityTypes.SETTLEMENT_BATCH,
    entityId: settlementBatchId,
    entityNo: existing?.batchNo,
    workflowType: 'SETTLEMENT',
    reason: `Batch reached SUCCESS via recompute (${totalOutstandingCount} outstanding + ${totalFeeAccrualCount} fee accruals)`,
    sourcePlatform: 'SYSTEM',
    traceId: existing?.traceId,
  });
}
```

注意：audit 调用本应在 `$transaction` 完成后（避免锁持有过久），但当前 recomputeBatch 用 `tx ?? this.prisma`，audit 调用方上下文不一定知道 tx 何时 commit。**最简方案**：audit 在 execute 内、update 后；与 SW-T4 SWAP_SUCCEEDED audit 同 pattern；事务提交后审计也提交。如果未来出现性能问题再优化。

- [ ] **Step 4：跑绿**

```bash
npx jest settlement-batch.service.spec 2>&1 | tail -12
```
Expected: 全绿（含 3 个新测）。

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/settlement-batch.service.ts \
        src/modules/funds-layer/domain/settlement-batch.service.spec.ts
git commit -m "feat(traceid): recomputeBatch emits BATCH_SUCCEEDED on first transition to SUCCESS (TDD, dedup-safe)"
```

---

# Task 5：internal-transfer 继承 batch.traceId（TDD）

**Files:** `internal-transfer.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

```ts
it('createTransfer: settlementBatchId 给定时从 batch.traceId 继承', async () => {
  (prisma as any).settlementBatch.findUnique = jest.fn().mockResolvedValue({
    id: 'b1', traceId: 'BATCH-TRACE-UUID',
  });
  const captured: any[] = [];
  (prisma as any).internalTransaction.create = jest.fn((args: any) => {
    captured.push(args.data);
    return Promise.resolve({ id: 't1', internalTxNo: 'ITX1', ...args.data });
  });

  await service.createTransfer({
    // ... 必填字段（按 spec 现有 input shape 补齐）
    settlementBatchId: 'b1',
  } as any);

  expect(captured).toHaveLength(1);
  expect(captured[0].traceId).toBe('BATCH-TRACE-UUID');
});

it('createTransfer: 无 settlementBatchId 时 fallback randomUUID（兼容现状）', async () => {
  const captured: any[] = [];
  (prisma as any).internalTransaction.create = jest.fn((args: any) => {
    captured.push(args.data);
    return Promise.resolve({ id: 't2', internalTxNo: 'ITX2', ...args.data });
  });

  await service.createTransfer({
    // 不带 settlementBatchId
  } as any);

  expect(captured).toHaveLength(1);
  expect(captured[0].traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});
```

读现有 spec、按其 input shape 调整。

- [ ] **Step 2：跑红**

```bash
npx jest internal-transfer.service.spec -t "settlementBatchId 给定时" 2>&1 | tail -15
```
Expected: FAIL（当前 traceId 总是 randomUUID）。

- [ ] **Step 3：实现**

`internal-transfer.service.ts:114` `const traceId = randomUUID();` 改为：

```ts
let traceId: string | null = null;
if (input.settlementBatchId) {
  const batch = await (client as any).settlementBatch.findUnique({
    where: { id: input.settlementBatchId },
    select: { traceId: true },
  });
  traceId = batch?.traceId ?? null;
}
traceId = traceId ?? randomUUID();
```

注：`client` 是 tx client；如果当前作用域只有 `prisma` 则用 `prisma`——按现有代码风格。

- [ ] **Step 4：跑绿**

```bash
npx jest internal-transfer.service.spec 2>&1 | tail -10
```
Expected: 全绿（含 2 个新测）。

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/internal-transfer.service.ts \
        src/modules/funds-layer/domain/internal-transfer.service.spec.ts
git commit -m "feat(traceid): transfer inherits batch.traceId when settlementBatchId given (TDD)"
```

---

# Task 6：fee-accrual.settleByTransfer 调 recomputeBatch（治本核心）（TDD）

**Files:** `fee-accrual.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

```ts
it('settleByTransfer: 调用 batchService.recomputeBatch(transfer.settlementBatchId)', async () => {
  (prisma as any).internalTransaction.findUnique = jest.fn().mockResolvedValue({
    id: 't1', settlementBatchId: 'b1',
  });
  (prisma as any).feeAccrual.updateMany = jest.fn().mockResolvedValue({ count: 2 });
  const recomputeSpy = jest.spyOn(batchService as any, 'recomputeBatch').mockResolvedValue({} as any);

  await service.settleByTransfer('t1', 'fund1', prisma);

  expect(recomputeSpy).toHaveBeenCalledWith('b1', prisma);
});

it('settleByTransfer: transfer 无 settlementBatchId 时不调 recomputeBatch', async () => {
  (prisma as any).internalTransaction.findUnique = jest.fn().mockResolvedValue({
    id: 't2', settlementBatchId: null,
  });
  (prisma as any).feeAccrual.updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const recomputeSpy = jest.spyOn(batchService as any, 'recomputeBatch').mockResolvedValue({} as any);

  await service.settleByTransfer('t2', 'fund1', prisma);

  expect(recomputeSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2：跑红**

```bash
npx jest fee-accrual.service.spec -t "settleByTransfer" 2>&1 | tail -12
```
Expected: 第一个 FAIL（不调 recompute）。

- [ ] **Step 3：实现**

`fee-accrual.service.ts::settleByTransfer` 改为：

```ts
async settleByTransfer(
  settledByTransferId: string,
  internalFundId: string,
  tx: Tx,
): Promise<{ count: number }> {
  const result = await (tx as any).feeAccrual.updateMany({
    where: { settledByTransferId, status: 'LOCKED' },
    data: {
      status: 'SETTLED',
      closedByInternalFundId: internalFundId,
      closedAt: new Date(),
    },
  });

  // 治本：fee-accrual 状态推进后主动通知 batch 重新汇总。
  // 与现有 6 处 workflow 调 recomputeBatch 的模式拉齐。
  const transfer = await (tx as any).internalTransaction.findUnique({
    where: { id: settledByTransferId },
    select: { settlementBatchId: true },
  });
  if (transfer?.settlementBatchId) {
    await this.batchService.recomputeBatch(transfer.settlementBatchId, tx as any);
  }

  return result;
}
```

- [ ] **Step 4：跑绿 + 全段**

```bash
npx jest fee-accrual.service.spec 2>&1 | tail -10
```
Expected: 全绿。

- [ ] **Step 5：commit**

```bash
git add src/modules/funds-layer/domain/fee-accrual.service.ts \
        src/modules/funds-layer/domain/fee-accrual.service.spec.ts
git commit -m "fix(settlement): fee-accrual.settleByTransfer triggers recomputeBatch — SWAP_FEE batch no longer stuck CREATED (TDD)"
```

---

# Task 7：audit-logs buildSettlementTraceId + SETTLEMENT workflow 分支（TDD）

**Files:** `audit-logs.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

```ts
describe('buildSettlementTraceId fallback ordering', () => {
  it('prefers batch.traceId, then legacy BATCH:<id>, else null', () => {
    const svc: any = service;

    expect(svc.buildSettlementTraceId({ id: 'b1', traceId: 'TRACE' })).toBe('TRACE');
    expect(svc.buildSettlementTraceId({ id: 'b1', traceId: null })).toBe('BATCH:b1');
    expect(svc.buildSettlementTraceId(null)).toBeNull();
  });
});
```

- [ ] **Step 2：跑红**

- [ ] **Step 3：实现**

加方法：
```ts
private buildSettlementTraceId(
  batch?: { id?: string | null; traceId?: string | null } | null,
): string | null {
  const t = this.normalizeOptionalString(batch?.traceId);
  if (t) return t;
  const rootId = this.normalizeOptionalString(batch?.id);
  return rootId ? `BATCH:${rootId}` : null;
}
```

在 `resolveDepositWorkflowContext`（或其类似入口）旁，新增 SETTLEMENT 分支：

```ts
if (
  entityType === 'SETTLEMENT_BATCH' ||
  explicitWorkflowType === 'SETTLEMENT'
) {
  let batch: any = null;
  if (input.entityId && db?.settlementBatch?.findUnique) {
    batch = await db.settlementBatch.findUnique({
      where: { id: input.entityId },
      select: { id: true, traceId: true, batchNo: true },
    });
  }
  return {
    traceId:
      this.normalizeOptionalString(input.traceId) ||
      this.buildSettlementTraceId(batch),
    workflowType: 'SETTLEMENT',
    entityOwnerNo: entityOwnerNo || null,
  };
}
```

注：`'SETTLEMENT'` workflow type 字面值；如有 `AuditWorkflowTypes.SETTLEMENT` 常量则改用之。

- [ ] **Step 4：跑绿 + 全段**

```bash
npx jest audit-logs.service.spec 2>&1 | tail -10
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
```
Expected: 全绿、0 error。

- [ ] **Step 5：commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts \
        src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(traceid): buildSettlementTraceId + SETTLEMENT workflow context (TDD)"
```

---

# Task 8：live recon 验证

- [ ] **Step 1：终验 + 重启栈**

```bash
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
(cd admin-web && npx tsc --noEmit 2>&1 | tail -3)
npm run dev:stop && nohup npm run dev:start > /tmp/dev-restart-st.log 2>&1 & disown
sleep 18
for p in 3500 3501 3502 3503; do
  found=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2,$1}' | head -1)
  echo "$p: ${found:-(off)}"
done
```

- [ ] **Step 2：clean reset + sim**

```bash
bash scripts/reset-branch.sh > /tmp/reset-st.log 2>&1
sleep 18
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-deposits-only.ts > /tmp/dep-st.log 2>&1
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-swaps-only.ts > /tmp/swap-st.log 2>&1
```

- [ ] **Step 3：核心 SQL 实证**

```bash
DB=/tmp/exchange_js_branch/dev.db

# ① SWAP_FEE batch 不再卡 CREATED
sqlite3 -header $DB "SELECT category, status, COUNT(*) FROM settlement_batches GROUP BY category, status;"
# 期望：PRINCIPAL SUCCESS 10、SWAP_FEE SUCCESS 5（不再 CREATED）

# ② batch.traceId == tx.traceId 继承生效
sqlite3 -header $DB "
SELECT b.batchNo, b.traceId AS batch_traceId, it.traceId AS tx_traceId,
       CASE WHEN b.traceId = it.traceId THEN '✓ match' ELSE '✗ mismatch' END AS check
FROM settlement_batches b
JOIN internal_transactions it ON it.settlementBatchId = b.id
WHERE b.createdAt > datetime('now','-30 minutes')
LIMIT 5;"

# ③ BATCH_CREATED + BATCH_SUCCEEDED audit 出现
sqlite3 -header $DB "SELECT action, COUNT(*) FROM audit_log_events WHERE entityType='SETTLEMENT_BATCH' GROUP BY action;"
# 期望：BATCH_CREATED 15、BATCH_SUCCEEDED 15
```

Expected:
- SWAP_FEE batch 全 SUCCESS（不再 CREATED）
- batch.traceId == tx.traceId 全 ✓ match
- BATCH_CREATED + BATCH_SUCCEEDED 各 15 条

---

## 验收（Definition of Done）

1. `npx jest` 0 failed + build + admin tsc 0 error
2. SWAP_FEE batch 不再卡 CREATED（治本主线）
3. batch.traceId 非空、与下游 transaction.traceId 一致
4. BATCH_CREATED + BATCH_SUCCEEDED audit 出现且数目相等

## 非目标

- ❌ 不动 Outstanding/FeeAccrual 表结构（Spec #3）
- ❌ 不引入事件驱动（保留 workflow 直接调 recompute）
- ❌ 不发 BATCH_RECOMPUTED（噪音、用户已确认不要）
- ❌ 不发 BATCH_FAILED（Spec #5）
- ❌ 不回填历史 batch.traceId 或历史 audit 行

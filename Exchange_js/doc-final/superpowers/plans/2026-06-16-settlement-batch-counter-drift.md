# Spec #7 — Settlement Batch Counter Drift 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 让 `settle` 类方法在自己内部紧跟 `recomputeBatch`、同 tx 同步执行，治本 batch counter + status drift。

**Architecture:** 3 处后端 settle 内置 recomputeBatch + 1 处前端误导按钮删除。caller 端现有 recomputeBatch 调用全保留（防御性双调用、recomputeBatch 幂等）。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest + React/Vite/Tailwind admin web

**Spec:** `doc-final/superpowers/specs/2026-06-16-settlement-batch-counter-drift-design.md`

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `src/modules/funds-layer/domain/fee-accrual.service.ts` | settle loop 内每 group 末尾追加 recomputeBatch | Modify (+1 行 impl) |
| `src/modules/funds-layer/domain/fee-accrual.service.spec.ts` | 新测试断言 settle 触发 recomputeBatch | Modify (+~25 行 test) |
| `src/modules/funds-layer/domain/outstanding-consumer.service.ts` | settle 末尾 + markSettledNettedZero 末尾追加 recomputeBatch | Modify (+~6 行 impl) |
| `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts` | 2 个新测试 | Modify (+~40 行 test) |
| `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx` | 删 Run EOD 按钮 + 关联 state/handler | Modify (-28 行) |

---

## Task 1 — fee-accrual.service.settle 内置 recomputeBatch

**Files:**
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.ts:298` (loop 内 audit 循环之后加 1 行)
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.spec.ts:271` (在 `describe('FeeAccrualService.settle')` 块尾追加新测试)

### Step 1.1 — Write failing test

在 `fee-accrual.service.spec.ts` 第 271 行后（`describe('FeeAccrualService.settle', ...)` 块尾）插入：

```ts
  it('settle: per group calls batchService.recomputeBatch(batch.id, tx) after locking accruals', async () => {
    const accruals = [
      { id: 'a1', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '10', feeAccrualNo: 'FA1', originTraceId: 'OT1' },
      { id: 'a2', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '15', feeAccrualNo: 'FA2', originTraceId: 'OT2' },
    ];
    const prisma: any = {
      asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) },
      feeAccrual: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = {
      resolve: jest.fn().mockResolvedValue({ id: 'w1' }),
      resolveCustomer: jest.fn().mockResolvedValue({ id: 'w2' }),
    };
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    const batchService: any = {
      createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1', traceId: 'BT1' }),
      recomputeBatch,
    };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);

    await svc.settle(accruals, 'SWAP_FEE', 'EOD', prisma);

    expect(recomputeBatch).toHaveBeenCalledTimes(1); // 2 accruals同 assetId → 1 group → 1 batch
    expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
  });

  it('settle: 2 distinct assets → 2 batches → recomputeBatch called once per batch', async () => {
    const accruals = [
      { id: 'a1', assetId: 'usdtId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '10', feeAccrualNo: 'FA1', originTraceId: 'OT1' },
      { id: 'a2', assetId: 'btcId', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'CU1', amount: '5', feeAccrualNo: 'FA2', originTraceId: 'OT2' },
    ];
    const prisma: any = {
      asset: { findUnique: jest.fn().mockResolvedValue({ type: 'CRYPTO' }) },
      feeAccrual: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const transfers: any = { createTransfer: jest.fn().mockResolvedValue({ id: 't1' }) };
    const fundsFlow: any = { createLeg: jest.fn().mockResolvedValue({}) };
    const systemWallets: any = {
      resolve: jest.fn().mockResolvedValue({ id: 'w1' }),
      resolveCustomer: jest.fn().mockResolvedValue({ id: 'w2' }),
    };
    const recomputeBatch = jest.fn().mockResolvedValue({} as any);
    let batchCounter = 0;
    const batchService: any = {
      createBatch: jest.fn().mockImplementation(async () => {
        batchCounter++;
        return { id: `b${batchCounter}`, batchNo: `OSB${batchCounter}`, traceId: `BT${batchCounter}` };
      }),
      recomputeBatch,
    };
    const svc = new FeeAccrualService(prisma, transfers, fundsFlow, systemWallets, batchService, { recordSystem: jest.fn() } as any);

    await svc.settle(accruals, 'SWAP_FEE', 'EOD', prisma);

    expect(recomputeBatch).toHaveBeenCalledTimes(2);
    expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
    expect(recomputeBatch).toHaveBeenCalledWith('b2', prisma);
  });
```

### Step 1.2 — Run test to verify it fails

```bash
cd Exchange_js && npx jest --testPathPattern='fee-accrual.service.spec' -t 'per group calls batchService.recomputeBatch'
```

Expected: **FAIL** — `expect(recomputeBatch).toHaveBeenCalledTimes(1)` actual 0。

### Step 1.3 — Implement recomputeBatch inside loop

打开 `src/modules/funds-layer/domain/fee-accrual.service.ts`，定位到 line 282-297 audit emit `for (const accrual of group)` 循环。在该 for-loop 结束的 `}` **之后、外层 `for (const [assetId, group] of groups)` 的 `}` 之前** 插入：

```ts
      // Spec #7: settle 类方法内紧跟 recomputeBatch、同 tx 同步执行、不依赖 caller。
      await this.batchService.recomputeBatch(batch.id, tx);
```

完整片段（context line 282-300）：

```ts
      for (const accrual of group) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.LOCKED,
          entityType: AuditEntityTypes.FEE_ACCRUAL,
          entityId: accrual.id,
          entityNo: accrual.feeAccrualNo,
          workflowType: 'SETTLEMENT',
          reason: `Locked to transfer ${transfer.id} via batch ${batch.batchNo}`,
          sourcePlatform: 'SYSTEM',
          traceId: batch.traceId,
          metadata: JSON.stringify({ originTraceId: accrual.originTraceId ?? null }) as any,
        });
      }

      // Spec #7: settle 类方法内紧跟 recomputeBatch、同 tx 同步执行、不依赖 caller。
      await this.batchService.recomputeBatch(batch.id, tx);
    }   // ← 外层 for-group 的闭合
  }     // ← settle 方法的闭合
```

### Step 1.4 — Run test to verify it passes

```bash
cd Exchange_js && npx jest --testPathPattern='fee-accrual.service.spec' -t 'per group calls batchService.recomputeBatch'
cd Exchange_js && npx jest --testPathPattern='fee-accrual.service.spec' -t '2 distinct assets'
```

Expected: **PASS**.

### Step 1.5 — Full file suite + commit

```bash
cd Exchange_js && npx jest --testPathPattern='fee-accrual.service.spec'
```

Expected: 全绿（settle 块 + 既有 settleByTransfer 块全部 PASS）。

```bash
cd Exchange_js && git add src/modules/funds-layer/domain/fee-accrual.service.ts src/modules/funds-layer/domain/fee-accrual.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(funds-layer): fee-accrual.settle inlines recomputeBatch per batch

Counter drift root cause: fee-accrual.settle created a batch + flipped
accruals to LOCKED but never refreshed the batch's totalFeeAccrualCount /
status. Result: OSB2606169242/161741 stuck at CREATED with counter=0
despite 2/1 LOCKED rows bound.

Fix: call recomputeBatch(batch.id, tx) in-loop after the audit emit per
group. Same tx, sync execution, no reliance on caller.

Spec: #7 settle 类方法内紧跟 recomputeBatch
EOF
)"
```

---

## Task 2 — outstanding-consumer.service.settle 内置 recomputeBatch

**Files:**
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts:198` (return result; 之前追加循环)
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts:233` (在 `settle` audit 测试之后追加)

### Step 2.1 — Write failing test

在 `outstanding-consumer.service.spec.ts` 已有 `it('settle: emits OUTSTANDING.SETTLED ...')` 测试之后插入：

```ts
    it('settle: calls batchService.recomputeBatch once per distinct settlementBatchId on the rows being settled', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const rows = [
        { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'OT1', settlementBatchId: 'b1' },
        { id: 'o2', outstandingNo: 'OTS2', originTraceId: 'OT2', settlementBatchId: 'b1' }, // dup → dedup to 1 call
        { id: 'o3', outstandingNo: 'OTS3', originTraceId: 'OT3', settlementBatchId: 'b2' },
      ];
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue(rows),
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
        settlementBatch: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'b1', traceId: 'BT1' },
            { id: 'b2', traceId: 'BT2' },
          ]),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.settle('transfer-1', 'fund-1', prisma);
      expect(recomputeBatch).toHaveBeenCalledTimes(2);
      expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
      expect(recomputeBatch).toHaveBeenCalledWith('b2', prisma);
    });

    it('settle: no settled rows → does NOT call recomputeBatch', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.settle('transfer-x', 'fund-x', prisma);
      expect(recomputeBatch).not.toHaveBeenCalled();
    });
```

> **注意**：先看 `outstanding-consumer.service.spec.ts` 顶部 `OutstandingConsumerService` 构造器签名（line 14-30 附近）。若已有 `batchService` 注入，沿用同模式；若是 `outstanding-consumer.service.ts` 构造器尚无 batchService，**先做 Step 2.3 注入**再回 Step 2.1。

### Step 2.2 — Run test to verify it fails

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'calls batchService.recomputeBatch once per distinct'
```

Expected: **FAIL**.

### Step 2.3 — Check existing constructor + add recomputeBatch call

**先确认**：`outstanding-consumer.service.ts` 构造器是否已注入 `SettlementBatchService`：

```bash
grep -nE "constructor|batchService|SettlementBatchService" src/modules/funds-layer/domain/outstanding-consumer.service.ts | head -10
```

- **若已有** → 跳到下一段直接改 settle
- **若没有** → 先在构造器添加 `private readonly batchService: SettlementBatchService,` + 添加 import：
  ```ts
  import { SettlementBatchService } from './settlement-batch.service';
  ```

打开 `outstanding-consumer.service.ts`、定位到 `settle` 方法末尾 `return result;` 之前（约 line 198），插入：

```ts
    // Spec #7: settle 末尾紧跟 recomputeBatch、同 tx、按 distinct batchId 调一次。
    if (rows.length > 0) {
      const batchIds = Array.from(
        new Set(
          rows
            .map((r: any) => r.settlementBatchId)
            .filter((id: string | null): id is string => Boolean(id)),
        ),
      );
      for (const batchId of batchIds) {
        await this.batchService.recomputeBatch(batchId, client);
      }
    }

    return result;
```

> 注意：`rows` 与 `batchIds` 在 audit-emit 段已经构造过（line 173-180）。**为避免重复构造**，可以将 batchIds 提取到 audit-emit 之前共用。若改动太大、用上面"独立计算 batchIds"的写法即可（DRY 优化留给后续 cleanup）。

### Step 2.4 — Run tests to verify they pass

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'settle: calls batchService.recomputeBatch once per distinct'
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'settle: no settled rows'
```

Expected: **PASS**.

### Step 2.5 — Full file suite + commit

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec'
```

Expected: 全绿。

```bash
cd Exchange_js && git add src/modules/funds-layer/domain/outstanding-consumer.service.ts src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(funds-layer): outstanding-consumer.settle inlines recomputeBatch

Counter drift root cause: outstanding.settle flipped LOCKED→SETTLED but
recomputeBatch lived in callers (eod-settlement-workflow:204 /
fiat-settlement-workflow:170). When a listener swallowed an error from
audit/transfer side, recomputeBatch never fired, leaving batch counters
stale. Result: OSB2606163819/168901 stuck at PROCESSING with
settledOutstandingCount=0 despite all bound outstandings being SETTLED.

Fix: call recomputeBatch once per distinct settlementBatchId on the
settled rows, same tx, before returning. Caller's existing calls remain
as a defense-in-depth no-op (recomputeBatch is idempotent).

Spec: #7 settle 类方法内紧跟 recomputeBatch
EOF
)"
```

---

## Task 3 — outstanding-consumer.service.markSettledNettedZero 内置 recomputeBatch

**Files:**
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts:269` (return result; 之前加 1 行)
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts` (`markSettledNettedZero` 测试块追加 recomputeBatch 断言)

### Step 3.1 — Write failing test

在 `outstanding-consumer.service.spec.ts` 既有 `markSettledNettedZero` 测试块之后插入：

```ts
    it('markSettledNettedZero: calls batchService.recomputeBatch(settlementBatchId, tx) when at least 1 row settled', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const rows = [
        { id: 'o1', outstandingNo: 'OTS1', originTraceId: 'OT1' },
      ];
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue(rows),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        settlementBatch: {
          findUnique: jest.fn().mockResolvedValue({ traceId: 'BT1' }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.markSettledNettedZero('b1', 'usdt-asset-id', prisma);
      expect(recomputeBatch).toHaveBeenCalledTimes(1);
      expect(recomputeBatch).toHaveBeenCalledWith('b1', prisma);
    });

    it('markSettledNettedZero: no rows → does NOT call recomputeBatch', async () => {
      const recomputeBatch = jest.fn().mockResolvedValue({} as any);
      const batchService: any = { recomputeBatch };
      const prisma: any = {
        outstanding: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const svc = new OutstandingConsumerService(prisma, batchService, { recordSystem: jest.fn() } as any);
      await svc.markSettledNettedZero('b1', 'usdt-asset-id', prisma);
      expect(recomputeBatch).not.toHaveBeenCalled();
    });
```

### Step 3.2 — Run test to verify it fails

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'markSettledNettedZero: calls batchService.recomputeBatch'
```

Expected: **FAIL**.

### Step 3.3 — Implement recomputeBatch tail call

打开 `outstanding-consumer.service.ts`，定位到 `markSettledNettedZero` 方法末尾 `return result;` 之前（约 line 269）。在该 `}` (audit emit for-loop 闭合) 与 `return result;` 之间插入：

```ts
    // Spec #7: markSettledNettedZero 末尾紧跟 recomputeBatch、同 tx。
    if (rows.length > 0) {
      await this.batchService.recomputeBatch(settlementBatchId, client);
    }

    return result;
```

### Step 3.4 — Run tests to verify they pass

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'markSettledNettedZero: calls batchService.recomputeBatch'
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec' -t 'markSettledNettedZero: no rows'
```

Expected: **PASS**.

### Step 3.5 — Full file suite + commit

```bash
cd Exchange_js && npx jest --testPathPattern='outstanding-consumer.service.spec'
```

Expected: 全绿。

```bash
cd Exchange_js && git add src/modules/funds-layer/domain/outstanding-consumer.service.ts src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(funds-layer): outstanding-consumer.markSettledNettedZero inlines recomputeBatch

Spec: #7 settle 类方法内紧跟 recomputeBatch — closing the symmetric
hole for netted-zero outstandings (no transfer, LOCKED→SETTLED in-batch).
EOF
)"
```

---

## Task 4 — 删 SettlementDetailPage 上的 Run EOD 按钮

**Files:**
- Modify: `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx` (删 line 62-63 state、line 92-111 handleRun、line 243-265 ACTIONS SidebarGroup)

### Step 4.1 — 确认删除范围

打开 `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx`，确认以下 4 处：

1. **state** (line 62-63):
   ```ts
   const [running, setRunning] = useState(false);
   const [runError, setRunError] = useState('');
   ```
2. **handleRun** (line 92-111): 整段 `const handleRun = async () => { ... };`
3. **SidebarGroup "Actions"** (line 243-265): 整段 `<SidebarGroup title="Actions"> ... </SidebarGroup>` Manual Run 块
4. **imports**：检查 `SidebarGroup` 是否还有其他使用者；`adminButtonClass` 同理。若仅 Manual Run 用、一并删 import

### Step 4.2 — 执行删除

按 Step 4.1 列出的 4 处用 Edit 工具删除。

**关键判断**：SidebarGroup 是否还有其他使用者？

```bash
grep -n "SidebarGroup" admin-web/src/pages/funds-layer/SettlementDetailPage.tsx
```

- 若有其他 `<SidebarGroup>` 调用 → 保留 import
- 若仅 ACTIONS 这一处 → 同时删 import 行

### Step 4.3 — admin tsc 验证

```bash
cd Exchange_js/admin-web && npx tsc --noEmit
```

Expected: **0 错** (state/handler/JSX 删干净、未引入 unused-import 或 unused-state)。

### Step 4.4 — 前端渲染验证 (preview)

启动 admin-web、打开任一 settlement batch 详情页：

```bash
cd Exchange_js && npm run dev:status
# 若 admin-web 未起：cd admin-web && npm run dev
```

然后用浏览器访问 `http://localhost:3501/funds-layer/settlements/<任一 batchNo>`：

- ✅ 详情页右侧 sidebar 不再有 "Actions / Manual Run / Run EOD Settlement" 块
- ✅ 列表页 `/funds-layer/settlements` PageTitleBar 上仍有 "Run EOD Settlement" 按钮（位置不变）

### Step 4.5 — commit

```bash
cd Exchange_js && git add admin-web/src/pages/funds-layer/SettlementDetailPage.tsx
git commit -m "$(cat <<'EOF'
fix(admin/settlements): remove misleading Run EOD button from detail page

The detail page's right-sidebar Manual Run button called the global
EOD endpoint (/admin/funds-layer/settlements/run), not anything scoped
to the current batch. Operators reasonably read it as "rerun this
batch" — wrong mental model, wrong blast radius.

Removed: button + handler + state. The SettlementListPage button (in
the page title bar) stays as the correct entry point for triggering
global EOD.

Spec: #7 UX 衍生 bug 修复
EOF
)"
```

---

## Task 5 — Live Recon 验收

**Goal:** 跑完整 settle 链、SQL 验 counter 一致 + batch 状态自动推进、admin UI 验按钮已删。

### Step 5.1 — 准备数据

```bash
cd Exchange_js && npm run dev:reset:branch
# 重置后服务自动重启、Alice 用户重建、F_OPS/F_FEE 钱包就位
```

### Step 5.2 — 跑 1 笔 swap + 1 笔 withdraw

```bash
cd Exchange_js && npx ts-node scripts/sim-one-swap-usdt-aed.ts
# 记下输出的 swapNo（后续 SQL 用得到）
```

```bash
# 注意：sim-one-withdraw 脚本可能不存在；若没有就跳过 withdraw 这一笔，仅用 swap 一笔验 SWAP_FEE batch。
# 或者从 admin 后台手动发起一笔 USDT 提现到任一已批准地址。
```

### Step 5.3 — 触发全局 EOD

```bash
cd Exchange_js && curl -X POST http://localhost:3500/admin/funds-layer/settlements/run \
  -H "Authorization: Bearer $(cat /tmp/exchange_js_branch/admin-token)" \
  -H "Content-Type: application/json"
# 或：admin web 列表页点 "Run EOD Settlement"
```

### Step 5.4 — 推所有 transfer hop 到 CLEAR

```bash
cd Exchange_js && sqlite3 /tmp/exchange_js_branch/dev.db "
SELECT internalTxNo, pathLabel, status FROM internal_transactions
WHERE createdAt > datetime('now','-15 minutes')
ORDER BY createdAt DESC;
"
# 对所有 PENDING/PROCESSING/AWAITING 的 transfer 用 admin 推到 CLEAR
# 或脚本批量推
```

### Step 5.5 — SQL ① counter 一致性

```bash
cd Exchange_js && sqlite3 /tmp/exchange_js_branch/dev.db "
SELECT s.batchNo, s.category, s.status, s.totalOutstandingCount,
       (SELECT COUNT(*) FROM outstandings WHERE settlementBatchId=s.id) AS actual_out,
       s.totalFeeAccrualCount,
       (SELECT COUNT(*) FROM fee_accruals WHERE settlementBatchId=s.id) AS actual_fee
FROM settlement_batches s
WHERE s.createdAt > datetime('now','-15 minutes')
ORDER BY s.createdAt DESC;
"
```

**Expected**: 每行 `totalOutstandingCount = actual_out` 且 `totalFeeAccrualCount = actual_fee`（无 stale）。

### Step 5.6 — SQL ② 全 SETTLED → batch SUCCESS

```bash
cd Exchange_js && sqlite3 /tmp/exchange_js_branch/dev.db "
SELECT s.batchNo, s.category, s.status
FROM settlement_batches s
WHERE s.createdAt > datetime('now','-15 minutes')
  AND NOT EXISTS (
    SELECT 1 FROM outstandings o WHERE o.settlementBatchId=s.id AND o.status != 'SETTLED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM fee_accruals f WHERE f.settlementBatchId=s.id AND f.status != 'SETTLED'
  );
"
```

**Expected**: 凡是所有 outstanding/fee 都 SETTLED 的 batch、`status='SUCCESS'`（不再卡 PROCESSING/CREATED）。

### Step 5.7 — Admin UI 截图验证

打开 admin 浏览器：

1. `http://localhost:3501/funds-layer/settlements` → 列表页 PageTitleBar 上 **有** Run EOD 按钮
2. `http://localhost:3501/funds-layer/settlements/<batchNo>` → 详情页右侧 sidebar **无** Manual Run 块
3. 详情页 "Settlement Context" 区显示的 "Outstanding Settled X/Y"、"Assets Settled X/Y" 数字与 SQL ① actual 一致

### Step 5.8 — Final commit

```bash
cd Exchange_js && git commit --allow-empty -m "$(cat <<'EOF'
verify(spec-7): live recon 验收 counter drift 治本

跑了 sim swap + EOD + 推 hop CLEAR；SQL ① counter 与 actual 一致、
SQL ② 全 SETTLED batch 自动 status=SUCCESS；admin UI 详情页无 Run EOD
按钮、列表页保留。

Spec: #7 闭环
EOF
)"
```

---

## Self-Review

### Spec coverage

| Spec 节 | 对应任务 |
|---|---|
| §1.2 漏点 1 (fee-accrual.settle 末尾) | T1 |
| §1.2 漏点 2 (outstanding-consumer.settle 末尾) | T2 |
| §1.2 漏点 3 (markSettledNettedZero 末尾) | T3 |
| §1.3 UX 衍生 bug (Run EOD 按钮) | T4 |
| §5 验收 (SQL ① ② + admin UI) | T5 |

无 spec 要求未被任务覆盖 ✓

### Placeholder scan

- 无 "TBD"/"TODO"/"implement later" ✓
- 每个 step 都有完整代码或完整命令 ✓
- 测试代码完整、不写 "类似 TaskN" ✓

### Type consistency

- `recomputeBatch(batchId, tx)` 签名贯穿 T1/T2/T3 一致 ✓
- `OutstandingConsumerService` 构造器若需扩展 `batchService`、T2 Step 2.3 标注先确认现状再决策 ✓
- 测试 mock 与 service 真实方法名一致：`settle`（不是 `settleByTransfer`、已校正）✓

# Settlement 域 traceId 治本 + Batch 闭环 — 设计

日期：2026-06-15
状态：已确认（用户拍板：settleByTransfer 内同事务调 recompute；BATCH_RECOMPUTED 不记；本轮验收只法币侧）

Spec #2（traceId 治本系列第 2 轮：Deposit/Payin TR → Swap #1 → **Settlement #2**）

## 背景与根因

实测真证据（本轮 reset+sim 后）：

```
category | settlementType | status   | n  | settled_fee_accrual
PRINCIPAL| FIAT_SWAP      | SUCCESS  | 10 | 0
SWAP_FEE | FIAT_SWAP      | CREATED  | 5  | 0   ← 卡住
```

5 个 SWAP_FEE batch 全部 status=CREATED + `settledFeeAccrualCount=0`，但**真实情况**：
- 它们关联的 fee_accrual 全部 status=SETTLED ✓
- 它们关联的 internal_transaction 全部 status=SUCCESS ✓

**代码层根因**：`fee-accrual.service.settleByTransfer` 把 accrual 推到 SETTLED 后**没调 `batchService.recomputeBatch`**——与其他 6 个 workflow（fiat-settlement / eod / fee-collection 各 2 处）的现有模式不一致，是这条**新加路径**的遗漏。

**traceId 现状**：
- `settlement_batches.traceId` 列**不存在**
- `audit_log_events` 里 INTERNAL_FUND/INTERNAL_TRANSFER 事件 traceId 为空、或拼装 `BATCH:${batchId}` legacy
- 没有 `BATCH_CREATED / BATCH_SUCCEEDED` audit 事件

## 顶层设计

> 底层逻辑：**settlement_batch 是 settlement 域的根**（与 swap 之于交易、payin 之于充值同位）。batch UUID 自创建时入表 → 同 batch 的 transfer / leg 继承 → 所有 SETTLEMENT_BATCH audit 显式带 → fallback 兜底。recompute 即时主动调（不引入事件驱动），与现有 6 处 workflow 模式拉齐——只补 fee-accrual 这一处遗漏。

### 与历史治本同构

| 维度 | TR (deposit/payin) | SW Spec #1 (swap) | 本轮 (settlement) |
|---|---|---|---|
| 域根 | payin | quote | settlement_batch |
| 入口 | createDetected | createQuote | createBatch |
| 入口 UUID | ✓ | ✓ | ✓ |
| 下游继承 | deposit ← payin | swap ← quote | tx ← batch |
| 终态 audit | payin updateStatus | swap succeeded/failed | batch succeeded |
| fallback 函数 | buildDepositTraceId | buildSwapTraceId | **buildSettlementTraceId** |

## 数据流（治本后）

```
1. createBatch({ cutoffAt, category, settlementType, ... })
   batch.traceId = randomUUID()
   audit BATCH_CREATED  traceId=<UUID>  entityType=SETTLEMENT_BATCH

2. createTransfer({ ..., settlementBatchId: batch.id })
   若调用方未传 input.traceId → 从 batch 表查 batch.traceId
   transaction.traceId = batch.traceId
   （internal_funds 继承自 transaction，audit 时由 fallback 接住）

3. settleByTransfer (fee-accrual) — **治本核心**
   ...accrual.update SETTLED 完成后...
   await this.batchService.recomputeBatch(transfer.settlementBatchId, tx)
   ↓
   recomputeBatch:
     ① 查 transfers/outstandings/feeAccruals
     ② 数 settled / total
     ③ 计算 allDone → status='SUCCESS' or 'PROCESSING'
     ④ batch.update {status, 各计数器, completedAt}
     ⑤ 如果 status 首次进 SUCCESS → audit BATCH_SUCCEEDED traceId=<UUID>

4. 现有 6 处 recomputeBatch 调用点
   同样的"首次进 SUCCESS 时 audit"逻辑 — 由 recomputeBatch 自己负责（不在调用方）

5. fallback (audit-logs.service)
   resolveSettlementWorkflowContext:
     input.traceId > batch.traceId > legacy `BATCH:${batchId}` > null
```

## 改动颗粒度（约 4 文件 + 1 迁移、~30 行净改）

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | `SettlementBatch` model 加 `traceId String?` |
| 新迁移 `<ts>_settlement_batch_trace_id` | `ALTER TABLE settlement_batches ADD COLUMN traceId TEXT;` |
| `src/modules/funds-layer/domain/settlement-batch.service.ts` | (1) `createBatch` 生成 `randomUUID()` 入表 + audit `BATCH_CREATED`；(2) `recomputeBatch` 内部判定旧 status≠SUCCESS && 新 status==SUCCESS → audit `BATCH_SUCCEEDED` |
| `src/modules/funds-layer/domain/internal-transfer.service.ts` | `createTransfer` 当调用方未传 traceId 且有 settlementBatchId → 从 batch 表查 traceId、写入 transaction.traceId |
| `src/modules/funds-layer/domain/fee-accrual.service.ts` | `settleByTransfer` 末尾加 `await this.batchService.recomputeBatch(transfer.settlementBatchId, tx)`（治本一行）|
| `src/modules/audit-logging/audit-logs.service.ts` | 新增 `buildSettlementTraceId(batch?)` 方法；改 `resolveSettlementWorkflowContext`（或对应 swap workflow 分支邻位）调用它；SELECT 子句补 `traceId: true` |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | 加 `BATCH_CREATED`、`BATCH_SUCCEEDED` |
| `src/modules/audit-logging/constants/audit-entity-types.constant.ts`（若已有）| 加 `SETTLEMENT_BATCH`（若缺）|

## 关键设计抉择（已批准）

### ✅ recompute 触发：在 settleByTransfer 内同事务调
与现有 6 处 workflow 调用 recompute 的模式一致；颗粒度 +1 行；架构不引入事件驱动新范式；治本+收尾一并完成。

### ✅ BATCH_SUCCEEDED audit 触发：只在首次进 SUCCESS 时发
- 不是每次 recomputeBatch 都 audit（绝大多数 recompute 不改变 status，仅刷新 counters；记 audit 是噪音）
- 判定方式：recomputeBatch 先 SELECT 现 status、计算新 status；新 status='SUCCESS' && 旧 status!='SUCCESS' → 发 audit；否则不发
- BATCH_CREATED 在 createBatch 时发一次

### ✅ recompute audit 由 recomputeBatch 自己负责
不在 6 处调用方分别埋点——降低遗漏风险（与本轮的 fee-accrual 漏 recompute 同类教训）

### ❌ 暂不做
- `BATCH_RECOMPUTED` 每次都记（用户已确认不做）
- `BATCH_FAILED` audit（batch 失败语义 = 任一 transfer 失败，是 transfer 级，不是 batch 级）—— Spec #5
- Outstanding/FeeAccrual 双 traceId 字段 & created/locked/settled audit —— Spec #3
- INTERNAL_FUND/INTERNAL_TRANSFER audit 改名 + 删重复 —— Spec #4
- 历史 batch.traceId 回填

## 验收

### 静态
- `npx jest` 0 failed
- `npm run build` + admin `tsc --noEmit` 0 error

### Live（本轮：法币侧足以验证）
- `dev:reset:branch` → sim-deposits-only → sim-swaps-only
- SQL 实证：
  ```sql
  SELECT category, status, COUNT(*)
  FROM settlement_batches
  GROUP BY category, status;
  -- 期望：PRINCIPAL FIAT_SWAP SUCCESS 10；SWAP_FEE FIAT_SWAP SUCCESS 5
  --      （SWAP_FEE 不再卡 CREATED）
  ```
- batch.traceId 非空、与 internal_transactions.traceId 一致：
  ```sql
  SELECT b.batchNo, b.traceId AS batch_traceId, it.traceId AS tx_traceId
  FROM settlement_batches b
  JOIN internal_transactions it ON it.settlementBatchId = b.id
  WHERE b.createdAt > datetime('now','-1 hour') LIMIT 3;
  -- batch.traceId == tx.traceId（继承生效）
  ```
- audit_log_events 含 `BATCH_CREATED` + `BATCH_SUCCEEDED` 各 N 条（N=15，10 PRINCIPAL + 5 SWAP_FEE）

### Spec #3 留验
- 虚拟币 EOD 链（USDT outstanding + crypto SWAP_FEE/WITHDRAW_FEE EOD batch）→ 在 Spec #3 引入 Outstanding/FeeAccrual 双 traceId 后一并跑全链 verify

## 非目标

- ❌ 不动 Outstanding/FeeAccrual 表结构（无新列）
- ❌ 不改任何现有 batch status 状态机定义（SUCCESS/PROCESSING/CREATED 语义不变）
- ❌ 不改 6 处现有 workflow 调用 recompute 的位置（保留）
- ❌ 不动 internal_funds 表的 traceId（leg 通过 transaction 取，无需独立字段）
- ❌ 不引入事件驱动（保持 workflow 直接调 recompute 的现有模式）
- ❌ 不回填历史 batch.traceId / 不动历史 audit 行

## TDD 覆盖（plan 阶段细化）

1. createBatch：生成 UUID + 入表 + audit BATCH_CREATED 带 traceId
2. createTransfer：当 settlementBatchId 给定且 input.traceId 未传 → tx.traceId = batch.traceId
3. fee-accrual.settleByTransfer：调用 recomputeBatch（mock 验证 +1 调用）
4. recomputeBatch：旧 status='CREATED' + 全部 settled → 写 status='SUCCESS' + 发 audit BATCH_SUCCEEDED
5. recomputeBatch：旧 status='SUCCESS' + 仍全部 settled → **不再发** audit（防重）
6. recomputeBatch：未达 allDone → status='PROCESSING'，不发 audit
7. audit-logs.buildSettlementTraceId：fallback 顺序 input > batch > legacy > null

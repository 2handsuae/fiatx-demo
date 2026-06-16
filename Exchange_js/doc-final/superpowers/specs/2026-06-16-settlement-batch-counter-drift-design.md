# Spec #7 — Settlement Batch Counter Drift 治本

**日期**：2026-06-16
**范围**：让 `settle` 类方法在自己内部紧跟 `recomputeBatch`，不再依赖 caller。
**前序**：Spec #6（swap fee 并行结算）已交付，暴露出 `settle` 类方法 caller 漏 recomputeBatch 的实际影响。

---

## 1. 问题陈述（铁证）

### 1.1 真实数据 drift（实测 DB）

```sql
-- 实测 OSB2606169242 / OSB2606161741（Spec #6 后新建 EOD batch）
batchNo          category      status   totalFeeAccrualCount   actual_fee_rows
OSB2606169242    SWAP_FEE      CREATED  0                       2  ← drift
OSB2606161741    WITHDRAW_FEE  CREATED  0                       1  ← drift

-- 实测 OSB2606163819 / OSB2606168901（principal 链）
batchNo          status       totalOutstandingCount  settledOutstandingCount  实际 outstanding 状态
OSB2606163819    PROCESSING   1                       0                         SETTLED  ← drift
OSB2606168901    PROCESSING   1                       0                         SETTLED  ← drift
```

**4 个 batch 的 counter 与实际行数严重不一致**。admin UI 拿 stale counter、Settlement Context "Outstanding Settled: 0/1" 与"实际已结清"矛盾。

### 1.2 根因定位

`recomputeBatch` 是 batch counter + status 的唯一刷新入口（settlement-batch.service.ts:122）。当前**依赖 caller 调用**、共 8 个调用点：

```
eod-settlement-workflow:128 / :204
fiat-settlement-workflow:121 / :170
fee-collection-workflow:138 / :156
fee-accrual.service:339 (settleByTransfer 内)
+ 1 个铁定缺漏：fee-accrual.service.settle() 末尾
```

**漏点 1（铁证）**：`fee-accrual.service.ts:237` createBatch + `:276` 翻 LOCKED + 绑 batch 后**直接 return**——**没有 recomputeBatch**。结果：
- 新建 batch 的 counter 永远是初始化 0
- batch.status 永远 CREATED（没机会推进 PROCESSING）

**漏点 2（race condition）**：`outstanding-consumer.service.ts:171` settleByTransfer 翻 SETTLED + caller 在 listener 内调 recomputeBatch——但 listener catch P1008 时漏跑（backlog B1 SQLite 锁导致 listener tx 5s 超时），caller-side recomputeBatch 没执行完。

**漏点 3（同 2）**：`outstanding-consumer.service.ts:243` markSettledNettedZero 同样依赖 caller。

### 1.3 UX 衍生 bug

`SettlementDetailPage.tsx:261` "Run EOD Settlement" 按钮放在 batch 详情页右上、看起来像"针对这个 batch"，实际 API 调的是全局 EOD（`/admin/funds-layer/settlements/run`）。用户操作语义错位、点了之后影响全局而非本 batch。

---

## 2. 顶层设计

**底层逻辑**：状态改变与 counter 刷新必须 **同一段代码、同一事务、同步执行**。让 settle 类方法承担 recomputeBatch 责任、不再依赖 caller 兜底。

**抓手**：
1. 把 recomputeBatch 内置到 3 个 settle 方法末尾（同 tx）
2. 删 SettlementDetailPage 上误导的 "Run EOD" 按钮（保留 SettlementListPage 上正确位置那个）

**闭环边界**：
- ✅ 做：3 处 settle 内部加 recomputeBatch + 1 处 admin UI 按钮删除
- ❌ 不做：动 caller 的现有 recomputeBatch 调用（保留为防御性双调用、recomputeBatch 幂等）
- ❌ 不做：recomputeBatch 内部计算逻辑（已正确、line 122-200）
- ❌ 不做：修复 P1008 SQLite 锁竞争（backlog B1、单独一轮）
- ❌ 不做：动 settlement_batch schema

---

## 3. 改动清单（4 文件、4 任务）

### 3.1 改动表

| # | 文件 | 行号 | 操作 | 净行数 |
|---|---|---|---|---|
| T1 | `src/modules/funds-layer/domain/fee-accrual.service.ts` | settle 方法末尾（line ~290）| 按 group 聚合 batchId、循环调 `recomputeBatch(batch.id, tx)` | +6 |
| T2 | `src/modules/funds-layer/domain/outstanding-consumer.service.ts` | settleByTransfer 末尾（line ~200）| 按 outstanding.settlementBatchId 去重、循环调 recomputeBatch | +8 |
| T3 | `src/modules/funds-layer/domain/outstanding-consumer.service.ts` | markSettledNettedZero 末尾（line ~250）| 按 settlementBatchId 调 recomputeBatch | +6 |
| T4 | `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx` | line 244-262 | 删 "Run EOD Settlement" 按钮 + 关联 state（`running`、`runError`、`handleRun`） | -28 |

**总计**：~50 行（含测试）。

### 3.2 fee-accrual.service.settle 改后关键段

```ts
// 现有：line 237-281（loop per group, create batch, create transfer, flip LOCKED）
//      ... loop body ...

// 新增（loop 结束后）：
for (const batchId of createdBatchIds) {
  await this.batchService.recomputeBatch(batchId, tx);
}
```

> `createdBatchIds` 在 loop 内收集每轮 `batch.id`。

### 3.3 outstanding-consumer.service.settleByTransfer 改后关键段

```ts
// 现有：line ~171 updateMany 翻 SETTLED
//      ... 现有 audit 循环 ...

// 新增（方法末尾、return 之前）：
const batchIds = new Set<string>();
for (const row of rows) {
  if (row.settlementBatchId) batchIds.add(row.settlementBatchId);
}
for (const batchId of batchIds) {
  await this.batchService.recomputeBatch(batchId, tx as any);
}

return result;
```

> `rows` 是方法开头查的"将要被 SETTLED 的 outstanding"列表（line 159-167 已有）。

### 3.4 SettlementDetailPage 删除范围

删除 `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx`：
- line 62-63 `const [running, setRunning]` + `const [runError, setRunError]`
- line 92-111 `const handleRun = async () => {...}`
- line 244-262 "Run EOD Settlement" 按钮 + 错误显示
- 顶部 import：相关 lucide 图标（如 `Play`）若仅此处用到一并删

保留 SettlementListPage 上的 Run EOD（位置正确）。

---

## 4. 测试覆盖（TDD）

| # | 测试文件 | 验证 |
|---|---|---|
| 1 | `fee-accrual.service.spec.ts` settle 测试 | settle 调用后 `batchService.recomputeBatch` 被调（按 group 数量、Mock 验证） |
| 2 | `outstanding-consumer.service.spec.ts` settleByTransfer 测试 | recomputeBatch 被调、按 distinct batchId 调一次 |
| 3 | `outstanding-consumer.service.spec.ts` markSettledNettedZero 测试 | 同上 |
| 4 | `SettlementDetailPage.tsx` 渲染（admin tsc 0 错） | 删除后 tsc 不报错（state/handler 同步删干净） |

---

## 5. 验收（Live Recon）

跑 1 笔 USDT→AED swap + 1 笔 USDT withdraw + 1 次 EOD + 推所有 fee/principal transfer hop CLEAR 后：

### 5.1 SQL ① — counter 与实际一致

```sql
SELECT s.batchNo, s.category, s.status, s.totalOutstandingCount,
       (SELECT COUNT(*) FROM outstandings WHERE settlementBatchId=s.id) AS actual_out,
       s.totalFeeAccrualCount,
       (SELECT COUNT(*) FROM fee_accruals WHERE settlementBatchId=s.id) AS actual_fee
FROM settlement_batches s
WHERE s.createdAt > datetime('now','-1 hour');
-- 期望：每行 totalOutstandingCount = actual_out 且 totalFeeAccrualCount = actual_fee
```

### 5.2 SQL ② — 全 SETTLED 时 batch 必 SUCCESS

```sql
SELECT s.batchNo, s.status, s.category
FROM settlement_batches s
WHERE s.createdAt > datetime('now','-1 hour')
  AND NOT EXISTS (
    SELECT 1 FROM outstandings o WHERE o.settlementBatchId=s.id AND o.status != 'SETTLED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM fee_accruals f WHERE f.settlementBatchId=s.id AND f.status != 'SETTLED'
  );
-- 期望：所有结果行 status='SUCCESS'（不再有 PROCESSING/CREATED）
```

### 5.3 admin UI 验证

- 打开 SettlementDetailPage（任一 batch）→ 详情页右上无 "Run EOD Settlement" 按钮
- 打开 SettlementListPage → PageTitleBar 仍有 "Run EOD Settlement" 按钮、点击触发全局 EOD（行为不变）
- 任一 batch 全 SETTLED 后、详情页显示 status=SUCCESS、Settlement Context "Outstanding Settled" 数字准确

---

## 6. 不做（YAGNI）

- ❌ 不删 caller 端原有 recomputeBatch 调用（防御性双调用、recomputeBatch 幂等）
- ❌ 不动 recomputeBatch 内部聚合逻辑（已正确）
- ❌ 不动 settle 方法签名 / 事务边界
- ❌ 不动 settlement_batch schema
- ❌ 不修 P1008 SQLite 锁竞争（backlog B1、单独 spec）
- ❌ 不新增 reconciliation cron job（Option B 路径）
- ❌ 不重构 settle hook 生命周期（Option C 路径）

---

## 6.1 Backlog B2 — Listener 弹性（**Spec #8 候选**）

**发现时机**：Spec #7 闭环后做 5-customer demo seed、4 笔 swap 在 200ms 内连发、Grace SWP2606160102 的 fiat-settlement-workflow.onSwapSucceeded 被 SQLite 写锁 race 吃掉。

**铁证**（同一根因、多个 listener 都中招）：
- `fiat-settlement-workflow.onSwapSucceeded`：4 swap 中 Grace 失败（fiat OUT 没 LOCK + 孤儿 batch）
- `fee-accrual-listener.onSwapSucceeded`：Grace 的 SPREAD fee_accrual 缺失
- `withdraw-workflow.handleWithdrawalCreated`：8 withdrawal 中 3 笔卡 CREATED 没推到 PENDING_COMPLIANCE
- 共同模式：高并发 emit、listener async 处理、SQLite 单写锁/外部 API 抢资源、catch 吞错没重试
- 手动重调 listener 方法 + idempotency latch 都能补救

**代码瑕疵**（`src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:46-130`）：
1. listener 不在 `prisma.$transaction` 里 — 4 listener 各自竞争 SQLite 单写锁
2. `try-catch` 吞错只 `logger.error` — 没重试机制
3. 注释承诺"OPEN fiat outstandings remain as durable work items for the backstop" — 但 backstop service 在代码里不存在
4. **副症状：孤儿 batch** — listener 抛错时 `createBatch` 已落地、整段不回滚（不在 $transaction 内），留下 0 outstanding / 0 fee 的孤儿 batch（如 OSB2606165606）

**治本路径**（3 选 1、留给 Spec #8）：
- A：实现 backstop service — cron 定期扫 OPEN+超时未 LOCK 的 fiat outstanding、自动调 listener；同 cron GC 1h+ 未绑任何东西的 CREATED batch（孤儿 batch 清理）
- B：listener 内层包 `prisma.$transaction` + 合理重试 — 抛错时 batch 创建一并回滚、彻底避免孤儿 batch
- C：transactional outbox 模式 — 把 swap 写入 outbox 表、worker 重试

**暂时规避**：sim 脚本每笔 swap 之间 `sleep(2000)`，让 listener 跑完才下一笔。

## 7. 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| 源头 vs 补丁 vs 重构 | 源头治本 | settle 是状态改变的唯一入口、紧跟 recomputeBatch 最简洁。补丁延迟刷新、重构改动过大 |
| 是否删 caller 现有 recomputeBatch | 不删 | 防御性双调用、recomputeBatch 幂等不会出错 |
| fee-accrual.settle 内 recomputeBatch 调一次 vs per group | per group | 一个 settle 调用可能跨多 asset → 多 batch、每个 batch 都要刷新 |
| outstanding-consumer recomputeBatch 去重 | 用 Set 收集 distinct batchId | 同一 transfer 的多个 outstanding 可能共享 batch（聚合一次刷新） |
| Run EOD 按钮全删 vs 只删详情页 | 只删详情页 | 列表页位置正确、保留；详情页位置错、误导用户 |
| 历史 stale batch 是否回填 | 不回填 | 那些是历史 sim 数据、不在 demo 关键路径；下次 EOD 跑时若涉及它们 recomputeBatch 会自动修正 |

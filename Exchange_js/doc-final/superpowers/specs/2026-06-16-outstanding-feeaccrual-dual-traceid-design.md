# Outstanding + FeeAccrual 双 traceId + 全生命周期 audit — 设计

日期：2026-06-16
状态：已确认（用户拍板：方案 A metadata 携带另一根；用 4 个共用短名 created/locked/settled/reopened）

Spec #3（traceId 治本系列第 3 轮：TR(deposit/payin) → SW #1(swap) → ST #2(settlement_batch) → **Outstanding+FeeAccrual 接缝 #3**）

## 背景与根因

实测真证据：
- `outstandings.traceId / fee_accruals.traceId` 列**不存在**
- `audit_log_events` 中 OUTSTANDING / FEE_ACCRUAL 实体**0 条**事件（当前完全没 audit）
- 这两个对象 swap 域创建、settlement 域结算——是两域之间的接缝物，承担"trade 产生 + settlement 消费"双角色

之前三轮治本（TR/SW/ST）已经在两个域各自建立 traceId 根；本轮补齐**接缝物的跨域可追溯性**。

## 顶层设计

> 底层逻辑：**Outstanding/FeeAccrual 是两域之间的接缝物，自身只持 origin 根（trade 时点的传承），settlement 根通过既有的 `settlementBatchId` 关联出来——一字段就够、零冗余漂移。audit 上"一条 row + metadata 携带另一根"，让两边查询都能命中。**

### 与已完成三轮治本同构

| 维度 | TR (deposit/payin) | SW #1 (swap) | ST #2 (settlement) | **#3 (接缝)** |
|---|---|---|---|---|
| 域 | 充值 | 交易 | 结算 | 跨域接缝 |
| 入口 | payin 入表 | quote 入表 | batch 入表 | swap/withdraw 触发 outstanding+accrual 入表 |
| 关键创新 | 入表+继承 | 入表+继承 | 入表+继承 | **metadata 双根携带 + 跨域事件分配规则** |
| 终态 audit | payin.updateStatus | swap.succeeded/failed | batch.succeeded | outstanding/accrual.settled/reopened |

## 字段方案（方案 A）

**只加 1 列**，不冗余存 settlement 侧：

```prisma
model Outstanding {
  ...
  originTraceId String?         // swap.traceId（创建时写入，来自 trade 域）
  // settlementTraceId 不入表 — 通过 settlementBatchId → batch.traceId join 取
}

model FeeAccrual {
  ...
  originTraceId String?         // swap.traceId / withdraw.traceId（创建时写入）
}
```

**为什么不冗余存 settlementTraceId**：`settlementBatchId` FK 已存、batch.traceId 一次 join 就拿到；冗余存反而要在 lockToBatch/settle/reopen 多个时点同步更新、容易漂移。**单字段原则一致。**

## 事件分配规则

5 类事件（其中 1 个不存在）+ 3 种 traceId 主串策略：

| 事件 | 触发时点 | 主串 `traceId` | `metadata` 携带 | 域 |
|---|---|---|---|---|
| **created** | swap/withdraw 成功 | `originTraceId` | — | trade |
| **locked** | batch 锁定时（lockToBatch / lockToTransfer） | `settlementBatch.traceId` | `{ originTraceId }` | settlement |
| **settled** | leg CLEAR 时 | `settlementBatch.traceId` | `{ originTraceId }` | settlement |
| **reopened** | REORG 回退时 | `settlementBatch.traceId` | `{ originTraceId }` | settlement |
| ~~unlocked~~ | — | — | — | (本设计无此事件) |

**主串选择理由**：locked/settled/reopened **发生在 settlement 时点**——settlement 详情页是它们的"自然归宿"，主串 batch.traceId；swap 详情页通过 `metadata.originTraceId = ?` 反查兜底。created 反过来——swap 完成时点、属 trade 域、主串 swap.traceId。

## 数据流

```
1. swap 完成
   outstanding-service.createForSwapSuccess(swap):
     outstanding.originTraceId = swap.traceId
     audit.record({
       entityType:'OUTSTANDING', action:'created',
       traceId: swap.traceId, metadata: {}
     })

2. batch 锁定（消费时）
   outstanding-consumer.lockToBatch(batchId, outstandingIds):
     outstanding.updateMany({ settlementBatchId: batchId, status:'LOCKED' })
     // 取 batch.traceId
     audit.record({
       entityType:'OUTSTANDING', action:'locked',
       traceId: batch.traceId,
       metadata: { originTraceId: outstanding.originTraceId }
     })

3. leg CLEAR
   outstanding-consumer.settle(transferId, fundId):
     outstanding.updateMany({ status:'SETTLED', closedAt:now })
     audit.record({
       entityType:'OUTSTANDING', action:'settled',
       traceId: batch.traceId,
       metadata: { originTraceId: outstanding.originTraceId }
     })

4. REORG 回退
   outstanding-consumer.reopen(...):
     outstanding.updateMany({ status:'OPEN', closedAt:null })
     audit.record({
       entityType:'OUTSTANDING', action:'reopened',
       traceId: batch.traceId,
       metadata: { originTraceId: outstanding.originTraceId }
     })

FeeAccrual 同构（createAccrual/settle/settleByTransfer/reopen）
```

## audit 查询模式

```sql
-- settlement 视角（batch 详情页查 batch 的全部事件，含接缝物）:
SELECT * FROM audit_log_events WHERE traceId = <batch-UUID>;

-- swap 视角（swap 详情页查 swap 的全部事件，含 outstanding/accrual 的 settle）:
SELECT * FROM audit_log_events
WHERE traceId = <swap-UUID>
   OR json_extract(metadata, '$.originTraceId') = <swap-UUID>;
```

前端只需在 swap 详情页加一行 `OR metadata.originTraceId = ?` —— batch 详情页零改动（既有逻辑命中）。

## action 命名

**用 4 个共用短名**（不带 entity 前缀）：
- `created` / `locked` / `settled` / `reopened`

`entityType` 区分是 Outstanding 还是 FeeAccrual。UI 拼出 `OUTSTANDING.created` / `FEE_ACCRUAL.settled` 等。与 SW Spec #1 拍板的"简化命名"路线一致。

> 注：之前 ST Spec #2 用了 `BATCH_CREATED / BATCH_SUCCEEDED` 全拼装名——是因 ST 落地时本路线尚未拍板；后续 Spec #4 会做全仓改名（旧拼装名→短名），届时 BATCH_CREATED 也会改成 `created`、entityType=SETTLEMENT_BATCH 区分。**本轮先按新路线命名、不改 ST 已有的**。

## 改动颗粒度（~6 文件 + 1 迁移、~60 行净改）

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | `Outstanding` + `FeeAccrual` 各加 `originTraceId String?` |
| 新迁移 `<ts>_outstanding_fee_accrual_origin_trace_id` | `ALTER TABLE outstandings ADD COLUMN originTraceId TEXT;` + `ALTER TABLE fee_accruals ADD COLUMN originTraceId TEXT;` |
| `audit-actions.constant.ts` | 加 `OUTSTANDING / FEE_ACCRUAL` 到 `AuditEntityTypes`；加 4 个 `AuditActions`：`CREATED / LOCKED / SETTLED / REOPENED` （值同名小写或大写自由——本轮用大写 `'CREATED'` 等以便 grep）|
| `outstandings.service.ts` `createForSwapSuccess` | 写 `originTraceId = swap.traceId`；audit `OUTSTANDING.CREATED` 用 `traceId = swap.traceId` |
| `outstanding-consumer.service.ts` `lockToTransfer / lockToBatch / settle / reopen` | 4 处补 audit，主串 batch.traceId、metadata 携 originTraceId（需查 outstandings 拿 originTraceId）|
| `fee-accrual.service.ts` `createAccrual` | 接受 originTraceId 参数（从 caller 传入 swap.traceId / withdraw.traceId）；写 originTraceId；audit `FEE_ACCRUAL.CREATED` |
| `fee-accrual.service.ts` `settle` / `settleByTransfer` | 加 audit `FEE_ACCRUAL.LOCKED / SETTLED` |
| `fee-accrual.service.ts` 调用方 `accrueForSwap / accrueForWithdraw` | 传 originTraceId 给 createAccrual |
| `audit-logs.service.ts` | （可选）新增 `buildOutstandingTraceId / buildFeeAccrualTraceId` —— 但 audit 调用全部显式带 traceId，**fallback 不强制**；可推迟到 Spec #5 |

## 暂不做（Spec #4 / #5）

- ❌ 不冗余存 `settlementTraceId` 字段（已通过 settlementBatchId 关联出来）
- ❌ 不发 `unlocked` 事件（当前业务流无 unlock-without-settle 路径）
- ❌ 不写 audit fallback `buildOutstandingTraceId / buildFeeAccrualTraceId`（推迟到 Spec #5——本轮所有 audit 调用都显式带 traceId、不依赖 fallback）
- ❌ 不改 ST Spec #2 已落地的 `BATCH_CREATED / BATCH_SUCCEEDED` 全拼装名（Spec #4 跨域改名一并做）
- ❌ 不动 Outstanding / FeeAccrual UI（前端不在本轮）
- ❌ 不回填历史 `originTraceId`

## 验收

### 静态
- `npx jest` 0 failed
- `npm run build` + admin `tsc --noEmit` 0 error

### Live
- `dev:reset:branch` → sim-deposits-only → sim-swaps-only
- SQL 实证：

```sql
-- ① 每条新 Outstanding/FeeAccrual 都有 originTraceId
SELECT 'outstandings' AS tbl, COUNT(*) AS missing
FROM outstandings WHERE originTraceId IS NULL AND createdAt > datetime('now','-30 minutes')
UNION ALL
SELECT 'fee_accruals', COUNT(*) FROM fee_accruals
WHERE originTraceId IS NULL AND createdAt > datetime('now','-30 minutes');
-- 期望: 0 / 0

-- ② originTraceId == swap.traceId
SELECT o.outstandingNo, substr(o.originTraceId,1,8) AS o_trace,
       substr(s.traceId,1,8) AS s_trace,
       CASE WHEN o.originTraceId = s.traceId THEN 'match' ELSE 'mismatch' END AS r
FROM outstandings o JOIN swap_transactions s ON s.id = o.swapTransactionId
LIMIT 5;
-- 期望: 全 match

-- ③ created 事件主串 swap.traceId
SELECT entityType, action, COUNT(*) FROM audit_log_events
WHERE entityType IN ('OUTSTANDING','FEE_ACCRUAL') AND action='CREATED'
GROUP BY entityType, action;
-- 期望: OUTSTANDING.CREATED N 条 / FEE_ACCRUAL.CREATED N 条（N 与 swap 笔数对齐）

-- ④ settled 事件主串 batch.traceId 且 metadata 含 originTraceId
SELECT entityType, action, traceId,
       json_extract(metadata,'$.originTraceId') AS origin
FROM audit_log_events
WHERE entityType IN ('OUTSTANDING','FEE_ACCRUAL') AND action IN ('LOCKED','SETTLED')
LIMIT 5;
-- 期望: traceId 是 batch UUID 格式；origin 是 swap UUID 格式

-- ⑤ 双向查询都能命中 settled 事件（行业模式实证）
WITH s AS (SELECT id, traceId AS swap_trace FROM swap_transactions ORDER BY createdAt DESC LIMIT 1)
SELECT 'by swap' AS view, COUNT(*) FROM audit_log_events e, s
WHERE entityType='OUTSTANDING' AND (e.traceId = s.swap_trace OR json_extract(e.metadata,'$.originTraceId') = s.swap_trace)
UNION ALL
SELECT 'by batch', COUNT(*) FROM audit_log_events
WHERE entityType='OUTSTANDING' AND action='SETTLED'
  AND traceId IN (SELECT traceId FROM settlement_batches WHERE createdAt > datetime('now','-30 min'));
-- 期望: by swap 数 = by batch 数（双向都命中、A 方案的核心）
```

## 非目标

- ❌ 不引入事件驱动（保持 service 直接调 audit 模式）
- ❌ 不动 audit_log_events 表结构
- ❌ 不动 TR / SW / ST 已落地的 audit 命名（本轮新增 OUTSTANDING/FEE_ACCRUAL 用新短名）
- ❌ 不动前端
- ❌ 不回填历史

## TDD 覆盖（plan 阶段细化）

1. outstanding-service.createForSwapSuccess：写 originTraceId + audit CREATED 主串 swap.traceId
2. outstanding-consumer.lockToBatch：audit LOCKED 主串 batch.traceId + metadata.originTraceId
3. outstanding-consumer.settle：audit SETTLED 主串 batch.traceId + metadata.originTraceId
4. outstanding-consumer.reopen：audit REOPENED 主串 batch.traceId + metadata.originTraceId
5. fee-accrual.createAccrual：写 originTraceId + audit CREATED
6. fee-accrual.settle：audit LOCKED for each accrual
7. fee-accrual.settleByTransfer：audit SETTLED
8. accrueForSwap / accrueForWithdraw：传 originTraceId 到 createAccrual（参数继承）

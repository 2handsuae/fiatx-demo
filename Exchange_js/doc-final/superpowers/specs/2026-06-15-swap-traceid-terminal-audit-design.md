# Swap 域 traceId 治本 + 状态机终态 audit — 设计

日期：2026-06-15
状态：已确认（用户拍板：quote 为源 swap 继承；删 legacy 长字面不留 alias）

Spec #1（Spec #1 + #2 + #3 三轮 traceId 治本系列的首轮）

## 背景与根因

四轮排查 + 真库实证：

1. **`swap.traceId` 列已有**，但 10/10 行都填 legacy `SWAP:<swapNo>` 字面拼装格式，与 deposit/payin 治本（UUID）不同结构。
2. **quote 的 traceId 是 `SWAP:<quote.id>` 字面**，被 swap 引用后两侧 traceId 互不通——audit 串不齐。
3. **swap 状态机 audit 实测仅 `SWAP_CREATED` 一种**（74 条）——无 succeeded/failed/rejected 终态。
4. swap 完成事件在审计页**断头**：QUOTE_CREATED(quote-uuid) → QUOTE_USED(quote-uuid) → SWAP_CREATED(SWAP:swapNo) — 3 段不同 traceId、无法按一根线串。

## 顶层设计

> 底层逻辑：**quote 是 swap 的入口报价单——和 payin 之于 deposit 同构**。quote 创建是业务起点，传入 traceId UUID；swap 引用 quote 时**继承 quote.traceId**；下游 OUT/FAC（Spec #3）再继承 swap.traceId。一根 UUID 贯穿到底。

时序与同构对比：
| 层 | deposit/payin（已做）| swap/quote（本轮）|
|---|---|---|
| 入口（先发生）| payin.createDetected | quote.createQuote |
| 入口生成 UUID | `payin.traceId = randomUUID()` | `quote.traceId = randomUUID()` |
| 下游引用 | deposit.create | swap.executeSwap |
| 下游继承 | `deposit.traceId = payin.traceId` | `swap.traceId = quote.traceId` |
| 终态 audit | payin updateStatus → audit 带 traceId | swap succeeded/failed/rejected 各一处 audit 带 traceId |
| Fallback 顺序 | input > deposit > payin > legacy | input > swap > quote > legacy |

## 数据流（治本后）

```
1. quote 创建
   quote.traceId = randomUUID()
   audit QUOTE.created  traceId=<UUID>

2. swap 创建（execute）
   swap.quote_id = quote.id
   swap.traceId  = quote.traceId        ← 继承（payin←deposit 同方向）
   audit QUOTE.used    traceId=<UUID>
   audit SWAP.created  traceId=<UUID>

3. swap 终态
   audit SWAP.succeeded / SWAP.failed / SWAP.rejected   traceId=<UUID>

4. （quote 未被引用就过期/取消，本轮不触发；留 Spec #5）
   audit QUOTE.cancelled traceId=<quote 自己的 UUID>
```

## 改动颗粒度（4 文件，约 25 行净改）

### Schema：零改动
- `swap_transactions.traceId` 列已有（实施时 grep 验证 `swap_quotes` 也有 traceId 列；若缺、本轮顺带加 — 标注为"实施时验证"）。

### Service 代码：3 处
1. **`swap-quote.service.createQuote`**：生成 `traceId = randomUUID()`、写入 `quote.create` data；audit 显式带 traceId。
2. **`swap-workflow.executeSwap`**（swap 创建处）：
   - 同事务内读 quote → 取 `quote.traceId`
   - 写到 `swap.create` data 的 traceId
   - audit `QUOTE_USED` + `SWAP_CREATED` 都显式带 traceId
3. **swap 终态写入处**（grep `swap.update` 中 `status: 'SUCCESS'` / `'FAILED'` / `'REJECTED'` 的代码路径，每处补一条 audit 显式带 `updatedSwap.traceId`）：
   - SWAP_SUCCEEDED
   - SWAP_FAILED
   - SWAP_REJECTED

### audit-actions 常量：删旧、加新
**删除**（grep 全仓引用清空）：
- `SWAP_PENDING_TO_SUCCESS`
- `SWAP_PENDING_TO_REJECTED`
- `SWAP_PENDING_TO_UNDER_REVIEW`
- `SWAP_UNDER_REVIEW_TO_SUCCESS`
- `SWAP_UNDER_REVIEW_TO_REJECTED`

**新增**：
- `SWAP_SUCCEEDED`
- `SWAP_FAILED`（已存在、保留）
- `SWAP_REJECTED`

> 不保留 alias。本轮直接彻底改干净——历史 audit 行的旧字面字符串保留在 audit_log_events 表里不动（只影响新事件命名）。

### audit-logs.service fallback
- `buildSwapTraceId(swap?, quote?)`（如已存在）调整 fallback 顺序：`input.traceId > swap.traceId > quote.traceId > legacy`。
- 若现有签名只接 id（类似 deposit 治本前），改签名接 swap/quote 完整 object。

## 历史数据处置

**不回填**：
- 10 笔历史 swap 行的 `SWAP:<swapNo>` 仍保留——新创建的 swap 用 UUID。
- 历史 audit_log_events 行的 traceId 字符串保留不动（已冻结）。
- 新流程双轨同 UUID 闭环；按 swapNo 查能跨新老。

## 验收

1. **静态**：`npx jest` 0 failed；`npm run build` + admin `tsc --noEmit` 0 error。
2. **Live**：跑 `sim-swaps-only.ts` → SQL 实证：
   ```sql
   SELECT COUNT(DISTINCT traceId)
   FROM audit_log_events
   WHERE entityId IN (
     SELECT id FROM swap_transactions WHERE swapNo='<SWP…>'
     UNION SELECT quote_id FROM swap_transactions WHERE swapNo='<SWP…>'
   );
   -- 期望 = 1（同一 UUID，3 段断头治愈）
   ```
3. **新事件可见**：`SELECT action FROM audit_log_events WHERE entityType='SWAP_TRANSACTION'` 包含 `SWAP_SUCCEEDED`。

## 非目标

- ❌ 不动 Outstanding/FeeAccrual traceId（Spec #3）
- ❌ 不动 settlement_batch.traceId（Spec #2）
- ❌ 不改 INTERNAL_FUND/INTERNAL_TRANSFER 命名（Spec #4）
- ❌ 不做 quote `SWAP_QUOTE_CANCELLED` 触发（Spec #5）
- ❌ 不做风控分流 `flagged/released` 事件（Spec #5）
- ❌ 不回填历史 swap/quote.traceId 或历史 audit 行
- ❌ 不保留旧长字面常量作为 alias

## TDD 覆盖（plan 阶段细化）

1. quote.createQuote 生成 UUID + 入表 + audit 带 traceId（同 deposit/payin TR-T2 模式）
2. swap.executeSwap 继承 quote.traceId + 入表 + 两条 audit 带 traceId（同 TR-T4 模式）
3. swap 终态触发 SWAP_SUCCEEDED audit 带表中 traceId（同 TR-T3 模式）
4. audit-logs `buildSwapTraceId` fallback 顺序新→旧（同 TR-T5 模式）

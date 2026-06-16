# Swap 域 traceId 治本 + 终态 audit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。复选框 `- [ ]` 跟踪进度。

**Goal:** quote 是源头生成 UUID、swap 创建时继承 quote.traceId；所有 swap+quote audit 共用同一根 UUID；补 SWAP_SUCCEEDED / SWAP_FAILED 终态 audit；删 5 个旧长字面常量。

**Architecture:** 与 deposit/payin 治本（已完成）同构——quote.createQuote 入口生成 UUID 入表 + audit 显式带；swap.executeSwap 读 quote.traceId 写到 swap.traceId + audit 显式带；audit-logs.service 加 `buildSwapTraceId(swap?, quote?)` fallback 按 input > swap > quote > legacy 顺序；终态在 executeSwap 成功路径补 SWAP_SUCCEEDED audit、catch 失败分支补 SWAP_FAILED audit。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest。branch 栈 / DB `/tmp/exchange_js_branch/dev.db`。

**Spec:** `doc-final/superpowers/specs/2026-06-15-swap-traceid-terminal-audit-design.md`

---

## Plan-时发现的 spec 修正（实施时澄清）

1. **swap.status 是一次性事务、hardcode 'SUCCESS'**（`swap-transactions.service.ts:365`）—— 不存在"pending→succeeded"代码路径。SWAP_SUCCEEDED audit **紧邻** SWAP_CREATED 之后触发（同 try 块、不同 action）。
2. **SWAP_REJECTED 当前无触发点**——swap 没有"先 pending 后 reject"路径。本轮**只做 SWAP_SUCCEEDED + SWAP_FAILED 两个**；SWAP_REJECTED 推到 Spec #5（与风控分流 flagged/released 一起接）。
3. **audit-logs.service 当前 fallback 是 inline `SWAP:${swapId}`**（行 625-626），不读 swap.traceId / quote.traceId—— 这是 3 段断头根因。本轮**新增** `buildSwapTraceId(swap?, quote?)` 方法（同 buildDepositTraceId 结构）。
4. **5 个旧常量没生产代码引用**——只在 audit-actions.constant.ts 定义；删除零运行时影响。

---

## 文件结构

- Modify: `prisma/schema.prisma`（`SwapQuote` 加 `traceId String?`）
- Add: `prisma/migrations/<ts>_swap_quote_trace_id/migration.sql`（`ALTER TABLE swap_quotes ADD COLUMN traceId TEXT;`）
- Modify: `src/modules/trading/swap-fee-level/swap-quote.service.ts`
  - `createQuote`：生成 UUID、写入 quote.create data、audit 显式带
- Modify: `src/modules/trading/swap-fee-level/swap-quote.service.spec.ts`（traceId 断言）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
  - `executeSwap`：删 `const traceId = 'SWAP:${swapNo}'`，改读 `quote.traceId`；写到 `swap-transactions.create` data；audit `SWAP_QUOTE_USED` + `SWAP_CREATED` 显式带；补 `SWAP_SUCCEEDED` + `SWAP_FAILED` audit
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（traceId + 终态 audit 断言）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
  - 加 `SWAP_SUCCEEDED`（`SWAP_FAILED` 已存在）
  - 删 5 个旧字面：`SWAP_PENDING_TO_SUCCESS / SWAP_PENDING_TO_REJECTED / SWAP_PENDING_TO_UNDER_REVIEW / SWAP_UNDER_REVIEW_TO_SUCCESS / SWAP_UNDER_REVIEW_TO_REJECTED`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
  - 新增 `buildSwapTraceId(swap?, quote?)` 方法
  - 替换行 625-626 inline 拼装、调用新方法
- Modify: `src/modules/audit-logging/audit-logs.service.spec.ts`（buildSwapTraceId fallback 顺序断言）

---

# Task 1：schema + 迁移（swap_quotes.traceId 列）

**Files:** `prisma/schema.prisma` + 新迁移

- [ ] **Step 1：在 `model SwapQuote {}` 加列**

```prisma
  traceId          String?
```

- [ ] **Step 2：生成迁移（branch DB，纯增量、create-only 先 inspect）**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev --name swap_quote_trace_id --create-only
```
Inspect `prisma/migrations/<ts>_swap_quote_trace_id/migration.sql` — 期望**仅** `ALTER TABLE "swap_quotes" ADD COLUMN "traceId" TEXT;` 或 SQLite RedefineTables（先建 new_swap_quotes、INSERT…SELECT、DROP 老、RENAME）。**任何丢数据的 DROP 都 BLOCKED 上报**。

Apply:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev
```

- [ ] **Step 3：验证**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema swap_quotes" | grep traceId
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM swap_quotes;"
```
Expected: `"traceId" TEXT` 在 schema 内；行数 == 迁移前数。

- [ ] **Step 4：build**

`npm run build 2>&1 | tail -3` → 0 error。

- [ ] **Step 5：commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): swap_quotes.traceId column for audit traceability (additive)"
```

---

# Task 2：swap-quote.createQuote 生成 UUID + audit 带（TDD）

**Files:** `swap-quote.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

读现有 spec 模式，加入 createQuote 段。断言：
- `prisma.swapQuote.create` 调用时 data 含 `traceId` 且匹配 UUID 正则
- `auditLogsService.recordSystem` 调用时 args 含同一 `traceId`

具体测试代码模式参考 `payins.service.spec.ts::createDetected` 的"generates a UUID traceId, persists it..."测试。

- [ ] **Step 2：跑红** → `npx jest swap-quote.service.spec -t "traceId"`

- [ ] **Step 3：实现**（swap-quote.service.ts）

文件顶部加：
```ts
import { randomUUID } from 'crypto';
```

`createQuote` 内、`prisma.swapQuote.create` 之前：
```ts
const traceId = randomUUID();
```

`swapQuote.create({ data: {...} })` 加 `traceId,`。

`auditLogsService.recordSystem({...})` 加 `traceId,`。

- [ ] **Step 4：跑绿** → `npx jest swap-quote.service.spec`

- [ ] **Step 5：commit**

```bash
git add src/modules/trading/swap-fee-level/swap-quote.service.ts \
        src/modules/trading/swap-fee-level/swap-quote.service.spec.ts
git commit -m "feat(traceid): swap-quote.createQuote generates+persists+audits traceId (TDD)"
```

---

# Task 3：swap.executeSwap 继承 quote.traceId + audit 显式带（TDD）

**Files:** `swap-workflow.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

断言：
- `swapTransactionsService.create` 调用时 data 含 `traceId === quote.traceId`
- audit `SWAP_QUOTE_USED` 调用时 args.traceId === quote.traceId
- audit `SWAP_CREATED` 调用时 args.traceId === quote.traceId

mock quote 返回 `{ traceId: 'QUOTE-FROM-TABLE', ... }`，跑后捕获三个调用的 traceId 都等于 `'QUOTE-FROM-TABLE'`。

- [ ] **Step 2：跑红** → `npx jest swap-workflow.service.spec -t "traceId"`

- [ ] **Step 3：实现**（swap-workflow.service.ts:67）

删除：
```ts
const traceId = `SWAP:${swapNo}`;
```
（行 67 legacy 拼装）

替换为：
```ts
// quote is the source of truth — swap inherits its traceId so audit events
// for the same business unit (quote.created + quote.used + swap.created +
// swap.succeeded) all share one UUID. Same shape as deposit←payin.
const traceId = quote.traceId;
```

`swapTransactionsService.create({...})` 已存在 `traceId,`（行 177）——无需再改；只需确保它读的是新值（quote.traceId）。

audit 调用处（SWAP_QUOTE_USED 在 executeSwap 内）+ SWAP_CREATED（行 225 附近）：每处 `recordSystem({...})` args 都已经在事务上下文有 `traceId` 局部变量；显式加 `traceId,` 字段（如果旧代码没传）。

- [ ] **Step 4：跑绿** → `npx jest swap-workflow.service.spec`

- [ ] **Step 5：commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "feat(traceid): swap inherits quote.traceId; all swap+quote audit on one UUID (TDD)"
```

---

# Task 4：补 SWAP_SUCCEEDED + SWAP_FAILED audit（TDD）+ 删旧常量

**Files:** `audit-actions.constant.ts` + `swap-workflow.service.ts` + `.spec.ts`

- [ ] **Step 1：删旧常量 + 加新**

在 `audit-actions.constant.ts`：
- 删除：`SWAP_PENDING_TO_SUCCESS`、`SWAP_PENDING_TO_REJECTED`、`SWAP_PENDING_TO_UNDER_REVIEW`、`SWAP_UNDER_REVIEW_TO_SUCCESS`、`SWAP_UNDER_REVIEW_TO_REJECTED`（行 259-263）
- 新增：`SWAP_SUCCEEDED: 'SWAP_SUCCEEDED'`
- 保留：`SWAP_FAILED` 已存在
- 保留：`SWAP_REJECTED` 由 Spec #5 接（本轮不加）

**双重确认**：grep 全仓 `SWAP_PENDING_TO_*` / `SWAP_UNDER_REVIEW_TO_*` 应为零生产引用——已 plan 阶段实测确认；任何引用要在删除前消化掉。

- [ ] **Step 2：写失败测试**

在 swap-workflow.service.spec.ts 加：
```ts
it('emits SWAP_SUCCEEDED audit after SWAP_CREATED with same traceId', async () => {
  // ... mock plumbing
  await workflow.executeSwap('owner', 'quoteId');
  const succeededCalls = capturedAudit.filter((a: any) => a.action === 'SWAP_SUCCEEDED');
  expect(succeededCalls).toHaveLength(1);
  expect(succeededCalls[0].traceId).toBe('QUOTE-FROM-TABLE');
});

it('emits SWAP_FAILED audit when execution throws', async () => {
  // mock prisma create or TB to throw mid-execution
  // expect catch path to emit SWAP_FAILED
  // ... details depend on existing test plumbing
});
```

- [ ] **Step 3：跑红** → 两个 it 都失败

- [ ] **Step 4：实现**（swap-workflow.service.ts）

`executeSwap` 内、SWAP_CREATED audit 之后（行 225 之后）紧加：
```ts
await this.auditLogsService.recordSystem({
  action: AuditActions.SWAP_SUCCEEDED,
  entityType: AuditEntityTypes.SWAP_TRANSACTION,
  entityId: swap.id,
  entityNo: swap.swapNo,
  entityOwnerType: 'CUSTOMER',
  entityOwnerId: ownerId,
  workflowType: 'SWAP',
  reason: 'Swap completed (atomic SUCCESS)',
  sourcePlatform: 'SYSTEM',
  traceId,
});
```

`executeSwap` 整体外套 try/catch（若已存在则在 catch 内补一条 audit）：
```ts
} catch (err) {
  // best-effort audit: swap may or may not have reached DB depending on stage
  await this.auditLogsService.recordSystem({
    action: AuditActions.SWAP_FAILED,
    entityType: AuditEntityTypes.SWAP_TRANSACTION,
    entityId: null,           // swap may not exist
    entityNo: swapNo,
    entityOwnerType: 'CUSTOMER',
    entityOwnerId: ownerId,
    workflowType: 'SWAP',
    reason: err?.message ?? 'Swap execution failed',
    sourcePlatform: 'SYSTEM',
    traceId,                  // quote.traceId 已读出来、还在作用域
  }).catch(() => undefined);  // 失败时不再抛 audit 错
  throw err;
}
```

实施时核对：当前 `executeSwap` 是否已有 try/catch；若无则**外套一层**包裹 try。`swapNo`/`traceId` 必须在 try 外或 catch 可见。

- [ ] **Step 5：跑绿** → 两个 it 都通过

- [ ] **Step 6：commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "feat(traceid): SWAP_SUCCEEDED/SWAP_FAILED audit + delete legacy SWAP_*_TO_* const (TDD)"
```

---

# Task 5：audit-logs.service fallback 重做（TDD）

**Files:** `audit-logs.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**

在 audit-logs.service.spec.ts 新增：
```ts
describe('buildSwapTraceId fallback ordering', () => {
  it('prefers swap.traceId, then quote.traceId, then legacy SWAP:<id>, else null', () => {
    const svc: any = service;

    // 1) swap.traceId 优先
    expect(svc.buildSwapTraceId(
      { id: 's1', traceId: 'SWAP_T' },
      { id: 'q1', traceId: 'QUOTE_T' },
    )).toBe('SWAP_T');

    // 2) 没 swap.traceId 用 quote.traceId
    expect(svc.buildSwapTraceId(
      { id: 's1', traceId: null },
      { id: 'q1', traceId: 'QUOTE_T' },
    )).toBe('QUOTE_T');

    // 3) 都没退回 legacy SWAP:<swap.id>
    expect(svc.buildSwapTraceId(
      { id: 's1', traceId: null },
      { id: 'q1', traceId: null },
    )).toBe('SWAP:s1');

    // 4) 全空返回 null
    expect(svc.buildSwapTraceId(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2：跑红**

- [ ] **Step 3：实现 buildSwapTraceId**（audit-logs.service.ts）

加方法（紧邻 `buildDepositTraceId`，行 349 附近）：
```ts
private buildSwapTraceId(
  swap?: { id?: string | null; traceId?: string | null } | null,
  quote?: { id?: string | null; traceId?: string | null } | null,
): string | null {
  const swapTrace = this.normalizeOptionalString(swap?.traceId);
  if (swapTrace) return swapTrace;
  const quoteTrace = this.normalizeOptionalString(quote?.traceId);
  if (quoteTrace) return quoteTrace;
  const rootId = this.normalizeOptionalString(swap?.id);
  return rootId ? `${AuditWorkflowTypes.SWAP}:${rootId}` : null;
}
```

替换 fallback 调用点（行 625-626）：
```ts
return {
  traceId:
    this.normalizeOptionalString(input.traceId) ||
    this.buildSwapTraceId(swap, quote),
  workflowType: AuditWorkflowTypes.SWAP,
  entityOwnerNo: resolvedEntityOwnerNo,
};
```

实施时核对：`swap` 和 `quote` 对象在该上下文是否已 DB 查询过且可读到 traceId 列（实测：行 619-620 已用 `swap?.ownerNo` `quote?.ownerNo`——说明对象已有；DB 查询要确保 SELECT 中含 traceId 列，否则补 `select.traceId = true`）。

- [ ] **Step 4：跑绿** + 全量 jest

```bash
npx jest audit-logs.service.spec swap-workflow.service.spec swap-quote.service.spec 2>&1 | tail -10
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
```
Expected: 全绿、0 error。

- [ ] **Step 5：commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts \
        src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(traceid): audit-logs buildSwapTraceId fallback — input > swap > quote > legacy (TDD)"
```

---

# Task 6：live recon 验证

- [ ] **Step 1：终验 + 重启栈**

```bash
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
(cd admin-web && npx tsc --noEmit 2>&1 | tail -3)
npm run dev:stop && nohup npm run dev:start > /tmp/dev-restart-swap.log 2>&1 & disown
sleep 18
for p in 3500 3501 3502 3503; do
  found=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2,$1}' | head -1)
  echo "$p: ${found:-(off)}"
done
```

- [ ] **Step 2：跑 sim-swaps-only（在已有 sim-deposits-only 数据基础上）**

```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-swaps-only.ts > /tmp/swap-trace.log 2>&1
echo "exit: $?"
```

⚠ 注：当前 DB 状态可能与之前 swap 数据冲突（quote/swap 已被引用）—— 若必要，先 `dev:reset:branch` 再依次 `sim-deposits-only` → `sim-swaps-only`。

- [ ] **Step 3：核心 SQL 实证 — swap+quote audit 共享同一 UUID**

```bash
DB=/tmp/exchange_js_branch/dev.db
# 取最新一笔 swap
SWAP_ID=$(sqlite3 $DB "SELECT id FROM swap_transactions ORDER BY createdAt DESC LIMIT 1;")
QUOTE_ID=$(sqlite3 $DB "SELECT quote_id FROM swap_transactions WHERE id='$SWAP_ID';")
echo "swap=$SWAP_ID  quote=$QUOTE_ID"

echo "--- 两表的 traceId 列 ---"
sqlite3 -header $DB "SELECT
  (SELECT traceId FROM swap_quotes WHERE id='$QUOTE_ID') AS quote_traceId,
  (SELECT traceId FROM swap_transactions WHERE id='$SWAP_ID') AS swap_traceId;"

echo "--- audit_log_events 同 swap+quote 实体 ---"
sqlite3 -header $DB "SELECT entityType, action, traceId FROM audit_log_events
  WHERE entityId IN ('$SWAP_ID','$QUOTE_ID')
  ORDER BY occurredAt;"

echo "--- 关键: COUNT(DISTINCT traceId) 应 = 1 ---"
sqlite3 $DB "SELECT COUNT(DISTINCT traceId) FROM audit_log_events
  WHERE entityId IN ('$SWAP_ID','$QUOTE_ID');"

echo "--- SWAP_SUCCEEDED action 应存在 ---"
sqlite3 $DB "SELECT action FROM audit_log_events
  WHERE entityId='$SWAP_ID' AND action='SWAP_SUCCEEDED';"

echo "--- 全部新 swap 都通: COUNT(swap) == COUNT(swap unified-trace) ---"
sqlite3 -header $DB "SELECT
  COUNT(*) AS swaps,
  SUM(CASE WHEN unified=1 THEN 1 ELSE 0 END) AS unified
FROM (
  SELECT s.id,
    CASE WHEN (SELECT COUNT(DISTINCT traceId) FROM audit_log_events WHERE entityId IN (s.id, s.quote_id)) = 1 THEN 1 ELSE 0 END AS unified
  FROM swap_transactions s
  WHERE s.createdAt > datetime('now','-1 hour')
);"
```

Expected:
- quote.traceId == swap.traceId
- audit 同实体 distinct(traceId) = 1
- `SWAP_SUCCEEDED` 出现
- 全部新 swap 100% unified

---

## 验收（Definition of Done）

1. `npx jest` 0 failed；`npm run build` + admin `tsc --noEmit` 0 error
2. 新建一笔 swap：quote + swap 全部 audit_log_events 共用同一根 UUID（Task 6 Step 3 SQL 证）
3. `SWAP_SUCCEEDED` audit 在每笔 swap 后出现一条；故意制造失败时 `SWAP_FAILED` 出现
4. 旧 5 个长字面常量从 `audit-actions.constant.ts` 删干净；grep 全仓零引用
5. 不动其他业务流（deposit/payin/swap-fee-collection/settlement）—— 通过全量 jest 背书

## 非目标

- ❌ 不做 SWAP_REJECTED / 风控分流（Spec #5）
- ❌ 不动 Outstanding/FeeAccrual traceId（Spec #3）
- ❌ 不动 settlement batch traceId（Spec #2）
- ❌ 不改 INTERNAL_FUND/INTERNAL_TRANSFER 命名（Spec #4）
- ❌ 不回填历史 swap/quote.traceId 或历史 audit 行
- ❌ 不保留旧 5 个长字面常量作为 alias

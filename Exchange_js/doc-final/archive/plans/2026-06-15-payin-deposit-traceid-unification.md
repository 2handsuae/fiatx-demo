# Payin + Deposit traceId 拉通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。复选框 `- [ ]` 跟踪进度。

**Goal:** 同一笔 deposit 的所有 audit_log_events（payin + deposit）共用同一根 traceId UUID——payin 为源头，deposit 继承，audit fallback 按新顺序兜底。

**Architecture:** payin 加 `traceId` 列；`createDetected` 入口 `randomUUID()` 入表 + 传给 audit；`updateStatus` audit 用 payin 表中的 traceId；`createFromPayin` 接受可选 `traceId` 入参（来自 payin.traceId）继承到 deposit.traceId；`buildDepositTraceId` fallback 按 `input.traceId > deposit.traceId > payin.traceId > legacy 拼装` 排序。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest。branch 栈 / DB `/tmp/exchange_js_branch/dev.db`。

**Spec:** `doc-final/superpowers/specs/2026-06-15-payin-deposit-traceid-unification-design.md`

---

## 文件结构

- Modify: `prisma/schema.prisma`（`Payin` 加 `traceId String?`）
- Add: `prisma/migrations/<ts>_payin_trace_id/migration.sql`（`ALTER TABLE payins ADD COLUMN traceId TEXT;`）
- Modify: `src/modules/asset-treasury/payins/payins.service.ts`
  - `createDetected`：生成 UUID、`payin.create` data 写 traceId、`recordSystem` 带 traceId
  - `updateStatus`：`recordSystem` 用 `updatedPayin.traceId`
- Modify: `src/modules/asset-treasury/payins/payins.service.spec.ts`（新增 traceId 断言）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
  - `createFromPayin` 加可选 `traceId?` 入参；data 用 `traceId ?? randomUUID()`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
  - `orchestratePayinDetected` 调 `createFromPayin` 时传 `payin.traceId`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
  - `buildDepositTraceId(payin?, deposit?)` 改签名/逻辑（按新顺序兜底）
  - `resolveDepositWorkflowContext` 调用处适配新签名
- Modify: `src/modules/audit-logging/audit-logs.service.spec.ts`（新增 fallback 顺序测试）

---

# Task 1：schema + 迁移（payins.traceId 列）

**Files:** `prisma/schema.prisma` + 新迁移

- [ ] **Step 1：在 `model Payin {}` 加列**

```prisma
  traceId          String?
```

- [ ] **Step 2：生成 + apply 迁移（branch DB，纯增量）**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev --name payin_trace_id --create-only
```
Inspect `prisma/migrations/<ts>_payin_trace_id/migration.sql` — 期望**仅** `ALTER TABLE "payins" ADD COLUMN "traceId" TEXT;`。若 Prisma 在 SQLite 选择 RedefineTables，确认 INSERT…SELECT 完整拷数据、零行丢失（按本仓既有 W3-T1 经验：合理且安全）。**若有任何 DROP 数据/未拷贝行——BLOCKED 上报**。

Then apply:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
  npx prisma migrate dev
```
Expected: 应用成功 + `prisma generate` 自动跑。

- [ ] **Step 3：验证列存在 + 数据未丢**

Run:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema payins" | grep traceId
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM payins;"
```
Expected: `"traceId" TEXT` 在 schema 内；payins 行数 == 迁移前数。

- [ ] **Step 4：build 编译通过**

Run: `npm run build 2>&1 | tail -3`
Expected: 0 error。

- [ ] **Step 5：commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): payins.traceId column for audit traceability (additive)"
```

---

# Task 2：payins.createDetected 生成 traceId 入表 + audit 带（TDD）

**Files:** `src/modules/asset-treasury/payins/payins.service.ts` + `.spec.ts`

- [ ] **Step 1：先写失败测试**（payins.service.spec.ts，已有 `describe('createDetected')`，加 it）

```ts
it('createDetected: generates traceId, persists it, and passes it to audit', async () => {
  // Wire mocks per the file's existing pattern. Capture payin.create + audit args.
  const capturedCreate: any[] = [];
  const capturedAudit: any[] = [];

  const wallet = { id: 'w1', assetId: 'a1', ownerType: 'CUSTOMER', ownerId: 'c1', address: 'addr', iban: null };
  (prisma as any).wallet.findUnique = jest.fn().mockResolvedValue(wallet);
  (prisma as any).payin.create = jest.fn((args: any) => {
    capturedCreate.push(args.data);
    return Promise.resolve({ id: 'p1', payinNo: 'PI1', ...args.data });
  });
  (auditLogsService as any).recordSystem = jest.fn((args: any) => { capturedAudit.push(args); return Promise.resolve(); });

  await service.createDetected({
    assetId: 'a1', toWalletId: 'w1', type: PayinType.CRYPTO, amount: '100',
  } as any);

  expect(capturedCreate).toHaveLength(1);
  expect(capturedCreate[0].traceId).toMatch(/^[0-9a-f-]{36}$/i);   // UUID

  expect(capturedAudit).toHaveLength(1);
  expect(capturedAudit[0].traceId).toBe(capturedCreate[0].traceId);
});
```

- [ ] **Step 2：跑红**

Run: `npx jest payins.service.spec -t "createDetected: generates traceId" 2>&1 | tail -15`
Expected: FAIL（traceId 既不在 data 也不在 audit）。

- [ ] **Step 3：实现**（payins.service.ts:166–246）

在 `createDetected` 内、`payin.create` 之前：
```ts
import { randomUUID } from 'crypto';
// ...
const traceId = randomUUID();
```

在 `payin.create({ data: {...} })`（行 199–218）加：
```ts
  traceId,
```

在 `auditLogsService.recordSystem({...})`（行 232–243）加：
```ts
  traceId,
```

- [ ] **Step 4：跑绿 + 全 createDetected 段**

Run: `npx jest payins.service.spec -t "createDetected" 2>&1 | tail -10`
Expected: PASS（含原有的"emit asynchronously"测试）。

- [ ] **Step 5：commit**

```bash
git add src/modules/asset-treasury/payins/payins.service.ts src/modules/asset-treasury/payins/payins.service.spec.ts
git commit -m "feat(traceid): payins.createDetected generates+persists+audits traceId (TDD)"
```

---

# Task 3：payins.updateStatus audit 用表中 traceId（TDD）

**Files:** 同上

- [ ] **Step 1：写失败测试**

```ts
it('updateStatus: audit carries the payin.traceId from the table', async () => {
  // Use the existing pattern that drives a transition (DETECTED→CONFIRMING via BLOCK for crypto).
  (prisma as any).payin.findUnique = jest.fn().mockResolvedValue({
    id: 'p2', payinNo: 'PI2', status: 'DETECTED', type: 'CRYPTO',
    statusHistory: JSON.stringify([]), amount: '50', ownerId: 'c1',
    toWalletId: 'w1', assetId: 'a1', traceId: 'TRACE-FROM-TABLE',
  });
  (prisma as any).payin.update = jest.fn((args: any) => Promise.resolve({
    id: 'p2', payinNo: 'PI2', status: 'CONFIRMING', type: 'CRYPTO',
    ownerId: 'c1', toWalletId: 'w1', assetId: 'a1', traceId: 'TRACE-FROM-TABLE',
    amount: '50',
  }));
  const capturedAudit: any[] = [];
  (auditLogsService as any).recordSystem = jest.fn((args: any) => { capturedAudit.push(args); return Promise.resolve(); });

  await service.updateStatus('p2', PayinAction.BLOCK);

  expect(capturedAudit).toHaveLength(1);
  expect(capturedAudit[0].traceId).toBe('TRACE-FROM-TABLE');
});
```

- [ ] **Step 2：跑红**

Run: `npx jest payins.service.spec -t "audit carries the payin.traceId" 2>&1 | tail -12`
Expected: FAIL。

- [ ] **Step 3：实现**（payins.service.ts:489–500）

在 `updateStatus` 的 `auditLogsService.recordSystem({...})` 加：
```ts
  traceId: updatedPayin.traceId,
```
（`updatedPayin` 已是 `payin.update` 的返回值，包含全部列。）

- [ ] **Step 4：跑绿 + 全 updateStatus 段**

Run: `npx jest payins.service.spec 2>&1 | tail -10`
Expected: PASS（含原 7 个 updateStatus 测试）。

- [ ] **Step 5：commit**

```bash
git add src/modules/asset-treasury/payins/payins.service.ts src/modules/asset-treasury/payins/payins.service.spec.ts
git commit -m "feat(traceid): payins.updateStatus audit reuses table traceId (TDD)"
```

---

# Task 4：deposit 继承 payin.traceId（TDD）

**Files:**
- `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

- [ ] **Step 1：写失败测试**（deposit-workflow.service.spec.ts，新 describe）

```ts
describe('orchestratePayinDetected — traceId inheritance', () => {
  it('passes payin.traceId to createFromPayin so deposit inherits it', async () => {
    const payinObj = { id: 'p3', amount: '100', assetId: 'a1', toWalletId: 'w1', txHash: null, fromAddress: null, traceId: 'TRACE-FROM-PAYIN' };
    (payinsService as any).findOne = jest.fn().mockResolvedValue(payinObj);
    (depositService as any).findByPayinId = jest.fn().mockResolvedValue(null);
    const captured: any[] = [];
    (depositService as any).createFromPayin = jest.fn((...args: any[]) => {
      captured.push(args);
      return Promise.resolve({ id: 'd3', payinId: 'p3', traceId: args[6] /* see signature below */ });
    });
    (payinsService as any).linkDeposit = jest.fn();

    await (workflow as any).orchestratePayinDetected('p3');

    expect(captured).toHaveLength(1);
    // createFromPayin signature (after this task):
    //   createFromPayin(amount, assetId, toWalletId, txHash?, fromAddress?, payinId?, traceId?)
    expect(captured[0][6]).toBe('TRACE-FROM-PAYIN');
  });
});
```

- [ ] **Step 2：跑红**

Run: `npx jest deposit-workflow.service.spec -t "traceId inheritance" 2>&1 | tail -12`
Expected: FAIL。

- [ ] **Step 3：扩 `createFromPayin` 签名**（deposit-transactions.service.ts:366–410）

```ts
async createFromPayin(
  amount: string,
  assetId: string,
  toWalletId: string,
  txHash?: string,
  fromAddress?: string,
  payinId?: string,
  traceId?: string,   // ← new
) {
  // ...
  const depositNo = generateReferenceNo('DEP');
  const resolvedTraceId = traceId ?? randomUUID();   // ← inherit if given, else fallback
  const created = await (this.prisma as any).depositTransaction.create({
    data: {
      depositNo,
      traceId: resolvedTraceId,
      // ... 其余 data 字段保持
    },
  });
  return created;
}
```

- [ ] **Step 4：调用方传 payin.traceId**（deposit-workflow.service.ts:283–316，`orchestratePayinDetected`）

把 `createFromPayin(payin.amount.toString(), payin.assetId, payin.toWalletId, payin.txHash || undefined, payin.fromAddress || undefined, payin.id)` 改为：

```ts
deposit = await this.depositService.createFromPayin(
  payin.amount.toString(),
  payin.assetId,
  payin.toWalletId,
  payin.txHash || undefined,
  payin.fromAddress || undefined,
  payin.id,
  payin.traceId || undefined,   // ← new
);
```

- [ ] **Step 5：跑绿 + deposit-workflow 全段**

Run: `npx jest deposit-workflow.service.spec 2>&1 | tail -10`
Expected: PASS（包括原 Gate 0 + checkAutoApproval 各 it）。

- [ ] **Step 6：commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "feat(traceid): deposit inherits payin.traceId via createFromPayin (TDD)"
```

---

# Task 5：audit-logs.buildDepositTraceId fallback 顺序（TDD）

**Files:** `src/modules/audit-logging/audit-logs.service.ts` + `.spec.ts`

- [ ] **Step 1：写失败测试**（audit-logs.service.spec.ts，新 it）

```ts
it('buildDepositTraceId returns deposit.traceId first, then payin.traceId, then legacy', () => {
  const svc: any = new AuditLogsService({} as any);   // adapt to actual constructor

  // 1) deposit.traceId 优先
  expect(svc.buildDepositTraceId({ id: 'p1', traceId: 'PAYIN_T' }, { id: 'd1', traceId: 'DEPOSIT_T' }))
    .toBe('DEPOSIT_T');

  // 2) 没 deposit.traceId 用 payin.traceId
  expect(svc.buildDepositTraceId({ id: 'p1', traceId: 'PAYIN_T' }, { id: 'd1', traceId: null }))
    .toBe('PAYIN_T');

  // 3) 都没退回拼装
  expect(svc.buildDepositTraceId({ id: 'p1', traceId: null }, { id: 'd1', traceId: null }))
    .toMatch(/^DEPOSIT:p1$/);

  // 4) 全空返回 null
  expect(svc.buildDepositTraceId(null, null)).toBeNull();
});
```

- [ ] **Step 2：跑红**

Run: `npx jest audit-logs.service.spec -t "buildDepositTraceId returns" 2>&1 | tail -12`
Expected: FAIL（现签名/逻辑不接受 object 参数）。

- [ ] **Step 3：改 `buildDepositTraceId`**（audit-logs.service.ts:349–353）

```ts
private buildDepositTraceId(
  payin?: { id?: string | null; traceId?: string | null } | null,
  deposit?: { id?: string | null; traceId?: string | null; payinId?: string | null } | null,
): string | null {
  const depositTrace = this.normalizeOptionalString(deposit?.traceId);
  if (depositTrace) return depositTrace;
  const payinTrace = this.normalizeOptionalString(payin?.traceId);
  if (payinTrace) return payinTrace;
  const rootId =
    this.normalizeOptionalString(payin?.id) ||
    this.normalizeOptionalString(deposit?.payinId);
  return rootId ? `${AuditWorkflowTypes.DEPOSIT}:${rootId}` : null;
}
```

- [ ] **Step 4：调用方适配**（audit-logs.service.ts:694–700）

```ts
return {
  traceId:
    this.normalizeOptionalString(input.traceId) ||
    this.buildDepositTraceId(payin, deposit),
  workflowType: AuditWorkflowTypes.DEPOSIT,
  entityOwnerNo: resolvedEntityOwnerNo,
};
```

- [ ] **Step 5：跑绿 + 全 audit-logs 段**

Run: `npx jest audit-logs.service.spec 2>&1 | tail -10`
Expected: PASS（含原"derive deposit trace and workflow context"测试——它现在应自动改吃 deposit.traceId）。

> 若原"derive deposit trace…"测试 hardcode 期望了 `DEPOSIT:<id>` 字面值——它就该断在 step 3 后；read 该测试、按本任务设计期望改它（旧字面值 → 真 traceId 或新 fallback 形态）。

- [ ] **Step 6：commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(traceid): audit-logs fallback order — input > deposit > payin > legacy (TDD)"
```

---

# Task 6：全链 live 验证 + 终验

- [ ] **Step 1：全量 jest + build**

Run:
```bash
npx jest 2>&1 | tail -6
npm run build 2>&1 | tail -3
(cd admin-web && npx tsc --noEmit 2>&1 | tail -3)
```
Expected: jest 0 failed；build 0 error；admin tsc OK。

- [ ] **Step 2：重启 branch 栈使新代码生效**

Run:
```bash
npm run dev:stop && npm run dev:start
sleep 12
for p in 3500 3501 3502; do
  found=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $2,$1}' | head -1)
  echo "$p: ${found:-(no listener)}"
done
```
Expected: 3500/3501/3502 LISTEN node。

- [ ] **Step 3：跑 sim-deposits-only.ts 制造一笔新 deposit + payin**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-deposits-only.ts > /tmp/dep-trace.log 2>&1
grep -vE "info\(message_bus|on_recv:|set_and_verify_peer|warning\(message_bus|on_connect" /tmp/dep-trace.log | tail -20
```
Expected: 20 deposits SUCCESS。

- [ ] **Step 4：实证 traceId 拉通**

Run:
```bash
DB=/tmp/exchange_js_branch/dev.db
DEP_ID=$(sqlite3 $DB "SELECT id FROM deposit_transactions ORDER BY createdAt DESC LIMIT 1;")
PAYIN_ID=$(sqlite3 $DB "SELECT payinId FROM deposit_transactions WHERE id='$DEP_ID';")
echo "deposit=$DEP_ID  payin=$PAYIN_ID"
sqlite3 -header $DB "SELECT entityType, COUNT(DISTINCT traceId) AS distinct_traces, MIN(traceId) AS sample FROM audit_log_events WHERE entityId IN ('$DEP_ID','$PAYIN_ID') GROUP BY entityType;"
echo "--- 两组应同一 traceId ---"
sqlite3 $DB "SELECT COUNT(DISTINCT traceId) FROM audit_log_events WHERE entityId IN ('$DEP_ID','$PAYIN_ID');"
echo "--- payin.traceId == deposit.traceId ---"
sqlite3 $DB "SELECT (SELECT traceId FROM payins WHERE id='$PAYIN_ID') AS payin_trace, (SELECT traceId FROM deposit_transactions WHERE id='$DEP_ID') AS deposit_trace;"
```
Expected:
- `DEPOSIT_TRANSACTION` 与 `PAYIN` 两行 `distinct_traces` 都为 1
- 两个 entityType 取并集后 `COUNT(DISTINCT traceId)` = **1**（同一根 UUID）
- payin.traceId == deposit.traceId

- [ ] **Step 5：commit 终验记录（可选；如本任务全绿，不必额外 commit）**

完成。

---

## 验收（Definition of Done）

1. `npx jest` 0 failed；`npm run build` + admin `tsc --noEmit` 0 error。
2. 新建一笔 deposit：deposit + payin 全部 audit_log_events 共用同一 traceId UUID（Task 6 Step 4 SQL 证）。
3. payin 表新增 traceId 列且历史行 NULL；历史 deposit 详情仍可正常加载（fallback 兜底）。
4. 不动其他业务流 traceId（swap/withdraw/internal-fund 验证未受波及——通过 jest 全绿背书）。

## 非目标

- 不回填历史 payin.traceId。
- 不改 audit_log_events schema。
- 不动 UI（traceId 在前端按现有逻辑展示、新流程自动受益）。

# V8 对账 Round 3（驾驶舱+引擎收口+demo 九场景）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `doc-final/superpowers/specs/2026-07-03-recon-cockpit-round3-design.md`——在途识别 + 五桶分类 + run 快照 + case 每钱包唯一 OPEN + 死码清扫 + demo 九场景。

**Architecture:** 检测管线仍是单编排器（WalletReconRunService）：新增第三轮"资金单在途匹配"（跨模块调 FundsOrderService 公开方法）、纯函数桶分类器、run 级钱包快照表（run 详情页只读快照根治历史 run 数字漂移）。旧五公式引擎与其垫片物理删除。demo 改为 9 根因场景注入 + manifest 答案键自验。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + React(admin-web, adm-* tokens) + jest + ts-node 脚本。

**执行约定：**
- 分支：`git checkout -b feat/recon-round3-cockpit`（第一个任务的第一步）
- 每任务收尾必须：`npx tsc --noEmit` 0 错 → commit
- 工作目录一律 `Exchange_js/`；DB/栈用 main 栈（3000-3003）；demo 类脚本经 `bash scripts/on-stack.sh main <script>`
- 前端文案双语，遵循 `admin-web/src/utils/fundsOrderStatusMap.ts` 的 `{en, zh}` / `labelZh+labelEn` 模式
- 任何"改 A 处需与 B 处同口径"的地方（余额检查器 vs 匹配器取数切片），改前先读两文件头部注释

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `prisma/schema.prisma` | Modify | 新表 ReconciliationRunWallet；runs +5 计数列；cases +bucket |
| `src/modules/funds-orders/funds-order.service.ts` | Modify | 新公开方法 `findNonTerminalByWallet` |
| `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts` | Modify | 第三轮在途匹配，结果加 `inTransit[]` |
| `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts` | Create | 纯函数五桶判定 + 恒等式 |
| `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts` | Modify | 快照写入、case 唯一性、无主账户、审计、桶落库 |
| `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` | Modify | getRun 读快照；getCase 加解释五格/观察历史；listCases 加 bucket 筛选 |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Modify | +SYSTEM_RECON_RUN_COMPLETED / SYSTEM_RECON_CASE_AUTO_HEALED |
| `admin-web/src/utils/reconBucketMap.ts` | Create | 五桶双语标签/颜色单一来源 |
| `admin-web/src/pages/ReconciliationRunsDetailPage.tsx` | Modify | 结论条+五桶+三元组+快照明细表 |
| `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` | Modify | 桶徽章+解释五格+观察历史+单表混排 |
| `scripts/recon-demo.ts` | Modify(重写注入段) | 9 场景注入 + manifest v2 + 自验 |
| 旧引擎 11 文件 + 垫片 + adapters | Delete | 见 Task 9 清单 |

---

### Task 1: Prisma 模型（快照表 + 计数列 + bucket 列）

**Files:**
- Modify: `prisma/schema.prisma`（ReconciliationRun ~1704 行、ReconciliationCase ~1728 行附近）

- [ ] **Step 1: 开分支**

```bash
cd Exchange_js && git checkout -b feat/recon-round3-cockpit
```

- [ ] **Step 2: schema 变更**

`ReconciliationRun` 增加列（放在 `demoManifest` 之前）：

```prisma
  walletCount     Int      @default(0)
  matchedCount    Int      @default(0)
  inTransitCount  Int      @default(0)
  softFlagCount   Int      @default(0)
  breakCount      Int      @default(0)
```

`ReconciliationCase` 在 `severity` 后增加：

```prisma
  bucket                    String?  // IN_TRANSIT | SOFT_FLAG | BREAK（Round3 起必填；历史行 null）
```

新模型（放在 ReconciliationLineItem 之后）：

```prisma
model ReconciliationRunWallet {
  id               String   @id @default(uuid())
  runId            String
  walletRef        String
  assetCode        String
  book             String   // CUSTOMER | FIRM
  coaCode          String?
  ownerNo          String?
  bucket           String   // MATCHED | IN_TRANSIT | SOFT_FLAG | BREAK
  internalTotal    Decimal  @default(0)
  externalClosing  Decimal  @default(0)
  deltaAmount      Decimal  @default(0)
  inTransitAmount  Decimal  @default(0) // 签名和：IN 为正 OUT 为负
  matchedCount     Int      @default(0)
  orphanInternal   Int      @default(0)
  orphanExternal   Int      @default(0)
  mismatchCount    Int      @default(0)
  inTransitCount   Int      @default(0)
  caseNo           String?
  createdAt        DateTime @default(now())
  run              ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@unique([runId, walletRef])
  @@index([runId])
  @@map("reconciliation_run_wallets")
}
```

并在 `ReconciliationRun` 加反向关系 `runWallets ReconciliationRunWallet[]`。

- [ ] **Step 3: 迁移 + 生成**

```bash
npx prisma migrate dev --name recon_round3_cockpit && npx prisma generate
```
Expected: 迁移创建成功，无数据破坏（全部是加列/建表）。

- [ ] **Step 4: 验证 + 提交**

```bash
npx tsc --noEmit && git add -A && git commit -m "feat(recon): Round3 schema——run 快照表 + 五桶计数 + case bucket"
```

---

### Task 2: FundsOrderService 新公开查询 `findNonTerminalByWallet`

**Files:**
- Modify: `src/modules/funds-orders/funds-order.service.ts`（`findAllForAdmin` ~185 行之前插入）
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`（若无则新建）

- [ ] **Step 1: 写失败测试**

```ts
describe('findNonTerminalByWallet', () => {
  it('returns only non-terminal orders touching the wallet, with direction', async () => {
    const rows = [
      { id: '1', fundsOrderNo: 'FO-1', status: 'CONFIRMING', fromWalletId: 'W1', toWalletId: 'W2', amount: new Prisma.Decimal(100), netAmount: new Prisma.Decimal(100), txHash: '0xa', referenceNo: null, providerTxnId: null, createdAt: new Date() },
    ];
    prisma.fundsOrder.findMany = jest.fn().mockResolvedValue(rows);
    const out = await service.findNonTerminalByWallet('W1');
    expect(prisma.fundsOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: Array.from(TERMINAL_STATUSES) },
        OR: [{ fromWalletId: 'W1' }, { toWalletId: 'W1' }],
      }),
    }));
    expect(out[0].direction).toBe('OUT'); // fromWalletId === W1
  });
});
```

（prisma mock 写法对齐邻居 spec：先读 `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts` 的 mock 模式。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest funds-order.service --silent 2>&1 | tail -5
```
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现**

```ts
/** Round3 对账在途匹配专用：某钱包上全部非终态资金单（含相对方向）。 */
async findNonTerminalByWallet(walletId: string) {
  const rows = await this.prisma.fundsOrder.findMany({
    where: {
      status: { notIn: Array.from(TERMINAL_STATUSES) },
      OR: [{ fromWalletId: walletId }, { toWalletId: walletId }],
    },
    select: {
      id: true, fundsOrderNo: true, status: true, amount: true, netAmount: true,
      txHash: true, referenceNo: true, providerTxnId: true,
      fromWalletId: true, toWalletId: true, createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    direction: (r.fromWalletId === walletId ? 'OUT' : 'IN') as 'IN' | 'OUT',
  }));
}
```

`TERMINAL_STATUSES` 从 `./constants/funds-order-transitions.constant` import（已有导出）。

- [ ] **Step 4: 测试过 + 提交**

```bash
npx jest funds-order.service --silent && npx tsc --noEmit
git add -A && git commit -m "feat(funds-orders): findNonTerminalByWallet 公开查询（对账在途匹配用）"
```

---

### Task 3: 匹配器第三轮（在途匹配）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`（import FundsOrdersModule）
- Test: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts`

- [ ] **Step 1: 确认跨模块导出**

```bash
grep -n 'exports' src/modules/funds-orders/funds-orders.module.ts
```
Expected: 含 `FundsOrderService`。若无 → 先加导出（一行）。

- [ ] **Step 2: 写失败测试**

```ts
it('third pass: unmatched external line pairs with non-terminal funds order → inTransit bucket', async () => {
  // 外部行：IN 100，ref 0xabc；无任何 POSTED 内部流水
  fundsOrderService.findNonTerminalByWallet = jest.fn().mockResolvedValue([
    { id: 'fo1', fundsOrderNo: 'FO-9', status: 'CONFIRMING', direction: 'IN',
      amount: new Prisma.Decimal(100), netAmount: new Prisma.Decimal(100),
      txHash: '0xabc', referenceNo: null, providerTxnId: null, createdAt: now },
  ]);
  const res = await matcher.matchFlows({ walletRef: 'W1', externalLines: [extLine('IN', 100, '0xabc')], cutoff: now });
  expect(res.inTransit).toHaveLength(1);
  expect(res.inTransit[0].fundsOrderNo).toBe('FO-9');
  expect(res.orphanExternal).toHaveLength(0); // 不再算孤儿
});
it('third pass: no candidate → stays orphanExternal', async () => { /* findNonTerminalByWallet 返回 []，断言 orphanExternal 1 */ });
```

- [ ] **Step 3: 跑测试确认失败**（`npx jest wallet-flow-matcher --silent` → FAIL）

- [ ] **Step 4: 实现第三轮**

`MatcherResult` 增加：

```ts
export interface InTransitMatch {
  externalLineId: string;
  fundsOrderId: string;
  fundsOrderNo: string;
  orderStatus: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}
// MatcherResult 增加 inTransit: InTransitMatch[]
```

构造器注入 `FundsOrderService`。在 Pass 2 之后、Orphans 归集之前插入：

```ts
// ── Pass 3: 在途匹配（剩余孤儿外部行 ↔ 非终态资金单）──────────────
const inTransit: InTransitMatch[] = [];
const leftovers = externalLines.filter((e) => !usedExternal.has(e.id));
if (leftovers.length > 0) {
  const candidates = await this.fundsOrders.findNonTerminalByWallet(walletRef);
  const usedOrders = new Set<string>();
  const H72 = 72 * 60 * 60 * 1000;
  for (const ext of leftovers) {
    const hit = candidates.find((c) =>
      !usedOrders.has(c.id) &&
      c.direction === ext.direction &&
      (ext.amount.equals(c.netAmount) || ext.amount.equals(c.amount)) &&
      Math.abs(ext.datetime.getTime() - c.createdAt.getTime()) <= H72 &&
      (ext.externalRef == null ||
        [c.txHash, c.referenceNo, c.providerTxnId].includes(ext.externalRef) ||
        ![c.txHash, c.referenceNo, c.providerTxnId].some(Boolean)),
    );
    if (!hit) continue;
    usedOrders.add(hit.id);
    usedExternal.add(ext.id);
    inTransit.push({
      externalLineId: ext.id, fundsOrderId: hit.id, fundsOrderNo: hit.fundsOrderNo,
      orderStatus: hit.status, amount: ext.amount.toString(),
      direction: ext.direction as 'IN' | 'OUT', externalRef: ext.externalRef,
    });
  }
}
```

匹配优先级注释写明：单号能对上 > 单号双方缺失时按金额+方向+72h。返回值加 `inTransit`。

- [ ] **Step 5: 测试过 + 提交**

```bash
npx jest wallet-flow-matcher --silent && npx tsc --noEmit
git add -A && git commit -m "feat(recon): 匹配器第三轮——孤儿外部行 ↔ 非终态资金单在途配对"
```

---

### Task 4: 纯函数桶分类器 + 恒等式单测

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts`

- [ ] **Step 1: 写失败测试**（四桶各一例 + 混合钱包 + 恒等式）

```ts
import { computeBucket } from './bucket-classifier';
const cases: Array<[string, Parameters<typeof computeBucket>[0], string]> = [
  ['break: 残差非零', { delta: -600n, inTransitSigned: -100n, inTransitCount: 1, anomalyCount: 3 }, 'BREAK'],
  ['in-transit: 差额被完全解释', { delta: 500n, inTransitSigned: 500n, inTransitCount: 1, anomalyCount: 0 }, 'IN_TRANSIT'],
  ['in-transit: 对冲在途', { delta: 0n, inTransitSigned: 0n, inTransitCount: 2, anomalyCount: 0 }, 'IN_TRANSIT'],
  ['soft-flag: 余额平流水脏', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 2 }, 'SOFT_FLAG'],
  ['matched', { delta: 0n, inTransitSigned: 0n, inTransitCount: 0, anomalyCount: 0 }, 'MATCHED'],
];
it.each(cases)('%s', (_n, input, want) => expect(computeBucket(input)).toBe(want));
it('恒等式：任意输入必落且只落一桶', () => { /* 随机 200 组输入，断言返回值 ∈ 四枚举 */ });
```

- [ ] **Step 2: 确认失败**（模块不存在）

- [ ] **Step 3: 实现**

```ts
export type ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

/** spec §2.2：残差 = delta − Σ在途签名额；命中即止。 */
export function computeBucket(input: {
  delta: bigint;            // external − internal(POSTED)
  inTransitSigned: bigint;  // Σ(在途 IN 为正 / OUT 为负)
  inTransitCount: number;
  anomalyCount: number;     // OI + OE + MM（不含在途行）
}): ReconBucket {
  const residual = input.delta - input.inTransitSigned;
  if (residual !== 0n) return 'BREAK';
  if (input.inTransitCount > 0) return 'IN_TRANSIT';
  if (input.anomalyCount > 0) return 'SOFT_FLAG';
  return 'MATCHED';
}
```

- [ ] **Step 4: 测试过 + 提交**（`npx jest bucket-classifier --silent`；commit `feat(recon): 五桶纯函数分类器`）

---

### Task 5: 编排器集成（快照/唯一性/无主账户/审计/桶落库）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`（import 审计模块）
- Test: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts`（扩展现有）

按顺序改 `run()`（现文件 96-245 行）：

- [ ] **Step 1: 写失败测试**（三个关键行为）

```ts
it('每钱包快照落库：matched 钱包也有 run_wallets 行，bucket 计数与快照聚合一致', ...);
it('case 唯一性跨日：昨日 OPEN case 今日复观察（不新建），firstSeenRunId 不变', ...);
it('无主外部余额头（walletRef null）→ 开 BREAK case + 快照行，不再跳过', ...);
```
（mock prisma + balanceChecker + flowMatcher，样式对齐现有 spec 文件。）

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现——逐点**

1. **取消 walletRef null 过滤**：`externalBalance.findMany` 去掉 `walletRef: { not: null }`；循环里 `walletRef == null` 的头走无主分支：`caseReason='unattributed_external_account'`、case.walletRef = `bal.accountRef`、book='FIRM' 兜底、bucket='BREAK'、跳过 balanceChecker/matcher（无内部面可比），delta = closingBalance。
2. **桶判定**：每钱包聚合 `inTransitSigned/anomalyCount` 调 `computeBucket`；`upsertCaseForWallet` 仅当 bucket ≠ MATCHED 时调用，case data 增加 `bucket`。
3. **case 唯一性**：`upsertCaseForWallet` 探测条件删掉 `businessDate`；`autoHealCases` 的 where 删掉 `businessDate`（保留 `layer: RUN_LAYER`）。
4. **在途 line items**：`writeLineItems` 增加一段（在 mismatch 之后）：

```ts
for (const it of matcherResult.inTransit) {
  lineNo += 1;
  await prisma.reconciliationLineItem.create({ data: {
    caseId, foundByRunId: runId, lineNo,
    matchStatus: 'IN_TRANSIT',
    internalSourceType: 'FUNDS_ORDER',
    internalSourceId: it.fundsOrderId,
    internalSourceNo: it.fundsOrderNo,
    externalTxId: it.externalLineId,
    externalAmount: new Prisma.Decimal(it.amount),
    externalDirection: it.direction,
    walletRef, externalRef: it.externalRef,
  }});
}
```

5. **快照**：循环里每钱包（含 matched、含无主头）push 一条快照行，循环后批量 `createMany` 到 `reconciliationRunWallet`；`finishRun` 增写 `walletCount + 四桶计数`。
6. **审计**：注入 `AuditLogsService`；常量文件加 `SYSTEM_RECON_RUN_COMPLETED` / `SYSTEM_RECON_CASE_AUTO_HEALED`（UPPER_SNAKE、SYSTEM_ 前缀）；case 新开→`recordSystem({action: AuditActions.RECONCILIATION_BREAK, entityType: RECONCILIATION_CASE, traceId: run.traceId, ...})`，auto-heal→`SYSTEM_RECON_CASE_AUTO_HEALED`，run 完成→`SYSTEM_RECON_RUN_COMPLETED`（metadata 带四桶计数）。workflowType 用字典已有 `V8_RECONCILIATION`。禁止 `new`，DI 注入；module import 审计模块（`grep -rn 'AuditLogsService' src/modules/audit-logging --include='*.module.ts'` 确认模块类名与导出）。

- [ ] **Step 4: 测试过**（`npx jest wallet-recon-run --silent` 全绿 + 旧用例不回归）

- [ ] **Step 5: 提交**（`feat(recon): 编排器 Round3——五桶+run 快照+case 跨日唯一+无主账户+审计`）

---

### Task 6: 查询服务改造（快照读 + case 详情增强）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（getRun 172 行 / listCases 213 / getCase 292 / buildAccountStatusTable 463-629）
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`（ReconCaseQueryDto 加 `bucket?`）
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts`

- [ ] **Step 1: 写失败测试**（getRun 从快照表读且不再调 balanceChecker；getCase 返回 `explain` 五格与 `observation` 历史；listCases 支持 bucket 筛选）

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

- `getRun`：钱包表改读 `reconciliationRunWallet.findMany({ where: { runId } })`；summary 直接用 run 行的 `walletCount/matchedCount/inTransitCount/softFlagCount/breakCount` + 三元组 `openedCount/reObservedCount/closedCount`。**删除 read-time 调 balanceChecker/matcher 的 buildAccountStatusTable 路径**（旧 run 无快照行时返回空表 + `legacy: true` 标记，前端显示"历史 run 无快照"）。
- `getCase` 返回体增加：

```ts
explain: {
  internalTotal, externalClosing, delta,
  inTransitSigned,           // Σ在途签名额（从 line items matchStatus=IN_TRANSIT 聚合）
  residual,                  // delta − inTransitSigned
},
observation: {
  firstSeenRunNo, firstSeenAt, lastObservedRunNo, reObservedCount,
  closedByRunNo, ageDays,    // OPEN: 今天 − 首见日
},
bucket,
```
- `listCases`：where 增加 `bucket: q.bucket`（可选）；DTO 加 `@IsOptional() @IsIn(['IN_TRANSIT','SOFT_FLAG','BREAK'])`。
- 流水行返回体：IN_TRANSIT 行带 `fundsOrderNo`（读 internalSourceNo）。

- [ ] **Step 4: 测试过 + 提交**（`feat(recon): 查询服务读快照 + case 解释五格/观察历史 + bucket 筛选`）

---

### Task 7: Run 详情页改版（布局甲）

**Files:**
- Create: `admin-web/src/utils/reconBucketMap.ts`
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（Overview 337-399 → 两模块；表格 443-606 加列）

- [ ] **Step 1: 桶标签单一来源**

```ts
export type ReconBucket = 'MATCHED' | 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';
export const BUCKET_LABELS: Record<ReconBucket, { en: string; zh: string; tone: 'green'|'blue'|'amber'|'red' }> = {
  MATCHED:    { en: 'Matched',    zh: '已匹配', tone: 'green' },
  IN_TRANSIT: { en: 'In-transit', zh: '在途',   tone: 'blue'  },
  SOFT_FLAG:  { en: 'Soft flag',  zh: '软标',   tone: 'amber' },
  BREAK:      { en: 'Break',      zh: '硬断',   tone: 'red'   },
};
```

- [ ] **Step 2: 页面结构改造**（对照 spec §3 六段）

- 结论条（沿用现有 banner 位置）：`{verdict} — {walletCount} 个钱包，{matched} 个平，{inTransit} 笔在途，{softFlag+break} 个需要处理`
- 模块一"本次体检 / Health Check"：五卡（总/四桶），每卡 onClick 设置表格过滤 state（`bucketFilter`）
- 模块二"工单流转 / Case Flow"：三卡（新开 Opened / 复观察 Re-observed / 本次关闭 Closed），点击跳 `/reconciliation/cases?runNo=...`
- 明细表加列：`在途 In-transit`（inTransitAmount，0 显示 `—`）、`Case`（caseNo 深链）；状态列改用 BUCKET_LABELS 四态徽章；行点击保持现有跳 case 行为（matched 行不可点）
- `legacy: true` 的旧 run：明细区显示占位文案"历史 run 无快照数据（Round3 前）/ Legacy run – no snapshot"
- 全局未决数**不加**到本页（spec §3 明确）

- [ ] **Step 3: 渲染验证（截图）**

```bash
bash scripts/stack.sh status   # 确认 main 栈活着；没起则 stack.sh up main
```
用 preview 打开 `http://localhost:3001` → 登录（seed admin）→ 任一 run 详情 → preview 截图对照 spec §3 六段结构（此时数据还没有五桶值，确认布局与空态即可；Task 10 后回归复验数字）。

- [ ] **Step 4: 提交**（`feat(admin/recon): run 详情页 Round3——结论条+五桶+三元组+快照明细表`）

---

### Task 8: Case 详情页改版（布局乙）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（Hero 308-337；Balance 408-468 → 解释五格；Problem Flows 470-589 → 单表混排）

- [ ] **Step 1: 实现四个区块**（对照 spec §4）

- Hero 徽章排：caseNo + 桶徽章（BUCKET_LABELS）+ severity 徽章
- "差额解释 / Delta Explained" 五格：内部 / 外部 / Δ / 在途解释（蓝）/ 未解释残差（红，`explain.residual`）
- "观察历史 / Observation" 横条：`首见 {firstSeenRunNo} → 复观察 ×{n}（最后 {lastObservedRunNo}）→ {仍 OPEN·已挂 {ageDays} 天 | 已关闭 by {closedByRunNo}}`；OPEN 且 ageDays ≥ 2 红色
- 流水单表：类型徽章列用四色（在途蓝/孤儿琥珀/错配红），IN_TRANSIT 行"内部源"列渲染 `<Link to={`/funds-orders/${fundsOrderNo}`}>`（只读深链——先 `grep -n 'funds-orders' admin-web/src/App.tsx` 确认路由真实路径再写）；金额不符行显示 `a ≠ b`；matched 行默认折叠（"显示已匹配 n 行"展开钮）

- [ ] **Step 2: 渲染验证（截图）**——同 Task 7 方式，任一 case 详情页截图对照 spec §4

- [ ] **Step 3: 提交**（`feat(admin/recon): case 详情页 Round3——桶徽章+解释五格+观察历史+单表混排`）

---

### Task 9: 死码清扫（清单先行）

**Files（Delete 候选，先验后删）:**
引擎 11 文件（`engine/` 下）：`balance-snapshot / subledger-inputs / in-transit / balance-recon / match-engine / match-engine-v2 / classifier / anomaly-classifier / internal-actions / leg-projection / drilldown-match`（各 .service.ts + .spec.ts）
外围：`data-source/funds-order-source.repo.ts`、`adapters/mock-external.adapter.ts`、`adapters/external-data.provider.ts`、`constants/reconciliation.constants.ts` 中只服务旧引擎的导出（PAYIN_IN_TRANSIT / PAYOUT_IN_TRANSIT / WITHDRAW_IN_TRANSIT_STATUS / FUNDS_FLOW_IN_TRANSIT 等）
RBAC：`rbac.catalog.ts:310-313` 的 outstandings / fee-accruals 四条 route

- [ ] **Step 1: 清单逐项验引用（防误删 LIVE）**

```bash
for f in balance-snapshot subledger-inputs in-transit balance-recon match-engine match-engine-v2 classifier anomaly-classifier internal-actions leg-projection drilldown-match funds-order-source.repo mock-external.adapter external-data.provider; do
  echo "=== $f ==="; grep -rln "$f" src scripts admin-web/src --include='*.ts*' | grep -v spec | grep -v "$f"
done
```
Expected：每项引用仅剩 `reconciliation.module.ts`（注册处）或互相引用。**发现任何 live 主链路引用 → 停下写进任务备注，不删该项。**

- [ ] **Step 2: 删除 + module/常量/RBAC 清理**

```bash
git rm src/modules/clearing-settle/reconciliation/engine/{balance-snapshot,subledger-inputs,in-transit,balance-recon,match-engine,match-engine-v2,classifier,anomaly-classifier,internal-actions,leg-projection,drilldown-match}.service.ts
git rm src/modules/clearing-settle/reconciliation/engine/*.spec.ts   # 仅被删服务对应的
git rm src/modules/clearing-settle/reconciliation/data-source/funds-order-source.repo.ts
git rm -r src/modules/clearing-settle/reconciliation/adapters
```
- `reconciliation.module.ts`：providers 清到只剩 live 集（QueryService / SweepService / WalletBalanceChecker / WalletFlowMatcher / WalletReconRun + 新增依赖）
- `rbac.catalog.ts`：删 outstandings / fee-accruals 四条 route → `npm run db:base:sync`（**之后重启后端**）
- constants：删无引用导出（删后 grep 确认）

- [ ] **Step 3: 全绿验证**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3 && npx jest --silent 2>&1 | tail -8
```
Expected：tsc 0 错；jest 失败数 = 基线（9 个 pre-existing）± 0，被删 spec 从统计消失。

- [ ] **Step 4: 提交**（`chore(recon): Phase C 死码清扫——旧五公式引擎 11 文件+垫片+adapters+RBAC 残留`，commit body 贴 Step 1 验证输出摘要）

---

### Task 10: recon-demo 重写（9 场景 + manifest v2 + 自验）

**Files:**
- Modify: `scripts/recon-demo.ts`（重写 Phase 3 `injectAnomalies` 429-727 → `injectScenarios`；扩展 Manifest 类型 76-106；verifyManifest 770-861）

- [ ] **Step 1: Manifest v2 类型**

```ts
interface InjectionV2 {
  scenarioId: 1|2|3|4|5|6|7|8|9;
  rootCause: 'IN_TRANSIT_TIMING'|'FEE_NETTED'|'STATEMENT_MISSING_LINE'|'SCALE_ERROR'
           |'BANK_CHARGE'|'MISSED_DEPOSIT'|'BANK_INTEREST'|'BANK_RETURN'|'ORPHAN_DEPOSIT';
  walletRef: string;            // 场景9 = 无主 accountRef
  expectedBucket: 'IN_TRANSIT'|'SOFT_FLAG'|'BREAK';
  expectedLineType: 'IN_TRANSIT'|'AMOUNT_MISMATCH'|'ORPHAN_INTERNAL'|'ORPHAN_EXTERNAL';
  amount: string;
  externalRef: string | null;
  fundsOrderNo?: string;        // 场景1
}
```

- [ ] **Step 2: 逐场景注入实现**（挑选钱包规则：从 planWallets 产出的干净钱包池顺序领取，5+7 共用一个 FIRM 钱包；金额用固定质数便于肉眼排查：`101 / 97 / 89 / 8300(83×100) / 200 / 61 / 200 / 53 / 47`）

| # | 实现要点 |
|---|---|
| 1 | prisma 直造一张挂在既有 withdraw 交易上的 FundsOrder（`attempt` 递增避开唯一约束，status='CONFIRMING'，referenceNo=`DEMO-IT-…`，txHash=fakeChainTxHash()）+ 外部行同 txHash 同额；**不动 TB** |
| 2 | 选一笔既有 POSTED 提现流水，外部行金额写 `净额−手续费差` 同 externalRef |
| 3 | writeMirror 后删掉某钱包一条外部行，**closing 同步减**（保持头行自洽，让缺失反映到余额） |
| 4 | 选一行外部行金额 ×100，closing 同步调整 |
| 5 | FIRM 钱包外部加一行 OUT 200 `BNKFEE-…`，closing −200 |
| 6 | 客户钱包外部加一行 IN 61（fakeChainTxHash），closing +61 |
| 7 | 与 5 同钱包外部加一行 IN 200 `INTEREST-…`，closing +200（与 5 抵消 → closing 净不变 → soft-flag） |
| 8 | 客户 VIBAN 外部加 IN 53 + OUT 53 退汇行（channelRef 相同），内部只有原 IN → closing 净 −53 于内部 |
| 9 | 写一个全新 external_balances 头：`accountRef='DEMO-ORPHAN-ADDR'`、walletRef=null、closing=47 + 一条 IN 47 行 |

- [ ] **Step 3: 自验重写**

```ts
// 1) 逐条 manifest 断言：case 存在(按 walletRef) + case.bucket == expectedBucket
//    + line item matchStatus == expectedLineType（场景3 断言 ORPHAN_INTERNAL；场景5+7 共享一个 SOFT_FLAG case）
// 2) 恒等式：run.walletCount == matched+inTransit+softFlag+break
//    run.openedCount + run.reObservedCount == (inTransit+softFlag+break 桶钱包数)
// 3) 输出得分表：9/9 PASS 才 exit 0，否则 exit 1 并列出失败项
```

- [ ] **Step 4: reset 模式扩展**：清 `DEMO-IT-` 前缀资金单、`DEMO-ORPHAN-ADDR` 外部头、run_wallets 快照（随 run cascade）

- [ ] **Step 5: 全链路跑通**

```bash
bash scripts/on-stack.sh main recon:demo:reset
bash scripts/on-stack.sh main recon:demo:pass    # Expected: PASS，0 case
bash scripts/on-stack.sh main recon:demo:break   # Expected: BREAK，8 case（6 BREAK+1 IN_TRANSIT+1 SOFT_FLAG），manifest 9/9 PASS
```

- [ ] **Step 6: 提交**（`feat(recon): demo 九场景注入 + manifest 根因答案键 + 恒等式自验`）

---

### Task 11: 终验 + 文档收口

- [ ] **Step 1: 硬闸全跑**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
npx jest --silent 2>&1 | tail -8          # 净新增失败 0
bash scripts/on-stack.sh main recon:demo:break   # 9/9
```

- [ ] **Step 2: UI 截图验收**（不可跳过——curl/tsc 不算数）
break 数据在库 → preview 打开 run 详情（五桶数字 12=5+3+2+2 类比例、三元组、明细表在途列）与 in-transit / soft-flag / break 三种 case 详情页（解释五格、观察历史、在途行资金单深链）各截一图核对 spec §3/§4。

- [ ] **Step 3: 审计验证**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT action, COUNT(*) FROM audit_log_events WHERE workflowType LIKE '%reconciliation%' GROUP BY action;"
```
Expected: RECONCILIATION_BREAK / SYSTEM_RECON_RUN_COMPLETED / SYSTEM_RECON_CASE_AUTO_HEALED 有行。

- [ ] **Step 4: 文档更新**：`doc-final/reference/roadmap.md` V8 节追加 Round3 已交付条目（五桶驾驶舱/在途识别/快照/死码清扫/demo 九场景）；本计划勾选框全勾。

- [ ] **Step 5: 收尾提交**（`docs(roadmap): V8 Round3 交付记录`），走 finishing-a-development-branch 流程定合并方式。

---

## 自审记录

- **Spec 覆盖**：§2.1→Task2+3；§2.2→Task4；§2.3→Task5；§2.4→Task1+5+6；§2.5→Task5；§2.6→Task5+9；§3→Task7；§4→Task8；§5→Task9；§6→Task10；§7→Task11。§8（推单存档）无任务——本期明确不做 ✓
- **占位符**：无 TBD；两处"先 grep 确认再写"为验证步骤非占位
- **类型一致性**：`computeBucket` 签名 Task4 定义、Task5 引用一致；`InTransitMatch.fundsOrderNo` Task3 定义、Task5/6/8 引用一致；`TERMINAL_STATUSES` 用既有导出

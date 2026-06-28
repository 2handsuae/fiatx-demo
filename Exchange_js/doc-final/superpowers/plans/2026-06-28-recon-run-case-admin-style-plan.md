# Recon Run/Case Admin Style 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ReconciliationRuns 与 ReconciliationCases 共 4 个 admin 页面贴齐 [`frontend-admin.md`](../../rules/frontend-admin.md) 规范，全面清除 UUID/内部 id 展示，并修复 recon 模块 5 处 traceId 格式与覆盖违规。

**Architecture:** 后端 → 前端 → traceId → 验收 四个阶段顺序推进。后端先补 read model 字段（walletNo / firstSeenRunNo / lastUpdatedRunNo / linkedRunNo + runNo filter），前端再做 ID→No 替换 + Sidebar 字段对齐 + Hero 合规，traceId 改 randomUUID 是隔离的最后修复。所有改动均按 [2026-06-28 design 文档](../specs/2026-06-28-recon-run-case-admin-style-design.md) 落地。

**Tech Stack:** NestJS 9 + Prisma + SQLite | React 18 + Vite + Tailwind | Node `crypto.randomUUID`

---

## Phase A — 后端 Read Model 补字段

### Task A1: AccountStatusRow DTO 加 `walletNo` 字段 + query service join

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts` (AccountStatusRow interface)
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (getRun 方法或相关 build account status row 函数)
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts`

- [ ] **Step 1: Inspect 现有 getRun 实现，定位组装 AccountStatusRow 的代码块**

Run: `grep -nE "AccountStatusRow|walletRef" src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`

读取行 170-300 区间，确认 row 的拼装位置和 wallets 表 lookup 模式（参考 listCases 在 226-245 的 Map 模式）。

- [ ] **Step 2: 写一个失败 spec**

定位 `reconciliation-query.service.spec.ts`（若不存在则创建）。添加测试：

```typescript
describe('getRun', () => {
  it('returns walletNo for each accountStatusRow when wallet exists', async () => {
    // arrange: seed run + 1 wallet (walletRef=W1, walletNo='WAL-001')
    //          + reconciliation_external_balances + tb_balance with walletRef=W1
    const result = await query.getRun('RUN-2026-0628-001');
    expect(result.accountStatus[0].walletNo).toBe('WAL-001');
  });

  it('returns null walletNo for XREF synthetic walletRefs (retired wallets)', async () => {
    // arrange: seed row with walletRef='XREF:synthetic-id-1'
    const result = await query.getRun('RUN-XREF-CASE');
    const xrefRow = result.accountStatus.find(r => r.walletRef.startsWith('XREF:'));
    expect(xrefRow?.walletNo).toBeNull();
  });
});
```

- [ ] **Step 3: Run spec, expect FAIL**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t 'getRun'`
Expected: FAIL — `walletNo` field absent on returned row.

- [ ] **Step 4: 改 DTO interface**

在 `reconciliation.dto.ts` 的 `AccountStatusRow` interface 加一行（紧跟 `walletRef` 之后）：

```typescript
export interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;          // resolved via wallets table; null for XREF synthetic refs
  walletRole?: string | null;
  // ... rest unchanged
}
```

- [ ] **Step 5: 改 query.service.ts 的 getRun 方法 — 复用 listCases 的 Map 模式**

```typescript
// 在 getRun 方法内,组装 accountStatusRow 数组之前,加入:
const realWalletRefs = rawRows
  .map((r: any) => r.walletRef)
  .filter((w: string | null): w is string => !!w && !w.startsWith('XREF:'));
const wallets = realWalletRefs.length === 0
  ? []
  : ((await this.prisma.wallet.findMany({
      where: { id: { in: Array.from(new Set(realWalletRefs)) } },
      select: { id: true, walletNo: true },
    })) as Array<{ id: string; walletNo: string | null }>);
const walletNoById = new Map(wallets.map((w) => [w.id, w.walletNo]));

// 在 accountStatusRow 拼装处给每行加:
walletNo: walletNoById.get(row.walletRef) ?? null,
```

- [ ] **Step 6: Run spec, expect PASS**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t 'getRun'`
Expected: PASS — both assertions green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "feat(recon): expose walletNo on AccountStatusRow"
```

---

### Task A2: listCases 加 `firstSeenRunNo` + `lastUpdatedRunNo`

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (listCases 方法行 ~213-258)
- Test: 同 A1 spec 文件

- [ ] **Step 1: 写失败 spec**

```typescript
describe('listCases', () => {
  it('joins firstSeenRunId/lastUpdatedRunId → runNo', async () => {
    // arrange: seed 2 runs (RUN-A id=ra runNo='REC-A', RUN-B id=rb runNo='REC-B')
    //          + 1 case with firstSeenRunId=ra, lastUpdatedRunId=rb
    const result = await query.listCases({});
    expect(result[0].firstSeenRunNo).toBe('REC-A');
    expect(result[0].lastUpdatedRunNo).toBe('REC-B');
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

Run: `npx jest -t 'listCases'`

- [ ] **Step 3: 改 listCases — 仿 walletNo 的 Map 模式**

```typescript
// 在 listCases 方法 wallets lookup 块之后,加:
const runIds = Array.from(new Set(
  rows.flatMap((r: any) => [r.firstSeenRunId, r.lastUpdatedRunId])
      .filter((id: string | null): id is string => !!id)
));
const runs = runIds.length === 0
  ? []
  : ((await this.prisma.reconciliationRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, runNo: true },
    })) as Array<{ id: string; runNo: string }>);
const runNoById = new Map(runs.map((r) => [r.id, r.runNo]));

// 在每行返回对象内加两个字段:
firstSeenRunNo: r.firstSeenRunId ? (runNoById.get(r.firstSeenRunId) ?? null) : null,
lastUpdatedRunNo: r.lastUpdatedRunId ? (runNoById.get(r.lastUpdatedRunId) ?? null) : null,
```

- [ ] **Step 4: Run spec, expect PASS**

Run: `npx jest -t 'listCases'`

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "feat(recon): expose firstSeenRunNo/lastUpdatedRunNo on case list"
```

---

### Task A3: getCase 加 `walletNo` / `linkedRunNo` / `slaDeadline` / `book`

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (getCase 方法行 ~260-310)
- Test: 同 A1 spec 文件

- [ ] **Step 1: 写失败 spec**

```typescript
describe('getCase', () => {
  it('returns walletNo + linkedRunNo + slaDeadline + book', async () => {
    // arrange: seed run (id=ra runNo='REC-A')
    //          + wallet (id=W1 walletNo='WAL-001')  
    //          + case (walletRef=W1, lastUpdatedRunId=ra, slaDeadline=2026-07-01, book='CLIENT')
    const result = await query.getCase('CASE-001');
    expect(result.walletNo).toBe('WAL-001');
    expect(result.linkedRunNo).toBe('REC-A');
    expect(result.slaDeadline).toBeTruthy();
    expect(result.book).toBe('CLIENT');
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

Run: `npx jest -t 'getCase'`

- [ ] **Step 3: 改 getCase**

读取现有 getCase 实现（行 260-310 区间），在返回对象增补 4 个字段：

```typescript
// 现有的 walletRef 处可能已经做过 wallets 单条 query,把结果展平:
const wallet = kase.walletRef && !kase.walletRef.startsWith('XREF:')
  ? await this.prisma.wallet.findUnique({ where: { id: kase.walletRef }, select: { walletNo: true } })
  : null;

// linkedRunNo = lastUpdatedRunId ?? openedByRunId 任一非 null 时 join runs
const linkedRunId = kase.lastUpdatedRunId ?? (kase as any).openedByRunId ?? null;
const linkedRun = linkedRunId
  ? await this.prisma.reconciliationRun.findUnique({ where: { id: linkedRunId }, select: { runNo: true } })
  : null;

return {
  ...kase,                // 现有字段保留
  walletNo: wallet?.walletNo ?? null,
  linkedRunNo: linkedRun?.runNo ?? null,
  slaDeadline: kase.slaDeadline,    // 确认 schema 已有此列 — 若无,跳到 Step 3b
  book: kase.book,                   // 同上
};
```

- [ ] **Step 3b (conditional): 若 schema 没有 slaDeadline 列**

Run: `npx prisma migrate dev --name add-case-sla-deadline --create-only`

写迁移：

```sql
-- AlterTable ReconciliationCase
ALTER TABLE "reconciliation_cases" ADD COLUMN "slaDeadline" DATETIME;
```

apply: `npx prisma migrate dev`

回到 Step 3 修代码。

- [ ] **Step 4: Run spec, expect PASS**

Run: `npx jest -t 'getCase returns walletNo'`

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts \
        prisma/  # 若有 migration
git commit -m "feat(recon): expose walletNo/linkedRunNo/slaDeadline/book on case detail"
```

---

### Task A4: ReconCaseQueryDto + listCases 支持 `?runNo` filter

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts` (ReconCaseQueryDto)
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (listCases)
- Test: 同 A1

- [ ] **Step 1: 写失败 spec**

```typescript
describe('listCases with runNo filter', () => {
  it('filters by runNo (matching firstSeenRunId OR lastUpdatedRunId)', async () => {
    // arrange: 2 runs, 3 cases — 1 case touched by RUN-A, 1 by RUN-B, 1 by both
    const result = await query.listCases({ runNo: 'REC-A' });
    expect(result.length).toBe(2);  // case-A and case-both
    expect(result.every(c => c.firstSeenRunNo === 'REC-A' || c.lastUpdatedRunNo === 'REC-A')).toBe(true);
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

Run: `npx jest -t 'runNo filter'`

- [ ] **Step 3: 改 DTO**

```typescript
export class ReconCaseQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
  @IsOptional() @IsString() runNo?: string;  // NEW: filter to cases touched by a specific run
}
```

- [ ] **Step 4: 改 listCases**

```typescript
async listCases(q: { status?: string; assetCode?: string; runNo?: string }) {
  // 先把 runNo → runId 解析
  let runIdFilter: string | undefined;
  if (q.runNo) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { runNo: q.runNo }, select: { id: true },
    });
    if (!run) return [];  // unknown run = empty list
    runIdFilter = run.id;
  }
  
  const where: any = {};
  if (q.status && q.status !== 'ALL') where.status = q.status;
  if (q.assetCode) where.assetCode = q.assetCode;
  if (runIdFilter) {
    where.OR = [
      { firstSeenRunId: runIdFilter },
      { lastUpdatedRunId: runIdFilter },
    ];
  }
  
  const rows = await this.prisma.reconciliationCase.findMany({ where, orderBy: ... });
  // ... 后面 wallet/run join 逻辑不变
}
```

- [ ] **Step 5: Run spec, expect PASS**

Run: `npx jest -t 'runNo filter'`

- [ ] **Step 6: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "feat(recon): support ?runNo filter on case list"
```

---

## Phase B — 前端 4 个页面贴齐规范

### Task B1: CasesList — 删 shortId 工具 + 列展示业务 No

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`

- [ ] **Step 1: 读 ReconciliationCasesListPage.tsx 整文件**

确认 shortId 函数（行 53）+ firstRunShort/lastRunShort 变量（行 233-234）+ 列展示（行 307 + 320）+ row type（行 24-50 区间）位置。

- [ ] **Step 2: 改 row interface — 加 firstSeenRunNo / lastUpdatedRunNo**

在 ReconciliationCase 行 type 内（约行 24-50），增补两字段：

```typescript
interface ReconciliationCase {
  id: string;
  caseNo: string;
  // ... existing fields
  firstSeenRunId: string | null;       // keep (used in title attribute as tooltip hover)
  lastUpdatedRunId: string | null;     // keep
  firstSeenRunNo: string | null;       // NEW
  lastUpdatedRunNo: string | null;     // NEW
  walletNo: string | null;
}
```

- [ ] **Step 3: 删 shortId 工具 + 删 short 变量 + 改列展示**

行 53 整行删除：

```typescript
// DELETE: const shortId = (id: string | null, n = 8) => (id ? id.slice(0, n) : null);
```

行 233-234 + 后续相关使用整段删：

```typescript
// DELETE: const firstRunShort = shortId(kase.firstSeenRunId);
// DELETE: const lastRunShort = shortId(kase.lastUpdatedRunId);
// DELETE: const sameRun = ...
```

行 307 改：

```tsx
// BEFORE: <span title={kase.firstSeenRunId ?? undefined}>{firstRunShort}…</span>
// AFTER:
<span title={kase.firstSeenRunId ?? undefined}>{kase.firstSeenRunNo ?? '—'}</span>
```

行 320 改：

```tsx
// BEFORE: <span className="text-adm-t2" title={kase.lastUpdatedRunId ?? undefined}>{lastRunShort}…</span>
// AFTER:
<span className="text-adm-t2" title={kase.lastUpdatedRunId ?? undefined}>{kase.lastUpdatedRunNo ?? '—'}</span>
```

> 留 `title` 属性挂 UUID 提供 hover 调试线索，不在主区域展示。

- [ ] **Step 4: 加 URL `?runNo=` 消费**

文件顶部 import `useSearchParams` （若未引入）：

```typescript
import { useSearchParams } from 'react-router-dom';
```

组件内 fetch 处：

```typescript
const [searchParams] = useSearchParams();
const runNo = searchParams.get('runNo');

// fetch URL 拼接:
const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/cases`);
if (statusFilter) url.searchParams.set('status', statusFilter);
if (runNo) url.searchParams.set('runNo', runNo);
```

- [ ] **Step 5: tsc 检查 + lint**

Run:
```bash
cd admin-web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/ReconciliationCasesListPage.tsx
git commit -m "feat(admin): cases list shows firstSeenRunNo/lastUpdatedRunNo and supports ?runNo filter"
```

---

### Task B2: CasesDetail 全改造 (Hero + Body + Sidebar)

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`

- [ ] **Step 1: 读全文件,定位 Hero 块(行 312-333) / Body 段(336-613) / Sidebar(617-637)**

- [ ] **Step 2: 改 row interface 加 walletNo / linkedRunNo / slaDeadline / book**

约行 43-100 区间：

```typescript
interface ReconciliationCase {
  id: string;
  caseNo: string;
  walletRef: string | null;
  walletNo: string | null;          // NEW
  // ... existing
  firstSeenRunId: string | null;
  lastUpdatedRunId: string | null;
  openedByRunId?: string | null;
  linkedRunNo: string | null;       // NEW
  slaDeadline: string | null;       // NEW
  book: 'CLIENT' | 'FIRM';
  severity: string;
  status: string;
  assetCode: string;
  deltaAmount: string;
  createdAt: string;
  updatedAt: string;
  // ...
}
```

- [ ] **Step 3: Hero 改造 — 删灰色说明文 / 加 label / 增 BOOK,ASSET,Δ 三行**

定位 Hero 块（约行 312-333），替换为：

```tsx
<section className="bg-adm-card p-4">
  <div className="font-mono text-[19px] font-bold text-adm-amber">{kase.caseNo}</div>
  <div className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
    <div className="text-adm-t3">STATUS</div>
    <div><StatusBadge status={kase.status} /></div>
    <div className="text-adm-t3">SEVERITY</div>
    <div><SeverityBadge severity={kase.severity} /></div>
    <div className="text-adm-t3">BOOK</div>
    <div className="text-adm-t1">{kase.book}</div>
    <div className="text-adm-t3">ASSET</div>
    <div className="text-adm-t1">{kase.assetCode}</div>
    <div className="text-adm-t3">Δ</div>
    <div className={deltaZero ? 'text-adm-t2' : 'text-adm-red font-mono font-semibold'}>
      {sign}{kase.deltaAmount}
    </div>
  </div>
</section>
{/* DELETE: <p className="px-4 pb-3 text-[12px] text-adm-t3">Investigation-only · Disposition workflow...</p> */}
```

> StatusBadge / SeverityBadge 沿用文件内已有的组件;若内嵌实现,保留原渲染逻辑,只把外壳套上 label。

- [ ] **Step 4: Body Account Identity 段 — walletRef 短 UUID → walletNo**

定位行 ~345-347 处：

```tsx
// BEFORE:
<div className="mt-1 font-mono text-[13px] text-adm-t2" title={kase.walletRef ?? undefined}>
  {kase.walletRef ? `${shortId(kase.walletRef, 8)}…` : '—'}
</div>

// AFTER:
<div className="mt-1 font-mono text-[13px] text-adm-t2" title={kase.walletRef ?? undefined}>
  {kase.walletNo ?? '—'}
</div>
```

- [ ] **Step 5: Body — linkedRunId 短 UUID → linkedRunNo**

定位 ~行 287 + 376：

```tsx
// 行 287 — 简化 const:
// BEFORE: const linkedRunId = kase.lastUpdatedRunId ?? kase.openedByRunId ?? null;
// AFTER:  const linkedRunNo = kase.linkedRunNo;

// 行 375-377:
// BEFORE:
<div className="mt-1 font-mono text-[13px] text-adm-t2" title={linkedRunId ?? undefined}>
  {linkedRunId ? `${shortId(linkedRunId, 8)}…` : '—'}
</div>
// AFTER:
<div className="mt-1 font-mono text-[13px] text-adm-t2">
  {linkedRunNo ?? '—'}
</div>
```

- [ ] **Step 6: 删 Technical Detail 整段 (行 607-613)**

```tsx
// DELETE 整个 Technical Detail section:
// <section className="p-4">
//   <h3 ...>Technical Detail</h3>
//   <InfoField label="Case ID" value={kase.id} mono />
//   <InfoField label="First Seen Run" value={kase.firstSeenRunId} mono />
//   <InfoField label="Last Updated Run" value={kase.lastUpdatedRunId} mono />
// </section>
```

- [ ] **Step 7: Sidebar 改造 — 三块固定 + Identity 5 项 + Lifecycle 3 项**

定位 Sidebar 块（约行 617-637），整段替换为：

```tsx
<aside className="w-[272px] min-w-[272px] border-l border-adm-border bg-adm-panel">
  {/* ACTIONS — 只读页,不渲染 */}
  
  <SidebarGroup title="Identity Summary">
    <SidebarKV label="Case No" value={kase.caseNo} mono />
    <SidebarKV label="Status" value={<StatusBadge status={kase.status} />} />
    <SidebarKV label="Book" value={kase.book} />
    <SidebarKV label="Asset" value={kase.assetCode} />
    <SidebarKV label="Δ" value={kase.deltaAmount} mono />
  </SidebarGroup>
  
  <SidebarGroup title="Lifecycle">
    <SidebarKV label="SLA Deadline" value={kase.slaDeadline ?? '—'} mono />
    <SidebarKV label="Created" value={kase.createdAt} mono />
    <SidebarKV label="Updated" value={kase.updatedAt} mono />
  </SidebarGroup>
</aside>
```

> 删除 WALLET 块 + Severity / Business Date / Ref(walletRef UUID) / Resolved 字段。

- [ ] **Step 8: 删未引用的 shortId 函数（行 153）**

如果改造完后 shortId 不再被任何地方引用：

```typescript
// DELETE: const shortId = (id: string | null | undefined, n = 8): string => ...
```

Run grep: `grep -n "shortId" admin-web/src/pages/ReconciliationCasesDetailPage.tsx`
Expected: no matches → safe to delete the function.

- [ ] **Step 9: tsc 检查**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 10: Commit**

```bash
git add admin-web/src/pages/ReconciliationCasesDetailPage.tsx
git commit -m "feat(admin): case detail aligns to admin style — Hero labels, body walletNo, sidebar registered fields"
```

---

### Task B3: RunsDetail 改造 (Sidebar + Body + 删 Technical + URL 升级)

**Files:**
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`

- [ ] **Step 1: 读全文件,定位 Sidebar(行 637-647) / Account Status table 内 walletRef 展示(行 526) / Technical(行 629-632) / navigate(行 451)**

- [ ] **Step 2: 改 AccountStatusRow type 加 walletNo**

约行 38-90 区间：

```typescript
interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;       // NEW
  // ... existing
}
```

- [ ] **Step 3: 改 Account Status 表 Wallet 列展示**

定位行 524-545 区间：

```tsx
// BEFORE (行 526):
const shortRef = row.walletRef.slice(0, 8);
// 后续 render:
<span title={row.walletRef}>{shortRef}…</span>

// AFTER:
const displayWallet = row.walletNo ?? row.walletRef.slice(0, 8);  // walletNo 优先,XREF synthetic fallback
// render:
<span title={row.walletRef}>{displayWallet}</span>
```

> XREF 假 walletRef 没有真 walletNo,fallback 显示短 UUID 是设计可接受的;真实物理钱包必有 walletNo。

- [ ] **Step 4: Sidebar 加 Layer 行 (Identity Summary 升级到 4 项)**

定位行 637-641 区间：

```tsx
// AFTER:
<SidebarGroup title="Identity Summary">
  <SidebarKV label="Run No" value={run.runNo} mono />
  <SidebarKV label="Status" value={<StatusBadge status={run.status} />} />
  <SidebarKV label="Layer" value={run.layer} />          {/* NEW */}
  <SidebarKV label="Trigger" value={run.triggerType} />
</SidebarGroup>
```

- [ ] **Step 5: 删 Technical Detail 段 (行 629-632)**

```tsx
// DELETE:
// <section className="p-4">
//   <h3 className="...">Technical Detail</h3>
//   <InfoField label="Run ID" value={run.id} mono />
// </section>
```

- [ ] **Step 6: navigate URL 升级 — runId → runNo (行 451)**

```tsx
// BEFORE:
onClick={() => navigate(`/admin/reconciliation/cases?runId=${encodeURIComponent(run.id)}`)}
// AFTER:
onClick={() => navigate(`/admin/reconciliation/cases?runNo=${encodeURIComponent(run.runNo)}`)}
```

- [ ] **Step 7: tsc 检查**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/pages/ReconciliationRunsDetailPage.tsx
git commit -m "feat(admin): run detail aligns to admin style — sidebar Layer row, body walletNo, drop Technical, cases nav uses runNo"
```

---

## Phase C — traceId 修复（recon 模块 5 处）

### Task C1: ReconciliationRunService — randomUUID + spec

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts`（若不存在则创建）

- [ ] **Step 1: 写失败 spec**

```typescript
import { randomUUID } from 'node:crypto';

describe('ReconciliationRunService', () => {
  it('mints UUID v4 traceId at run creation (no business-field embedding)', async () => {
    const run = await service.createRun({ layer: 'CLIENT', businessDate: '2026-06-28' });
    expect(run.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(run.traceId).not.toMatch(/^V8:/);
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts`
Expected: FAIL — traceId 是 `V8:CLIENT:20260628`。

- [ ] **Step 3: 改 traceId 生成**

文件顶部 import：

```typescript
import { randomUUID } from 'node:crypto';
```

定位行 25：

```typescript
// BEFORE:
traceId: `V8:${input.layer}:${input.businessDate.replace(/-/g, '')}`,
// AFTER:
traceId: randomUUID(),
```

- [ ] **Step 4: Run spec, expect PASS**

Run: `npx jest reconciliation-run.service.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts
git commit -m "fix(recon): use randomUUID() for run traceId (audit-logging rule)"
```

---

### Task C2: ReconciliationCaseService — randomUUID + spec

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts`

- [ ] **Step 1: 写失败 spec**

```typescript
describe('ReconciliationCaseService', () => {
  it('mints UUID v4 traceId at case creation', async () => {
    const kase = await service.createCase({ layer: 'CLIENT', businessDate: '2026-06-28', ... });
    expect(kase.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

Run: `npx jest reconciliation-case.service.spec.ts`

- [ ] **Step 3: 改 traceId**

文件顶部 import：

```typescript
import { randomUUID } from 'node:crypto';
```

定位行 48：

```typescript
// BEFORE:
slaDeadline: sla, traceId: `V8:${input.layer}:${input.businessDate.replace(/-/g, '')}`,
// AFTER:
slaDeadline: sla, traceId: randomUUID(),
```

- [ ] **Step 4: Run spec, expect PASS**

Run: `npx jest reconciliation-case.service.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts
git commit -m "fix(recon): use randomUUID() for case traceId (audit-logging rule)"
```

---

### Task C3: WalletReconRunService — 3 处生成点修复

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`
- Test: spec 文件（若不存在则创建）

- [ ] **Step 1: 写失败 spec — 三条断言**

```typescript
describe('WalletReconRunService', () => {
  it('mints UUID v4 traceId at run creation', async () => {
    const run = await service.startRun({ businessDate: '2026-06-28' });
    expect(run.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  
  it('mints UUID v4 traceId at case creation', async () => {
    const result = await service.executeOneAccount({ ... new walletRef ... });
    const kase = await prisma.reconciliationCase.findFirst({ where: { walletRef: ... } });
    expect(kase.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  
  it('does NOT overwrite traceId when updating an existing case', async () => {
    // arrange: create case once, capture traceId
    await service.executeOneAccount({ walletRef: 'W1', businessDate: '2026-06-28', ... });
    const originalTraceId = (await prisma.reconciliationCase.findFirst({ where: { walletRef: 'W1' } })).traceId;
    
    // act: re-run on same walletRef + businessDate (triggers update path at line 547)
    await service.executeOneAccount({ walletRef: 'W1', businessDate: '2026-06-28', ... });
    const afterTraceId = (await prisma.reconciliationCase.findFirst({ where: { walletRef: 'W1' } })).traceId;
    
    expect(afterTraceId).toBe(originalTraceId);
  });
});
```

- [ ] **Step 2: Run spec, expect 3 × FAIL**

Run: `npx jest wallet-recon-run.service.spec.ts`

- [ ] **Step 3: 改 3 处生成点**

文件顶部 import：

```typescript
import { randomUUID } from 'node:crypto';
```

行 268（Run create）：

```typescript
// BEFORE: traceId: `WALLET_V1:${businessDate.replace(/-/g, '')}:${seq}`,
// AFTER:
traceId: randomUUID(),
```

行 584（Case create）：

```typescript
// BEFORE: traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:${input.caseReason}`,
// AFTER:
traceId: randomUUID(),
```

行 547（Case update）—— **从 update payload 中整行删除 traceId 字段**：

```typescript
// BEFORE: traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:${input.caseReason}`,
// AFTER: (整行删除,update payload 不再涉及 traceId 字段)
```

- [ ] **Step 4: Run spec, expect 3 × PASS**

Run: `npx jest wallet-recon-run.service.spec.ts`

- [ ] **Step 5: 全栈回归 — 跑现有 recon test suite 确认无破坏**

Run: `npx jest src/modules/clearing-settle/reconciliation`
Expected: all green。

- [ ] **Step 6: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts \
        src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
git commit -m "fix(recon): wallet recon traceId uses randomUUID() and case update no longer overwrites"
```

---

## Phase D — 综合验收

### Task D1: 起栈 + admin preview 4 页截图

**Files:** 无代码改动

- [ ] **Step 1: 启 main 栈**

Run:
```bash
bash scripts/stack.sh up main
# 若 stack.sh 后 Bash bg 被 harness 回收,改用:
bash /tmp/exchange_js_main/start-stack.sh
```
Expected: 3000 / 3001 端口在跑（`lsof -ti:3000,3001` 有输出）。

- [ ] **Step 2: 种子 admin 登录态 + 注入 preview localStorage**

获取 token：
```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r .accessToken
```

preview_eval 注入：
```javascript
localStorage.setItem('admin.session', JSON.stringify({ accessToken: '<TOKEN>', user: {...} }));
window.location.reload();
```

- [ ] **Step 3: preview_snapshot + screenshot 4 个页面 + Hero/Sidebar 局部**

预览 base URL: `http://localhost:3001`

| URL | 截图名 |
|---|---|
| `/admin/reconciliation/runs` | `runs-list.png` |
| `/admin/reconciliation/runs/RUN-xxx` | `runs-detail.png` + `runs-detail-hero.png` + `runs-detail-sidebar.png` |
| `/admin/reconciliation/cases` | `cases-list.png` |
| `/admin/reconciliation/cases/CASE-xxx` | `cases-detail.png` + `cases-detail-hero.png` + `cases-detail-sidebar.png` |

- [ ] **Step 4: 逐张对照 design 表**

| 检查项 | 期望 |
|---|---|
| RunsList | 表头列序与 spec §5.2 对齐;无 UUID |
| RunsDetail Hero | runNo amber + 4 个 label:value（Status / Business Date / Invariant / Demo） |
| RunsDetail Sidebar | 4 项 Identity + 3 项 Lifecycle;Layer 行存在 |
| RunsDetail Body Account Status 表 Wallet 列 | 显示 `WAL-xxx` 业务键不是 UUID 短串 |
| CasesList | First Run / Last Run 列显示 `REC-xxx` 不是 UUID |
| CasesDetail Hero | caseNo amber + 5 个 label:value（Status / Severity / Book / Asset / Δ）;**无灰色说明文** |
| CasesDetail Sidebar | 5 项 Identity（含 Book / Δ） + 3 项 Lifecycle（SLA Deadline / Created / Updated）;**无 WALLET 块,无 Ref UUID** |
| CasesDetail Body Account Identity | Wallet 显示 `WAL-xxx`;Linked Run 显示 `REC-xxx` |
| 任意页面 | 整页搜不到形如 `xxxxxxxx…`（短 UUID）的 8 位 hex 串 |

---

### Task D2: traceId DB 正则验证 + 二次 run 不覆盖验证

**Files:** 无代码改动

- [ ] **Step 1: 新跑一个 recon run（手动触发或等 cron）**

```bash
curl -X POST http://localhost:3000/admin/reconciliation/runs/wallet \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"businessDate":"2026-06-28"}'
```

- [ ] **Step 2: DB 查询 traceId 格式**

```bash
sqlite3 /tmp/exchange_js_main/dev.db <<'SQL'
SELECT runNo, traceId FROM reconciliation_runs ORDER BY createdAt DESC LIMIT 5;
SELECT caseNo, traceId FROM reconciliation_cases ORDER BY createdAt DESC LIMIT 5;
SQL
```

Expected: 所有 traceId 匹配 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`。无 `V8:` 或 `WALLET_V1:` 前缀。

- [ ] **Step 3: 同 businessDate 第二次跑 + 查 Case traceId 不变**

```bash
# 第一次: 记录某 case 的 traceId
TRACE_BEFORE=$(sqlite3 /tmp/exchange_js_main/dev.db "SELECT traceId FROM reconciliation_cases WHERE walletRef='<W>' AND businessDate='2026-06-28';")

# 第二次触发同 walletRef 同 businessDate 的 run
curl -X POST .../runs/wallet -d '{"businessDate":"2026-06-28"}'

# 查 traceId 是否变了
TRACE_AFTER=$(sqlite3 /tmp/exchange_js_main/dev.db "SELECT traceId FROM reconciliation_cases WHERE walletRef='<W>' AND businessDate='2026-06-28';")

echo "BEFORE: $TRACE_BEFORE"
echo "AFTER:  $TRACE_AFTER"
test "$TRACE_BEFORE" = "$TRACE_AFTER" && echo "PASS: traceId not regenerated" || echo "FAIL: traceId was rewritten"
```

Expected: `PASS: traceId not regenerated`。

- [ ] **Step 4: 全栈 e2e 跑一遍 — 验证 traceId 修复未破坏现有 recon 流程**

```bash
bash scripts/on-stack.sh main recon:demo
```

Expected: demo 跑通,no error。

---

## Self-Review

**Spec 覆盖检查**：

| Spec 章节 | 对应 Task |
|---|---|
| §3.1 CasesDetail Hero | B2 step 3 |
| §3.2 CasesDetail Body | B2 step 4-6 |
| §3.3 CasesDetail Sidebar | B2 step 7 |
| §4.1 RunsDetail Hero | 已合规无改动 |
| §4.2 RunsDetail Body | B3 step 3, 5 |
| §4.3 RunsDetail Sidebar | B3 step 4 |
| §4.4 URL 升级 | B3 step 6 |
| §5.1 CasesList | B1 全部 |
| §5.2 RunsList | 零改动 |
| §6 后续考虑 | spec 文档记录,本计划不实施 |
| §7 后端 Read Model | A1 / A2 / A3 / A4 |
| §8 traceId | C1 / C2 / C3 |
| §9 验收 | D1 / D2 |

**Placeholder 扫描**：无 TBD / TODO / "add appropriate error handling" / "similar to Task N" 模式。每个 code 步骤都给出具体代码。

**Type 一致性**：
- AccountStatusRow.walletNo 在 A1 + B3 一致
- Case interface walletNo / linkedRunNo / slaDeadline / book 在 A3 + B2 一致
- ReconciliationCase row firstSeenRunNo / lastUpdatedRunNo 在 A2 + B1 一致
- traceId 修复在 C1 / C2 / C3 都用 `randomUUID()` 而非任何变体名

**未覆盖项**：无。

---

## 完整任务清单

- [ ] **A1** — AccountStatusRow walletNo 字段
- [ ] **A2** — listCases firstSeenRunNo / lastUpdatedRunNo
- [ ] **A3** — getCase walletNo / linkedRunNo / slaDeadline / book
- [ ] **A4** — ReconCaseQueryDto runNo filter
- [ ] **B1** — CasesList ID → No
- [ ] **B2** — CasesDetail Hero + Body + Sidebar 全改造
- [ ] **B3** — RunsDetail Sidebar + Body + Technical + URL
- [ ] **C1** — Run service randomUUID
- [ ] **C2** — Case service randomUUID
- [ ] **C3** — WalletReconRunService 3 处修复
- [ ] **D1** — preview screenshot 验收
- [ ] **D2** — DB traceId 正则 + 不覆盖验证

共 12 任务,~50 步骤,~12 commit。

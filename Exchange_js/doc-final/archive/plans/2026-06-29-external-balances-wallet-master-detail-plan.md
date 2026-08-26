# External Balances Master-Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 External Balances 列表+详情双页（detail 流死锁、列名 `Account` + 暴露 UUID）重做成单页 master-detail（master 按 source/asset class 分 CRYPTO/FIAT；detail 三段 Hero/Roll-forward/Lines）。

**Architecture:** 后端 → 前端 → 验收 三阶段。后端先补 `walletNo/walletRole` 字段 + 替换 detail endpoint 为 walletNo lookup；前端建单页 master-detail（参考 `AccountStatementPage.tsx`），删两个旧 page + 老权限；最后 preview screenshot + curl 闭环验收。

**Tech Stack:** NestJS 9 + Prisma + SQLite | React 18 + Vite + Tailwind | adm-* design tokens

---

## Phase A — Backend Read Model

### Task A1: list endpoint 加 `walletNo` + `walletRole`

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (`listExternalBalances` 方法 around line 330)
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts`

- [ ] **Step 1: 读现状代码**

Run: `grep -n "listExternalBalances\|walletById\|walletNoById" src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`

确认当前 listExternalBalances 是简单 findMany 无 wallet join；参考既有 walletById Map 模式（同文件 listCases / getCase / buildAccountStatusTable 内的 wallets 表 join 写法）。

- [ ] **Step 2: 写失败 spec**

在 `reconciliation-query.service.spec.ts` 加：

```typescript
describe('listExternalBalances', () => {
  it('joins walletRef → walletNo + walletRole on each row', async () => {
    // arrange: seed 1 wallet (id='W1', walletNo='WA-001', walletRole='C_VIBAN')
    //          + 1 externalBalance (walletRef='W1', cutoffDate='2026-06-28')
    const result = await query.listExternalBalances({ cutoffDate: '2026-06-28' });
    expect(result[0].walletNo).toBe('WA-001');
    expect(result[0].walletRole).toBe('C_VIBAN');
  });

  it('returns null walletNo/walletRole for XREF synthetic walletRefs', async () => {
    // arrange: balance with walletRef='XREF:synthetic-1'
    const result = await query.listExternalBalances({ cutoffDate: '2026-06-28' });
    const xref = result.find(r => r.walletRef.startsWith('XREF:'));
    expect(xref.walletNo).toBeNull();
    expect(xref.walletRole).toBeNull();
  });
});
```

- [ ] **Step 3: Run spec, expect FAIL**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t 'listExternalBalances'`
Expected: FAIL — walletNo/walletRole undefined。

- [ ] **Step 4: 改 listExternalBalances**

定位 line ~330。仿 buildAccountStatusTable 的 walletById 模式：

```typescript
async listExternalBalances(q: { cutoffDate?: string; book?: string; source?: string; currency?: string }) {
  const rows = await this.prisma.externalBalance.findMany({
    where: { cutoffDate: q.cutoffDate, book: q.book, source: q.source, currency: q.currency },
    orderBy: [{ book: 'asc' }, { source: 'asc' }, { currency: 'asc' }, { accountRef: 'asc' }],
  });

  // walletRef → walletNo + walletRole join (mirrors buildAccountStatusTable pattern)
  const realWalletRefs = Array.from(new Set(
    rows.map(r => r.walletRef).filter((w): w is string => !!w && !w.startsWith('XREF:'))
  ));
  const wallets = realWalletRefs.length === 0
    ? []
    : await this.prisma.wallet.findMany({
        where: { id: { in: realWalletRefs } },
        select: { id: true, walletNo: true, walletRole: true },
      });
  const walletById = new Map(wallets.map(w => [w.id, w]));

  return rows.map(r => ({
    ...r,
    walletNo: walletById.get(r.walletRef ?? '')?.walletNo ?? null,
    walletRole: walletById.get(r.walletRef ?? '')?.walletRole ?? null,
  }));
}
```

- [ ] **Step 5: Run spec, expect PASS**

Run: `npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t 'listExternalBalances'`

- [ ] **Step 6: 全 recon suite 回归**

Run: `npx jest src/modules/clearing-settle/reconciliation 2>&1 | tail -5`
Expected: all green (current 146 + 2 new = 148)。

- [ ] **Step 7: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "feat(recon): expose walletNo/walletRole on external balance list"
```

---

### Task A2: 替换 `:statementId` detail endpoint 为 `:walletNo?date=` 查询

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` (replace `getExternalBalance` ~line 337)
- Modify: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts` (route swap)
- Test: 同 spec 文件

- [ ] **Step 1: 写失败 spec**

```typescript
describe('getExternalBalanceByWallet', () => {
  it('returns balance + lines when walletNo + date match', async () => {
    // arrange: wallet (id='W1', walletNo='WA-001', walletRole='C_VIBAN')
    //          + externalBalance (walletRef='W1', cutoffDate='2026-06-28')
    //          + 2 externalStatementLine on same date
    const result = await query.getExternalBalanceByWallet('WA-001', '2026-06-28');
    expect(result.walletNo).toBe('WA-001');
    expect(result.walletRole).toBe('C_VIBAN');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toHaveProperty('direction');
    expect(result.lines[0]).toHaveProperty('amount');
  });

  it('throws 404 when walletNo not found in wallets table', async () => {
    await expect(query.getExternalBalanceByWallet('WA-DOES-NOT-EXIST', '2026-06-28'))
      .rejects.toThrow(/no external balance for WA-DOES-NOT-EXIST/);
  });

  it('throws 404 when no externalBalance row for that walletRef + date', async () => {
    // wallet exists but no balance row for that day
    await expect(query.getExternalBalanceByWallet('WA-001', '2099-01-01'))
      .rejects.toThrow(/no external balance for WA-001/);
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL** (method doesn't exist yet)

Run: `npx jest -t 'getExternalBalanceByWallet'`

- [ ] **Step 3: 添加新方法 `getExternalBalanceByWallet`**

在 query.service.ts，**删除现有 `getExternalBalance(statementId)`**（包括其 import 依赖），新增：

```typescript
async getExternalBalanceByWallet(walletNo: string, cutoffDate: string) {
  const wallet = await this.prisma.wallet.findFirst({
    where: { walletNo },
    select: { id: true, walletNo: true, walletRole: true },
  });
  if (!wallet) throw new NotFoundException(`no external balance for ${walletNo} on ${cutoffDate}`);

  const balance = await this.prisma.externalBalance.findFirst({
    where: { walletRef: wallet.id, cutoffDate },
  });
  if (!balance) throw new NotFoundException(`no external balance for ${walletNo} on ${cutoffDate}`);

  const dayLo = new Date(`${cutoffDate}T00:00:00.000Z`);
  const dayHi = new Date(`${cutoffDate}T23:59:59.999Z`);
  const lines = await this.prisma.externalStatementLine.findMany({
    where: {
      source: balance.source,
      accountRef: balance.accountRef,
      currency: balance.currency,
      datetime: { gte: dayLo, lte: dayHi },
    },
    orderBy: { datetime: 'asc' },
  });

  return {
    ...balance,
    walletNo: wallet.walletNo,
    walletRole: wallet.walletRole,
    lines,
  };
}
```

- [ ] **Step 4: 改 controller — route swap**

文件: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`

```typescript
// BEFORE:
@Get('external-balances/:statementId')
@RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/external-balances/:statementId'))
getExternalBalance(@Param('statementId') statementId: string) { return this.query.getExternalBalance(statementId); }

// AFTER:
@Get('external-balances/:walletNo')
@RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/external-balances/:walletNo'))
getExternalBalanceByWallet(
  @Param('walletNo') walletNo: string,
  @Query('date') date: string,
) {
  if (!date) throw new BadRequestException('date query param is required (YYYY-MM-DD)');
  return this.query.getExternalBalanceByWallet(walletNo, date);
}
```

注意: 加 `BadRequestException` import 自 `@nestjs/common`（若未导入）。

- [ ] **Step 5: Run spec, expect PASS**

Run: `npx jest -t 'getExternalBalanceByWallet'`

- [ ] **Step 6: 全 recon suite 回归**

Run: `npx jest src/modules/clearing-settle/reconciliation 2>&1 | tail -5`

- [ ] **Step 7: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
        src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts \
        src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts
git commit -m "feat(recon): replace external-balances detail endpoint with walletNo lookup"
```

---

## Phase B — 前端单页 master-detail

### Task B1: 新建单页骨架 + Master Pane（Source 分区 + Wallet 行）

**Files:**
- Create: `admin-web/src/pages/ReconciliationExternalBalancesPage.tsx`

- [ ] **Step 1: 读参考模板**

Run: `head -200 admin-web/src/pages/AccountStatementPage.tsx`

确认 master-detail 布局模式（useSearchParams + flex split）。本任务**不**复用其代码，只参考结构。

- [ ] **Step 2: 创建新文件 — 单页骨架 + URL 状态 + Master fetch**

新建 `admin-web/src/pages/ReconciliationExternalBalancesPage.tsx`：

```typescript
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';

interface ExternalBalanceRow {
  id: string;
  source: string;
  accountRef: string;
  currency: string;
  book: string;
  cutoffDate: string;
  closingBalance: string;
  openingBalance: string | null;
  status: string | null;
  lineCount: number | null;
  walletRef: string | null;
  walletNo: string | null;
  walletRole: string | null;
}

const SOURCE_LABELS: Record<string, { groupLabel: string; subLabel: string }> = {
  HEXTRUST: { groupLabel: 'CRYPTO', subLabel: 'HexTrust' },
  ZAND: { groupLabel: 'FIAT', subLabel: 'Zand' },
  CHAIN: { groupLabel: 'CRYPTO', subLabel: 'Chain (raw)' },
};
const BOOK_BADGE: Record<string, string> = {
  CLIENT: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  FIRM: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
};

const fmtAmount = (v: string | number | null) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
const todayIso = () => new Date().toISOString().slice(0, 10);

const ReconciliationExternalBalancesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') ?? todayIso();
  const selectedWallet = searchParams.get('wallet');

  const [rows, setRows] = useState<ExternalBalanceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const fetchList = async (d: string) => {
    setLoadingList(true);
    try {
      const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances`);
      url.searchParams.set('cutoffDate', d);
      const res = await adminFetch(url.toString());
      if (res.ok) setRows((await res.json()) as ExternalBalanceRow[]);
      else alert(await getApiErrorMessage(res, 'Failed to load external balances'));
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { void fetchList(date); }, [date]);

  // Group rows by source's groupLabel (CRYPTO/FIAT/OTHER)
  const grouped = useMemo(() => {
    const groups: Record<string, { subLabel: string; rows: ExternalBalanceRow[] }> = {};
    for (const r of rows) {
      const meta = SOURCE_LABELS[r.source] ?? { groupLabel: `OTHER (${r.source})`, subLabel: r.source };
      if (!groups[meta.groupLabel]) groups[meta.groupLabel] = { subLabel: meta.subLabel, rows: [] };
      groups[meta.groupLabel].rows.push(r);
    }
    // Sort each group's rows: book asc (CLIENT first), then walletNo asc
    for (const g of Object.values(groups)) {
      g.rows.sort((a, b) => (a.book ?? '').localeCompare(b.book ?? '') || (a.walletNo ?? '').localeCompare(b.walletNo ?? ''));
    }
    return groups;
  }, [rows]);

  const groupOrder = ['CRYPTO', 'FIAT', ...Object.keys(grouped).filter(k => k !== 'CRYPTO' && k !== 'FIAT')];
  const totals = groupOrder.map(k => ({ key: k, count: grouped[k]?.rows.length ?? 0 }));

  const onSelectWallet = (walletNo: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (walletNo) next.set('wallet', walletNo); else next.delete('wallet');
    setSearchParams(next);
  };

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="External Balances"
        subtitle={`${date} · ${rows.length} wallets · ${totals.filter(t => t.count > 0).map(t => `${t.key === 'CRYPTO' ? 'Crypto' : t.key === 'FIAT' ? 'Fiat' : t.key} ${t.count}`).join(' · ')}`}
        actions={
          <>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                next.set('date', e.target.value);
                next.delete('wallet');
                setSearchParams(next);
              }}
              className="rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[11px] text-adm-t1"
            />
            <button onClick={() => void fetchList(date)} className="rounded border border-adm-border px-3 py-1 text-[11px] hover:bg-adm-hover">
              <RefreshCw size={12} className={loadingList ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* MASTER */}
        <aside className="w-[360px] min-w-[360px] overflow-y-auto border-r border-adm-border bg-adm-panel">
          {groupOrder.filter(k => grouped[k]).map((groupKey) => {
            const group = grouped[groupKey];
            return (
              <section key={groupKey} className="border-b border-adm-border">
                <header className="bg-adm-bg px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
                  {groupKey} <span className="ml-2 text-adm-t2 normal-case">({group.subLabel})</span>
                </header>
                {group.rows.map((r) => {
                  const isSelected = r.walletNo === selectedWallet;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onSelectWallet(r.walletNo)}
                      disabled={!r.walletNo}
                      className={`w-full border-b border-adm-border px-4 py-2.5 text-left transition-colors ${
                        isSelected ? 'border-l-2 border-l-adm-amber bg-adm-card' : 'hover:bg-adm-hover'
                      } ${!r.walletNo ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <div className="font-mono text-[12px] text-adm-t1">{r.walletNo ?? r.walletRef?.slice(0, 8) + '…'}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {r.book && (
                          <span className={`inline-flex rounded border px-1.5 py-0 font-mono text-[9px] uppercase ${BOOK_BADGE[r.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}>
                            {r.book}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-adm-t2">{r.currency}</span>
                        <span className={`ml-auto font-mono text-[11px] ${Number(r.closingBalance) < 0 ? 'text-adm-red' : 'text-adm-t1'}`}>
                          {fmtAmount(r.closingBalance)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </section>
            );
          })}
          {rows.length === 0 && !loadingList && (
            <div className="px-4 py-8 text-center text-[12px] text-adm-t3">No external balances for {date}</div>
          )}
        </aside>

        {/* DETAIL — Task B2 fills this */}
        <main className="flex-1 overflow-y-auto">
          {!selectedWallet ? (
            <div className="flex h-full items-center justify-center text-[13px] text-adm-t3">
              Select a wallet from the left to view its statement
            </div>
          ) : (
            <div className="px-6 py-12 text-center text-[13px] text-adm-t3">Detail pane — wired in Task B2</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ReconciliationExternalBalancesPage;
```

- [ ] **Step 3: tsc check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: Commit (page 还没 wire 到 App.tsx，但已可单独编译)**

```bash
git add admin-web/src/pages/ReconciliationExternalBalancesPage.tsx
git commit -m "feat(admin): scaffold ExternalBalances master-detail page + source-grouped master pane"
```

---

### Task B2: Detail Pane（Hero + Roll-Forward + Lines + Cross-ref）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationExternalBalancesPage.tsx`

- [ ] **Step 1: 替换 detail pane placeholder 为完整渲染**

定位 Task B1 写的占位段（`{/* DETAIL — Task B2 fills this */}` 后那个 `<main>` 块），替换为：

先在文件顶部 type 区加 Detail 数据 interface：

```typescript
interface StatementLine {
  id: string;
  datetime: string;
  direction: 'IN' | 'OUT';
  amount: string;
  externalRef: string | null;
  channelRef: string | null;
  balanceAfter: string | null;
  description: string | null;
  raw: string | null;
}

interface ExternalBalanceDetail extends ExternalBalanceRow {
  walletRef: string | null;
  ownerNo: string | null;
  asOfAt: string | null;
  ingestedAt: string | null;
  lines: StatementLine[];
}
```

在组件内添加 detail state + fetch effect:

```typescript
const [detail, setDetail] = useState<ExternalBalanceDetail | null>(null);
const [loadingDetail, setLoadingDetail] = useState(false);
const [expanded, setExpanded] = useState<Set<string>>(new Set());

const fetchDetail = async (walletNo: string, d: string) => {
  setLoadingDetail(true);
  setExpanded(new Set());
  try {
    const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances/${encodeURIComponent(walletNo)}`);
    url.searchParams.set('date', d);
    const res = await adminFetch(url.toString());
    if (res.ok) setDetail((await res.json()) as ExternalBalanceDetail);
    else { setDetail(null); alert(await getApiErrorMessage(res, 'Failed to load wallet statement')); }
  } catch (e) {
    if (e instanceof AdminSessionError) return;
    console.error(e);
  } finally {
    setLoadingDetail(false);
  }
};

useEffect(() => {
  if (selectedWallet) void fetchDetail(selectedWallet, date);
  else setDetail(null);
}, [selectedWallet, date]);

const toggleExpand = (id: string) => setExpanded((prev) => {
  const next = new Set(prev);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
});
```

替换 `<main>` 体：

```typescript
<main className="flex-1 overflow-y-auto divide-y divide-adm-border">
  {!selectedWallet ? (
    <div className="flex h-full items-center justify-center text-[13px] text-adm-t3">
      Select a wallet from the left to view its statement
    </div>
  ) : loadingDetail && !detail ? (
    <div className="flex h-full flex-col items-center justify-center">
      <RefreshCw className="mb-3 animate-spin text-adm-amber" size={28} />
      <p className="text-[12px] text-adm-t3">Loading statement…</p>
    </div>
  ) : !detail ? null : (
    <>
      {/* Notice strip */}
      <div className="border-b border-adm-border bg-adm-panel px-6 py-2 text-[11px] text-adm-t2">
        {detail.lineCount ?? detail.lines.length} lines · ingested {detail.ingestedAt ? new Date(detail.ingestedAt).toLocaleString() : '—'}
        {detail.status && <span className="ml-3"><StatusPill value={detail.status} /></span>}
      </div>

      {/* Hero */}
      <section className="bg-adm-card p-6">
        <div className="font-mono text-[19px] font-bold text-adm-amber">{detail.walletNo ?? '—'}</div>
        <div className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
          <div className="text-adm-t3">SOURCE</div><div className="text-adm-t1">{detail.source}</div>
          <div className="text-adm-t3">BOOK</div>
          <div>
            {detail.book ? (
              <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${BOOK_BADGE[detail.book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}>{detail.book}</span>
            ) : '—'}
          </div>
          <div className="text-adm-t3">ROLE</div><div className="font-mono text-adm-t1">{detail.walletRole ?? '—'}</div>
          <div className="text-adm-t3">CCY</div><div className="font-mono text-adm-t1">{detail.currency}</div>
          <div className="text-adm-t3">OWNER</div><div className="font-mono text-adm-t1">{detail.ownerNo ?? '—'}</div>
        </div>
        <div className="mt-5 border-t border-adm-border pt-4">
          <div className="text-[11px] uppercase tracking-wider text-adm-t3">CLOSING</div>
          <div className={`mt-1 font-mono text-[24px] font-semibold ${Number(detail.closingBalance) < 0 ? 'text-adm-red' : 'text-adm-t1'}`}>{fmtAmount(detail.closingBalance)}</div>
        </div>
      </section>

      {/* Roll-Forward Check */}
      {(() => {
        const opening = Number(detail.openingBalance ?? 0);
        const closing = Number(detail.closingBalance);
        const net = detail.lines.reduce((s, l) => s + (l.direction === 'IN' ? Number(l.amount) : -Number(l.amount)), 0);
        const drift = opening + net - closing;
        const continuous = Math.abs(drift) < 0.000001;
        const empty = detail.lines.length === 0;
        return (
          <section className="p-6">
            <div className="text-[11px] uppercase tracking-wider text-adm-t3">Roll-Forward Check</div>
            <div className="mt-2 font-mono text-[13px] text-adm-t1">
              {fmtAmount(opening)} + {fmtAmount(net)} net {continuous ? '=' : '≠'} {fmtAmount(closing)}
            </div>
            <div className={`mt-2 text-[12px] ${empty ? 'text-adm-t3' : continuous ? 'text-adm-green' : 'text-adm-red'}`}>
              {empty ? '⚠️ Empty statement — opening/closing only' :
               continuous ? `✅ continuous · drift = 0` :
               `❌ drift = ${fmtAmount(drift)} · contact ${detail.source}`}
            </div>
          </section>
        );
      })()}

      {/* Statement Lines */}
      <section className="p-6">
        <div className="text-[11px] uppercase tracking-wider text-adm-t3 mb-3">Statement Lines ({detail.lines.length})</div>
        {detail.lines.length === 0 ? (
          <div className="text-[12px] text-adm-t3">No lines recorded for this wallet on {detail.cutoffDate}</div>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-adm-bg text-adm-t3">
                <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Time</th>
                <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Dir</th>
                <th className="px-2 py-1.5 text-right font-mono uppercase tracking-wider">Amount</th>
                <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">External Ref</th>
                <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Channel Ref</th>
                <th className="px-2 py-1.5 text-left font-mono uppercase tracking-wider">Description</th>
                <th className="px-2 py-1.5 text-right font-mono uppercase tracking-wider">Balance After</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <>
                  <tr key={l.id} className="border-b border-adm-border hover:bg-adm-hover cursor-pointer" onClick={() => toggleExpand(l.id)}>
                    <td className="px-2 py-2 font-mono text-adm-t2">{new Date(l.datetime).toLocaleTimeString()}</td>
                    <td className="px-2 py-2">
                      <span className={`inline-flex rounded px-1.5 py-0 font-mono text-[10px] font-semibold ${l.direction === 'IN' ? 'bg-adm-green/15 text-adm-green' : 'bg-adm-red/15 text-adm-red'}`}>{l.direction}</span>
                    </td>
                    <td className={`px-2 py-2 text-right font-mono ${l.direction === 'OUT' ? 'text-adm-red' : 'text-adm-t1'}`}>{fmtAmount(l.amount)}</td>
                    <td className="px-2 py-2 font-mono text-adm-t2">{l.externalRef ?? '—'}</td>
                    <td className="px-2 py-2 font-mono text-adm-t3">{l.channelRef ?? '—'}</td>
                    <td className="px-2 py-2 text-adm-t2">{l.description ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-mono text-adm-t2">{l.balanceAfter ? fmtAmount(l.balanceAfter) : '—'}</td>
                    <td className="px-2 py-2 text-adm-t3">{expanded.has(l.id) ? '▾' : '▸'}</td>
                  </tr>
                  {expanded.has(l.id) && l.raw && (
                    <tr key={`${l.id}-raw`} className="bg-adm-bg">
                      <td colSpan={8} className="px-4 py-2">
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-adm-t2">{(() => { try { return JSON.stringify(JSON.parse(l.raw), null, 2); } catch { return l.raw; } })()}</pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Cross-ref footer */}
      <section className="p-6">
        <a
          href={`/admin/ledger/account-statement?wallet=${encodeURIComponent(detail.walletRef ?? '')}&crossingOnly=true`}
          className="text-[12px] text-adm-amber hover:underline"
        >
          View in Internal Book →
        </a>
      </section>
    </>
  )}
</main>
```

- [ ] **Step 2: tsc check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/ReconciliationExternalBalancesPage.tsx
git commit -m "feat(admin): ExternalBalances detail pane — Hero/Roll-Forward/Lines/Cross-ref"
```

---

### Task B3: Wire App.tsx + 删两个旧 page + 删旧权限

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/rbac/permissions.ts`
- Delete: `admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx`
- Delete: `admin-web/src/pages/ReconciliationExternalBalancesDetailPage.tsx`

- [ ] **Step 1: App.tsx — 替换 lazy imports**

```typescript
// BEFORE (lines 24-25):
const ReconciliationExternalBalancesListPage = lazy(() => import('./pages/ReconciliationExternalBalancesListPage'));
const ReconciliationExternalBalancesDetailPage = lazy(() => import('./pages/ReconciliationExternalBalancesDetailPage'));

// AFTER:
const ReconciliationExternalBalancesPage = lazy(() => import('./pages/ReconciliationExternalBalancesPage'));
```

- [ ] **Step 2: App.tsx — 替换两组 Route 定义**

```typescript
// BEFORE (around lines 286-294 AND 738-739):
<Route path="reconciliation/external-balances" element={withPermission(<ReconciliationExternalBalancesListPage />, [PERMISSIONS.RECON_EXTERNAL_BALANCE_READ])} />
<Route path="reconciliation/external-balances/:statementId" element={withPermission(<ReconciliationExternalBalancesDetailPage />, [PERMISSIONS.RECON_EXTERNAL_BALANCE_DETAIL_READ])} />

// AFTER (in BOTH places):
<Route path="reconciliation/external-balances" element={withPermission(<ReconciliationExternalBalancesPage />, [PERMISSIONS.RECON_EXTERNAL_BALANCE_READ])} />
```

Run grep to confirm: `grep -n "ReconciliationExternalBalances" admin-web/src/App.tsx` —— 应剩 2 行（1 import + 1 Route）×2 mount = total 4 references。

- [ ] **Step 3: permissions.ts — 删 DETAIL_READ key**

```typescript
// BEFORE (lines 36-37):
RECON_EXTERNAL_BALANCE_READ: 'api.get.admin_reconciliation_external_balances',
RECON_EXTERNAL_BALANCE_DETAIL_READ: 'api.get.admin_reconciliation_external_balances_statementid',

// AFTER:
RECON_EXTERNAL_BALANCE_READ: 'api.get.admin_reconciliation_external_balances',
```

- [ ] **Step 4: 删两个旧 page 文件**

```bash
rm admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx
rm admin-web/src/pages/ReconciliationExternalBalancesDetailPage.tsx
```

- [ ] **Step 5: 确认没遗留引用**

```bash
grep -rn "ReconciliationExternalBalancesListPage\|ReconciliationExternalBalancesDetailPage\|RECON_EXTERNAL_BALANCE_DETAIL_READ\|external-balances/:statementId" admin-web/src
```
Expected: 0 matches（除了已删除文件的 git status 输出）。

- [ ] **Step 6: tsc check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/App.tsx admin-web/src/rbac/permissions.ts
git rm admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx \
       admin-web/src/pages/ReconciliationExternalBalancesDetailPage.tsx
git commit -m "feat(admin): replace ExternalBalances list+detail pages with single master-detail"
```

---

## Phase C — 综合验收

### Task C1: 后端 build + 重启 + curl 验证 payload

**Files:** 无代码改动

- [ ] **Step 1: Rebuild + restart 栈**

```bash
npm run build 2>&1 | tail -5  # nest build expected to pass
bash /tmp/exchange_js_main/start-stack.sh
sleep 8
```

- [ ] **Step 2: 取 token + curl list**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r .access_token)
echo "$TOKEN" > /tmp/exchange_js_main/admin.tok

curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/admin/reconciliation/external-balances?cutoffDate=2026-06-28' | jq '.[0] | {walletNo, walletRole, walletRef, source, book, currency, closingBalance}'
```

Expected: 输出含 `walletNo`（非 null）+ `walletRole`（如 C_VIBAN）。

- [ ] **Step 3: curl detail by walletNo**

```bash
WALLET_NO=$(curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/admin/reconciliation/external-balances?cutoffDate=2026-06-28' | jq -r '.[0].walletNo')
echo "Wallet: $WALLET_NO"

curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/admin/reconciliation/external-balances/$WALLET_NO?date=2026-06-28" | jq '{walletNo, walletRole, source, lineCount, lines_returned: (.lines | length)}'
```

Expected: 输出 walletNo/walletRole/source 都有，lines 数组非空。

- [ ] **Step 4: 验证旧 statementId 路由 404**

```bash
curl -s -w "%{http_code}" -o /dev/null -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/admin/reconciliation/external-balances/some-random-statement-id?date=2026-06-28'
```

Expected: 200 with 404 body OR 404 directly —— 关键是不能 200 with valid data（确认走的是新 walletNo lookup 不是旧 statementId lookup）。

- [ ] **Step 5: 验证 detail 不带 date 参数返回 400**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/admin/reconciliation/external-balances/$WALLET_NO"
```

Expected: `{"statusCode":400,"message":"date query param is required (YYYY-MM-DD)",...}`

---

### Task C2: Preview screenshot 验收

**Files:** 无代码改动

- [ ] **Step 1: 启 admin preview**

```bash
lsof -ti:3001 | xargs -r kill
sleep 2
```

调 `mcp__Claude_Preview__preview_start({ name: 'admin' })`，记下 serverId。

- [ ] **Step 2: 注入 token**

```javascript
// preview_eval:
(async () => {
  const r = await fetch('http://localhost:3000/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email:'admin@fiatx.com',password:'123456'}) });
  const j = await r.json();
  localStorage.setItem('admin_token', j.access_token);
  localStorage.setItem('admin_user', JSON.stringify(j.user));
  return { ok: !!localStorage.getItem('admin_token') };
})()
```

- [ ] **Step 3: 跳到 External Balances 页（不带 wallet param）**

```javascript
// preview_eval:
window.location.href = 'http://localhost:3001/admin/reconciliation/external-balances?date=2026-06-28';
```

`preview_screenshot` 截图 1：**Master 列表 + Detail placeholder**。

验证项：
- subtitle 显示 `2026-06-28 · N wallets · Crypto X · Fiat Y`
- master 分两区："CRYPTO (HexTrust)" / "FIAT (Zand)" 顶 header
- wallet 行显示 walletNo（业务键，非 UUID）+ book badge + ccy + closing
- right pane 显示 "Select a wallet from the left to view its statement"

- [ ] **Step 4: URL 直达带 wallet param**

```javascript
// preview_eval: 取第一个 wallet 跳转
const firstWallet = document.querySelector('aside button')?.textContent?.match(/WA\d+/)?.[0];
window.location.href = `http://localhost:3001/admin/reconciliation/external-balances?date=2026-06-28&wallet=${firstWallet}`;
```

`preview_screenshot` 截图 2：**Detail pane 完整渲染**。

验证项：
- Notice strip：`N lines · ingested ... · status [INGESTED]`
- Hero：walletNo amber 19px + SOURCE/BOOK/ROLE/CCY/OWNER 5 个 label:value + CLOSING 24px 大字
- Roll-Forward Check：绿 ✅ continuous + drift = 0（demo 数据应该 continuous）
- Statement Lines 表：每行 Time/Dir(IN/OUT chip)/Amount/ExternalRef/ChannelRef/Description/BalanceAfter
- 底部 "View in Internal Book →" amber 链

- [ ] **Step 5: 点击展开一行 raw**

```javascript
// preview_eval: 点击第一行
const firstLineRow = document.querySelector('section table tbody tr');
firstLineRow?.click();
```

`preview_screenshot` 截图 3：raw JSON 展开。

- [ ] **Step 6: 老 statementId URL 验证 — 404 或 redirect**

```javascript
window.location.href = 'http://localhost:3001/admin/reconciliation/external-balances/some-uuid';
```

`preview_snapshot` 验证页面：旧路由已不存在，应该走 admin SPA 的 404 / fallback。

- [ ] **Step 7: 整页文本扫 UUID**

```javascript
// preview_eval:
document.body.innerText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)
```

Expected: `null` 或 `[]`——页面渲染文本里**没有任何完整 UUID**。

---

## Self-Review

**Spec 覆盖检查（vs spec §1-§11）：**

| Spec 章节 | 对应 Task |
|---|---|
| §3 顶层布局（master-detail） | B1 (master) + B2 (detail) |
| §4 URL 状态合约 | B1 (useSearchParams + ?date/?wallet) |
| §5 Master Pane（分区/排序/行展示） | B1 |
| §6 Detail Pane（Hero/Roll-Forward/Lines/Cross-ref） | B2 |
| §7 Backend endpoint 改造 | A1 (list +字段) + A2 (detail by walletNo) |
| §8 文件结构变更 | B3 |
| §9 不变量 | 各前端 Task 内嵌（formatAmount + adm-* + 无 UUID） |
| §10 验收方式 10 项 | C1 (curl 4-9) + C2 (preview 1-3,5,6,10) |
| §11 后续考虑（deferred） | 各 task 不涉及（design 文档已记录） |

**Placeholder 扫描**：无 TBD / TODO / "类似 Task X" 模式。每个 code step 给出具体代码 + 行号。

**Type 一致性**：
- `ExternalBalanceRow` (B1) 字段名与 backend list response (A1) 1:1 一致
- `ExternalBalanceDetail extends ExternalBalanceRow` (B2) 加 lines/walletRef/ownerNo/asOfAt/ingestedAt — 与 backend detail response (A2) 一致
- `StatementLine` (B2) 字段名与 prisma schema `external_statement_lines` 一致
- `walletNo` / `walletRole` 字段全程一致命名（不用 `walletNumber` 等变体）

---

## 完整任务清单

- [ ] **A1** — list endpoint 加 walletNo + walletRole
- [ ] **A2** — replace `:statementId` endpoint with `:walletNo?date=` lookup
- [ ] **B1** — 新 page 骨架 + Master pane（source 分区 + wallet 行）
- [ ] **B2** — Detail pane (Hero + Roll-Forward + Lines + Cross-ref)
- [ ] **B3** — Wire App.tsx + 删旧 2 page + 删 DETAIL_READ 权限
- [ ] **C1** — Backend rebuild + restart + curl payload 验证
- [ ] **C2** — Preview screenshot 验收 7 项

共 7 任务，~30 步骤，~5 commit（A1 A2 B1 B2 B3 各 1，C 阶段无 commit）。

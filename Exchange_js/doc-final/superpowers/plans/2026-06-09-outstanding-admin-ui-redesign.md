# Outstanding Admin-UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Swap Outstanding list + detail admin pages to the admin dark-theme spec, add pagination + a Settlement-linkage section, fix the status filter, backed by one backend `include` enrichment.

**Architecture:** Pure frontend rewrite of two pages to match `SettlementListPage`/`SettlementDetailPage` conventions (`PageTitleBar`/`AdminBadge`/`Pagination`/dark `adm-*` theme/`adminFetch`), plus a one-line backend `findOneForAdmin` include so the detail can show the settlement batch/transfer/fund business numbers. No schema, route, or nav changes.

**Tech Stack:** React + Vite + Tailwind (admin-web, build `tsc -b && vite build`, NO frontend test harness → verify via typecheck/build + manual); NestJS + Prisma + Jest (backend, TDD).

**Spec:** `doc-final/superpowers/specs/2026-06-09-outstanding-admin-ui-redesign-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/modules/clearing-settle/outstandings/outstandings.service.ts` | `findOneForAdmin` | enrich `include` with settlement relations (select business Nos) |
| `admin-web/src/pages/SwapOutstandingList.tsx` | list page | full rewrite → admin dark spec |
| `admin-web/src/pages/SwapOutstandingDetail.tsx` | detail page | full rewrite → admin dark spec + Settlement-linkage section |

Reference templates (read them — DO NOT modify): `admin-web/src/pages/funds-layer/SettlementListPage.tsx` (list), `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx` (detail).

Commit only the files in each task (targeted `git add`; the tree has unrelated WIP — never `git add -A`).

---

## Task 1: Backend — enrich `findOneForAdmin` with settlement linkage

**Files:**
- Modify: `src/modules/clearing-settle/outstandings/outstandings.service.ts` (`findOneForAdmin`)
- Test: `src/modules/clearing-settle/outstandings/outstandings.service.spec.ts` (create or extend)

The `Outstanding` model already has relations `settlementBatch` (→ SettlementBatch), `settledByTransfer` (relation `OutstandingSettledByTransfer` → InternalTransaction), `closedByInternalFund` (→ InternalFund). Add them to the detail `include`, selecting only business Nos + key fields (NO UUIDs surfaced).

- [ ] **Step 1: Write the failing test**

Add to `outstandings.service.spec.ts` (mock the Prisma client; mirror any existing service-spec harness in the repo — mock `prisma.outstanding.findUnique`):

```typescript
import { OutstandingsService } from './outstandings.service';

describe('OutstandingsService.findOneForAdmin include', () => {
  it('includes settlement batch/transfer/fund with business-No selects', async () => {
    const prisma: any = { outstanding: { findUnique: jest.fn().mockResolvedValue({ id: 'o1' }) } };
    const svc = new OutstandingsService(prisma);
    await svc.findOneForAdmin('o1');
    const arg = prisma.outstanding.findUnique.mock.calls[0][0];
    expect(arg.include.settlementBatch).toEqual({ select: { batchNo: true, settlementType: true, status: true } });
    expect(arg.include.settledByTransfer).toEqual({ select: { internalTxNo: true, pathLabel: true, status: true } });
    expect(arg.include.closedByInternalFund).toEqual({ select: { internalFundNo: true, status: true } });
    // existing includes preserved
    expect(arg.include.asset).toBe(true);
    expect(arg.include.swapTransaction).toBeDefined();
  });
});
```
> If `OutstandingsService`'s constructor needs more than `prisma` (check it — it may take only `PrismaService`), pass the matching mocks. Adjust the constructor call to the real signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- outstandings.service.spec.ts`
Expected: FAIL — `settlementBatch`/`settledByTransfer`/`closedByInternalFund` not in the include.

- [ ] **Step 3: Implement**

In `findOneForAdmin`, extend the `include`:
```typescript
      include: {
        asset: true,
        swapTransaction: {
          include: { fromAsset: true, toAsset: true, quote: true },
        },
        settlementBatch: { select: { batchNo: true, settlementType: true, status: true } },
        settledByTransfer: { select: { internalTxNo: true, pathLabel: true, status: true } },
        closedByInternalFund: { select: { internalFundNo: true, status: true } },
      },
```
(Leave `findAllForAdmin` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- outstandings.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/outstandings/outstandings.service.ts src/modules/clearing-settle/outstandings/outstandings.service.spec.ts
git commit -m "feat: enrich outstanding detail with settlement linkage (batch/transfer/fund Nos)"
```

---

## Task 2: Rewrite `SwapOutstandingList.tsx` to admin dark spec

**Files:**
- Modify (full rewrite): `admin-web/src/pages/SwapOutstandingList.tsx`

**No frontend test harness** → verify via typecheck/build + manual.

- [ ] **Step 1: Read the template + current file**

Read `admin-web/src/pages/funds-layer/SettlementListPage.tsx` (the dark-spec structure to mirror) and the current `SwapOutstandingList.tsx` (for the filters/columns/API to preserve).

- [ ] **Step 2: Replace the file with the admin-spec rewrite**

Write `admin-web/src/pages/SwapOutstandingList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

interface OutstandingItem {
  id: string;
  outstandingNo: string | null;
  direction: 'IN' | 'OUT';
  status: string;
  ownerNo: string | null;
  sourceNo: string | null;
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  createdAt: string;
}

interface FilterState {
  status: string;
  direction: string;
  outstandingNo: string;
  ownerNo: string;
  sourceNo: string;
  assetId: string;
  startDate: string;
  endDate: string;
}

const PAGE_SIZE = 20;
const DEFAULT_FILTERS: FilterState = {
  status: '', direction: '', outstandingNo: '', ownerNo: '', sourceNo: '', assetId: '', startDate: '', endDate: '',
};

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const SwapOutstandingList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('sourceType', 'SWAP');
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.status) params.set('status', next.status);
      if (next.direction) params.set('direction', next.direction);
      if (next.outstandingNo.trim()) params.set('outstandingNo', next.outstandingNo.trim());
      if (next.ownerNo.trim()) params.set('ownerNo', next.ownerNo.trim());
      if (next.sourceNo.trim()) params.set('sourceNo', next.sourceNo.trim());
      if (next.assetId.trim()) params.set('assetId', next.assetId.trim());
      if (next.startDate) params.set('startDate', new Date(next.startDate).toISOString());
      if (next.endDate) params.set('endDate', new Date(next.endDate).toISOString());

      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings?${params.toString()}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load swap outstandings.'));
      const data = await res.json();
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load swap outstandings.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  const fi = 'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
  const hasFilter = Object.values(filters).some(Boolean);
  const updateFilter = (k: keyof FilterState, v: string) => setFilters((p) => ({ ...p, [k]: v }));
  const handleSearch = () => void fetchItems(1, filters);
  const handleReset = () => { setFilters(DEFAULT_FILTERS); void fetchItems(1, DEFAULT_FILTERS); };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Swap Outstandings" meta={`${total} outstanding${total === 1 ? '' : 's'}`}>
        <button onClick={() => void fetchItems(currentPage)} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Status</option>
          <option value="OPEN">OPEN</option>
          <option value="LOCKED">LOCKED</option>
          <option value="SETTLED">SETTLED</option>
        </select>
        <select value={filters.direction} onChange={(e) => updateFilter('direction', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Direction</option>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
        <input value={filters.outstandingNo} onChange={(e) => updateFilter('outstandingNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Outstanding No" className={`${fi} w-40`} />
        <input value={filters.ownerNo} onChange={(e) => updateFilter('ownerNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Owner No" className={`${fi} w-36`} />
        <input value={filters.sourceNo} onChange={(e) => updateFilter('sourceNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Swap No" className={`${fi} w-40`} />
        <input value={filters.assetId} onChange={(e) => updateFilter('assetId', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Asset ID" className={`${fi} w-40`} />
        <input type="date" value={filters.startDate} onChange={(e) => updateFilter('startDate', e.target.value)} className={`${fi} w-36`} />
        <input type="date" value={filters.endDate} onChange={(e) => updateFilter('endDate', e.target.value)} className={`${fi} w-36`} />
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}><Search size={13} />Search</button>
        <button onClick={handleReset} disabled={!hasFilter} className={adminButtonClass('listSecondary')}>Reset</button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">{error}</div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {([
                ['Outstanding No', '180px'], ['Direction', '90px'], ['Status', '110px'], ['Owner No', '150px'],
                ['Swap No', '160px'], ['Asset / Amount', '180px'], ['Created', '150px'],
              ] as [string, string][]).map(([label, w]) => (
                <th key={label} style={{ width: w }} className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Asset / Amount' ? 'text-right' : 'text-left'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td></tr>)}
            {!loading && items.length === 0 && (<tr><td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No outstandings found.</td></tr>)}
            {!loading && items.map((item) => (
              <tr key={item.id} className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover" onClick={() => navigate('/dashboard/reconciliation/outstandings/' + item.id)}>
                <td className="px-4 py-2.5"><span className="font-mono text-[11px] font-semibold text-adm-amber">{item.outstandingNo || '—'}</span></td>
                <td className="px-4 py-2.5"><AdminBadge value={item.direction} /></td>
                <td className="px-4 py-2.5"><AdminBadge value={item.status} /></td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.ownerNo || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.sourceNo || '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[11px] text-adm-t1">{formatAssetAmount(item.amount, item.asset?.decimals)} {item.assetCode || item.asset?.code || ''}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">{fmt(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">{total > 0 ? `Showing ${items.length} / ${total} outstanding${total === 1 ? '' : 's'}` : 'No outstandings'}</span>
          {total > PAGE_SIZE && (<Pagination currentPage={currentPage} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(page) => void fetchItems(page)} />)}
        </div>
      </div>
    </div>
  );
};

export default SwapOutstandingList;
```

- [ ] **Step 3: Typecheck + build**

Run (from `admin-web/`): `npm run build 2>&1 | tail -20`
Expected: no TS errors for `SwapOutstandingList.tsx`. (If `PageTitleBar`/`AdminBadge`/`Pagination` import paths differ, fix to match the actual paths used by `SettlementListPage.tsx` — copy its import lines verbatim.)

- [ ] **Step 4: Manual check**

`npm run dev` (admin-web, port 3501) → log in → Swap Outstandings page. Confirm: dark theme, title bar with count, filters work, Status dropdown shows OPEN/LOCKED/SETTLED, rows clickable → detail, pagination shows when >20.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/SwapOutstandingList.tsx
git commit -m "feat(admin): rewrite Swap Outstandings list to admin dark spec + pagination + status fix"
```

---

## Task 3: Rewrite `SwapOutstandingDetail.tsx` to admin dark spec + Settlement linkage

**Files:**
- Modify (full rewrite): `admin-web/src/pages/SwapOutstandingDetail.tsx`

- [ ] **Step 1: Read the template + current file**

Read `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx` (dark detail structure) and the current `SwapOutstandingDetail.tsx` (content to preserve).

- [ ] **Step 2: Replace the file**

Write `admin-web/src/pages/SwapOutstandingDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

interface OutstandingDetail {
  id: string;
  outstandingNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerType: string;
  ownerNo: string | null;
  direction: string;
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  swapTransaction?: {
    swapNo: string | null; quoteNo: string | null; status: string;
    fromAmount: string; toAmount: string; exchangeRate: string;
    fromAsset?: { code?: string | null; decimals?: number | null } | null;
    toAsset?: { code?: string | null; decimals?: number | null } | null;
  } | null;
  settlementBatch?: { batchNo: string; settlementType: string | null; status: string } | null;
  settledByTransfer?: { internalTxNo: string; pathLabel: string | null; status: string } | null;
  closedByInternalFund?: { internalFundNo: string; status: string } | null;
}

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">{label}</span>
    <span className="font-mono text-[11px] text-adm-t1 break-all">{value}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="px-6 py-5 border-b border-adm-border">
    <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">{title}</h3>
    {children}
  </div>
);

const Link = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <span className="cursor-pointer font-mono text-[11px] text-adm-blue hover:underline" onClick={onClick}>{label}</span>
);

const SwapOutstandingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OutstandingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load outstanding detail.'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load outstanding detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  const back = () => navigate('/dashboard/reconciliation/outstandings');

  if (loading) return <div className="flex min-h-[400px] items-center justify-center font-mono text-[11px] text-adm-t3">Loading…</div>;
  if (error && !data) return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2.5">
        <button onClick={back} className={adminButtonClass('listSecondary')}><ArrowLeft size={13} />Back</button>
        <button onClick={() => void fetchDetail()} className={adminIconButtonClass()}><RefreshCw size={14} /></button>
      </div>
      <div className="m-5 border border-adm-red/20 bg-adm-red/6 px-4 py-3 font-mono text-[11px] text-adm-red">{error}</div>
    </div>
  );
  if (!data) return null;

  const s = data.swapTransaction;
  const hasLinkage = data.settlementBatch || data.settledByTransfer || data.closedByInternalFund;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-2.5">
        <button onClick={back} className={adminButtonClass('listSecondary')}><ArrowLeft size={13} />Back</button>
        <span className="font-mono text-[12px] font-semibold text-adm-amber">{data.outstandingNo || '—'}</span>
        <AdminBadge value={data.status} />
        <span className="ml-auto" />
        <button onClick={() => void fetchDetail()} className={adminIconButtonClass()} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex-1 overflow-auto">
        <Section title="Overview">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
            <Field label="Outstanding No" value={data.outstandingNo || '—'} />
            <Field label="Status" value={<AdminBadge value={data.status} />} />
            <Field label="Direction" value={<AdminBadge value={data.direction} />} />
            <Field label="Owner" value={`${data.ownerType} · ${data.ownerNo || '—'}`} />
            <Field label="Source" value={`${data.sourceType} · ${data.sourceNo || '—'}`} />
            <Field label="Asset" value={data.assetCode || data.asset?.code || '—'} />
            <Field label="Amount" value={formatAssetAmount(data.amount, data.asset?.decimals)} />
            <Field label="Created" value={new Date(data.createdAt).toLocaleString()} />
            <Field label="Updated" value={new Date(data.updatedAt).toLocaleString()} />
          </div>
        </Section>

        <Section title="Linked Swap">
          {s ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <Field label="Swap No" value={s.swapNo || '—'} />
              <Field label="Quote No" value={s.quoteNo || '—'} />
              <Field label="Swap Status" value={<AdminBadge value={s.status} />} />
              <Field label="Pair" value={`${s.fromAsset?.code || '-'} → ${s.toAsset?.code || '-'}`} />
              <Field label="Amounts" value={`${formatAssetAmount(s.fromAmount, s.fromAsset?.decimals)} → ${formatAssetAmount(s.toAmount, s.toAsset?.decimals)}`} />
              <Field label="Exchange Rate" value={formatRate8(s.exchangeRate)} />
            </div>
          ) : (<div className="font-mono text-[11px] italic text-adm-t3">No swap linked.</div>)}
        </Section>

        <Section title="Settlement Linkage">
          {hasLinkage ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <Field label="Settlement Batch" value={data.settlementBatch ? (
                <Link label={`${data.settlementBatch.batchNo} (${data.settlementBatch.settlementType || '—'} · ${data.settlementBatch.status})`} onClick={() => navigate('/funds-layer/settlements/' + data.settlementBatch!.batchNo)} />
              ) : '—'} />
              <Field label="Settled By Transfer" value={data.settledByTransfer ? (
                <Link label={`${data.settledByTransfer.internalTxNo} (${data.settledByTransfer.pathLabel || '—'} · ${data.settledByTransfer.status})`} onClick={() => navigate('/funds-layer/transfers/' + data.settledByTransfer!.internalTxNo)} />
              ) : '—'} />
              <Field label="Closed By Fund" value={data.closedByInternalFund ? (
                <Link label={`${data.closedByInternalFund.internalFundNo} (${data.closedByInternalFund.status})`} onClick={() => navigate('/funds-layer/funds/' + data.closedByInternalFund!.internalFundNo)} />
              ) : '—'} />
            </div>
          ) : (<div className="font-mono text-[11px] italic text-adm-t3">Not yet settled.</div>)}
        </Section>
      </div>
    </div>
  );
};

export default SwapOutstandingDetail;
```

- [ ] **Step 3: Typecheck + build**

Run (from `admin-web/`): `npm run build 2>&1 | tail -20`
Expected: no TS errors for `SwapOutstandingDetail.tsx`. Fix import paths to match the real ones if needed (copy from `SettlementDetailPage.tsx`). If `text-adm-blue` isn't a defined color token, use the token `SettlementDetailPage.tsx` uses for clickable links (grep it there).

- [ ] **Step 4: Manual check**

In the running admin: open a SETTLED outstanding → confirm dark theme, Overview + Linked Swap + Settlement Linkage sections; the batch/transfer/fund show business Nos and click through to their detail pages; open an OPEN outstanding → Settlement Linkage shows "Not yet settled."

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/SwapOutstandingDetail.tsx
git commit -m "feat(admin): rewrite Swap Outstanding detail to admin dark spec + settlement linkage"
```

---

## Final verification

- [ ] From `admin-web/`: `npm run build` — clean (no TS errors in the two pages).
- [ ] From repo root: `npm test -- outstandings.service.spec.ts` — green.
- [ ] Manual: list (dark, paginated, SETTLED filter) + detail (3 sections, linkage cross-links) both render correctly.

---

## Self-Review (spec coverage)

| Spec section | Task |
|---|---|
| §2 list rewrite (PageTitleBar/AdminBadge/Pagination/dark filter/row-click) | Task 2 |
| §2 status fix CLOSED→SETTLED | Task 2 (dropdown OPEN/LOCKED/SETTLED) |
| §2 pagination added | Task 2 (skip/take + Pagination) |
| §2 request-seq guard | Task 2 (`requestSeqRef`) |
| §3 detail rewrite (Overview / Linked Swap) | Task 3 |
| §3 Settlement linkage section + business-key cross-links | Task 3 + Task 1 (backend include) |
| §4 backend findOneForAdmin include enrichment | Task 1 |
| §5 no UUID display, keep `:id` routing, keep routes/nav | Tasks 2/3 (display Nos; navigate by id; routes unchanged) |
| §6 out of scope (OutstandingSettlement, nav move, findOneByNo) | not touched |

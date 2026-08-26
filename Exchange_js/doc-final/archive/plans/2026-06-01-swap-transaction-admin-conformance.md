# Swap Transaction Admin Pages — Conformance Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin Swap Transaction list and detail pages as read-only monitors that conform to `doc-final/rules/frontend-admin.md` (adm-* tokens, two-column detail layout, shared primitives), removing dead pre–Phase-C compliance/risk scaffolding and surfacing the pricing/spread data the backend now returns.

**Architecture:** Pure frontend change in `admin-web`. No backend edits — `GET /admin/swap-transactions` (returns `{items, total}`) and `GET /admin/swap-transactions/:id` already return the full record (incl. `spreadAmount`, `netToAmount`, `feeAmount`, `feeBreakdown`). The list page mirrors the conforming `SwapQuoteList.tsx`; the detail page mirrors `DepositTransactionDetail.tsx`. Both pages are full-file replacements.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (`adm-*` design tokens). Shared primitives: `DetailPageHeader`/`DetailCard`/`InfoField`/`JsonBlock` (`components/compliance/DetailPageComponents`), `SidebarGroup`/`SidebarKV` (`components/ui/SidebarPrimitives`), `AdminBadge` (`components/ui/AdminBadge`), `Pagination` (`components/common/Pagination`), `PageTitleBar` (`components/ui/PageTitleBar`).

**Verification:** No component-test harness exists for these pages; the project's gate is the TypeScript build. Every task verifies with `cd admin-web && npm run build` (`tsc -b && vite build`) expecting a clean exit, plus the manual browser checks noted in Task 3.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `admin-web/src/pages/SwapTransactionList.tsx` | Read-only list: filters (Swap No, Owner, date range), adm-* table, Spread column, Pagination | Full replace |
| `admin-web/src/pages/SwapTransactionDetail.tsx` | Read-only two-column detail: Hero, L1 Eligibility tile, Conversion, Pricing breakdown, Status History, Technical Detail; sidebar Identity + Lifecycle | Full replace |
| `doc-final/rules/frontend-admin.md` | Record `SwapTransaction` sidebar field selection (mandatory per rules) | Modify (add one table row) |

No new files. No shared-primitive changes.

---

### Task 1: List page — read-only adm-* rebuild

**Files:**
- Modify (full replace): `admin-web/src/pages/SwapTransactionList.tsx`

- [ ] **Step 1: Replace the entire file with the conforming list page**

Replace the full contents of `admin-web/src/pages/SwapTransactionList.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface SwapAsset {
  currency: string;
  code: string;
  type: string;
  decimals?: number | null;
}

interface SwapTransactionListItem {
  id: string;
  swapNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  fromAsset: SwapAsset;
  fromAmount: string;
  toAsset: SwapAsset;
  toAmount: string;
  netToAmount: string | null;
  spreadAmount: string | null;
  exchangeRate: string;
  createdAt: string;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  } | null;
}

interface FilterState {
  swapNo: string;
  ownerId: string;
  startDate: string;
  endDate: string;
}

const PAGE_SIZE = 20;

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const SwapTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SwapTransactionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    swapNo: '',
    ownerId: '',
    startDate: '',
    endDate: '',
  });

  const hasFilters = useMemo(
    () =>
      !!filters.swapNo.trim() ||
      !!filters.ownerId.trim() ||
      !!filters.startDate ||
      !!filters.endDate,
    [filters],
  );

  const fetchData = async (pageNum = page, overrides?: Partial<FilterState>) => {
    setLoading(true);
    setError('');
    try {
      const f = { ...filters, ...overrides };
      const params = new URLSearchParams();
      params.set('skip', String((pageNum - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.swapNo.trim()) params.set('swapNo', f.swapNo.trim());
      if (f.ownerId.trim()) params.set('ownerId', f.ownerId.trim());
      if (f.startDate) params.set('startDate', f.startDate);
      if (f.endDate) params.set('endDate', f.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions?${params.toString()}`,
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to fetch swap transactions'));
      }
      const body = await res.json();
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch swap transactions', err);
      setError('Failed to load swap transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(1);
  }, []);

  const handleSearch = () => {
    setPage(1);
    void fetchData(1);
  };

  const handleReset = () => {
    const empty: FilterState = { swapNo: '', ownerId: '', startDate: '', endDate: '' };
    setFilters(empty);
    setPage(1);
    void fetchData(1, empty);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    void fetchData(p);
  };

  const inputCls =
    'rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none';

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar title="Swap Transactions" meta="Monitor completed swap conversions">
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filters */}
      <div className="border-b border-adm-border bg-adm-panel px-5 py-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input
            value={filters.swapNo}
            onChange={(e) => setFilters((f) => ({ ...f, swapNo: e.target.value }))}
            placeholder="Swap No"
            className={inputCls}
          />
          <input
            value={filters.ownerId}
            onChange={(e) => setFilters((f) => ({ ...f, ownerId: e.target.value }))}
            placeholder="Owner No / Id"
            className={inputCls}
          />
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            className={inputCls}
            title="Start Date"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            className={inputCls}
            title="End Date"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
            Search
          </button>
          <button
            onClick={handleReset}
            className={adminButtonClass('listSecondary')}
            disabled={!hasFilters || loading}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-adm-border bg-adm-card">
            <tr>
              {['Swap No', 'Owner', 'Sell (From)', 'Buy (Net)', 'Rate', 'Spread', 'Status', 'Created', ''].map(
                (h, i) => (
                  <th
                    key={h || `col-${i}`}
                    className="px-5 py-2.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border">
            {error ? (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-adm-red">
                  {error}
                </td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-adm-t3">
                  <RefreshCw className="mx-auto mb-2 animate-spin text-adm-amber" size={20} />
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center font-mono text-xs text-adm-t3">
                  No swap transactions found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-adm-hover">
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      className={adminButtonClass('rowKeyLink')}
                      onClick={() => navigate(`/exchange/swap-transactions/${item.id}`)}
                    >
                      {item.swapNo}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    {item.customer ? (
                      <div className="flex flex-col">
                        <span className="text-adm-t1">
                          {[item.customer.firstName, item.customer.lastName]
                            .filter(Boolean)
                            .join(' ') || '—'}
                        </span>
                        <span className="font-mono text-[10px] text-adm-t3">
                          {item.customer.customerNo}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-adm-t2">{item.ownerNo || item.ownerType}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-red">
                    {formatAssetAmount(item.fromAmount, item.fromAsset.decimals)}{' '}
                    {item.fromAsset.currency}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-green">
                    {formatAssetAmount(item.netToAmount ?? item.toAmount, item.toAsset.decimals)}{' '}
                    {item.toAsset.currency}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {formatRate8(item.exchangeRate)}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {item.spreadAmount
                      ? `${formatAssetAmount(item.spreadAmount, item.toAsset.decimals)} ${item.toAsset.currency}`
                      : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <AdminBadge value={item.status} />
                  </td>
                  <td className="px-5 py-3 font-mono text-[10px] text-adm-t3">{fmt(item.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      className={adminButtonClass('rowLink')}
                      onClick={() => navigate(`/exchange/swap-transactions/${item.id}`)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={page}
        totalItems={total}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

export default SwapTransactionList;
```

- [ ] **Step 2: Build to verify typecheck passes**

Run: `cd admin-web && npm run build`
Expected: exits 0; no TypeScript errors referencing `SwapTransactionList.tsx`. (`vite build` emits a bundle.)

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/SwapTransactionList.tsx
git commit -m "feat(admin): rebuild Swap Transaction list as read-only adm-* monitor"
```

---

### Task 2: Detail page — two-column read-only rebuild

**Files:**
- Modify (full replace): `admin-web/src/pages/SwapTransactionDetail.tsx`

- [ ] **Step 1: Replace the entire file with the conforming detail page**

Replace the full contents of `admin-web/src/pages/SwapTransactionDetail.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface SwapAsset {
  currency: string;
  code: string;
  type: string;
  network: string | null;
  decimals: number;
}

interface SwapTransactionDetailData {
  id: string;
  swapNo: string;
  quoteId: string | null;
  quoteNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  fromAssetId: string;
  fromAssetCode: string | null;
  fromAmount: string;
  fromAsset: SwapAsset;
  toAssetId: string;
  toAssetCode: string | null;
  toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null;
  feeCurrency: string | null;
  feeBreakdown: string | null;
  spreadAmount: string | null;
  toAsset: SwapAsset;
  exchangeRate: string;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  } | null;
  statusHistory: string | null;
}

interface SwapFx {
  baseRate?: string;
  quotedRate?: string;
  markupBps?: number;
  effectiveBaseRate?: string;
}

const parseFx = (feeBreakdown: string | null): SwapFx | null => {
  if (!feeBreakdown) return null;
  try {
    const parsed = JSON.parse(feeBreakdown);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first && first.fx ? (first.fx as SwapFx) : null;
  } catch {
    return null;
  }
};

/* ── Page Component ─────────────────────────────────────────── */

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load swap detail'));
        navigate('/exchange/swap-transactions');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch swap detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading swap detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const fx = parseFx(data.feeBreakdown);
  const toDecimals = data.toAsset.decimals;
  const fromDecimals = data.fromAsset.decimals;
  const ownerNo = data.ownerNo || data.customer?.customerNo || null;
  const pair = `${data.fromAsset.code} → ${data.toAsset.code}`;
  const netDisplay = `${formatAssetAmount(data.netToAmount ?? data.toAmount, toDecimals)} ${data.toAsset.currency}`;
  const feeDisplay = `${formatAssetAmount(data.feeAmount ?? '0', toDecimals)} ${data.feeCurrency || data.toAsset.currency}`;

  const ownerLink = ownerNo ? (
    <button
      onClick={() => navigate(`/customers/${data.ownerId}`)}
      className="text-adm-blue hover:underline"
    >
      {ownerNo}
    </button>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/exchange/swap-transactions')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Swaps"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">{data.swapNo}</div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <AdminBadge value={data.status} />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Pair
                </span>
                <span className="font-mono text-adm-t1">{pair}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Net Received
                </span>
                <span className="font-semibold text-adm-t1">{netDisplay}</span>
              </div>
              {ownerNo && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Owner
                  </span>
                  {ownerLink}
                </div>
              )}
            </div>
          </div>

          {/* 2. Compliance — L1 Eligibility */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Compliance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-adm-bg p-3 border-l-[3px] border-adm-green">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  L1 · Eligibility
                </div>
                <div className="mt-1 text-sm font-bold text-adm-green">PASSED</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Pre-execution gate</div>
              </div>
            </div>
          </div>

          {/* 3. Conversion */}
          <DetailCard title="Conversion" columns={2}>
            <InfoField
              label="Sell Asset"
              value={`${data.fromAssetCode || data.fromAsset.code} · ${data.fromAsset.type}`}
              accent
            />
            <InfoField
              label="Buy Asset"
              value={`${data.toAssetCode || data.toAsset.code} · ${data.toAsset.type}`}
              accent
            />
            <InfoField
              label="Sell Amount"
              value={`${formatAssetAmount(data.fromAmount, fromDecimals)} ${data.fromAsset.currency}`}
              highlight
            />
            <InfoField label="Net Received" value={netDisplay} highlight />
            <InfoField
              label="Gross Out"
              value={`${formatAssetAmount(data.toAmount, toDecimals)} ${data.toAsset.currency}`}
            />
            <InfoField label="Fee" value={feeDisplay} />
          </DetailCard>

          {/* 4. Pricing */}
          <DetailCard title="Pricing" columns={2}>
            {fx?.baseRate ? (
              <InfoField label="Market Rate" value={formatRate8(fx.baseRate)} mono />
            ) : null}
            <InfoField label="Quoted All-in Rate" value={formatRate8(data.exchangeRate)} highlight />
            {fx?.markupBps !== undefined ? (
              <InfoField label="Spread (bps)" value={String(fx.markupBps)} mono />
            ) : null}
            <InfoField
              label="Spread (amount)"
              value={
                data.spreadAmount
                  ? `${formatAssetAmount(data.spreadAmount, toDecimals)} ${data.toAsset.currency}`
                  : '—'
              }
              mono
            />
            <InfoField label="Fee" value={feeDisplay} />
            <InfoField label="Net Out" value={netDisplay} highlight />
          </DetailCard>

          {/* 5. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 6. Technical Detail */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Technical Detail
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField label="Quote No" value={data.quoteNo} mono />
              <InfoField label="Quote ID" value={data.quoteId} mono />
              <InfoField label="Trace ID" value={data.traceId} mono />
              <InfoField label="From Asset ID" value={data.fromAssetId} mono />
              <InfoField label="To Asset ID" value={data.toAssetId} mono />
            </div>
            <div className="mt-3">
              <JsonBlock title="Fee Breakdown (raw)" value={data.feeBreakdown} compact />
            </div>
          </div>
        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Swap No" value={data.swapNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Owner" value={ownerLink} />
            <SidebarKV label="Pair" value={`${data.fromAsset.code}/${data.toAsset.code}`} mono />
            <SidebarKV label="Net Received" value={netDisplay} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

/* ── StatusTimeline (adm-* tokens) ── */

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed)) {
      return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
    }
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return <div className="p-4 text-sm text-adm-red">Error parsing history</div>;
  }

  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No events</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-6 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.timestamp || item.changedAt || idx}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className="h-3 w-3 rounded-full bg-adm-green" />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className="rounded border border-adm-green/30 bg-adm-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-adm-green">
                {item.status || 'UNKNOWN'}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.note || item.reason || 'No reason provided'}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">
                {item.operator || item.operatorId || item.actorType || 'SYSTEM'}
              </span>
              <span>·</span>
              <time className="font-mono">
                {new Date(item.timestamp || item.changedAt || 0).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SwapTransactionDetail;
```

- [ ] **Step 2: Build to verify typecheck passes**

Run: `cd admin-web && npm run build`
Expected: exits 0; no TypeScript errors. In particular, confirm there are NO "declared but never used" errors — the old file's `handleAction`, reject-modal state, `availableActions`, `WorkflowAction`, and the Risk/Alert/Case imports are gone because this is a full replace.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/SwapTransactionDetail.tsx
git commit -m "feat(admin): rebuild Swap Transaction detail as two-column read-only monitor"
```

---

### Task 3: Record sidebar fields in rules doc + final verification

**Files:**
- Modify: `doc-final/rules/frontend-admin.md` (Per-entity Sidebar Fields table)

- [ ] **Step 1: Add the SwapTransaction row to the Per-entity Sidebar Fields table**

In `doc-final/rules/frontend-admin.md`, find the table that ends with the `Payin` row:

```markdown
| **Payin** | `payinNo`, `status` badge, `type`, `asset.code`, linked `depositNo` | `createdAt`, `completedAt` |
```

Add immediately after it:

```markdown
| **SwapTransaction** | `swapNo`, `status` badge, `ownerNo`, pair (`fromCode/toCode`), `netToAmount` | `createdAt`, `completedAt` |
```

- [ ] **Step 2: Final build verification**

Run: `cd admin-web && npm run build`
Expected: exits 0 with a clean bundle.

- [ ] **Step 3: Manual E2E checklist (against running stack — admin 3501, backend 3500)**

Verify each, no code changes expected:
1. Navigate to Swap Transactions list: rows render with `adm-*` styling (dark surfaces, mono headers); Spread column populated for swaps that have a spread; Status shows a SUCCESS badge.
2. Filters: enter a Swap No → Search narrows results; pick a start/end date → Search narrows; Reset clears and reloads; pagination Prev/Next changes the page and the "Showing X to Y of N" count updates.
3. Click a Swap No → detail page: nav header shows only `← Swaps` + refresh (no entity title/subtitle); Hero shows swapNo (amber mono) + Status/Pair/Net Received/Owner; `L1 · Eligibility: PASSED` tile renders green.
4. Pricing section shows Market Rate > Quoted All-in Rate, Spread (bps) and Spread (amount) populated; Net Out matches the Hero's Net Received.
5. No Approve/Flag/Reject buttons anywhere; no Risk & Trace card; no Open Alerts/Case buttons; no amber Compliance Center notice.
6. Sidebar shows Identity (5 rows) + Lifecycle (Created, Completed) and NO Actions block.
7. Browser console is clean (no errors/warnings from these pages).

- [ ] **Step 4: Commit**

```bash
git add doc-final/rules/frontend-admin.md
git commit -m "docs(rules): record SwapTransaction sidebar field selection"
```

---

## Self-Review Notes

- **Spec coverage:** List rebuild (Task 1) covers tokens, filters, removed status dropdown, Spread column, Pagination. Detail rebuild (Task 2) covers two-column layout, Hero, L1 Eligibility tile, Conversion, Pricing-with-spread, Status History, Technical Detail (no TB refs), sidebar with no Actions, and removal of all dead compliance/risk UI. Rules-doc row (Task 3) satisfies the mandatory per-entity record.
- **Backend:** unchanged — `findAll`/`findOne` already include `spreadAmount`, `netToAmount`, `feeAmount`, `feeBreakdown`, relations.
- **Type consistency:** `SwapAsset.decimals` is `number | null | undefined` in the list (matches `formatAssetAmount(value, decimals?)`) and `number` in the detail (relation always present on `findOne`). `parseFx` returns `SwapFx | null`; Pricing rows guard on `fx?.baseRate` / `fx?.markupBps`. Navigation paths (`/exchange/swap-transactions`, `/exchange/swap-transactions/:id`, `/customers/:ownerId`) match the existing router and the Deposit reference.
- **No backend test harness** for these React pages; verification is the TypeScript build + manual E2E, consistent with how the rest of `admin-web` is verified.

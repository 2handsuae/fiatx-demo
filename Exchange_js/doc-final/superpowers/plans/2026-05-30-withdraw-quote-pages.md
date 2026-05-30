# Withdraw Quote Admin Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create dedicated WithdrawQuoteList and WithdrawQuoteDetail pages in the admin panel with `adm-*` dark theme, pagination, and two-column detail layout.

**Architecture:** Two new page components consuming existing backend APIs (`GET /admin/pricing/quotes?business=WITHDRAWAL` and `GET /admin/pricing/quotes/WITHDRAWAL/:id`). Reuses shared primitives (DetailPageHeader, DetailCard, InfoField, JsonBlock, SidebarGroup, SidebarKV, AdminBadge, Pagination, PageTitleBar). No backend changes.

**Tech Stack:** React, React Router, Tailwind CSS, `adm-*` design tokens

---

### Task 1: Permission Constants + AdminBadge Status Mappings

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/components/ui/AdminBadge.tsx`

- [ ] **Step 1: Add permission constants**

In `admin-web/src/rbac/permissions.ts`, add two new entries after `WITHDRAWAL_FEE_LEVELS_READ`:

```typescript
  WITHDRAW_QUOTES_READ: 'api.get.admin_pricing_quotes_withdrawal',
  WITHDRAW_QUOTES_DETAIL_READ: 'api.get.admin_pricing_quotes_withdrawal_id',
```

- [ ] **Step 2: Add AdminBadge status mappings for USED and EXPIRED**

In `admin-web/src/components/ui/AdminBadge.tsx`, add two entries to `STATUS_MAP`:

```typescript
  USED:             'info',
  EXPIRED:          'deleted',
```

`USED` → `info` (neutral gray) since it represents a consumed quote — neither positive nor negative.
`EXPIRED` → `deleted` (dim gray) since it represents an inactive/timed-out state.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/components/ui/AdminBadge.tsx
git commit -m "feat(admin): add withdraw quote permission constants and badge mappings"
```

---

### Task 2: Route + Navigation Registration

**Files:**
- Modify: `admin-web/src/App.tsx` (lines ~127, ~300)
- Modify: `admin-web/src/components/DashboardLayout.tsx` (lines ~412-423)

- [ ] **Step 1: Add lazy imports in App.tsx**

After line 128 (`const WithdrawalFeeLevelDetail = ...`), add:

```typescript
const WithdrawQuoteList = lazy(() => import('./pages/WithdrawQuoteList'));
const WithdrawQuoteDetail = lazy(() => import('./pages/WithdrawQuoteDetail'));
```

- [ ] **Step 2: Add routes in App.tsx**

After the existing `pricing/quotes/:business/:id` route block (line ~303), add:

```typescript
            <Route
              path="pricing/withdraw-quotes"
              element={withPermission(<WithdrawQuoteList />, [PERMISSIONS.WITHDRAW_QUOTES_READ])}
            />
            <Route
              path="pricing/withdraw-quotes/:id"
              element={withPermission(<WithdrawQuoteDetail />, [PERMISSIONS.WITHDRAW_QUOTES_DETAIL_READ])}
            />
```

- [ ] **Step 3: Add navigation entry in DashboardLayout.tsx**

In the Pricing section's `children` array, after the "Quote Center" entry (line ~417) and before the "Withdrawal Fee Levels" entry, add:

```typescript
        {
          path: '/dashboard/pricing/withdraw-quotes',
          label: 'Withdraw Quotes',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAW_QUOTES_READ],
        },
```

Note: `FileText` is already imported via lucide-react in DashboardLayout. Verify this — if not, add it to the existing import.

- [ ] **Step 4: Verify imports**

Ensure `PERMISSIONS` import in DashboardLayout includes the new constants (it imports the whole object so no change needed).

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(admin): register withdraw quote routes and navigation"
```

---

### Task 3: WithdrawQuoteList Page

**Files:**
- Create: `admin-web/src/pages/WithdrawQuoteList.tsx`

- [ ] **Step 1: Create the page file**

Create `admin-web/src/pages/WithdrawQuoteList.tsx` with the full implementation:

```typescript
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
import { formatAssetAmount } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface WithdrawQuoteListItem {
  quoteId: string;
  quoteNo: string | null;
  business: 'WITHDRAWAL';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  primaryAssetCurrency: string;
  amount: string | null;
  feeTotal: string;
  feeCurrency: string;
  linkedBusinessNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
}

interface FilterState {
  status: string;
  quoteNo: string;
  ownerNo: string;
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

const WithdrawQuoteList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithdrawQuoteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    status: '',
    quoteNo: '',
    ownerNo: '',
    startDate: '',
    endDate: '',
  });

  const hasFilters = useMemo(
    () =>
      !!filters.status ||
      !!filters.quoteNo.trim() ||
      !!filters.ownerNo.trim() ||
      !!filters.startDate ||
      !!filters.endDate,
    [filters],
  );

  const fetchData = async (pageNum = page, overrides?: Partial<FilterState>) => {
    setLoading(true);
    try {
      const f = { ...filters, ...overrides };
      const params = new URLSearchParams();
      params.set('business', 'WITHDRAWAL');
      params.set('skip', String((pageNum - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.status) params.set('status', f.status);
      if (f.quoteNo.trim()) params.set('quoteNo', f.quoteNo.trim());
      if (f.ownerNo.trim()) params.set('ownerNo', f.ownerNo.trim());
      if (f.startDate) params.set('startDate', f.startDate);
      if (f.endDate) params.set('endDate', f.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pricing/quotes?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch withdraw quotes'));
      const body = await res.json();
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch withdraw quotes', err);
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
    const empty: FilterState = { status: '', quoteNo: '', ownerNo: '', startDate: '', endDate: '' };
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
  const selectCls =
    'rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1 focus:border-adm-amber focus:outline-none';

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Withdraw Quotes"
        meta="Read-only withdrawal pricing quote snapshots for auditability"
      >
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
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className={selectCls}
          >
            <option value="">All Status</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="USED">USED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <input
            value={filters.quoteNo}
            onChange={(e) => setFilters((f) => ({ ...f, quoteNo: e.target.value }))}
            placeholder="Quote No"
            className={inputCls}
          />
          <input
            value={filters.ownerNo}
            onChange={(e) => setFilters((f) => ({ ...f, ownerNo: e.target.value }))}
            placeholder="Owner No"
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
              {['Quote No', 'Status', 'Owner No', 'Asset', 'Amount', 'Fee', 'Linked Withdraw', 'Created'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-5 py-2.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-adm-t3">
                  <RefreshCw className="mx-auto mb-2 animate-spin text-adm-amber" size={20} />
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center font-mono text-xs text-adm-t3">
                  No withdraw quotes found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.quoteId}
                  className="transition-colors hover:bg-adm-hover"
                >
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      className={adminButtonClass('rowKeyLink')}
                      onClick={() =>
                        navigate(`/dashboard/pricing/withdraw-quotes/${item.quoteId}`)
                      }
                    >
                      {item.quoteNo || '—'}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <AdminBadge value={item.status} />
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {item.ownerNo || '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {item.primaryAssetCurrency || '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {item.amount
                      ? `${formatAssetAmount(item.amount)} ${item.primaryAssetCurrency}`
                      : '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {formatAssetAmount(item.feeTotal)} {item.feeCurrency}
                  </td>
                  <td className="px-5 py-3 font-mono text-adm-t2">
                    {item.linkedBusinessNo || '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-[10px] text-adm-t3">
                    {fmt(item.createdAt)}
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

export default WithdrawQuoteList;
```

- [ ] **Step 2: Verify the page compiles**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to WithdrawQuoteList.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WithdrawQuoteList.tsx
git commit -m "feat(admin): add WithdrawQuoteList page with filters and pagination"
```

---

### Task 4: WithdrawQuoteDetail Page

**Files:**
- Create: `admin-web/src/pages/WithdrawQuoteDetail.tsx`

- [ ] **Step 1: Create the page file**

Create `admin-web/src/pages/WithdrawQuoteDetail.tsx` with the full implementation:

```typescript
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface FeeItem {
  code: string;
  label: string;
  amount: string;
  currency: string;
}

interface LinkedWithdrawal {
  withdrawNo: string | null;
  status: string;
  createdAt: string;
}

interface WithdrawQuoteDetailData {
  quoteId: string;
  quoteNo: string | null;
  business: 'WITHDRAWAL';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  fees: FeeItem[];
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
  withdrawal: {
    assetId: string;
    assetCode: string;
    asset?: { code: string; decimals?: number | null; network?: string | null } | null;
    amount: string;
    segment: string;
    riskTier: string;
    matchedAssetEntryId: string;
    matchedTierId: string;
    matchedTierName: string;
    linkedWithdrawals: LinkedWithdrawal[];
  };
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const WithdrawQuoteDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawQuoteDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pricing/quotes/WITHDRAWAL/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load quote detail'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch withdraw quote detail', err);
      setError(err instanceof Error ? err.message : 'Failed to load quote detail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  /* Loading state */
  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-adm-t3">
        <RefreshCw className="mb-2 animate-spin text-adm-amber" size={22} />
        Loading quote detail...
      </div>
    );
  }

  /* Error state (no data loaded) */
  if (error && !data) {
    return (
      <div className="p-6">
        <DetailPageHeader
          title="Withdraw Quote Detail"
          onBack={() => navigate('/dashboard/pricing/withdraw-quotes')}
          onRefresh={() => void fetchDetail()}
          backLabel="Back to Withdraw Quotes"
        />
        <div className="mt-4 rounded-lg border border-adm-red/30 bg-adm-red/5 px-4 py-3 font-mono text-xs text-adm-red">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const w = data.withdrawal;
  const fees: FeeItem[] = Array.isArray(data.fees) ? data.fees : [];
  const totals = data.totals ?? {};
  const linkedWithdrawals: LinkedWithdrawal[] = w?.linkedWithdrawals ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <DetailPageHeader
        title="Withdraw Quote Detail"
        subtitle={data.quoteNo}
        onBack={() => navigate('/dashboard/pricing/withdraw-quotes')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Withdraw Quotes"
      >
        <AdminBadge value={data.status} />
      </DetailPageHeader>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main body */}
        <div className="flex-1 space-y-4 overflow-auto p-5">
          {error ? (
            <div className="rounded-lg border border-adm-red/30 bg-adm-red/5 px-4 py-3 font-mono text-xs text-adm-red">
              {error}
            </div>
          ) : null}

          {/* Withdrawal Terms */}
          <DetailCard title="Withdrawal Terms">
            <InfoField label="Asset Code" value={w.assetCode} mono />
            <InfoField label="Network" value={w.asset?.network} mono />
            <InfoField
              label="Amount"
              value={
                w.amount
                  ? `${formatAssetAmount(w.amount, w.asset?.decimals)} ${w.assetCode}`
                  : null
              }
              mono
            />
            <InfoField label="Segment" value={w.segment} />
            <InfoField label="Risk Tier" value={w.riskTier} />
            <InfoField
              label="Matched Tier"
              value={
                w.matchedTierName
                  ? `${w.matchedTierName} (${w.matchedTierId})`
                  : w.matchedTierId
              }
              mono
            />
          </DetailCard>

          {/* Fee Breakdown */}
          <DetailCard title="Fee Breakdown" columns={1}>
            {fees.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-adm-border">
                      {['Code', 'Label', 'Amount', 'Currency'].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {fees.map((fee, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                          {fee.code}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-adm-t1">{fee.label}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t1">
                          {formatAssetAmount(fee.amount)}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                          {fee.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Totals */}
                {Object.keys(totals).length > 0 ? (
                  <div className="mt-2 border-t border-adm-border pt-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                      Totals
                    </p>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {Object.entries(totals).map(([currency, amount]) => (
                        <span
                          key={currency}
                          className="font-mono text-[11px] font-semibold text-adm-amber"
                        >
                          {formatAssetAmount(amount)} {currency}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">No fee items</p>
            )}
          </DetailCard>

          {/* Linked Withdrawals */}
          {linkedWithdrawals.length > 0 ? (
            <DetailCard title="Linked Withdrawals" columns={1}>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-adm-border">
                    {['Withdraw No', 'Status', 'Created'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {linkedWithdrawals.map((lw, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                        {lw.withdrawNo || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <AdminBadge value={lw.status} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                        {fmt(lw.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DetailCard>
          ) : null}

          {/* Technical Detail */}
          <DetailCard title="Technical Detail" columns={1}>
            <JsonBlock title="Policy Reference" value={data.policyRef} />
          </DetailCard>
        </div>

        {/* Sidebar */}
        <aside className="hidden w-[272px] shrink-0 overflow-auto border-l border-adm-border bg-adm-panel px-4 lg:block">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Business" value="WITHDRAWAL" />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Owner No" value={data.ownerNo} mono />
            <SidebarKV label="Quote No" value={data.quoteNo} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(data.createdAt)} />
            <SidebarKV label="Expires" value={fmt(data.expiresAt)} />
            <SidebarKV label="Used" value={fmt(data.usedAt)} />
            <SidebarKV label="Cancelled" value={fmt(data.cancelledAt)} />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};

export default WithdrawQuoteDetail;
```

- [ ] **Step 2: Verify the page compiles**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to WithdrawQuoteDetail.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WithdrawQuoteDetail.tsx
git commit -m "feat(admin): add WithdrawQuoteDetail page with two-column layout"
```

---

### Task 5: Visual Verification

**Files:** None (read-only verification)

- [ ] **Step 1: Start services**

Ensure backend + admin-web are running on ports 3500 and 3501.

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run dev:start
```

- [ ] **Step 2: Login and navigate to Withdraw Quotes list**

Open `http://localhost:3501`, log in as `admin@fiatx.com` / `123456`.
Navigate to Pricing → Withdraw Quotes in sidebar.

Verify:
- Page title bar shows "Withdraw Quotes"
- Filter bar has 5 controls: Status dropdown, Quote No input, Owner No input, Start Date, End Date
- Table has 8 columns: Quote No, Status, Owner No, Asset, Amount, Fee, Linked Withdraw, Created
- Pagination appears at bottom if > 20 items
- Clicking a row's Quote No navigates to detail

- [ ] **Step 3: Verify detail page**

Click on any quote to open detail. Verify:
- Hero header shows quote number in amber, status badge
- Back button returns to list
- Left side: Withdrawal Terms card, Fee Breakdown card (table), Linked Withdrawals card (if any), Technical Detail card (JsonBlock)
- Right side: 272px sidebar with Identity Summary and Lifecycle groups
- All `adm-*` dark theme applied consistently

- [ ] **Step 4: Verify filters work**

Return to list. Try:
- Filter by status "USED" → only USED quotes shown
- Enter partial quote number → filtered results
- Reset button clears all and re-fetches
- Date range filter limits results

- [ ] **Step 5: Commit (no changes expected)**

This step produces no code changes.

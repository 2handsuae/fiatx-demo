# Admin Wallet V3 Frontend Adaptation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite admin wallet list/detail pages to V3 standards (Pattern B sidebar, adm-* tokens, new balance/role fields) and add system wallet provisioning to asset detail.

**Architecture:** 4 file changes — shared walletRole util, WalletList rewrite to ChangeTicketsPage standard, WalletDetail rewrite to Pattern B sidebar, AssetDetail upgrade to Pattern B with provision button.

**Tech Stack:** React 19, React Router v7, Tailwind CSS with adm-* design tokens, adminFetch, shared primitives (DetailPageHeader, InfoField, AdminBadge, PageTitleBar, Pagination)

---

### Task 1: Create walletRole.util.ts — shared role mapping utility

**Files:**
- Create: `admin-web/src/utils/walletRole.util.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// admin-web/src/utils/walletRole.util.ts

export const WALLET_ROLE_LABEL: Record<string, string> = {
  C_DEP: 'Client Deposit',
  C_VIBAN: 'Client vIBAN',
  C_MAIN: 'Client Omnibus',
  C_OUT: 'Client Outbound',
  C_CMA: 'Client Money Account',
  F_LIQ: 'Company Liquidity',
  F_OPS: 'Company Operations',
};

const ROLE_CLS: Record<string, string> = {
  C_DEP:   'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  C_VIBAN: 'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  C_MAIN:  'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  C_OUT:   'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  C_CMA:   'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  F_LIQ:   'bg-adm-green/10 text-adm-green border-adm-green/25',
  F_OPS:   'bg-adm-green/10 text-adm-green border-adm-green/25',
};

export const WalletRoleBadge = ({ role }: { role: string }) => {
  const cls = ROLE_CLS[role] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
      title={WALLET_ROLE_LABEL[role] || role}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {role}
    </span>
  );
};

export const WALLET_ROLE_OPTIONS = Object.keys(WALLET_ROLE_LABEL);
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/utils/walletRole.util.ts
git commit -m "feat(admin): add walletRole.util.ts with role labels, badge, and filter options"
```

---

### Task 2: Add DISABLED/FROZEN to AdminBadge STATUS_MAP

**Files:**
- Modify: `admin-web/src/components/ui/AdminBadge.tsx:5-18`

- [ ] **Step 1: Add missing status entries**

In `AdminBadge.tsx`, add these two entries to the `STATUS_MAP` object (after the existing entries, before the closing brace):

```typescript
  DISABLED:         'failed',
  FROZEN:           'rejected',
```

This maps DISABLED to red (failed) and FROZEN to amber (rejected), so wallet status badges render with correct colors.

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/components/ui/AdminBadge.tsx
git commit -m "feat(admin): add DISABLED/FROZEN to AdminBadge STATUS_MAP"
```

---

### Task 3: Add ASSET_PROVISION_WALLETS permission constant

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Add the permission constant**

Find the `ASSETS_READ` and `ASSETS_CREATE` lines (around line 200-201) and add after them:

```typescript
  ASSET_PROVISION_WALLETS: 'api.post.admin_assets_assetno_provision_wallets',
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/rbac/permissions.ts
git commit -m "feat(admin): add ASSET_PROVISION_WALLETS permission constant"
```

---

### Task 4: Rewrite WalletList.tsx to ChangeTicketsPage standard

**Files:**
- Rewrite: `admin-web/src/pages/WalletList.tsx`

**Reference file:** `admin-web/src/pages/ChangeTicketsPage.tsx` — follow its exact structural patterns.

- [ ] **Step 1: Write the full WalletList page**

Rewrite `WalletList.tsx` following ChangeTicketsPage patterns. The page has 4 zones: PageTitleBar, filter bar, table, footer.

```typescript
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
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
import { WalletRoleBadge, WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';
import { formatAssetAmount } from '../utils/number-format';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletItem {
  id: string;
  walletNo: string | null;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  balance: string;
  asset: { code: string; type: string; network?: string | null; decimals?: number };
  status: string;
  updatedAt: string;
}

interface WalletListResponse {
  total: number;
  items: WalletItem[];
}

interface FilterState {
  ownerIdSearch: string;
  ownerType: string;
  walletRole: string;
  type: string;
  status: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  ownerIdSearch: '',
  ownerType: '',
  walletRole: '',
  type: '',
  status: '',
};

/* ── Component ───────────────────────────────────────────────── */

const WalletList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<WalletItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.ownerIdSearch.trim()) params.set('ownerId', next.ownerIdSearch.trim());
    if (next.ownerType) params.set('ownerType', next.ownerType);
    if (next.walletRole) params.set('walletRole', next.walletRole);
    if (next.type) params.set('type', next.type);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load wallets.'));

      const data = (await res.json()) as WalletListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load wallets.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.ownerIdSearch || !!filters.ownerType || !!filters.walletRole
    || !!filters.type || !!filters.status;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Status toggle ── */

  const handleStatusChange = async (wallet: WalletItem) => {
    if (wallet.status === 'FROZEN') return;
    const newStatus = wallet.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!window.confirm(`${newStatus === 'DISABLED' ? 'Disable' : 'Enable'} wallet ${wallet.walletNo}?`)) return;

    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets/${wallet.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to update wallet status.'));
        return;
      }
      void fetchItems(currentPage);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to update wallet status.');
    }
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
      >
        <button
          onClick={() => void fetchItems(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.ownerIdSearch}
          onChange={(e) => updateFilter('ownerIdSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner ID / No"
          className={`${fi} w-40`}
        />
        <select
          value={filters.ownerType}
          onChange={(e) => updateFilter('ownerType', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All owners</option>
          <option value="PLATFORM">PLATFORM</option>
          <option value="CUSTOMER">CUSTOMER</option>
        </select>
        <select
          value={filters.walletRole}
          onChange={(e) => updateFilter('walletRole', e.target.value)}
          className={`${fi} w-28`}
        >
          <option value="">All roles</option>
          {WALLET_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All types</option>
          <option value="CRYPTO_ADDRESS">CRYPTO_ADDRESS</option>
          <option value="FIAT_BANK">FIAT_BANK</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-28`}
        >
          <option value="">All status</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="DISABLED">DISABLED</option>
          <option value="FROZEN">FROZEN</option>
        </select>
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Wallet No',  '160px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '100px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Updated',    '150px'],
                  ['Action',     '100px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.
                </td>
              </tr>
            )}
            {!loading && items.map((w) => {
              const ownerLabel = w.ownerName || w.ownerNo || w.ownerId || '—';
              const statusActionLabel = w.status === 'ACTIVE' ? 'Disable' : w.status === 'DISABLED' ? 'Enable' : null;

              return (
                <tr
                  key={w.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/dashboard/treasury/wallets/${w.id}`)}
                >
                  {/* Wallet No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {w.walletNo || w.id.slice(0, 8)}
                    </span>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.type}</div>
                  </td>

                  {/* Role */}
                  <td className="px-4 py-2.5">
                    <WalletRoleBadge role={w.walletRole} />
                  </td>

                  {/* Owner */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{ownerLabel}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.ownerType}</div>
                  </td>

                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{w.asset?.code || '—'}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.asset?.network || '—'}</div>
                  </td>

                  {/* Balance */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(w.balance ?? '0', w.asset?.decimals)}
                    </span>
                    <span className="ml-1 font-mono text-[9px] text-adm-t3">{w.asset?.code}</span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={w.status} />
                  </td>

                  {/* Updated */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(w.updatedAt)}
                  </td>

                  {/* Action */}
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {statusActionLabel && (
                        <button
                          onClick={() => void handleStatusChange(w)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {statusActionLabel}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} wallet${total === 1 ? '' : 's'}`
              : 'No wallets'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchItems(page)}
            />
          )}
        </div>
      </div>

    </div>
  );
};

export default WalletList;
```

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors related to WalletList.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WalletList.tsx
git commit -m "feat(admin): rewrite WalletList to ChangeTicketsPage standard with V3 roles and balance"
```

---

### Task 5: Rewrite WalletDetail.tsx to Pattern B sidebar layout

**Files:**
- Rewrite: `admin-web/src/pages/WalletDetail.tsx`

**Reference file:** `admin-web/src/pages/PlatformMemberDetailPage.tsx` — follow its exact sidebar layout patterns.

- [ ] **Step 1: Write the full WalletDetail page**

Rewrite `WalletDetail.tsx` using Pattern B: left main with divide-y sections + right sidebar with actions and quick reference.

```typescript
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Repeat, Link2, Plus } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { WalletRoleBadge, WALLET_ROLE_LABEL } from '../utils/walletRole.util';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  assetId: string;
  balance: string;

  address: string | null;
  memo: string | null;
  beneficiaryName: string | null;
  counterpartyVasp: string | null;

  bankName: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  accountName: string | null;
  iban: string | null;

  status: string;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
  } | null;

  createdAt: string;
  updatedAt: string;

  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals?: number;
  };
}

interface CollectionActionResult {
  action?: string;
  reason?: string;
  internalTransactionId?: string;
  internalFundId?: string;
  existingPendingAmount?: string;
  expectedCollectionAmount?: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Layout primitives (Pattern B — same as PlatformMemberDetailPage) ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Surface label mapping ── */

const SURFACE_LABELS: Record<string, string> = {
  CUSTOMER_POOL: 'Customer Pool',
  PLATFORM_POOL: 'Platform Pool',
  CUSTOMER_DEPOSIT: 'Customer Deposit Surface',
  CUSTOMER_PAYOUT_TARGET: 'Customer Payout Target',
  LIQUIDITY_PROVIDER_ACCOUNT: 'Liquidity Provider Account',
  OTHER: 'Other Wallet',
};

/* ── Main Component ──────────────────────────────────────────── */

export default function WalletDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [wallet, setWallet] = useState<WalletDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [collectionSubmitting, setCollectionSubmitting] = useState(false);
  const [collectionResult, setCollectionResult] = useState<CollectionActionResult | null>(null);

  const fetchWallet = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/wallets/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch wallet details.'));
      setWallet(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchWallet(); }, [id]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /* ── Loading / Error states ── */

  if (loading && !wallet) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading wallet…</p>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Wallet not found'}</div>
        <button onClick={() => navigate(-1)} className={adminButtonClass('detailUtility')}>
          Back
        </button>
      </div>
    );
  }

  /* ── Derived state ── */

  const isCrypto = wallet.type === 'CRYPTO_ADDRESS';
  const isFiat = wallet.type === 'FIAT_BANK';
  const isDepositWallet = wallet.walletRole === 'C_DEP';
  const isCmaWallet = wallet.walletRole === 'C_CMA';
  const canCreateCollection = hasAnyPermission([PERMISSIONS.INTERNAL_COLLECTIONS_RECONCILE]);
  const canReadGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ]);
  const canCreateGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);
  const ownerLabel = wallet.ownerName || wallet.ownerNo || wallet.ownerId || '—';
  const surfaceLabel = SURFACE_LABELS[wallet.surfaceCategory || 'OTHER'] || 'Other Wallet';

  /* ── Status toggle ── */

  const handleStatusChange = async (newStatus: string) => {
    if (!window.confirm(`${newStatus === 'DISABLED' ? 'Disable' : 'Enable'} wallet ${wallet.walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets/${wallet.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to update wallet status.'));
        return;
      }
      setNotice(`Wallet ${newStatus === 'ACTIVE' ? 'enabled' : 'disabled'} successfully.`);
      void fetchWallet();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to update wallet status.');
    }
  };

  /* ── Collection action ── */

  const handleCreateCollection = async () => {
    setCollectionSubmitting(true);
    setCollectionResult(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/collection-wallets/${wallet.id}/reconcile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: false }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to create wallet-driven collection.'));
        return;
      }
      const payload = (await res.json()) as CollectionActionResult;
      setCollectionResult(payload);
      if (payload.internalTransactionId && (payload.action === 'CREATED' || payload.action === 'IDEMPOTENT')) {
        navigate(`/exchange/internal-transactions/${payload.internalTransactionId}`);
        return;
      }
      setNotice(payload.reason || payload.action || 'Collection request completed.');
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to create collection.');
    } finally {
      setCollectionSubmitting(false);
    }
  };

  /* ── Sidebar action visibility ── */

  const canToggleStatus = wallet.status !== 'FROZEN';
  const showActions = canToggleStatus || (isDepositWallet && canCreateCollection) || (isCmaWallet && (canReadGate || canCreateGate));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        title="WALLET"
        subtitle={wallet.walletNo}
        onBack={() => navigate('/dashboard/treasury/wallets')}
        onRefresh={() => void fetchWallet()}
        refreshing={loading}
      />

      {/* ── Notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Wallet</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {wallet.walletNo}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={wallet.status} />
              <WalletRoleBadge role={wallet.walletRole} />
            </div>
            <div className="mt-2 font-mono text-[10px] text-adm-t3">{surfaceLabel}</div>
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner" value={ownerLabel} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
              <InfoField label="Direction" value={wallet.direction} />
              <InfoField label="Asset" value={`${wallet.asset.code} (${wallet.asset.type})`} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
            </div>
          </section>

          {/* ③ Balance */}
          <section className="px-6 py-5">
            <Cap>Balance</Cap>
            <div className="mt-3">
              <InfoField
                label="Balance"
                value={`${formatAssetAmount(wallet.balance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
                highlight
              />
            </div>
          </section>

          {/* ④ Address / Bank (conditional) */}
          {(isCrypto || isFiat) && (
            <section className="px-6 py-5">
              <Cap>{isCrypto ? 'Crypto Address' : 'Bank Account'}</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                {isCrypto ? (
                  <>
                    <InfoField
                      label="Address"
                      value={wallet.address}
                      mono
                      copyable
                      copied={copiedField === 'address'}
                      onCopy={(v) => handleCopy(v, 'address')}
                    />
                    <InfoField label="Memo / Tag" value={wallet.memo} />
                    <InfoField label="Beneficiary Name" value={wallet.beneficiaryName} />
                    <InfoField label="Counterparty VASP" value={wallet.counterpartyVasp} />
                  </>
                ) : (
                  <>
                    <InfoField label="Bank Name" value={wallet.bankName} />
                    <InfoField label="Account Holder" value={wallet.accountName} />
                    <InfoField label="Account Number" value={wallet.bankAccount} />
                    <InfoField label="IBAN" value={wallet.iban} />
                    <InfoField label="Bank Code (SWIFT/BIC)" value={wallet.bankCode} />
                  </>
                )}
              </div>
            </section>
          )}

          {/* ⑤ Deposit Collection (conditional: C_DEP only) */}
          {isDepositWallet && (
            <section className="px-6 py-5">
              <Cap>Deposit Collection</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField
                  label="Collection Amount"
                  value={`${formatAssetAmount(wallet.balance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
                  highlight
                />
                <InfoField
                  label="Execution Rule"
                  value="Create full-balance DEPOSIT_COLLECTION when triggered"
                />
              </div>
              {collectionResult && (
                <div className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 px-4 py-3 font-mono text-[11px] text-adm-amber">
                  <div className="font-semibold">Collection result: {collectionResult.action || 'UNKNOWN'}</div>
                  <div className="mt-1">{collectionResult.reason || 'Collection request completed.'}</div>
                  {collectionResult.expectedCollectionAmount && (
                    <div className="mt-1 text-[10px]">
                      Expected: {collectionResult.expectedCollectionAmount} {wallet.asset.code}
                    </div>
                  )}
                  {collectionResult.internalTransactionId && (
                    <button
                      onClick={() => navigate(`/exchange/internal-transactions/${collectionResult.internalTransactionId}`)}
                      className={`mt-2 ${adminButtonClass('detailUtility')}`}
                    >
                      <Link2 size={13} />
                      View Collection
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ⑥ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(wallet.createdAt)} mono />
              <InfoField label="Updated" value={fmt(wallet.updatedAt)} mono />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {showActions && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {canToggleStatus && wallet.status === 'ACTIVE' && (
                  <button
                    onClick={() => void handleStatusChange('DISABLED')}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Disable Wallet
                  </button>
                )}
                {canToggleStatus && wallet.status === 'DISABLED' && (
                  <button
                    onClick={() => void handleStatusChange('ACTIVE')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Enable Wallet
                  </button>
                )}
                {isDepositWallet && canCreateCollection && (
                  <button
                    onClick={() => void handleCreateCollection()}
                    disabled={collectionSubmitting}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <Repeat size={13} />
                    {collectionSubmitting ? 'Creating…' : 'Create Collection'}
                  </button>
                )}
                {isCmaWallet && wallet.regulatoryGateSummary && canReadGate && (
                  <button
                    onClick={() => navigate(`/dashboard/governance/regulatory-gates/${wallet.regulatoryGateSummary!.gateId}`)}
                    className={adminButtonClass('detailUtility')}
                  >
                    <Link2 size={13} />
                    View Regulatory Gate
                  </button>
                )}
                {isCmaWallet && !wallet.regulatoryGateSummary && canCreateGate && (
                  <button
                    onClick={() => {
                      const p = new URLSearchParams({
                        gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
                        subjectType: 'WALLET',
                        subjectId: wallet.id,
                        subjectNo: wallet.walletNo,
                      });
                      navigate(`/dashboard/governance/regulatory-gates/create?${p.toString()}`);
                    }}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <Plus size={13} />
                    Create Regulatory Gate
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Wallet No" value={wallet.walletNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={wallet.status} />} />
            <SidebarKV label="Role" value={wallet.walletRole} mono />
            <SidebarKV label="Role Name" value={WALLET_ROLE_LABEL[wallet.walletRole] || wallet.walletRole} />
            <SidebarKV label="Asset" value={wallet.asset.code} />
            <SidebarKV label="Wallet ID" value={wallet.id} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors related to WalletDetail.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WalletDetail.tsx
git commit -m "feat(admin): rewrite WalletDetail to Pattern B sidebar layout with V3 balance and roles"
```

---

### Task 6: Rewrite AssetDetail.tsx to Pattern B with provision button

**Files:**
- Rewrite: `admin-web/src/pages/AssetDetail.tsx`

**Reference file:** `admin-web/src/pages/PlatformMemberDetailPage.tsx` — follow its exact sidebar layout patterns.

- [ ] **Step 1: Write the full AssetDetail page**

Rewrite `AssetDetail.tsx` using Pattern B: left main with divide-y sections + right sidebar with provision action and quick reference.

```typescript
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssetDetailData {
  id: string;
  assetNo?: string | null;
  type: 'FIAT' | 'CRYPTO';
  code: string;
  network: string | null;
  decimals: number;
  contractAddress?: string | null;
  description: string | null;
  status: string;
  minDepositAmount?: number | null;
  maxDepositAmount?: number | null;
  minWithdrawAmount?: number | null;
  maxWithdrawAmount?: number | null;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProvisionResult {
  created: { role: string; walletNo: string; walletId: string }[];
  skipped: { role: string; walletNo: string }[];
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Layout primitives (Pattern B) ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [asset, setAsset] = useState<AssetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);

  const canProvision = hasAnyPermission([PERMISSIONS.ASSET_PROVISION_WALLETS]);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load asset detail.'));
      setAsset(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load asset detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* ── Provision system wallets ── */

  const handleProvision = async () => {
    if (!asset?.assetNo) return;
    if (!window.confirm(`Provision system wallets for ${asset.code}?`)) return;

    setProvisioning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/provision-wallets`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to provision system wallets.'));
        return;
      }
      const result = (await res.json()) as ProvisionResult;
      if (result.created.length > 0) {
        const roles = result.created.map((w) => w.role).join(', ');
        setNotice(`Provisioned ${result.created.length} wallet${result.created.length > 1 ? 's' : ''}: ${roles}`);
      } else {
        setNotice('All system wallets already exist.');
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to provision system wallets.');
    } finally {
      setProvisioning(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !asset) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading asset…</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Asset not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/dashboard/system/assets')} className={adminButtonClass('detailUtility')}>
            Back to Assets
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const canShowProvision = canProvision && (asset.status === 'PROVISIONING' || asset.status === 'ACTIVE');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        title="ASSET"
        subtitle={asset.assetNo || asset.code}
        onBack={() => navigate('/dashboard/system/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />

      {/* ── Notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Asset</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.assetNo || asset.code}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={asset.status} />
              <span className="font-mono text-[10px] text-adm-t2">{asset.code} · {asset.type}</span>
            </div>
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Network" value={asset.network || '—'} />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Contract Address" value={asset.contractAddress || '—'} mono />
              <InfoField label="Description" value={asset.description || '—'} />
            </div>
          </section>

          {/* ③ Limits */}
          <section className="px-6 py-5">
            <Cap>Deposit & Withdrawal</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Min Deposit" value={asset.minDepositAmount != null ? String(asset.minDepositAmount) : '—'} mono />
              <InfoField label="Max Deposit" value={asset.maxDepositAmount != null ? String(asset.maxDepositAmount) : '—'} mono />
              <InfoField label="Min Withdraw" value={asset.minWithdrawAmount != null ? String(asset.minWithdrawAmount) : '—'} mono />
              <InfoField label="Max Withdraw" value={asset.maxWithdrawAmount != null ? String(asset.maxWithdrawAmount) : '—'} mono />
              <InfoField label="Deposit Enabled" value={asset.depositEnabled ? 'Yes' : 'No'} />
              <InfoField label="Withdrawal Enabled" value={asset.withdrawalEnabled ? 'Yes' : 'No'} />
            </div>
          </section>

          {/* ④ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(asset.createdAt)} mono />
              <InfoField label="Updated" value={fmt(asset.updatedAt)} mono />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {canShowProvision && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button
                  onClick={() => void handleProvision()}
                  disabled={provisioning}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <Wallet size={13} />
                  {provisioning ? 'Provisioning…' : 'Provision System Wallets'}
                </button>
              </div>
            </div>
          )}

          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Asset No" value={asset.assetNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={asset.status} />} />
            <SidebarKV label="Type" value={asset.type} />
            <SidebarKV label="Code" value={asset.code} mono />
            <SidebarKV label="Asset ID" value={asset.id} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors related to AssetDetail.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/AssetDetail.tsx
git commit -m "feat(admin): rewrite AssetDetail to Pattern B with system wallet provisioning"
```

---

### Task 7: Verify all pages in the browser

**Files:**
- None (verification only)

- [ ] **Step 1: Start the full dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Wait for backend (port 3500) and admin frontend (port 3501) to be ready.

- [ ] **Step 2: Verify WalletList page loads**

Navigate to `http://localhost:3501/dashboard/treasury/wallets`. Verify:
- PageTitleBar renders with "Wallets" title
- Filter bar shows all dropdowns (owner type, role with V3 values, type, status)
- Table has 8 columns: Wallet No, Role, Owner, Asset, Balance (single column), Status, Updated, Action
- Role column shows WalletRoleBadge with color-coded badges
- Balance column shows single mockBalance value
- Pagination footer renders

- [ ] **Step 3: Verify WalletDetail page loads**

Click any wallet row. Verify:
- Pattern B layout: left main with sections, right sidebar with actions + quick reference
- Identity section shows walletNo in large amber text with status and role badges
- Balance section shows single balance value
- Sidebar shows Enable/Disable button and quick reference KVs
- Role badge has tooltip showing full name on hover

- [ ] **Step 4: Verify AssetDetail page loads with provision button**

Navigate to `http://localhost:3501/dashboard/system/assets` and click an asset. Verify:
- Pattern B layout with sidebar
- If asset is PROVISIONING or ACTIVE, sidebar shows "Provision System Wallets" button
- Click provision → confirm dialog → success notice with created wallet roles

- [ ] **Step 5: Commit any fixes if needed**

If any issues found during verification, fix and commit.

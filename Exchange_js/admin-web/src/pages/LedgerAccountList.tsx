import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, X } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  TB_CODE_LABELS,
  TB_CODE_OPTIONS,
  SYSTEM_CODE_OPTIONS,
  CUSTOMER_CODE_OPTIONS,
} from './ledger-account.constants';

/* ── Interfaces ──────────────────────────────────────────────── */

interface LedgerAccountRow {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  ownerNo: string | null;
  ownerName: string | null;
  assetCode: string;
  status: string;
  description: string | null;
  flags: number;
  createdAt: string;
}

interface FilterState {
  q: string;
  assetCode: string;
  ownerType: string;
  code: string;
}

interface CreateForm {
  accountCategory: 'SYSTEM' | 'CUSTOMER';
  assetCode: string;
  code: number | '';
  customerNo: string;
  description: string;
}

interface AssetOption {
  code: string;
  type: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const EMPTY_FORM: CreateForm = {
  accountCategory: 'SYSTEM',
  assetCode: '',
  code: '',
  customerNo: '',
  description: '',
};

const DEFAULT_FILTERS: FilterState = { q: '', assetCode: '', ownerType: '', code: '' };
const PAGE_SIZE = 50;

/* ── Helpers ─────────────────────────────────────────────────── */

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/* ── Component ───────────────────────────────────────────────── */

const LedgerAccountList = () => {
  const navigate = useNavigate();

  const [items, setItems] = useState<LedgerAccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* ── Data fetching ── */

  const fetchData = async (overridePage?: number, overrideFilters?: FilterState) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const f = overrideFilters ?? filters;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.q.trim()) params.set('q', f.q.trim());
      if (f.assetCode) params.set('assetCurrency', f.assetCode);
      if (f.ownerType) params.set('ownerType', f.ownerType);
      if (f.code) params.set('code', f.code);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch ledger accounts.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load ledger accounts.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  // Asset options feed both the filter dropdown and the create modal.
  useEffect(() => {
    void fetchAssets();
  }, []);

  /* ── Asset list for create modal ── */

  const fetchAssets = async () => {
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/assets?take=100`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const provisioned = (data.items ?? data ?? []).filter(
        (a: any) => a.tbLedgerId != null,
      );
      setAssets(provisioned.map((a: any) => ({ code: a.code, type: a.type })));
    } catch {
      /* ignore */
    }
  };

  /* ── Create modal ── */

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreateError(null);
    void fetchAssets();
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateError(null);
  };

  const handleCategoryChange = (cat: 'SYSTEM' | 'CUSTOMER') => {
    setForm((prev) => ({ ...prev, accountCategory: cat, code: '', customerNo: '' }));
  };

  const canSubmit =
    form.assetCode !== '' &&
    form.code !== '' &&
    (form.accountCategory === 'SYSTEM' || form.customerNo.trim() !== '');

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountCategory: form.accountCategory,
            assetCurrency: form.assetCode,
            code: Number(form.code),
            customerNo:
              form.accountCategory === 'CUSTOMER'
                ? form.customerNo.trim()
                : undefined,
            description: form.description.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to create ledger account.');
        setCreateError(msg);
        return;
      }
      closeCreate();
      void fetchData();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create ledger account.',
      );
    } finally {
      setCreating(false);
    }
  };

  /* ── Filter actions ── */

  const handleSearch = () => {
    setPage(1);
    void fetchData(1, filters);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    void fetchData(1, DEFAULT_FILTERS);
  };

  /* ── Styles ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Ledger Accounts"
        subtitle={`${total} accounts · Account Registry`}
      >
        <button onClick={openCreate} className={adminButtonClass('listPrimary')}>
          <Plus size={13} /> New Account
        </button>
      </PageTitleBar>

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border px-4 py-2">
        <input
          className={`${fi} w-[240px]`}
          placeholder="Customer no / name / description"
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <select
          className={`${fi} w-[180px]`}
          value={filters.assetCode}
          onChange={(e) => setFilters((p) => ({ ...p, assetCode: e.target.value }))}
        >
          <option value="">All assets</option>
          {assets.map((a) => (
            <option key={a.code} value={a.code}>{a.code}</option>
          ))}
        </select>
        <select
          className={`${fi} w-[180px]`}
          value={filters.code}
          onChange={(e) => setFilters((p) => ({ ...p, code: e.target.value }))}
        >
          {TB_CODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className={`${fi} w-[160px]`}
          value={filters.ownerType}
          onChange={(e) => setFilters((p) => ({ ...p, ownerType: e.target.value }))}
        >
          <option value="">All owners</option>
          <option value="SYSTEM">SYSTEM</option>
          <option value="CUSTOMER">CUSTOMER</option>
          <option value="LP">LP</option>
        </select>

        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          Search
        </button>
        <button onClick={handleReset} className={adminButtonClass('listSecondary')}>
          Reset
        </button>

        <button
          onClick={() => void fetchData(page, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table ─── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th}>Account</th>
              <th className={th}>Code</th>
              <th className={th}>Ledger</th>
              <th className={th}>Owner</th>
              <th className={th}>Customer No</th>
              <th className={th}>Customer Name</th>
              <th className={th}>Asset</th>
              <th className={th}>Status</th>
              <th className={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center font-mono text-[11px] text-adm-t3"
                >
                  No accounts found.
                </td>
              </tr>
            )}
            {items.map((row) => (
              <tr
                key={row.tbAccountId}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/ledger/accounts/${row.tbAccountId}`)}
              >
                {/* Account */}
                <td className="px-3 py-2">
                  <button
                    className={adminButtonClass('rowKeyLink')}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/admin/ledger/accounts/${row.tbAccountId}`);
                    }}
                  >
                    {TB_CODE_LABELS[row.code] ?? 'CODE_' + row.code} · {row.assetCode}
                  </button>
                </td>
                {/* Code */}
                <td className="px-3 py-2 font-mono text-adm-t2">{row.code}</td>
                {/* Ledger */}
                <td className="px-3 py-2 font-mono text-adm-t2">{row.ledger}</td>
                {/* Owner */}
                <td className="px-3 py-2">
                  <AdminBadge value={row.ownerType} />
                </td>
                {/* Customer No */}
                <td className="px-3 py-2 font-mono text-[11px]">
                  {row.ownerType === 'CUSTOMER' && row.ownerNo && row.ownerUuid ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/customers/${row.ownerUuid}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {row.ownerNo}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>
                {/* Customer Name */}
                <td className="px-3 py-2 text-[11px] text-adm-t2">
                  {row.ownerType === 'CUSTOMER' && row.ownerName ? (
                    row.ownerName
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>
                {/* Asset */}
                <td className="px-3 py-2 font-mono font-bold text-adm-t1">
                  {row.assetCode}
                </td>
                {/* Status */}
                <td className="px-3 py-2">
                  <AdminBadge value={row.status} />
                </td>
                {/* Created */}
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {formatDate(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>
          Showing {items.length} / {total} accounts
        </span>
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => setPage(p)}
        />
      </div>

      {/* ─── Create Ledger Account Modal ─── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[480px] rounded-lg border border-adm-border bg-adm-bg shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border px-5 py-3">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">
                New Ledger Account
              </h3>
              <button
                onClick={closeCreate}
                className="text-adm-t3 transition-colors hover:text-adm-t1"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              {/* Account Category */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Account Category
                </label>
                <div className="flex gap-3">
                  {(['SYSTEM', 'CUSTOMER'] as const).map((cat) => (
                    <label
                      key={cat}
                      className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t1"
                    >
                      <input
                        type="radio"
                        name="accountCategory"
                        checked={form.accountCategory === cat}
                        onChange={() => handleCategoryChange(cat)}
                        className="accent-adm-amber"
                      />
                      {cat === 'SYSTEM' ? 'System Account' : 'Customer Account'}
                    </label>
                  ))}
                </div>
              </div>

              {/* Asset */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Asset
                </label>
                <select
                  value={form.assetCode}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, assetCode: e.target.value }))
                  }
                  className={`${fi} w-full`}
                >
                  <option value="">Select asset…</option>
                  {assets.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Type */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Account Type
                </label>
                <select
                  value={form.code}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      code: e.target.value ? Number(e.target.value) : '',
                    }))
                  }
                  className={`${fi} w-full`}
                >
                  <option value="">Select type…</option>
                  {(form.accountCategory === 'SYSTEM'
                    ? SYSTEM_CODE_OPTIONS
                    : CUSTOMER_CODE_OPTIONS
                  ).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Customer No (only for CUSTOMER) */}
              {form.accountCategory === 'CUSTOMER' && (
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                    Customer No
                  </label>
                  <input
                    value={form.customerNo}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, customerNo: e.target.value }))
                    }
                    placeholder="e.g. CU2605140001"
                    className={`${fi} w-full`}
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Description{' '}
                  <span className="font-normal text-adm-t3">(optional)</span>
                </label>
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="Optional note…"
                  className={`${fi} w-full`}
                />
              </div>

              {/* Error */}
              {createError && (
                <div className="rounded border border-adm-red/20 bg-adm-red/6 px-3 py-2 font-mono text-[11px] text-adm-red">
                  {createError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-adm-border px-5 py-3">
              <button
                onClick={closeCreate}
                className={adminButtonClass('listSecondary')}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!canSubmit || creating}
                className={adminButtonClass('listPrimary')}
              >
                {creating ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LedgerAccountList;

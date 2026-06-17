import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
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

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssetItem {
  id: string;
  assetNo: string | null;
  type: string;
  currency: string;
  code: string;
  network: string | null;
  decimals: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AssetListResponse {
  total: number;
  items: AssetItem[];
}

interface FilterState {
  codeSearch: string;
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
  codeSearch: '',
  type: '',
  status: '',
};

/* ── Component ───────────────────────────────────────────────── */

const AssetList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AssetItem[]>([]);
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
    if (next.codeSearch.trim()) params.set('currency', next.codeSearch.trim());
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
        `${import.meta.env.VITE_API_URL}/assets?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load assets.'));

      const data = (await res.json()) as AssetListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load assets.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.codeSearch || !!filters.type || !!filters.status;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* (Suspend / Reactivate actions are on the detail page) */

  /* ── Table header style ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Assets"
        subtitle={`${total} assets · Configuration`}
      >
        <button
          onClick={() => navigate('/admin/assets/create')}
          className={adminButtonClass('listPrimary')}
        >
          <Plus size={13} /> New Asset
        </button>
      </PageTitleBar>

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-danger/5 px-4 py-2 font-mono text-[11px] text-adm-danger">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border px-4 py-2">
        <input
          className={`${fi} w-[180px]`}
          placeholder="Asset code"
          value={filters.codeSearch}
          onChange={(e) => updateFilter('codeSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <select
          className={`${fi} w-[120px]`}
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
        >
          <option value="">All types</option>
          <option value="FIAT">FIAT</option>
          <option value="CRYPTO">CRYPTO</option>
        </select>
        <select
          className={`${fi} w-[160px]`}
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">All status</option>
          <option value="PROVISIONING">PROVISIONING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
        </select>

        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>

        <button
          onClick={() => void fetchItems(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table ─── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 140 }}>Code</th>
              <th className={th} style={{ width: 80 }}>Currency</th>
              <th className={th} style={{ width: 80 }}>Type</th>
              <th className={th} style={{ width: 100 }}>Network</th>
              <th className={th} style={{ width: 70 }}>Decimals</th>
              <th className={th} style={{ width: 100 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No assets found
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover transition-colors"
                  onClick={() => navigate(`/admin/assets/${a.assetNo}`)}
                >
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-amber">
                    {a.code}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-t1">
                    {a.currency}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.type} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.network || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {a.decimals}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={a.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(a.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>
          Showing {items.length} / {total} assets
        </span>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => void fetchItems(p, filters)}
        />
      </div>
    </div>
  );
};

export default AssetList;

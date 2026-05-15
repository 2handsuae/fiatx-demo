import { useEffect, useRef, useState } from 'react';
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

/* ── Interfaces ──────────────────────────────────────────────── */

interface PolicyItem {
  id: string;
  policyNo: string;
  tradingTier: string;
  operationType: string;
  period: string;
  limitAmount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PolicyListResponse {
  total: number;
  items: PolicyItem[];
}

interface FilterState {
  tradingTier: string;
  operationType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (!v) return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  tradingTier: '',
  operationType: '',
};

/* ── Component ───────────────────────────────────────────────── */

const TransactionLimitList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PolicyItem[]>([]);
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
    if (next.tradingTier) params.set('tradingTier', next.tradingTier);
    if (next.operationType) params.set('operationType', next.operationType);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policies.'));

      const data = (await res.json()) as PolicyListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load policies.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.tradingTier || !!filters.operationType;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Table header style ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Transaction Limits"
        meta={`${total} policies · Daily Limits`}
      />

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-danger/5 px-4 py-2 font-mono text-[11px] text-adm-danger">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border px-4 py-2">
        <select
          className={`${fi} w-[130px]`}
          value={filters.tradingTier}
          onChange={(e) => updateFilter('tradingTier', e.target.value)}
        >
          <option value="">All tiers</option>
          <option value="BASIC">BASIC</option>
          <option value="PREMIUM">PREMIUM</option>
        </select>
        <select
          className={`${fi} w-[150px]`}
          value={filters.operationType}
          onChange={(e) => updateFilter('operationType', e.target.value)}
        >
          <option value="">All operations</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="SWAP">SWAP</option>
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
              <th className={th} style={{ width: 110 }}>Policy No</th>
              <th className={th} style={{ width: 100 }}>Trading Tier</th>
              <th className={th} style={{ width: 120 }}>Operation</th>
              <th className={th} style={{ width: 80 }}>Period</th>
              <th className={th} style={{ width: 140 }}>Limit (AED)</th>
              <th className={th} style={{ width: 80 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No policies found
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() => navigate(`/dashboard/system/transaction-limits/${p.policyNo}`)}
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/dashboard/system/transaction-limits/${p.policyNo}`);
                      }}
                      title={p.policyNo}
                    >
                      {p.policyNo}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.tradingTier} />
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.operationType} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {p.period}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t1 font-semibold">
                    {fmtAmount(p.limitAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(p.updatedAt)}
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
          Showing {items.length} / {total} policies
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

export default TransactionLimitList;

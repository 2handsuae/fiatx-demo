import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface MaterialHoldingItem {
  id: string;
  holdingNo: string;
  materialType: string;
  managementMode: string;
  status: string;
  expiresAt?: string | null;
  daysFromExpiry?: number | null;
  activeRefreshCycle?: {
    id: string;
    cycleNo: string;
    status: string;
    stage?: string | null;
  } | null;
  customer: {
    customerNo: string;
    email: string;
    riskTier: string;
  };
}

interface HoldingsListResponse {
  total: number;
  items: MaterialHoldingItem[];
}

interface FilterState {
  status: string;
  materialType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const DaysLeftCell = ({ days }: { days?: number | null }) => {
  if (days === null || days === undefined) {
    return <span className="font-mono text-[10px] text-adm-t3">—</span>;
  }
  if (days < 0) {
    return (
      <span className="font-mono text-[10px] font-bold text-adm-red">
        {days}d (expired)
      </span>
    );
  }
  if (days < 7) {
    return (
      <span className="font-mono text-[10px] font-bold text-adm-red">{days}d</span>
    );
  }
  if (days <= 30) {
    return (
      <span className="font-mono text-[10px] font-semibold text-adm-amber">{days}d</span>
    );
  }
  return (
    <span className="font-mono text-[10px] text-adm-green">{days}d</span>
  );
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 50;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  materialType: '',
};

/* ─────────────────────────────────────────────────────────────── */

const MaterialManagementPage = () => {
  const navigate = useNavigate();

  const [filters,      setFilters]      = useState<FilterState>(DEFAULT_FILTERS);
  const [items,        setItems]        = useState<MaterialHoldingItem[]>([]);
  const [total,        setTotal]        = useState(0);
  const [currentPage,  setCurrentPage]  = useState(1);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.status.trim())       params.set('status',       next.status.trim());
    if (next.materialType.trim()) params.set('materialType', next.materialType.trim());
    return params;
  };

  const fetchHoldings = async (page: number, next: FilterState = filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/holdings?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load holdings.'));

      const data = (await res.json()) as HoldingsListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load holdings.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchHoldings(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.status || !!filters.materialType;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchHoldings(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchHoldings(1, DEFAULT_FILTERS);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Material Management"
        meta={`${total} holding${total === 1 ? '' : 's'} · Compliance Center`}
      >
        <button
          onClick={() => void fetchHoldings(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-48`}
        >
          <option value="">All statuses</option>
          <option value="FRESH">FRESH</option>
          <option value="REFRESH_IN_PROGRESS">REFRESH_IN_PROGRESS</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="MISSING">MISSING</option>
        </select>
        <select
          value={filters.materialType}
          onChange={(e) => updateFilter('materialType', e.target.value)}
          className={`${fi} w-48`}
        >
          <option value="">All material types</option>
          <option value="EMIRATES_ID">EMIRATES_ID</option>
          <option value="LIVENESS">LIVENESS</option>
          <option value="PROOF_OF_ADDRESS">PROOF_OF_ADDRESS</option>
          <option value="SOURCE_OF_FUNDS">SOURCE_OF_FUNDS</option>
          <option value="SOURCE_OF_WEALTH">SOURCE_OF_WEALTH</option>
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

      {/* ── Error notice ── */}
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
                  ['Holding No',       '140px'],
                  ['Customer',         '200px'],
                  ['Material Type',    '160px'],
                  ['Mode',             '130px'],
                  ['Status',           '160px'],
                  ['Expires',          '110px'],
                  ['Days Left',        '90px'],
                  ['Active Cycle',     '150px'],
                  ['Risk Tier',        'auto'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
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
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No holdings found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/customers/material-holdings/${item.id}`)}
              >
                {/* Holding No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.holdingNo}
                  </span>
                </td>

                {/* Customer */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.customer.customerNo}
                  </span>
                </td>

                {/* Material Type */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.materialType}
                </td>

                {/* Management Mode */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t3 whitespace-nowrap">
                  {item.managementMode === 'SUMSUB_MANAGED' ? 'SUMSUB' : 'SELF'}
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Expires */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.expiresAt)}
                </td>

                {/* Days Left */}
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <DaysLeftCell days={item.daysFromExpiry} />
                </td>

                {/* Active Cycle */}
                <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                  {item.activeRefreshCycle ? (
                    <button
                      className={adminButtonClass('rowLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/customers/material-holdings/${item.id}`);
                      }}
                    >
                      {item.activeRefreshCycle.cycleNo}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>

                {/* Risk Tier */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.customer.riskTier} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} holding${total === 1 ? '' : 's'}`
              : 'No holdings'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchHoldings(page)}
            />
          )}
        </div>
      </div>

    </div>
  );
};

export default MaterialManagementPage;

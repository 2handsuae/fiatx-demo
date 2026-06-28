import { useEffect, useMemo, useState } from 'react';
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
import { StatusPill } from '../components/ui/StatusPill';
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
  currentStage: string | null;
  needsReview: boolean;
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
  ownerNo: string;
  startDate: string;
  endDate: string;
  needsReviewOnly: boolean;
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
    ownerNo: '',
    startDate: '',
    endDate: '',
    needsReviewOnly: false,
  });

  const hasFilters = useMemo(
    () =>
      !!filters.swapNo.trim() ||
      !!filters.ownerNo.trim() ||
      !!filters.startDate ||
      !!filters.endDate ||
      filters.needsReviewOnly,
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
      if (f.ownerNo.trim()) params.set('ownerId', f.ownerNo.trim());
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
    const empty: FilterState = {
      swapNo: '',
      ownerNo: '',
      startDate: '',
      endDate: '',
      needsReviewOnly: false,
    };
    setFilters(empty);
    setPage(1);
    void fetchData(1, empty);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    void fetchData(p);
  };

  // Backend has no `needsReview` query filter yet; apply client-side over the
  // current page so operators can quickly isolate stuck swaps.
  const visibleItems = useMemo(
    () =>
      filters.needsReviewOnly ? items.filter((it) => it.needsReview) : items,
    [items, filters.needsReviewOnly],
  );

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar title="Swap Transactions" meta={`${total} swap${total === 1 ? '' : 's'}`}>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.swapNo}
          onChange={(e) => setFilters((f) => ({ ...f, swapNo: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Swap No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.ownerNo}
          onChange={(e) => setFilters((f) => ({ ...f, ownerNo: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner No"
          className={`${fi} w-36`}
        />
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
          className={`${fi} w-36`}
          title="Start Date"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
          className={`${fi} w-36`}
          title="End Date"
        />
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          className={adminButtonClass('listSecondary')}
          disabled={!hasFilters || loading}
        >
          Reset
        </button>
        <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t2">
          <input
            type="checkbox"
            checked={filters.needsReviewOnly}
            onChange={(e) =>
              setFilters((f) => ({ ...f, needsReviewOnly: e.target.checked }))
            }
            className="h-3.5 w-3.5 accent-adm-red"
          />
          Needs review only
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Swap No',     '160px'],
                  ['Owner',       '150px'],
                  ['Sell (From)', '150px'],
                  ['Buy (Net)',   '150px'],
                  ['Rate',        '120px'],
                  ['Spread',      '120px'],
                  ['Status',      '120px'],
                  ['Stage',       '110px'],
                  ['Review',      '80px'],
                  ['Created',     '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap text-left"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-red">
                  {error}
                </td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  <RefreshCw className="mx-auto mb-2 animate-spin text-adm-amber" size={20} />
                  Loading…
                </td>
              </tr>
            ) : visibleItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No swap transactions found.
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/trading/swaps/${item.id}`)}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.swapNo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-blue">
                      {item.customer?.customerNo || item.ownerNo || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-red">
                    {formatAssetAmount(item.fromAmount, item.fromAsset.decimals)}{' '}
                    {item.fromAsset.currency}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-green">
                    {formatAssetAmount(item.netToAmount ?? item.toAmount, item.toAsset.decimals)}{' '}
                    {item.toAsset.currency}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {formatRate8(item.exchangeRate)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {item.spreadAmount
                      ? `${formatAssetAmount(item.spreadAmount, item.toAsset.decimals)} ${item.toAsset.currency}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill value={item.status} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {item.currentStage ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {item.needsReview ? (
                      <span
                        className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-adm-red"
                        title="Needs review"
                      >
                        <span className="h-2 w-2 rounded-full bg-adm-red" />
                        Review
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-adm-t3">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
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

export default SwapTransactionList;

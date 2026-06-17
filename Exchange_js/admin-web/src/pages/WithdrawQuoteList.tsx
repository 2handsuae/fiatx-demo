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
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/quotes?${params.toString()}`,
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
                        navigate(`/admin/trading/withdraw-quotes/${item.quoteId}`)
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

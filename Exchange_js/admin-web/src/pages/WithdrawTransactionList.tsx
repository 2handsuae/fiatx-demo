// admin-web/src/pages/WithdrawTransactionList.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';
import { getWithdrawStatusBadgeClass } from '../utils/withdrawActionMap';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WithdrawItem {
  id: string;
  withdrawNo: string;
  ownerNo: string | null;
  ownerId: string;
  ownerType: string;
  status: string;
  amount: string;
  type?: string | null;
  asset: { code: string; type: string; decimals?: number };
  createdAt: string;
}

interface FilterState {
  withdrawNo: string;
  ownerNo: string;
  status: string;
  type: string;
  startDate: string;
  endDate: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const WITHDRAW_STATUSES = [
  'CREATED', 'PENDING_COMPLIANCE', 'PENDING_APPROVAL', 'APPROVED',
  'PAYOUT_PENDING', 'PROCESSING', 'FROZEN',
  'SUCCESS', 'REJECTED', 'CANCELLED', 'FAILED', 'RETURNED',
];

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  withdrawNo: '',
  ownerNo: '',
  status: '',
  type: '',
  startDate: '',
  endDate: '',
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ───────────────────────────────────────────────── */

const WithdrawTransactionList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<WithdrawItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.withdrawNo.trim()) params.set('withdrawNo', next.withdrawNo.trim());
      if (next.ownerNo.trim()) params.set('ownerNo', next.ownerNo.trim());
      if (next.status) params.set('status', next.status);
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load withdrawals.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      let filtered = Array.isArray(data.items) ? data.items : [];
      if (next.type) {
        filtered = filtered.filter(
          (i: WithdrawItem) => (i.type || i.asset.type)?.toUpperCase() === next.type.toUpperCase(),
        );
      }
      setItems(filtered);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load withdrawals.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Filter helpers ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.withdrawNo || !!filters.ownerNo || !!filters.status ||
    !!filters.type || !!filters.startDate || !!filters.endDate;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Withdraw Transactions"
        meta={`${total} withdrawal${total === 1 ? '' : 's'}`}
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
          value={filters.withdrawNo}
          onChange={(e) => updateFilter('withdrawNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Withdraw No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.ownerNo}
          onChange={(e) => updateFilter('ownerNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner No"
          className={`${fi} w-36`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All status</option>
          {WITHDRAW_STATUSES.map((s) => (
            <option key={s} value={s}>{formatStatusLabel(s)}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All types</option>
          <option value="CRYPTO">Crypto</option>
          <option value="FIAT">Fiat</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => updateFilter('startDate', e.target.value)}
          className={`${fi} w-36`}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => updateFilter('endDate', e.target.value)}
          className={`${fi} w-36`}
        />
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
                  ['Withdraw No', '160px'],
                  ['Status',      '130px'],
                  ['Amount',      '140px'],
                  ['Type',        '90px'],
                  ['Owner',       '130px'],
                  ['Created',     '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Amount' ? 'text-right' : 'text-left'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No withdrawals found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/trading/withdrawals/${item.id}`)}
              >
                {/* Withdraw No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.withdrawNo}
                  </span>
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getWithdrawStatusBadgeClass(item.status)}`}>
                    {formatStatusLabel(item.status)}
                  </span>
                </td>

                {/* Amount */}
                <td className="px-4 py-2.5 text-right">
                  <span className="font-mono text-[11px] text-adm-t1">
                    {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                  </span>
                </td>

                {/* Type */}
                <td className="px-4 py-2.5">
                  <span className={`font-mono text-[10px] font-semibold ${(item.type || item.asset.type)?.toUpperCase() === 'CRYPTO' ? 'text-adm-amber' : 'text-adm-blue'}`}>
                    {formatTransactionTypeLabel(item.type || item.asset.type)}
                  </span>
                </td>

                {/* Owner */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] text-adm-blue">{item.ownerNo || '—'}</span>
                </td>

                {/* Created */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
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
              ? `Showing ${items.length} / ${total} withdrawal${total === 1 ? '' : 's'}`
              : 'No withdrawals'}
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

export default WithdrawTransactionList;

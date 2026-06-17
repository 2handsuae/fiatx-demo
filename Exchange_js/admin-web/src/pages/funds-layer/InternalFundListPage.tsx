// admin-web/src/pages/funds-layer/InternalFundListPage.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../../components/common/adminButtonStyles';
import { PageTitleBar } from '../../components/ui/PageTitleBar';
import { AdminBadge } from '../../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';
import { formatAssetAmount } from '../../utils/number-format';
import { formatRailStatusLabel } from '../../utils/transactionRootDisplay';

/* ── Types ──────────────────────────────────────────────────── */

interface InternalFundItem {
  internalFundNo: string;
  status: string;
  amount: string;
  txHash?: string | null;
  createdAt: string;
  asset?: { code?: string; currency?: string; decimals?: number; type?: string };
  internalTransaction?: { internalTxNo?: string };
}

interface FilterState {
  internalFundNo: string;
  status: string;
  type: string;
  txHash: string;
  startDate: string;
  endDate: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const PAGE_SIZE = 20;

// 与 funds-flow.service.ts 的 InternalFundStatus 同步
const FUND_STATUSES = [
  'CREATED',
  'SIGNING',
  'BROADCASTED',
  'CONFIRMING',
  'CONFIRMED',
  'CLEAR',
  'FAILED',
  'TIMEOUT',
  'RETURNED',
  'CANCELLED',
];

const DEFAULT_FILTERS: FilterState = {
  internalFundNo: '',
  status: '',
  type: '',
  txHash: '',
  startDate: '',
  endDate: '',
};

/* ── Helpers ────────────────────────────────────────────────── */

const truncateHash = (hash?: string | null) => {
  if (!hash || hash.length < 14) return hash || '—';
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

/* ── Component ──────────────────────────────────────────────── */

const InternalFundListPage = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<InternalFundItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.internalFundNo.trim())
        params.set('internalFundNo', next.internalFundNo.trim());
      if (next.status.trim()) params.set('status', next.status.trim());
      if (next.type.trim()) params.set('type', next.type.trim());
      if (next.txHash.trim()) params.set('txHash', next.txHash.trim());
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/funds?${params.toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load internal funds.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load internal funds.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.internalFundNo || !!filters.status || !!filters.type ||
    !!filters.txHash || !!filters.startDate || !!filters.endDate;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Internal Funds"
        meta={`${total} fund${total === 1 ? '' : 's'}`}
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
          value={filters.internalFundNo}
          onChange={(e) => updateFilter('internalFundNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Fund No"
          className={`${fi} w-44`}
        />
        <input
          value={filters.txHash}
          onChange={(e) => updateFilter('txHash', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Tx Hash"
          className={`${fi} w-40`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All status</option>
          {FUND_STATUSES.map((s) => (
            <option key={s} value={s}>{formatRailStatusLabel(s)}</option>
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
                  ['Fund No',   '180px'],
                  ['Status',    '110px'],
                  ['Type',      '80px'],
                  ['Asset',     '90px'],
                  ['Amount',    '150px'],
                  ['Tx Hash',   '140px'],
                  ['Transfer',  '180px'],
                  ['Created',   '150px'],
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
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No funds found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.internalFundNo}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate('/admin/funds/internal-funds/' + item.internalFundNo)}
                >
                  {/* Fund No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.internalFundNo}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={item.status} />
                  </td>

                  {/* Type */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {item.asset?.type
                      ? item.asset.type.toUpperCase() === 'FIAT'
                        ? 'Fiat'
                        : 'Crypto'
                      : '—'}
                  </td>

                  {/* Asset */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t1">
                    {item.asset?.code || item.asset?.currency || '—'}
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                      {item.asset?.code || item.asset?.currency || ''}
                    </span>
                  </td>

                  {/* Tx Hash */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {truncateHash(item.txHash)}
                  </td>

                  {/* Transfer */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-adm-t2">
                      {item.internalTransaction?.internalTxNo || '—'}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleString()}
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
              ? `Showing ${items.length} / ${total} fund${total === 1 ? '' : 's'}`
              : 'No funds'}
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

export default InternalFundListPage;

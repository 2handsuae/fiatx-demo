// admin-web/src/pages/funds-layer/InternalTransferListPage.tsx
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
import { formatAssetAmount } from '../../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface TransferAsset {
  code: string;
  currency?: string | null;
  decimals?: number;
}

interface TransferItem {
  internalTxNo: string;
  pathLabel: string | null;
  accountingClass: string | null;
  medium: string | null;
  status: string;
  amount: string;
  asset: TransferAsset | null;
  createdAt: string;
}

interface FilterState {
  internalTxNo: string;
  pathLabel: string;
  status: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  internalTxNo: '',
  pathLabel: '',
  status: '',
};

/* ── Helpers ────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const InternalTransferListPage = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<TransferItem[]>([]);
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
      if (next.internalTxNo.trim()) params.set('internalTxNo', next.internalTxNo.trim());
      if (next.pathLabel.trim()) params.set('pathLabel', next.pathLabel.trim());
      if (next.status) params.set('status', next.status);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load transfers.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load transfers.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.internalTxNo || !!filters.pathLabel || !!filters.status;

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
        title="Internal Transfers"
        meta={`${total} transfer${total === 1 ? '' : 's'}`}
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
          value={filters.internalTxNo}
          onChange={(e) => updateFilter('internalTxNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Internal Tx No"
          className={`${fi} w-44`}
        />
        <input
          value={filters.pathLabel}
          onChange={(e) => updateFilter('pathLabel', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Path Label"
          className={`${fi} w-44`}
        />
        <input
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Status"
          className={`${fi} w-40`}
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
                  ['Internal Tx No', '180px'],
                  ['Path',           '200px'],
                  ['Status',         '130px'],
                  ['Asset',          '90px'],
                  ['Amount',         '150px'],
                  ['Created',        '150px'],
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
                  No transfers found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.internalTxNo}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/funds/transfers/${item.internalTxNo}`)}
                >
                  {/* Internal Tx No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.internalTxNo}
                    </span>
                  </td>

                  {/* Path */}
                  <td className="px-4 py-2.5">
                    {item.pathLabel ? (
                      <span className="inline-flex items-center gap-2 font-mono text-[10px] text-adm-t1">
                        <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-adm-blue" />
                        {item.pathLabel}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-adm-t3">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={item.status} />
                  </td>

                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {item.asset?.code || item.asset?.currency || '—'}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                      {item.asset?.code || ''}
                    </span>
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
              ? `Showing ${items.length} / ${total} transfer${total === 1 ? '' : 's'}`
              : 'No transfers'}
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

export default InternalTransferListPage;

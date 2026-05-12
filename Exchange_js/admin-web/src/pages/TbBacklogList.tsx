import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface TbBacklogRow {
  id: string;
  tbTransferId: string;
  transferData: string;
  evidenceData: string;
  errorMessage: string;
  retryCount: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface FilterState {
  status: string;
}

const DEFAULT_FILTERS: FilterState = { status: '' };
const PAGE_SIZE = 50;

const TbBacklogList = () => {
  const [items, setItems] = useState<TbBacklogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const fetchData = async (overridePage?: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (filters.status) params.set('status', filters.status);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/backlog?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch TB backlog.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load TB backlog.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    void fetchData(1);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="TB Backlog"
        meta={`${total} entr${total === 1 ? 'y' : 'ies'} · Evidence Backlog`}
      >
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
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button
          onClick={applyFilters}
          className="h-[30px] rounded border border-adm-amber/30 bg-adm-amber/10 px-3 font-mono text-[11px] font-semibold text-adm-amber hover:bg-adm-amber/20 transition-colors"
        >
          Apply
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {['Transfer ID', 'Error', 'Retries', 'Status', 'Created', 'Resolved'].map((h) => (
                <th
                  key={h}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No backlog entries found.</td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.id} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 max-w-[200px] truncate" title={row.tbTransferId}>
                  {row.tbTransferId}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-red max-w-[300px] truncate" title={row.errorMessage}>
                  {row.errorMessage}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 text-center">{row.retryCount}</td>
                <td className="px-4 py-3"><AdminBadge value={row.status} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.resolvedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0 ? `Showing ${items.length} / ${total} entries` : 'No entries'}
          </span>
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
};

export default TbBacklogList;

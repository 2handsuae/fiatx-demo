import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
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
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface ChangeTicketItem {
  id: string;
  ticketNo: string;
  status: string;
  changeType: string | null;
  approvalNo: string | null;
  traceId: string;
  createdAt: string;
}

interface ChangeTicketListResponse {
  total: number;
  skip: number;
  take: number;
  items: ChangeTicketItem[];
}

interface FilterState {
  ticketNo: string;
  status: string;
  changeType: string;
  traceId: string;
  keyword: string;
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
  ticketNo: '',
  status: '',
  changeType: '',
  traceId: '',
  keyword: '',
};

/* ─────────────────────────────────────────────────────────────── */

const ChangeTicketsPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const canCreate     = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_CREATE]);
  const canReadDetail = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_DETAIL_READ]);

  const [filters,     setFilters]     = useState<FilterState>(DEFAULT_FILTERS);
  const [items,       setItems]       = useState<ChangeTicketItem[]>([]);
  const [total,       setTotal]       = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.ticketNo.trim())   params.set('ticketNo',   next.ticketNo.trim());
    if (next.status.trim())     params.set('status',     next.status.trim());
    if (next.changeType.trim()) params.set('changeType', next.changeType.trim());
    if (next.traceId.trim())    params.set('traceId',    next.traceId.trim());
    if (next.keyword.trim())    params.set('keyword',    next.keyword.trim());
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load change tickets.'));

      const data = (await res.json()) as ChangeTicketListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load change tickets.');
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.ticketNo || !!filters.status || !!filters.changeType
    || !!filters.traceId || !!filters.keyword;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  const goToDetail = (itemId: string) => {
    if (canReadDetail) navigate(`/dashboard/control-gates/change-tickets/${itemId}`);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Change Tickets"
        meta={`${total} ticket${total === 1 ? '' : 's'} · Control Gates Center`}
      >
        {canCreate && (
          <Link
            to="/dashboard/control-gates/change-tickets/create"
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={13} />
            New Ticket
          </Link>
        )}
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
          value={filters.ticketNo}
          onChange={(e) => updateFilter('ticketNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Ticket No"
          className={`${fi} w-40`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="READY">READY</option>
          <option value="CONSUMED">CONSUMED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <input
          value={filters.changeType}
          onChange={(e) => updateFilter('changeType', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Change Type"
          className={`${fi} w-40`}
        />
        <input
          value={filters.traceId}
          onChange={(e) => updateFilter('traceId', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Trace ID"
          className={`${fi} w-40`}
        />
        <input
          value={filters.keyword}
          onChange={(e) => updateFilter('keyword', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Keyword"
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
                  ['Ticket No',    '180px'],
                  ['Change Type',  '170px'],
                  ['Status',       '150px'],
                  ['Approval No',  '170px'],
                  ['Trace ID',     '220px'],
                  ['Created',      'auto'],
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
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No change tickets found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className={[
                  'border-b border-adm-border transition-colors hover:bg-adm-hover',
                  canReadDetail ? 'cursor-pointer' : '',
                ].join(' ')}
                onClick={() => goToDetail(item.id)}
              >
                {/* Ticket No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.ticketNo}
                  </span>
                </td>

                {/* Change Type */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.changeType ?? '—'}
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Approval No */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.approvalNo ?? '—'}
                </td>

                {/* Trace ID */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t3 whitespace-nowrap">
                  <span className="block max-w-[220px] truncate">{item.traceId}</span>
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
              ? `Showing ${items.length} / ${total} ticket${total === 1 ? '' : 's'}`
              : 'No tickets'}
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

export default ChangeTicketsPage;

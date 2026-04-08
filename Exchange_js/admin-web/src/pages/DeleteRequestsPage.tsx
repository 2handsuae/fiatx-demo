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

interface DeleteRequestItem {
  id: string;
  requestNo: string;
  targetType: string;
  targetNo: string;
  status: string;
  approvalNo: string | null;
  createdByUserNo: string;
  consumedByUserNo: string | null;
  createdAt: string;
}

interface DeleteRequestListResponse {
  total: number;
  skip: number;
  take: number;
  items: DeleteRequestItem[];
}

interface FilterState {
  requestNo: string;
  targetType: string;
  targetNo: string;
  status: string;
  approvalNo: string;
  createdByUserNo: string;
  consumedByUserNo: string;
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

const TARGET_TYPE_OPTIONS = [
  'CHANGE_TICKET',
  'AUDIT_EVIDENCE_PACKAGE',
  'ADMIN_USER',
] as const;

const STATUS_OPTIONS = [
  'DRAFT',
  'PENDING_APPROVAL',
  'READY',
  'DONE',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;

const DEFAULT_FILTERS: FilterState = {
  requestNo: '',
  targetType: '',
  targetNo: '',
  status: '',
  approvalNo: '',
  createdByUserNo: '',
  consumedByUserNo: '',
  traceId: '',
  keyword: '',
};

/* ─────────────────────────────────────────────────────────────── */

const DeleteRequestsPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const canCreate     = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CREATE]);
  const canViewDetail = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_DETAIL_READ]);

  const [filters,     setFilters]     = useState<FilterState>(DEFAULT_FILTERS);
  const [items,       setItems]       = useState<DeleteRequestItem[]>([]);
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
    if (next.requestNo.trim())        params.set('requestNo',        next.requestNo.trim());
    if (next.targetType.trim())       params.set('targetType',       next.targetType.trim());
    if (next.targetNo.trim())         params.set('targetNo',         next.targetNo.trim());
    if (next.status.trim())           params.set('status',           next.status.trim().toUpperCase());
    if (next.approvalNo.trim())       params.set('approvalNo',       next.approvalNo.trim());
    if (next.createdByUserNo.trim())  params.set('createdByUserNo',  next.createdByUserNo.trim());
    if (next.consumedByUserNo.trim()) params.set('consumedByUserNo', next.consumedByUserNo.trim());
    if (next.traceId.trim())          params.set('traceId',          next.traceId.trim());
    if (next.keyword.trim())          params.set('keyword',          next.keyword.trim());
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load delete requests.'));

      const data = (await res.json()) as DeleteRequestListResponse;
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
        setError(err instanceof Error ? err.message : 'Failed to load delete requests.');
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
    !!filters.requestNo || !!filters.targetType || !!filters.targetNo
    || !!filters.status || !!filters.approvalNo || !!filters.createdByUserNo
    || !!filters.consumedByUserNo || !!filters.traceId || !!filters.keyword;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  const goToDetail = (itemId: string) => {
    if (canViewDetail) navigate(`/dashboard/control-gates/delete-requests/${itemId}`);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Delete Requests"
        meta={`${total} request${total === 1 ? '' : 's'} · Control Gates Center`}
      >
        {canCreate && (
          <Link
            to="/dashboard/control-gates/delete-requests/create"
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={13} />
            New Request
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
          value={filters.requestNo}
          onChange={(e) => updateFilter('requestNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Request No"
          className={`${fi} w-40`}
        />
        <select
          value={filters.targetType}
          onChange={(e) => updateFilter('targetType', e.target.value)}
          className={`${fi} w-48`}
        >
          <option value="">All target types</option>
          {TARGET_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          value={filters.targetNo}
          onChange={(e) => updateFilter('targetNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Target No"
          className={`${fi} w-40`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          value={filters.approvalNo}
          onChange={(e) => updateFilter('approvalNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Approval No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.createdByUserNo}
          onChange={(e) => updateFilter('createdByUserNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Created By"
          className={`${fi} w-36`}
        />
        <input
          value={filters.consumedByUserNo}
          onChange={(e) => updateFilter('consumedByUserNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Consumed By"
          className={`${fi} w-36`}
        />
        <input
          value={filters.traceId}
          onChange={(e) => updateFilter('traceId', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Trace ID"
          className={`${fi} w-36`}
        />
        <input
          value={filters.keyword}
          onChange={(e) => updateFilter('keyword', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Keyword"
          className={`${fi} w-32`}
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
                  ['Request No',  '180px'],
                  ['Target Type', '190px'],
                  ['Target No',   '170px'],
                  ['Status',      '150px'],
                  ['Approval No', '170px'],
                  ['Created By',  '130px'],
                  ['Consumed By', '130px'],
                  ['Created',     'auto'],
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
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No delete requests found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className={[
                  'border-b border-adm-border transition-colors hover:bg-adm-hover',
                  canViewDetail ? 'cursor-pointer' : '',
                ].join(' ')}
                onClick={() => goToDetail(item.id)}
              >
                {/* Request No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.requestNo}
                  </span>
                </td>

                {/* Target Type */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.targetType}
                </td>

                {/* Target No */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.targetNo}
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Approval No */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.approvalNo ?? '—'}
                </td>

                {/* Created By */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.createdByUserNo}
                </td>

                {/* Consumed By */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.consumedByUserNo ?? '—'}
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
              ? `Showing ${items.length} / ${total} request${total === 1 ? '' : 's'}`
              : 'No requests'}
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

export default DeleteRequestsPage;

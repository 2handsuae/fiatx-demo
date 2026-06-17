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

interface ApprovalStep {
  stepNo: number;
  status: string;
  checkerRoleCandidates: string[];
  decidedByUserNo?: string | null;
  decidedByRole?: string | null;
  decidedAt?: string | null;
}

interface ApprovalItem {
  id: string;
  approvalNo: string;
  actionType: string;
  entityRef: string;
  createdByUserId: string;
  createdByUserNo?: string | null;
  status: string;
  traceId?: string | null;
  createdAt: string;
  steps?: ApprovalStep[];
  evidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
}

interface ApprovalListResponse {
  total: number;
  skip: number;
  take: number;
  items: ApprovalItem[];
}

interface FilterState {
  approvalNo: string;
  actionType: string;
  status: string;
  entityRef: string;
  traceId: string;
  keyword: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const TERMINAL = new Set(['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

const getLastDecidedStep = (steps?: ApprovalStep[]) => {
  if (!steps?.length) return null;
  return [...steps]
    .filter((s) => s.decidedAt)
    .sort((a, b) => new Date(b.decidedAt!).getTime() - new Date(a.decidedAt!).getTime())[0] || null;
};

const getCurrentChecker = (item: ApprovalItem): string => {
  if (TERMINAL.has(item.status)) return '—';
  const pending = item.steps?.find((s) => s.status === 'PENDING');
  if (!pending) return '—';
  return pending.checkerRoleCandidates?.join(', ') || '—';
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  approvalNo: '',
  actionType: '',
  status: '',
  entityRef: '',
  traceId: '',
  keyword: '',
};

/* ─────────────────────────────────────────────────────────────── */

const ApprovalsPage = () => {
  const navigate = useNavigate();

  const [filters,     setFilters]     = useState<FilterState>(DEFAULT_FILTERS);
  const [items,       setItems]       = useState<ApprovalItem[]>([]);
  const [total,       setTotal]       = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.approvalNo.trim()) params.set('approvalNo', next.approvalNo.trim());
    if (next.actionType.trim()) params.set('actionType', next.actionType.trim());
    if (next.status.trim())     params.set('status',     next.status.trim());
    if (next.entityRef.trim())  params.set('entityRef',  next.entityRef.trim());
    if (next.traceId.trim())    params.set('traceId',    next.traceId.trim());
    if (next.keyword.trim())    params.set('keyword',    next.keyword.trim());
    return params;
  };

  const fetchApprovals = async (page: number, next: FilterState = filters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load approvals.'));

      const data = (await res.json()) as ApprovalListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load approvals.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchApprovals(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.approvalNo || !!filters.actionType || !!filters.status
    || !!filters.entityRef || !!filters.traceId || !!filters.keyword;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchApprovals(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchApprovals(1, DEFAULT_FILTERS);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Approvals"
        meta={`${total} approval${total === 1 ? '' : 's'} · Control Gates Center`}
      >
        <button
          onClick={() => void fetchApprovals(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.approvalNo}
          onChange={(e) => updateFilter('approvalNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Approval No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.actionType}
          onChange={(e) => updateFilter('actionType', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Action Type"
          className={`${fi} w-40`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
        </select>
        <input
          value={filters.entityRef}
          onChange={(e) => updateFilter('entityRef', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Entity Ref"
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
                  ['Approval No',   '170px'],
                  ['Action Type',   '150px'],
                  ['Status',        '110px'],
                  ['Maker',         '120px'],
                  ['Checker',       '140px'],
                  ['Created',       '150px'],
                  ['Decided',       '150px'],
                  ['Decided By',    'auto'],
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
                  No approvals found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/governance/approvals/${item.id}`)}
              >
                {/* Approval No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.approvalNo}
                  </span>
                </td>

                {/* Action Type */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.actionType}
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Maker */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.createdByUserNo ?? item.createdByUserId}
                </td>

                {/* Checker */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {getCurrentChecker(item)}
                </td>

                {/* Created */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>

                {/* Decided */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(getLastDecidedStep(item.steps)?.decidedAt)}
                </td>

                {/* Decided By */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {getLastDecidedStep(item.steps)?.decidedByRole || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      {total > PAGE_SIZE ? (
        <div className="shrink-0">
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => void fetchApprovals(page)}
          />
        </div>
      ) : (
        <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} approval${total === 1 ? '' : 's'}`
              : 'No approvals'}
          </span>
        </div>
      )}

    </div>
  );
};

export default ApprovalsPage;

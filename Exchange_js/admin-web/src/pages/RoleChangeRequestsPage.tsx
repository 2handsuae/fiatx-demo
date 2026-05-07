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

interface RoleChangeRequestItem {
  id: string;
  requestNo: string;
  targetUserId: string;
  currentRoleCodes: string;
  proposedRoleCodes: string;
  changeReason: string;
  status: string;
  requestedByUserId: string;
  approvalCaseNo?: string | null;
  createdAt: string;
  executedAt?: string | null;
  targetUser?: { id: string; userNo: string; email: string } | null;
}

interface ListResponse {
  total: number;
  page: number;
  limit: number;
  items: RoleChangeRequestItem[];
}

interface FilterState {
  status: string;
  targetUserId: string;
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const parseRoles = (json: string): string[] => {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
};

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = { status: '', targetUserId: '' };

export default function RoleChangeRequestsPage() {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<RoleChangeRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (page: number, next: FilterState = filters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      if (next.status.trim()) params.set('status', next.status.trim());
      if (next.targetUserId.trim()) params.set('targetUserId', next.targetUserId.trim());

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-change-requests?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load requests.'));

      const data = (await res.json()) as ListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load requests.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(1, DEFAULT_FILTERS); }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.status || !!filters.targetUserId;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchData(1, filters);
  const handleReset = () => { setFilters(DEFAULT_FILTERS); void fetchData(1, DEFAULT_FILTERS); };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="Role Change Requests"
        meta={`${total} request${total === 1 ? '' : 's'} · Identity & Access`}
      >
        <button
          onClick={() => void fetchData(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <input
          value={filters.targetUserId}
          onChange={(e) => updateFilter('targetUserId', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Target User ID"
          className={`${fi} w-56`}
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

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Request No', '160px'],
                  ['Target User', '140px'],
                  ['Current Roles', '150px'],
                  ['Proposed Roles', '150px'],
                  ['Status', '140px'],
                  ['Approval No', '150px'],
                  ['Created', '150px'],
                  ['Executed', 'auto'],
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
                  No role change requests found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/members/role-change-requests/${item.id}`)}
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.requestNo}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.targetUser?.userNo || item.targetUserId.slice(0, 8)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {parseRoles(item.currentRoleCodes).map((r) => (
                      <span key={r} className="inline-flex rounded border border-adm-border bg-adm-bg px-1.5 py-0.5 font-mono text-[9px] text-adm-t2">
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {parseRoles(item.proposedRoleCodes).map((r) => (
                      <span key={r} className="inline-flex rounded border border-adm-blue/25 bg-adm-blue/10 px-1.5 py-0.5 font-mono text-[9px] text-adm-blue">
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.approvalCaseNo ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.executedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              onPageChange={(page) => void fetchData(page)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

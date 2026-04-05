import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

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

const PAGE_SIZE = 20;
const TARGET_TYPE_OPTIONS = [
  '',
  'CHANGE_TICKET',
  'AUDIT_EVIDENCE_PACKAGE',
  'ADMIN_USER',
] as const;

const createDefaultFilters = (): FilterState => ({
  requestNo: '',
  targetType: '',
  targetNo: '',
  status: '',
  approvalNo: '',
  createdByUserNo: '',
  consumedByUserNo: '',
  traceId: '',
  keyword: '',
});

const normalizeStatusInput = (value: string) => {
  return value.trim().toUpperCase();
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const DeleteRequestsPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const canCreate = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CREATE]);
  const canViewDetail = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_DETAIL_READ]);
  const [filters, setFilters] = useState<FilterState>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => createDefaultFilters());
  const [items, setItems] = useState<DeleteRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.requestNo.trim()) params.set('requestNo', nextFilters.requestNo.trim());
    if (nextFilters.targetType.trim()) params.set('targetType', nextFilters.targetType.trim());
    if (nextFilters.targetNo.trim()) params.set('targetNo', nextFilters.targetNo.trim());
    if (nextFilters.status.trim()) params.set('status', normalizeStatusInput(nextFilters.status));
    if (nextFilters.approvalNo.trim()) params.set('approvalNo', nextFilters.approvalNo.trim());
    if (nextFilters.createdByUserNo.trim()) {
      params.set('createdByUserNo', nextFilters.createdByUserNo.trim());
    }
    if (nextFilters.consumedByUserNo.trim()) {
      params.set('consumedByUserNo', nextFilters.consumedByUserNo.trim());
    }
    if (nextFilters.traceId.trim()) params.set('traceId', nextFilters.traceId.trim());
    if (nextFilters.keyword.trim()) params.set('keyword', nextFilters.keyword.trim());
    return params;
  };

  const fetchItems = async (page: number, nextFilters: FilterState) => {
    const requestId = ++requestSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests?${buildParams(
          page,
          nextFilters,
        ).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load delete requests.'));
      }

      const data = (await response.json()) as DeleteRequestListResponse;
      if (requestId !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (requestId !== requestSeqRef.current) return;
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load delete requests.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchItems(currentPage, appliedFilters);
  }, [currentPage, appliedFilters]);

  const handleSearch = () => {
    const nextFilters = { ...filters };
    setAppliedFilters(nextFilters);
    setCurrentPage(1);
  };

  const handleReset = () => {
    const nextFilters = createDefaultFilters();
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delete Requests</h1>
          <p className="mt-1 text-sm text-gray-500">Search and review governed delete requests.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchItems(currentPage, appliedFilters)}
            className={adminIconButtonClass()}
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          {canCreate && (
            <Link
              to="/dashboard/control-gates/delete-requests/create"
              className={adminButtonClass('listPrimary')}
            >
              <Plus size={16} />
              New Request
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <input
            value={filters.requestNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, requestNo: e.target.value }))}
            placeholder="Request No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={filters.targetType}
            onChange={(e) => setFilters((prev) => ({ ...prev, targetType: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {TARGET_TYPE_OPTIONS.map((item) =>
              item === '' ? (
                <option key="all" value="">
                  Target Type
                </option>
              ) : (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
          <input
            value={filters.targetNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, targetNo: e.target.value }))}
            placeholder="Target No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            placeholder="Status"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.approvalNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, approvalNo: e.target.value }))}
            placeholder="Approval No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.createdByUserNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, createdByUserNo: e.target.value }))}
            placeholder="Created By User No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.consumedByUserNo}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, consumedByUserNo: e.target.value }))
            }
            placeholder="Consumed By User No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.traceId}
            onChange={(e) => setFilters((prev) => ({ ...prev, traceId: e.target.value }))}
            placeholder="Trace ID"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder="Keyword"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
            <Search size={16} />
            Search
          </button>
          <button onClick={handleReset} className={adminButtonClass('listSecondary')}>
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Request No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Target Type</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Target No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Approval No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created By</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Consumed By</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No delete requests found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {canViewDetail ? (
                        <button
                          onClick={() =>
                            navigate(`/dashboard/control-gates/delete-requests/${item.id}`)
                          }
                          className={adminButtonClass('rowKeyLink')}
                        >
                          {item.requestNo}
                        </button>
                      ) : (
                        <span className="font-mono text-xs text-gray-700">{item.requestNo}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.targetType}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{item.targetNo}</td>
                    <td className="px-4 py-3 text-gray-700">{item.status}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.approvalNo || '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.createdByUserNo}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.consumedByUserNo || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        totalItems={total}
        pageSize={PAGE_SIZE}
        currentPage={currentPage}
        onPageChange={(page) => setCurrentPage(page)}
      />
    </div>
  );
};

export default DeleteRequestsPage;

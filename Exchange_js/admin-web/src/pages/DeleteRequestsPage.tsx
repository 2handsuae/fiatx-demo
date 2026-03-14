import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface DeleteRequestItem {
  id: string;
  requestNo: string;
  targetType: string;
  targetNo: string;
  status: string;
  latestApprovalStatus: string | null;
  latestApprovalNo: string | null;
  traceId: string;
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
  latestApprovalStatus: string;
  traceId: string;
  keyword: string;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  requestNo: '',
  targetType: '',
  targetNo: '',
  status: '',
  latestApprovalStatus: '',
  traceId: '',
  keyword: '',
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
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<DeleteRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.requestNo.trim()) params.set('requestNo', nextFilters.requestNo.trim());
    if (nextFilters.targetType.trim()) params.set('targetType', nextFilters.targetType.trim());
    if (nextFilters.targetNo.trim()) params.set('targetNo', nextFilters.targetNo.trim());
    if (nextFilters.status.trim()) params.set('status', nextFilters.status.trim());
    if (nextFilters.latestApprovalStatus.trim()) {
      params.set('latestApprovalStatus', nextFilters.latestApprovalStatus.trim());
    }
    if (nextFilters.traceId.trim()) params.set('traceId', nextFilters.traceId.trim());
    if (nextFilters.keyword.trim()) params.set('keyword', nextFilters.keyword.trim());
    return params;
  };

  const fetchItems = async (page: number, nextFilters: FilterState = filters) => {
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
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load delete requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Control Gates Center - Delete Requests</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create, review, and execute soft-delete requests with approval linkage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchItems(currentPage)}
            className="p-2 text-gray-500 hover:text-brand-primary"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          {canCreate && (
            <Link
              to="/dashboard/control-gates/delete-requests/create"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <input
            value={filters.requestNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, requestNo: e.target.value }))}
            placeholder="Request No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.targetType}
            onChange={(e) => setFilters((prev) => ({ ...prev, targetType: e.target.value }))}
            placeholder="Target Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
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
            value={filters.latestApprovalStatus}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, latestApprovalStatus: e.target.value }))
            }
            placeholder="Approval Status"
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
          <button
            onClick={() => void fetchItems(1)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              void fetchItems(1, DEFAULT_FILTERS);
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Approval</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Trace ID</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
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
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/delete-requests/${item.id}`)}
                        className="font-mono text-xs text-brand-primary hover:underline"
                      >
                        {item.requestNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.targetType}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{item.targetNo}</td>
                    <td className="px-4 py-3 text-gray-700">{item.status}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.latestApprovalStatus || '-'}
                      {item.latestApprovalNo ? (
                        <div className="font-mono text-xs text-gray-500">{item.latestApprovalNo}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.traceId}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDateTime(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/delete-requests/${item.id}`)}
                        className="rounded-lg border border-admin-border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        View
                      </button>
                    </td>
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
        onPageChange={(page) => void fetchItems(page)}
      />
    </div>
  );
};

export default DeleteRequestsPage;

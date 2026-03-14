import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface ApprovalItem {
  id: string;
  approvalNo: string;
  actionType: string;
  entityRef: string;
  makerUserId: string;
  status: string;
  executionStatus: string;
  decidedAt?: string | null;
  createdAt: string;
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

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  approvalNo: '',
  actionType: '',
  status: '',
  entityRef: '',
  traceId: '',
  keyword: '',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const ApprovalsPage = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));

    if (nextFilters.approvalNo.trim()) params.set('approvalNo', nextFilters.approvalNo.trim());
    if (nextFilters.actionType.trim()) params.set('actionType', nextFilters.actionType.trim());
    if (nextFilters.status.trim()) params.set('status', nextFilters.status.trim());
    if (nextFilters.entityRef.trim()) params.set('entityRef', nextFilters.entityRef.trim());
    if (nextFilters.traceId.trim()) params.set('traceId', nextFilters.traceId.trim());
    if (nextFilters.keyword.trim()) params.set('keyword', nextFilters.keyword.trim());
    return params;
  };

  const fetchApprovals = async (page: number, nextFilters: FilterState = filters) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals?${buildParams(page, nextFilters).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load approvals.'));
      }

      const data = (await response.json()) as ApprovalListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load approvals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchApprovals(1, DEFAULT_FILTERS);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Control Gates Center - Approvals</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review approval cases for sensitive control-gate actions, including evidence export requests.
          </p>
        </div>
        <button
          onClick={() => void fetchApprovals(currentPage)}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
          <input
            value={filters.approvalNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, approvalNo: e.target.value }))}
            placeholder="Approval No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.actionType}
            onChange={(e) => setFilters((prev) => ({ ...prev, actionType: e.target.value }))}
            placeholder="Action Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            placeholder="Status"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.entityRef}
            onChange={(e) => setFilters((prev) => ({ ...prev, entityRef: e.target.value }))}
            placeholder="Entity Ref"
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
            onClick={() => void fetchApprovals(1)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              void fetchApprovals(1, DEFAULT_FILTERS);
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Approval No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Action Type</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Entity Ref</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Maker</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Execution</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Decided At</th>
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
                    No approvals found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/approvals/${item.id}`)}
                        className="font-mono text-xs text-brand-primary hover:underline"
                      >
                        {item.approvalNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.actionType}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-gray-700">{item.entityRef}</div>
                      {item.evidencePackage && (
                        <div className="text-xs text-gray-500">
                          {item.evidencePackage.packageNo} · {item.evidencePackage.status}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.makerUserId}</td>
                    <td className="px-4 py-3 text-gray-700">{item.status}</td>
                    <td className="px-4 py-3 text-gray-700">{item.executionStatus}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.decidedAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/approvals/${item.id}`)}
                        className="text-sm font-medium text-brand-primary hover:underline"
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
        <div className="border-t border-admin-border px-4 py-4">
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => void fetchApprovals(page)}
          />
        </div>
      </div>
    </div>
  );
};

export default ApprovalsPage;

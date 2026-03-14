import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface SlaTimerItem {
  id: string;
  timerNo: string;
  timerType: string;
  status: string;
  workflowNo: string;
  subjectNo: string;
  ownerUserId: string;
  dueAt: string;
  traceId: string;
  notificationSummary?: {
    total: number;
    latestType: string | null;
    latestStatus: string | null;
  } | null;
}

interface SlaTimerListResponse {
  total: number;
  skip: number;
  take: number;
  items: SlaTimerItem[];
}

interface FilterState {
  timerNo: string;
  timerType: string;
  status: string;
  workflowType: string;
  workflowNo: string;
  subjectType: string;
  subjectNo: string;
  ownerUserId: string;
  traceId: string;
  keyword: string;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  timerNo: '',
  timerType: '',
  status: '',
  workflowType: '',
  workflowNo: '',
  subjectType: '',
  subjectNo: '',
  ownerUserId: '',
  traceId: '',
  keyword: '',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const SlaTimersPage = () => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<SlaTimerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.timerNo.trim()) params.set('timerNo', nextFilters.timerNo.trim());
    if (nextFilters.timerType.trim()) params.set('timerType', nextFilters.timerType.trim());
    if (nextFilters.status.trim()) params.set('status', nextFilters.status.trim());
    if (nextFilters.workflowType.trim()) {
      params.set('workflowType', nextFilters.workflowType.trim());
    }
    if (nextFilters.workflowNo.trim()) params.set('workflowNo', nextFilters.workflowNo.trim());
    if (nextFilters.subjectType.trim()) params.set('subjectType', nextFilters.subjectType.trim());
    if (nextFilters.subjectNo.trim()) params.set('subjectNo', nextFilters.subjectNo.trim());
    if (nextFilters.ownerUserId.trim()) {
      params.set('ownerUserId', nextFilters.ownerUserId.trim());
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
        `${import.meta.env.VITE_API_URL}/admin/governance/sla-timers?${buildParams(
          page,
          nextFilters,
        ).toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load SLA timers.'));
      }

      const data = (await response.json()) as SlaTimerListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load SLA timers.');
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
          <h1 className="text-2xl font-bold text-gray-900">Governance Center - SLA Timers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track approval timeout SLA and emergency change follow-up obligations.
          </p>
        </div>
        <button
          onClick={() => void fetchItems(currentPage)}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <input
            value={filters.timerNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, timerNo: e.target.value }))}
            placeholder="Timer No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.timerType}
            onChange={(e) => setFilters((prev) => ({ ...prev, timerType: e.target.value }))}
            placeholder="Timer Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            placeholder="Status"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.workflowType}
            onChange={(e) => setFilters((prev) => ({ ...prev, workflowType: e.target.value }))}
            placeholder="Workflow Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.workflowNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, workflowNo: e.target.value }))}
            placeholder="Workflow No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.subjectType}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectType: e.target.value }))}
            placeholder="Subject Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectNo: e.target.value }))}
            placeholder="Subject No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.ownerUserId}
            onChange={(e) => setFilters((prev) => ({ ...prev, ownerUserId: e.target.value }))}
            placeholder="Owner User ID"
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Timer No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Timer Type</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Owner</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Due At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Notifications</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Trace ID</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                    No SLA timers found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-brand-primary">
                      <Link
                        to={`/dashboard/governance/sla-timers/${item.id}`}
                        className="hover:underline"
                      >
                        {item.timerNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.timerType}</td>
                    <td className="px-4 py-3 text-gray-700">{item.status}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{item.workflowNo}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{item.subjectNo}</td>
                    <td className="px-4 py-3 text-gray-700">{item.ownerUserId}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.dueAt)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.notificationSummary?.total ? (
                        <div className="space-y-1">
                          <div>{item.notificationSummary.total} registered</div>
                          <div className="text-xs text-gray-500">
                            {item.notificationSummary.latestType || '-'} /{' '}
                            {item.notificationSummary.latestStatus || '-'}
                          </div>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{item.traceId}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/dashboard/governance/sla-timers/${item.id}`}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-admin-border px-4 py-3">
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => void fetchItems(page)}
          />
        </div>
      </div>
    </div>
  );
};

export default SlaTimersPage;

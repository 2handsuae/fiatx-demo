import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type PoolSettlementBatchSummary = {
  scannedSourceCount?: number;
  routableSourceCount?: number;
  skippedSourceCount?: number;
  bucketCount?: number;
  nettableBucketCount?: number;
  createdItemCount?: number;
  nettedSourceCount?: number;
  skippedSourcesByReason?: Record<string, number>;
};

type PoolSettlementBatchListItem = {
  id: string;
  batchNo: string;
  status: string;
  cutoffAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  approvalCaseId?: string | null;
  autoCreated: boolean;
  createdAt: string;
  createdByUserId: string;
  summaryJson?: PoolSettlementBatchSummary | null;
};

type PoolSettlementBatchListResponse = {
  items: PoolSettlementBatchListItem[];
  total: number;
  skip?: number;
  take?: number;
};

type FilterState = {
  status: string;
  autoCreated: string;
};

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  autoCreated: '',
};

const BATCH_STATUS_OPTIONS = [
  '',
  'CREATED',
  'APPROVAL_PENDING',
  'APPROVED',
  'EXECUTING',
  'SUCCESS',
  'PARTIAL_FAILED',
  'FAILED',
  'CANCELLED',
] as const;

const BATCH_STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-amber-100 text-amber-800',
  APPROVAL_PENDING: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  EXECUTING: 'bg-sky-100 text-sky-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  PARTIAL_FAILED: 'bg-orange-100 text-orange-800',
  FAILED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-100 text-slate-800',
};

const PoolSettlementBatchListPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PoolSettlementBatchListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const canCreate = hasAnyPermission([PERMISSIONS.POOL_SETTLEMENT_BATCH_CREATE]);

  const buildParams = (page: number, nextFilters: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (nextFilters.status) params.set('status', nextFilters.status);
    if (nextFilters.autoCreated) params.set('autoCreated', nextFilters.autoCreated);
    return params;
  };

  const fetchBatches = async (page: number, nextFilters: FilterState = filters) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pool-settlement-batches?${buildParams(page, nextFilters).toString()}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load pool settlement batches.'),
        );
      }

      const data = (await response.json()) as PoolSettlementBatchListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load pool settlement batches.');
    } finally {
      setLoading(false);
    }
  };

  const createBatch = async () => {
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/pool-settlement-batches`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ autoCreated: false }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to create pool settlement batch.'),
        );
      }

      const data = (await response.json()) as { id?: string; batchNo?: string };
      if (!data.id) {
        throw new Error('Pool settlement batch created but no id was returned.');
      }
      navigate(`/dashboard/treasury/pool-settlement-batches/${data.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create pool settlement batch.');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    void fetchBatches(1, DEFAULT_FILTERS);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Treasury Center - Pool Settlement Batches
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Review netted settlement batches before they move into the approval workflow.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void fetchBatches(currentPage)}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {canCreate ? (
            <button
              onClick={() => void createBatch()}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={16} />
              {creating ? 'Creating...' : 'Create Batch'}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {BATCH_STATUS_OPTIONS.map((status) => (
              <option key={status || 'ALL'} value={status}>
                {status || 'All Statuses'}
              </option>
            ))}
          </select>
          <select
            value={filters.autoCreated}
            onChange={(e) => setFilters((prev) => ({ ...prev, autoCreated: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Batch Types</option>
            <option value="false">Manual Only</option>
            <option value="true">Auto-created Only</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void fetchBatches(1)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              void fetchBatches(1, DEFAULT_FILTERS);
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Batch No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Cutoff</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Summary</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Approval</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No pool settlement batches found
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const summary = item.summaryJson || {};
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{item.batchNo}</div>
                        <div className="mt-1 text-xs text-gray-500">{item.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge value={item.status} colors={BATCH_STATUS_COLORS} />
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDateTime(item.cutoffAt)}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div className="flex items-center gap-1 font-medium text-gray-800">
                          <Layers size={14} />
                          Routable {summary.routableSourceCount ?? 0}
                        </div>
                        <div className="mt-1">Skipped {summary.skippedSourceCount ?? 0}</div>
                        <div className="mt-1">Items {summary.createdItemCount ?? 0}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div>{item.approvalCaseId || '-'}</div>
                        <div className="mt-1">
                          {item.submittedAt ? `Submitted ${formatDateTime(item.submittedAt)}` : 'Not submitted'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div>{formatDateTime(item.createdAt)}</div>
                        <div className="mt-1">
                          {item.autoCreated ? 'Auto-created' : 'Manual'} by {item.createdByUserId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            navigate(`/dashboard/treasury/pool-settlement-batches/${item.id}`)
                          }
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-brand-primary hover:bg-brand-primary/5"
                        >
                          View Detail
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchBatches(page)}
        />
      </div>
    </div>
  );
};

export default PoolSettlementBatchListPage;

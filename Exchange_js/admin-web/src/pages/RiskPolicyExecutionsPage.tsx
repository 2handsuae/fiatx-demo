import { useEffect, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type DecisionRecordStatus = 'CREATED' | 'COMPLETED' | 'FAILED';

type DecisionRecordItem = {
  id: string;
  customerId: string;
  contextType: string;
  subjectType: string;
  subjectId: string;
  ownerType: string;
  ownerId: string;
  policyVersion: string;
  status: DecisionRecordStatus | string;
  outputDecision?: string | null;
  reasonCodes?: string[];
  recommendedActions?: Array<Record<string, unknown>>;
  workflow?: string | null;
  stage?: string | null;
  rule?: string | null;
  orchestration?: Record<string, unknown>;
  workflowTransition?: Record<string, unknown>;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
  customer?: {
    id: string;
    customerNo?: string | null;
    email?: string | null;
  } | null;
};

type DecisionRecordDetail = DecisionRecordItem & {
  inputHash: string;
  inputPayload?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  updatedAt: string;
};

interface DecisionRecordListResponse {
  total: number;
  skip: number;
  take: number;
  items: DecisionRecordItem[];
}

interface FilterState {
  status: string;
  contextType: string;
  outputDecision: string;
  ownerId: string;
  subjectId: string;
  policyVersion: string;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  contextType: '',
  outputDecision: '',
  ownerId: '',
  subjectId: '',
  policyVersion: '',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const toPrettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getStatusClass = (status: string) => {
  if (status === 'COMPLETED') return 'bg-green-100 text-green-800';
  if (status === 'FAILED') return 'bg-red-100 text-red-800';
  return 'bg-yellow-100 text-yellow-800';
};

const RiskPolicyExecutionsPage = () => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<DecisionRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<DecisionRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRecords = async (
    targetPage: number,
    activeFilters: FilterState = filters,
  ) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((targetPage - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      if (activeFilters.status.trim()) params.set('status', activeFilters.status.trim());
      if (activeFilters.contextType.trim()) {
        params.set('contextType', activeFilters.contextType.trim());
      }
      if (activeFilters.outputDecision.trim()) {
        params.set('outputDecision', activeFilters.outputDecision.trim());
      }
      if (activeFilters.ownerId.trim()) {
        params.set('ownerId', activeFilters.ownerId.trim());
      }
      if (activeFilters.subjectId.trim()) {
        params.set('subjectId', activeFilters.subjectId.trim());
      }
      if (activeFilters.policyVersion.trim()) {
        params.set('policyVersion', activeFilters.policyVersion.trim());
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/risk/decision-records?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load decision records.'));
      }

      const data = (await response.json()) as DecisionRecordListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(targetPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load decision records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecords(1, DEFAULT_FILTERS);
  }, []);

  const handleSearch = async () => {
    await fetchRecords(1, filters);
  };

  const handleReset = async () => {
    setFilters(DEFAULT_FILTERS);
    setDetail(null);
    await fetchRecords(1, DEFAULT_FILTERS);
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/risk/decision-records/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load decision record detail.'));
      }
      const data = (await response.json()) as DecisionRecordDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load decision record detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Risk Management - Risk Policy Executions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review Risk Engine execution and decision records one by one.
          </p>
        </div>
        <button
          onClick={() => void fetchRecords(currentPage, filters)}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {message && (
        <div className="px-4 py-3 border border-green-200 bg-green-50 rounded-lg text-green-700 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            placeholder="Status (CREATED/COMPLETED/FAILED)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.contextType}
            onChange={(e) => setFilters((prev) => ({ ...prev, contextType: e.target.value }))}
            placeholder="Context Type (ONBOARDING_CDD/ONBOARDING_EDD)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.outputDecision}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, outputDecision: e.target.value }))
            }
            placeholder="Output Decision (APPROVE/REJECT/REQUIRE_EDD/REVIEW)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.ownerId}
            onChange={(e) => setFilters((prev) => ({ ...prev, ownerId: e.target.value }))}
            placeholder="Owner ID"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.subjectId}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectId: e.target.value }))}
            placeholder="Subject ID"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.policyVersion}
            onChange={(e) => setFilters((prev) => ({ ...prev, policyVersion: e.target.value }))}
            placeholder="Policy Version"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSearch()}
            disabled={loading}
            className="px-4 py-2 text-sm bg-brand-primary text-white rounded-lg hover:opacity-90 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <Search size={16} />
              Search
            </span>
          </button>
          <button
            onClick={() => void handleReset()}
            disabled={loading}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Time</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">DecisionRecord</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Context</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Owner</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Policy</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Decision</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Reason Codes</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Actions</th>
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
                    No decision records found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">
                      <div>{formatDateTime(item.createdAt)}</div>
                      <div className="text-xs text-gray-400">
                        Completed: {formatDateTime(item.completedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{item.id.slice(0, 12)}...</div>
                      <div className="text-xs text-gray-500">{item.id}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.contextType}</div>
                      <div className="text-xs text-gray-500">
                        {item.workflow || '-'} / {item.stage || '-'}
                      </div>
                      <div className="text-xs text-gray-400">{item.rule || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.ownerType}</div>
                      <div className="text-xs text-gray-500">{item.ownerId}</div>
                      {item.ownerType === 'CUSTOMER' && item.customer && (
                        <div className="text-xs text-gray-400">
                          {item.customer.customerNo || item.customer.email || '-'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.subjectType}</div>
                      <div className="text-xs text-gray-500">{item.subjectId}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.policyVersion}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.outputDecision || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[260px]">
                      <div className="truncate" title={(item.reasonCodes || []).join(', ')}>
                        {(item.reasonCodes || []).join(', ') || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void openDetail(item.id)}
                        className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                      >
                        View Detail
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => {
            void fetchRecords(page, filters);
          }}
        />
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl border border-admin-border max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-admin-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Decision Record Detail</h3>
                <p className="text-xs text-gray-500">{detail.id}</p>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading detail...</div>
            ) : (
              <div className="p-4 space-y-4 text-sm">
                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Summary
                  </div>
                  <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500">Status</div>
                      <div className="text-gray-900 font-medium">{detail.status}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Output Decision</div>
                      <div className="text-gray-900 font-medium">{detail.outputDecision || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Context Type</div>
                      <div className="text-gray-900 font-medium">{detail.contextType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Policy Version</div>
                      <div className="text-gray-900 font-medium">{detail.policyVersion}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Owner Type</div>
                      <div className="text-gray-900 font-medium">{detail.ownerType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Owner ID</div>
                      <div className="text-gray-900 font-medium">{detail.ownerId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Subject Type</div>
                      <div className="text-gray-900 font-medium">{detail.subjectType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Subject ID</div>
                      <div className="text-gray-900 font-medium">{detail.subjectId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Customer ID</div>
                      <div className="text-gray-900 font-medium">{detail.customerId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Customer Summary</div>
                      <div className="text-gray-900 font-medium">
                        {detail.customer?.customerNo || detail.customer?.email || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Workflow</div>
                      <div className="text-gray-900 font-medium">{detail.workflow || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Stage</div>
                      <div className="text-gray-900 font-medium">{detail.stage || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Rule</div>
                      <div className="text-gray-900 font-medium">{detail.rule || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Created At</div>
                      <div className="text-gray-900 font-medium">{formatDateTime(detail.createdAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Completed At</div>
                      <div className="text-gray-900 font-medium">{formatDateTime(detail.completedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Input Hash</div>
                      <div className="text-gray-900 font-medium break-all">{detail.inputHash}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Error Message</div>
                      <div className="text-gray-900 font-medium break-all">{detail.errorMessage || '-'}</div>
                    </div>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Reason Codes
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(detail.reasonCodes || [])}
                    </pre>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Recommended Actions
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(detail.recommendedActions || [])}
                    </pre>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Orchestration
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(detail.orchestration || detail.outputs?.orchestration || {})}
                    </pre>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Workflow Transition
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(
                        detail.workflowTransition || detail.outputs?.workflowTransition || {},
                      )}
                    </pre>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Input Payload
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(detail.inputPayload || {})}
                    </pre>
                  </div>
                </section>

                <section className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                    Outputs
                  </div>
                  <div className="p-3">
                    <pre className="text-xs bg-gray-950 text-gray-100 rounded-lg p-3 overflow-auto">
                      {toPrettyJson(detail.outputs || {})}
                    </pre>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskPolicyExecutionsPage;

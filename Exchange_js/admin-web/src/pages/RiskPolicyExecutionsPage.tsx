import { useEffect, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type DecisionRecordStatus = 'CREATED' | 'COMPLETED' | 'FAILED';
type ManualRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

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
  outputs?: Record<string, unknown>;
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

interface FetchRecordsOptions {
  silent?: boolean;
  preserveMessage?: boolean;
  preserveError?: boolean;
}

interface LoadDecisionDetailOptions {
  silent?: boolean;
  preserveError?: boolean;
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

const getUpdatedSubjectSnapshot = (
  workflowTransition?: Record<string, unknown> | null,
): { sourceType: string; subjectNo: string; subjectId: string } => {
  const updatedSubject =
    workflowTransition &&
    workflowTransition.updatedSubject &&
    typeof workflowTransition.updatedSubject === 'object' &&
    !Array.isArray(workflowTransition.updatedSubject)
      ? (workflowTransition.updatedSubject as Record<string, unknown>)
      : {};

  return {
    sourceType: String(updatedSubject.sourceType || '-'),
    subjectNo: String(updatedSubject.subjectNo || '-'),
    subjectId: String(updatedSubject.id || '-'),
  };
};

const getDecisionContextMeta = (contextType?: string | null) => {
  const normalized = String(contextType || '').trim().toUpperCase();

  if (normalized === 'ONBOARDING_CDD') {
    return {
      title: 'Onboarding CDD Decision',
      badgeLabel: 'MANUAL',
      badgeClass: 'bg-blue-100 text-blue-800',
      helperText:
        'CDD now creates a pending risk execution record first. Complete the final simulated outcome here from the decision detail.',
    };
  }

  if (normalized === 'TX_DEPOSIT_FINAL') {
    return {
      title: 'Deposit Final Decision',
      badgeLabel: 'MANUAL',
      badgeClass: 'bg-emerald-100 text-emerald-800',
      helperText:
        'Deposit now creates one pending final risk execution record. Complete the final simulated outcome here after the payin/deposit chain is ready.',
    };
  }

  if (normalized === 'TX_SWAP_FINAL') {
    return {
      title: 'Swap Final Decision',
      badgeLabel: 'MANUAL',
      badgeClass: 'bg-violet-100 text-violet-800',
      helperText:
        'Swap creation now stops at pending compliance until you simulate the final risk outcome here.',
    };
  }

  if (normalized === 'TX_DEPOSIT_KYT_MAIN') {
    return {
      title: 'Deposit KYT Stage Decision',
      badgeLabel: 'LEGACY',
      badgeClass: 'bg-amber-100 text-amber-800',
      helperText:
        'Legacy stage-level record kept for history. New deposit flow should no longer create this as the primary decision.',
    };
  }

  if (normalized === 'TX_DEPOSIT_TRAVEL_RULE') {
    return {
      title: 'Deposit Travel Rule Stage Decision',
      badgeLabel: 'LEGACY',
      badgeClass: 'bg-amber-100 text-amber-800',
      helperText:
        'Legacy stage-level record kept for history. New deposit flow should no longer create this as the primary decision.',
    };
  }

  if (normalized === 'TX_WITHDRAW_PRECHECK') {
    return {
      title: 'Withdraw Pre-KYT Stage Decision',
      badgeLabel: 'LEGACY / READ-ONLY',
      badgeClass: 'bg-amber-100 text-amber-800',
      helperText:
        'Historical precheck record kept for evidence only. New withdraw flow no longer allows simulation or workflow actions on this context.',
    };
  }

  if (normalized === 'TX_WITHDRAW_FINAL') {
    return {
      title: 'Withdraw Final Decision',
      badgeLabel: 'MANUAL',
      badgeClass: 'bg-rose-100 text-rose-800',
      helperText:
        'Withdraw now creates one pending final risk execution record. Complete the final simulated outcome here before the payout path continues.',
    };
  }

  return {
    title: normalized || '-',
    badgeLabel: '',
    badgeClass: '',
    helperText: '',
  };
};

const mergeDecisionRecordIntoList = (
  items: DecisionRecordItem[],
  detail: DecisionRecordDetail,
): DecisionRecordItem[] =>
  items.map((item) =>
    item.id === detail.id
      ? {
          ...item,
          status: detail.status,
          outputDecision: detail.outputDecision,
          reasonCodes: detail.reasonCodes,
          recommendedActions: detail.recommendedActions,
          outputs: detail.outputs,
          workflow: detail.workflow,
          stage: detail.stage,
          rule: detail.rule,
          orchestration: detail.orchestration,
          workflowTransition: detail.workflowTransition,
          errorMessage: detail.errorMessage,
          completedAt: detail.completedAt,
          customer: detail.customer
            ? {
                id: detail.customer.id,
                customerNo: detail.customer.customerNo || null,
                email: detail.customer.email || null,
              }
            : item.customer,
        }
      : item,
  );

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
  const [simulateLoading, setSimulateLoading] = useState<ManualRiskLevel | null>(null);

  const canSimulate = (record?: DecisionRecordDetail | null) => {
    if (!record) return false;
    if (String(record.status || '').trim().toUpperCase() !== 'CREATED') return false;
    const contextType = String(record.contextType || '').trim().toUpperCase();
    return ['ONBOARDING_CDD', 'TX_DEPOSIT_FINAL', 'TX_WITHDRAW_FINAL', 'TX_SWAP_FINAL'].includes(contextType);
  };

  const fetchRecords = async (
    targetPage: number,
    activeFilters: FilterState = filters,
    options: FetchRecordsOptions = {},
  ) => {
    if (!options.silent) {
      setLoading(true);
    }
    if (!options.preserveError) {
      setError('');
    }
    if (!options.preserveMessage) {
      setMessage('');
    }
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
      if (!options.silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchRecords(1, DEFAULT_FILTERS);
  }, []);

  const loadDecisionDetail = async (
    id: string,
    options: LoadDecisionDetailOptions = {},
  ): Promise<DecisionRecordDetail> => {
    if (!options.silent) {
      setDetailLoading(true);
    }
    if (!options.preserveError) {
      setError('');
    }
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/admin/risk/decision-records/${id}`,
    );
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load decision record detail.'));
    }
    const data = (await response.json()) as DecisionRecordDetail;
    setDetail(data);
    setItems((prev) => mergeDecisionRecordIntoList(prev, data));
    return data;
  };

  const handleSearch = async () => {
    await fetchRecords(1, filters);
  };

  const handleReset = async () => {
    setFilters(DEFAULT_FILTERS);
    setDetail(null);
    await fetchRecords(1, DEFAULT_FILTERS);
  };

  const openDetail = async (id: string) => {
    try {
      await loadDecisionDetail(id);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load decision record detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const simulateDecision = async (riskLevel: ManualRiskLevel) => {
    if (!detail) return;
    setSimulateLoading(riskLevel);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/risk/decision-records/${detail.id}/simulate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ riskLevel }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to simulate risk decision.'));
      }

      const data = (await response.json()) as DecisionRecordDetail;
      setDetail(data);
      setItems((prev) => mergeDecisionRecordIntoList(prev, data));
      setMessage(`Manual ${riskLevel} simulation applied.`);
      try {
        await loadDecisionDetail(data.id, { silent: true, preserveError: true });
      } catch (refreshError: unknown) {
        if (refreshError instanceof AdminSessionError) return;
      }
      void fetchRecords(currentPage, filters, {
        silent: true,
        preserveMessage: true,
        preserveError: true,
      });
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to simulate risk decision.');
    } finally {
      setSimulateLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Risk Management - Risk Policy Executions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review pending risk decision records and manually complete the final simulation outcome when required.
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

      <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-sm text-blue-800">
        Supported manual simulation contexts are <span className="font-semibold">ONBOARDING_CDD</span>,{' '}
        <span className="font-semibold">TX_DEPOSIT_FINAL</span>, and <span className="font-semibold">TX_SWAP_FINAL</span>.
        Historical <span className="font-semibold">TX_DEPOSIT_KYT_MAIN</span> and{' '}
        <span className="font-semibold">TX_DEPOSIT_TRAVEL_RULE</span> rows may still appear here as legacy
        stage records, but they are not the new operator simulation surface.
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
            placeholder="Output Decision (CLEAR/REJECT/REQUIRE_EDD/REVIEW)"
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
                items.map((item) => {
                  const contextMeta = getDecisionContextMeta(item.contextType);
                  const riskBand = String(item.outputs?.riskBand || '').trim();
                  const riskReason = String(item.outputs?.riskReason || '').trim();

                  return (
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
                        <div className="font-medium text-gray-900">{contextMeta.title}</div>
                        <div className="text-xs text-gray-500">{item.contextType}</div>
                        <div className="text-xs text-gray-500">
                          {item.workflow || '-'} / {item.stage || '-'}
                        </div>
                        <div className="text-xs text-gray-400">{item.rule || '-'}</div>
                        {contextMeta.badgeLabel && (
                          <div className="mt-1">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${contextMeta.badgeClass}`}
                            >
                              {contextMeta.badgeLabel}
                            </span>
                          </div>
                        )}
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
                        {riskBand || riskReason ? (
                          <div className="mt-1 text-xs text-gray-500">
                            {riskBand || 'UNKNOWN'}
                            {riskReason ? ` / ${riskReason}` : ''}
                          </div>
                        ) : null}
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
                {(() => {
                  const orchestrationSnapshot =
                    detail.orchestration || detail.outputs?.orchestration || {};
                  const workflowTransitionSnapshot =
                    detail.workflowTransition || detail.outputs?.workflowTransition || {};
                  const alertRef = String(
                    (orchestrationSnapshot as Record<string, unknown>).alertNo ||
                      (orchestrationSnapshot as Record<string, unknown>).alertId ||
                      '-',
                  );
                  const caseRef = String(
                    (orchestrationSnapshot as Record<string, unknown>).caseNo ||
                      (orchestrationSnapshot as Record<string, unknown>).caseId ||
                      '-',
                  );
                  const transitionCode = String(
                    (workflowTransitionSnapshot as Record<string, unknown>).transitionCode || '-',
                  );
                  const updatedSubject = getUpdatedSubjectSnapshot(
                    workflowTransitionSnapshot as Record<string, unknown>,
                  );
                  return (
                    <>
                {(() => {
                  const contextMeta = getDecisionContextMeta(detail.contextType);
                  return (
                    <section className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                        Context Interpretation
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{contextMeta.title}</span>
                          {contextMeta.badgeLabel && (
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${contextMeta.badgeClass}`}
                            >
                              {contextMeta.badgeLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{detail.contextType}</div>
                        <div className="text-sm text-gray-700">
                          {contextMeta.helperText || 'No additional interpretation available.'}
                        </div>
                      </div>
                    </section>
                  );
                })()}

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
                    <div>
                      <div className="text-xs text-gray-500">Risk Band</div>
                      <div className="text-gray-900 font-medium">
                        {String(detail.outputs?.riskBand || '-')}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Risk Reason</div>
                      <div className="text-gray-900 font-medium">
                        {String(detail.outputs?.riskReason || '-')}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Simulation Mode</div>
                      <div className="text-gray-900 font-medium">
                        {String(detail.outputs?.simulationMode || '-')}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Updated Subject Type</div>
                      <div className="text-gray-900 font-medium">{updatedSubject.sourceType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Updated Subject No</div>
                      <div className="text-gray-900 font-medium break-all">{updatedSubject.subjectNo}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Updated Subject ID</div>
                      <div className="text-gray-900 font-medium break-all">{updatedSubject.subjectId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Alert</div>
                      <div className="text-gray-900 font-medium break-all">{alertRef}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Case</div>
                      <div className="text-gray-900 font-medium break-all">{caseRef}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Transition Code</div>
                      <div className="text-gray-900 font-medium break-all">{transitionCode}</div>
                    </div>
                  </div>
                </section>

                {canSimulate(detail) ? (
                  <section className="border border-indigo-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-200 text-xs font-semibold text-indigo-700 uppercase">
                      Manual Simulation
                    </div>
                    <div className="p-3 space-y-3">
                      <p className="text-sm text-gray-700">
                        Choose the final manual risk result for this pending execution record. Low will auto-clear
                        the workflow. Medium creates one workflow-bound alert. High creates one alert and auto-escalates to a case.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(['LOW', 'MEDIUM', 'HIGH'] as ManualRiskLevel[]).map((riskLevel) => (
                          <button
                            key={riskLevel}
                            onClick={() => void simulateDecision(riskLevel)}
                            disabled={simulateLoading !== null}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                              riskLevel === 'LOW'
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : riskLevel === 'MEDIUM'
                                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                                  : 'bg-rose-600 text-white hover:bg-rose-700'
                            } disabled:opacity-60`}
                          >
                            {simulateLoading === riskLevel ? `Simulating ${riskLevel}...` : `Simulate ${riskLevel}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : null}

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
                    </>
                  );
                })()}
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

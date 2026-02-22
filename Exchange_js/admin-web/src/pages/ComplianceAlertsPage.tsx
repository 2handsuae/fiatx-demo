import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';

type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AlertStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'ESCALATED'
  | 'CLOSED';
type AlertAction =
  | 'ASSIGN'
  | 'ESCALATE'
  | 'CLOSE';
type WorkflowAction = 'ASSIGN' | 'REASSIGN' | 'ESCALATE' | 'CLOSE';
type RecommendedDecision = 'APPROVE' | 'REJECT' | 'REQUIRE_EDD';

interface AlertItem {
  id: string;
  alertNo: string;
  ruleCode: string;
  capCode?: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  customerNo?: string | null;
  assigneeUserId?: string | null;
  assigneeUserNo?: string | null;
  decisionRecommendation?: string | null;
  decision?: string | null;
  recommendedDecisions?: string[];
  hitCount: number;
  dueAt: string;
  lastOccurredAt: string;
}

interface AlertEvent {
  id: string;
  eventType: string;
  eventAt: string;
  actorType: string;
  actorNo?: string | null;
  actorRole?: string | null;
  note?: string | null;
  payload?: unknown;
}

interface AlertDetail extends AlertItem {
  sourceModule: string;
  entityType?: string | null;
  entityNo?: string | null;
  ownerNo?: string | null;
  assigneeUserId?: string | null;
  closeReason?: string | null;
  closedAt?: string | null;
  metadata?: unknown;
  recommendedDecisions?: string[];
  events: AlertEvent[];
}

interface AlertListResponse {
  total: number;
  skip: number;
  take: number;
  items: AlertItem[];
}

interface SimulateAlertsResponse {
  createdCount: number;
  items: AlertItem[];
}

interface IncidentFromAlertResponse {
  id: string;
  incidentNo: string;
}

interface OnboardingAlertDecisionResponse {
  alert: AlertDetail;
  customer: {
    id: string;
    publicStatus: string;
    activeCaseId?: string | null;
    requiresEdd?: boolean;
  };
  eddCase?: {
    id: string;
    caseNo?: string | null;
  } | null;
}

interface UserListItem {
  id: string;
  userNo: string;
  email: string;
  status: string;
}

interface FilterState {
  status: '' | AlertStatus;
  severity: '' | AlertSeverity;
  ruleCode: string;
  sourceType: string;
  sourceId: string;
  customerNo: string;
  assigneeUserId: string;
  keyword: string;
  overdueOnly: boolean;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  status: '',
  severity: '',
  ruleCode: '',
  sourceType: '',
  sourceId: '',
  customerNo: '',
  assigneeUserId: '',
  keyword: '',
  overdueOnly: false,
};

const CLOSED_STATUSES: AlertStatus[] = ['CLOSED'];

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

const getSeverityClass = (severity: AlertSeverity) => {
  if (severity === 'CRITICAL') return 'bg-red-100 text-red-800';
  if (severity === 'HIGH') return 'bg-orange-100 text-orange-800';
  if (severity === 'MEDIUM') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-700';
};

const getStatusClass = (status: AlertStatus) => {
  if (status === 'OPEN') return 'bg-blue-100 text-blue-800';
  if (status === 'ASSIGNED') return 'bg-indigo-100 text-indigo-800';
  if (status === 'ESCALATED') return 'bg-red-100 text-red-800';
  if (status === 'CLOSED') return 'bg-green-100 text-green-800';
  return 'bg-gray-100 text-gray-700';
};

const isOverdue = (item: AlertItem) =>
  !CLOSED_STATUSES.includes(item.status) &&
  new Date(item.dueAt).getTime() < Date.now();

const getWorkflowActions = (
  detail: AlertDetail,
  currentUserId?: string | null,
): WorkflowAction[] => {
  const isCurrentAssignee =
    !!currentUserId &&
    !!detail.assigneeUserId &&
    detail.assigneeUserId === currentUserId;

  if (detail.status === 'OPEN') return ['ASSIGN'];
  if (detail.status === 'ASSIGNED' && isCurrentAssignee) {
    return ['REASSIGN', 'ESCALATE', 'CLOSE'];
  }
  if (detail.status === 'ESCALATED' && isCurrentAssignee) return ['CLOSE'];
  return [];
};

const actionLabelMap: Record<WorkflowAction, string> = {
  ASSIGN: 'Assign',
  REASSIGN: 'Reassign',
  ESCALATE: 'Escalate to Incident',
  CLOSE: 'Close',
};

const normalizeRecommendedDecisions = (
  values?: string[],
): RecommendedDecision[] => {
  const allowed = new Set<RecommendedDecision>(['APPROVE', 'REJECT', 'REQUIRE_EDD']);
  const normalized = Array.isArray(values)
    ? values
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item): item is RecommendedDecision =>
          allowed.has(item as RecommendedDecision),
        )
    : [];
  return Array.from(new Set(normalized));
};

const recommendedDecisionLabelMap: Record<RecommendedDecision, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  REQUIRE_EDD: 'Require EDD',
};

const ComplianceAlertsPage = () => {
  const { session } = useAdminSession();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState<AlertAction | null>(null);
  const [recommendationActing, setRecommendationActing] =
    useState<RecommendedDecision | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCandidates, setAssignCandidates] = useState<UserListItem[]>([]);
  const [assignCandidatesLoading, setAssignCandidatesLoading] = useState(false);
  const [assignCandidatesError, setAssignCandidatesError] = useState('');
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState('');

  const hasFilters = useMemo(() => {
    return (
      !!filters.status ||
      !!filters.severity ||
      !!filters.ruleCode.trim() ||
      !!filters.sourceType.trim() ||
      !!filters.sourceId.trim() ||
      !!filters.customerNo.trim() ||
      !!filters.assigneeUserId.trim() ||
      !!filters.keyword.trim() ||
      filters.overdueOnly
    );
  }, [filters]);

  const fetchAlerts = async (
    targetPage: number,
    activeFilters: FilterState = filters,
  ) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((targetPage - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      if (activeFilters.status) params.set('status', activeFilters.status);
      if (activeFilters.severity) params.set('severity', activeFilters.severity);
      if (activeFilters.ruleCode.trim()) params.set('ruleCode', activeFilters.ruleCode.trim());
      if (activeFilters.sourceType.trim()) params.set('sourceType', activeFilters.sourceType.trim());
      if (activeFilters.sourceId.trim()) params.set('sourceId', activeFilters.sourceId.trim());
      if (activeFilters.customerNo.trim()) params.set('customerNo', activeFilters.customerNo.trim());
      if (activeFilters.assigneeUserId.trim()) params.set('assigneeUserId', activeFilters.assigneeUserId.trim());
      if (activeFilters.keyword.trim()) params.set('keyword', activeFilters.keyword.trim());
      if (activeFilters.overdueOnly) params.set('overdueOnly', 'true');

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load alerts.'));
      }

      const data = (await response.json()) as AlertListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(targetPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts(1);
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    setAssignModalOpen(false);
    setAssignCandidates([]);
    setAssignCandidatesError('');
    setSelectedAssigneeUserId('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load alert detail.'));
      }
      const data = (await response.json()) as AlertDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load alert detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchAssignCandidates = async (): Promise<UserListItem[]> => {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/users?take=200`,
    );

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load assignees.'));
    }

    const payload = (await response.json()) as UserListItem[];
    const users = Array.isArray(payload) ? payload : [];
    return users
      .filter((item) => item.status === 'ACTIVE')
      .sort((a, b) => {
        const aNo = (a.userNo || '').toUpperCase();
        const bNo = (b.userNo || '').toUpperCase();
        return aNo.localeCompare(bNo);
      });
  };

  const openAssignModal = async () => {
    if (!detail) return;
    setAssignModalOpen(true);
    setAssignCandidatesLoading(true);
    setAssignCandidatesError('');

    try {
      const candidates = await fetchAssignCandidates();
      setAssignCandidates(candidates);
      const defaultAssignee =
        detail.assigneeUserId ||
        session?.id ||
        (candidates.length > 0 ? candidates[0].id : '');
      setSelectedAssigneeUserId(defaultAssignee || '');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setAssignCandidatesError(
        e instanceof Error ? e.message : 'Failed to load assignees.',
      );
      setSelectedAssigneeUserId('');
    } finally {
      setAssignCandidatesLoading(false);
    }
  };

  const submitAssign = async () => {
    if (!detail) return;
    if (!selectedAssigneeUserId) {
      setAssignCandidatesError('Please select an assignee.');
      return;
    }

    setActing('ASSIGN');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'ASSIGN',
            assigneeUserId: selectedAssigneeUserId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Assign failed.'));
      }

      const updated = (await response.json()) as AlertDetail;
      setDetail(updated);
      setAssignModalOpen(false);
      setMessage('Assignee updated.');
      await fetchAlerts(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Assign failed.');
    } finally {
      setActing(null);
    }
  };

  const handleRecommendedDecision = async (decision: RecommendedDecision) => {
    if (!detail) return;
    if (!detail.assigneeUserId) {
      setError('Current alert has no assignee.');
      return;
    }

    const reasonInput =
      decision === 'REJECT'
        ? window.prompt('Reason (optional)', '') || ''
        : '';

    setRecommendationActing(decision);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/onboarding-decision`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision,
            reason: reasonInput.trim() || undefined,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            'Failed to apply onboarding decision.',
          ),
        );
      }

      const data = (await response.json()) as OnboardingAlertDecisionResponse;
      setDetail(data.alert);
      if (decision === 'REQUIRE_EDD' && data.eddCase?.caseNo) {
        setMessage(
          `Decision applied. Onboarding moved to ${data.customer.publicStatus}. EDD case ${data.eddCase.caseNo} created.`,
        );
      } else {
        setMessage(
          `Decision applied. Onboarding moved to ${data.customer.publicStatus}.`,
        );
      }
      await fetchAlerts(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to apply onboarding decision.');
    } finally {
      setRecommendationActing(null);
    }
  };

  const handleAction = async (action: AlertAction) => {
    if (!detail) return;
    setActing(action);
    setError('');
    setMessage('');
    try {
      let reason: string | undefined;
      if (action === 'ESCALATE' || action === 'CLOSE') {
        reason = window.prompt('Please provide reason', '') || '';
        if (!reason.trim()) {
          throw new Error(`Action ${action} requires a reason.`);
        }
      }

      if (action === 'ESCALATE') {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/incidents/from-alert/${detail.id}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason }),
          },
        );

        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Escalation failed.'));
        }

        const data = (await response.json()) as IncidentFromAlertResponse;
        setMessage(
          data.incidentNo
            ? `Escalated to incident ${data.incidentNo}.`
            : 'Escalated and incident created.',
        );
        await fetchAlerts(currentPage);
        await openDetail(detail.id);
        return;
      }

      const payload: Record<string, unknown> = {
        action,
      };
      if (reason) payload.reason = reason;

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Action failed.'));
      }

      const updated = (await response.json()) as AlertDetail;
      setDetail(updated);
      setMessage(`Action ${action} completed.`);
      await fetchAlerts(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setActing(null);
    }
  };

  const resetFilters = async () => {
    setFilters(DEFAULT_FILTERS);
    await fetchAlerts(1, DEFAULT_FILTERS);
  };

  const handleSimulate = async () => {
    setSimulating(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/simulate`,
        {
          method: 'POST',
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to simulate alerts.'),
        );
      }

      const data = (await response.json()) as SimulateAlertsResponse;
      const createdCount =
        typeof data.createdCount === 'number' ? data.createdCount : 10;
      setMessage(`Generated ${createdCount} random alerts.`);
      await fetchAlerts(1);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to simulate alerts.');
    } finally {
      setSimulating(false);
    }
  };

  const currentAdminId = session?.id || null;
  const isCurrentAssignee =
    !!detail &&
    !!currentAdminId &&
    !!detail.assigneeUserId &&
    detail.assigneeUserId === currentAdminId;
  const workflowActions = detail ? getWorkflowActions(detail, currentAdminId) : [];
  const recommendedDecisions = normalizeRecommendedDecisions(
    detail?.recommendedDecisions,
  );
  const showRecommendationActions =
    !!detail &&
    detail.status === 'ASSIGNED' &&
    isCurrentAssignee &&
    detail.sourceType === 'ONBOARDING_JOURNEY';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and close compliance alerts.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSimulate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
            disabled={simulating || loading}
          >
            {simulating ? 'Simulating...' : 'Simulate 10 Alerts'}
          </button>
          <button
            onClick={() => fetchAlerts(currentPage)}
            className="p-2 text-gray-500 hover:text-brand-primary disabled:opacity-60"
            title="Refresh"
            disabled={loading || simulating}
          >
            <RefreshCw
              size={20}
              className={loading || simulating ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>

      {message && (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Rule code"
            value={filters.ruleCode}
            onChange={(e) => setFilters((prev) => ({ ...prev, ruleCode: e.target.value }))}
          />
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, status: e.target.value as FilterState['status'] }))
            }
          >
            <option value="">All status</option>
            <option value="OPEN">OPEN</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="ESCALATED">ESCALATED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.severity}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, severity: e.target.value as FilterState['severity'] }))
            }
          >
            <option value="">All severity</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Source type"
            value={filters.sourceType}
            onChange={(e) => setFilters((prev) => ({ ...prev, sourceType: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Source id"
            value={filters.sourceId}
            onChange={(e) => setFilters((prev) => ({ ...prev, sourceId: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Customer no"
            value={filters.customerNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, customerNo: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Assignee user id"
            value={filters.assigneeUserId}
            onChange={(e) => setFilters((prev) => ({ ...prev, assigneeUserId: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm md:col-span-2"
            placeholder="Keyword"
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, overdueOnly: e.target.checked }))}
            />
            Overdue only
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAlerts(1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-brand-primary text-white text-sm hover:opacity-90"
            disabled={loading || simulating}
          >
            <Search size={14} />
            Search
          </button>
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-admin-border text-sm hover:bg-gray-50"
            disabled={loading || simulating || !hasFilters}
          >
            <X size={14} />
            Reset
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Alert</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Rule</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Severity</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Source</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Hit</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Due</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Assignee</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No alerts found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{item.alertNo}</div>
                      <div className="text-xs text-gray-500">{item.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{item.ruleCode}</div>
                      <div className="text-xs text-gray-500">{item.capCode || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getSeverityClass(item.severity)}`}>
                        {item.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.sourceType}</div>
                      <div className="text-xs text-gray-500">{item.sourceNo || item.sourceId}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.hitCount}</td>
                    <td className="px-4 py-3">
                      <div className={isOverdue(item) ? 'text-red-700 font-medium' : 'text-gray-700'}>
                        {formatDateTime(item.dueAt)}
                      </div>
                      <div className="text-xs text-gray-500">Last {formatDateTime(item.lastOccurredAt)}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.assigneeUserNo || '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                        onClick={() => openDetail(item.id)}
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
          onPageChange={(page) => fetchAlerts(page)}
        />
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl border border-admin-border max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-admin-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  Alert Detail - {detail.alertNo}
                </h3>
                <p className="text-xs text-gray-500">{detail.id}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-2 text-gray-500 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading detail...</div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <InfoCard
                    title="Summary"
                    rows={[
                      ['Rule', detail.ruleCode],
                      ['Severity', detail.severity],
                      ['Status', detail.status],
                      ['Recommendation', detail.decisionRecommendation || '-'],
                      ['Decision', detail.decision || '-'],
                      ['CAP', detail.capCode || '-'],
                      ['Message', detail.message],
                    ]}
                  />
                  <InfoCard
                    title="Source"
                    rows={[
                      ['Module', detail.sourceModule],
                      ['Source Type', detail.sourceType],
                      ['Source', detail.sourceNo || detail.sourceId],
                      ['Entity', detail.entityNo || detail.entityType || '-'],
                      ['Customer', detail.customerNo || '-'],
                    ]}
                  />
                  <InfoCard
                    title="Lifecycle"
                    rows={[
                      ['Due', formatDateTime(detail.dueAt)],
                      ['Last Seen', formatDateTime(detail.lastOccurredAt)],
                      ['Hit Count', String(detail.hitCount)],
                      ['Assignee', detail.assigneeUserNo || '-'],
                      ['Closed At', formatDateTime(detail.closedAt)],
                    ]}
                  />
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Workflow Actions</h4>
                  {workflowActions.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No workflow actions available for current user in this status.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {workflowActions.map((action) => (
                        <button
                          key={action}
                          onClick={() => {
                            if (action === 'ASSIGN' || action === 'REASSIGN') {
                              void openAssignModal();
                              return;
                            }
                            void handleAction(action as AlertAction);
                          }}
                          disabled={
                            acting !== null ||
                            recommendationActing !== null ||
                            assignCandidatesLoading
                          }
                          className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                          {acting === action
                            ? 'Processing...'
                            : actionLabelMap[action]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Risk Engine Recommended Actions</h4>
                  {!showRecommendationActions ? (
                    <div className="text-sm text-gray-500">
                      Recommended actions are available only when this onboarding alert is ASSIGNED to you.
                    </div>
                  ) : recommendedDecisions.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No recommended onboarding decision for this alert.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {recommendedDecisions.map((decision) => (
                          <button
                            key={decision}
                            onClick={() => {
                              void handleRecommendedDecision(decision);
                            }}
                            disabled={
                              acting !== null ||
                              recommendationActing !== null
                            }
                            className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                          >
                            {recommendationActing === decision
                              ? 'Processing...'
                              : recommendedDecisionLabelMap[decision]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Metadata</h4>
                  <pre className="text-xs bg-gray-50 border border-admin-border rounded p-3 overflow-auto max-h-56">
                    {toPrettyJson(detail.metadata)}
                  </pre>
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Event Timeline</h4>
                  {detail.events.length === 0 ? (
                    <div className="text-sm text-gray-500">No events</div>
                  ) : (
                    <div className="space-y-3">
                      {detail.events.map((event) => (
                        <div key={event.id} className="border border-admin-border rounded p-3">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{event.eventType}</span>
                            <span>{formatDateTime(event.eventAt)}</span>
                          </div>
                          <div className="text-sm text-gray-800 mt-1">
                            Actor: {event.actorNo || event.actorType} {event.actorRole ? `(${event.actorRole})` : ''}
                          </div>
                          {event.note && (
                            <div className="text-sm text-gray-700 mt-1">{event.note}</div>
                          )}
                          <pre className="text-xs bg-gray-50 border border-admin-border rounded p-2 mt-2 overflow-auto max-h-40">
                            {toPrettyJson(event.payload)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {assignModalOpen && detail && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-admin-border">
            <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {detail.status === 'ASSIGNED' ? 'Reassign Alert' : 'Assign Alert'}
                </h4>
                <p className="text-xs text-gray-500">{detail.alertNo}</p>
              </div>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700"
                disabled={acting === 'ASSIGN'}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {assignCandidatesLoading ? (
                <div className="text-sm text-gray-500">Loading assignees...</div>
              ) : (
                <>
                  <label className="block text-sm text-gray-700">
                    Assignee
                  </label>
                  <select
                    className="w-full border border-admin-border rounded px-3 py-2 text-sm"
                    value={selectedAssigneeUserId}
                    onChange={(e) => setSelectedAssigneeUserId(e.target.value)}
                    disabled={acting === 'ASSIGN'}
                  >
                    <option value="">Select assignee</option>
                    {assignCandidates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.userNo} - {item.email}
                      </option>
                    ))}
                  </select>
                  {assignCandidates.length === 0 && (
                    <div className="text-sm text-gray-500">
                      No active assignees available.
                    </div>
                  )}
                </>
              )}

              {assignCandidatesError && (
                <div className="text-sm text-red-700">{assignCandidatesError}</div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={() => setAssignModalOpen(false)}
                className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50"
                disabled={acting === 'ASSIGN'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitAssign();
                }}
                className="px-3 py-1.5 rounded bg-brand-primary text-white text-sm hover:opacity-90 disabled:opacity-60"
                disabled={
                  acting === 'ASSIGN' ||
                  assignCandidatesLoading ||
                  !selectedAssigneeUserId
                }
              >
                {acting === 'ASSIGN' ? 'Processing...' : 'Confirm Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoCard = ({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) => (
  <div className="border border-admin-border rounded-lg p-4">
    <h4 className="font-semibold text-gray-900 mb-3">{title}</h4>
    <div className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-gray-500">{label}</span>
          <span className="text-gray-900 text-right break-all">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

export default ComplianceAlertsPage;

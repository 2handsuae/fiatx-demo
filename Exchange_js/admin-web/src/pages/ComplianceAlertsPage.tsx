import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AlertStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'ESCALATED'
  | 'CLOSED';
type AlertAction =
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'ESCALATE'
  | 'CLOSE';

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
  assigneeUserNo?: string | null;
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
  closeReason?: string | null;
  closedAt?: string | null;
  metadata?: unknown;
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

const getAllowedActions = (status: AlertStatus): AlertAction[] => {
  if (status === 'OPEN') return ['ASSIGN', 'ESCALATE', 'CLOSE'];
  if (status === 'ASSIGNED') return ['ASSIGN', 'UNASSIGN', 'ESCALATE', 'CLOSE'];
  if (status === 'ESCALATED') return ['CLOSE'];
  return [];
};

const actionLabelMap: Record<AlertAction, string> = {
  ASSIGN: 'Assign to Me',
  UNASSIGN: 'Unassign',
  ESCALATE: 'Escalate to Incident',
  CLOSE: 'Close',
};

const ComplianceAlertsPage = () => {
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
  const [simulating, setSimulating] = useState(false);

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
                  <h4 className="font-semibold text-gray-900 mb-3">Actions</h4>
                  {getAllowedActions(detail.status).length === 0 ? (
                    <div className="text-sm text-gray-500">No actions available in terminal state.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {getAllowedActions(detail.status).map((action) => (
                        <button
                          key={action}
                          onClick={() => handleAction(action)}
                          disabled={acting !== null}
                          className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                          {acting === action ? 'Processing...' : actionLabelMap[action]}
                        </button>
                      ))}
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

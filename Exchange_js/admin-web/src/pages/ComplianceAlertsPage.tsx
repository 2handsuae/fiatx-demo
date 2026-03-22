import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { PERMISSIONS } from '../rbac/permissions';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';

type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AlertStatus = 'OPEN' | 'ASSIGNED' | 'ESCALATED' | 'CLOSED';

interface AlertItem {
  id: string;
  alertNo: string;
  workflow?: string | null;
  stage?: string | null;
  rule?: string | null;
  ruleCode: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  assigneeUserNo?: string | null;
  customerNo?: string | null;
  reasonCodes?: string[];
  hitCount: number;
  dueAt: string;
  overdueMarkedAt?: string | null;
  lastOccurredAt: string;
}

interface AlertListResponse {
  total: number;
  skip: number;
  take: number;
  items: AlertItem[];
}

interface SimulateAlertsResponse {
  createdCount: number;
}

interface FilterState {
  status: '' | AlertStatus;
  severity: '' | AlertSeverity;
  stage: '' | 'REVIEW_CDD' | 'REVIEW_EDD';
  ruleCode: string;
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
  stage: '',
  ruleCode: '',
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

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
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
  if (status === 'ESCALATED') return 'bg-orange-100 text-orange-800';
  return 'bg-gray-200 text-gray-800';
};

const isOverdue = (item: AlertItem) =>
  !CLOSED_STATUSES.includes(item.status) && new Date(item.dueAt).getTime() < Date.now();

const ComplianceAlertsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAdminSession();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [simulating, setSimulating] = useState(false);

  const canWriteAlerts = hasPermission(PERMISSIONS.ALERTS_WRITE);

  const hasFilters = useMemo(
    () =>
      !!filters.status ||
      !!filters.severity ||
      !!filters.stage ||
      !!filters.ruleCode.trim() ||
      !!filters.sourceId.trim() ||
      !!filters.customerNo.trim() ||
      !!filters.assigneeUserId.trim() ||
      !!filters.keyword.trim() ||
      filters.overdueOnly,
    [filters],
  );

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
      if (activeFilters.stage) params.set('stage', activeFilters.stage);
      if (activeFilters.ruleCode.trim()) params.set('ruleCode', activeFilters.ruleCode.trim());
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
    void fetchAlerts(1);
  }, []);

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
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to simulate alerts.'));
      }
      const data = (await response.json()) as SimulateAlertsResponse;
      setMessage(`Generated ${typeof data.createdCount === 'number' ? data.createdCount : 10} random alerts.`);
      await fetchAlerts(1);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to simulate alerts.');
    } finally {
      setSimulating(false);
    }
  };

  const openDetail = (id: string) => {
    navigate(
      `/dashboard/compliance/alerts/${id}?from=${encodeURIComponent(
        `${location.pathname}${location.search}`,
      )}`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Triage onboarding review hits through a canonical workflow / stage / rule model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWriteAlerts ? (
            <button
              onClick={() => void handleSimulate()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
              disabled={simulating || loading}
            >
              {simulating ? 'Simulating...' : 'Simulate 10 Alerts'}
            </button>
          ) : null}
          <button
            onClick={() => void fetchAlerts(currentPage)}
            className="p-2 text-gray-500 hover:text-brand-primary disabled:opacity-60"
            title="Refresh"
            disabled={loading || simulating}
          >
            <RefreshCw size={20} className={loading || simulating ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {message ? (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <div className="px-4 py-3 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-900">
        {canWriteAlerts
          ? 'Alert actions and workflow actions now live inside the detail page. Use the list for triage queue scanning, then open the alert for full evidence and action handling.'
          : 'You currently have read-only triage access. Use the list for queue scanning, then open the alert detail page for full context.'}
      </div>

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
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as FilterState['status'] }))}
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
            onChange={(e) => setFilters((prev) => ({ ...prev, severity: e.target.value as FilterState['severity'] }))}
          >
            <option value="">All severity</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.stage}
            onChange={(e) => setFilters((prev) => ({ ...prev, stage: e.target.value as FilterState['stage'] }))}
          >
            <option value="">All stage</option>
            <option value="REVIEW_CDD">REVIEW_CDD</option>
            <option value="REVIEW_EDD">REVIEW_EDD</option>
          </select>
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
            onClick={() => void fetchAlerts(1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-brand-primary text-white text-sm hover:opacity-90"
            disabled={loading || simulating}
          >
            <Search size={14} />
            Search
          </button>
          <button
            onClick={() => void resetFilters()}
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow / Stage / Rule</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Severity</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Source</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Reason Codes</th>
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
                      <div className="text-gray-900">{item.workflow || 'ONBOARDING'}</div>
                      <div className="text-xs text-gray-500">{item.stage || '-'}</div>
                      <div className="text-xs text-gray-500">{item.rule || item.ruleCode}</div>
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
                    <td className="px-4 py-3 text-gray-700">
                      <div>{normalizeStringList(item.reasonCodes).join(', ') || '-'}</div>
                      <div className="text-xs text-gray-500">Hit count {item.hitCount}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={isOverdue(item) ? 'text-red-700 font-medium' : 'text-gray-700'}>
                        {formatDateTime(item.dueAt)}
                      </div>
                      {item.overdueMarkedAt ? (
                        <div className="text-xs text-red-600">
                          Flagged {formatDateTime(item.overdueMarkedAt)}
                        </div>
                      ) : null}
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
          onPageChange={(page) => void fetchAlerts(page)}
        />
      </div>
    </div>
  );
};

export default ComplianceAlertsPage;

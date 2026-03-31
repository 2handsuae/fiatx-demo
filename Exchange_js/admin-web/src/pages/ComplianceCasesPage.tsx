import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import Pagination from '../components/common/Pagination';
import { PERMISSIONS } from '../rbac/permissions';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';

type CaseSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type CaseStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'INVESTIGATING'
  | 'PENDING_MLRO_REVIEW'
  | 'CLOSED';
type FreezeStatus = 'ACTIVE' | 'FROZEN';
type FilingStatus =
  | 'NOT_REQUIRED'
  | 'REQUIRED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'RETURNED'
  | 'CLOSED';
type CaseType = 'ONBOARDING' | 'PERIODIC_REVIEW' | 'TRANSACTION' | 'GENERIC';

interface CaseItem {
  id: string;
  caseNo?: string;
  workflow?: string | null;
  stage?: string | null;
  rule?: string | null;
  caseType?: CaseType;
  status: CaseStatus;
  severity: CaseSeverity;
  title: string;
  primaryAlertNo?: string | null;
  customerNo?: string | null;
  assigneeUserNo?: string | null;
  freezeStatus?: FreezeStatus;
  frozenAt?: string | null;
  filingStatus?: FilingStatus | string | null;
  overdueMarkedAt?: string | null;
  dueAt: string;
  lastActionAt?: string | null;
}

interface CaseListResponse {
  total: number;
  skip: number;
  take: number;
  items: CaseItem[];
}

interface FilterState {
  caseNo: string;
  status: '' | CaseStatus;
  severity: '' | CaseSeverity;
  customerNo: string;
  assigneeUserId: string;
  alertNo: string;
  keyword: string;
  overdueOnly: boolean;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  caseNo: '',
  status: '',
  severity: '',
  customerNo: '',
  assigneeUserId: '',
  alertNo: '',
  keyword: '',
  overdueOnly: false,
};

const CLOSED_STATUSES: CaseStatus[] = ['CLOSED'];

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getSeverityClass = (severity: CaseSeverity) => {
  if (severity === 'CRITICAL') return 'bg-red-100 text-red-800';
  if (severity === 'HIGH') return 'bg-orange-100 text-orange-800';
  if (severity === 'MEDIUM') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-700';
};

const getStatusClass = (status: CaseStatus) => {
  if (status === 'OPEN') return 'bg-blue-100 text-blue-800';
  if (status === 'ASSIGNED') return 'bg-indigo-100 text-indigo-800';
  if (status === 'INVESTIGATING') return 'bg-sky-100 text-sky-800';
  if (status === 'PENDING_MLRO_REVIEW') return 'bg-fuchsia-100 text-fuchsia-800';
  return 'bg-gray-200 text-gray-800';
};

const getFreezeStatusClass = (status?: FreezeStatus) => {
  if (status === 'FROZEN') return 'bg-red-100 text-red-800';
  return 'bg-emerald-100 text-emerald-800';
};

const getFilingStatusClass = (status?: FilingStatus | string | null) => {
  if (status === 'REQUIRED') return 'bg-amber-100 text-amber-800';
  if (status === 'SUBMITTED') return 'bg-violet-100 text-violet-800';
  if (status === 'ACKNOWLEDGED') return 'bg-emerald-100 text-emerald-800';
  if (status === 'RETURNED') return 'bg-rose-100 text-rose-800';
  if (status === 'CLOSED') return 'bg-slate-200 text-slate-800';
  return 'bg-gray-100 text-gray-700';
};

const normalizeFilingStatus = (value?: string | null): FilingStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === 'REQUIRED' ||
    normalized === 'SUBMITTED' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'RETURNED' ||
    normalized === 'CLOSED'
  ) {
    return normalized as FilingStatus;
  }
  return 'NOT_REQUIRED';
};

const isOverdue = (item: CaseItem) =>
  !CLOSED_STATUSES.includes(item.status) && new Date(item.dueAt).getTime() < Date.now();

const ComplianceCasesPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAdminSession();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<CaseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canReadCaseExports = hasPermission(PERMISSIONS.CASE_EVIDENCE_EXPORTS_READ);
  const canWriteCases = hasPermission(PERMISSIONS.CASES_WRITE);

  const hasFilters = useMemo(
    () =>
      !!filters.caseNo.trim() ||
      !!filters.status ||
      !!filters.severity ||
      !!filters.customerNo.trim() ||
      !!filters.assigneeUserId.trim() ||
      !!filters.alertNo.trim() ||
      !!filters.keyword.trim() ||
      filters.overdueOnly,
    [filters],
  );

  const fetchCases = async (
    targetPage: number,
    activeFilters: FilterState = filters,
  ) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((targetPage - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (activeFilters.caseNo.trim()) params.set('caseNo', activeFilters.caseNo.trim());
      if (activeFilters.status) params.set('status', activeFilters.status);
      if (activeFilters.severity) params.set('severity', activeFilters.severity);
      if (activeFilters.customerNo.trim()) params.set('customerNo', activeFilters.customerNo.trim());
      if (activeFilters.assigneeUserId.trim()) params.set('assigneeUserId', activeFilters.assigneeUserId.trim());
      if (activeFilters.alertNo.trim()) params.set('alertNo', activeFilters.alertNo.trim());
      if (activeFilters.keyword.trim()) params.set('keyword', activeFilters.keyword.trim());
      if (activeFilters.overdueOnly) params.set('overdueOnly', 'true');

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load cases.'));
      }
      const data = (await response.json()) as CaseListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(targetPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load cases.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCases(1);
  }, []);

  const resetFilters = async () => {
    setFilters(DEFAULT_FILTERS);
    await fetchCases(1, DEFAULT_FILTERS);
  };

  const openDetail = (id: string) => {
    navigate(
      `/dashboard/compliance/cases/${id}?from=${encodeURIComponent(
        `${location.pathname}${location.search}`,
      )}`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Cases</h1>
          <p className="text-sm text-gray-500 mt-1">
            Investigate review escalations through a canonical workflow / stage / rule queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReadCaseExports ? (
            <button
              onClick={() => navigate('/dashboard/compliance/case-evidence-exports')}
              className={adminButtonClass('listSecondary')}
            >
              Case Evidence Exports
            </button>
          ) : null}
          <button
            onClick={() => void fetchCases(currentPage)}
            className={adminIconButtonClass()}
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <div className="px-4 py-3 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-700">
        {canWriteCases
          ? 'Use the case list to scan ownership, severity, filing state, and due dates. Open the case detail page for actions, report drafting, MLRO review, and external filing follow-up.'
          : 'You currently have read-only access to compliance cases. Open the detail page for the full investigation record.'}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Case no"
            value={filters.caseNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, caseNo: e.target.value }))}
          />
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as FilterState['status'] }))}
          >
            <option value="">All status</option>
            <option value="OPEN">OPEN</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="INVESTIGATING">INVESTIGATING</option>
            <option value="PENDING_MLRO_REVIEW">PENDING_MLRO_REVIEW</option>
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
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Alert no"
            value={filters.alertNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, alertNo: e.target.value }))}
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
            onClick={() => void fetchCases(1)}
            className={adminButtonClass('listPrimary')}
            disabled={loading}
          >
            Search
          </button>
          <button
            onClick={() => void resetFilters()}
            className={adminButtonClass('listSecondary')}
            disabled={loading || !hasFilters}
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
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Case</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Severity</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow / Stage / Rule</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Freeze</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Filing</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Customer</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Primary Alert</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Assignee</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Due</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Last Action</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                    No cases found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className={adminButtonClass('rowKeyLink')}
                        onClick={() => openDetail(item.id)}
                        title={item.caseNo || '-'}
                      >
                        {item.caseNo || '-'}
                      </button>
                      <div className="text-xs text-gray-500">{item.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getSeverityClass(item.severity)}`}>
                        {item.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.workflow || item.caseType || 'GENERIC'}</div>
                      <div className="text-xs text-gray-500">{item.stage || '-'}</div>
                      <div className="text-xs text-gray-500">{item.rule || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit px-2 py-1 rounded-full text-xs ${getFreezeStatusClass(item.freezeStatus)}`}
                        >
                          {item.freezeStatus || 'ACTIVE'}
                        </span>
                        {item.frozenAt ? (
                          <span className="text-xs text-gray-500">{formatDateTime(item.frozenAt)}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit px-2 py-1 rounded-full text-xs ${getFilingStatusClass(item.filingStatus)}`}
                        >
                          {normalizeFilingStatus(item.filingStatus)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.customerNo || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.primaryAlertNo || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.assigneeUserNo || '-'}</td>
                    <td className="px-4 py-3">
                      <div className={isOverdue(item) ? 'text-red-700 font-medium' : 'text-gray-700'}>
                        {formatDateTime(item.dueAt)}
                      </div>
                      {item.overdueMarkedAt ? (
                        <div className="text-xs text-red-600 mt-1">
                          Flagged {formatDateTime(item.overdueMarkedAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.lastActionAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        className={adminButtonClass('rowLink')}
                        onClick={() => openDetail(item.id)}
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
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchCases(page)}
        />
      </div>
    </div>
  );
};

export default ComplianceCasesPage;

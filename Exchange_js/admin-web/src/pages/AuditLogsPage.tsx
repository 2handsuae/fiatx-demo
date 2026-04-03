import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, FileUp, RefreshCw, Search, Square, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type TriggerType =
  | 'EVIDENCE_EXPORT'
  | 'STATE_TRANSITION'
  | 'MANUAL_OVERRIDE'
  | 'AUTH_EVENT'
  | 'PERMISSION_CHANGE'
  | 'CONFIG_CHANGE'
  | 'DATA_CREATE'
  | 'DATA_UPDATE'
  | 'DATA_DELETE'
  | 'SYSTEM_EVENT';

type AuditResult = 'SUCCESS' | 'FAILED' | 'REJECTED';

interface AuditLogItem {
  id: string;
  auditNo: string;
  triggerType: TriggerType;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  entityNo?: string | null;
  entityOwnerNo?: string | null;
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  result: AuditResult;
  occurredAt: string;
  traceId?: string | null;
  workflowType?: string | null;
  workflowNo?: string | null;
  subjectNos?: AuditSubjectNo[] | null;
}

interface AuditSubjectNo {
  id: string;
  subjectRole: string;
  subjectType: string;
  subjectId?: string | null;
  subjectNo: string;
  occurredAt: string;
}

interface AuditLogListResponse {
  total: number;
  skip: number;
  take: number;
  items: AuditLogItem[];
}

interface EvidencePackageExportResponse {
  id: string;
  packageNo: string;
  status: string;
  itemCount: number;
  approvalCaseId?: string | null;
  approvalCase?: {
    id: string;
    status: string;
  } | null;
}

interface FilterState {
  keyword: string;
  module: string;
  subjectNo: string;
  subjectType: string;
  actorNo: string;
  entityOwnerNo: string;
  traceId: string;
  workflowType: string;
  workflowNo: string;
  triggerType: '' | TriggerType;
  result: '' | AuditResult;
  startAt: string;
  endAt: string;
  includeArchived: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  module: '',
  subjectNo: '',
  subjectType: '',
  actorNo: '',
  entityOwnerNo: '',
  traceId: '',
  workflowType: '',
  workflowNo: '',
  triggerType: '',
  result: '',
  startAt: '',
  endAt: '',
  includeArchived: false,
};

const PAGE_SIZE = 20;

const toIsoString = (value: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const selectSubjectAnchor = (item: AuditLogItem): AuditSubjectNo | null => {
  if (Array.isArray(item.subjectNos) && item.subjectNos.length > 0) {
    const preferredRoles = ['ENTITY', 'RELATED', 'SOURCE'];
    const preferredSubject =
      preferredRoles
        .map((role) =>
          item.subjectNos?.find(
            (subject) => subject.subjectRole === role && subject.subjectNo.trim(),
          ),
        )
        .find(Boolean) ||
      item.subjectNos.find(
        (subject) =>
          subject.subjectRole !== 'ACTOR' &&
          subject.subjectRole !== 'OWNER' &&
          subject.subjectNo.trim(),
      ) ||
      item.subjectNos.find(
        (subject) => subject.subjectRole === 'OWNER' && subject.subjectNo.trim(),
      );
    if (preferredSubject) return preferredSubject;
  }

  const fallbackSubjectNo = item.entityNo?.trim();
  if (!fallbackSubjectNo) return null;

  return {
    id: item.id,
    subjectRole: 'ENTITY',
    subjectType: item.entityType,
    subjectNo: fallbackSubjectNo,
    occurredAt: item.occurredAt,
  };
};

const getStatusClassName = (result: AuditResult) => {
  switch (result) {
    case 'SUCCESS':
      return 'bg-green-100 text-green-700';
    case 'FAILED':
      return 'bg-red-100 text-red-700';
    case 'REJECTED':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const AuditLogsPage = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastExportId, setLastExportId] = useState<string | null>(null);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const currentPageIds = useMemo(() => items.map((item) => item.id), [items]);
  const allCurrentPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIdSet.has(id));

  const buildSearchParams = (activeFilters: FilterState, targetPage: number) => {
    const params = new URLSearchParams();
    params.set('skip', String((targetPage - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));

    if (activeFilters.keyword.trim()) params.set('keyword', activeFilters.keyword.trim());
    if (activeFilters.module.trim()) params.set('module', activeFilters.module.trim());
    if (activeFilters.subjectNo.trim()) params.set('subjectNo', activeFilters.subjectNo.trim());
    if (activeFilters.subjectType.trim()) {
      params.set('subjectType', activeFilters.subjectType.trim());
    }
    if (activeFilters.actorNo.trim()) params.set('actorNo', activeFilters.actorNo.trim());
    if (activeFilters.entityOwnerNo.trim()) {
      params.set('entityOwnerNo', activeFilters.entityOwnerNo.trim());
    }
    if (activeFilters.traceId.trim()) params.set('traceId', activeFilters.traceId.trim());
    if (activeFilters.workflowType.trim()) {
      params.set('workflowType', activeFilters.workflowType.trim());
    }
    if (activeFilters.workflowNo.trim()) params.set('workflowNo', activeFilters.workflowNo.trim());
    if (activeFilters.triggerType) params.set('triggerType', activeFilters.triggerType);
    if (activeFilters.result) params.set('result', activeFilters.result);

    const startAt = toIsoString(activeFilters.startAt);
    const endAt = toIsoString(activeFilters.endAt);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);
    if (activeFilters.includeArchived) params.set('includeArchived', 'true');

    return params;
  };

  const fetchLogs = async (targetPage: number, activeFilters: FilterState = filters) => {
    setLoading(true);
    setError('');
    try {
      const params = buildSearchParams(activeFilters, targetPage);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load audit logs.'));
      }

      const data = (await response.json()) as AuditLogListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(targetPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectCurrentPage = () => {
    if (allCurrentPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !currentPageIds.includes(id)));
      return;
    }

    setSelectedIds((prev) => Array.from(new Set([...prev, ...currentPageIds])));
  };

  const handleReset = async () => {
    setFilters(DEFAULT_FILTERS);
    setSelectedIds([]);
    setLastExportId(null);
    setMessage('');
    await fetchLogs(1, DEFAULT_FILTERS);
  };

  const handleExportSelected = async () => {
    if (!selectedIds.length) return;

    setExporting(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        mode: 'SELECTION',
        selectedEventIds: selectedIds,
        includeRecords: true,
        maxItems: Math.max(selectedIds.length, 1),
      };

      if (filters.workflowType.trim()) payload.workflowType = filters.workflowType.trim();
      if (filters.workflowNo.trim()) payload.workflowNo = filters.workflowNo.trim();
      if (filters.subjectNo.trim()) payload.subjectNo = filters.subjectNo.trim();
      if (filters.subjectType.trim()) payload.subjectType = filters.subjectType.trim();
      if (filters.actorNo.trim()) payload.actorNo = filters.actorNo.trim();
      if (filters.entityOwnerNo.trim()) payload.entityOwnerNo = filters.entityOwnerNo.trim();
      if (filters.traceId.trim()) payload.traceId = filters.traceId.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs/export/evidence-package`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to create evidence package.'),
        );
      }

      const data = (await response.json()) as EvidencePackageExportResponse;
      setLastExportId(data.id);
      setMessage(
        `Evidence package request created: ${data.packageNo} (${data.itemCount} records). Approval is pending before the package can be downloaded.`,
      );
      setSelectedIds([]);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create evidence package.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    void fetchLogs(1, DEFAULT_FILTERS);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Center - Audit Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search by typed core fields like Workflow No, Trace ID, Subject No, actorNo, and
            entityOwnerNo, then submit an approval-backed evidence package request.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchLogs(currentPage, filters)}
            className={adminIconButtonClass()}
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/dashboard/audit/evidence-exports')}
            className={adminButtonClass('listSecondary')}
          >
            Open Evidence Packages
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <div>{message}</div>
          {lastExportId && (
            <button
              onClick={() => navigate('/dashboard/audit/evidence-exports')}
              className={adminButtonClass('rowLink', 'mt-2')}
            >
              View evidence package
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-admin-border bg-white p-4 shadow-sm">
        <div className="text-sm text-gray-500">
          Prioritize Workflow No, Trace ID, Subject No, actorNo, and entityOwnerNo when narrowing
          records.
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <input
            value={filters.workflowNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, workflowNo: e.target.value }))}
            placeholder="Workflow No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.traceId}
            onChange={(e) => setFilters((prev) => ({ ...prev, traceId: e.target.value }))}
            placeholder="Trace ID"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectNo: e.target.value }))}
            placeholder="Subject No"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.actorNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, actorNo: e.target.value }))}
            placeholder="actorNo"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.entityOwnerNo}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, entityOwnerNo: e.target.value }))
            }
            placeholder="entityOwnerNo"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder="Keyword (action, audit no, reason)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.module}
            onChange={(e) => setFilters((prev) => ({ ...prev, module: e.target.value }))}
            placeholder="Module"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={filters.subjectType}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectType: e.target.value }))}
            placeholder="Subject Type"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <select
            value={filters.workflowType}
            onChange={(e) => setFilters((prev) => ({ ...prev, workflowType: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Workflow Types</option>
            <option value="DEPOSIT">DEPOSIT</option>
            <option value="WITHDRAW">WITHDRAW</option>
            <option value="SWAP">SWAP</option>
          </select>
          <select
            value={filters.triggerType}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                triggerType: e.target.value as FilterState['triggerType'],
              }))
            }
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Trigger Types</option>
            <option value="EVIDENCE_EXPORT">EVIDENCE_EXPORT</option>
            <option value="STATE_TRANSITION">STATE_TRANSITION</option>
            <option value="MANUAL_OVERRIDE">MANUAL_OVERRIDE</option>
            <option value="AUTH_EVENT">AUTH_EVENT</option>
            <option value="PERMISSION_CHANGE">PERMISSION_CHANGE</option>
            <option value="CONFIG_CHANGE">CONFIG_CHANGE</option>
            <option value="DATA_CREATE">DATA_CREATE</option>
            <option value="DATA_UPDATE">DATA_UPDATE</option>
            <option value="DATA_DELETE">DATA_DELETE</option>
            <option value="SYSTEM_EVENT">SYSTEM_EVENT</option>
          </select>
          <select
            value={filters.result}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                result: e.target.value as FilterState['result'],
              }))
            }
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">All Results</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <input
            type="datetime-local"
            value={filters.startAt}
            onChange={(e) => setFilters((prev) => ({ ...prev, startAt: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={filters.endAt}
            onChange={(e) => setFilters((prev) => ({ ...prev, endAt: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, includeArchived: e.target.checked }))
              }
            />
            Include archived
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void fetchLogs(1, filters)}
            className={adminButtonClass('listPrimary')}
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => void handleReset()}
            className={adminButtonClass('listSecondary')}
          >
            Reset
          </button>
          <button
            onClick={() => void handleExportSelected()}
            disabled={exporting || selectedIds.length === 0}
            className={adminButtonClass('listPrimary')}
          >
            <FileUp size={16} />
            {exporting ? 'Creating package...' : `Create Evidence Package (${selectedIds.length})`}
          </button>
          <button
            onClick={() => setSelectedIds([])}
            disabled={selectedIds.length === 0}
            className={adminButtonClass('listSecondary')}
          >
            <X size={16} />
            Clear Selection
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">
                  <button
                    onClick={toggleSelectCurrentPage}
                    className="inline-flex items-center text-gray-600 hover:text-brand-primary"
                    title="Select current page"
                  >
                    {allCurrentPageSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Audit No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Occurred At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Trace ID</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Audit Action</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Subject Owner No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">actorNo</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Result</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleSelection(item.id)}
                        className="inline-flex items-center text-gray-600 hover:text-brand-primary"
                      >
                        {selectedIdSet.has(item.id) ? (
                          <CheckSquare size={16} />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/audit/audit-logs/${item.id}`)}
                        className={adminButtonClass('rowKeyLink')}
                      >
                        {item.auditNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.occurredAt)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.workflowType || '-'}</div>
                      <div className="text-xs text-gray-500">{item.workflowNo || '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {item.traceId || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.action}</div>
                      <div className="text-xs text-gray-500">{item.module}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {(() => {
                        const subjectAnchor = selectSubjectAnchor(item);
                        return subjectAnchor ? (
                          <>
                            <div className="font-medium text-gray-900">
                              {subjectAnchor.subjectNo}
                            </div>
                            <div className="text-xs text-gray-500">
                              {subjectAnchor.subjectRole} / {subjectAnchor.subjectType}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-gray-900">-</div>
                            <div className="text-xs text-gray-500">Subject Type: {item.entityType}</div>
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.entityOwnerNo || '-'}</div>
                      <div className="text-xs text-gray-500">entityOwnerNo</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.actorNo || '-'}</div>
                      <div className="text-xs text-gray-500">{item.actorType}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${getStatusClassName(item.result)}`}
                      >
                        {item.result}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/dashboard/audit/audit-logs/${item.id}`)}
                        className={adminButtonClass('rowLink')}
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
            onPageChange={(page) => void fetchLogs(page, filters)}
          />
        </div>
      </div>
    </div>
  );
};

export default AuditLogsPage;

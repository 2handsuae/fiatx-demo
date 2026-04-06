import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, FileUp, RefreshCw, Search, Square, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge, TriggerTag } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

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
  businessWorkflow?: string | null;
  businessWorkflowLabel?: string | null;
  primaryRefNo?: string | null;
  userAction?: string | null;
  userActionLabel?: string | null;
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

  const [showAdvanced, setShowAdvanced] = useState(false);

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

  /* ── Shared input className for filter inputs ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Page Title Bar ── */}
      <PageTitleBar
        title="Audit Logs"
        meta={`${total} records · Compliance & Risk`}
      >
        <button
          onClick={() => void handleExportSelected()}
          disabled={exporting || selectedIds.length === 0}
          className={adminButtonClass('listPrimary')}
        >
          <FileUp size={13} />
          {exporting
            ? 'Creating…'
            : selectedIds.length > 0
              ? `Create Package (${selectedIds.length})`
              : 'Create Evidence Package'}
        </button>
        <button
          onClick={() => navigate('/dashboard/audit/evidence-exports')}
          className={adminButtonClass('listSecondary')}
        >
          Evidence Packages
        </button>
        <button
          onClick={() => void fetchLogs(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Primary Filter Bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.keyword}
          onChange={(e) => setFilters((p) => ({ ...p, keyword: e.target.value }))}
          placeholder="Audit No / Keyword"
          className={`${fi} w-40`}
        />
        <select
          value={filters.result}
          onChange={(e) =>
            setFilters((p) => ({ ...p, result: e.target.value as FilterState['result'] }))
          }
          className={`${fi} w-32`}
        >
          <option value="">All Results</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILED">FAILED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <select
          value={filters.triggerType}
          onChange={(e) =>
            setFilters((p) => ({
              ...p,
              triggerType: e.target.value as FilterState['triggerType'],
            }))
          }
          className={`${fi} w-44`}
        >
          <option value="">All Triggers</option>
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
        <input
          value={filters.actorNo}
          onChange={(e) => setFilters((p) => ({ ...p, actorNo: e.target.value }))}
          placeholder="Actor No"
          className={`${fi} w-28`}
        />
        <button
          onClick={() => void fetchLogs(1, filters)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button onClick={() => void handleReset()} className={adminButtonClass('listSecondary')}>
          Reset
        </button>
        <button
          onClick={() => setShowAdvanced((p) => !p)}
          className="ml-1 font-mono text-[10px] text-adm-t3 transition-colors hover:text-adm-amber"
        >
          {showAdvanced ? 'Less ▲' : 'Advanced ▾'}
        </button>
      </div>

      {/* ── Advanced Filter Bar ── */}
      {showAdvanced && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-bg/60 px-5 py-2">
          <input
            value={filters.workflowNo}
            onChange={(e) => setFilters((p) => ({ ...p, workflowNo: e.target.value }))}
            placeholder="Workflow No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.traceId}
            onChange={(e) => setFilters((p) => ({ ...p, traceId: e.target.value }))}
            placeholder="Trace ID"
            className={`${fi} w-36`}
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((p) => ({ ...p, subjectNo: e.target.value }))}
            placeholder="Subject No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.entityOwnerNo}
            onChange={(e) => setFilters((p) => ({ ...p, entityOwnerNo: e.target.value }))}
            placeholder="Entity Owner No"
            className={`${fi} w-36`}
          />
          <input
            type="datetime-local"
            value={filters.startAt}
            onChange={(e) => setFilters((p) => ({ ...p, startAt: e.target.value }))}
            className={fi}
          />
          <input
            type="datetime-local"
            value={filters.endAt}
            onChange={(e) => setFilters((p) => ({ ...p, endAt: e.target.value }))}
            className={fi}
          />
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-adm-t2">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) =>
                setFilters((p) => ({ ...p, includeArchived: e.target.checked }))
            }
            />
            Include Archived
          </label>
        </div>
      )}

      {/* ── Message / Error banners ── */}
      {message && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green">
          {message}
          {lastExportId && (
            <button
              onClick={() => navigate('/dashboard/audit/evidence-exports')}
              className={adminButtonClass('rowLink', 'ml-3')}
            >
              View package →
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Selection bar ── */}
      {selectedIds.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-adm-amber/20 bg-adm-amber/5 px-5 py-2">
          <span className="font-mono text-[11px] text-adm-t2">
            {selectedIds.length} selected
          </span>
          <div className="h-3 w-px bg-adm-border" />
          <button
            onClick={() => setSelectedIds([])}
            className={adminButtonClass('listSecondary')}
          >
            <X size={12} />
            Deselect
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-9 border-b border-adm-border bg-adm-panel px-3 py-2">
                <button
                  onClick={toggleSelectCurrentPage}
                  className="text-adm-t3 hover:text-adm-amber transition-colors"
                  title="Select page"
                >
                  {allCurrentPageSelected ? (
                    <CheckSquare size={14} />
                  ) : (
                    <Square size={14} />
                  )}
                </button>
              </th>
              {(
                [
                  ['Time',     '110px'],
                  ['Audit No', '152px'],
                  ['Result',   '84px'],
                  ['Action',   'auto'],
                  ['Subject',  '180px'],
                  ['Actor',    '130px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  No audit logs found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => {
                const subjectAnchor = selectSubjectAnchor(item);
                const borderCls =
                  item.result === 'SUCCESS'
                    ? 'border-l-2 border-l-adm-green'
                    : item.result === 'FAILED'
                      ? 'border-l-2 border-l-adm-red'
                      : item.result === 'REJECTED'
                        ? 'border-l-2 border-l-adm-amber'
                        : '';
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/dashboard/audit/audit-logs/${item.id}`)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelection(item.id);
                        }}
                        className="text-adm-t3 hover:text-adm-amber transition-colors"
                      >
                        {selectedIdSet.has(item.id) ? (
                          <CheckSquare size={14} />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                    </td>
                    {/* Time — 2 lines */}
                    <td className="px-3 py-2.5 font-mono text-[10px] leading-relaxed text-adm-t2">
                      {new Date(item.occurredAt).toLocaleDateString()}
                      <br />
                      {new Date(item.occurredAt).toLocaleTimeString()}
                    </td>
                    {/* Audit No — amber + status left-border */}
                    <td className={`px-3 py-2.5 ${borderCls}`}>
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.auditNo}
                      </span>
                    </td>
                    {/* Result badge */}
                    <td className="px-3 py-2.5">
                      <AdminBadge value={item.result} />
                    </td>
                    {/* Action — main label + trigger tag */}
                    <td className="max-w-[240px] px-3 py-2.5">
                      <div className="text-[11px] leading-snug text-adm-t1">
                        {item.userActionLabel || item.userAction || item.action}
                      </div>
                      <div className="mt-1">
                        <TriggerTag value={item.triggerType} />
                      </div>
                    </td>
                    {/* Subject */}
                    <td className="px-3 py-2.5">
                      {subjectAnchor ? (
                        <>
                          <div className="font-mono text-[11px] font-semibold text-adm-amber">
                            {subjectAnchor.subjectNo}
                          </div>
                          <div className="font-mono text-[9px] text-adm-t3">
                            {subjectAnchor.subjectRole} / {subjectAnchor.subjectType}
                          </div>
                        </>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>
                    {/* Actor */}
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.actorNo ?? item.actorId.slice(0, 8) + '…'}
                      </div>
                      <div className="font-mono text-[9px] text-adm-t3">{item.actorType}</div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => void fetchLogs(page, filters)}
        />
      </div>
    </div>
  );
};

export default AuditLogsPage;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckSquare, FileUp, RefreshCw, Search, Square, X } from 'lucide-react';
import { ListFooter } from '../components/common/ListFooter';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE } from './auditEntityRoutes';

type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED' | 'PARTIAL';

interface AuditLogItem {
  id: string;
  eventNo: string;
  action: string;
  primarySubjectType?: string | null;
  primarySubjectNo?: string | null;
  entityOwnerNo?: string | null;
  actorType: string;
  actorNo?: string | null;
  outcome: AuditOutcome;
  occurredAt: string;
  traceId?: string | null;
  workflowType?: string | null;
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
  primarySubjectNo: string;
  subjectNo: string;
  actorNo: string;
  ownerCustomerNo: string;
  traceId: string;
  outcome: '' | AuditOutcome;
  actionDomain: string;
  action: string;
  workflowType: string;
  correlationId: string;
  startAt: string;
  endAt: string;
  includeArchived: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  primarySubjectNo: '',
  subjectNo: '',
  actorNo: '',
  ownerCustomerNo: '',
  traceId: '',
  outcome: '',
  actionDomain: '',
  action: '',
  workflowType: '',
  correlationId: '',
  startAt: '',
  endAt: '',
  includeArchived: false,
};

/** 与词表 11 域一致（+落库默认值 UNCLASSIFIED）。域清单几年不变一次，不值得建接口。 */
const ACTION_DOMAINS = [
  'APPROVAL', 'IAM', 'CONFIG', 'AUDIT', 'CUSTOMER', 'DEPOSIT',
  'WITHDRAW', 'SWAP', 'TREASURY', 'RECON', 'GOVERNANCE', 'UNCLASSIFIED',
] as const;

const URL_FILTER_KEYS = [
  'keyword', 'primarySubjectNo', 'subjectNo', 'actorNo', 'ownerCustomerNo', 'traceId',
  'outcome', 'actionDomain', 'action', 'workflowType', 'correlationId', 'startAt', 'endAt',
] as const;

const PAGE_SIZE = 20;

const toIsoString = (value: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const AuditLogsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastExportPackageNo, setLastExportPackageNo] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const currentPageIds = useMemo(() => items.map((item) => item.id), [items]);
  const allCurrentPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIdSet.has(id));

  const filtersFromUrl = (params: URLSearchParams): { initial: FilterState; hasAny: boolean } => {
    const initial: FilterState = { ...DEFAULT_FILTERS };
    let hasAny = false;
    URL_FILTER_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) {
        (initial as unknown as Record<string, unknown>)[key] = value;
        hasAny = true;
      }
    });
    if (params.get('includeArchived') === 'true') {
      initial.includeArchived = true;
      hasAny = true;
    }
    return { initial, hasAny };
  };

  const filtersToUrl = (f: FilterState): URLSearchParams => {
    const params = new URLSearchParams();
    URL_FILTER_KEYS.forEach((key) => {
      const value = String((f as unknown as Record<string, unknown>)[key] ?? '').trim();
      if (value) params.set(key, value);
    });
    if (f.includeArchived) params.set('includeArchived', 'true');
    return params;
  };

  const buildSearchParams = (activeFilters: FilterState, targetPage: number) => {
    const params = new URLSearchParams();
    params.set('skip', String((targetPage - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));

    if (activeFilters.keyword.trim()) params.set('keyword', activeFilters.keyword.trim());
    if (activeFilters.primarySubjectNo.trim()) {
      params.set('primarySubjectNo', activeFilters.primarySubjectNo.trim());
    }
    if (activeFilters.subjectNo.trim()) params.set('subjectNo', activeFilters.subjectNo.trim());
    if (activeFilters.actorNo.trim()) params.set('actorNo', activeFilters.actorNo.trim());
    if (activeFilters.ownerCustomerNo.trim()) {
      params.set('ownerCustomerNo', activeFilters.ownerCustomerNo.trim());
    }
    if (activeFilters.traceId.trim()) params.set('traceId', activeFilters.traceId.trim());
    if (activeFilters.outcome) params.set('outcome', activeFilters.outcome);
    if (activeFilters.actionDomain) params.set('actionDomain', activeFilters.actionDomain);
    if (activeFilters.action.trim()) params.set('action', activeFilters.action.trim());
    if (activeFilters.workflowType.trim()) {
      params.set('workflowType', activeFilters.workflowType.trim());
    }
    if (activeFilters.correlationId.trim()) {
      params.set('correlationId', activeFilters.correlationId.trim());
    }

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

  const handleSearch = () => {
    setSearchParams(filtersToUrl(filters), { replace: true });
    void fetchLogs(1, filters);
  };

  const handleReset = async () => {
    setFilters(DEFAULT_FILTERS);
    setSelectedIds([]);
    setLastExportPackageNo(null);
    setMessage('');
    setSearchParams(new URLSearchParams(), { replace: true });
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

      if (filters.actorNo.trim()) payload.actorNo = filters.actorNo.trim();
      if (filters.ownerCustomerNo.trim()) payload.ownerCustomerNo = filters.ownerCustomerNo.trim();
      if (filters.traceId.trim()) payload.traceId = filters.traceId.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit/evidence-packages`,
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
      setLastExportPackageNo(data.packageNo);
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
    const { initial, hasAny } = filtersFromUrl(searchParams);
    if (!hasAny) {
      void fetchLogs(1, DEFAULT_FILTERS);
      return;
    }
    setFilters(initial);
    // 深链带进来的高级栏字段要看得见，否则预填了也不知道在筛什么
    if (
      initial.primarySubjectNo || initial.subjectNo || initial.ownerCustomerNo ||
      initial.action || initial.workflowType || initial.correlationId ||
      initial.startAt || initial.endAt || initial.includeArchived
    ) {
      setShowAdvanced(true);
    }
    void fetchLogs(1, initial);
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
          onClick={() => navigate('/admin/audit/evidence-packages')}
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
          value={filters.outcome}
          onChange={(e) =>
            setFilters((p) => ({ ...p, outcome: e.target.value as FilterState['outcome'] }))
          }
          className={`${fi} w-32`}
        >
          <option value="">All Results</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="DENIED">DENIED</option>
          <option value="FAILED">FAILED</option>
          <option value="PARTIAL">PARTIAL</option>
        </select>
        <select
          value={filters.actionDomain}
          onChange={(e) => setFilters((p) => ({ ...p, actionDomain: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All Domains</option>
          {ACTION_DOMAINS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input
          value={filters.actorNo}
          onChange={(e) => setFilters((p) => ({ ...p, actorNo: e.target.value }))}
          placeholder="Actor No"
          className={`${fi} w-28`}
        />
        <input
          value={filters.traceId}
          onChange={(e) => setFilters((p) => ({ ...p, traceId: e.target.value }))}
          placeholder="Trace ID"
          className={`${fi} w-32`}
        />
        <button
          onClick={handleSearch}
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
            value={filters.primarySubjectNo}
            onChange={(e) => setFilters((p) => ({ ...p, primarySubjectNo: e.target.value }))}
            placeholder="Entity No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((p) => ({ ...p, subjectNo: e.target.value }))}
            placeholder="Related No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.ownerCustomerNo}
            onChange={(e) => setFilters((p) => ({ ...p, ownerCustomerNo: e.target.value }))}
            placeholder="Entity Owner No"
            className={`${fi} w-36`}
          />
          <input
            value={filters.action}
            onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
            placeholder="Action Code"
            className={`${fi} w-40`}
          />
          <input
            value={filters.workflowType}
            onChange={(e) => setFilters((p) => ({ ...p, workflowType: e.target.value }))}
            placeholder="Workflow Type"
            className={`${fi} w-36`}
          />
          <input
            value={filters.correlationId}
            onChange={(e) => setFilters((p) => ({ ...p, correlationId: e.target.value }))}
            placeholder="Correlation ID"
            className={`${fi} w-40`}
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
          {lastExportPackageNo && (
            <button
              onClick={() => navigate('/admin/audit/evidence-packages')}
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
                  ['Time',           '140px'],
                  ['Audit No',       '152px'],
                  ['Result',         '84px'],
                  ['Workflow Type',  '130px'],
                  ['Action',         '180px'],
                  ['Entity No',      '140px'],
                  ['Entity Type',    '120px'],
                  ['Trace ID',       '160px'],
                  ['Actor No',       'auto'],
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
                  colSpan={10}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  No audit logs found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => {
                const borderCls =
                  item.outcome === 'SUCCESS'
                    ? 'border-l-2 border-l-adm-green'
                    : item.outcome === 'FAILED'
                      ? 'border-l-2 border-l-adm-red'
                      : item.outcome === 'DENIED'
                        ? 'border-l-2 border-l-adm-amber'
                        : '';
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/audit/logs/${item.eventNo}`)}
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
                    {/* Time */}
                    <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {new Date(item.occurredAt).toLocaleString()}
                    </td>
                    {/* Audit No — amber + status left-border */}
                    <td className={`px-3 py-2.5 ${borderCls}`}>
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.eventNo}
                      </span>
                    </td>
                    {/* Result badge */}
                    <td className="px-3 py-2.5">
                      <AdminBadge value={item.outcome} />
                    </td>
                    {/* Workflow Type */}
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                      {item.workflowType ?? <span className="text-adm-t3">—</span>}
                    </td>
                    {/* Action */}
                    <td className="max-w-[200px] px-3 py-2.5">
                      <span className="truncate text-[11px] text-adm-t1">{item.action}</span>
                    </td>
                    {/* Entity No */}
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-amber">
                      {item.primarySubjectNo ? (
                        AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType ?? ''] ? (
                          <span
                            className="cursor-pointer text-adm-blue hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType!]!(item.primarySubjectNo!));
                            }}
                          >
                            {item.primarySubjectNo}
                          </span>
                        ) : (
                          item.primarySubjectNo
                        )
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>
                    {/* Entity Type */}
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                      {item.primarySubjectType ?? <span className="text-adm-t3">—</span>}
                    </td>
                    {/* Trace ID */}
                    <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                      {item.traceId ?? <span className="text-adm-t3">—</span>}
                    </td>
                    {/* Actor No */}
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-amber">
                      {item.actorNo ?? <span className="text-adm-t3">—</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <ListFooter
        filteredCount={items.length}
        total={total}
        noun="record"
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => void fetchLogs(page, filters)}
      />
    </div>
  );
};

export default AuditLogsPage;

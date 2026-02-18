import { useEffect, useState } from 'react';
import { RefreshCw, Search, Download, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
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
  reason?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  occurredAt: string;
}

interface AuditLogListResponse {
  total: number;
  skip: number;
  take: number;
  items: AuditLogItem[];
}

interface AuditLogDetail extends AuditLogItem {
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
  actorRole?: string | null;
  requestId?: string | null;
  sourceIp?: string | null;
  sourcePlatform?: string | null;
  metadata?: unknown;
  beforeData?: unknown;
  afterData?: unknown;
  payloadDigest?: string;
  maskVersion?: string;
  retainedUntil?: string;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  subjectNos?: Array<{
    id: string;
    subjectRole: string;
    subjectType: string;
    subjectId?: string | null;
    subjectNo: string;
    occurredAt: string;
  }>;
}

interface EvidencePackageResponse {
  packageNo: string;
  fileName: string;
  generatedAt: string;
  itemCount: number;
  digest: string;
  manifest: Record<string, unknown>;
  records: unknown[];
}

interface FilterState {
  keyword: string;
  module: string;
  subjectNo: string;
  subjectType: string;
  actorNo: string;
  entityOwnerNo: string;
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

const toPrettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const AuditLogsPage = () => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchLogs = async (
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

      if (activeFilters.keyword.trim()) {
        params.set('keyword', activeFilters.keyword.trim());
      }
      if (activeFilters.module.trim()) {
        params.set('module', activeFilters.module.trim());
      }
      if (activeFilters.subjectNo.trim()) {
        params.set('subjectNo', activeFilters.subjectNo.trim());
      }
      if (activeFilters.subjectType.trim()) {
        params.set('subjectType', activeFilters.subjectType.trim());
      }
      if (activeFilters.actorNo.trim()) {
        params.set('actorNo', activeFilters.actorNo.trim());
      }
      if (activeFilters.entityOwnerNo.trim()) {
        params.set('entityOwnerNo', activeFilters.entityOwnerNo.trim());
      }
      if (activeFilters.triggerType) {
        params.set('triggerType', activeFilters.triggerType);
      }
      if (activeFilters.result) {
        params.set('result', activeFilters.result);
      }

      const startAt = toIsoString(activeFilters.startAt);
      const endAt = toIsoString(activeFilters.endAt);
      if (startAt) params.set('startAt', startAt);
      if (endAt) params.set('endAt', endAt);
      if (activeFilters.includeArchived) {
        params.set('includeArchived', 'true');
      }

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

  const handleSearch = async () => {
    await fetchLogs(1, filters);
  };

  const handleReset = async () => {
    setFilters(DEFAULT_FILTERS);
    setDetail(null);
    await fetchLogs(1, DEFAULT_FILTERS);
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load audit log detail.'));
      }
      const data = (await response.json()) as AuditLogDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load audit log detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExportEvidencePackage = async () => {
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        maxItems: 5000,
        includeRecords: true,
      };

      if (filters.keyword.trim()) payload.keyword = filters.keyword.trim();
      if (filters.module.trim()) payload.module = filters.module.trim();
      if (filters.subjectNo.trim()) payload.subjectNo = filters.subjectNo.trim();
      if (filters.subjectType.trim()) payload.subjectType = filters.subjectType.trim();
      if (filters.actorNo.trim()) payload.actorNo = filters.actorNo.trim();
      if (filters.entityOwnerNo.trim()) {
        payload.entityOwnerNo = filters.entityOwnerNo.trim();
      }
      if (filters.triggerType) payload.triggerType = filters.triggerType;
      if (filters.result) payload.result = filters.result;
      if (filters.includeArchived) payload.includeArchived = true;

      const startAt = toIsoString(filters.startAt);
      const endAt = toIsoString(filters.endAt);
      if (startAt) payload.startAt = startAt;
      if (endAt) payload.endAt = endAt;

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
          await getApiErrorMessage(response, 'Failed to export evidence package.'),
        );
      }

      const data = (await response.json()) as EvidencePackageResponse;
      const content = JSON.stringify(data, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName || `${data.packageNo}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMessage(
        `Evidence package exported: ${data.packageNo} (${data.itemCount} records)`,
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to export evidence package.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    void fetchLogs(1, DEFAULT_FILTERS);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Audit Logs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Query key operation trails and export evidence package.
          </p>
        </div>
        <button
          onClick={() => void fetchLogs(currentPage, filters)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
            placeholder="Keyword (action/module/no/reason)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.module}
            onChange={(e) => setFilters((prev) => ({ ...prev, module: e.target.value }))}
            placeholder="Module (e.g. trading/withdraw-transactions)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.subjectNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectNo: e.target.value }))}
            placeholder="Subject No (exact)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.subjectType}
            onChange={(e) => setFilters((prev) => ({ ...prev, subjectType: e.target.value }))}
            placeholder="Subject Type (e.g. CUSTOMER/WITHDRAW)"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.actorNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, actorNo: e.target.value }))}
            placeholder="Actor No"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={filters.entityOwnerNo}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, entityOwnerNo: e.target.value }))
            }
            placeholder="Entity Owner No"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <select
            value={filters.triggerType}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                triggerType: e.target.value as FilterState['triggerType'],
              }))
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
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
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
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
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            type="datetime-local"
            value={filters.endAt}
            onChange={(e) => setFilters((prev) => ({ ...prev, endAt: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
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
            onClick={() => void handleSearch()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-brand-primary text-white hover:opacity-90"
          >
            <Search size={16} />
            Search
          </button>
          <button
            onClick={() => void handleReset()}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            onClick={() => void handleExportEvidencePackage()}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            <Download size={16} />
            {exporting ? 'Exporting...' : 'Export Evidence Package'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Audit No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Occurred At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Trigger</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Module</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Entity</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Actor</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Result</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
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
                    No audit logs found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{item.auditNo}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.occurredAt)}</td>
                    <td className="px-4 py-3 text-gray-700">{item.triggerType}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{item.action}</td>
                    <td className="px-4 py-3 text-gray-700">{item.module}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.entityNo || '-'}</div>
                      <div className="text-xs text-gray-500">{item.entityType}</div>
                      <div className="text-xs text-gray-500">OwnerNo: {item.entityOwnerNo || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.actorNo || '-'}</div>
                      <div className="text-xs text-gray-500">{item.actorType}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          item.result === 'SUCCESS'
                            ? 'bg-green-100 text-green-800'
                            : item.result === 'FAILED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {item.result}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void openDetail(item.id)}
                        className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                      >
                        Detail
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
          onPageChange={(nextPage) => void fetchLogs(nextPage, filters)}
        />
      </div>

      {(detailLoading || detail) && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden">
            <div className="px-5 py-4 border-b border-admin-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Audit Log Detail</h2>
                <p className="text-xs text-gray-500">
                  {detail?.auditNo || 'Loading...'}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[calc(90vh-72px)]">
              {detailLoading || !detail ? (
                <div className="text-sm text-gray-500">Loading detail...</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div><span className="text-gray-500">Trigger:</span> {detail.triggerType}</div>
                    <div><span className="text-gray-500">Action:</span> {detail.action}</div>
                    <div><span className="text-gray-500">Result:</span> {detail.result}</div>
                    <div><span className="text-gray-500">Module:</span> {detail.module}</div>
                    <div><span className="text-gray-500">EntityType:</span> {detail.entityType}</div>
                    <div><span className="text-gray-500">EntityId:</span> {detail.entityId || '-'}</div>
                    <div><span className="text-gray-500">EntityOwnerNo:</span> {detail.entityOwnerNo || '-'}</div>
                    <div><span className="text-gray-500">Actor:</span> {detail.actorType}/{detail.actorId}</div>
                    <div><span className="text-gray-500">ActorNo:</span> {detail.actorNo || '-'}</div>
                    <div><span className="text-gray-500">OccurredAt:</span> {formatDateTime(detail.occurredAt)}</div>
                    <div><span className="text-gray-500">RequestId:</span> {detail.requestId || '-'}</div>
                    <div><span className="text-gray-500">StatusFrom:</span> {detail.statusFrom || '-'}</div>
                    <div><span className="text-gray-500">StatusTo:</span> {detail.statusTo || '-'}</div>
                    <div><span className="text-gray-500">Reason:</span> {detail.reason || '-'}</div>
                    <div><span className="text-gray-500">Digest:</span> {detail.payloadDigest || '-'}</div>
                    <div><span className="text-gray-500">MaskVersion:</span> {detail.maskVersion || '-'}</div>
                    <div><span className="text-gray-500">RetainedUntil:</span> {formatDateTime(detail.retainedUntil)}</div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Metadata</h3>
                      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto h-52">
                        {toPrettyJson(detail.metadata)}
                      </pre>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Before Data</h3>
                      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto h-52">
                        {toPrettyJson(detail.beforeData)}
                      </pre>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">After Data</h3>
                      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto h-52">
                        {toPrettyJson(detail.afterData)}
                      </pre>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Subject Nos</h3>
                    <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-52">
                      {toPrettyJson(detail.subjectNos)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogsPage;

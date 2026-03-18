import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface CaseEvidenceExportItem {
  id: string;
  packageNo: string;
  approvalCaseId?: string | null;
  status: string;
  exportMode: string;
  fileName?: string | null;
  itemCount: number;
  digest?: string | null;
  exportedByType: string;
  exportedById: string;
  exportedByRole?: string | null;
  approvalCase?: {
    id: string;
    approvalNo?: string | null;
    status: string;
    executionStatus: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface CaseEvidenceExportListResponse {
  total: number;
  skip: number;
  take: number;
  items: CaseEvidenceExportItem[];
}

interface DownloadResponse {
  id: string;
  packageNo: string;
  fileName: string;
  digest: string;
  content: unknown;
}

interface CreateFormState {
  caseType: 'ONBOARDING';
  status: '' | 'OPEN' | 'ASSIGNED' | 'CLOSED';
  assigneeUserId: string;
  periodFrom: string;
  periodTo: string;
  selectedCaseIds: string;
}

const PAGE_SIZE = 20;

const DEFAULT_FORM: CreateFormState = {
  caseType: 'ONBOARDING',
  status: '',
  assigneeUserId: '',
  periodFrom: '',
  periodTo: '',
  selectedCaseIds: '',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const CaseEvidenceExportsPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.CASE_EVIDENCE_EXPORT_CREATE);
  const [items, setItems] = useState<CaseEvidenceExportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [form, setForm] = useState<CreateFormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const hasFilters = useMemo(() => {
    return (
      !!form.status ||
      !!form.assigneeUserId.trim() ||
      !!form.periodFrom ||
      !!form.periodTo ||
      !!form.selectedCaseIds.trim()
    );
  }, [form]);

  const fetchExports = async (page: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/evidence-packages?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load case evidence exports.'),
        );
      }

      const data = (await response.json()) as CaseEvidenceExportListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to load case evidence exports.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = { caseType: 'ONBOARDING' };
      if (form.status) payload.status = form.status;
      if (form.assigneeUserId.trim()) payload.assigneeUserId = form.assigneeUserId.trim();
      if (form.periodFrom) payload.periodFrom = new Date(form.periodFrom).toISOString();
      if (form.periodTo) payload.periodTo = new Date(form.periodTo).toISOString();

      const selectedCaseIds = form.selectedCaseIds
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (selectedCaseIds.length > 0) {
        payload.selectedCaseIds = selectedCaseIds;
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/export/evidence-package`,
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
          await getApiErrorMessage(response, 'Failed to create evidence export request.'),
        );
      }

      const data = (await response.json()) as CaseEvidenceExportItem;
      setForm(DEFAULT_FORM);
      setMessage(`Export request ${data.packageNo} created and submitted for approval.`);
      await fetchExports(1);
      navigate(`/dashboard/compliance/case-evidence-exports/${data.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to create evidence export request.',
      );
    } finally {
      setCreating(false);
    }
  };

  const downloadPackage = async (id: string) => {
    setDownloading(id);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/evidence-packages/${id}/download`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to download case evidence package.'),
        );
      }

      const data = (await response.json()) as DownloadResponse;
      const content = JSON.stringify(data.content, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.fileName || `${data.packageNo}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);

      setMessage(`Downloaded ${data.packageNo}. Digest: ${data.digest}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to download case evidence package.',
      );
    } finally {
      setDownloading(null);
    }
  };

  useEffect(() => {
    void fetchExports(1);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Compliance Center - Case Evidence Exports
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Create case-scoped evidence packages gated by approval before download.
          </p>
        </div>
        <button
          onClick={() => void fetchExports(currentPage)}
          className="p-2 text-gray-500 hover:text-brand-primary"
          title="Refresh"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {canCreate && (
        <div className="rounded-xl border border-admin-border bg-white p-4 shadow-sm space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New Export Request</h2>
            <p className="mt-1 text-sm text-gray-500">
              At least one filter or selected case id is required. Approval must pass before
              download becomes available.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="border border-admin-border rounded px-3 py-2 text-sm bg-gray-50 text-gray-700">
              Workflow: ONBOARDING
            </div>
            <select
              className="border border-admin-border rounded px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  status: e.target.value as CreateFormState['status'],
                }))
              }
            >
              <option value="">All case status</option>
              <option value="OPEN">OPEN</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
            <input
              className="border border-admin-border rounded px-3 py-2 text-sm"
              placeholder="Assignee user id"
              value={form.assigneeUserId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, assigneeUserId: e.target.value }))
              }
            />
            <label className="text-sm text-gray-700">
              <span className="mb-1 block">Period From</span>
              <input
                type="datetime-local"
                className="w-full border border-admin-border rounded px-3 py-2 text-sm"
                value={form.periodFrom}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, periodFrom: e.target.value }))
                }
              />
            </label>
            <label className="text-sm text-gray-700">
              <span className="mb-1 block">Period To</span>
              <input
                type="datetime-local"
                className="w-full border border-admin-border rounded px-3 py-2 text-sm"
                value={form.periodTo}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, periodTo: e.target.value }))
                }
              />
            </label>
            <textarea
              className="border border-admin-border rounded px-3 py-2 text-sm min-h-[96px] xl:col-span-1"
              placeholder="Selected case ids, separated by comma or whitespace"
              value={form.selectedCaseIds}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, selectedCaseIds: e.target.value }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleCreate()}
              disabled={creating || !hasFilters}
              className="px-3 py-2 rounded bg-brand-primary text-white text-sm hover:opacity-90 disabled:opacity-60"
            >
              {creating ? 'Submitting...' : 'Create Export Request'}
            </button>
            <button
              onClick={() => setForm(DEFAULT_FORM)}
              disabled={creating || !hasFilters}
              className="px-3 py-2 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-admin-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-admin-border bg-admin-content-bg">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Package No</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Approval</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Created At</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Exporter</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Items</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Digest</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Operation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No case evidence exports found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          navigate(`/dashboard/compliance/case-evidence-exports/${item.id}`)
                        }
                        className="font-mono text-xs text-brand-primary hover:underline"
                      >
                        {item.packageNo}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.status}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.approvalCase?.status || '-'}</div>
                      <div className="text-xs text-gray-500">
                        {item.approvalCase?.approvalNo || item.approvalCaseId || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium text-gray-900">{item.exportedById}</div>
                      <div className="text-xs text-gray-500">
                        {item.exportedByRole || item.exportedByType}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.itemCount}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.digest || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() =>
                            navigate(`/dashboard/compliance/case-evidence-exports/${item.id}`)
                          }
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          View
                        </button>
                        <button
                          onClick={() => void downloadPackage(item.id)}
                          disabled={item.status !== 'READY' || downloading === item.id}
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline disabled:opacity-60"
                        >
                          <Download size={14} />
                          {downloading === item.id
                            ? 'Downloading...'
                            : item.status === 'READY'
                              ? 'Download'
                              : 'Waiting Approval'}
                        </button>
                      </div>
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
            onPageChange={(page) => void fetchExports(page)}
          />
        </div>
      </div>
    </div>
  );
};

export default CaseEvidenceExportsPage;

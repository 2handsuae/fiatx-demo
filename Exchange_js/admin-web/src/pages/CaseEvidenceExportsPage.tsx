import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

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
  exportedByNo?: string | null;
  exportedByRole?: string | null;
  approvalCase?: {
    id: string;
    approvalNo?: string | null;
    status: string;
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
  status: '' | 'OPEN' | 'ASSIGNED' | 'CLOSED';
  assigneeUserId: string;
  periodFrom: string;
  periodTo: string;
  selectedCaseIds: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FORM: CreateFormState = {
  status: '',
  assigneeUserId: '',
  periodFrom: '',
  periodTo: '',
  selectedCaseIds: '',
};

/* ─────────────────────────────────────────────────────────────── */

const CaseEvidenceExportsPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const canCreate   = hasPermission(PERMISSIONS.CASE_EVIDENCE_EXPORT_CREATE);
  const canDownload = hasPermission(PERMISSIONS.CASE_EVIDENCE_EXPORT_DOWNLOAD);

  const [items,        setItems]       = useState<CaseEvidenceExportItem[]>([]);
  const [total,        setTotal]       = useState(0);
  const [currentPage,  setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading,      setLoading]     = useState(true);
  const [downloading,  setDownloading] = useState<string | null>(null);
  const [error,        setError]       = useState<string | null>(null);
  const [notice,       setNotice]      = useState<string | null>(null);

  /* Create modal */
  const [isCreateOpen,  setIsCreateOpen]  = useState(false);
  const [form,          setForm]          = useState<CreateFormState>(DEFAULT_FORM);
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState<string | null>(null);

  /* ── Data fetching ── */

  const fetchExports = async (page: number, status = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (status) params.set('status', status);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/evidence-packages?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load evidence packages.'));

      const data = (await res.json()) as CaseEvidenceExportListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load evidence packages.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchExports(1); }, []);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Download ── */

  const downloadPackage = async (item: CaseEvidenceExportItem) => {
    setDownloading(item.id);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/evidence-packages/${item.id}/download`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Download failed.'));

      const data = (await res.json()) as DownloadResponse;
      const blob = new Blob([JSON.stringify(data.content, null, 2)], { type: 'application/json' });
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = data.fileName || `${data.packageNo}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setNotice(`Downloaded ${data.packageNo} — digest: ${data.digest}`);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot download this package.');
      } else {
        setError(err instanceof Error ? err.message : 'Download failed.');
      }
    } finally {
      setDownloading(null);
    }
  };

  /* ── Create export request ── */

  const openCreateModal = () => {
    setForm(DEFAULT_FORM);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setForm(DEFAULT_FORM);
    setCreateError(null);
  };

  const submitCreate = async () => {
    const hasFilters =
      !!form.status || !!form.assigneeUserId.trim() ||
      !!form.periodFrom || !!form.periodTo || !!form.selectedCaseIds.trim();
    if (!hasFilters) { setCreateError('At least one filter or case ID is required.'); return; }

    setCreating(true); setCreateError(null);
    try {
      const payload: Record<string, unknown> = { caseType: 'ONBOARDING' };
      if (form.status) payload.status = form.status;
      if (form.assigneeUserId.trim()) payload.assigneeUserId = form.assigneeUserId.trim();
      if (form.periodFrom) payload.periodFrom = new Date(form.periodFrom).toISOString();
      if (form.periodTo)   payload.periodTo   = new Date(form.periodTo).toISOString();
      const ids = form.selectedCaseIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) payload.selectedCaseIds = ids;

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/export/evidence-package`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to create export request.'));

      const data = (await res.json()) as CaseEvidenceExportItem;
      closeCreateModal();
      setNotice(`Export request ${data.packageNo} created and submitted for approval.`);
      await fetchExports(1);
      navigate(`/dashboard/compliance/case-evidence-exports/${data.id}`);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setCreateError('Permission denied. You cannot submit export requests.');
      } else {
        setCreateError(err instanceof Error ? err.message : 'Failed to create export request.');
      }
    } finally {
      setCreating(false);
    }
  };

  /* ── Input style (matches PlatformMembers fi) ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!statusFilter;

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Case Evidence Exports"
        meta={`${total} package${total === 1 ? '' : 's'} · Compliance Center`}
      >
        {canCreate && (
          <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
            <Plus size={13} />
            New Export Request
          </button>
        )}
        <button
          onClick={() => void fetchExports(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="READY">READY</option>
          <option value="FAILED">FAILED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
        </select>
        <button
          onClick={() => void fetchExports(1, statusFilter)}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button
          onClick={() => { setStatusFilter(''); void fetchExports(1, ''); }}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {/* ── Notices ── */}
      {notice && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green">
          {notice}
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Package No',  '180px'],
                  ['Status',      '130px'],
                  ['Approval',    '180px'],
                  ['Items',       '72px'],
                  ['Exporter',    '160px'],
                  ['Created',     'auto'],
                  ['',            '120px'],
                ] as [string, string][]
              ).map(([label, w], i) => (
                <th
                  key={`${label}-${i}`}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No evidence packages found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/compliance/case-evidence-exports/${item.id}`)}
              >
                {/* Package No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.packageNo}
                  </span>
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Approval */}
                <td className="px-4 py-2.5">
                  {item.approvalCase ? (
                    <div className="flex flex-col gap-0.5">
                      <AdminBadge value={item.approvalCase.status} />
                      {item.approvalCase.approvalNo && (
                        <span className="font-mono text-[9px] text-adm-t3 whitespace-nowrap">
                          {item.approvalCase.approvalNo}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-adm-t3">—</span>
                  )}
                </td>

                {/* Items */}
                <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                  {item.itemCount}
                </td>

                {/* Exporter */}
                <td className="px-4 py-2.5">
                  <div className="font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                    {item.exportedByNo ?? item.exportedById}
                  </div>
                  {item.exportedByRole && (
                    <div className="font-mono text-[9px] text-adm-t3">{item.exportedByRole}</div>
                  )}
                </td>

                {/* Created */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>

                {/* Download action */}
                <td
                  className="px-4 py-2.5 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.status === 'READY' && canDownload && (
                    <button
                      onClick={() => void downloadPackage(item)}
                      disabled={downloading === item.id}
                      className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-adm-t3 transition-colors hover:text-adm-t2 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Download size={12} />
                      {downloading === item.id ? 'Downloading…' : 'Download'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} package${total === 1 ? '' : 's'}`
              : 'No packages'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchExports(page)}
            />
          )}
        </div>
      </div>

      {/* ════ Create Export Modal ════ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  New Export Request
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  At least one filter or case ID required. Download is gated by approval.
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">

              {/* Case Type (fixed) */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Case Type
                </p>
                <div className="flex h-[32px] items-center rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t3">
                  ONBOARDING (fixed)
                </div>
              </div>

              {/* Case Status */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Case Status Filter
                </p>
                <select
                  value={form.status}
                  onChange={(e) => setForm(prev => ({ ...prev, status: e.target.value as CreateFormState['status'] }))}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
                >
                  <option value="">All case statuses</option>
                  <option value="OPEN">OPEN</option>
                  <option value="ASSIGNED">ASSIGNED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>

              {/* Assignee User ID */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Assignee User ID
                </p>
                <input
                  value={form.assigneeUserId}
                  onChange={(e) => setForm(prev => ({ ...prev, assigneeUserId: e.target.value }))}
                  type="text"
                  placeholder="UUID of assignee (optional)"
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Period From / To */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                    Period From
                  </p>
                  <input
                    value={form.periodFrom}
                    onChange={(e) => setForm(prev => ({ ...prev, periodFrom: e.target.value }))}
                    type="datetime-local"
                    className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
                  />
                </div>
                <div>
                  <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                    Period To
                  </p>
                  <input
                    value={form.periodTo}
                    onChange={(e) => setForm(prev => ({ ...prev, periodTo: e.target.value }))}
                    type="datetime-local"
                    className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
                  />
                </div>
              </div>

              {/* Selected Case IDs */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Selected Case IDs
                </p>
                <textarea
                  value={form.selectedCaseIds}
                  onChange={(e) => setForm(prev => ({ ...prev, selectedCaseIds: e.target.value }))}
                  rows={3}
                  placeholder="Paste case UUIDs, comma or space separated (optional)"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors resize-none"
                />
              </div>

              {createError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {createError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitCreate()}
                disabled={creating}
                className={adminButtonClass('modalConfirm')}
              >
                {creating ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default CaseEvidenceExportsPage;

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, RefreshCw, Search } from 'lucide-react';
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

interface EvidenceExportItem {
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

interface EvidenceExportListResponse {
  total: number;
  skip: number;
  take: number;
  items: EvidenceExportItem[];
}

interface DownloadResponse {
  id: string;
  packageNo: string;
  fileName: string;
  digest: string;
  content: unknown;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

/* ─────────────────────────────────────────────────────────────── */

const EvidenceExportsPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const canDownload = hasPermission(PERMISSIONS.AUDIT_EVIDENCE_EXPORT_DOWNLOAD);

  const [items,        setItems]       = useState<EvidenceExportItem[]>([]);
  const [total,        setTotal]       = useState(0);
  const [currentPage,  setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading,      setLoading]     = useState(true);
  const [downloading,  setDownloading] = useState<string | null>(null);
  const [error,        setError]       = useState<string | null>(null);
  const [notice,       setNotice]      = useState<string | null>(null);

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
        `${import.meta.env.VITE_API_URL}/admin/audit/evidence-packages?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load evidence packages.'));

      const data = (await res.json()) as EvidenceExportListResponse;
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

  const downloadPackage = async (item: EvidenceExportItem) => {
    setDownloading(item.id);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit/evidence-packages/${item.id}/download`,
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

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!statusFilter;

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Evidence Packages"
        meta={`${total} package${total === 1 ? '' : 's'} · Audit Center`}
      >
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
                  ['Package No',      '180px'],
                  ['Status',          '130px'],
                  ['Approval No',     '160px'],
                  ['Approval Status', '130px'],
                  ['Items',           '72px'],
                  ['Exporter',        '160px'],
                  ['Created',         'auto'],
                  ['',                '120px'],
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
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No evidence packages found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/audit/evidence-packages/${item.id}`)}
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

                {/* Approval No */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.approvalCase?.approvalNo ?? '—'}
                </td>

                {/* Approval Status */}
                <td className="px-4 py-2.5">
                  {item.approvalCase
                    ? <AdminBadge value={item.approvalCase.status} />
                    : <span className="font-mono text-[11px] text-adm-t3">—</span>
                  }
                </td>

                {/* Items */}
                <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                  {item.itemCount}
                </td>

                {/* Exporter */}
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.exportedByNo ?? item.exportedByRole ?? item.exportedByType}
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
      {total > PAGE_SIZE ? (
        <div className="shrink-0">
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => void fetchExports(page)}
          />
        </div>
      ) : (
        <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} package${total === 1 ? '' : 's'}`
              : 'No packages'}
          </span>
        </div>
      )}

    </div>
  );
};

export default EvidenceExportsPage;

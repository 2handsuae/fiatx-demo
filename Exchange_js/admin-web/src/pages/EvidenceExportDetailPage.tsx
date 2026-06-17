import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Download, RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  DetailPageHeader,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface EvidenceExportDetail {
  id: string;
  packageNo: string;
  approvalCaseId?: string | null;
  approvalCaseNo?: string | null;
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
    actionType: string;
    entityRef: string;
    status: string;
    traceId?: string | null;
    decisionByRole?: string | null;
    decidedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  filterSnapshot?: unknown;
  selectedEventIdsSnapshot?: string[];
  manifest?: unknown;
  packageBody?: unknown;
  createdAt: string;
  updatedAt: string;
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

/* ── Shared layout primitives ────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

/* ── Sidebar primitives ──────────────────────────────────────── */

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Raw Record Block ──────────────────────────────────────────── */

const RawRecordBlock = ({ detail }: { detail: EvidenceExportDetail }) => {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(detail, null, 2);

  const handleCopy = () => {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="px-6 py-5">
      <div className="flex items-center justify-between">
        <Cap>Raw Record</Cap>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded border border-adm-border bg-adm-card px-2 py-1 font-mono text-[9px] text-adm-t3 transition-colors hover:border-adm-amber hover:text-adm-amber"
        >
          {copied
            ? <><Check size={10} /><span>Copied</span></>
            : <><Copy size={10} /><span>Copy</span></>
          }
        </button>
      </div>
      <pre className="mt-2 overflow-auto rounded bg-gray-950 p-4 font-mono text-[11px] leading-relaxed text-gray-200 border border-gray-800">
        {json}
      </pre>
    </section>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const EvidenceExportDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const canDownload = hasPermission(PERMISSIONS.AUDIT_EVIDENCE_EXPORT_DOWNLOAD);

  const [detail,      setDetail]      = useState<EvidenceExportDetail | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [notice,      setNotice]      = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadSeqRef = useRef(0);

  /* ── Fetching ── */

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await adminFetch(url, init);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Request failed.'));
    }
    return (await response.json()) as T;
  };

  const fetchDetail = async () => {
    if (!id) { setError('Package ID is required.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const payload = await fetchJson<EvidenceExportDetail>(
        `${import.meta.env.VITE_API_URL}/admin/audit/evidence-packages/${id}`,
      );
      setDetail(payload);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this evidence package.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load evidence package.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(
      () => setNotice((c) => (c === notice ? null : c)),
      4000,
    );
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Download ── */

  const handleDownload = async () => {
    if (!id) return;
    const seq = downloadSeqRef.current + 1;
    downloadSeqRef.current = seq;
    setDownloading(true); setError('');
    try {
      const data = await fetchJson<DownloadResponse>(
        `${import.meta.env.VITE_API_URL}/admin/audit/evidence-packages/${id}/download`,
      );
      if (downloadSeqRef.current !== seq) return;
      const blob = new Blob([JSON.stringify(data.content, null, 2)], { type: 'application/json' });
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = data.fileName || `${data.packageNo}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setNotice(`Downloaded ${data.packageNo} — verify digest: ${data.digest}`);
    } catch (e: unknown) {
      if (downloadSeqRef.current !== seq) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot download this package.');
      } else {
        setError(e instanceof Error ? e.message : 'Download failed.');
      }
    } finally {
      if (downloadSeqRef.current === seq) setDownloading(false);
    }
  };

  /* ── Loading / error stubs ── */

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button onClick={() => navigate('/admin/audit/evidence-packages')} className={adminButtonClass('detailUtility')}>← Back</button>
        </div>
        <div className="flex flex-1 items-center justify-center gap-3">
          <RefreshCw size={22} className="animate-spin text-adm-amber" />
          <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
        </div>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/audit/evidence-packages')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button
            onClick={() => navigate('/admin/audit/evidence-packages')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Package not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const hasSelectionCriteria =
    detail.filterSnapshot != null || (detail.selectedEventIdsSnapshot?.length ?? 0) > 0;
  const hasManifest    = detail.manifest != null;
  const hasPackageBody = detail.packageBody != null;

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/audit/evidence-packages')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Evidence Packages"
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.packageNo}
            </p>
            <div className="mt-4 border-t border-adm-border pt-4 grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Status</p>
                <AdminBadge value={detail.status} />
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Export Mode</p>
                <p className="font-mono text-[11px] text-adm-t2">{detail.exportMode}</p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Item Count</p>
                <p className="font-mono text-[11px] text-adm-t2">{detail.itemCount} events</p>
              </div>
            </div>
          </section>

          {/* ② Package Details */}
          {(detail.fileName || detail.digest) && (
            <section className="px-6 py-5">
              <Cap>Package Details</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field label="File Name"      value={detail.fileName}  mono full />
                  <Field label="SHA-256 Digest" value={detail.digest}    mono full />
                </FieldGrid>
              </div>
            </section>
          )}

          {/* ④ Exporter */}
          <section className="px-6 py-5">
            <Cap>Exporter</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Exported By" value={detail.exportedByNo}                           />
                <Field label="Role"        value={detail.exportedByRole ?? detail.exportedByType} />
              </FieldGrid>
            </div>
          </section>

          {/* ④ Selection Criteria — what filter built this package */}
          {hasSelectionCriteria && (
            <section className="px-6 py-5">
              <Cap>Selection Criteria</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Filter snapshot used to build this evidence package
              </p>

              <div className="rounded border border-adm-border bg-adm-bg p-4 space-y-4">
                {detail.filterSnapshot != null && (
                  <JsonBlock title="Filter Snapshot" value={detail.filterSnapshot} />
                )}

                {(detail.selectedEventIdsSnapshot?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                      Selected Event IDs ({detail.selectedEventIdsSnapshot!.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.selectedEventIdsSnapshot!.map((eid) => (
                        <span
                          key={eid}
                          className="inline-flex items-center rounded border border-adm-border bg-adm-card px-2 py-1 font-mono text-[9px] text-adm-t2"
                        >
                          {eid}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ④ Manifest */}
          {hasManifest && (
            <section className="px-6 py-5">
              <Cap>Manifest</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Table of contents for the evidence package
              </p>
              <div className="rounded border border-adm-border bg-adm-bg p-4">
                <JsonBlock title="Package Manifest" value={detail.manifest} />
              </div>
            </section>
          )}

          {/* ⑤ Package Body */}
          {hasPackageBody && (
            <section className="px-6 py-5">
              <Cap>Package Body</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Full evidence payload — may be large
              </p>
              <div className="rounded border border-adm-border bg-adm-bg p-4">
                <JsonBlock title="Evidence Data" value={detail.packageBody} />
              </div>
            </section>
          )}

          {/* ⑥ Raw Record */}
          <RawRecordBlock detail={detail} />

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {canDownload && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {detail.status === 'READY' ? (
                  <button
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <Download size={13} />
                    {downloading ? 'Downloading…' : 'Download Package'}
                  </button>
                ) : (
                  <p className="rounded border border-adm-border bg-adm-bg px-3 py-2.5 font-mono text-[10px] text-adm-t3">
                    {detail.status === 'PENDING_APPROVAL'
                      ? 'Awaiting approval — download will be available once approved.'
                      : `Package is ${detail.status.toLowerCase()} — download unavailable.`}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Status</span>
              <AdminBadge value={detail.status} />
            </div>
            <SidebarKV label="Export Mode"  value={detail.exportMode}                           />
            <SidebarKV label="Item Count"   value={`${detail.itemCount} events`}           mono />
            <SidebarKV label="Exported By"  value={detail.exportedByNo}                        />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created At" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Updated At" value={fmt(detail.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

    </div>
  );
};

export default EvidenceExportDetailPage;

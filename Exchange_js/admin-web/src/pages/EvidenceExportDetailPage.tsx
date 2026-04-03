import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Download,
  FileJson,
  FileText,
  Link2,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface EvidenceExportDetail {
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
    approvalNo: string;
    actionType: string;
    entityRef: string;
    status: string;
    executionStatus: string;
    traceId?: string | null;
    decisionByUserId?: string | null;
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

type JsonRecord = Record<string, unknown>;

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
};

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getManifestField = (manifest: unknown, key: string): string => {
  if (!isJsonRecord(manifest)) return '-';
  return formatValue(manifest[key]);
};

const summarizeWorkflow = (workflowSummary: unknown): string => {
  if (workflowSummary === null || workflowSummary === undefined) return '-';
  if (typeof workflowSummary === 'string') return workflowSummary.trim() || '-';

  const summarizeRecord = (record: JsonRecord): string => {
    const workflowType = formatValue(record.workflowType);
    const workflowNo = formatValue(record.workflowNo);
    const workflowNos = Array.isArray(record.workflowNos)
      ? record.workflowNos.map((item) => formatValue(item)).filter((item) => item !== '-').join(', ')
      : '';

    if (workflowType !== '-' && workflowNos) return `${workflowType}: ${workflowNos}`;
    if (workflowType !== '-' && workflowNo !== '-') return `${workflowType}: ${workflowNo}`;
    if (workflowNos) return workflowNos;
    return JSON.stringify(record);
  };

  if (Array.isArray(workflowSummary)) {
    const parts = workflowSummary.map((item) =>
      isJsonRecord(item) ? summarizeRecord(item) : formatValue(item),
    );
    const summary = parts.filter((item) => item !== '-').join(' | ');
    return summary || '-';
  }

  if (isJsonRecord(workflowSummary)) {
    return summarizeRecord(workflowSummary);
  }

  return formatValue(workflowSummary);
};

const downloadPackage = async (id: string): Promise<string> => {
  const response = await adminFetch(
    `${import.meta.env.VITE_API_URL}/admin/audit-logs/evidence-packages/${id}/download`,
  );
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Failed to download evidence package.'));
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

  return `Downloaded ${data.packageNo}. Digest: ${data.digest}`;
};

const EvidenceExportDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<EvidenceExportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchDetail = async () => {
    if (!id) {
      setError('Evidence package id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/audit-logs/evidence-packages/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load evidence package detail.'));
      }

      const data = (await response.json()) as EvidenceExportDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load evidence package detail.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!id) return;
    setDownloading(true);
    setError('');
    setMessage('');
    try {
      const nextMessage = await downloadPackage(id);
      setMessage(nextMessage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to download evidence package.');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading evidence package detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/audit/evidence-exports')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Evidence Packages
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/dashboard/audit/evidence-exports')}
          className={adminButtonClass('detailUtility')}
        >
          Back to Evidence Packages
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Evidence package detail not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <DetailPageHeader
        title="Evidence Package Detail"
        subtitle={detail.packageNo}
        onBack={() => navigate('/dashboard/audit/evidence-exports')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Evidence Packages"
      >
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          {detail.status}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          {detail.exportMode}
        </span>
        {detail.approvalCase ? (
          <button
            onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.approvalCase?.id}`)}
            className={adminButtonClass('detailUtility')}
          >
            <Link2 size={16} />
            Open Approval
          </button>
        ) : null}
      </DetailPageHeader>

      {message && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ActionSection
        title="Package Actions"
        description="Download stays in a dedicated action block so the header remains utility-only."
      >
        <button
          onClick={() => void handleDownload()}
          disabled={detail.status !== 'READY' || downloading}
          className={adminButtonClass(
            detail.status === 'READY' ? 'workflowPrimary' : 'workflowSecondary',
          )}
        >
          <Download size={16} />
          {downloading ? 'Downloading...' : detail.status === 'READY' ? 'Download Package' : 'Waiting Approval'}
        </button>
      </ActionSection>

      <DetailCard title="Package Summary" icon={<FileText size={18} />}>
        <InfoField label="Package No" value={detail.packageNo} mono />
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Package Mode" value={detail.exportMode} />
        <InfoField label="File Name" value={detail.fileName} mono />
        <InfoField label="Item Count" value={detail.itemCount} />
      </DetailCard>

      <DetailCard title="Exporter" icon={<User size={18} />}>
        <InfoField label="Exporter Type" value={detail.exportedByType} />
        <InfoField label="Exporter ID" value={detail.exportedById} mono />
        <InfoField label="Exporter Role" value={detail.exportedByRole} />
      </DetailCard>

      <DetailCard title="Lifecycle & Integrity" icon={<ShieldCheck size={18} />}>
        <InfoField label="Digest" value={detail.digest} mono />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
      </DetailCard>

      {detail.approvalCase && (
        <DetailCard title="Approval" icon={<Link2 size={18} />}>
          <InfoField label="Approval No" value={detail.approvalCase.approvalNo} mono />
          <InfoField label="Approval Status" value={detail.approvalCase.status} />
          <InfoField label="Execution Status" value={detail.approvalCase.executionStatus} />
          <InfoField label="Action Type" value={detail.approvalCase.actionType} />
          <InfoField label="Approval ID" value={detail.approvalCase.id} mono />
          <InfoField label="Trace ID" value={detail.approvalCase.traceId} mono />
          <InfoField label="Decided At" value={formatDateTime(detail.approvalCase.decidedAt)} />
          <InfoField label="Decision By User" value={detail.approvalCase.decisionByUserId} mono />
          <InfoField label="Decision By Role" value={detail.approvalCase.decisionByRole} />
        </DetailCard>
      )}

      <DetailCard title="Selection Snapshot" icon={<FileText size={18} />}>
        <InfoField
          label="Selected Event Count"
          value={Array.isArray(detail.selectedEventIdsSnapshot) ? detail.selectedEventIdsSnapshot.length : 0}
        />
        <InfoField label="Selection Type" value="selectedEventIdsSnapshot" />
        <InfoField label="Selection Scope" value="Persisted event id snapshot" />
      </DetailCard>

      <DetailCard title="Filter Snapshot" icon={<FileText size={18} />} columns={1}>
        <JsonBlock title="Filter Snapshot" value={detail.filterSnapshot} />
      </DetailCard>

      <DetailCard title="Manifest Summary" icon={<ShieldCheck size={18} />}>
        <InfoField label="Version" value={getManifestField(detail.manifest, 'version')} />
        <InfoField label="Generated At" value={getManifestField(detail.manifest, 'generatedAt')} />
        <InfoField label="Package Mode" value={getManifestField(detail.manifest, 'exportMode')} />
        <InfoField label="Item Count" value={getManifestField(detail.manifest, 'itemCount')} />
        <InfoField label="Digest Algorithm" value={getManifestField(detail.manifest, 'digestAlgorithm')} />
        <InfoField
          label="Workflow Summary"
          value={isJsonRecord(detail.manifest) ? summarizeWorkflow(detail.manifest.workflowSummary) : '-'}
        />
      </DetailCard>

      <DetailCard title="Package Records" icon={<FileJson size={18} />} columns={2}>
        <JsonBlock title="Selected Event IDs Snapshot" value={detail.selectedEventIdsSnapshot} />
        <JsonBlock title="Manifest" value={detail.manifest} />
        <JsonBlock title="Package Records JSON" value={detail.packageBody} />
      </DetailCard>
    </div>
  );
};

export default EvidenceExportDetailPage;

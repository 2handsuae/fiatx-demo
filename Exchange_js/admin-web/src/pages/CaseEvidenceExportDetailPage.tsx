import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Download,
  FileJson,
  FileText,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface CaseEvidenceExportDetail {
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
  selectedCaseIdsSnapshot?: string[];
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

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const downloadPackage = async (id: string): Promise<string> => {
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

  return `Downloaded ${data.packageNo}. Digest: ${data.digest}`;
};

const CaseEvidenceExportDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CaseEvidenceExportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchDetail = async () => {
    if (!id) {
      setError('Case evidence export id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/evidence-packages/${id}`,
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load case export detail.'),
        );
      }

      const data = (await response.json()) as CaseEvidenceExportDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load case export detail.');
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
      setError(
        e instanceof Error ? e.message : 'Failed to download case evidence package.',
      );
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
        <p className="text-sm text-gray-500">Loading case evidence export detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/compliance/case-evidence-exports')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Case Evidence Exports
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="Case Evidence Export Detail"
        subtitle={detail.packageNo}
        onBack={() => navigate('/dashboard/compliance/case-evidence-exports')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Case Evidence Exports"
      />

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
        title="Export Actions"
        description="Approval-gated case evidence packages use the same dedicated download block."
      >
        <button
          onClick={() => void handleDownload()}
          disabled={detail.status !== 'READY' || downloading}
          className={adminButtonClass(
            detail.status === 'READY' ? 'workflowPrimary' : 'workflowSecondary',
          )}
        >
          <Download size={16} />
          {downloading ? 'Downloading...' : 'Download Package'}
        </button>
      </ActionSection>

      <DetailCard title="Package Summary" icon={<FileText size={18} />} columns={3}>
        <InfoField label="Package No" value={detail.packageNo} mono />
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Mode" value={detail.exportMode} />
        <InfoField label="Item Count" value={detail.itemCount} />
        <InfoField label="Digest" value={detail.digest} mono />
        <InfoField label="File Name" value={detail.fileName} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
      </DetailCard>

      <DetailCard title="Exporter & Approval" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Exporter Id" value={detail.exportedById} />
        <InfoField label="Exporter Role" value={detail.exportedByRole || detail.exportedByType} />
        <InfoField label="Approval Case Id" value={detail.approvalCaseId} mono />
        <InfoField label="Approval No" value={detail.approvalCase?.approvalNo} />
        <InfoField label="Approval Status" value={detail.approvalCase?.status} />
        <InfoField label="Execution Status" value={detail.approvalCase?.executionStatus} />
        <InfoField label="Decision By" value={detail.approvalCase?.decisionByUserId} />
        <InfoField label="Decision Role" value={detail.approvalCase?.decisionByRole} />
        <InfoField
          label="Decided At"
          value={formatDateTime(detail.approvalCase?.decidedAt)}
        />
      </DetailCard>

      <DetailCard title="Selection Snapshot" icon={<User size={18} />} columns={2}>
        <JsonBlock title="Filter Snapshot" value={detail.filterSnapshot} />
        <JsonBlock
          title="Selected Case Ids Snapshot"
          value={detail.selectedCaseIdsSnapshot || []}
        />
      </DetailCard>

      <DetailCard title="Manifest" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="Manifest JSON" value={detail.manifest} />
      </DetailCard>

      <DetailCard title="Package Body" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="Package Body JSON" value={detail.packageBody} />
      </DetailCard>
    </div>
  );
};

export default CaseEvidenceExportDetailPage;

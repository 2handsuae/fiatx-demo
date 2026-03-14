import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Clock3,
  FileJson,
  FileText,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
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

interface AuditSubjectNo {
  id: string;
  subjectRole: string;
  subjectType: string;
  subjectId?: string | null;
  subjectNo: string;
  occurredAt: string;
}

interface AuditLogDetail {
  id: string;
  auditNo: string;
  triggerType: TriggerType;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  actorRole?: string | null;
  result: AuditResult;
  reason?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  occurredAt: string;
  traceId?: string | null;
  workflowType?: string | null;
  workflowId?: string | null;
  workflowNo?: string | null;
  requestId?: string | null;
  sourceIp?: string | null;
  sourcePlatform?: string | null;
  metadata?: unknown;
  beforeData?: unknown;
  afterData?: unknown;
  payloadDigest?: string | null;
  maskVersion?: string | null;
  retainedUntil?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  subjectNos?: AuditSubjectNo[];
}

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

const formatValue = (value?: string | null): string => {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  return String(value);
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

const DetailCard = ({
  title,
  icon,
  children,
  columns = 3,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) => {
  const gridClassName =
    columns === 1
      ? 'grid grid-cols-1 gap-4'
      : columns === 2
        ? 'grid grid-cols-1 gap-4 md:grid-cols-2'
        : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-brand-primary">{icon}</div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      <div className={gridClassName}>{children}</div>
    </div>
  );
};

const InfoField = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) => (
  <div className="min-w-0">
    <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    <div className={`mt-1 break-all text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>
      {formatValue(value)}
    </div>
  </div>
);

const JsonBlock = ({ title, value }: { title: string; value: unknown }) => (
  <div className="min-w-0">
    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">{title}</div>
    <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
      {toPrettyJson(value)}
    </pre>
  </div>
);

const AuditLogDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) {
      setError('Audit log id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/audit-logs/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load audit log detail.'));
      }

      const data = (await response.json()) as AuditLogDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load audit log detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading audit log detail...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/audit/audit-logs')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to Audit Log
          </button>
          <button
            onClick={() => void fetchDetail()}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
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
          onClick={() => navigate('/dashboard/audit/audit-logs')}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to Audit Log
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Audit log detail not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 rounded-xl border border-admin-border bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/dashboard/audit/audit-logs')}
            className="mt-1 inline-flex items-center justify-center rounded-lg border border-admin-border p-2 text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Audit Log Detail</h1>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusClassName(detail.result)}`}
              >
                {detail.result}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {detail.triggerType}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="font-mono text-brand-primary">{detail.auditNo}</span>
              <span>{detail.action}</span>
              <span>{formatDateTime(detail.occurredAt)}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => void fetchDetail()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <DetailCard title="Event Summary" icon={<FileText size={18} />}>
        <InfoField label="Audit No" value={detail.auditNo} mono />
        <InfoField label="Action" value={detail.action} />
        <InfoField label="Result" value={detail.result} />
        <InfoField label="Trigger Type" value={detail.triggerType} />
        <InfoField label="Occurred At" value={formatDateTime(detail.occurredAt)} />
        <InfoField label="Module" value={detail.module} />
      </DetailCard>

      <DetailCard title="Trace & Workflow" icon={<GitBranch size={18} />}>
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Workflow Type" value={detail.workflowType} />
        <InfoField label="Workflow No" value={detail.workflowNo} mono />
        <InfoField label="Workflow ID" value={detail.workflowId} mono />
        <InfoField label="Request ID" value={detail.requestId} mono />
      </DetailCard>

      <DetailCard title="Entity & Actor" icon={<User size={18} />}>
        <InfoField label="Entity Type" value={detail.entityType} />
        <InfoField label="Entity ID" value={detail.entityId} mono />
        <InfoField label="Entity No" value={detail.entityNo} mono />
        <InfoField label="Entity Owner Type" value={detail.entityOwnerType} />
        <InfoField label="Entity Owner ID" value={detail.entityOwnerId} mono />
        <InfoField label="Entity Owner No" value={detail.entityOwnerNo} mono />
        <InfoField label="Actor Type" value={detail.actorType} />
        <InfoField label="Actor ID" value={detail.actorId} mono />
        <InfoField label="Actor No" value={detail.actorNo} mono />
        <InfoField label="Actor Role" value={detail.actorRole} />
      </DetailCard>

      <DetailCard title="State & Reason" icon={<ShieldCheck size={18} />}>
        <InfoField label="Status From" value={detail.statusFrom} />
        <InfoField label="Status To" value={detail.statusTo} />
        <InfoField label="Reason" value={detail.reason} />
        <InfoField label="Source Platform" value={detail.sourcePlatform} />
        <InfoField label="Source IP" value={detail.sourceIp} mono />
      </DetailCard>

      <DetailCard title="Subject Nos" icon={<FileText size={18} />} columns={1}>
        {detail.subjectNos && detail.subjectNos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {detail.subjectNos.map((subject) => (
              <span
                key={subject.id}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                {subject.subjectRole} / {subject.subjectType} / {subject.subjectNo}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No subject numbers attached.</div>
        )}
      </DetailCard>

      <DetailCard title="Retention & Integrity" icon={<Clock3 size={18} />}>
        <InfoField label="Payload Digest" value={detail.payloadDigest} mono />
        <InfoField label="Mask Version" value={detail.maskVersion} />
        <InfoField label="Retained Until" value={formatDateTime(detail.retainedUntil)} />
        <InfoField label="Archived At" value={formatDateTime(detail.archivedAt)} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
      </DetailCard>

      <DetailCard title="Payload Blocks" icon={<FileJson size={18} />} columns={1}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <JsonBlock title="Metadata" value={detail.metadata} />
          <JsonBlock title="Before Data" value={detail.beforeData} />
          <JsonBlock title="After Data" value={detail.afterData} />
        </div>
      </DetailCard>
    </div>
  );
};

export default AuditLogDetailPage;

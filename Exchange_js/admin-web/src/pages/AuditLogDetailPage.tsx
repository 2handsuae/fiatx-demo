import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Clock3,
  FileJson,
  FileText,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';

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
            className={adminButtonClass('detailUtility')}
          >
            Back to Audit Log
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
          onClick={() => navigate('/dashboard/audit/audit-logs')}
          className={adminButtonClass('detailUtility')}
        >
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
      <DetailPageHeader
        title="Audit Log Detail"
        subtitle={detail.auditNo}
        onBack={() => navigate('/dashboard/audit/audit-logs')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Audit Logs"
      >
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusClassName(detail.result)}`}
        >
          {detail.result}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          {detail.triggerType}
        </span>
      </DetailPageHeader>

      <DetailCard title="Workflow Summary" icon={<FileText size={18} />}>
        <InfoField label="Audit No" value={detail.auditNo} mono />
        <InfoField
          label="Business Workflow"
          value={detail.businessWorkflowLabel || detail.businessWorkflow}
        />
        <InfoField label="Primary Ref No" value={detail.primaryRefNo} mono />
        <InfoField label="User Action" value={detail.userActionLabel || detail.userAction} />
        <InfoField label="Occurred At" value={formatDateTime(detail.occurredAt)} />
        <InfoField label="Result" value={detail.result} />
      </DetailCard>

      <DetailCard title="Technical Context" icon={<GitBranch size={18} />}>
        <InfoField label="Action" value={detail.action} />
        <InfoField label="Trigger Type" value={detail.triggerType} />
        <InfoField label="Module" value={detail.module} />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Workflow Type" value={detail.workflowType} />
        <InfoField label="Workflow No" value={detail.workflowNo} mono />
        <InfoField label="Workflow ID" value={detail.workflowId} mono />
        <InfoField label="Request ID" value={detail.requestId} mono />
      </DetailCard>

      <DetailCard title="Entity" icon={<FileText size={18} />}>
        <InfoField label="Entity Type" value={detail.entityType} />
        <InfoField label="Entity ID" value={detail.entityId} mono />
        <InfoField label="Entity No" value={detail.entityNo} mono />
        <InfoField label="Entity Owner Type" value={detail.entityOwnerType} />
        <InfoField label="Entity Owner ID" value={detail.entityOwnerId} mono />
        <InfoField label="Entity Owner No" value={detail.entityOwnerNo} mono />
      </DetailCard>

      <DetailCard title="Actor" icon={<User size={18} />}>
        <InfoField label="Actor Type" value={detail.actorType} />
        <InfoField label="Actor ID" value={detail.actorId} mono />
        <InfoField label="Actor No" value={detail.actorNo} mono />
        <InfoField label="Actor Role" value={detail.actorRole} />
      </DetailCard>

      <DetailCard title="State & Outcome" icon={<ShieldCheck size={18} />}>
        <InfoField label="Status From" value={detail.statusFrom} />
        <InfoField label="Status To" value={detail.statusTo} />
        <InfoField label="Result" value={detail.result} />
        <InfoField label="Reason" value={detail.reason} />
      </DetailCard>

      <DetailCard title="Source Context" icon={<Clock3 size={18} />}>
        <InfoField label="Source Platform" value={detail.sourcePlatform} />
        <InfoField label="Source IP" value={detail.sourceIp} mono />
      </DetailCard>

      <DetailCard title="Retention & Integrity" icon={<Clock3 size={18} />}>
        <InfoField label="Payload Digest" value={detail.payloadDigest} mono />
        <InfoField label="Mask Version" value={detail.maskVersion} />
        <InfoField label="Retained Until" value={formatDateTime(detail.retainedUntil)} />
        <InfoField label="Archived At" value={formatDateTime(detail.archivedAt)} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
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

      <DetailCard title="Payload" icon={<FileJson size={18} />} columns={1}>
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

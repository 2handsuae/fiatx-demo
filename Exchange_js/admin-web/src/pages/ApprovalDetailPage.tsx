import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileJson,
  Link2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface ApprovalDetail {
  id: string;
  approvalNo: string;
  actionType: string;
  entityRef: string;
  makerUserId: string;
  status: string;
  executionStatus: string;
  riskLevel: string;
  checkerRoles: string[];
  selectedCheckerRole?: string | null;
  allowCancel: boolean;
  allowRetry: boolean;
  docRef?: string | null;
  metadata?: Record<string, unknown>;
  traceId: string;
  submittedAt?: string | null;
  timeoutAt?: string | null;
  decidedAt?: string | null;
  executedAt?: string | null;
  decisionByUserId?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  step?: {
    id: string;
    stepNo: number;
    status: string;
    checkerRoleCandidates: string[];
    decidedByUserId?: string | null;
    decidedByRole?: string | null;
    reason?: string | null;
    decidedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  evidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
  availableDecisionRoles: string[];
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
}

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

const toPrettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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
  value: unknown;
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

const ApprovalDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [checkerRole, setCheckerRole] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canDecide = hasAnyPermission([
    PERMISSIONS.GOV_APPROVAL_APPROVE,
    PERMISSIONS.GOV_APPROVAL_REJECT,
  ]);
  const canCancelPermission = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_CANCEL]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Approval id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load approval detail.'));
      }

      const data = (await response.json()) as ApprovalDetail;
      setDetail(data);
      setCheckerRole(
        data.availableDecisionRoles.length === 1 ? data.availableDecisionRoles[0] : '',
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load approval detail.');
    } finally {
      setLoading(false);
    }
  };

  const submitAction = async (action: 'approve' | 'reject' | 'cancel') => {
    if (!id) return;

    setSubmittingAction(action);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {};
      if (reason.trim()) payload.reason = reason.trim();
      if (action !== 'cancel' && checkerRole) payload.checkerRole = checkerRole;

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals/${id}/${action}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${action} approval.`));
      }

      setMessage(`Approval ${detail?.approvalNo || id} ${action}d successfully.`);
      setReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to ${action} approval.`);
    } finally {
      setSubmittingAction(null);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading approval detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/control-gates/approvals')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to Approvals
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
          onClick={() => navigate('/dashboard/control-gates/approvals')}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to Approvals
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Approval detail not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 rounded-xl border border-admin-border bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/dashboard/control-gates/approvals')}
            className="mt-1 inline-flex items-center justify-center rounded-lg border border-admin-border p-2 text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Approval Detail</h1>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                {detail.status}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {detail.executionStatus}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="font-mono text-brand-primary">{detail.approvalNo}</span>
              <span>{detail.actionType}</span>
              <span>{formatDateTime(detail.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void fetchDetail()}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {detail.actionType === 'SENSITIVE_EXPORT_APPROVAL' && detail.evidencePackage && (
            <button
              onClick={() => navigate(`/dashboard/audit/evidence-exports/${detail.evidencePackage?.id}`)}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Link2 size={16} />
              Open Evidence Export
            </button>
          )}
        </div>
      </div>

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

      <DetailCard title="Summary" icon={<ShieldCheck size={18} />}>
        <InfoField label="Approval No" value={detail.approvalNo} mono />
        <InfoField label="Action Type" value={detail.actionType} />
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Execution Status" value={detail.executionStatus} />
        <InfoField label="Maker User ID" value={detail.makerUserId} mono />
        <InfoField label="Risk Level" value={detail.riskLevel} />
      </DetailCard>

      <DetailCard title="Policy & Checker" icon={<UserCheck size={18} />}>
        <InfoField label="Checker Roles" value={detail.checkerRoles.join(', ')} />
        <InfoField label="Selected Checker Role" value={detail.selectedCheckerRole} />
        <InfoField label="Available Decision Roles" value={detail.availableDecisionRoles.join(', ')} />
        <InfoField label="Allow Cancel" value={detail.allowCancel ? 'YES' : 'NO'} />
        <InfoField label="Allow Retry" value={detail.allowRetry ? 'YES' : 'NO'} />
        <InfoField label="Doc Ref" value={detail.docRef} mono />
      </DetailCard>

      <DetailCard title="Trace & Entity" icon={<Link2 size={18} />}>
        <InfoField label="Approval ID" value={detail.id} mono />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Entity Ref" value={detail.entityRef} mono />
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Timeout At" value={formatDateTime(detail.timeoutAt)} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
      </DetailCard>

      <DetailCard title="Decision & Execution" icon={<CheckCircle2 size={18} />}>
        <InfoField label="Decision By User ID" value={detail.decisionByUserId} mono />
        <InfoField label="Decision By Role" value={detail.decisionByRole} />
        <InfoField label="Decision Reason" value={detail.decisionReason} />
        <InfoField label="Decided At" value={formatDateTime(detail.decidedAt)} />
        <InfoField label="Executed At" value={formatDateTime(detail.executedAt)} />
      </DetailCard>

      <DetailCard title="Step" icon={<XCircle size={18} />}>
        <InfoField label="Step No" value={detail.step?.stepNo} />
        <InfoField label="Step Status" value={detail.step?.status} />
        <InfoField label="Checker Role Candidates" value={detail.step?.checkerRoleCandidates.join(', ')} />
        <InfoField label="Step Decided By" value={detail.step?.decidedByUserId} mono />
        <InfoField label="Step Decided Role" value={detail.step?.decidedByRole} />
        <InfoField label="Step Reason" value={detail.step?.reason} />
      </DetailCard>

      {detail.evidencePackage && (
        <DetailCard title="Linked Evidence Export" icon={<Link2 size={18} />}>
          <InfoField label="Package ID" value={detail.evidencePackage.id} mono />
          <InfoField label="Package No" value={detail.evidencePackage.packageNo} />
          <InfoField label="Package Status" value={detail.evidencePackage.status} />
        </DetailCard>
      )}

      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="text-brand-primary">
            <ShieldCheck size={18} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Approval Actions</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Checker Role</div>
            <select
              value={checkerRole}
              onChange={(e) => setCheckerRole(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              disabled={detail.availableDecisionRoles.length <= 1}
            >
              <option value="">Auto select</option>
              {detail.availableDecisionRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Reason</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Optional approval note"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => void submitAction('approve')}
            disabled={!detail.canApprove || !canDecide || submittingAction !== null}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submittingAction === 'approve' ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={() => void submitAction('reject')}
            disabled={!detail.canReject || !canDecide || submittingAction !== null}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submittingAction === 'reject' ? 'Rejecting...' : 'Reject'}
          </button>
          <button
            onClick={() => void submitAction('cancel')}
            disabled={!detail.canCancel || !canCancelPermission || submittingAction !== null}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          >
            {submittingAction === 'cancel' ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      </div>

      <DetailCard title="Metadata" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="metadata" value={detail.metadata || {}} />
      </DetailCard>
    </div>
  );
};

export default ApprovalDetailPage;

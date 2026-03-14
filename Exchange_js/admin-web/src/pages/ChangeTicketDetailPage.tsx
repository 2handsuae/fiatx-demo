import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Link2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface ChangeTicketDetail {
  id: string;
  ticketNo: string;
  status: string;
  changeType: string | null;
  scopeSummary: string | null;
  riskLevel: string;
  testEvidenceRef: string | null;
  rollbackPlanRef: string | null;
  latestApprovalId: string | null;
  latestApprovalNo: string | null;
  latestApprovalStatus: string | null;
  traceId: string;
  emergency: boolean;
  emergencyReason: string | null;
  postApprovalDueAt: string | null;
  postApprovalCompletedAt: string | null;
  createdByUserId: string;
  submittedByUserId: string | null;
  closedByUserId: string | null;
  submittedAt: string | null;
  deployedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GateRunItem {
  id: string;
  ticketId: string;
  targetEnv: string;
  releaseVersion: string;
  status: string;
  reason: string | null;
  failureReason: string | null;
  operatorUserId: string;
  traceId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const RELEASE_ENV_OPTIONS = ['DEV', 'UAT', 'PROD'];

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

const ChangeTicketDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<ChangeTicketDetail | null>(null);
  const [gateRuns, setGateRuns] = useState<GateRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [targetEnv, setTargetEnv] = useState('UAT');
  const [releaseVersion, setReleaseVersion] = useState('');

  const canSubmit = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_SUBMIT]);
  const canResubmit = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_RESUBMIT]);
  const canGate = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_GATE_CHECK]);
  const canDeploy = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_DEPLOY_STATUS]);
  const canClose = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_CLOSE]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Change ticket id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [detailResponse, gateRunsResponse] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/gate-runs`),
      ]);

      if (!detailResponse.ok) {
        throw new Error(await getApiErrorMessage(detailResponse, 'Failed to load change ticket.'));
      }
      if (!gateRunsResponse.ok) {
        throw new Error(await getApiErrorMessage(gateRunsResponse, 'Failed to load gate runs.'));
      }

      const detailData = (await detailResponse.json()) as ChangeTicketDetail;
      const gateRunData = (await gateRunsResponse.json()) as GateRunItem[];
      setDetail(detailData);
      setGateRuns(Array.isArray(gateRunData) ? gateRunData : []);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load change ticket detail.');
    } finally {
      setLoading(false);
    }
  };

  const submitSimpleAction = async (path: string, successMessage: string) => {
    if (!id) return;
    setSubmittingAction(path);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {};
      if (reason.trim()) payload.reason = reason.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${path} change ticket.`));
      }

      setMessage(successMessage);
      setReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to ${path} change ticket.`);
    } finally {
      setSubmittingAction(null);
    }
  };

  const runGateCheck = async () => {
    if (!id) return;
    setSubmittingAction('gate-checks');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/gate-checks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetEnv,
            releaseVersion: releaseVersion.trim(),
            reason: reason.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to run gate check.'));
      }

      setMessage(`Gate check for ${targetEnv}/${releaseVersion.trim()} completed.`);
      setReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to run gate check.');
    } finally {
      setSubmittingAction(null);
    }
  };

  const markDeployStatus = async (deployStatus: 'DEPLOYED' | 'DEPLOY_FAILED') => {
    if (!id) return;
    setSubmittingAction(deployStatus);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/deploy-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            targetEnv,
            releaseVersion: releaseVersion.trim(),
            deployStatus,
            reason: reason.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to mark deploy status.'));
      }

      setMessage(
        deployStatus === 'DEPLOYED'
          ? 'Deploy marked as deployed.'
          : 'Deploy marked as failed.',
      );
      setReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to mark deploy status.');
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
        <p className="text-sm text-gray-500">Loading change ticket detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/control-gates/change-tickets')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to Change Tickets
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

  if (!detail) return null;

  const canRunGate =
    canGate && ['READY_FOR_DEPLOY', 'DEPLOY_FAILED'].includes(detail.status) && !!releaseVersion.trim();
  const canMarkDeploy =
    canDeploy && ['READY_FOR_DEPLOY', 'DEPLOY_FAILED'].includes(detail.status) && !!releaseVersion.trim();

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard/control-gates/change-tickets')}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ArrowLeft size={16} />
                Back to Change Tickets
              </button>
              <button
                onClick={() => void fetchDetail()}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Change Ticket Detail</h1>
              <p className="mt-1 font-mono text-sm text-gray-500">{detail.ticketNo}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {detail.latestApprovalId && canViewApproval && (
              <button
                onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.latestApprovalId}`)}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Link2 size={16} />
                View Approval
              </button>
            )}
            {canSubmit && detail.status === 'DRAFT' && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'submit',
                    `Change ticket ${detail.ticketNo} submitted successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Submit
              </button>
            )}
            {canResubmit && detail.status === 'REJECTED' && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'resubmit',
                    `Change ticket ${detail.ticketNo} resubmitted successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 size={16} />
                Resubmit
              </button>
            )}
            {canClose && ['DEPLOYED', 'DEPLOY_FAILED'].includes(detail.status) && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'close',
                    `Change ticket ${detail.ticketNo} closed successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ClipboardList size={16} />
                Close
              </button>
            )}
          </div>
        </div>

        {(error || message) && (
          <div className="mt-4 space-y-2">
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
          </div>
        )}
      </div>

      <DetailCard title="Ticket Summary" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Ticket No" value={detail.ticketNo} mono />
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Change Type" value={detail.changeType} />
        <InfoField label="Risk Level" value={detail.riskLevel} />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Created By" value={detail.createdByUserId} />
      </DetailCard>

      <DetailCard title="Approval Link" icon={<Link2 size={18} />} columns={3}>
        <InfoField label="Approval No" value={detail.latestApprovalNo} mono />
        <InfoField label="Approval Status" value={detail.latestApprovalStatus} />
        <InfoField label="Approval Id" value={detail.latestApprovalId} mono />
      </DetailCard>

      <DetailCard title="Change Scope & Gate Evidence" icon={<ClipboardList size={18} />} columns={2}>
        <InfoField label="Scope Summary" value={detail.scopeSummary} />
        <InfoField label="Test Evidence Ref" value={detail.testEvidenceRef} mono />
        <InfoField label="Rollback Plan Ref" value={detail.rollbackPlanRef} mono />
      </DetailCard>

      <DetailCard title="Emergency & Timing" icon={<AlertTriangle size={18} />} columns={3}>
        <InfoField label="Emergency" value={detail.emergency ? 'YES' : 'NO'} />
        <InfoField label="Emergency Reason" value={detail.emergencyReason} />
        <InfoField label="Post Approval Due At" value={formatDateTime(detail.postApprovalDueAt)} />
        <InfoField
          label="Post Approval Completed At"
          value={formatDateTime(detail.postApprovalCompletedAt)}
        />
        <InfoField label="Deployed At" value={formatDateTime(detail.deployedAt)} />
      </DetailCard>

      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="text-brand-primary">
            <Rocket size={18} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Gate & Deploy Actions</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-gray-500">Target Env</label>
            <select
              value={targetEnv}
              onChange={(e) => setTargetEnv(e.target.value)}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
            >
              {RELEASE_ENV_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-gray-500">
              Release Version
            </label>
            <input
              value={releaseVersion}
              onChange={(e) => setReleaseVersion(e.target.value)}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              placeholder="e.g. 2026.03.14-rc1"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="block text-xs uppercase tracking-wide text-gray-500">Reason</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              placeholder="Optional operator note"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canGate && (
            <button
              onClick={() => void runGateCheck()}
              disabled={!canRunGate || submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              Run Gate Check
            </button>
          )}
          {canDeploy && (
            <>
              <button
                onClick={() => void markDeployStatus('DEPLOYED')}
                disabled={!canMarkDeploy || submittingAction !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Rocket size={16} />
                Mark Deployed
              </button>
              <button
                onClick={() => void markDeployStatus('DEPLOY_FAILED')}
                disabled={!canMarkDeploy || submittingAction !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XCircle size={16} />
                Mark Deploy Failed
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="text-brand-primary">
            <Rocket size={18} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Gate Runs</h2>
        </div>
        {gateRuns.length === 0 ? (
          <div className="text-sm text-gray-500">No gate runs recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-admin-border bg-admin-content-bg">
                <tr>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Env</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Release</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Operator</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Started</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Finished</th>
                  <th className="px-4 py-3 text-xs uppercase text-gray-500">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {gateRuns.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.targetEnv}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {item.releaseVersion}
                    </td>
                    <td className="px-4 py-3">{item.status}</td>
                    <td className="px-4 py-3">{item.operatorUserId}</td>
                    <td className="px-4 py-3">{formatDateTime(item.startedAt)}</td>
                    <td className="px-4 py-3">{formatDateTime(item.finishedAt)}</td>
                    <td className="px-4 py-3">
                      <div>{item.reason || '-'}</div>
                      {item.failureReason && (
                        <div className="text-xs text-red-600">{item.failureReason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailCard title="Lifecycle" icon={<CheckCircle2 size={18} />} columns={3}>
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Submitted By" value={detail.submittedByUserId} />
        <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
        <InfoField label="Closed By" value={detail.closedByUserId} />
      </DetailCard>
    </div>
  );
};

export default ChangeTicketDetailPage;

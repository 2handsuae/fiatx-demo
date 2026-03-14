import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlarmClock,
  ArrowLeft,
  BellRing,
  Link2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface SlaTimerDetail {
  id: string;
  timerNo: string;
  timerType: string;
  status: string;
  workflowType: string;
  workflowId: string;
  workflowNo: string;
  subjectType: string;
  subjectId: string;
  subjectNo: string;
  ownerUserId: string;
  dueAt: string;
  graceSeconds: number;
  traceId: string;
  contextJson: Record<string, unknown> | null;
  notificationSummary?: {
    total: number;
    scheduledCount: number;
    triggeredCount: number;
    skippedCount: number;
    latestType: string | null;
    latestStatus: string | null;
    latestAt: string | null;
  } | null;
  notifications?: Array<{
    id: string;
    notificationType: string;
    status: string;
    scheduledAt: string;
    triggeredAt: string | null;
    reasonCode: string | null;
    message: string | null;
    metadataJson: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  }>;
  closedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const formatDateTime = (value?: string | null) => {
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

const SlaTimerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<SlaTimerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [recalcReason, setRecalcReason] = useState('');
  const [dueInSeconds, setDueInSeconds] = useState('30');
  const [graceSeconds, setGraceSeconds] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canClose = hasAnyPermission([PERMISSIONS.GOV_SLA_TIMER_CLOSE]);
  const canRecalc = hasAnyPermission([PERMISSIONS.GOV_SLA_TIMER_RECALC]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);
  const canViewChangeTicket = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_DETAIL_READ]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Timer id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/sla-timers/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load SLA timer.'));
      }

      const data = (await response.json()) as SlaTimerDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load SLA timer detail.');
    } finally {
      setLoading(false);
    }
  };

  const submitClose = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/sla-timers/${id}/close`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reason: closeReason.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to close SLA timer.'));
      }

      setMessage('SLA timer closed successfully.');
      setCloseReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to close SLA timer.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRecalc = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        reason: recalcReason.trim() || undefined,
      };
      if (dueInSeconds.trim()) {
        payload.dueInSeconds = Number(dueInSeconds.trim());
      }
      if (graceSeconds.trim()) {
        payload.graceSeconds = Number(graceSeconds.trim());
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/sla-timers/${id}/recalc`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to recalculate SLA timer.'));
      }

      setMessage('SLA timer recalculated successfully.');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to recalculate SLA timer.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading SLA timer detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/control-gates/sla-timers')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to SLA Timers
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

  const showCloseButton =
    canClose &&
    detail.timerType === 'CHANGE_POST_APPROVAL_FOLLOWUP' &&
    detail.status === 'ACTIVE';
  const showRecalcButton = canRecalc && detail.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard/control-gates/sla-timers')}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ArrowLeft size={16} />
                Back to SLA Timers
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
              <h1 className="text-2xl font-bold text-gray-900">SLA Timer Detail</h1>
              <p className="mt-1 font-mono text-sm text-gray-500">{detail.timerNo}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {detail.subjectType === 'APPROVAL_CASE' && canViewApproval && (
              <button
                onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.subjectId}`)}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Link2 size={16} />
                View Approval
              </button>
            )}
            {detail.subjectType === 'CHANGE_TICKET' && canViewChangeTicket && (
              <button
                onClick={() =>
                  navigate(`/dashboard/control-gates/change-tickets/${detail.subjectId}`)
                }
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Link2 size={16} />
                View Change Ticket
              </button>
            )}
            {showCloseButton && (
              <button
                onClick={() => void submitClose()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ShieldCheck size={16} />
                {submitting ? 'Closing...' : 'Close'}
              </button>
            )}
            {showRecalcButton && (
              <button
                onClick={() => void submitRecalc()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw size={16} />
                {submitting ? 'Recalculating...' : 'Recalc'}
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {showCloseButton && (
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Close Reason
            </label>
            <textarea
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Optional reason for closing this follow-up timer"
            />
          </div>
        )}

        {showRecalcButton && (
          <div className="mt-4 space-y-3 rounded-lg border border-admin-border bg-admin-content-bg/50 p-4">
            <div className="text-sm font-medium text-gray-700">Recalc Timer</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Due In Seconds
                </label>
                <input
                  value={dueInSeconds}
                  onChange={(e) => setDueInSeconds(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="30"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Grace Seconds
                </label>
                <input
                  value={graceSeconds}
                  onChange={(e) => setGraceSeconds(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder={String(detail.graceSeconds)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Reason
                </label>
                <input
                  value={recalcReason}
                  onChange={(e) => setRecalcReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Optional recalc reason"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <DetailCard title="Timer Summary" icon={<AlarmClock size={18} />}>
        <InfoField label="Timer No" value={detail.timerNo} mono />
        <InfoField label="Timer Type" value={detail.timerType} />
        <InfoField label="Status" value={detail.status} />
      </DetailCard>

      <DetailCard title="Workflow Link" icon={<Link2 size={18} />}>
        <InfoField label="Workflow Type" value={detail.workflowType} />
        <InfoField label="Workflow No" value={detail.workflowNo} mono />
        <InfoField label="Workflow ID" value={detail.workflowId} mono />
      </DetailCard>

      <DetailCard title="Subject Reference" icon={<Link2 size={18} />}>
        <InfoField label="Subject Type" value={detail.subjectType} />
        <InfoField label="Subject No" value={detail.subjectNo} mono />
        <InfoField label="Subject ID" value={detail.subjectId} mono />
      </DetailCard>

      <DetailCard title="Timing & Ownership" icon={<Timer size={18} />}>
        <InfoField label="Owner User ID" value={detail.ownerUserId} mono />
        <InfoField label="Due At" value={formatDateTime(detail.dueAt)} />
        <InfoField label="Grace Seconds" value={detail.graceSeconds} />
        <InfoField label="Trace ID" value={detail.traceId} mono />
      </DetailCard>

      <DetailCard title="Notifications" icon={<BellRing size={18} />} columns={1}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <InfoField label="Total" value={detail.notificationSummary?.total ?? 0} />
            <InfoField
              label="Latest"
              value={
                detail.notificationSummary
                  ? `${detail.notificationSummary.latestType || '-'} / ${
                      detail.notificationSummary.latestStatus || '-'
                    }`
                  : '-'
              }
            />
            <InfoField
              label="Latest At"
              value={formatDateTime(detail.notificationSummary?.latestAt)}
            />
            <InfoField
              label="Triggered / Skipped"
              value={
                detail.notificationSummary
                  ? `${detail.notificationSummary.triggeredCount} / ${detail.notificationSummary.skippedCount}`
                  : '-'
              }
            />
          </div>

          {detail.notifications?.length ? (
            <div className="space-y-3">
              {detail.notifications.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-admin-border bg-white p-4"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <InfoField label="Type" value={item.notificationType} />
                    <InfoField label="Status" value={item.status} />
                    <InfoField label="Scheduled At" value={formatDateTime(item.scheduledAt)} />
                    <InfoField label="Triggered At" value={formatDateTime(item.triggeredAt)} />
                    <InfoField label="Reason Code" value={item.reasonCode} />
                    <InfoField label="Message" value={item.message} />
                  </div>
                  <div className="mt-3 rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
                    <pre className="overflow-x-auto">
                      {JSON.stringify(item.metadataJson || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-admin-border px-4 py-6 text-sm text-gray-500">
              No notifications registered for this timer.
            </div>
          )}
        </div>
      </DetailCard>

      <DetailCard title="Context" icon={<ShieldCheck size={18} />} columns={1}>
        <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
          {JSON.stringify(detail.contextJson || {}, null, 2)}
        </pre>
      </DetailCard>

      <DetailCard title="Lifecycle" icon={<RefreshCw size={18} />}>
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
        <InfoField label="Expired At" value={formatDateTime(detail.expiredAt)} />
      </DetailCard>
    </div>
  );
};

export default SlaTimerDetailPage;

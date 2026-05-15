import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlarmClock,
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
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';

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
            className={adminButtonClass('detailUtility')}
          >
            Back to SLA Timers
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

  if (!detail) return null;

  const showCloseButton =
    canClose &&
    detail.timerType === 'CHANGE_POST_APPROVAL_FOLLOWUP' &&
    detail.status === 'ACTIVE';
  const showRecalcButton = canRecalc && detail.status === 'ACTIVE';

  return (
    <div className="space-y-6 pb-12">
      <DetailPageHeader
        title="SLA Timer Detail"
        subtitle={detail.timerNo}
        onBack={() => navigate('/dashboard/control-gates/sla-timers')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to SLA Timers"
      >
        <div className="flex flex-wrap items-center gap-2">
            {detail.subjectType === 'APPROVAL_CASE' && canViewApproval && (
              <button
                onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.subjectId}`)}
                className={adminButtonClass('detailUtility')}
              >
                <Link2 size={16} />
                View Approval
              </button>
            )}
          </div>
      </DetailPageHeader>

      {message ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ActionSection
        title="Timer Actions"
        description="Workflow actions stay below the summary so the header remains utility-only."
        emptyText="No active timer actions are available for this record."
      >
        {showCloseButton || showRecalcButton ? (
          <div className="space-y-4">
            {showCloseButton ? (
              <div>
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
            ) : null}

            {showRecalcButton ? (
              <div className="space-y-3 rounded-lg border border-admin-border bg-admin-content-bg/50 p-4">
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
            ) : null}

            <div className="flex flex-wrap gap-3">
              {showCloseButton ? (
                <button
                  onClick={() => void submitClose()}
                  disabled={submitting}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <ShieldCheck size={16} />
                  {submitting ? 'Closing...' : 'Close'}
                </button>
              ) : null}
              {showRecalcButton ? (
                <button
                  onClick={() => void submitRecalc()}
                  disabled={submitting}
                  className={adminButtonClass('workflowSecondary')}
                >
                  <RotateCcw size={16} />
                  {submitting ? 'Recalculating...' : 'Recalculate'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </ActionSection>

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
        <JsonBlock title="Context JSON" value={detail.contextJson || {}} />
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

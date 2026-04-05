import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { createDeleteRequest, DELETE_REQUEST_TARGET_TYPES } from '../utils/deleteRequests';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface ChangeTicketDetail {
  id: string;
  ticketNo: string;
  status: string;
  changeType: string | null;
  changeReason: string | null;
  scopeSummary: string | null;
  testEvidenceRef: string | null;
  rollbackPlanRef: string | null;
  bindingSnapshotJson: Record<string, unknown> | null;
  bindingDigest: string | null;
  approvalCaseId: string | null;
  approvalNo: string | null;
  traceId: string;
  createdByUserId: string;
  createdByUserNo: string;
  submittedByUserId: string | null;
  submittedByUserNo: string | null;
  consumedByUserId: string | null;
  consumedByUserNo: string | null;
  submittedAt: string | null;
  consumedAt: string | null;
  resultNote: string | null;
  createdAt: string;
  updatedAt: string;
}

const SUBMITTABLE_CHANGE_TICKET_STATUSES = ['DRAFT'] as const;
const CONSUMABLE_CHANGE_TICKET_STATUSES = ['READY'] as const;
const CONSUME_RESULT_SUCCESS = 'success' as const;
const CONSUME_RESULT_FAILURE = 'failure' as const;
const CONSUME_RESULT_OPTIONS = [
  { value: CONSUME_RESULT_SUCCESS, label: 'Success' },
  { value: CONSUME_RESULT_FAILURE, label: 'Failure' },
] as const;

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const ChangeTicketDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<ChangeTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [consumeResult, setConsumeResult] = useState<typeof CONSUME_RESULT_SUCCESS | typeof CONSUME_RESULT_FAILURE>(CONSUME_RESULT_SUCCESS);
  const [consumeNote, setConsumeNote] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const requestSeqRef = useRef(0);

  const canSubmit = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_SUBMIT]);
  const canConsume = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_CONSUME]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);
  const canRequestDeletion = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CREATE]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Change ticket id is required.');
      setLoading(false);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load change ticket.'));
      }

      const data = (await response.json()) as ChangeTicketDetail;
      if (requestSeq !== requestSeqRef.current) return;
      setDetail(data);
    } catch (e: unknown) {
      if (requestSeq !== requestSeqRef.current) return;
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load change ticket detail.');
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setLoading(false);
    }
  };

  const submitChangeTicket = async () => {
    if (!id || !detail) return;
    setSubmittingAction('submit');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ traceId: detail.traceId }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to submit change ticket.'));
      }

      setMessage(`Change ticket ${detail.ticketNo} submitted successfully.`);
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit change ticket.');
    } finally {
      setSubmittingAction(null);
    }
  };

  const consumeChangeTicket = async () => {
    if (!id || !detail) return;
    const note = consumeNote.trim();

    setSubmittingAction('consume');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/consume`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            success: consumeResult === CONSUME_RESULT_SUCCESS,
            ...(note ? { note } : {}),
            traceId: detail.traceId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to consume change ticket.'));
      }

      setMessage(
        consumeResult === CONSUME_RESULT_SUCCESS
          ? `Change ticket ${detail.ticketNo} consumed successfully.`
          : `Change ticket ${detail.ticketNo} consume failed recorded.`,
      );
      setConsumeNote('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to consume change ticket.');
    } finally {
      setSubmittingAction(null);
    }
  };

  const requestChangeTicketDeletion = async () => {
    if (!detail) return;

    const normalizedReason = deleteReason.trim();
    if (!normalizedReason) {
      setError('Delete reason is required.');
      return;
    }

    setSubmittingAction('delete-request');
    setError('');
    setMessage('');
    try {
      const created = await createDeleteRequest({
        targetType: DELETE_REQUEST_TARGET_TYPES.CHANGE_TICKET,
        targetNo: detail.ticketNo,
        deleteReason: normalizedReason,
      });
      navigate(`/dashboard/control-gates/delete-requests/${created.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create delete request.');
    } finally {
      setSubmittingAction(null);
    }
  };

  useEffect(() => {
    setDeleteReason('');
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
            className={adminButtonClass('detailUtility')}
          >
            <ArrowLeft size={16} />
            Back to Change Tickets
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

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="Change Ticket Detail"
        subtitle={detail.ticketNo}
        onBack={() => navigate('/dashboard/control-gates/change-tickets')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Change Tickets"
      >
        {detail.approvalCaseId && canViewApproval && (
          <button
            onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.approvalCaseId}`)}
            className={adminButtonClass('detailUtility')}
          >
            <Link2 size={16} />
            View Approval
          </button>
        )}
      </DetailPageHeader>

      {(error || message) && (
        <div className="space-y-2">
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

      <DetailCard title="Ticket Summary" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Ticket No" value={detail.ticketNo} mono />
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Change Type" value={detail.changeType} />
        <InfoField label="Approval No" value={detail.approvalNo} mono />
        <InfoField label="Trace ID" value={detail.traceId} mono />
      </DetailCard>

      <DetailCard title="Change Scope" icon={<ClipboardList size={18} />} columns={2}>
        <InfoField label="Change Reason" value={detail.changeReason} />
        <InfoField label="Scope Summary" value={detail.scopeSummary} />
        <InfoField label="Test Evidence Ref" value={detail.testEvidenceRef} mono />
        <InfoField label="Rollback Plan Ref" value={detail.rollbackPlanRef} mono />
      </DetailCard>

      <DetailCard title="Actors" icon={<Link2 size={18} />} columns={3}>
        <InfoField label="Created By User No" value={detail.createdByUserNo} mono />
        <InfoField label="Submitted By User No" value={detail.submittedByUserNo} mono />
        <InfoField label="Consumed By User No" value={detail.consumedByUserNo} mono />
      </DetailCard>

      <DetailCard title="Timing & Result" icon={<ClipboardList size={18} />} columns={2}>
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Consumed At" value={formatDateTime(detail.consumedAt)} />
        <InfoField label="Result Note" value={detail.resultNote} />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
      </DetailCard>

      <DetailCard title="Technical Details" icon={<ClipboardList size={18} />} columns={3}>
        <InfoField label="Approval Case ID" value={detail.approvalCaseId} mono />
        <InfoField label="Created By User ID" value={detail.createdByUserId} mono />
        <InfoField label="Submitted By User ID" value={detail.submittedByUserId} mono />
        <InfoField label="Consumed By User ID" value={detail.consumedByUserId} mono />
        <InfoField label="Binding Digest" value={detail.bindingDigest} mono />
        <div className="md:col-span-3">
          <JsonBlock title="Binding Snapshot JSON" value={detail.bindingSnapshotJson || {}} compact />
        </div>
      </DetailCard>

      <ActionSection
        title="Workflow Actions"
        description="Submit, consume, and governed deletion proposals are available here when the current state permits."
      >
        <div className="space-y-4">
          {canRequestDeletion && (
            <div className="space-y-4 rounded-xl border border-admin-border bg-gray-50 p-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-900">Request Deletion</div>
                <div className="text-xs text-gray-500">
                  Open a governed deletion proposal for ticket {detail.ticketNo}. The request is tracked separately under control gates.
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-wide text-gray-500">
                  Delete Reason
                </label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="Explain why this change ticket should enter governed deletion."
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void requestChangeTicketDeletion()}
                  disabled={submittingAction !== null || !deleteReason.trim()}
                  className={adminButtonClass('workflowSecondary')}
                >
                  <Trash2 size={16} />
                  {submittingAction === 'delete-request' ? 'Requesting...' : 'Request Deletion'}
                </button>
              </div>
            </div>
          )}

          {canSubmit && SUBMITTABLE_CHANGE_TICKET_STATUSES.includes(detail.status as (typeof SUBMITTABLE_CHANGE_TICKET_STATUSES)[number]) && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void submitChangeTicket()}
                disabled={submittingAction !== null}
                className={adminButtonClass('workflowPrimary')}
              >
                <CheckCircle2 size={16} />
                Submit
              </button>
            </div>
          )}

          {canConsume && CONSUMABLE_CHANGE_TICKET_STATUSES.includes(detail.status as (typeof CONSUMABLE_CHANGE_TICKET_STATUSES)[number]) && (
            <div className="space-y-4 rounded-xl border border-admin-border bg-gray-50 p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-wide text-gray-500">
                    Result
                  </label>
                  <select
                    value={consumeResult}
                    onChange={(e) =>
                      setConsumeResult(
                        e.target.value === CONSUME_RESULT_FAILURE
                          ? CONSUME_RESULT_FAILURE
                          : CONSUME_RESULT_SUCCESS,
                      )
                    }
                    className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  >
                    {CONSUME_RESULT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-wide text-gray-500">
                    Reason / Note
                  </label>
                  <textarea
                    value={consumeNote}
                    onChange={(e) => setConsumeNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                    placeholder="Optional operator note"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void consumeChangeTicket()}
                  disabled={submittingAction !== null}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <CheckCircle2 size={16} />
                  Consume
                </button>
              </div>
            </div>
          )}
        </div>
      </ActionSection>
    </div>
  );
};

export default ChangeTicketDetailPage;

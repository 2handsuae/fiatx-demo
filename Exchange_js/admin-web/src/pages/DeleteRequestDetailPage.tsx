import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Link2,
  RefreshCw,
  ShieldCheck,
  XCircle,
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

interface DeleteRequestDetail {
  id: string;
  requestNo: string;
  targetType: string;
  targetId: string;
  targetNo: string;
  status: string;
  approvalCaseId: string | null;
  approvalNo: string | null;
  createdByUserId: string;
  createdByUserNo: string;
  submittedByUserId: string | null;
  submittedByUserNo: string | null;
  consumedByUserId: string | null;
  consumedByUserNo: string | null;
  deleteReason: string;
  resultNote: string | null;
  docRef: string | null;
  targetSnapshotJson: Record<string, unknown> | null;
  targetSnapshotDigest: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  consumedAt: string | null;
}

const DELETE_REQUEST_STATUSES = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const DeleteRequestDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<DeleteRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const requestSeqRef = useRef(0);

  const canSubmit = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_SUBMIT]);
  const canCancel = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CANCEL]);
  const canConsume = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CONSUME]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);
  const isSuperAdmin = (session?.roles || []).includes(SUPER_ADMIN_ROLE);

  const fetchDetail = async () => {
    const requestId = ++requestSeqRef.current;
    if (!id) {
      setError('Delete request id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load delete request.'));
      }

      const data = (await response.json()) as DeleteRequestDetail;
      if (requestId !== requestSeqRef.current) return;
      setDetail(data);
    } catch (e: unknown) {
      if (requestId !== requestSeqRef.current) return;
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load delete request detail.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  const submitSimpleAction = async (path: 'submit' | 'cancel' | 'consume', successMessage: string) => {
    if (!id || !detail) return;
    setSubmittingAction(path);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = { traceId: detail.traceId };
      if (reason.trim()) payload.reason = reason.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests/${id}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${path} delete request.`));
      }

      setMessage(successMessage);
      setReason('');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to ${path} delete request.`);
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
        <p className="text-sm text-gray-500">Loading delete request detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/control-gates/delete-requests')}
            className={adminButtonClass('detailUtility')}
          >
            <ArrowLeft size={16} />
            Back to Delete Requests
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
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

  const status = detail.status;
  const isMaker = session?.id === detail.createdByUserId;
  const canSubmitAction = canSubmit && isMaker && status === DELETE_REQUEST_STATUSES.DRAFT;
  const canCancelAction =
    canCancel &&
    (isMaker || isSuperAdmin) &&
    (status === DELETE_REQUEST_STATUSES.DRAFT ||
      status === DELETE_REQUEST_STATUSES.PENDING_APPROVAL ||
      status === DELETE_REQUEST_STATUSES.READY);
  const canConsumeAction =
    canConsume &&
    status === DELETE_REQUEST_STATUSES.READY &&
    (!isMaker || isSuperAdmin);

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="Delete Request Detail"
        subtitle={detail.requestNo}
        onBack={() => navigate('/dashboard/control-gates/delete-requests')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Delete Requests"
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

      <DetailCard title="Request Summary" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Request No" value={detail.requestNo} mono />
        <InfoField label="Status" value={status} />
        <InfoField label="Approval No" value={detail.approvalNo} mono />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Created By User No" value={detail.createdByUserNo} mono />
        <InfoField label="Submitted By User No" value={detail.submittedByUserNo} mono />
        <InfoField label="Consumed By User No" value={detail.consumedByUserNo} mono />
      </DetailCard>

      <DetailCard title="Target Reference" icon={<ClipboardList size={18} />} columns={3}>
        <InfoField label="Target Type" value={detail.targetType} />
        <InfoField label="Target No" value={detail.targetNo} mono />
        <InfoField label="Delete Reason" value={detail.deleteReason} />
        <InfoField label="Result Note" value={detail.resultNote} />
        <InfoField label="Doc Ref" value={detail.docRef} mono />
      </DetailCard>

      <ActionSection
        title="Workflow Actions"
        description="Submit, cancel, or consume this request."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {canSubmitAction && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'submit',
                    `Delete request ${detail.requestNo} submitted successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className={adminButtonClass('workflowPrimary')}
              >
                <CheckCircle2 size={16} />
                Submit
              </button>
            )}
            {canCancelAction && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'cancel',
                    `Delete request ${detail.requestNo} cancelled successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className={adminButtonClass('workflowNegative')}
              >
                <XCircle size={16} />
                Cancel
              </button>
            )}
            {canConsumeAction && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'consume',
                    `Delete request ${detail.requestNo} consumed successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className={adminButtonClass('workflowPrimary')}
              >
                <ShieldCheck size={16} />
                Consume
              </button>
            )}
          </div>
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-gray-500">Reason</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              placeholder="Optional operator note"
            />
          </div>
        </div>
      </ActionSection>

      <DetailCard title="Technical Details" icon={<ClipboardList size={18} />} columns={3}>
        <InfoField label="Approval Case ID" value={detail.approvalCaseId} mono />
        <InfoField label="Target ID" value={detail.targetId} mono />
        <InfoField label="Created By User ID" value={detail.createdByUserId} mono />
        <InfoField label="Submitted By User ID" value={detail.submittedByUserId} mono />
        <InfoField label="Consumed By User ID" value={detail.consumedByUserId} mono />
        <InfoField label="Target Snapshot Digest" value={detail.targetSnapshotDigest} mono />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Consumed At" value={formatDateTime(detail.consumedAt)} />
        <div className="md:col-span-3">
          <JsonBlock title="Target Snapshot JSON" value={detail.targetSnapshotJson || {}} compact />
        </div>
      </DetailCard>
    </div>
  );
};

export default DeleteRequestDetailPage;

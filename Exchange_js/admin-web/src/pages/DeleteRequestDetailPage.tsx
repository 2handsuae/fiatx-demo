import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Link2,
  PlayCircle,
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
  latestApprovalId: string | null;
  latestApprovalNo: string | null;
  latestApprovalStatus: string | null;
  makerUserId: string;
  submittedByUserId: string | null;
  executedByUserId: string | null;
  deleteReason: string;
  docRef: string | null;
  targetSnapshotJson: Record<string, unknown> | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  executedAt: string | null;
}

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

  const canSubmit = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_SUBMIT]);
  const canCancel = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CANCEL]);
  const canExecute = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_EXECUTE]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);

  const fetchDetail = async () => {
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
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load delete request detail.');
    } finally {
      setLoading(false);
    }
  };

  const submitSimpleAction = async (path: 'submit' | 'cancel' | 'execute', successMessage: string) => {
    if (!id) return;
    setSubmittingAction(path);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, unknown> = {};
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

  const isMaker = session?.id === detail.makerUserId;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="Delete Request Detail"
        subtitle={detail.requestNo}
        onBack={() => navigate('/dashboard/control-gates/delete-requests')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Delete Requests"
      >
        {detail.latestApprovalId && canViewApproval && (
          <button
            onClick={() => navigate(`/dashboard/control-gates/approvals/${detail.latestApprovalId}`)}
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
        <InfoField label="Status" value={detail.status} />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Maker User Id" value={detail.makerUserId} mono />
        <InfoField label="Submitted By" value={detail.submittedByUserId} mono />
        <InfoField label="Executed By" value={detail.executedByUserId} mono />
      </DetailCard>

      <DetailCard title="Target Reference" icon={<ClipboardList size={18} />} columns={3}>
        <InfoField label="Target Type" value={detail.targetType} />
        <InfoField label="Target No" value={detail.targetNo} mono />
        <InfoField label="Target Id" value={detail.targetId} mono />
        <InfoField label="Delete Reason" value={detail.deleteReason} />
        <InfoField label="Doc Ref" value={detail.docRef} mono />
      </DetailCard>

      <DetailCard title="Approval Link" icon={<Link2 size={18} />} columns={3}>
        <InfoField label="Approval No" value={detail.latestApprovalNo} mono />
        <InfoField label="Approval Status" value={detail.latestApprovalStatus} />
        <InfoField label="Approval Id" value={detail.latestApprovalId} mono />
      </DetailCard>

      <ActionSection
        title="Workflow Actions"
        description="Delete request workflow actions live here. Utility buttons stay in the header and execution actions stay in this dedicated surface."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {canSubmit && isMaker && detail.status === 'DRAFT' && (
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
            {canCancel &&
              isMaker &&
              ['DRAFT', 'SUBMITTED', 'APPROVAL_PENDING'].includes(detail.status) && (
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
            {canExecute && detail.status === 'READY_TO_EXECUTE' && (
              <button
                onClick={() =>
                  void submitSimpleAction(
                    'execute',
                    `Delete request ${detail.requestNo} executed successfully.`,
                  )
                }
                disabled={submittingAction !== null}
                className={adminButtonClass('workflowPrimary')}
              >
                <PlayCircle size={16} />
                Execute
              </button>
            )}
          </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <InfoField label="Current Status" value={detail.status} />
          <InfoField label="Approval Status" value={detail.latestApprovalStatus} />
          <InfoField
            label="Execution Ready"
            value={detail.status === 'READY_TO_EXECUTE' ? 'YES' : 'NO'}
          />
        </div>
        <div className="mt-4 space-y-2">
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

      <DetailCard title="Target Snapshot" icon={<ClipboardList size={18} />} columns={1}>
        <JsonBlock title="Target Snapshot JSON" value={detail.targetSnapshotJson || {}} compact />
      </DetailCard>

      <DetailCard title="Lifecycle" icon={<ClipboardList size={18} />} columns={3}>
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Submitted At" value={formatDateTime(detail.submittedAt)} />
        <InfoField label="Executed At" value={formatDateTime(detail.executedAt)} />
      </DetailCard>
    </div>
  );
};

export default DeleteRequestDetailPage;

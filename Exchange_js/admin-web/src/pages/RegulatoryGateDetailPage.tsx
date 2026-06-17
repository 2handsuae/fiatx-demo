import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileJson,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldEllipsis,
  TicketCheck,
  Undo2,
} from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import {
  ActionCard,
  DetailCard,
  InfoField,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import {
  formatDateTime,
  toDateTimeLocalValue,
  toIsoDateTime,
} from '../components/governance/governanceUtils';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type RegulatoryGateDetail = {
  id: string;
  gateNo: string;
  gateType: string;
  authority: string;
  subjectType: string;
  subjectId: string;
  subjectNo: string;
  scopeSummary?: string | null;
  shareholdingRegistryVersionId?: string | null;
  appointmentRecordId?: string | null;
  linkedApprovalId?: string | null;
  internalApprovalStatus: string;
  filingStatus: string;
  receiptStatus: string;
  effectivenessStatus: string;
  gateResult: string;
  filingRefNo?: string | null;
  filingSubmittedAt?: string | null;
  latestFeedback?: string | null;
  latestFeedbackAt?: string | null;
  receiptType?: string | null;
  receiptRefNo?: string | null;
  receiptBoundAt?: string | null;
  proposedEffectiveAt?: string | null;
  effectiveAt?: string | null;
  revokedAt?: string | null;
  traceId?: string | null;
  metadataJson?: Record<string, unknown>;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  shareholdingRegistryVersion?: { id: string; registryNo: string; status: string } | null;
  appointmentRecord?: {
    id: string;
    appointmentNo: string;
    status: string;
    regulatedFlag: boolean;
  } | null;
  wallet?: {
    id: string;
    walletNo: string;
    walletRole?: string | null;
    regulatoryEnablementStatus?: string | null;
  } | null;
  linkedApproval?: { id: string; approvalNo: string; status: string } | null;
};

const FEEDBACK_STATUS_OPTIONS = ['ACCEPTED', 'RETURNED', 'REJECTED'] as const;
const RECEIPT_TYPE_OPTIONS = ['VARA_APPROVAL', 'VARA_ACK', 'NO_OBJECTION'] as const;

const RegulatoryGateDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [detail, setDetail] = useState<RegulatoryGateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitForm, setSubmitForm] = useState({ filingRefNo: '', filingSubmittedAt: '' });
  const [feedbackForm, setFeedbackForm] = useState({
    filingStatus: 'ACCEPTED',
    latestFeedback: '',
    latestFeedbackAt: '',
  });
  const [receiptForm, setReceiptForm] = useState({
    receiptType: 'VARA_APPROVAL',
    receiptRefNo: '',
    receiptBoundAt: '',
  });
  const [effectiveForm, setEffectiveForm] = useState({ effectiveAt: '' });
  const [revokeForm, setRevokeForm] = useState({ reason: '', revokedAt: '' });

  const canSubmit = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_SUBMIT]);
  const canRecordFeedback = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_RECORD_FEEDBACK]);
  const canBindReceipt = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_BIND_RECEIPT]);
  const canMarkEffective = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_MARK_EFFECTIVE]);
  const canRevoke = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_REVOKE]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Regulatory gate id is required.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/regulatory-gates/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load regulatory gate detail.'));
      }

      const result = (await response.json()) as RegulatoryGateDetail;
      setDetail(result);
      setSubmitForm({
        filingRefNo: result.filingRefNo || '',
        filingSubmittedAt: toDateTimeLocalValue(result.filingSubmittedAt),
      });
      setFeedbackForm({
        filingStatus:
          result.filingStatus &&
          FEEDBACK_STATUS_OPTIONS.includes(
            result.filingStatus as (typeof FEEDBACK_STATUS_OPTIONS)[number],
          )
            ? result.filingStatus
            : 'ACCEPTED',
        latestFeedback: result.latestFeedback || '',
        latestFeedbackAt: toDateTimeLocalValue(result.latestFeedbackAt),
      });
      setReceiptForm({
        receiptType:
          result.receiptType &&
          RECEIPT_TYPE_OPTIONS.includes(
            result.receiptType as (typeof RECEIPT_TYPE_OPTIONS)[number],
          )
            ? result.receiptType
            : 'VARA_APPROVAL',
        receiptRefNo: result.receiptRefNo || '',
        receiptBoundAt: toDateTimeLocalValue(result.receiptBoundAt),
      });
      setEffectiveForm({
        effectiveAt: toDateTimeLocalValue(result.effectiveAt || result.proposedEffectiveAt),
      });
      setRevokeForm({
        reason: '',
        revokedAt: toDateTimeLocalValue(result.revokedAt),
      });
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load regulatory gate detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitAction = async (action: string, path: string, payload: Record<string, unknown>) => {
    if (!id) return;
    setSubmittingAction(action);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/regulatory-gates/${id}/${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${path} regulatory gate.`));
      }

      setMessage(`Regulatory gate ${detail?.gateNo || id} ${action} completed successfully.`);
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to ${path} regulatory gate.`);
    } finally {
      setSubmittingAction(null);
    }
  };

  const linkedSubjectButton = () => {
    if (!detail) return null;
    if (detail.shareholdingRegistryVersion) {
      return (
        <button
          onClick={() =>
            navigate(
              `/admin/registries/shareholding-versions/${detail.shareholdingRegistryVersion?.id}`,
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
        >
          <Link2 size={16} />
          Open Shareholding Registry
        </button>
      );
    }
    if (detail.appointmentRecord) {
      return (
        <button
          onClick={() =>
            navigate(`/admin/registries/appointments/${detail.appointmentRecord?.id}`)
          }
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
        >
          <Link2 size={16} />
          Open Appointment Record
        </button>
      );
    }
    if (detail.wallet) {
      return (
        <button
          onClick={() => navigate(`/dashboard/treasury/wallets/${detail.wallet?.id}`)}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
        >
          <Link2 size={16} />
          Open Wallet Detail
        </button>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading regulatory gate detail...</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/registries/regulatory-gates')}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to Regulatory Gates
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
          onClick={() => navigate('/admin/registries/regulatory-gates')}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft size={16} />
          Back to Regulatory Gates
        </button>
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
          Regulatory gate detail not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 rounded-xl border border-admin-border bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/admin/registries/regulatory-gates')}
            className="mt-1 inline-flex items-center justify-center rounded-lg border border-admin-border p-2 text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Regulatory Gate Detail</h1>
              <StatusBadge value={detail.gateResult} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="font-mono text-brand-primary">{detail.gateNo}</span>
              <span>{detail.gateType}</span>
              <span>{detail.subjectNo}</span>
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

      <DetailCard title="Gate Snapshot" icon={<ShieldCheck size={18} />} columns={3}>
        <InfoField label="Gate No" value={detail.gateNo} mono />
        <InfoField label="Gate Type" value={detail.gateType} />
        <InfoField label="Authority" value={detail.authority} />
        <InfoField label="Subject Type" value={detail.subjectType} />
        <InfoField label="Subject No" value={detail.subjectNo} mono />
        <InfoField label="Scope Summary" value={detail.scopeSummary} />
        <InfoField label="Trace ID" value={detail.traceId} mono />
        <InfoField label="Created By" value={detail.createdByUserId} mono />
        <InfoField label="Updated By" value={detail.updatedByUserId} mono />
        <InfoField label="Created At" value={formatDateTime(detail.createdAt)} />
        <InfoField label="Updated At" value={formatDateTime(detail.updatedAt)} />
        <InfoField label="Linked Approval" value={detail.linkedApproval?.approvalNo || detail.linkedApprovalId} mono />
      </DetailCard>

      <DetailCard title="Status Snapshot" icon={<TicketCheck size={18} />} columns={3}>
        <InfoField label="Internal Approval" value={<StatusBadge value={detail.internalApprovalStatus} />} />
        <InfoField label="Filing Status" value={<StatusBadge value={detail.filingStatus} />} />
        <InfoField label="Receipt Status" value={<StatusBadge value={detail.receiptStatus} />} />
        <InfoField label="Effectiveness Status" value={<StatusBadge value={detail.effectivenessStatus} />} />
        <InfoField label="Gate Result" value={<StatusBadge value={detail.gateResult} />} />
        <InfoField label="Filing Ref No" value={detail.filingRefNo} mono />
        <InfoField label="Filing Submitted At" value={formatDateTime(detail.filingSubmittedAt)} />
        <InfoField label="Latest Feedback" value={detail.latestFeedback} />
        <InfoField label="Latest Feedback At" value={formatDateTime(detail.latestFeedbackAt)} />
        <InfoField label="Receipt Type" value={detail.receiptType} />
        <InfoField label="Receipt Ref No" value={detail.receiptRefNo} mono />
        <InfoField label="Receipt Bound At" value={formatDateTime(detail.receiptBoundAt)} />
        <InfoField label="Proposed Effective At" value={formatDateTime(detail.proposedEffectiveAt)} />
        <InfoField label="Effective At" value={formatDateTime(detail.effectiveAt)} />
        <InfoField label="Revoked At" value={formatDateTime(detail.revokedAt)} />
      </DetailCard>

      <DetailCard title="Linked Subject" icon={<Link2 size={18} />} columns={2}>
        <InfoField
          label="Shareholding Registry"
          value={detail.shareholdingRegistryVersion?.registryNo}
          mono
        />
        <InfoField label="Appointment Record" value={detail.appointmentRecord?.appointmentNo} mono />
        <div className="md:col-span-2">{linkedSubjectButton()}</div>
      </DetailCard>

      <DetailCard title="Metadata JSON" icon={<FileJson size={18} />} columns={1}>
        <JsonBlock title="metadataJson" value={detail.metadataJson || {}} />
      </DetailCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {canSubmit ? (
          <ActionCard
            title="Submit Filing"
            description="Submit or resubmit the filing reference for this regulatory gate."
          >
            <input
              value={submitForm.filingRefNo}
              onChange={(e) => setSubmitForm((prev) => ({ ...prev, filingRefNo: e.target.value }))}
              placeholder="Filing Ref No"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={submitForm.filingSubmittedAt}
              onChange={(e) =>
                setSubmitForm((prev) => ({ ...prev, filingSubmittedAt: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                void submitAction('submit', 'submit', {
                  filingRefNo: submitForm.filingRefNo.trim() || undefined,
                  filingSubmittedAt: toIsoDateTime(submitForm.filingSubmittedAt),
                })
              }
              disabled={submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
            >
              <Send size={16} />
              {submittingAction === 'submit' ? 'Submitting...' : 'Submit Filing'}
            </button>
          </ActionCard>
        ) : null}

        {canRecordFeedback ? (
          <ActionCard
            title="Record Feedback"
            description="Record regulator filing feedback and update the filing status."
          >
            <select
              value={feedbackForm.filingStatus}
              onChange={(e) =>
                setFeedbackForm((prev) => ({ ...prev, filingStatus: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {FEEDBACK_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <textarea
              value={feedbackForm.latestFeedback}
              onChange={(e) =>
                setFeedbackForm((prev) => ({ ...prev, latestFeedback: e.target.value }))
              }
              rows={3}
              placeholder="Latest feedback"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={feedbackForm.latestFeedbackAt}
              onChange={(e) =>
                setFeedbackForm((prev) => ({ ...prev, latestFeedbackAt: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                void submitAction('record feedback', 'record-feedback', {
                  filingStatus: feedbackForm.filingStatus,
                  latestFeedback: feedbackForm.latestFeedback.trim() || undefined,
                  latestFeedbackAt: toIsoDateTime(feedbackForm.latestFeedbackAt),
                })
              }
              disabled={submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <ShieldEllipsis size={16} />
              {submittingAction === 'record feedback' ? 'Saving...' : 'Record Feedback'}
            </button>
          </ActionCard>
        ) : null}

        {canBindReceipt ? (
          <ActionCard
            title="Bind Receipt"
            description="Bind the external receipt or approval reference to this gate."
          >
            <select
              value={receiptForm.receiptType}
              onChange={(e) =>
                setReceiptForm((prev) => ({ ...prev, receiptType: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {RECEIPT_TYPE_OPTIONS.map((receiptType) => (
                <option key={receiptType} value={receiptType}>
                  {receiptType}
                </option>
              ))}
            </select>
            <input
              value={receiptForm.receiptRefNo}
              onChange={(e) =>
                setReceiptForm((prev) => ({ ...prev, receiptRefNo: e.target.value }))
              }
              placeholder="Receipt Ref No"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={receiptForm.receiptBoundAt}
              onChange={(e) =>
                setReceiptForm((prev) => ({ ...prev, receiptBoundAt: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                void submitAction('bind receipt', 'bind-receipt', {
                  receiptType: receiptForm.receiptType,
                  receiptRefNo: receiptForm.receiptRefNo.trim(),
                  receiptBoundAt: toIsoDateTime(receiptForm.receiptBoundAt),
                })
              }
              disabled={submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <TicketCheck size={16} />
              {submittingAction === 'bind receipt' ? 'Binding...' : 'Bind Receipt'}
            </button>
          </ActionCard>
        ) : null}

        {canMarkEffective ? (
          <ActionCard
            title="Mark Effective"
            description="Mark this gate as effective and allow the linked registry to become active."
          >
            <input
              type="datetime-local"
              value={effectiveForm.effectiveAt}
              onChange={(e) =>
                setEffectiveForm((prev) => ({ ...prev, effectiveAt: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                void submitAction('mark effective', 'mark-effective', {
                  effectiveAt: toIsoDateTime(effectiveForm.effectiveAt),
                })
              }
              disabled={submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              <CheckCircle2 size={16} />
              {submittingAction === 'mark effective' ? 'Updating...' : 'Mark Effective'}
            </button>
          </ActionCard>
        ) : null}

        {canRevoke ? (
          <ActionCard
            title="Revoke Gate"
            description="Revoke this gate without automatically rolling back the linked registry."
          >
            <textarea
              value={revokeForm.reason}
              onChange={(e) => setRevokeForm((prev) => ({ ...prev, reason: e.target.value }))}
              rows={3}
              placeholder="Reason"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={revokeForm.revokedAt}
              onChange={(e) =>
                setRevokeForm((prev) => ({ ...prev, revokedAt: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                void submitAction('revoke', 'revoke', {
                  reason: revokeForm.reason.trim() || undefined,
                  revokedAt: toIsoDateTime(revokeForm.revokedAt),
                })
              }
              disabled={submittingAction !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              <Undo2 size={16} />
              {submittingAction === 'revoke' ? 'Revoking...' : 'Revoke'}
            </button>
          </ActionCard>
        ) : null}
      </div>
    </div>
  );
};

export default RegulatoryGateDetailPage;

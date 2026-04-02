import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  ActionCard,
  DetailCard,
  InfoField,
  JsonBlock,
  StatusBadge,
} from '../components/governance/GovernanceUi';
import {
  formatDateTime,
} from '../components/governance/governanceUtils';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  getTreasuryResourceConfig,
  type TreasuryResourceType,
} from './wave8OpsConfig';

type FeeOccurrenceDetail = {
  id: string;
  feeNo: string;
  feeType: string;
  status: string;
  amount: string;
  payer?: string | null;
  chargedToCustomer?: boolean | null;
  reimbursementImpact?: string | null;
  poolRole?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  sourceEntityNo?: string | null;
  sourceWalletId?: string | null;
  sourceAccountRef?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  relatedEntityNo?: string | null;
  evidenceRef?: string | null;
  traceId?: string | null;
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
  asset?: { code: string; network?: string | null; type?: string | null } | null;
  sourceWallet?: { walletNo: string; walletRole?: string | null } | null;
  reimbursementObligation?: { id: string; obligationNo: string; status: string } | null;
};

type ReimbursementObligationDetail = {
  id: string;
  obligationNo: string;
  status: string;
  amount: string;
  poolRole?: string | null;
  sourceWalletId?: string | null;
  sourceAccountRef?: string | null;
  settlementInternalTransactionId?: string | null;
  settlementReferenceNo?: string | null;
  reason?: string | null;
  traceId?: string | null;
  metadata?: string | null;
  reimbursedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  asset?: { code: string; network?: string | null; type?: string | null } | null;
  sourceWallet?: { walletNo: string; walletRole?: string | null } | null;
  feeOccurrence?: { id: string; feeNo: string; feeType: string; status: string } | null;
  settlementInternalTransaction?: { id: string; internalTxNo: string } | null;
};

const TreasuryResourceDetailPage = ({
  resourceType,
}: {
  resourceType: TreasuryResourceType;
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const config = useMemo(() => getTreasuryResourceConfig(resourceType), [resourceType]);
  const [detail, setDetail] = useState<FeeOccurrenceDetail | ReimbursementObligationDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [obligationForm, setObligationForm] = useState({
    status: 'REIMBURSED',
    settlementInternalTransactionId: '',
    settlementReferenceNo: '',
    reason: '',
  });

  const canCancelFee = hasAnyPermission([PERMISSIONS.FEE_OCCURRENCES_CANCEL]);
  const canUpdateObligation = hasAnyPermission([
    PERMISSIONS.REIMBURSEMENT_OBLIGATIONS_WRITE,
  ]);

  const fetchDetail = async () => {
    if (!id) {
      setError('Detail id is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}${config.endpoint}/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to load ${config.detailTitle}.`));
      }
      const result = (await response.json()) as FeeOccurrenceDetail | ReimbursementObligationDetail;
      setDetail(result);
      if (resourceType === 'reimbursement-obligations') {
        const next = result as ReimbursementObligationDetail;
        setObligationForm({
          status: next.status === 'OPEN' ? 'REIMBURSED' : next.status,
          settlementInternalTransactionId: next.settlementInternalTransactionId || '',
          settlementReferenceNo: next.settlementReferenceNo || '',
          reason: '',
        });
      }
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : `Failed to load ${config.detailTitle}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, resourceType]);

  const submitFeeCancel = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/fee-occurrences/${id}/cancel`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: cancelReason || undefined }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to cancel fee occurrence.'));
      }
      setMessage('Fee occurrence cancelled successfully.');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to cancel fee occurrence.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitObligationUpdate = async () => {
    if (!id) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reimbursement-obligations/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: obligationForm.status,
            settlementInternalTransactionId:
              obligationForm.settlementInternalTransactionId || undefined,
            settlementReferenceNo:
              obligationForm.settlementReferenceNo || undefined,
            reason: obligationForm.reason || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to update reimbursement obligation.'),
        );
      }
      setMessage('Reimbursement obligation updated successfully.');
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error ? e.message : 'Failed to update reimbursement obligation.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
        <RefreshCw size={28} className="animate-spin text-brand-primary" />
        <p className="text-sm text-gray-500">Loading detail...</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error || 'Detail not found.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(config.listPath)}
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{config.detailTitle}</h1>
            <p className="mt-1 text-sm text-gray-500">{config.description}</p>
          </div>
        </div>
        <button
          onClick={() => void fetchDetail()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {resourceType === 'fee-occurrences' ? (
        <>
          {(() => {
            const item = detail as FeeOccurrenceDetail;
            return (
              <>
                <DetailCard title="Fee Occurrence">
                  <InfoField label="Fee No" value={item.feeNo} mono />
                  <InfoField label="Status" value={<StatusBadge value={item.status} />} />
                  <InfoField label="Fee Type" value={item.feeType} />
                  <InfoField
                    label="Asset"
                    value={
                      item.asset
                        ? `${item.asset.code}${item.asset.network ? ` · ${item.asset.network}` : ''}`
                        : '-'
                    }
                  />
                  <InfoField label="Amount" value={item.amount} />
                  <InfoField label="Payer" value={item.payer} />
                  <InfoField label="Charged To Customer" value={String(Boolean(item.chargedToCustomer))} />
                  <InfoField label="Reimbursement Impact" value={item.reimbursementImpact} />
                  <InfoField label="Pool Role" value={item.poolRole} />
                  <InfoField label="Created At" value={formatDateTime(item.createdAt)} />
                  <InfoField label="Updated At" value={formatDateTime(item.updatedAt)} />
                </DetailCard>
                <DetailCard title="Links & Evidence" columns={2}>
                  <InfoField label="Source Entity Type" value={item.sourceEntityType} />
                  <InfoField label="Source Entity Id" value={item.sourceEntityId} mono />
                  <InfoField label="Source Entity No" value={item.sourceEntityNo} />
                  <InfoField label="Source Wallet Id" value={item.sourceWalletId} mono />
                  <InfoField
                    label="Source Wallet"
                    value={item.sourceWallet?.walletNo || '-'}
                  />
                  <InfoField label="Source Account Ref" value={item.sourceAccountRef} />
                  <InfoField label="Related Entity Type" value={item.relatedEntityType} />
                  <InfoField label="Related Entity Id" value={item.relatedEntityId} mono />
                  <InfoField label="Related Entity No" value={item.relatedEntityNo} />
                  <InfoField label="Evidence Ref" value={item.evidenceRef} />
                  <InfoField label="Trace Id" value={item.traceId} mono />
                  <InfoField
                    label="Linked Reimbursement"
                    value={
                      item.reimbursementObligation
                        ? `${item.reimbursementObligation.obligationNo} · ${item.reimbursementObligation.status}`
                        : '-'
                    }
                  />
                </DetailCard>
                <DetailCard title="Metadata" columns={1}>
                  <JsonBlock title="Metadata JSON" value={item.metadata ? JSON.parse(item.metadata) : {}} />
                </DetailCard>
                {canCancelFee && item.status !== 'CANCELLED' ? (
                  <ActionCard
                    title="Cancel Fee Occurrence"
                    description="Use this only when the platform-borne cost record was created in error."
                  >
                    <textarea
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      rows={4}
                      placeholder="Cancellation reason"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void submitFeeCancel()}
                        disabled={submitting}
                        className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                      >
                        {submitting ? 'Cancelling...' : 'Cancel Fee Occurrence'}
                      </button>
                    </div>
                  </ActionCard>
                ) : null}
              </>
            );
          })()}
        </>
      ) : (
        <>
          {(() => {
            const item = detail as ReimbursementObligationDetail;
            return (
              <>
                <DetailCard title="Reimbursement Obligation">
                  <InfoField label="Obligation No" value={item.obligationNo} mono />
                  <InfoField label="Status" value={<StatusBadge value={item.status} />} />
                  <InfoField
                    label="Asset"
                    value={
                      item.asset
                        ? `${item.asset.code}${item.asset.network ? ` · ${item.asset.network}` : ''}`
                        : '-'
                    }
                  />
                  <InfoField label="Amount" value={item.amount} />
                  <InfoField label="Pool Role" value={item.poolRole} />
                  <InfoField label="Source Wallet" value={item.sourceWallet?.walletNo || '-'} />
                  <InfoField label="Source Account Ref" value={item.sourceAccountRef} />
                  <InfoField label="Reason" value={item.reason} />
                  <InfoField label="Trace Id" value={item.traceId} mono />
                  <InfoField label="Created At" value={formatDateTime(item.createdAt)} />
                  <InfoField label="Updated At" value={formatDateTime(item.updatedAt)} />
                  <InfoField label="Reimbursed At" value={formatDateTime(item.reimbursedAt)} />
                  <InfoField label="Cancelled At" value={formatDateTime(item.cancelledAt)} />
                </DetailCard>
                <DetailCard title="Settlement & Links" columns={2}>
                  <InfoField
                    label="Fee Occurrence"
                    value={
                      item.feeOccurrence
                        ? `${item.feeOccurrence.feeNo} · ${item.feeOccurrence.feeType}`
                        : '-'
                    }
                  />
                  <InfoField
                    label="Settlement Internal Tx"
                    value={
                      item.settlementInternalTransaction?.internalTxNo ||
                      item.settlementInternalTransactionId ||
                      '-'
                    }
                  />
                  <InfoField label="Settlement Reference No" value={item.settlementReferenceNo} />
                </DetailCard>
                <DetailCard title="Metadata" columns={1}>
                  <JsonBlock title="Metadata JSON" value={item.metadata ? JSON.parse(item.metadata) : {}} />
                </DetailCard>
                {canUpdateObligation && item.status === 'OPEN' ? (
                  <ActionCard
                    title="Update Obligation Status"
                    description="Close the obligation after the platform replenishes the safeguarded pool."
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <select
                        value={obligationForm.status}
                        onChange={(event) =>
                          setObligationForm((prev) => ({
                            ...prev,
                            status: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="REIMBURSED">REIMBURSED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                      <input
                        value={obligationForm.settlementInternalTransactionId}
                        onChange={(event) =>
                          setObligationForm((prev) => ({
                            ...prev,
                            settlementInternalTransactionId: event.target.value,
                          }))
                        }
                        placeholder="Settlement Internal Transaction Id"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={obligationForm.settlementReferenceNo}
                        onChange={(event) =>
                          setObligationForm((prev) => ({
                            ...prev,
                            settlementReferenceNo: event.target.value,
                          }))
                        }
                        placeholder="Settlement Reference No"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <input
                        value={obligationForm.reason}
                        onChange={(event) =>
                          setObligationForm((prev) => ({
                            ...prev,
                            reason: event.target.value,
                          }))
                        }
                        placeholder="Reason"
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void submitObligationUpdate()}
                        disabled={submitting}
                        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
                      >
                        {submitting ? 'Updating...' : 'Update Obligation'}
                      </button>
                    </div>
                  </ActionCard>
                ) : null}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default TreasuryResourceDetailPage;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';

type InternalFundBrief = {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  txHash?: string | null;
  createdAt: string;
};

type AuditLog = {
  id: string;
  operatorId: string;
  oldStatus: string;
  newStatus: string;
  reason?: string | null;
  createdAt: string;
};

type InternalTransactionDetailData = {
  id: string;
  internalTxNo: string;
  type: string;
  status: string;
  approvalStatus?: string;
  makerUserId?: string | null;
  checkerUserId?: string | null;
  checkedAt?: string | null;
  reviewReason?: string | null;
  approvalCase?: {
    id: string;
    approvalNo?: string | null;
    status?: string | null;
    actionType?: string | null;
  } | null;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  amount: string;
  feeAmount: string;
  netAmount: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  fromIban?: string | null;
  toIban?: string | null;
  createdAt: string;
  completedAt?: string | null;
  statusHistory?: string | null;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
    decimals?: number;
  };
  funds: InternalFundBrief[];
  auditLogs: AuditLog[];
};

const InternalTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [data, setData] = useState<InternalTransactionDetailData | null>(null);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/${id}`,
      );

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to load internal transaction detail.'),
        );
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch internal transaction detail', error);
      setError(
        error instanceof Error ? error.message : 'Failed to load internal transaction detail.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const parsedHistory = useMemo(() => {
    if (!data?.statusHistory) return [] as Array<{ status: string; timestamp: string; note?: string }>;
    try {
      const parsed = JSON.parse(data.statusHistory);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [data?.statusHistory]);

  const canReview =
    data?.sourceType === 'INTERNAL_MANUAL' &&
    data?.status === 'INTERNAL_FUNDS_PENDING' &&
    (data?.approvalStatus || 'APPROVED') === 'PENDING' &&
    !data?.approvalCase?.id;

  const handleReview = async (action: 'APPROVE' | 'REJECT') => {
    if (!id) return;
    let reason: string | undefined;
    if (action === 'REJECT') {
      const input = window.prompt('Reject reason');
      if (!input || input.trim().length < 2) {
        alert('Reject reason is required');
        return;
      }
      reason = input.trim();
    } else {
      const input = window.prompt('Approve note (optional)');
      reason = input?.trim() || undefined;
    }

    setReviewing(true);
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transactions/${id}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, reason }),
      });

      if (!response.ok) {
        setError(await getApiErrorMessage(response, 'Review failed.'));
        return;
      }

      await fetchDetail();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to review internal transaction', error);
      setError(error instanceof Error ? error.message : 'Review failed.');
    } finally {
      setReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading internal transaction...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/exchange/internal-transactions')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Internal Transactions
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const approvalStatus = data.approvalStatus || 'APPROVED';

  return (
    <div className="flex h-full flex-col">
      {/* Nav Header */}
      <DetailPageHeader
        title="Internal Transaction"
        subtitle={`${data.internalTxNo} · ${data.type}`}
        onBack={() => navigate('/exchange/internal-transactions')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Internal Transactions"
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.internalTxNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={data.status} />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Approval
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={approvalStatus} />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Type
                </span>
                <span className="text-adm-t1">{data.type}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Amount
                </span>
                <span className="font-semibold text-adm-t1">
                  {formatAssetAmount(data.amount, data.asset?.decimals)}{' '}
                  {data.asset?.code || ''}
                </span>
              </div>
            </div>
          </div>

          {/* Error notice */}
          {error ? (
            <div className="bg-adm-red/6 px-6 py-3 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          ) : null}

          {/* 2. Transaction Snapshot */}
          <div className="p-6">
            <DetailCard title="Transaction Snapshot" columns={2}>
              <InfoField
                label="Source"
                value={`${data.sourceType} / ${data.sourceNo || data.sourceId}`}
                mono
              />
              <InfoField
                label="Owner"
                value={`${data.ownerType} / ${data.ownerNo || data.ownerId}`}
                mono
              />
              <InfoField label="Asset" value={data.asset?.code ?? null} />
              <InfoField
                label="Amount"
                value={formatAssetAmount(data.amount, data.asset?.decimals)}
                mono
              />
              <InfoField
                label="Fee"
                value={formatAssetAmount(data.feeAmount, data.asset?.decimals)}
                mono
              />
              <InfoField
                label="Net"
                value={formatAssetAmount(data.netAmount, data.asset?.decimals)}
                mono
              />
              <InfoField label="From" value={data.fromAddress || data.fromIban} mono />
              <InfoField label="To" value={data.toAddress || data.toIban} mono />
              <InfoField label="Maker" value={data.makerUserId ?? null} mono />
              <InfoField label="Checker" value={data.checkerUserId ?? null} mono />
              <InfoField
                label="Approval Case"
                value={data.approvalCase?.approvalNo ?? null}
                mono
              />
              <InfoField
                label="Checked At"
                value={data.checkedAt ? new Date(data.checkedAt).toLocaleString() : null}
                mono
              />
              <InfoField label="Review Reason" value={data.reviewReason ?? null} />
            </DetailCard>
          </div>

          {/* 3. Internal Funds */}
          <div className="p-6">
            <DetailCard title="Internal Funds" columns={1}>
              <div className="divide-y divide-adm-border">
                {data.funds.length === 0 ? (
                  <div className="py-4 font-mono text-[11px] text-adm-t3">
                    No internal funds
                  </div>
                ) : (
                  data.funds.map((fund) => (
                    <button
                      key={fund.id}
                      className="w-full px-1 py-3 text-left transition-colors hover:bg-adm-hover"
                      onClick={() =>
                        navigate(`/dashboard/treasury/internal-funds/${fund.id}`)
                      }
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-mono text-[11px] font-semibold text-adm-amber">
                            {fund.internalFundNo}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-adm-t3">
                            {new Date(fund.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span className="font-mono text-[11px] text-adm-t1">
                            {formatAssetAmount(fund.amount, data.asset?.decimals)}
                          </span>
                          <StatusPill value={fund.status} />
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DetailCard>
          </div>

          {/* 4. Status History */}
          <div className="p-6">
            <DetailCard title="Status History" columns={1}>
              <div className="divide-y divide-adm-border">
                {parsedHistory.length === 0 ? (
                  <div className="py-4 font-mono text-[11px] text-adm-t3">
                    No status history
                  </div>
                ) : (
                  parsedHistory.map((entry, idx) => (
                    <div key={`${entry.timestamp}-${idx}`} className="py-3">
                      <StatusPill value={entry.status} />
                      <div className="mt-1 font-mono text-[10px] text-adm-t3">
                        {entry.timestamp
                          ? new Date(entry.timestamp).toLocaleString()
                          : '-'}
                      </div>
                      {entry.note ? (
                        <div className="mt-1 text-[11px] text-adm-t2">{entry.note}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </DetailCard>
          </div>

          {/* 5. Audit Logs */}
          <div className="p-6">
            <DetailCard title="Audit Logs" columns={1}>
              <div className="divide-y divide-adm-border">
                {data.auditLogs.length === 0 ? (
                  <div className="py-4 font-mono text-[11px] text-adm-t3">
                    No audit logs
                  </div>
                ) : (
                  data.auditLogs.map((log) => (
                    <div key={log.id} className="py-3">
                      <div className="flex items-center gap-2">
                        <StatusPill value={log.oldStatus} />
                        <span className="text-adm-t3">→</span>
                        <StatusPill value={log.newStatus} />
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-adm-t3">
                        {new Date(log.createdAt).toLocaleString()} · {log.operatorId}
                      </div>
                      {log.reason ? (
                        <div className="mt-1 text-[11px] text-adm-t2">{log.reason}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </DetailCard>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* Actions */}
          {canReview && (
            <SidebarGroup title="Actions">
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleReview('APPROVE')}
                  disabled={reviewing}
                  className={adminButtonClass('workflowPrimary')}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReview('REJECT')}
                  disabled={reviewing}
                  className={adminButtonClass('workflowNegative')}
                >
                  Reject
                </button>
              </div>
            </SidebarGroup>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Internal Tx No" value={data.internalTxNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={data.status} />} />
            <SidebarKV label="Approval" value={<StatusPill value={approvalStatus} />} />
            <SidebarKV label="Type" value={data.type} />
            <SidebarKV label="Asset" value={data.asset?.code ?? null} />
            <SidebarKV
              label="Owner"
              mono
              value={`${data.ownerType} / ${data.ownerNo || data.ownerId}`}
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV
              label="Created"
              value={new Date(data.createdAt).toLocaleString()}
              mono
            />
            {data.completedAt && (
              <SidebarKV
                label="Completed"
                value={new Date(data.completedAt).toLocaleString()}
                mono
              />
            )}
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default InternalTransactionDetail;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Clock,
  Coins,
  FileText,
  RefreshCw,
  User,
} from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';

interface SwapTransactionDetailData {
  id: string;
  swapNo: string;
  quoteId?: string | null;
  quoteNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  fromAssetId: string;
  fromAssetCode: string | null;
  fromAmount: string;
  fromAsset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  toAssetId: string;
  toAssetCode: string | null;
  toAmount: string;
  netToAmount?: string | null;
  feeAmount?: string | null;
  feeCurrency?: string | null;
  toAsset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  exchangeRate: string;
  riskDecisionRef?: string | null;
  alertId?: string | null;
  caseId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
  statusHistory: string | null;
}

type WorkflowAction = {
  action: string;
  label: string;
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
};

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load swap detail.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch swap detail', error);
      setError(error instanceof Error ? error.message : 'Failed to load swap detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [id]);

  const handleAction = async (action: string, reason?: string) => {
    if (!id) return;

    setIsSubmitting(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action, reason }),
        },
      );

      if (!response.ok) {
        setError(await getApiErrorMessage(response, 'Action failed.'));
        return;
      }

      const result = await response.json();
      setData((prev) => (prev ? { ...prev, ...result } : result));
      setIsRejectModalOpen(false);
      setRejectReason('');
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Swap action failed', error);
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableActions = useMemo<WorkflowAction[]>(() => {
    if (!data) return [];

    switch (data.status) {
      case 'PENDING_COMPLIANCE':
        return [
          { action: 'success', label: 'Approve Transaction', variant: 'workflowPrimary' },
          { action: 'flag', label: 'Flag for Review', variant: 'workflowSecondary' },
          { action: 'reject', label: 'Reject Transaction', variant: 'workflowNegative' },
        ];
      case 'UNDER_REVIEW':
        return [
          { action: 'success', label: 'Approve Transaction', variant: 'workflowPrimary' },
          { action: 'reject', label: 'Reject Transaction', variant: 'workflowNegative' },
        ];
      default:
        return [];
    }
  }, [data]);

  const parsedHistory = useMemo(() => {
    if (!data?.statusHistory) return [] as Array<Record<string, string>>;
    try {
      const parsed = JSON.parse(data.statusHistory);
      if (!Array.isArray(parsed)) return [];
      return [...parsed].sort(
        (a, b) =>
          new Date(b.timestamp || b.changedAt || 0).getTime() -
          new Date(a.timestamp || a.changedAt || 0).getTime(),
      );
    } catch {
      return [];
    }
  }, [data?.statusHistory]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-brand-primary" size={32} />
        <p className="text-gray-500">Loading swap detail...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/exchange/swap-transactions')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Swaps
          </button>
          <button onClick={() => void fetchData()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ownerNo = data.ownerNo || data.customer?.customerNo || 'N/A';
  const customerName =
    data.customer?.firstName || data.customer?.lastName
      ? `${data.customer?.firstName || ''} ${data.customer?.lastName || ''}`.trim()
      : '-';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <DetailPageHeader
        title="Swap Transaction"
        subtitle={`${data.swapNo} · Owner ${ownerNo}`}
        onBack={() => navigate('/exchange/swap-transactions')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      >
        {renderStatusBadge(data.status)}
        <button
          onClick={() =>
            navigate(`/dashboard/compliance/alerts?sourceType=SWAP&sourceId=${data.id}`)
          }
          className={adminButtonClass('detailUtility')}
        >
          Open Alerts
        </button>
        <button
          onClick={() =>
            navigate(
              `/dashboard/audit/audit-logs?workflowType=SWAP&workflowNo=${encodeURIComponent(
                data.swapNo,
              )}`,
            )
          }
          className={adminButtonClass('detailUtility')}
        >
          Open Audit Trail
        </button>
        {data.caseId ? (
          <button
            onClick={() => navigate(`/dashboard/compliance/cases/${data.caseId}`)}
            className={adminButtonClass('detailUtility')}
          >
            Open Case
          </button>
        ) : null}
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Standard review path runs through Compliance Center. The actions below are retained as
        operator fallback tools.
      </div>

      <DetailCard title="Summary" icon={<FileText size={18} />}>
        <InfoField label="Swap No" value={data.swapNo} mono accent />
        <InfoField label="Owner No" value={ownerNo} mono accent />
        <InfoField label="Customer Name" value={customerName} icon={<User size={14} />} />
        <InfoField label="Pair" value={`${data.fromAsset.code} -> ${data.toAsset.code}`} />
        <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} />
        <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : '-'} />
      </DetailCard>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DetailCard
          title="Sell Asset"
          icon={<ArrowRight size={18} className="rotate-45 text-red-500" />}
          columns={1}
        >
          <InfoField label="Asset Code" value={data.fromAssetCode || data.fromAsset.code} accent />
          <InfoField label="Asset Type" value={data.fromAsset.type} />
          <InfoField
            label="Amount"
            value={`${formatAssetAmount(data.fromAmount, data.fromAsset.decimals)} ${data.fromAsset.code}`}
            highlight
          />
          <InfoField label="Asset ID" value={data.fromAssetId} mono />
        </DetailCard>

        <DetailCard
          title="Buy Asset"
          icon={<ArrowRight size={18} className="-rotate-45 text-green-500" />}
          columns={1}
        >
          <InfoField label="Asset Code" value={data.toAssetCode || data.toAsset.code} accent />
          <InfoField label="Asset Type" value={data.toAsset.type} />
          <InfoField
            label="Gross Amount"
            value={`${formatAssetAmount(data.toAmount, data.toAsset.decimals)} ${data.toAsset.code}`}
          />
          <InfoField
            label="Fee"
            value={`${formatAssetAmount(data.feeAmount || '0', data.toAsset.decimals)} ${data.feeCurrency || data.toAsset.code}`}
          />
          <InfoField
            label="Net Amount"
            value={`${formatAssetAmount(data.netToAmount || data.toAmount, data.toAsset.decimals)} ${data.toAsset.code}`}
            highlight
          />
          <InfoField label="Asset ID" value={data.toAssetId} mono />
        </DetailCard>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DetailCard title="Pricing" icon={<Coins size={18} />} columns={1}>
          <InfoField label="Exchange Rate" value={formatRate8(data.exchangeRate)} highlight />
          <InfoField label="Quote No" value={data.quoteNo || '-'} mono />
          <InfoField label="Quote ID" value={data.quoteId || '-'} mono />
        </DetailCard>

        <DetailCard title="Risk & Trace" icon={<Activity size={18} />} columns={1}>
          <InfoField label="Risk Decision Ref" value={data.riskDecisionRef || '-'} mono />
          <InfoField label="Alert ID" value={data.alertId || '-'} mono />
          <InfoField label="Case ID" value={data.caseId || '-'} mono />
          <InfoField label="Failure Code" value={data.failureCode || '-'} mono />
          <InfoField label="Failure Reason" value={data.failureReason || '-'} />
          <InfoField label="Swap ID" value={data.id} mono />
        </DetailCard>
      </div>

      <DetailCard title="Status & Timings" icon={<Clock size={18} />}>
        <InfoField label="Current Status" value={data.status} highlight />
        <InfoField label="Owner Type" value={data.ownerType} />
        <InfoField label="Owner ID" value={data.ownerId} mono />
        <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} />
      </DetailCard>

      {availableActions.length > 0 ? (
        <ActionSection
          title="Workflow Actions"
          description="These fallback actions remain available, but they do not replace the primary Compliance Center review path."
        >
          <div className="flex flex-wrap gap-3">
            {availableActions.map((actionItem) => (
              <button
                key={actionItem.action}
                type="button"
                onClick={() =>
                  actionItem.action === 'reject'
                    ? setIsRejectModalOpen(true)
                    : void handleAction(actionItem.action)
                }
                disabled={isSubmitting}
                className={adminButtonClass(actionItem.variant)}
              >
                {actionItem.label}
              </button>
            ))}
          </div>
        </ActionSection>
      ) : null}

      <DetailCard title="Status History" icon={<Activity size={18} />} columns={1}>
        <StatusTimeline history={parsedHistory} />
        <p className="mt-3 text-xs text-gray-500">
          Canonical audit events are available in Audit Center for workflow type{' '}
          <span className="font-mono">SWAP</span> and workflow no{' '}
          <span className="font-mono">{data.swapNo}</span>.
        </p>
      </DetailCard>

      {isRejectModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Reject Transaction</h3>
            <p className="mt-2 text-sm text-gray-500">
              Provide a reason for rejecting this transaction. The note will be recorded in the
              audit trail.
            </p>
            <textarea
              className="mt-4 w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              rows={4}
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsRejectModalOpen(false);
                  setRejectReason('');
                }}
                disabled={isSubmitting}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAction('reject', rejectReason)}
                disabled={isSubmitting || !rejectReason.trim()}
                className={adminButtonClass('workflowNegative')}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const StatusTimeline = ({ history }: { history: Array<Record<string, string>> }) => {
  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-gray-400">No history available</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-8 border-l-2 border-gray-100">
      {history.map((item, index) => (
        <div key={`${item.timestamp || item.changedAt || index}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-4 ring-white">
            <div className={`h-3 w-3 rounded-full ${getStatusColor(item.status || '')} shadow-sm`} />
          </span>

          <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50/50 p-4 transition-all duration-200 hover:bg-white hover:shadow-sm sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-bold ${getStatusBadgeStyle(
                    item.status || '',
                  )}`}
                >
                  {item.status || 'UNKNOWN'}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">
                {item.note || item.reason || 'No reason provided'}
              </p>
              <div className="flex items-center gap-2 pt-1 text-xs text-gray-400">
                <User size={12} />
                <span className="font-mono">{item.operator || item.operatorId || 'SYSTEM'}</span>
              </div>
            </div>

            <div className="mt-3 shrink-0 text-right sm:ml-4 sm:mt-0">
              <time className="block rounded border border-gray-100 bg-white px-2 py-1 font-mono text-xs text-gray-500">
                {new Date(item.timestamp || item.changedAt || 0).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const renderStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
    UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
    SUCCESS: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    FAILED: 'bg-red-100 text-red-800',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
        colors[status] || 'bg-gray-100 text-gray-800'
      }`}
    >
      {status}
    </span>
  );
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'SUCCESS':
      return 'bg-green-500';
    case 'FAILED':
    case 'REJECTED':
      return 'bg-red-500';
    case 'PENDING_COMPLIANCE':
      return 'bg-blue-500';
    case 'UNDER_REVIEW':
      return 'bg-yellow-500';
    default:
      return 'bg-gray-300';
  }
};

const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'SUCCESS':
      return 'bg-green-50 border-green-200 text-green-700';
    case 'FAILED':
    case 'REJECTED':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'PENDING_COMPLIANCE':
      return 'bg-blue-50 border-blue-200 text-blue-700';
    case 'UNDER_REVIEW':
      return 'bg-yellow-50 border-yellow-200 text-yellow-700';
    default:
      return 'bg-gray-50 border-gray-200 text-gray-700';
  }
};

export default SwapTransactionDetail;

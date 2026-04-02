import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Clock, Link2, RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SimulationRail, type SimulationRailItem } from '../components/SimulationRail';

type AuditLog = {
  id: string;
  operatorId: string;
  oldStatus: string;
  newStatus: string;
  reason?: string | null;
  createdAt: string;
};

type InternalFundDetailData = {
  id: string;
  internalFundNo: string;
  internalTransactionId: string;
  status: string;
  amount: string;
  feeAmount: string;
  netAmount: string;
  txHash?: string | null;
  confirmations?: number;
  referenceNo?: string | null;
  providerTxnId?: string | null;
  nonce?: string | null;
  blockNo?: string | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  fromIban?: string | null;
  toIban?: string | null;
  sentAt?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory?: string | null;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
    decimals?: number;
  };
  internalTransaction?: {
    id: string;
    internalTxNo: string;
    type: string;
    status: string;
  };
  feeOccurrences?: Array<{
    id: string;
    feeNo: string;
    feeType: string;
    amount: string;
    status?: string | null;
  }>;
  auditLogs: AuditLog[];
};

type ActionItem = {
  action: string;
  label: string;
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-800',
  SIGNING: 'bg-indigo-100 text-indigo-800',
  BROADCASTED: 'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CLEAR: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
  RETURNED: 'bg-purple-100 text-purple-800',
  CANCELLED: 'bg-slate-100 text-slate-800',
};

const getActions = (data: InternalFundDetailData): ActionItem[] => {
  const status = data.status;
  const isFiat = data.asset?.type === 'FIAT';

  if (!isFiat) {
    if (status === 'CREATED') {
      return [
        { action: 'SIGN', label: 'Sign', variant: 'workflowPrimary' },
        { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
      ];
    }
    if (status === 'SIGNING') {
      return [
        { action: 'BROADCAST', label: 'Broadcast', variant: 'workflowPrimary' },
        { action: 'SIGN_FAIL', label: 'Sign Fail', variant: 'workflowNegative' },
        { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
      ];
    }
    if (status === 'BROADCASTED') {
      return [
        { action: 'SEEN_IN_MEMPOOL', label: 'Seen', variant: 'workflowSecondary' },
        { action: 'DROP', label: 'Drop', variant: 'workflowNegative' },
        { action: 'TIMEOUT', label: 'Timeout', variant: 'workflowNegative' },
        { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
      ];
    }
    if (status === 'CONFIRMING') {
      return [
        { action: 'CONFIRM', label: 'Confirm', variant: 'workflowPrimary' },
        { action: 'FAIL', label: 'Fail', variant: 'workflowNegative' },
        { action: 'TIMEOUT', label: 'Timeout', variant: 'workflowNegative' },
        { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
      ];
    }
    if (status === 'CONFIRMED') {
      return [{ action: 'CLEAR', label: 'Clear', variant: 'workflowPrimary' }];
    }
    return [];
  }

  if (status === 'CREATED') {
    return [
      { action: 'SUBMIT', label: 'Submit', variant: 'workflowPrimary' },
      { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
    ];
  }
  if (status === 'CONFIRMING') {
    return [
      { action: 'CONFIRM', label: 'Confirm', variant: 'workflowPrimary' },
      { action: 'FAIL', label: 'Fail', variant: 'workflowNegative' },
      { action: 'TIMEOUT', label: 'Timeout', variant: 'workflowNegative' },
      { action: 'CANCEL', label: 'Cancel', variant: 'workflowNegative' },
    ];
  }
  if (status === 'CONFIRMED') {
    return [
      { action: 'CLEAR', label: 'Clear', variant: 'workflowPrimary' },
      { action: 'RETURN', label: 'Return', variant: 'workflowSecondary' },
    ];
  }
  if (status === 'CLEAR') {
    return [{ action: 'RETURN', label: 'Return', variant: 'workflowSecondary' }];
  }
  return [];
};

function getRailItems(
  data: InternalFundDetailData,
  updating: boolean,
  onAction: (action: string) => void,
): SimulationRailItem[] {
  return getActions(data).map((action) => ({
    id: action.action,
    label: action.label,
    icon: <RefreshCw size={14} />,
    state: 'available',
    onClick: () => onAction(action.action),
    disabled: updating,
    helperText: `${data.status} -> ${action.label}`,
  }));
}

const InternalFundDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [data, setData] = useState<InternalFundDetailData | null>(null);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/${id}`);

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load internal fund detail.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch internal fund detail', error);
      setError(
        error instanceof Error ? error.message : 'Failed to load internal fund detail.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  const handleStatusAction = async (action: string) => {
    if (!id) return;

    setUpdating(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-funds/${id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        setError(await getApiErrorMessage(response, 'Update failed.'));
        return;
      }

      await fetchDetail();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to update internal fund status', error);
      setError(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      setUpdating(false);
    }
  };

  const parsedHistory = useMemo(() => {
    if (!data?.statusHistory) return [] as Array<{ status: string; timestamp: string; note?: string }>;
    try {
      const parsed = JSON.parse(data.statusHistory);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [data?.statusHistory]);

  const railItems = useMemo(
    () => (data ? getRailItems(data, updating, handleStatusAction) : []),
    [data, updating],
  );

  if (loading) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center">
        <RefreshCw className="mb-3 animate-spin text-brand-primary" size={26} />
        <p className="text-gray-500">Loading internal fund...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/dashboard/treasury/internal-funds')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Internal Funds
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <DetailPageHeader
        title="Internal Fund"
        subtitle={`${data.internalFundNo} · ${data.asset?.code || '-'} ${data.asset?.network ? `(${data.asset.network})` : ''}`}
        onBack={() => navigate('/dashboard/treasury/internal-funds')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-800'
          }`}
        >
          {data.status}
        </span>
        {data.internalTransaction?.id ? (
          <button
            onClick={() => navigate(`/exchange/internal-transactions/${data.internalTransaction?.id}`)}
            className={adminButtonClass('detailUtility')}
          >
            Open Internal Transaction
          </button>
        ) : null}
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Summary" icon={<Activity size={18} />}>
        <InfoField label="Internal Fund No" value={data.internalFundNo} mono accent />
        <InfoField label="Internal Tx No" value={data.internalTransaction?.internalTxNo || '-'} mono />
        <InfoField label="Tx Type" value={data.internalTransaction?.type || '-'} />
        <InfoField label="Asset" value={data.asset?.code || '-'} accent />
        <InfoField label="Network" value={data.asset?.network || '-'} />
        <InfoField label="Status" value={data.status} highlight />
        <InfoField
          label="Amount"
          value={formatAssetAmount(data.amount, data.asset?.decimals)}
          highlight
        />
        <InfoField label="Fee" value={formatAssetAmount(data.feeAmount, data.asset?.decimals)} />
        <InfoField label="Net Amount" value={formatAssetAmount(data.netAmount, data.asset?.decimals)} />
      </DetailCard>

      <SimulationRail
        title="Execution Rail"
        description="Advance the internal fund across simulated execution states, similar to payout rails."
        items={railItems}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DetailCard title="Transfer Path" icon={<Clock size={18} />}>
          <InfoField label="From" value={data.fromAddress || data.fromIban || '-'} mono />
          <InfoField label="To" value={data.toAddress || data.toIban || '-'} mono />
          <InfoField label="Reference No" value={data.referenceNo || '-'} mono />
          <InfoField label="Provider Txn ID" value={data.providerTxnId || '-'} mono />
          <InfoField label="Tx Hash" value={data.txHash || '-'} mono />
          <InfoField label="Confirmations" value={String(data.confirmations || 0)} />
        </DetailCard>

        <DetailCard title="Chain / Timing" icon={<Clock size={18} />}>
          <InfoField label="Nonce" value={data.nonce || '-'} mono />
          <InfoField label="Block No" value={data.blockNo || '-'} mono />
          <InfoField label="Gas Used" value={data.gasUsed || '-'} mono />
          <InfoField label="Effective Gas Price" value={data.effectiveGasPrice || '-'} mono />
          <InfoField label="Sent At" value={data.sentAt ? new Date(data.sentAt).toLocaleString() : '-'} />
          <InfoField
            label="Confirmed At"
            value={data.confirmedAt ? new Date(data.confirmedAt).toLocaleString() : '-'}
          />
          <InfoField
            label="Completed At"
            value={data.completedAt ? new Date(data.completedAt).toLocaleString() : '-'}
          />
          <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} />
        </DetailCard>
      </div>

      <ActionSection
        title="Workflow Actions"
        description="These operator actions advance or resolve the internal fund lifecycle."
        emptyText="No available workflow actions"
      >
        {getActions(data).length ? (
          <div className="flex flex-wrap gap-3">
            {getActions(data).map((action) => (
              <button
                key={action.action}
                type="button"
                onClick={() => void handleStatusAction(action.action)}
                disabled={updating}
                className={adminButtonClass(action.variant)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </ActionSection>

      <DetailCard title="Linked Fee Occurrences" icon={<Link2 size={18} />} columns={1}>
        {data.feeOccurrences && data.feeOccurrences.length > 0 ? (
          <div className="space-y-3">
            {data.feeOccurrences.map((fee) => (
              <div key={fee.id} className="rounded-lg border border-admin-border px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-xs text-brand-primary">{fee.feeNo}</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">{fee.feeType}</div>
                  </div>
                  <div className="text-sm text-gray-700">
                    {formatAssetAmount(fee.amount, data.asset?.decimals)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">{fee.status || 'RECORDED'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No linked fee occurrences</div>
        )}
      </DetailCard>

      <DetailCard title="Status History" icon={<Clock size={18} />} columns={1}>
        {parsedHistory.length === 0 ? (
          <div className="text-sm text-gray-500">No status history</div>
        ) : (
          <div className="space-y-3">
            {parsedHistory.map((entry, index) => (
              <div
                key={`${entry.timestamp}-${index}`}
                className="rounded-lg border border-admin-border px-4 py-3"
              >
                <div className="font-medium text-gray-900">{entry.status}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-'}
                </div>
                {entry.note ? <div className="mt-1 text-xs text-gray-500">{entry.note}</div> : null}
              </div>
            ))}
          </div>
        )}
      </DetailCard>

      <DetailCard title="Audit Logs" icon={<Activity size={18} />} columns={1}>
        {data.auditLogs.length === 0 ? (
          <div className="text-sm text-gray-500">No audit logs</div>
        ) : (
          <div className="space-y-3">
            {data.auditLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-admin-border px-4 py-3">
                <div className="font-medium text-gray-900">
                  {log.oldStatus} -&gt; {log.newStatus}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString()} · {log.operatorId}
                </div>
                {log.reason ? <div className="mt-1 text-xs text-gray-500">{log.reason}</div> : null}
              </div>
            ))}
          </div>
        )}
      </DetailCard>
    </div>
  );
};

export default InternalFundDetail;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Link2, RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
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
  auditLogs: AuditLog[];
};

type ActionItem = {
  action: string;
  label: string;
  color: string;
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

function getActions(data: InternalFundDetailData): ActionItem[] {
  const status = data.status;
  const isFiat = data.asset?.type === 'FIAT';
  const actions: ActionItem[] = [];

  if (!isFiat) {
    if (status === 'CREATED') {
      actions.push({ action: 'SIGN', label: 'Sign', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
    } else if (status === 'SIGNING') {
      actions.push({ action: 'BROADCAST', label: 'Broadcast', color: 'bg-indigo-600 hover:bg-indigo-700 text-white' });
      actions.push({ action: 'SIGN_FAIL', label: 'Sign Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
    } else if (status === 'BROADCASTED') {
      actions.push({ action: 'SEEN_IN_MEMPOOL', label: 'Seen', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
      actions.push({ action: 'DROP', label: 'Drop', color: 'bg-red-600 hover:bg-red-700 text-white' });
      actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
    } else if (status === 'CONFIRMING') {
      actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 hover:bg-green-700 text-white' });
      actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
      actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
      actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
    } else if (status === 'CONFIRMED') {
      actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
    }
    return actions;
  }

  if (status === 'CREATED') {
    actions.push({ action: 'SUBMIT', label: 'Submit', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
    actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
  } else if (status === 'CONFIRMING') {
    actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 hover:bg-green-700 text-white' });
    actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
    actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
    actions.push({ action: 'CANCEL', label: 'Cancel', color: 'bg-slate-600 hover:bg-slate-700 text-white' });
  } else if (status === 'CONFIRMED') {
    actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
    actions.push({ action: 'RETURN', label: 'Return', color: 'bg-purple-600 hover:bg-purple-700 text-white' });
  } else if (status === 'CLEAR') {
    actions.push({ action: 'RETURN', label: 'Return', color: 'bg-purple-600 hover:bg-purple-700 text-white' });
  }

  return actions;
}

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

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        alert('Failed to load internal fund detail');
        navigate('/dashboard/treasury/internal-funds');
      }
    } catch (error) {
      console.error('Failed to fetch internal fund detail', error);
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleStatusAction = async (action: string) => {
    setUpdating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/${id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        await fetchDetail();
      } else {
        const err = await response.json();
        alert(`Update failed: ${err.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to update internal fund status', error);
      alert('Network error');
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
      <div className="flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="animate-spin text-brand-primary mb-3" size={26} />
        <p className="text-gray-500">Loading internal fund...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-start justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/dashboard/treasury/internal-funds')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Internal Fund</h1>
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-800'
                }`}
              >
                {data.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500 font-mono">{data.internalFundNo}</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>
                Linked Tx: {data.internalTransaction?.internalTxNo || '-'}
              </span>
              <span>
                Asset: {data.asset?.code || '-'}
                {data.asset?.network ? ` / ${data.asset.network}` : ''}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {data.internalTransaction?.id ? (
            <button
              onClick={() => navigate(`/exchange/internal-transactions/${data.internalTransaction?.id}`)}
              className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-brand-primary hover:bg-gray-50"
            >
              <Link2 size={16} />
              View Internal Tx
            </button>
          ) : null}
          <button
            onClick={fetchDetail}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <SimulationRail
        title="Execution Rail"
        description="Advance the internal fund across simulated execution states, similar to payout rails."
        items={railItems}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoCard label="Internal Tx" value={data.internalTransaction?.internalTxNo || '-'} />
        <InfoCard label="Tx Type" value={data.internalTransaction?.type || '-'} />
        <InfoCard
          label="Asset"
          value={`${data.asset?.code || '-'} ${data.asset?.network ? `(${data.asset.network})` : ''}`}
        />
        <InfoCard
          label="Amount"
          value={formatAssetAmount(data.amount, data.asset?.decimals)}
        />
        <InfoCard label="Fee" value={formatAssetAmount(data.feeAmount, data.asset?.decimals)} />
        <InfoCard label="Net" value={formatAssetAmount(data.netAmount, data.asset?.decimals)} />
        <InfoCard label="From" value={data.fromAddress || data.fromIban || '-'} />
        <InfoCard label="To" value={data.toAddress || data.toIban || '-'} />
        <InfoCard label="Tx Hash" value={data.txHash || '-'} />
        <InfoCard label="Confirmations" value={String(data.confirmations || 0)} />
        <InfoCard label="Nonce" value={data.nonce || '-'} />
        <InfoCard label="Block No" value={data.blockNo || '-'} />
        <InfoCard label="Gas Used" value={data.gasUsed || '-'} />
        <InfoCard label="Effective Gas Price" value={data.effectiveGasPrice || '-'} />
      </div>

      <section className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-admin-border">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Status History</h2>
        </div>
        <div className="divide-y divide-admin-border">
          {parsedHistory.length === 0 ? (
            <div className="px-5 py-6 text-sm text-gray-500">No status history</div>
          ) : (
            parsedHistory.map((entry, idx) => (
              <div key={`${entry.timestamp}-${idx}`} className="px-5 py-4 text-sm">
                <div className="font-medium text-gray-900">{entry.status}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-'}
                </div>
                {entry.note ? <div className="text-xs text-gray-500 mt-1">{entry.note}</div> : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-admin-border">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Audit Logs</h2>
        </div>
        <div className="divide-y divide-admin-border">
          {data.auditLogs.length === 0 ? (
            <div className="px-5 py-6 text-sm text-gray-500">No audit logs</div>
          ) : (
            data.auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-4 text-sm">
                <div className="font-medium text-gray-900">
                  {log.oldStatus} → {log.newStatus}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(log.createdAt).toLocaleString()} · {log.operatorId}
                </div>
                {log.reason ? <div className="text-xs text-gray-500 mt-1">{log.reason}</div> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-admin-border p-4">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-900 mt-2 break-all">{value || '-'}</div>
    </div>
  );
}

export default InternalFundDetail;

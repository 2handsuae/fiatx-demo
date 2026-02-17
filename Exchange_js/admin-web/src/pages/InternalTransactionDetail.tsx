import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';

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
  };
  funds: InternalFundBrief[];
  auditLogs: AuditLog[];
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-orange-100 text-orange-800',
};

const InternalTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InternalTransactionDetailData | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-transactions/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        alert('Failed to load internal transaction detail');
        navigate('/exchange/internal-transactions');
      }
    } catch (error) {
      console.error('Failed to fetch internal transaction detail', error);
      alert('Network error');
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px]">
        <RefreshCw className="animate-spin text-brand-primary mb-3" size={26} />
        <p className="text-gray-500">Loading internal transaction...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-start justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/exchange/internal-transactions')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Internal Transaction</h1>
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-800'
                }`}
              >
                {data.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500 font-mono">
              {data.internalTxNo} · {data.type}
            </div>
          </div>
        </div>
        <button
          onClick={fetchDetail}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoCard label="Source" value={`${data.sourceType} / ${data.sourceNo || data.sourceId}`} />
        <InfoCard label="Owner" value={`${data.ownerType} / ${data.ownerNo || data.ownerId}`} />
        <InfoCard
          label="Asset"
          value={`${data.asset?.code || '-'} ${data.asset?.network ? `(${data.asset.network})` : ''}`}
        />
        <InfoCard
          label="Amount"
          value={`${Number(data.amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8,
          })}`}
        />
        <InfoCard label="Fee" value={data.feeAmount || '0'} />
        <InfoCard label="Net" value={data.netAmount || '0'} />
        <InfoCard label="From" value={data.fromAddress || data.fromIban || '-'} />
        <InfoCard label="To" value={data.toAddress || data.toIban || '-'} />
      </div>

      <section className="bg-white rounded-xl border border-admin-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-admin-border">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Internal Funds</h2>
        </div>
        <div className="divide-y divide-admin-border">
          {data.funds.length === 0 ? (
            <div className="px-5 py-6 text-sm text-gray-500">No internal funds</div>
          ) : (
            data.funds.map((fund) => (
              <button
                key={fund.id}
                className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
                onClick={() => navigate(`/dashboard/treasury/internal-funds/${fund.id}`)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-xs text-brand-primary font-semibold">{fund.internalFundNo}</div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(fund.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">{fund.amount}</div>
                    <div className="text-xs text-gray-500">{fund.status}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

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

export default InternalTransactionDetail;

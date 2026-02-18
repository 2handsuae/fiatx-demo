import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

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

const STATUS_COLORS: Record<string, string> = {
  INTERNAL_FUNDS_PENDING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-orange-100 text-orange-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const APPROVAL_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

const InternalTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
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

  const canReview =
    data?.sourceType === 'INTERNAL_MANUAL' &&
    data?.status === 'INTERNAL_FUNDS_PENDING' &&
    (data?.approvalStatus || 'APPROVED') === 'PENDING';

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
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/internal-transactions/${id}/review`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, reason }),
      });

      if (!response.ok) {
        const err = await response.json();
        alert(`Review failed: ${err.message || 'Unknown error'}`);
        return;
      }

      await fetchDetail();
    } catch (error) {
      console.error('Failed to review internal transaction', error);
      alert('Network error');
    } finally {
      setReviewing(false);
    }
  };

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
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  APPROVAL_COLORS[data.approvalStatus || 'APPROVED'] ||
                  'bg-gray-100 text-gray-800'
                }`}
              >
                {data.approvalStatus || 'APPROVED'}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500 font-mono">
              {data.internalTxNo} · {data.type}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canReview ? (
            <>
              <button
                onClick={() => handleReview('APPROVE')}
                disabled={reviewing}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
              >
                Approve
              </button>
              <button
                onClick={() => handleReview('REJECT')}
                disabled={reviewing}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
              >
                Reject
              </button>
            </>
          ) : null}
          <button
            onClick={fetchDetail}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
          >
            <RefreshCw size={18} />
          </button>
        </div>
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
          value={formatAssetAmount(data.amount, data.asset?.decimals)}
        />
        <InfoCard label="Fee" value={formatAssetAmount(data.feeAmount, data.asset?.decimals)} />
        <InfoCard label="Net" value={formatAssetAmount(data.netAmount, data.asset?.decimals)} />
        <InfoCard label="From" value={data.fromAddress || data.fromIban || '-'} />
        <InfoCard label="To" value={data.toAddress || data.toIban || '-'} />
        <InfoCard label="Maker" value={data.makerUserId || '-'} />
        <InfoCard label="Checker" value={data.checkerUserId || '-'} />
        <InfoCard
          label="Checked At"
          value={data.checkedAt ? new Date(data.checkedAt).toLocaleString() : '-'}
        />
        <InfoCard label="Review Reason" value={data.reviewReason || '-'} />
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
                    <div className="text-sm font-medium text-gray-900">
                      {formatAssetAmount(fund.amount, data.asset?.decimals)}
                    </div>
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

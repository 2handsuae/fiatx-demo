import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
} from '../components/compliance/DetailPageComponents';

type SettlementFund = {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  createdAt: string;
  completedAt?: string | null;
};

type SettlementInternalTransaction = {
  id: string;
  internalTxNo: string;
  type: string;
  status: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
  createdAt: string;
  completedAt?: string | null;
  funds: SettlementFund[];
};

type SettlementItem = {
  id: string;
  assetCode: string;
  status: string;
  totalInAmount: string;
  totalOutAmount: string;
  netAmount: string;
  internalType?: string | null;
  outstandingCount: number;
  closedOutstandingCount: number;
  createdAt: string;
  closedAt?: string | null;
  asset?: {
    code: string;
    decimals?: number;
    network?: string | null;
  };
  internalTransaction?: SettlementInternalTransaction | null;
};

type OutstandingSettlementDetailData = {
  id: string;
  settlementNo: string;
  sourceType: string;
  status: string;
  requestId?: string | null;
  rangeStartAt?: string | null;
  cutoffAt: string;
  note?: string | null;
  totalOutstandingCount: number;
  closedOutstandingCount: number;
  totalAssetCount: number;
  closedAssetCount: number;
  createdAt: string;
  completedAt?: string | null;
  outstandingSnapshot?: {
    open: number;
    locked: number;
    closed: number;
  };
  items: SettlementItem[];
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-slate-100 text-slate-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  NETTED: 'bg-teal-100 text-teal-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    <span className="text-sm text-gray-900 break-all">{value}</span>
  </div>
);

const OutstandingSettlementDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState<OutstandingSettlementDetailData | null>(null);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstanding-settlements/${id}`,
      );

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to load settlement detail.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch settlement detail', error);
      setError(error instanceof Error ? error.message : 'Failed to load settlement detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstanding-settlements/${id}/sync`,
        {
          method: 'POST',
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Sync failed.'));
      }
      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to sync settlement', error);
      setError(error instanceof Error ? error.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const progressText = useMemo(() => {
    if (!data) return '-';
    return `Assets ${data.closedAssetCount}/${data.totalAssetCount} · Outstanding ${data.closedOutstandingCount}/${data.totalOutstandingCount}`;
  }, [data]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[360px] text-gray-500">
        <RefreshCw className="animate-spin mb-2 text-brand-primary" size={26} />
        Loading outstanding settlement detail...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/reconciliation/outstanding-settlements')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Outstanding Settlements
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <DetailPageHeader
        title="Outstanding Settlement"
        subtitle={`${data.settlementNo} · ${progressText}`}
        onBack={() => navigate('/dashboard/reconciliation/outstanding-settlements')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Outstanding Settlements"
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            STATUS_COLORS[data.status] || 'bg-gray-100 text-gray-700'
          }`}
        >
          {data.status}
        </span>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ActionSection
        title="Workflow Actions"
        description="Settlement workflow actions stay separate from the snapshot cards."
      >
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={adminButtonClass('workflowPrimary')}
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </ActionSection>

      <DetailCard title="Settlement Snapshot" columns={1}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Field label="Settlement No" value={data.settlementNo} />
          <Field label="Status" value={data.status} />
          <Field label="Source Type" value={data.sourceType} />
          <Field label="Request Id" value={data.requestId || '-'} />
          <Field
            label="Range Start"
            value={data.rangeStartAt ? new Date(data.rangeStartAt).toLocaleString('en-US') : '-'}
          />
          <Field label="Cutoff At" value={new Date(data.cutoffAt).toLocaleString('en-US')} />
          <Field label="Created At" value={new Date(data.createdAt).toLocaleString('en-US')} />
          <Field
            label="Completed At"
            value={data.completedAt ? new Date(data.completedAt).toLocaleString('en-US') : '-'}
          />
          <Field label="Note" value={data.note || '-'} />
          <Field
            label="Asset Progress"
            value={`${data.closedAssetCount} / ${data.totalAssetCount}`}
          />
          <Field
            label="Outstanding Progress"
            value={`${data.closedOutstandingCount} / ${data.totalOutstandingCount}`}
          />
          <Field
            label="Outstanding Snapshot"
            value={`OPEN ${data.outstandingSnapshot?.open || 0} · LOCKED ${data.outstandingSnapshot?.locked || 0} · CLOSED ${data.outstandingSnapshot?.closed || 0}`}
          />
        </div>
      </DetailCard>

      <DetailCard title="Settlement Items" columns={1}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-5 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                <th className="px-5 py-3 font-medium text-gray-500 uppercase tracking-wider">IN / OUT / NET</th>
                <th className="px-5 py-3 font-medium text-gray-500 uppercase tracking-wider">Item Status</th>
                <th className="px-5 py-3 font-medium text-gray-500 uppercase tracking-wider">Outstanding</th>
                <th className="px-5 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Tx / Funds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-500">
                    No settlement items
                  </td>
                </tr>
              ) : (
                data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-mono text-xs text-gray-800">{item.assetCode || item.asset?.code || '-'}</div>
                      <div className="text-xs text-gray-500 mt-1">{item.asset?.network || '-'}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-xs text-gray-700">
                        IN: {formatAssetAmount(item.totalInAmount, item.asset?.decimals)}
                      </div>
                      <div className="text-xs text-gray-700">
                        OUT: {formatAssetAmount(item.totalOutAmount, item.asset?.decimals)}
                      </div>
                      <div className="text-xs text-gray-900 font-semibold mt-1">
                        NET: {formatAssetAmount(item.netAmount, item.asset?.decimals)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          ITEM_STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {item.status}
                      </span>
                      <div className="text-xs text-gray-500 mt-1">{item.internalType || '-'}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-xs text-gray-800">
                        {item.closedOutstandingCount} / {item.outstandingCount}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {item.closedAt ? `closed at ${new Date(item.closedAt).toLocaleString('en-US')}` : '-'}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {item.internalTransaction ? (
                        <>
                          <button
                            className="font-mono text-xs text-brand-primary hover:text-blue-800"
                            onClick={() =>
                              navigate(`/exchange/internal-transactions/${item.internalTransaction?.id}`)
                            }
                          >
                            {item.internalTransaction.internalTxNo}
                          </button>
                          <div className="text-xs text-gray-500 mt-1">
                            {item.internalTransaction.type} · {item.internalTransaction.status}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {item.internalTransaction.funds
                              .map((fund) => `${fund.internalFundNo}:${fund.status}`)
                              .join(' | ') || 'No funds'}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-500">No internal execution</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DetailCard>
    </div>
  );
};

export default OutstandingSettlementDetail;

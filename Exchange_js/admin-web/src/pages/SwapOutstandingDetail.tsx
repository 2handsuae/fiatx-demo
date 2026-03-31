import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader } from '../components/compliance/DetailPageComponents';

interface SwapOutstandingDetailData {
  id: string;
  outstandingNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerType: string;
  ownerNo: string | null;
  direction: string;
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  swapTransaction?: {
    swapNo: string | null;
    quoteNo: string | null;
    status: string;
    fromAmount: string;
    toAmount: string;
    exchangeRate: string;
    fromAsset?: { code?: string | null; decimals?: number | null } | null;
    toAsset?: { code?: string | null; decimals?: number | null } | null;
  } | null;
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    <span className="text-sm text-gray-900 break-all">{value}</span>
  </div>
);

const SwapOutstandingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SwapOutstandingDetailData | null>(null);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings/${id}`,
      );

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to load outstanding detail.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch outstanding detail', error);
      setError(error instanceof Error ? error.message : 'Failed to load outstanding detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[360px] text-gray-500">
        <RefreshCw className="animate-spin mb-2 text-brand-primary" size={26} />
        Loading outstanding detail...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/reconciliation/outstandings')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Outstandings
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
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <DetailPageHeader
        title="Swap Outstanding"
        subtitle={`${data.outstandingNo || 'N/A'} · ${data.sourceType} / ${data.sourceNo || 'N/A'}`}
        onBack={() => navigate('/dashboard/reconciliation/outstandings')}
        onRefresh={() => void fetchDetail()}
        backLabel="Back to Outstandings"
      >
        <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
          {data.status}
        </span>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Outstanding Snapshot" columns={1}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Outstanding No" value={data.outstandingNo || 'N/A'} />
          <Field label="Status" value={data.status} />
          <Field label="Direction" value={data.direction} />
          <Field label="Owner" value={`${data.ownerType} / ${data.ownerNo || 'N/A'}`} />
          <Field label="Source" value={`${data.sourceType} / ${data.sourceNo || 'N/A'}`} />
          <Field label="Asset" value={data.assetCode || data.asset?.code || 'N/A'} />
          <Field label="Amount" value={formatAssetAmount(data.amount, data.asset?.decimals)} />
          <Field label="Created At" value={new Date(data.createdAt).toLocaleString('en-US')} />
          <Field label="Updated At" value={new Date(data.updatedAt).toLocaleString('en-US')} />
        </div>
      </DetailCard>

      <DetailCard title="Linked Swap" columns={1}>
        {data.swapTransaction ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Swap No" value={data.swapTransaction.swapNo || 'N/A'} />
            <Field label="Quote No" value={data.swapTransaction.quoteNo || 'N/A'} />
            <Field label="Swap Status" value={data.swapTransaction.status} />
            <Field
              label="Pair"
              value={`${data.swapTransaction.fromAsset?.code || '-'} -> ${data.swapTransaction.toAsset?.code || '-'}`}
            />
            <Field
              label="Amounts"
              value={`${formatAssetAmount(data.swapTransaction.fromAmount, data.swapTransaction.fromAsset?.decimals)} -> ${formatAssetAmount(data.swapTransaction.toAmount, data.swapTransaction.toAsset?.decimals)}`}
            />
            <Field label="Exchange Rate" value={formatRate8(data.swapTransaction.exchangeRate)} />
          </div>
        ) : (
          <div className="text-sm text-gray-500">No swap linked to this outstanding.</div>
        )}
      </DetailCard>
    </div>
  );
};

export default SwapOutstandingDetail;

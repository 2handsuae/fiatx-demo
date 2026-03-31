import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowRightLeft,
  Briefcase,
  DollarSign,
  Hash,
  Link as LinkIcon,
  RefreshCw,
} from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';

interface ClearingDetailData {
  id: string;
  clearingNo: string;
  clearingType: string;
  description: string | null;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  outAssetId: string;
  outAssetNo?: string | null;
  outAssetDecimals?: number | null;
  outAmount: string;
  inAssetId: string;
  inAssetNo?: string | null;
  inAssetDecimals?: number | null;
  inAmount: string;
  feeAssetId: string | null;
  feeAssetNo?: string | null;
  feeAssetDecimals?: number | null;
  feeAmount: string | null;
  feeMethod: string;
  outPayoutId: string | null;
  outPayoutNo?: string | null;
  inPayinId: string | null;
  inPayinNo?: string | null;
  clearingStatus: string;
  createdAt: string;
  updatedAt: string;
}

const ClearingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClearingDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/clearings/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch clearing details.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to fetch clearing details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-brand-primary" size={48} />
        <p className="text-gray-500">Loading clearing detail...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/clearing/management')} className={adminButtonClass('detailUtility')}>
            Back to Clearing
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
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <DetailPageHeader
        title="Clearing Detail"
        subtitle={`${data.clearingNo} · ${data.sourceType}`}
        onBack={() => navigate('/clearing/management')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            data.clearingStatus === 'SETTLED'
              ? 'bg-green-100 text-green-800'
              : data.clearingStatus === 'OPEN'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-800'
          }`}
        >
          {data.clearingStatus}
        </span>
        <button
          onClick={() => navigate(`/clearing/details?clearingId=${data.id}`)}
          className={adminButtonClass('detailUtility')}
        >
          View Lines
        </button>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Summary" icon={<Hash size={18} />}>
        <InfoField label="Clearing No" value={data.clearingNo} mono accent />
        <InfoField label="Clearing ID" value={data.id} mono />
        <InfoField label="Type" value={data.clearingType} />
        <InfoField label="Description" value={data.description} />
        <InfoField label="Created At" value={formatDate(data.createdAt)} />
        <InfoField label="Updated At" value={formatDate(data.updatedAt)} />
      </DetailCard>

      <DetailCard title="Business Source" icon={<Briefcase size={18} />}>
        <InfoField label="Source Type" value={data.sourceType} accent />
        <InfoField label="Source No" value={data.sourceNo} mono />
        <InfoField label="Source ID" value={data.sourceId} mono />
        <InfoField label="Status" value={data.clearingStatus} highlight />
      </DetailCard>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DetailCard title="Outbound" icon={<ArrowRightLeft size={18} />} columns={1}>
          <InfoField label="Out Asset No" value={data.outAssetNo} accent />
          <InfoField
            label="Out Amount"
            value={formatAssetAmount(data.outAmount, data.outAssetDecimals)}
            highlight
          />
          <InfoField label="Out Asset ID" value={data.outAssetId} mono />
        </DetailCard>

        <DetailCard title="Inbound" icon={<ArrowRightLeft size={18} />} columns={1}>
          <InfoField label="In Asset No" value={data.inAssetNo} accent />
          <InfoField
            label="In Amount"
            value={formatAssetAmount(data.inAmount, data.inAssetDecimals)}
            highlight
          />
          <InfoField label="In Asset ID" value={data.inAssetId} mono />
        </DetailCard>
      </div>

      <DetailCard title="Fee Processing" icon={<DollarSign size={18} />}>
        <InfoField label="Fee Asset No" value={data.feeAssetNo} accent />
        <InfoField
          label="Fee Amount"
          value={formatAssetAmount(data.feeAmount, data.feeAssetDecimals)}
        />
        <InfoField label="Fee Method" value={data.feeMethod} />
        <InfoField label="Fee Asset ID" value={data.feeAssetId} mono />
      </DetailCard>

      <DetailCard title="Physical Funds Linkage" icon={<LinkIcon size={18} />}>
        <InfoField
          label="Out Payout No"
          value={data.outPayoutNo}
          accent={Boolean(data.outPayoutNo)}
          link={data.outPayoutId ? `/dashboard/treasury/payouts/${data.outPayoutId}` : undefined}
        />
        <InfoField label="Out Payout ID" value={data.outPayoutId} mono />
        <InfoField
          label="In Payin No"
          value={data.inPayinNo}
          accent={Boolean(data.inPayinNo)}
          link={data.inPayinId ? `/dashboard/treasury/payins/${data.inPayinId}` : undefined}
        />
        <InfoField label="In Payin ID" value={data.inPayinId} mono />
      </DetailCard>

      <DetailCard title="Timeline" icon={<Activity size={18} />}>
        <InfoField label="Status" value={data.clearingStatus} highlight />
        <InfoField label="Created At" value={formatDate(data.createdAt)} />
        <InfoField label="Updated At" value={formatDate(data.updatedAt)} />
      </DetailCard>
    </div>
  );
};

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return date.toLocaleString();
};

export default ClearingDetail;

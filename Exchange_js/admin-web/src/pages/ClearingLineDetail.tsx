import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, DollarSign, Hash, RefreshCw, User, Link as LinkIcon } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';

interface ClearingLineDetailData {
  id: string;
  clearingId: string;
  clearingNo?: string | null;
  lineNo: number;
  lineType: string;
  partyType: string;
  partyId: string | null;
  partyNo?: string | null;
  assetId: string;
  assetCode?: string | null;
  assetDecimals?: number | null;
  amount: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

const ClearingLineDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClearingLineDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/clearings/lines/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch clearing line details.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to fetch clearing line details.');
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
        <p className="text-gray-500">Loading clearing line detail...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/clearing/details')} className={adminButtonClass('detailUtility')}>
            Back to Clearing Lines
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
        title="Clearing Line"
        subtitle={`Line ${data.lineNo} · ${data.clearingNo || data.clearingId}`}
        onBack={() => navigate('/clearing/details')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            data.lineType === 'PAYABLE'
              ? 'bg-red-100 text-red-800'
              : data.lineType === 'RECEIVABLE'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {data.lineType}
        </span>
        <button
          onClick={() => navigate(`/clearing/management/${data.clearingId}`)}
          className={adminButtonClass('detailUtility')}
        >
          Open Parent Clearing
        </button>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Summary" icon={<Hash size={18} />}>
        <InfoField label="Clearing No" value={data.clearingNo} mono accent />
        <InfoField label="Clearing ID" value={data.clearingId} mono />
        <InfoField label="Line No" value={data.lineNo} highlight />
        <InfoField label="Line Type" value={data.lineType} highlight />
        <InfoField label="Line ID" value={data.id} mono />
        <InfoField label="Created At" value={formatDate(data.createdAt)} />
      </DetailCard>

      <DetailCard title="Counterparty" icon={<User size={18} />}>
        <InfoField label="Party Type" value={data.partyType} accent />
        <InfoField
          label="Party No"
          value={data.partyNo}
          accent={Boolean(data.partyNo)}
          link={
            data.partyType === 'CUSTOMER' && data.partyId ? `/customer/${data.partyId}` : undefined
          }
        />
        <InfoField label="Party ID" value={data.partyId} mono />
      </DetailCard>

      <DetailCard title="Amount & Asset" icon={<DollarSign size={18} />}>
        <InfoField label="Asset Code" value={data.assetCode} accent />
        <InfoField label="Asset ID" value={data.assetId} mono />
        <InfoField
          label="Amount"
          value={formatAssetAmount(data.amount, data.assetDecimals)}
          highlight
        />
      </DetailCard>

      <DetailCard title="Tracking Reference" icon={<LinkIcon size={18} />}>
        <InfoField label="Ref Type" value={data.refType} />
        <InfoField label="Ref ID" value={data.refId} mono />
      </DetailCard>

      <DetailCard title="Trace" icon={<Activity size={18} />} columns={1}>
        <p className="text-sm text-gray-500">
          Clearing lines inherit their lifecycle from the parent clearing record. Use the linked
          parent record for end-to-end settlement review.
        </p>
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

export default ClearingLineDetail;

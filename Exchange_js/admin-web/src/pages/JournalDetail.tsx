import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, DollarSign, FileText, Hash, Layers, RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';

interface JournalDetailData {
  id: string;
  journalNo: string;
  description: string | null;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  eventCode: string;
  journalHeaderTemplateId: string | null;
  reversalOfJournalId: string | null;
  baseAssetId: string;
  baseAsset: { id: string; code: string; type: string };
  totalAmount: string | null;
  postingStatus: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<JournalDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/journals/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch journal details.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to fetch journal details.');
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
        <p className="text-gray-500">Loading journal detail...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/ledger/journals')} className={adminButtonClass('detailUtility')}>
            Back to Journals
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
        title="Journal Entry"
        subtitle={`${data.journalNo} · ${data.eventCode}`}
        onBack={() => navigate('/ledger/journals')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            data.postingStatus === 'POSTED'
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
          }`}
        >
          {data.postingStatus}
        </span>
        <button
          onClick={() => navigate(`/ledger/journal-lines?journalId=${data.id}`)}
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
        <InfoField label="Journal No" value={data.journalNo} mono accent />
        <InfoField label="Journal ID" value={data.id} mono />
        <InfoField label="Description" value={data.description} icon={<FileText size={14} />} />
        <InfoField label="Posting Status" value={data.postingStatus} highlight />
        <InfoField label="Created At" value={formatDate(data.createdAt)} />
        <InfoField label="Updated At" value={formatDate(data.updatedAt)} />
      </DetailCard>

      <DetailCard title="Business Source" icon={<Layers size={18} />}>
        <InfoField label="Source Type" value={data.sourceType} accent />
        <InfoField label="Source No" value={data.sourceNo} mono />
        <InfoField label="Source ID" value={data.sourceId} mono />
        <InfoField label="Event Code" value={data.eventCode} />
        <InfoField label="Template ID" value={data.journalHeaderTemplateId} mono />
        <InfoField label="Reversal Of" value={data.reversalOfJournalId} mono />
      </DetailCard>

      <DetailCard title="Finance & Currency" icon={<DollarSign size={18} />}>
        <InfoField label="Base Asset Code" value={data.baseAsset?.code} accent />
        <InfoField label="Base Asset Type" value={data.baseAsset?.type} />
        <InfoField label="Base Asset ID" value={data.baseAssetId} mono />
        <InfoField label="Total Amount" value={data.totalAmount} highlight />
        <InfoField label="Posted At" value={formatDate(data.postedAt)} />
      </DetailCard>

      <DetailCard title="Trace" icon={<Activity size={18} />} columns={1}>
        <p className="text-sm text-gray-500">
          Journal line details are available through the linked journal lines view. This page keeps
          journal-level identification, posting state, and source trace as the primary truth.
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

export default JournalDetail;

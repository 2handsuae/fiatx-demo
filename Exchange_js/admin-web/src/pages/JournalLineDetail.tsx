import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, DollarSign, FileText, Hash, Layers, RefreshCw } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';

interface JournalLineDetailData {
  id: string;
  journalId: string;
  lineNo: number;
  journalLineTemplateId: string | null;
  referenceId: string | null;
  accountCode: string;
  drCr: 'DR' | 'CR';
  assetId: string;
  amount: string;
  fxRate: string | null;
  baseAmount: string | null;
  ownerType: string;
  ownerId: string | null;
  dimensions: unknown;
  description: string | null;
  createdAt: string;
  journal: {
    journalNo: string;
    eventCode: string;
  };
  account: {
    name: string;
  };
  asset: {
    code: string;
    decimals?: number;
  };
}

const JournalLineDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<JournalLineDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/journal-lines/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch journal line details.'));
      }

      const result = await response.json();
      setData(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to fetch journal line details.');
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
        <p className="text-gray-500">Loading journal line detail...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/ledger/journal-lines')} className={adminButtonClass('detailUtility')}>
            Back to Journal Lines
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
        title="Journal Line"
        subtitle={`Line ${data.lineNo} · ${data.journal?.journalNo || '-'}`}
        onBack={() => navigate('/ledger/journal-lines')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            data.drCr === 'DR' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'
          }`}
        >
          {data.drCr}
        </span>
        <button
          onClick={() => navigate(`/ledger/journals/${data.journalId}`)}
          className={adminButtonClass('detailUtility')}
        >
          Open Parent Journal
        </button>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Summary" icon={<Hash size={18} />}>
        <InfoField label="Journal No" value={data.journal?.journalNo} mono accent />
        <InfoField label="Journal ID" value={data.journalId} mono />
        <InfoField label="Line No" value={data.lineNo} highlight />
        <InfoField label="Journal Line ID" value={data.id} mono />
        <InfoField label="Template ID" value={data.journalLineTemplateId} mono />
        <InfoField label="Reference ID" value={data.referenceId} mono />
      </DetailCard>

      <DetailCard title="Accounting" icon={<Activity size={18} />}>
        <InfoField label="Account Code" value={data.accountCode} accent />
        <InfoField label="Account Name" value={data.account?.name} />
        <InfoField label="Direction" value={data.drCr === 'DR' ? 'Debit' : 'Credit'} highlight />
        <InfoField label="Owner Type" value={data.ownerType} />
        <InfoField label="Owner ID" value={data.ownerId} mono />
        <InfoField label="Event Code" value={data.journal?.eventCode} />
      </DetailCard>

      <DetailCard title="Amount & FX" icon={<DollarSign size={18} />}>
        <InfoField label="Asset Code" value={data.asset?.code} accent />
        <InfoField label="Asset ID" value={data.assetId} mono />
        <InfoField
          label="Transaction Amount"
          value={formatAssetAmount(data.amount, data.asset?.decimals)}
          highlight
        />
        <InfoField label="FX Rate" value={data.fxRate} />
        <InfoField label="Base Amount" value={formatAmount(data.baseAmount)} highlight />
        <InfoField label="Created At" value={formatDate(data.createdAt)} />
      </DetailCard>

      <DetailCard title="Context" icon={<Layers size={18} />}>
        <InfoField label="Description" value={data.description} icon={<FileText size={14} />} />
      </DetailCard>

      <DetailCard title="Dimensions" icon={<Layers size={18} />} columns={1}>
        <JsonBlock title="Dimensions JSON" value={data.dimensions || {}} compact />
      </DetailCard>
    </div>
  );
};

const formatAmount = (value: string | null) => {
  if (!value) return '0.00';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
};

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return date.toLocaleString();
};

export default JournalLineDetail;

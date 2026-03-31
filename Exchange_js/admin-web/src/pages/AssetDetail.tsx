import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, FileText, Hash, RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';

interface AssetDetailData {
  id: string;
  assetNo?: string | null;
  type: 'FIAT' | 'CRYPTO';
  code: string;
  network: string | null;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<AssetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;

    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${id}`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load asset detail.'));
      }

      const result = await response.json();
      setAsset(result);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to load asset detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-brand-primary" size={32} />
        <p className="text-gray-500">Loading asset detail...</p>
      </div>
    );
  }

  if (error && !asset) {
    return (
      <div className="space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-sm text-red-700">{error}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/dashboard/system/assets')} className={adminButtonClass('detailUtility')}>
            Back to Assets
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!asset) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <DetailPageHeader
        title="Asset Detail"
        subtitle={`${asset.assetNo || asset.code} · ${asset.code}`}
        onBack={() => navigate('/dashboard/system/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            asset.status === 'ACTIVE'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {asset.status}
        </span>
      </DetailPageHeader>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Summary" icon={<Hash size={18} />}>
        <InfoField label="Asset No" value={asset.assetNo || '-'} mono accent />
        <InfoField label="Asset ID" value={asset.id} mono />
        <InfoField label="Code" value={asset.code} accent />
        <InfoField label="Type" value={asset.type} />
        <InfoField label="Status" value={asset.status} highlight />
        <InfoField label="Description" value={asset.description} icon={<FileText size={14} />} />
      </DetailCard>

      <DetailCard title="Network & Precision" icon={<Activity size={18} />}>
        <InfoField label="Network" value={asset.network || '-'} />
        <InfoField label="Decimals" value={asset.decimals} />
        <InfoField label="Created At" value={formatDate(asset.createdAt)} />
        <InfoField label="Updated At" value={formatDate(asset.updatedAt)} />
      </DetailCard>
    </div>
  );
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default AssetDetail;

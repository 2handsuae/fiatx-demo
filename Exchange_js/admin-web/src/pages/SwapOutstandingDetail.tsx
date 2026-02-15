import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface SwapOutstandingDetailData {
  id: string;
  outstandingNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerType: string;
  ownerNo: string | null;
  direction: string;
  assetCode: string | null;
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
    fromAsset?: { code?: string | null } | null;
    toAsset?: { code?: string | null } | null;
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

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else if (response.status === 401) {
        localStorage.removeItem('admin_token');
        navigate('/admin/login');
      } else {
        alert('Failed to load outstanding detail');
        navigate('/dashboard/reconciliation/outstandings');
      }
    } catch (error) {
      console.error('Failed to fetch outstanding detail', error);
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

  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard/reconciliation/outstandings')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Swap Outstanding Detail</h1>
            <p className="text-sm text-gray-500 mt-1 font-mono">
              Outstanding No: {data.outstandingNo || 'N/A'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchDetail}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Outstanding Snapshot</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Outstanding No" value={data.outstandingNo || 'N/A'} />
          <Field label="Status" value={data.status} />
          <Field label="Direction" value={data.direction} />
          <Field label="Owner" value={`${data.ownerType} / ${data.ownerNo || 'N/A'}`} />
          <Field label="Source" value={`${data.sourceType} / ${data.sourceNo || 'N/A'}`} />
          <Field label="Asset" value={data.assetCode || 'N/A'} />
          <Field label="Amount" value={Number(data.amount).toLocaleString()} />
          <Field label="Created At" value={new Date(data.createdAt).toLocaleString('en-US')} />
          <Field label="Updated At" value={new Date(data.updatedAt).toLocaleString('en-US')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Linked Swap</h3>
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
              value={`${Number(data.swapTransaction.fromAmount).toLocaleString()} -> ${Number(data.swapTransaction.toAmount).toLocaleString()}`}
            />
            <Field label="Exchange Rate" value={Number(data.swapTransaction.exchangeRate).toLocaleString()} />
          </div>
        ) : (
          <div className="text-sm text-gray-500">No swap linked to this outstanding.</div>
        )}
      </div>
    </div>
  );
};

export default SwapOutstandingDetail;

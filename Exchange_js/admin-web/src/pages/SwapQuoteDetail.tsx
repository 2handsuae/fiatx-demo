import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

interface SwapQuoteDetailData {
  id: string;
  quoteNo: string | null;
  quoteType: string;
  status: string;
  ownerType: string;
  ownerNo: string | null;
  fromAssetCode: string;
  toAssetCode: string;
  fromAsset?: { code: string; decimals?: number | null } | null;
  toAsset?: { code: string; decimals?: number | null } | null;
  side: string;
  amountType: string;
  amountIn: string;
  currencyIn: string;
  amountOut: string;
  currencyOut: string;
  rateDisplay: string;
  rateAllIn: string;
  marketRate: string;
  spreadPercent: string;
  spreadBps: number;
  rateSource: string;
  fetchedAt: string;
  feeTotal: string;
  feeCurrency: string;
  feeBreakdown: string | null;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  swapTransaction?: {
    swapNo: string | null;
    quoteNo: string | null;
    status: string;
    createdAt: string;
  } | null;
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    <span className="text-sm text-gray-900 break-all">{value}</span>
  </div>
);

const SwapQuoteDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SwapQuoteDetailData | null>(null);

  const feeBreakdown = useMemo(() => {
    if (!data?.feeBreakdown) return [];
    try {
      return JSON.parse(data.feeBreakdown);
    } catch {
      return [];
    }
  }, [data?.feeBreakdown]);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/quotes/${id}`,
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
        alert('Failed to load quote detail');
        navigate('/dashboard/pricing/quotes');
      }
    } catch (error) {
      console.error('Failed to fetch quote detail', error);
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
        Loading quote detail...
      </div>
    );
  }

  if (!data) return null;
  const feeDecimals =
    data.feeCurrency === data.fromAssetCode
      ? data.fromAsset?.decimals
      : data.feeCurrency === data.toAssetCode
      ? data.toAsset?.decimals
      : 8;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard/pricing/quotes')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Swap Quote Detail</h1>
            <p className="text-sm text-gray-500 mt-1 font-mono">Quote No: {data.quoteNo || 'N/A'}</p>
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
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Identification</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Quote No" value={data.quoteNo || 'N/A'} />
          <Field label="Quote Type" value={data.quoteType} />
          <Field label="Status" value={data.status} />
          <Field label="Owner Type" value={data.ownerType} />
          <Field label="Owner No" value={data.ownerNo || 'N/A'} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Trade Terms</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Pair" value={`${data.fromAssetCode} -> ${data.toAssetCode}`} />
          <Field label="Side / Amount Type" value={`${data.side} / ${data.amountType}`} />
          <Field label="Amount In" value={`${formatAssetAmount(data.amountIn, data.fromAsset?.decimals)} ${data.currencyIn}`} />
          <Field label="Amount Out" value={`${formatAssetAmount(data.amountOut, data.toAsset?.decimals)} ${data.currencyOut}`} />
          <Field label="Rate Display" value={formatRate8(data.rateDisplay)} />
          <Field label="Rate All-In" value={formatRate8(data.rateAllIn)} />
          <Field label="Market Rate" value={formatRate8(data.marketRate)} />
          <Field label="Spread" value={`${Number(data.spreadPercent)}% (${data.spreadBps} bps)`} />
          <Field label="Rate Source" value={data.rateSource} />
          <Field label="Fetched At" value={new Date(data.fetchedAt).toLocaleString('en-US')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Fees</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <Field label="Fee Total" value={`${formatAssetAmount(data.feeTotal, feeDecimals)} ${data.feeCurrency}`} />
          <Field label="Fee Breakdown Items" value={String(feeBreakdown.length)} />
        </div>
        <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700">
          {JSON.stringify(feeBreakdown, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Lifecycle</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Created At" value={new Date(data.createdAt).toLocaleString('en-US')} />
          <Field label="Expires At" value={new Date(data.expiresAt).toLocaleString('en-US')} />
          <Field label="Used At" value={data.usedAt ? new Date(data.usedAt).toLocaleString('en-US') : 'N/A'} />
          <Field label="Cancelled At" value={data.cancelledAt ? new Date(data.cancelledAt).toLocaleString('en-US') : 'N/A'} />
          <Field label="Updated At" value={new Date(data.updatedAt).toLocaleString('en-US')} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Linked Swap</h3>
        {data.swapTransaction ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Swap No" value={data.swapTransaction.swapNo || 'N/A'} />
            <Field label="Quote No Snapshot" value={data.swapTransaction.quoteNo || 'N/A'} />
            <Field label="Swap Status" value={data.swapTransaction.status} />
            <Field label="Swap Created At" value={new Date(data.swapTransaction.createdAt).toLocaleString('en-US')} />
          </div>
        ) : (
          <div className="text-sm text-gray-500">No swap linked to this quote.</div>
        )}
      </div>
    </div>
  );
};

export default SwapQuoteDetail;

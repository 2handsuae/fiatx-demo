import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

type QuoteBusiness = 'SWAP' | 'WITHDRAWAL';

interface PricingQuoteDetailData {
  quoteId: string;
  quoteNo: string | null;
  business: QuoteBusiness;
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  fees: Array<Record<string, unknown>>;
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
  swap?: {
    quoteType: string;
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
    pricingSource?: Record<string, unknown> | null;
    matched?: Record<string, unknown> | null;
    linkedSwap?: {
      swapNo: string | null;
      quoteNo: string | null;
      status: string;
      createdAt: string;
    } | null;
  };
  withdrawal?: {
    assetId: string;
    assetCode: string;
    asset?: { code: string; decimals?: number | null; network?: string | null } | null;
    amount: string;
    segment: string;
    riskTier: string;
    matchedAssetEntryId: string;
    matchedTierId: string;
    matchedTierName: string;
    linkedWithdrawals: Array<{
      withdrawNo: string | null;
      status: string;
      createdAt: string;
    }>;
  };
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    <span className="text-sm text-gray-900 break-all">{value}</span>
  </div>
);

const SwapQuoteDetail = () => {
  const { id, business } = useParams<{ id: string; business?: QuoteBusiness }>();
  const navigate = useNavigate();
  const resolvedBusiness: QuoteBusiness = business === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'SWAP';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PricingQuoteDetailData | null>(null);

  const fees = useMemo(() => data?.fees || [], [data?.fees]);
  const totals = useMemo(() => data?.totals || {}, [data?.totals]);
  const policyRef = useMemo(() => data?.policyRef || {}, [data?.policyRef]);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/admin/pricing/quotes/${resolvedBusiness}/${id}`,
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
  }, [id, resolvedBusiness]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[360px] text-gray-500">
        <RefreshCw className="animate-spin mb-2 text-brand-primary" size={26} />
        Loading quote detail...
      </div>
    );
  }

  if (!data) return null;

  const swap = data.swap;
  const withdrawal = data.withdrawal;

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
            <h1 className="text-2xl font-bold text-gray-900">Quote Detail</h1>
            <p className="text-sm text-gray-500 mt-1 font-mono">
              {data.business} · Quote No: {data.quoteNo || 'N/A'}
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
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Identification</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Quote No" value={data.quoteNo || 'N/A'} />
          <Field label="Business" value={data.business} />
          <Field label="Status" value={data.status} />
          <Field label="Owner Type" value={data.ownerType} />
          <Field label="Owner No" value={data.ownerNo || 'N/A'} />
        </div>
      </div>

      {swap && (
        <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
          <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Swap Terms</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Pair" value={`${swap.fromAssetCode} -> ${swap.toAssetCode}`} />
            <Field label="Side / Amount Type" value={`${swap.side} / ${swap.amountType}`} />
            <Field label="Amount In" value={`${formatAssetAmount(swap.amountIn, swap.fromAsset?.decimals)} ${swap.currencyIn}`} />
            <Field label="Amount Out" value={`${formatAssetAmount(swap.amountOut, swap.toAsset?.decimals)} ${swap.currencyOut}`} />
            <Field label="Rate Display" value={formatRate8(swap.rateDisplay)} />
            <Field label="Rate All-In" value={formatRate8(swap.rateAllIn)} />
            <Field label="Market Rate" value={formatRate8(swap.marketRate)} />
            <Field label="Spread" value={`${Number(swap.spreadPercent)}% (${swap.spreadBps} bps)`} />
            <Field label="Rate Source" value={swap.rateSource} />
            <Field label="Fetched At" value={new Date(swap.fetchedAt).toLocaleString('en-US')} />
          </div>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700 mt-4">
            {JSON.stringify(
              {
                matched: swap.matched,
                pricingSource: swap.pricingSource,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}

      {withdrawal && (
        <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
          <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Withdrawal Terms</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Asset" value={withdrawal.assetCode} />
            <Field label="Amount" value={`${formatAssetAmount(withdrawal.amount, withdrawal.asset?.decimals)} ${withdrawal.assetCode}`} />
            <Field label="Segment / Risk Tier" value={`${withdrawal.segment} / ${withdrawal.riskTier}`} />
            <Field label="Matched Asset Entry" value={withdrawal.matchedAssetEntryId} />
            <Field label="Matched Tier" value={`${withdrawal.matchedTierId} / ${withdrawal.matchedTierName}`} />
            <Field label="Linked Withdrawals" value={String(withdrawal.linkedWithdrawals.length)} />
          </div>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700 mt-4">
            {JSON.stringify(withdrawal.linkedWithdrawals, null, 2)}
          </pre>
        </div>
      )}

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Fee Snapshot</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <Field label="Fee Items" value={String(fees.length)} />
          <Field label="Total Currencies" value={String(Object.keys(totals).length)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700">
            {JSON.stringify(fees, null, 2)}
          </pre>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700">
            {JSON.stringify(totals, null, 2)}
          </pre>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Policy Reference</h3>
        <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-700">
          {JSON.stringify(policyRef, null, 2)}
        </pre>
      </div>

      <div className="bg-white rounded-xl border border-admin-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-gray-900 uppercase mb-4">Lifecycle</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Created At" value={new Date(data.createdAt).toLocaleString('en-US')} />
          <Field label="Expires At" value={new Date(data.expiresAt).toLocaleString('en-US')} />
          <Field label="Used At" value={data.usedAt ? new Date(data.usedAt).toLocaleString('en-US') : 'N/A'} />
          <Field label="Cancelled At" value={data.cancelledAt ? new Date(data.cancelledAt).toLocaleString('en-US') : 'N/A'} />
        </div>
      </div>
    </div>
  );
};

export default SwapQuoteDetail;

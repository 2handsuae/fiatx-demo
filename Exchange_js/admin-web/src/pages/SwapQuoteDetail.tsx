import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface FeeItem {
  code: string;
  label: string;
  amount: string;
  currency: string;
}

interface SwapQuoteDetailData {
  quoteId: string;
  quoteNo: string | null;
  business: 'SWAP';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  fees: FeeItem[];
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
  swap: {
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
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const SwapQuoteDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapQuoteDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/quotes/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load quote detail'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch swap quote detail', err);
      setError(err instanceof Error ? err.message : 'Failed to load quote detail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  /* Loading state */
  if (loading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-adm-t3">
        <RefreshCw className="mb-2 animate-spin text-adm-amber" size={22} />
        Loading quote detail...
      </div>
    );
  }

  /* Error state (no data loaded) */
  if (error && !data) {
    return (
      <div className="p-6">
        <DetailPageHeader
          title="Swap Quote Detail"
          onBack={() => navigate('/admin/trading/swap-quotes')}
          onRefresh={() => void fetchDetail()}
          backLabel="Back to Swap Quotes"
        />
        <div className="mt-4 rounded-lg border border-adm-red/30 bg-adm-red/5 px-4 py-3 font-mono text-xs text-adm-red">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const swap = data.swap;
  const fees: FeeItem[] = Array.isArray(data.fees) ? data.fees : [];
  const totals = data.totals ?? {};
  const grossAmountOut = totals.amountOutGross || swap.amountOut;
  const netAmountOut = totals.amountOutNet || swap.amountOut;
  const feeTotal = totals.feeTotal || '0';
  const feeCurrency = totals.feeCurrency || swap.currencyOut;
  const feeDecimals =
    !feeCurrency
      ? undefined
      : feeCurrency === swap.fromAssetCode
        ? swap.fromAsset?.decimals
        : swap.toAsset?.decimals;
  const linkedSwap = swap.linkedSwap;

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <DetailPageHeader
        title="Swap Quote Detail"
        subtitle={data.quoteNo}
        onBack={() => navigate('/admin/trading/swap-quotes')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Swap Quotes"
      >
        <AdminBadge value={data.status} />
      </DetailPageHeader>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main body */}
        <div className="flex-1 space-y-4 overflow-auto p-5">
          {error ? (
            <div className="rounded-lg border border-adm-red/30 bg-adm-red/5 px-4 py-3 font-mono text-xs text-adm-red">
              {error}
            </div>
          ) : null}

          {/* Swap Terms */}
          <DetailCard title="Swap Terms">
            <InfoField label="Pair" value={`${swap.fromAssetCode} → ${swap.toAssetCode}`} mono />
            <InfoField label="Side / Amount Type" value={`${swap.side} / ${swap.amountType}`} />
            <InfoField
              label="Amount In"
              value={`${formatAssetAmount(swap.amountIn, swap.fromAsset?.decimals)} ${swap.currencyIn}`}
              mono
            />
            <InfoField
              label="Gross Receive"
              value={`${formatAssetAmount(grossAmountOut, swap.toAsset?.decimals)} ${swap.currencyOut}`}
              mono
            />
            <InfoField
              label="Fee"
              value={`${formatAssetAmount(feeTotal, feeDecimals)} ${feeCurrency}`}
              mono
            />
            <InfoField
              label="Net Receive"
              value={`${formatAssetAmount(netAmountOut, swap.toAsset?.decimals)} ${swap.currencyOut}`}
              mono
            />
            <InfoField label="Rate Display" value={formatRate8(swap.rateDisplay)} mono />
            <InfoField label="Rate All-In" value={formatRate8(swap.rateAllIn)} mono />
            <InfoField label="Market Rate" value={formatRate8(swap.marketRate)} mono />
            <InfoField
              label="Spread"
              value={`${Number(swap.spreadPercent)}% (${swap.spreadBps} bps)`}
            />
            <InfoField label="Rate Source" value={swap.rateSource} />
            <InfoField label="Fetched At" value={fmt(swap.fetchedAt)} mono />
          </DetailCard>

          {/* Fee Breakdown */}
          <DetailCard title="Fee Breakdown" columns={1}>
            {fees.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-adm-border">
                      {['Code', 'Label', 'Amount', 'Currency'].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {fees.map((fee, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                          {fee.code}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-adm-t1">{fee.label}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t1">
                          {formatAssetAmount(fee.amount)}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                          {fee.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Totals */}
                {Object.keys(totals).length > 0 ? (
                  <div className="mt-2 border-t border-adm-border pt-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                      Totals
                    </p>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {Object.entries(totals).map(([key, amount]) => (
                        <span
                          key={key}
                          className="font-mono text-[11px] font-semibold text-adm-amber"
                        >
                          {key}: {amount}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">No fee items</p>
            )}
          </DetailCard>

          {/* Linked Swap Transaction */}
          {linkedSwap ? (
            <DetailCard title="Linked Swap Transaction" columns={1}>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-adm-border">
                    {['Swap No', 'Status', 'Created'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  <tr>
                    <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                      {linkedSwap.swapNo || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge value={linkedSwap.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                      {fmt(linkedSwap.createdAt)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </DetailCard>
          ) : null}

          {/* Technical Detail */}
          <DetailCard title="Technical Detail" columns={1}>
            <JsonBlock title="Policy Reference" value={data.policyRef} />
            {swap.matched || swap.pricingSource ? (
              <JsonBlock
                title="Matched / Pricing Source"
                value={{ matched: swap.matched, pricingSource: swap.pricingSource }}
              />
            ) : null}
          </DetailCard>
        </div>

        {/* Sidebar */}
        <aside className="hidden w-[272px] shrink-0 overflow-auto border-l border-adm-border bg-adm-panel px-4 lg:block">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Business" value="SWAP" />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Owner No" value={data.ownerNo} mono />
            <SidebarKV label="Quote No" value={data.quoteNo} mono />
            <SidebarKV label="Quote Type" value={swap.quoteType} />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(data.createdAt)} />
            <SidebarKV label="Expires" value={fmt(data.expiresAt)} />
            <SidebarKV label="Used" value={fmt(data.usedAt)} />
            <SidebarKV label="Cancelled" value={fmt(data.cancelledAt)} />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};

export default SwapQuoteDetail;

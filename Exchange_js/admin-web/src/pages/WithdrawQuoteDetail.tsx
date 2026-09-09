import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { formatAssetAmount } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */
/* 后端 `GET admin/withdrawal-fee-levels/quotes/:quoteNo` 返回扁平
 * WithdrawPricingQuote 行（+ include asset, withdrawals）。
 * withdrawals 是 schema 上的 WithdrawTransaction[] 关系，但
 * pricingQuoteId 唯一约束保证一张报价最多被一笔提现消费。 */

interface FeeLine {
  itemCode: string;
  calcType: string;
  amount: string;
  currency: string;
}

interface WithdrawQuoteDetailData {
  id: string;
  quoteNo: string | null;
  status: string;
  ownerType: string;
  ownerNo: string | null;
  assetCode: string;
  amount: string;
  segment: string;
  riskTier: string;
  matchedTierName: string;
  feeLevelCode: string | null;
  feeBreakdown: string;
  totalsJson: string;
  policyRef: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  asset?: { code: string; decimals?: number | null; network?: string | null } | null;
  withdrawals?: {
    id: string;
    withdrawNo: string;
    status: string;
    createdAt: string;
  }[];
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const WithdrawQuoteDetail = () => {
  const { quoteNo } = useParams<{ quoteNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawQuoteDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!quoteNo) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/quotes/${quoteNo}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load quote detail'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch withdraw quote detail', err);
      setError(err instanceof Error ? err.message : 'Failed to load quote detail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [quoteNo]);

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
          title="Withdraw Quote Detail"
          onBack={() => navigate('/admin/trading/withdraw-quotes')}
          onRefresh={() => void fetchDetail()}
          backLabel="Back to Withdraw Quotes"
        />
        <div className="mt-4 rounded-lg border border-adm-red/30 bg-adm-red/5 px-4 py-3 font-mono text-xs text-adm-red">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const w = data;
  const fees: FeeLine[] = JSON.parse(data.feeBreakdown);
  const totals: Record<string, string> = JSON.parse(data.totalsJson);
  const linkedWithdrawal = data.withdrawals?.[0];

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <DetailPageHeader
        title="Withdraw Quote Detail"
        subtitle={data.quoteNo}
        onBack={() => navigate('/admin/trading/withdraw-quotes')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Withdraw Quotes"
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

          {/* Withdrawal Terms */}
          <DetailCard title="Withdrawal Terms">
            <InfoField label="Asset Code" value={w.assetCode} mono />
            <InfoField label="Network" value={w.asset?.network} mono />
            <InfoField
              label="Amount"
              value={
                w.amount
                  ? `${formatAssetAmount(w.amount, w.asset?.decimals)} ${w.assetCode}`
                  : null
              }
              mono
            />
            <InfoField label="Segment" value={w.segment} />
            <InfoField label="Risk Tier" value={w.riskTier} />
            <InfoField
              label="Fee Level / Tier"
              value={`${w.feeLevelCode ?? '—'} / ${w.matchedTierName}`}
            />
          </DetailCard>

          {/* Fee Breakdown */}
          <DetailCard title="Fee Breakdown" columns={1}>
            {fees.length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-adm-border">
                      {['Item Code', 'Calc Type', 'Amount', 'Currency'].map((h) => (
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
                          {fee.itemCode}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-adm-t1">{fee.calcType}</td>
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
                      {Object.entries(totals).map(([currency, amount]) => (
                        <span
                          key={currency}
                          className="font-mono text-[11px] font-semibold text-adm-amber"
                        >
                          {formatAssetAmount(amount)} {currency}
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

          {/* Linked Withdrawal */}
          <DetailCard title="Linked Withdrawal" columns={1}>
            {linkedWithdrawal ? (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-adm-border">
                    {['Withdraw No', 'Status', 'Created'].map((h) => (
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
                      <Link
                        to={`/admin/trading/withdrawals/${linkedWithdrawal.id}`}
                        className="text-adm-blue hover:underline"
                      >
                        {linkedWithdrawal.withdrawNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge value={linkedWithdrawal.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                      {fmt(linkedWithdrawal.createdAt)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">—</p>
            )}
          </DetailCard>

          {/* Technical Detail */}
          <DetailCard title="Technical Detail" columns={1}>
            <JsonBlock title="Policy Reference" value={data.policyRef} />
          </DetailCard>
        </div>

        {/* Sidebar */}
        <aside className="hidden w-[272px] shrink-0 overflow-auto border-l border-adm-border bg-adm-panel px-4 lg:block">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Business" value="WITHDRAWAL" />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Owner No" value={data.ownerNo} mono />
            <SidebarKV label="Quote No" value={data.quoteNo} mono />
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

export default WithdrawQuoteDetail;

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
import { formatAssetAmount } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface FeeItem {
  code: string;
  label: string;
  amount: string;
  currency: string;
}

interface LinkedWithdrawal {
  withdrawNo: string | null;
  status: string;
  createdAt: string;
}

interface WithdrawQuoteDetailData {
  quoteId: string;
  quoteNo: string | null;
  business: 'WITHDRAWAL';
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
  withdrawal: {
    assetId: string;
    assetCode: string;
    asset?: { code: string; decimals?: number | null; network?: string | null } | null;
    amount: string;
    segment: string;
    riskTier: string;
    matchedAssetEntryId: string;
    matchedTierId: string;
    matchedTierName: string;
    linkedWithdrawals: LinkedWithdrawal[];
  };
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const WithdrawQuoteDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawQuoteDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/quotes/${id}`,
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

  const w = data.withdrawal;
  const fees: FeeItem[] = Array.isArray(data.fees) ? data.fees : [];
  const totals = data.totals ?? {};
  const linkedWithdrawals: LinkedWithdrawal[] = w?.linkedWithdrawals ?? [];

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
              label="Matched Tier"
              value={
                w.matchedTierName
                  ? `${w.matchedTierName} (${w.matchedTierId})`
                  : w.matchedTierId
              }
              mono
            />
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

          {/* Linked Withdrawals */}
          {linkedWithdrawals.length > 0 ? (
            <DetailCard title="Linked Withdrawals" columns={1}>
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
                  {linkedWithdrawals.map((lw, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                        {lw.withdrawNo || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <AdminBadge value={lw.status} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                        {fmt(lw.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DetailCard>
          ) : null}

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

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import {
  LinkedRelationCard,
  LinkedRelationEmpty,
} from '../components/ui/LinkedRelationCard';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';

/* ── Types ──────────────────────────────────────────────────── */

interface SwapAsset {
  currency: string;
  code: string;
  type: string;
  network: string | null;
  decimals: number;
}

interface FundsOrderLeg {
  internalFundNo: string;
  status: string;
  txHash: string | null;
  confirmations: number | null;
  blockNo: string | null;
  nonce: string | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
}

interface FundsOrderSummary {
  id: string;
  internalTxNo: string;
  type: string;
  status: string;
  legs: FundsOrderLeg[];
}

interface SwapTransactionDetailData {
  id: string;
  swapNo: string;
  quoteId: string | null;
  quoteNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  fromAssetId: string;
  fromAssetCode: string | null;
  fromAmount: string;
  fromAsset: SwapAsset;
  toAssetId: string;
  toAssetCode: string | null;
  toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null;
  feeCurrency: string | null;
  feeBreakdown: string | null;
  spreadAmount: string | null;
  toAsset: SwapAsset;
  exchangeRate: string;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  } | null;
  statusHistory: string | null;
  fundsOrders?: FundsOrderSummary[];
}

interface SwapFx {
  baseRate?: string;
  quotedRate?: string;
  markupBps?: number;
  effectiveBaseRate?: string;
}

const parseFx = (feeBreakdown: string | null): SwapFx | null => {
  if (!feeBreakdown) return null;
  try {
    const parsed = JSON.parse(feeBreakdown);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first && first.fx ? (first.fx as SwapFx) : null;
  } catch {
    return null;
  }
};

/* ── Page Component ─────────────────────────────────────────── */

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load swap detail'));
        navigate('/exchange/swap-transactions');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch swap detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading swap detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const fx = parseFx(data.feeBreakdown);
  const toDecimals = data.toAsset.decimals;
  const fromDecimals = data.fromAsset.decimals;
  const ownerNo = data.ownerNo || data.customer?.customerNo || null;
  const pair = `${data.fromAsset.code} → ${data.toAsset.code}`;
  const netDisplay = `${formatAssetAmount(data.netToAmount ?? data.toAmount, toDecimals)} ${data.toAsset.currency}`;
  const feeDisplay = `${formatAssetAmount(data.feeAmount ?? '0', toDecimals)} ${data.feeCurrency || data.toAsset.currency}`;

  const ownerLink = ownerNo ? (
    <button
      onClick={() => navigate(`/customers/${data.ownerId}`)}
      className="text-adm-blue hover:underline"
    >
      {ownerNo}
    </button>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/exchange/swap-transactions')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Swaps"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">{data.swapNo}</div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={data.status} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Pair
                </span>
                <span className="font-mono text-adm-t1">{pair}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Net Received
                </span>
                <span className="font-semibold text-adm-t1">{netDisplay}</span>
              </div>
              {ownerNo && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Owner
                  </span>
                  {ownerLink}
                </div>
              )}
            </div>
          </div>

          {/* 2. Compliance — L1 Eligibility */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Compliance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-adm-bg p-3 border-l-[3px] border-adm-green">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  L1 · Eligibility
                </div>
                <div className="mt-1 text-sm font-bold text-adm-green">PASSED</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Pre-execution gate</div>
              </div>
            </div>
          </div>

          {/* 3. Conversion */}
          <DetailCard title="Conversion" columns={2}>
            <InfoField
              label="Sell Asset"
              value={`${data.fromAssetCode || data.fromAsset.code} · ${data.fromAsset.type}`}
              accent
            />
            <InfoField
              label="Buy Asset"
              value={`${data.toAssetCode || data.toAsset.code} · ${data.toAsset.type}`}
              accent
            />
            <InfoField
              label="Sell Amount"
              value={`${formatAssetAmount(data.fromAmount, fromDecimals)} ${data.fromAsset.currency}`}
              highlight
            />
            <InfoField label="Net Received" value={netDisplay} highlight />
            <InfoField
              label="Gross Out"
              value={`${formatAssetAmount(data.toAmount, toDecimals)} ${data.toAsset.currency}`}
            />
            <InfoField label="Fee" value={feeDisplay} />
          </DetailCard>

          {/* 4. Pricing */}
          <DetailCard title="Pricing" columns={2}>
            {fx?.baseRate ? (
              <InfoField label="Market Rate" value={formatRate8(fx.baseRate)} mono />
            ) : null}
            <InfoField label="Quoted All-in Rate" value={formatRate8(data.exchangeRate)} highlight />
            {fx?.markupBps !== undefined ? (
              <InfoField label="Spread (bps)" value={String(fx.markupBps)} mono />
            ) : null}
            <InfoField
              label="Spread (amount)"
              value={
                data.spreadAmount
                  ? `${formatAssetAmount(data.spreadAmount, toDecimals)} ${data.toAsset.currency}`
                  : '—'
              }
              mono
            />
            <InfoField label="Fee" value={feeDisplay} />
            <InfoField label="Net Out" value={netDisplay} highlight />
          </DetailCard>

          {/* 5. Linked Funds Orders */}
          <DetailCard title="Linked Funds Orders" columns={1}>
            {data.fundsOrders && data.fundsOrders.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.fundsOrders.map((o) => (
                  <LinkedRelationCard
                    key={o.id}
                    cap="Funds Order"
                    identifier={o.internalTxNo}
                    statusValue={o.status}
                    meta={o.type}
                    onClick={() => navigate(`/exchange/internal-transactions/${o.id}`)}
                  />
                ))}
              </div>
            ) : (
              <LinkedRelationEmpty
                cap="Funds Orders"
                message="Not settled to funds layer yet"
              />
            )}
          </DetailCard>

          {/* 6. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 7. Technical */}
          <DetailCard title="Technical" columns={2}>
            <InfoField label="Quote No" value={data.quoteNo} mono />
            <InfoField label="Quote ID" value={data.quoteId} mono />
            <InfoField label="Trace ID" value={data.traceId} mono />
            <InfoField label="From Asset ID" value={data.fromAssetId} mono />
            <InfoField label="To Asset ID" value={data.toAssetId} mono />
          </DetailCard>
        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Swap No" value={data.swapNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={data.status} />} />
            <SidebarKV label="Owner" value={ownerLink} />
            <SidebarKV label="Pair" value={`${data.fromAsset.code}/${data.toAsset.code}`} mono />
            <SidebarKV label="Net Received" value={netDisplay} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

/* ── StatusTimeline (adm-* tokens) ── */

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed)) {
      return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
    }
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return <div className="p-4 text-sm text-adm-red">Error parsing history</div>;
  }

  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No events</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-6 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.timestamp || item.changedAt || idx}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className="h-3 w-3 rounded-full bg-adm-green" />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className="rounded border border-adm-green/30 bg-adm-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-adm-green">
                {item.status || 'UNKNOWN'}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.note || item.reason || 'No reason provided'}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">
                {item.operator || item.operatorId || item.actorType || 'SYSTEM'}
              </span>
              <span>·</span>
              <time className="font-mono">
                {new Date(item.timestamp || item.changedAt || 0).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SwapTransactionDetail;

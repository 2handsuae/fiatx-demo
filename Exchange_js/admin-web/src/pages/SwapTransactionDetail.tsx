import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass } from '../components/common/adminButtonStyles';
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

interface InternalFundLeg {
  id: string;
  internalFundNo: string;
  legSeq: number | null;
  attempt: number | null;
  status: string;
  amount: string;
  asset?: { currency: string; decimals: number } | null;
  fromWallet?: { walletRole: string } | null;
  toWallet?: { walletRole: string } | null;
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
  currentStage: string | null;
  needsReview: boolean;
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
  internalFunds?: InternalFundLeg[];
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

/* ── Leg model ──────────────────────────────────────────────── */

const LEG_STAGE: Record<number, string> = {
  1: 'SELL',
  2: 'SETTLE',
  3: 'BUY',
  4: 'FEE',
};

/**
 * Actions allowed per current InternalFund status. Kept static (the backend
 * is the source of truth for whether a transition is legal); the UI just
 * shows the legacy happy-path verbs + FAIL.
 */
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  CREATED: ['SIGN', 'SUBMIT'],
  SIGNING: ['BROADCAST'],
  BROADCASTED: ['SEEN_IN_MEMPOOL'],
  CONFIRMING: ['CONFIRM', 'FAIL'],
  CONFIRMED: ['CLEAR'],
};

/* ── Page Component ─────────────────────────────────────────── */

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [legBusy, setLegBusy] = useState<number | null>(null);

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
        navigate('/admin/trading/swaps');
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

  const advanceLeg = async (swapNo: string, legSeq: number, action: string) => {
    setLegBusy(legSeq);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${swapNo}/legs/${legSeq}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, `Failed to advance leg ${legSeq}`));
        return;
      }
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to advance leg', error);
      alert('Failed to advance leg');
    } finally {
      setLegBusy(null);
    }
  };

  const resumeLeg = async (swapNo: string, legSeq: number) => {
    setLegBusy(legSeq);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${swapNo}/legs/${legSeq}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, `Failed to resume leg ${legSeq}`));
        return;
      }
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to resume leg', error);
      alert('Failed to resume leg');
    } finally {
      setLegBusy(null);
    }
  };

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

  /* Group internalFunds by legSeq, then sort attempts ascending. */
  const legGroups: Array<{ legSeq: number; attempts: InternalFundLeg[] }> = (() => {
    const map = new Map<number, InternalFundLeg[]>();
    for (const f of data.internalFunds ?? []) {
      const seq = f.legSeq ?? 0;
      if (!map.has(seq)) map.set(seq, []);
      map.get(seq)!.push(f);
    }
    const groups = Array.from(map.entries())
      .map(([legSeq, attempts]) => ({
        legSeq,
        attempts: [...attempts].sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0)),
      }))
      .sort((a, b) => a.legSeq - b.legSeq);
    return groups;
  })();

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/swaps')}
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-mono text-[19px] font-bold text-adm-amber">{data.swapNo}</div>
              {data.needsReview && (
                <span className="inline-flex items-center gap-1 rounded border border-adm-red/35 bg-adm-red/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-adm-red">
                  <AlertTriangle size={11} />
                  Needs Review
                </span>
              )}
            </div>
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
                  Current Stage
                </span>
                <span className="font-mono text-adm-t1">{data.currentStage ?? '—'}</span>
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

          {/* 5. Legs (per-legSeq attempt history) */}
          <DetailCard title="Settlement Legs" columns={1}>
            {legGroups.length === 0 ? (
              <div className="rounded border border-dashed border-adm-border bg-adm-bg px-4 py-3 font-mono text-[11px] text-adm-t3">
                No legs created yet.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {legGroups.map(({ legSeq, attempts }) => {
                  const stage = LEG_STAGE[legSeq] ?? `LEG${legSeq}`;
                  const latestIdx = attempts.length - 1;
                  return (
                    <div
                      key={legSeq}
                      className="rounded border border-adm-border bg-adm-bg"
                    >
                      <div className="flex items-center justify-between border-b border-adm-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                            Leg {legSeq}
                          </span>
                          <span className="font-mono text-[12px] font-semibold text-adm-t1">
                            {stage}
                          </span>
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                          {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex flex-col divide-y divide-adm-border">
                        {attempts.map((row, idx) => {
                          const isLatest = idx === latestIdx;
                          const amountLabel = row.asset
                            ? `${formatAssetAmount(row.amount, row.asset.decimals)} ${row.asset.currency}`
                            : row.amount;
                          const routeLabel =
                            row.fromWallet?.walletRole && row.toWallet?.walletRole
                              ? `${row.fromWallet.walletRole} → ${row.toWallet.walletRole}`
                              : null;
                          return (
                            <LegAttemptRow
                              key={row.id}
                              swapNo={data.swapNo}
                              legSeq={legSeq}
                              row={row}
                              amountLabel={amountLabel}
                              routeLabel={routeLabel}
                              isLatest={isLatest}
                              busy={legBusy === legSeq}
                              onNavigate={() =>
                                navigate(`/admin/funds/internal-funds/${row.internalFundNo}`)
                              }
                              onAdvance={advanceLeg}
                              onResume={resumeLeg}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
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
            <SidebarKV
              label="Current Stage"
              value={data.currentStage ?? '—'}
              mono
            />
            <SidebarKV
              label="Needs Review"
              value={
                data.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : 'No'
              }
            />
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

/* ── LegAttemptRow ──────────────────────────────────────────── */

const LegAttemptRow = ({
  swapNo,
  legSeq,
  row,
  amountLabel,
  routeLabel,
  isLatest,
  busy,
  onNavigate,
  onAdvance,
  onResume,
}: {
  swapNo: string;
  legSeq: number;
  row: InternalFundLeg;
  amountLabel: string;
  routeLabel: string | null;
  isLatest: boolean;
  busy: boolean;
  onNavigate: () => void;
  onAdvance: (swapNo: string, legSeq: number, action: string) => void;
  onResume: (swapNo: string, legSeq: number) => void;
}) => {
  const [selectedAction, setSelectedAction] = useState<string>('');
  const status = row.status;
  const validActions = ACTIONS_BY_STATUS[status] ?? [];
  const attemptLabel = `Attempt ${row.attempt ?? 1}`;
  const showResume = isLatest && status === 'NEEDS_REVIEW';
  const showAdvance = isLatest && !showResume && validActions.length > 0;

  return (
    <div
      className={`flex flex-col gap-2 px-3 py-2.5 ${
        isLatest ? 'bg-adm-bg' : 'bg-adm-panel/40'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
            {attemptLabel}
          </span>
          <button
            type="button"
            onClick={onNavigate}
            className="truncate font-mono text-[11px] font-semibold text-adm-amber hover:opacity-75"
          >
            {row.internalFundNo}
          </button>
          <AdminBadge value={status} />
          {!isLatest && (
            <span className="rounded border border-adm-border bg-adm-panel px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-adm-t3">
              History
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-adm-t2">{amountLabel}</span>
      </div>
      {routeLabel && (
        <div className="font-mono text-[10px] text-adm-t3">{routeLabel}</div>
      )}
      {showResume && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onResume(swapNo, legSeq)}
            disabled={busy}
            className={adminButtonClass('repair')}
          >
            Resume Leg
          </button>
        </div>
      )}
      {showAdvance && (
        <div className="flex items-center justify-end gap-2">
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            disabled={busy}
            className="h-[28px] rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber disabled:opacity-40"
          >
            <option value="">Select action…</option>
            {validActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !selectedAction}
            onClick={() => onAdvance(swapNo, legSeq, selectedAction)}
            className={adminButtonClass('workflowPrimary')}
          >
            Advance
          </button>
        </div>
      )}
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

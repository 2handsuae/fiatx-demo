// admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../../components/ui/SidebarPrimitives';
import { AdminBadge } from '../../components/ui/AdminBadge';
import { adminButtonClass } from '../../components/common/adminButtonStyles';
import { formatAssetAmount } from '../../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface TransferAsset {
  code: string;
  currency?: string | null;
  type?: string | null;
  network?: string | null;
  decimals?: number;
}

interface TransferWallet {
  walletNo: string | null;
  walletRole: string;
  ownerType: string;
  ownerNo?: string | null;
}

interface FundLeg {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  txHash?: string | null;
  statusHistory?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

interface TransferDetail {
  internalTxNo: string;
  status: string;
  pathLabel: string | null;
  accountingClass: string | null;
  medium: string | null;
  traceId: string | null;
  amount: string;
  fromWallet: TransferWallet | null;
  toWallet: TransferWallet | null;
  asset: TransferAsset | null;
  funds: FundLeg[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const SIMULATE_ACTIONS = [
  'SIGN',
  'BROADCAST',
  'SEEN_IN_MEMPOOL',
  'CONFIRM',
  'CLEAR',
  'FAIL',
  'DROP',
  'TIMEOUT',
  'CANCEL',
] as const;

/* ── Page Component ─────────────────────────────────────────── */

const InternalTransferDetailPage = () => {
  const { internalTxNo } = useParams<{ internalTxNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Manual Simulation state
  const [simFundId, setSimFundId] = useState('');
  const [simAction, setSimAction] = useState<(typeof SIMULATE_ACTIONS)[number]>('SIGN');
  const [simReason, setSimReason] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simError, setSimError] = useState('');

  const fetchData = async () => {
    if (!internalTxNo) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${internalTxNo}`,
      );
      if (response.ok) {
        const result: TransferDetail = await response.json();
        setData(result);
        setSimFundId((prev) => prev || result.funds?.[0]?.id || '');
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load transfer detail'));
        navigate('/funds-layer/transfers');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch transfer detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (internalTxNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalTxNo]);

  const handleSimulate = async () => {
    if (!internalTxNo || !simFundId) {
      setSimError('Select an execution leg first.');
      return;
    }
    setSimSubmitting(true);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${internalTxNo}/simulate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fundsFlowId: simFundId,
            action: simAction,
            reason: simReason.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        setSimError(await getApiErrorMessage(response, 'Simulation step failed.'));
        return;
      }
      setSimReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Simulation step failed.');
    } finally {
      setSimSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading transfer detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const decimals = data.asset?.decimals;
  const assetCode = data.asset?.code || data.asset?.currency || '—';
  const amountDisplay = `${formatAssetAmount(data.amount, decimals)} ${data.asset?.code || ''}`.trim();

  const walletLine = (w: TransferWallet | null): string =>
    w ? `${w.walletNo || '—'} · ${w.walletRole}` : '—';

  const selectInputCls =
    'h-[30px] w-full rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/funds-layer/transfers')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Internal Transfers"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.internalTxNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <AdminBadge value={data.status} />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Path
                </span>
                <span className="font-mono text-adm-t1">{data.pathLabel || '—'}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Asset
                </span>
                <span className="font-mono text-adm-t1">{assetCode}</span>
              </div>
            </div>
          </div>

          {/* 2. Core Context */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Transfer Context
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField label="From Wallet" value={walletLine(data.fromWallet)} mono />
              <InfoField label="To Wallet" value={walletLine(data.toWallet)} mono />
              <InfoField label="Amount" value={amountDisplay} accent />
              <InfoField label="Accounting Class" value={data.accountingClass} mono />
              <InfoField label="Medium" value={data.medium} mono />
              <InfoField label="Trace ID" value={data.traceId} mono />
            </div>
          </div>

          {/* 3. Process / Execution Legs */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Execution Legs
            </h3>
            {data.funds.length === 0 ? (
              <div className="p-4 text-center text-sm italic text-adm-t3">No execution legs</div>
            ) : (
              <div className="space-y-4">
                {data.funds.map((leg) => (
                  <div
                    key={leg.id}
                    className="rounded-lg border border-adm-border bg-adm-bg p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {leg.internalFundNo}
                      </span>
                      <AdminBadge value={leg.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-adm-t3">
                      <span>
                        Amount:{' '}
                        <span className="text-adm-t2">
                          {formatAssetAmount(leg.amount, decimals)} {data.asset?.code || ''}
                        </span>
                      </span>
                      <span>
                        Created:{' '}
                        <span className="text-adm-t2">
                          {new Date(leg.createdAt).toLocaleString()}
                        </span>
                      </span>
                      {leg.txHash ? (
                        <span className="break-all">
                          Tx: <span className="text-adm-t2">{leg.txHash}</span>
                        </span>
                      ) : null}
                    </div>
                    <LegStatusTimeline historyJson={leg.statusHistory ?? null} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Technical Detail (last) */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Technical Detail
            </h3>
            <div className="mt-1 space-y-3">
              <JsonBlock
                title="Execution Legs (raw)"
                value={data.funds.map((leg) => ({
                  id: leg.id,
                  internalFundNo: leg.internalFundNo,
                  status: leg.status,
                }))}
                compact
              />
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* ACTIONS → Manual Simulation */}
          <SidebarGroup title="Actions">
            <div className="rounded-lg border border-adm-blue/25 bg-adm-blue/6 p-3">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-blue">
                Manual Simulation
              </p>
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-adm-t3">
                DEV-only. Advances one execution leg through its state machine.
              </p>

              {simError && (
                <p className="mt-2 font-mono text-[10px] text-adm-red">{simError}</p>
              )}

              <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                Execution Leg
              </label>
              <select
                value={simFundId}
                onChange={(e) => setSimFundId(e.target.value)}
                className={`mt-1 ${selectInputCls}`}
                disabled={data.funds.length === 0 || simSubmitting}
              >
                {data.funds.length === 0 ? (
                  <option value="">No legs</option>
                ) : (
                  data.funds.map((leg) => (
                    <option key={leg.id} value={leg.id}>
                      {leg.internalFundNo} ({leg.status})
                    </option>
                  ))
                )}
              </select>

              <label className="mt-2.5 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                Action
              </label>
              <select
                value={simAction}
                onChange={(e) =>
                  setSimAction(e.target.value as (typeof SIMULATE_ACTIONS)[number])
                }
                className={`mt-1 ${selectInputCls}`}
                disabled={simSubmitting}
              >
                {SIMULATE_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <label className="mt-2.5 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                Reason (optional)
              </label>
              <input
                value={simReason}
                onChange={(e) => setSimReason(e.target.value)}
                placeholder="Reason"
                className={`mt-1 ${selectInputCls}`}
                disabled={simSubmitting}
              />

              <button
                onClick={handleSimulate}
                disabled={simSubmitting || !simFundId}
                className={adminButtonClass('simulationAction', 'mt-3 w-full')}
              >
                {simSubmitting ? 'Submitting…' : 'Submit Step'}
              </button>
            </div>
          </SidebarGroup>

          {/* IDENTITY SUMMARY */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Internal Tx No" value={data.internalTxNo} mono />
            <SidebarKV label="Path" value={data.pathLabel} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Asset" value={data.asset?.code || data.asset?.currency || null} />
          </SidebarGroup>

          {/* LIFECYCLE */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV label="Updated" value={new Date(data.updatedAt).toLocaleString()} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

/* ── Leg Status Timeline (adm-* tokens) ── */

const LegStatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) return null;

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return null;
  }

  return (
    <div className="relative my-3 ml-3 space-y-4 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.timestamp || item.changedAt || idx}`} className="relative ml-6">
          <span className="absolute -left-[34px] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-adm-bg ring-4 ring-adm-bg">
            <div className="h-2.5 w-2.5 rounded-full bg-adm-green" />
          </span>
          <div className="flex items-center gap-2">
            <span className="rounded border border-adm-green/30 bg-adm-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-adm-green">
              {item.status || 'UNKNOWN'}
            </span>
          </div>
          {item.note || item.reason ? (
            <p className="mt-1 text-[12px] text-adm-t2">{item.note || item.reason}</p>
          ) : null}
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
      ))}
    </div>
  );
};

export default InternalTransferDetailPage;

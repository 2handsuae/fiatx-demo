// admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  InfoField,
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

interface FundAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
}

interface FundWallet {
  walletNo: string | null;
  walletRole: string;
  ownerType: string;
  ownerNo?: string | null;
}

interface FundInternalTransaction {
  id: string;
  internalTxNo: string;
  pathLabel: string | null;
  status: string;
}

interface FundDetail {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  txHash?: string | null;
  confirmations?: number | null;
  blockNo?: number | null;
  nonce?: number | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  statusHistory?: string | null;
  completedAt?: string | null;
  createdAt: string;
  asset: FundAsset | null;
  fromWallet: FundWallet | null;
  toWallet: FundWallet | null;
  internalTransaction: FundInternalTransaction;
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

const InternalFundDetailPage = () => {
  const { internalFundNo } = useParams<{ internalFundNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FundDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Manual Simulation state
  const [simAction, setSimAction] = useState<(typeof SIMULATE_ACTIONS)[number]>('SIGN');
  const [simReason, setSimReason] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simError, setSimError] = useState('');

  const fetchData = async () => {
    if (!internalFundNo) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/funds/${internalFundNo}`,
      );
      if (response.ok) {
        const result: FundDetail = await response.json();
        setData(result);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load fund detail'));
        navigate('/funds-layer/funds');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch fund detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (internalFundNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalFundNo]);

  const handleSimulate = async () => {
    if (!data) return;
    setSimSubmitting(true);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${data.internalTransaction.internalTxNo}/simulate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fundsFlowId: data.id,
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
        <p className="text-adm-t3">Loading fund detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const decimals = data.asset?.decimals;
  const assetCode = data.asset?.code || data.asset?.currency || '—';
  const amountDisplay =
    `${formatAssetAmount(data.amount, decimals)} ${data.asset?.code || ''}`.trim();

  const selectInputCls =
    'h-[30px] w-full rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/funds-layer/funds')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Internal Funds"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.internalFundNo}
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
                  Asset
                </span>
                <span className="font-mono text-adm-t1">{assetCode}</span>
              </div>
            </div>
          </div>

          {/* 2. Execution Detail */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Execution Detail
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField label="Amount" value={amountDisplay} accent />
              <InfoField label="Tx Hash" value={data.txHash ?? null} mono />
              <InfoField
                label="Confirmations"
                value={data.confirmations != null ? String(data.confirmations) : null}
                mono
              />
              <InfoField
                label="Block No"
                value={data.blockNo != null ? String(data.blockNo) : null}
                mono
              />
              <InfoField
                label="Nonce"
                value={data.nonce != null ? String(data.nonce) : null}
                mono
              />
              <InfoField label="Gas Used" value={data.gasUsed ?? null} mono />
              <InfoField label="Effective Gas Price" value={data.effectiveGasPrice ?? null} mono />
            </div>
          </div>

          {/* 3. Status Timeline */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Status Timeline
            </h3>
            <LegStatusTimeline historyJson={data.statusHistory ?? null} />
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
                DEV-only. Advances this execution leg through its state machine.
              </p>

              {simError && (
                <p className="mt-2 font-mono text-[10px] text-adm-red">{simError}</p>
              )}

              <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
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
                disabled={simSubmitting}
                className={adminButtonClass('simulationAction', 'mt-3 w-full')}
              >
                {simSubmitting ? 'Submitting…' : 'Submit Step'}
              </button>
            </div>
          </SidebarGroup>

          {/* IDENTITY SUMMARY */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Fund No" value={data.internalFundNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Asset" value={data.asset?.code || data.asset?.currency || null} />
            <SidebarKV
              label="Transfer"
              value={
                data.internalTransaction ? (
                  <button
                    onClick={() =>
                      navigate(
                        '/funds-layer/transfers/' + data.internalTransaction.internalTxNo,
                      )
                    }
                    className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                  >
                    {data.internalTransaction.internalTxNo}
                  </button>
                ) : null
              }
            />
          </SidebarGroup>

          {/* LIFECYCLE */}
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

export default InternalFundDetailPage;

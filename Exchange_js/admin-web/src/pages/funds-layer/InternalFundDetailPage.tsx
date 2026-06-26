// admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../../components/compliance/DetailPageComponents';
import { LinkedRelationCard } from '../../components/ui/LinkedRelationCard';
import { SidebarGroup, SidebarKV } from '../../components/ui/SidebarPrimitives';
import { AdminBadge } from '../../components/ui/AdminBadge';
import { formatAssetAmount } from '../../utils/number-format';
import { copyToClipboard } from '../../utils/clipboard';
import { explorerTxUrl } from '../../utils/explorer';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';
import { useSimulationMode } from '../../utils/simulationMode';
import {
  getFundSimActionsForStatus,
  getSwapLegSimActionsForStatus,
  isFundSimTerminal,
  isSwapLegSimTerminal,
  type FundSimAction,
} from '../../utils/fundActionMap';

/* ── Types ──────────────────────────────────────────────────── */

interface FundAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
  type?: string | null;
  network?: string | null;
}

interface FundWallet {
  id: string;
  walletNo: string | null;
  walletRole: string;
  ownerType: string;
  ownerNo?: string | null;
  address?: string | null;
  iban?: string | null;
}

interface FundInternalTransaction {
  id: string;
  internalTxNo: string;
  pathLabel: string | null;
  type?: string | null;
  status: string;
}

interface FundSwapTransaction {
  id: string;
  swapNo: string;
  status: string;
}

interface FundWithdrawTransaction {
  id: string;
  withdrawNo: string;
  status: string;
}

interface FundDetail {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  fromAddress?: string | null;
  fromIban?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  txHash?: string | null;
  confirmations?: number | null;
  blockNo?: string | number | null;
  nonce?: string | number | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  referenceNo?: string | null;
  providerTxnId?: string | null;
  statusHistory?: string | null;
  sentAt?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  asset: FundAsset | null;
  fromWallet: FundWallet | null;
  toWallet: FundWallet | null;
  internalTransaction?: FundInternalTransaction | null;
  swapTransaction?: FundSwapTransaction | null;
  withdrawTransaction?: FundWithdrawTransaction | null;
  legSeq?: number | null;
}

/* ── Wallet field (main-area, internal navigation) ──────────── */

const WalletField = ({
  label,
  wallet,
}: {
  label: string;
  wallet: FundWallet | null;
}) => {
  const navigate = useNavigate();
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2 break-all font-mono text-[11px]">
        {wallet?.walletNo ? (
          <button
            onClick={() =>
              navigate(`/admin/custody/wallets/${wallet.id}`)
            }
            className="text-adm-amber hover:underline"
            title="Open wallet"
          >
            {wallet.walletNo}
          </button>
        ) : (
          <span className="text-adm-t3">—</span>
        )}
        {wallet && (
          <span className="text-[10px] text-adm-t3">
            {wallet.walletRole}
            {wallet.ownerNo ? ` · ${wallet.ownerNo}` : ` · ${wallet.ownerType}`}
          </span>
        )}
      </div>
    </div>
  );
};

/* ── Page Component ─────────────────────────────────────────── */

const InternalFundDetailPage = () => {
  const { internalFundNo } = useParams<{ internalFundNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Simulation state (Payout-style one-click panel)
  const { enabled: simulationModeEnabled } = useSimulationMode();
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
        navigate('/admin/funds/internal-funds');
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

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSimAction = async (action: string) => {
    if (!data) return;

    // Swap legs hang directly on the swap → advance via the swap settlement
    // endpoint (drives the leg + posts/voids its two-phase TB entries).
    // Transfer legs use the funds-layer simulate endpoint keyed by fundsFlowId.
    let url: string;
    let body: Record<string, unknown>;
    if (data.swapTransaction && data.legSeq != null) {
      url = `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${data.swapTransaction.swapNo}/legs/${data.legSeq}/advance`;
      body = { action };
    } else if (data.internalTransaction) {
      url = `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${data.internalTransaction.internalTxNo}/simulate`;
      body = { fundsFlowId: data.id, action };
    } else {
      setSimError('This fund has no simulatable parent.');
      return;
    }

    setSimSubmitting(true);
    setSimError('');
    try {
      const response = await adminFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setSimError(await getApiErrorMessage(response, 'Simulation step failed.'));
        return;
      }
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

  const assetType = data.asset?.type?.toUpperCase() ?? null;
  const isFiat = assetType === 'FIAT';

  // Two simulate surfaces share this card:
  //  - swap leg (hangs on a swap, no internalTransaction) → advance via swap
  //    settlement; CLEAR is an explicit step (no auto-clear).
  //  - transfer leg (has internalTransaction) → simulate; CLEAR auto-fires when
  //    the parent transfer succeeds.
  const isSwapLeg = !!data.swapTransaction;
  const swapInProgress = data.swapTransaction?.status === 'PROCESSING';
  const simActions: Array<FundSimAction & { enabled: boolean }> = !simulationModeEnabled
    ? []
    : isSwapLeg
      ? swapInProgress
        ? getSwapLegSimActionsForStatus(data.status, data.asset?.type)
        : []
      : data.internalTransaction
        ? getFundSimActionsForStatus(data.status, data.asset?.type)
        : [];
  const simTerminal = isSwapLeg
    ? isSwapLegSimTerminal(data.status)
    : isFundSimTerminal(data.status, data.asset?.type);
  // Withdrawal fee fund: follows the withdrawal lifecycle automatically (no
  // manual steps here) — the withdraw workflow sets it CLEAR/CANCELLED.
  const isWithdrawFee = !!data.withdrawTransaction;
  const simEmptyReason = simTerminal
    ? 'Terminal state — no simulatable events'
    : isWithdrawFee
      ? 'Driven by the withdrawal — no manual steps'
      : isSwapLeg && !swapInProgress
        ? `Swap is ${data.swapTransaction?.status ?? 'not in progress'} — nothing to advance here`
        : isSwapLeg
          ? 'No action available at this status'
          : 'Auto-clears when all legs of the transfer confirm…';

  const decimals = data.asset?.decimals;
  const assetCode = data.asset?.code || data.asset?.currency || '—';
  const fmtAmount = (v?: string | null) =>
    v != null ? `${formatAssetAmount(v, decimals)} ${assetCode}`.trim() : null;

  const fromAddress = data.fromAddress ?? data.fromWallet?.address ?? null;
  const toAddress = data.toAddress ?? data.toWallet?.address ?? null;
  const fromIban = data.fromIban ?? data.fromWallet?.iban ?? null;
  const toIban = data.toIban ?? data.toWallet?.iban ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/funds/internal-funds')}
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
                  Amount
                </span>
                <span className="font-semibold text-adm-t1">
                  {fmtAmount(data.amount)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Type
                </span>
                <span className="text-adm-t1">{isFiat ? 'Fiat' : 'Crypto'}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Asset
                </span>
                <span className="text-adm-t1">
                  {assetCode}
                  {data.asset?.network ? ` · ${data.asset.network}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Transfer Route */}
          <DetailCard title="Transfer Route" columns={2}>
            <WalletField label="From Wallet" wallet={data.fromWallet} />
            <WalletField label="To Wallet" wallet={data.toWallet} />
            {isFiat ? (
              <>
                <InfoField label="From IBAN" value={fromIban} mono />
                <InfoField label="To IBAN" value={toIban} mono />
              </>
            ) : (
              <>
                <InfoField
                  label="From Address"
                  value={fromAddress}
                  copyable
                  onCopy={(v) => handleCopy(v, 'fromAddr')}
                  isCopied={copiedField === 'fromAddr'}
                  mono
                />
                <InfoField
                  label="To Address"
                  value={toAddress}
                  copyable
                  onCopy={(v) => handleCopy(v, 'toAddr')}
                  isCopied={copiedField === 'toAddr'}
                  mono
                />
              </>
            )}
          </DetailCard>

          {/* 3a. Chain Execution (crypto only) */}
          {!isFiat && (
            <DetailCard title="Chain Execution" columns={2}>
              <InfoField
                label="Tx Hash"
                value={data.txHash}
                copyable
                onCopy={(v) => handleCopy(v, 'txHash')}
                isCopied={copiedField === 'txHash'}
                mono
                link={
                  data.txHash
                    ? explorerTxUrl(data.asset?.network ?? null, data.txHash)
                    : undefined
                }
              />
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
              <InfoField
                label="Effective Gas Price"
                value={data.effectiveGasPrice ?? null}
                mono
              />
            </DetailCard>
          )}

          {/* 3b. Bank Transfer (fiat only) */}
          {isFiat && (
            <DetailCard title="Bank Transfer" columns={2}>
              <InfoField label="Reference No" value={data.referenceNo} mono />
              <InfoField label="Provider Txn ID" value={data.providerTxnId} mono />
            </DetailCard>
          )}

          {/* 4. Linked Transfer */}
          {data.internalTransaction && (
            <DetailCard title="Linked Transfer" columns={1}>
              <LinkedRelationCard
                cap="Internal Transfer"
                identifier={data.internalTransaction.internalTxNo}
                statusValue={data.internalTransaction.status}
                meta={[
                  data.internalTransaction.type,
                  data.internalTransaction.pathLabel,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined}
                onClick={() =>
                  navigate(
                    '/admin/funds/transfers/' + data.internalTransaction!.internalTxNo,
                  )
                }
              />
            </DetailCard>
          )}

          {/* 4b. Linked Swap (swap legs hang directly on the swap) */}
          {data.swapTransaction && (
            <DetailCard title="Linked Swap" columns={1}>
              <LinkedRelationCard
                cap="Swap Transaction"
                identifier={data.swapTransaction.swapNo}
                statusValue={data.swapTransaction.status}
                meta={data.legSeq != null ? `Leg ${data.legSeq} of 4` : undefined}
                onClick={() =>
                  navigate('/admin/trading/swaps/' + data.swapTransaction!.id)
                }
              />
            </DetailCard>
          )}

          {/* 4c. Linked Withdrawal (fee fund hangs directly on the withdrawal) */}
          {data.withdrawTransaction && (
            <DetailCard title="Linked Withdrawal" columns={1}>
              <LinkedRelationCard
                cap="Withdrawal · Fee"
                identifier={data.withdrawTransaction.withdrawNo}
                statusValue={data.withdrawTransaction.status}
                onClick={() =>
                  navigate(
                    '/admin/trading/withdrawals/' + data.withdrawTransaction!.id,
                  )
                }
              />
            </DetailCard>
          )}

          {/* 5. Status History */}
          <DetailCard title="Status History" columns={1}>
            <LegStatusTimeline historyJson={data.statusHistory ?? null} />
          </DetailCard>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* Simulation Controls (sim mode only, Payout-style) */}
          {simulationModeEnabled &&
            (data.internalTransaction || data.swapTransaction || data.withdrawTransaction) && (
            <SidebarGroup title="Simulation Controls">
              <div className="rounded border border-dashed border-amber-400 bg-amber-900/20 p-2">
                <div className="mb-2 flex items-center gap-1 font-mono text-[9px] text-amber-400">
                  ⚡ SIM MODE
                </div>
                {simError && (
                  <p className="mb-2 font-mono text-[10px] text-adm-red">{simError}</p>
                )}
                {(() => {
                  const hasEnabled = simActions.some((a) => a.enabled);
                  if (!hasEnabled) {
                    return (
                      <div className="px-2 py-1.5 font-mono text-[10px] text-amber-400/80">
                        {simEmptyReason}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-1.5">
                      {simActions.map((a) => (
                        <button
                          key={a.action}
                          onClick={() => handleSimAction(a.action)}
                          disabled={!a.enabled || simSubmitting}
                          className="w-full rounded border border-dashed border-amber-500/50 bg-amber-900/30 px-2 py-1.5 text-left font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {simSubmitting ? '...' : a.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </SidebarGroup>
          )}

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
                        '/admin/funds/transfers/' + data.internalTransaction!.internalTxNo,
                      )
                    }
                    className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                  >
                    {data.internalTransaction.internalTxNo}
                  </button>
                ) : null
              }
            />
            {data.swapTransaction && (
              <SidebarKV
                label="Swap"
                value={
                  <button
                    onClick={() =>
                      navigate('/admin/trading/swaps/' + data.swapTransaction!.id)
                    }
                    className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                  >
                    {data.swapTransaction.swapNo}
                  </button>
                }
              />
            )}
            {data.swapTransaction && data.legSeq != null && (
              <SidebarKV label="Leg" value={`${data.legSeq} of 4`} />
            )}
            {data.withdrawTransaction && (
              <SidebarKV
                label="Withdrawal"
                value={
                  <button
                    onClick={() =>
                      navigate(
                        '/admin/trading/withdrawals/' + data.withdrawTransaction!.id,
                      )
                    }
                    className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                  >
                    {data.withdrawTransaction.withdrawNo}
                  </button>
                }
              />
            )}
          </SidebarGroup>

          {/* LIFECYCLE */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Sent"
              value={data.sentAt ? new Date(data.sentAt).toLocaleString() : null}
              mono
            />
            <SidebarKV
              label="Confirmed"
              value={data.confirmedAt ? new Date(data.confirmedAt).toLocaleString() : null}
              mono
            />
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

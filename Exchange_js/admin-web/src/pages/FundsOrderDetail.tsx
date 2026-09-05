// admin-web/src/pages/FundsOrderDetail.tsx
//
// Unified funds-order detail (Round 2 / C6). Reads /admin/funds-orders/:no.
// Dynamic field block by asset.type: crypto → chain execution; fiat → bank
// transfer. Shows the parent (deposit/withdraw/swap) via its business no only
// — never the raw parent id (project rule: no raw UUIDs in the UI).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { LinkedRelationCard } from '../components/ui/LinkedRelationCard';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { formatAssetAmount } from '../utils/number-format';
import { copyToClipboard } from '../utils/clipboard';
import { explorerTxUrl } from '../utils/explorer';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatFundsOrderStatusBilingual,
  getFundsOrderStatusTone,
} from '../utils/fundsOrderStatusMap';
import { useSimulationMode } from '../utils/simulationMode';
import { getFundsOrderSimActions } from '../utils/fundsOrderSimActionMap';

/* ── Types ──────────────────────────────────────────────────── */

interface FoAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
  type?: string | null;
  network?: string | null;
}

interface FoWallet {
  id: string;
  walletNo: string | null;
  walletRole: string;
  ownerType: string;
  ownerNo?: string | null;
  address?: string | null;
  iban?: string | null;
}

interface FoParent {
  id: string;
  status: string;
}

interface FoAuditLog {
  id: string;
  operatorId: string;
  oldStatus: string;
  newStatus: string;
  reason?: string | null;
  createdAt: string;
}

interface FundsOrderDetail {
  id: string;
  fundsOrderNo: string;
  status: string;
  amount: string;
  feeAmount?: string | null;
  netAmount?: string | null;
  legSeq?: number | null;
  attempt?: number | null;
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
  asset: FoAsset | null;
  fromWallet: FoWallet | null;
  toWallet: FoWallet | null;
  swapTransactionId?: string | null;
  deposit?: FoParent | null;
  withdrawTransaction?: FoParent | null;
  swapTransaction?: FoParent | null;
  // 平账二期：第四种父键——内部划转单。回链走业务号 transferNo，不碰 id。
  internalTransfer?: { transferNo: string; status: string } | null;
  depositNo?: string | null;
  withdrawNo?: string | null;
  swapNo?: string | null;
  auditLogs?: FoAuditLog[];
}

/* ── Wallet field (main-area, internal navigation) ──────────── */

const WalletField = ({
  label,
  wallet,
}: {
  label: string;
  wallet: FoWallet | null;
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
            onClick={() => navigate(`/admin/custody/wallets/${wallet.walletNo}`)}
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

/* ── Parent resolution ──────────────────────────────────────── */

// A funds_order hangs off exactly one parent. Return its kind, business no,
// status, and the detail route — keyed by business no, never the raw id.
const resolveParent = (
  data: FundsOrderDetail,
): { kind: string; no: string; status: string; route: string } | null => {
  if (data.depositNo) {
    return {
      kind: 'Deposit',
      no: data.depositNo,
      status: data.deposit?.status ?? '',
      route: '/admin/trading/deposits/' + (data.deposit?.id ?? ''),
    };
  }
  if (data.withdrawNo) {
    return {
      kind: 'Withdrawal',
      no: data.withdrawNo,
      status: data.withdrawTransaction?.status ?? '',
      route: '/admin/trading/withdrawals/' + (data.withdrawTransaction?.id ?? ''),
    };
  }
  if (data.swapNo) {
    return {
      kind: 'Swap',
      no: data.swapNo,
      status: data.swapTransaction?.status ?? '',
      route: '/admin/trading/swaps/' + (data.swapTransaction?.id ?? ''),
    };
  }
  if (data.internalTransfer?.transferNo) {
    return {
      kind: 'Internal transfer',
      no: data.internalTransfer.transferNo,
      status: data.internalTransfer.status ?? '',
      route: '/admin/treasury/internal-transfers/' + data.internalTransfer.transferNo,
    };
  }
  return null;
};

/* ── Page Component ─────────────────────────────────────────── */

const FundsOrderDetail = () => {
  const { fundsOrderNo } = useParams<{ fundsOrderNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FundsOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { enabled: simEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState(false);

  // 平账·推单处置（Task 4）——与 ⚡模拟面板独立，不受 simEnabled 门控。
  const [pushSubmitting, setPushSubmitting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualReceiptRef, setManualReceiptRef] = useState('');
  const [manualExternalDate, setManualExternalDate] = useState('');
  const [manualReason, setManualReason] = useState('');

  const fetchData = async () => {
    if (!fundsOrderNo) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-orders/${fundsOrderNo}`,
      );
      if (response.ok) {
        const result: FundsOrderDetail = await response.json();
        setData(result);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load funds order detail'));
        navigate('/admin/funds-orders');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch funds order detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (fundsOrderNo) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundsOrderNo]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSimAction = async (a: {
    key: string;
    fundsOrderAction: string;
    swapAction: string;
    destructive: boolean;
    labelZh: string;
  }) => {
    if (!data) return;
    if (
      a.destructive &&
      !window.confirm(
        `确定执行「${a.labelZh}」? 这会把资金单打到失败终态并触发退款/解锁。`,
      )
    ) {
      return;
    }
    setSimSubmitting(true);
    try {
      const isSwap = !!data.swapTransactionId;
      const url = isSwap
        ? `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${data.swapNo}/legs/${data.legSeq}/advance`
        : `${import.meta.env.VITE_API_URL}/admin/funds-orders/${data.fundsOrderNo}/advance`;
      const action = isSwap ? a.swapAction : a.fundsOrderAction;
      const response = await adminFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        alert(await getApiErrorMessage(response, 'Simulation failed'));
        return;
      }
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Sim failed', error);
      alert('Simulation request failed');
    } finally {
      setSimSubmitting(false);
    }
  };

  // 推单·同步状态：查唯一外部回执自动推进至终态。MISS 时后端 message
  // （"未找到唯一回执（N 条候选）…"）原样透出，提示改走人工确认。
  const handleSyncPush = async () => {
    if (!data) return;
    setPushSubmitting(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-orders/${data.fundsOrderNo}/push/sync`,
        { method: 'POST' },
      );
      if (!response.ok) {
        alert(await getApiErrorMessage(response, 'Sync push failed'));
        return;
      }
      // Success: silent refetch (repo convention — no success alert). The order
      // reaches a terminal state, canPush flips false, and this Actions button
      // disappears on its own.
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Sync push failed', error);
      alert('Sync push request failed');
    } finally {
      setPushSubmitting(false);
    }
  };

  // 推单·人工确认：证据三件套（回执号 + 外部实际动账日 + 原因）强推至终态。
  const handleManualPush = async () => {
    if (!data) return;
    if (!manualReceiptRef.trim() || !manualExternalDate.trim() || !manualReason.trim()) {
      alert('All three fields are required / 三项证据均为必填');
      return;
    }
    setPushSubmitting(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-orders/${data.fundsOrderNo}/push/manual`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiptRef: manualReceiptRef.trim(),
            externalDate: manualExternalDate,
            reason: manualReason.trim(),
          }),
        },
      );
      if (!response.ok) {
        alert(await getApiErrorMessage(response, 'Manual push failed'));
        return;
      }
      // Success: close modal, reset fields, silent refetch (repo convention —
      // no success alert). The order goes terminal and the Actions block hides.
      setManualOpen(false);
      setManualReceiptRef('');
      setManualExternalDate('');
      setManualReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Manual push failed', error);
      alert('Manual push request failed');
    } finally {
      setPushSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading funds order detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const assetType = data.asset?.type?.toUpperCase() ?? null;
  const isFiat = assetType === 'FIAT';
  const parent = resolveParent(data);

  // 平账·推单处置门控（Task 4）：swap 腿走 Swap 详情页逐腿推进（顺序守卫），
  // 本区不渲染；终态无可推进。两条件与后端 loadPushable 拒绝语义一致。
  const isSwapLeg = !!data.swapTransactionId || !!data.swapNo;
  const isTerminalStatus = ['CLEARED', 'FAILED', 'TIMEOUT'].includes(
    String(data.status || '').toUpperCase(),
  );
  const canPush = !isSwapLeg && !isTerminalStatus;

  const decimals = data.asset?.decimals;
  const assetCode = data.asset?.code || data.asset?.currency || '—';
  const fmtAmount = (v?: string | null) =>
    v != null ? `${formatAssetAmount(v, decimals)} ${assetCode}`.trim() : null;

  const fromAddress = data.fromAddress ?? data.fromWallet?.address ?? null;
  const toAddress = data.toAddress ?? data.toWallet?.address ?? null;
  const fromIban = data.fromIban ?? data.fromWallet?.iban ?? null;
  const toIban = data.toIban ?? data.toWallet?.iban ?? null;

  const statusBadge = (
    <span
      className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] ${getFundsOrderStatusTone(data.status)}`}
    >
      {formatFundsOrderStatusBilingual(data.status, data.asset?.type)}
    </span>
  );

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/funds-orders')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Funds Orders"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.fundsOrderNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">{statusBadge}</span>
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
              {data.legSeq != null && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Leg
                  </span>
                  <span className="text-adm-t1">
                    {data.legSeq}
                    {data.attempt != null ? ` · attempt ${data.attempt}` : ''}
                  </span>
                </div>
              )}
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

          {/* 2.5 Simulation panel (dev/ops only — gated by simulation mode) */}
          {simEnabled && (
            <div className="bg-adm-card px-6 py-5">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 text-sm font-semibold text-amber-800">
                  ⚡ 模拟操作 / Simulation
                </div>
                {(() => {
                  const actions = getFundsOrderSimActions(
                    data.status,
                    (data.asset?.type || 'CRYPTO').toUpperCase() as
                      | 'CRYPTO'
                      | 'FIAT',
                  );
                  if (actions.length === 0) {
                    return (
                      <div className="text-sm text-gray-500">
                        终态或无可用动作 / No actions available
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-wrap gap-2">
                      {actions.map((a) => (
                        <button
                          key={a.key}
                          disabled={simSubmitting}
                          onClick={() => handleSimAction(a)}
                          className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                            a.destructive
                              ? 'bg-red-500 hover:bg-red-600'
                              : 'bg-blue-500 hover:bg-blue-600'
                          }`}
                        >
                          {a.labelZh} / {a.labelEn.replace('⚡ ', '')}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

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

          {/* 4. Linked Parent (deposit / withdraw / swap) */}
          {parent && (
            <DetailCard title={`Linked ${parent.kind}`} columns={1}>
              <LinkedRelationCard
                cap={parent.kind}
                identifier={parent.no}
                statusValue={parent.status || undefined}
                meta={
                  data.legSeq != null && data.swapNo
                    ? `Leg ${data.legSeq}`
                    : undefined
                }
                onClick={() => navigate(parent.route)}
              />
            </DetailCard>
          )}

          {/* 5. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusHistoryTimeline historyJson={data.statusHistory ?? null} />
          </DetailCard>

          {/* 6. Audit Log */}
          <DetailCard title="Audit Log" columns={1}>
            <AuditLogList logs={data.auditLogs ?? []} />
          </DetailCard>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* ACTIONS — 平账·推单处置 (real ops action, not simulation). Shown only
              for a non-swap, non-terminal leg; drives the order to CLEARED so the
              next reconciliation run closes its open case. Manual Confirm opens the
              page-level evidence modal. Buttons live here per frontend-admin.md
              (actions belong in the sidebar Actions block, not the main body). */}
          {canPush && (
            <SidebarGroup title="Actions">
              <button
                type="button"
                disabled={pushSubmitting}
                onClick={handleSyncPush}
                className="flex w-full items-center justify-center rounded border border-adm-blue/40 bg-adm-blue/10 px-3 py-2 font-mono text-[12px] font-semibold text-adm-blue transition-colors hover:bg-adm-blue/20 disabled:opacity-50"
              >
                同步状态 / Sync
              </button>
              <button
                type="button"
                disabled={pushSubmitting}
                onClick={() => setManualOpen(true)}
                className="mt-2 flex w-full items-center justify-center rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[12px] font-semibold text-adm-t2 transition-colors hover:border-adm-t3 disabled:opacity-50"
              >
                人工确认 / Manual Confirm
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-adm-t3">
                推至终态以便重对账关单。同步：查唯一回执自动推进；人工：凭证据三件套强推。
              </p>
            </SidebarGroup>
          )}

          {/* IDENTITY SUMMARY */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Funds Order No" value={data.fundsOrderNo} mono />
            <SidebarKV label="Status" value={statusBadge} />
            <SidebarKV label="Asset" value={assetCode} />
            {parent && (
              <SidebarKV
                label={parent.kind}
                value={
                  <button
                    onClick={() => navigate(parent.route)}
                    className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                  >
                    {parent.no}
                  </button>
                }
              />
            )}
            {data.legSeq != null && (
              <SidebarKV
                label="Leg"
                value={
                  data.attempt != null
                    ? `${data.legSeq} · attempt ${data.attempt}`
                    : String(data.legSeq)
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

      {/* ── 人工确认弹层 / Manual Confirm modal ── 三输入全必填，POST /push/manual */}
      {manualOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pushSubmitting && setManualOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-adm-border bg-adm-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 font-mono text-[13px] font-semibold text-adm-t1">
              人工确认推单 / Manual Confirm Push
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-adm-t3">
              Force this order to CLEARED with operator-supplied evidence. All three
              fields are required. / 凭证据三件套强推至终态，三项均为必填。
            </p>

            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-adm-t3">
              回执号 / Receipt Ref
            </label>
            <input
              type="text"
              value={manualReceiptRef}
              onChange={(e) => setManualReceiptRef(e.target.value)}
              placeholder="e.g. bank wire reference / on-chain tx hash"
              className="mb-3 w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[12px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-blue focus:outline-none"
            />

            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-adm-t3">
              外部实际动账日 / Effective Date
            </label>
            <input
              type="date"
              value={manualExternalDate}
              onChange={(e) => setManualExternalDate(e.target.value)}
              className="mb-3 w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[12px] text-adm-t1 focus:border-adm-blue focus:outline-none"
            />

            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-adm-t3">
              原因 / Reason
            </label>
            <textarea
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              rows={3}
              placeholder="Why is a manual confirm needed? / 为何需要人工确认"
              className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-3 py-2 text-[12px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-blue focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={pushSubmitting}
                onClick={() => setManualOpen(false)}
                className="rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[12px] text-adm-t2 transition-colors hover:border-adm-t3 disabled:opacity-50"
              >
                取消 / Cancel
              </button>
              <button
                type="button"
                disabled={
                  pushSubmitting ||
                  !manualReceiptRef.trim() ||
                  !manualExternalDate.trim() ||
                  !manualReason.trim()
                }
                onClick={handleManualPush}
                className="rounded border border-adm-blue/40 bg-adm-blue/10 px-3 py-1.5 font-mono text-[12px] font-semibold text-adm-blue transition-colors hover:bg-adm-blue/20 disabled:opacity-50"
              >
                确认强推 / Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Status History Timeline (from statusHistory JSON) ── */

const StatusHistoryTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) {
    return <p className="py-2 font-mono text-[11px] text-adm-t3">No history.</p>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return <p className="py-2 font-mono text-[11px] text-adm-t3">No history.</p>;
    }
    history = [...parsed].reverse();
  } catch {
    return <p className="py-2 font-mono text-[11px] text-adm-t3">No history.</p>;
  }

  return (
    <div className="relative my-3 ml-3 space-y-4 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.at || idx}`} className="relative ml-6">
          <span className="absolute -left-[34px] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-adm-bg ring-4 ring-adm-bg">
            <div className="h-2.5 w-2.5 rounded-full bg-adm-green" />
          </span>
          <div className="flex items-center gap-2">
            <span className="rounded border border-adm-green/30 bg-adm-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-adm-green">
              {item.toStatus || 'UNKNOWN'}
            </span>
            {item.action ? (
              <span className="font-mono text-[10px] text-adm-t3">{item.action}</span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
            <User size={10} />
            <span className="font-mono">{item.operatorId || 'SYSTEM'}</span>
            <span>·</span>
            <time className="font-mono">
              {item.at ? new Date(item.at).toLocaleString() : '—'}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Audit Log list ── */

const AuditLogList = ({ logs }: { logs: FundsOrderDetail['auditLogs'] }) => {
  if (!logs || logs.length === 0) {
    return <p className="py-2 font-mono text-[11px] text-adm-t3">No audit records.</p>;
  }
  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="rounded border border-adm-border bg-adm-bg px-3 py-2"
        >
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="text-adm-t3">{log.oldStatus || '—'}</span>
            <span className="text-adm-t3">→</span>
            <span className="font-semibold text-adm-t1">{log.newStatus}</span>
          </div>
          {log.reason ? (
            <p className="mt-1 text-[11px] text-adm-t2">{log.reason}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
            <User size={10} />
            <span className="font-mono">{log.operatorId}</span>
            <span>·</span>
            <time className="font-mono">
              {new Date(log.createdAt).toLocaleString()}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
};

export default FundsOrderDetail;

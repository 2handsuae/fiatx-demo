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
  deposit?: FoParent | null;
  withdrawTransaction?: FoParent | null;
  swapTransaction?: FoParent | null;
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
            onClick={() => navigate(`/admin/custody/wallets/${wallet.id}`)}
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
  return null;
};

/* ── Page Component ─────────────────────────────────────────── */

const FundsOrderDetail = () => {
  const { fundsOrderNo } = useParams<{ fundsOrderNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FundsOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

// admin-web/src/pages/PayinDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { explorerTxUrl } from '../utils/explorer';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { AdminBadge } from '../components/ui/AdminBadge';
import { LinkedRelationCard } from '../components/ui/LinkedRelationCard';
import { copyToClipboard } from '../utils/clipboard';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { useSimulationMode } from '../utils/simulationMode';
import {
  getPayinStatusBadgeClass,
  getPayinSimActionsForStatus,
} from '../utils/depositActionMap';

/* ── Types ── */

interface PayinDetailData {
  id: string;
  payinNo: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  customer?: {
    customerNo: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  transactionType: string;
  transactionId: string | null;
  transactionNo: string | null;
  depositId: string | null;
  type: string;
  status: string;
  displayStatus?: string | null;
  assetId: string;
  asset: {
    currency: string;
    code: string;
    type: string;
    network: string | null;
    decimals: number;
    description: string | null;
  };
  amount: string;
  toWalletId: string | null;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  providerTxnId: string | null;
  receivedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: string | null;
}

/* ── Page ── */

const PayinDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PayinDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [simSubmitting, setSimSubmitting] = useState(false);
  const { enabled: simulationModeEnabled } = useSimulationMode();

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load payin'));
        navigate('/admin/trading/payins');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch payin', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSimEvent = async (event: string) => {
    setSimSubmitting(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/treasury/payins/${id}/mock-event`,
        { method: 'POST', body: JSON.stringify({ event }) },
      );
      if (response.ok) {
        const updated = await response.json();
        setData((prev) =>
          prev
            ? { ...prev, ...updated, customer: prev.customer || updated.customer }
            : updated,
        );
      } else {
        alert(await getApiErrorMessage(response, 'Simulation failed'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Sim failed', error);
    } finally {
      setSimSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading payin details...</p>
      </div>
    );
  }

  if (!data) return null;

  const normalizedStatus = normalizeRailDisplayStatus(
    data.displayStatus || data.status,
  );
  const simActions = simulationModeEnabled
    ? getPayinSimActionsForStatus(normalizedStatus, data.type)
    : [];
  const linkedDepositNo = data.transactionNo;

  return (
    <div className="flex h-full flex-col">
      {/* Nav Header */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/payins')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Payins"
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex-1 overflow-y-auto divide-y divide-adm-border">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.payinNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span
                  className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getPayinStatusBadgeClass(normalizedStatus)}`}
                >
                  {formatRailStatusLabel(normalizedStatus)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Amount
                </span>
                <span className="font-semibold text-adm-t1">
                  {formatAssetAmount(data.amount, data.asset.decimals)}{' '}
                  {data.asset.code}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Type
                </span>
                <span className="text-adm-t1">
                  {formatTransactionTypeLabel(data.type)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Asset
                </span>
                <span className="text-adm-t1">
                  {data.asset.code} · {data.asset.network || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* 2a. Chain Details (crypto only) */}
          {data.asset.type !== 'FIAT' && (
            <DetailCard title="Chain Details" columns={2}>
              <InfoField
                label="Tx Hash"
                value={data.txHash}
                copyable
                onCopy={(v) => handleCopy(v, 'txHash')}
                isCopied={copiedField === 'txHash'}
                mono
                link={
                  data.txHash ? explorerTxUrl(data.asset.network, data.txHash) : undefined
                }
              />
              <InfoField
                label="Confirmations"
                value={data.confirmations?.toString()}
              />
              <InfoField
                label="From Address"
                value={data.fromAddress}
                copyable
                onCopy={(v) => handleCopy(v, 'from')}
                isCopied={copiedField === 'from'}
                mono
              />
              <InfoField
                label="To Address"
                value={data.toAddress}
                copyable
                onCopy={(v) => handleCopy(v, 'to')}
                isCopied={copiedField === 'to'}
                mono
              />
              {data.providerTxnId ? (
                <InfoField label="Provider Txn ID" value={data.providerTxnId} mono />
              ) : null}
            </DetailCard>
          )}

          {/* 2b. Bank Transfer (fiat only) */}
          {data.asset.type === 'FIAT' && (
            <DetailCard title="Bank Transfer" columns={2}>
              <InfoField label="From IBAN" value={data.fromIban} mono />
              <InfoField label="To IBAN" value={data.toIban} mono />
              <InfoField label="Reference No" value={data.referenceNo} mono />
              <InfoField label="Provider Txn ID" value={data.providerTxnId} mono />
            </DetailCard>
          )}

          {/* 3. Linked Deposit (conditional) */}
          {linkedDepositNo && (
            <DetailCard title="Linked Deposit" columns={1}>
              <LinkedRelationCard
                cap="Deposit"
                identifier={linkedDepositNo}
                onClick={
                  data.depositId
                    ? () =>
                        navigate(
                          `/admin/trading/deposits/${data.depositId}`,
                        )
                    : undefined
                }
              />
            </DetailCard>
          )}

          {/* 4. Status History */}
          <DetailCard title="Status History" columns={1}>
            <PayinTimeline historyJson={data.statusHistory} />
          </DetailCard>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* Simulation Actions (only in sim mode) */}
          {simulationModeEnabled && (
            <SidebarGroup title="Simulation Controls">
              <div className="rounded border border-dashed border-amber-400 bg-amber-900/20 p-2">
                <div className="mb-2 flex items-center gap-1 font-mono text-[9px] text-amber-400">
                  ⚡ SIM MODE
                </div>
                {(() => {
                  const hasEnabled = simActions.some((a) => a.enabled);
                  if (!hasEnabled) {
                    const isTerminal = ['CLEARED', 'FAILED'].includes(normalizedStatus.toUpperCase());
                    return (
                      <div className="px-2 py-1.5 font-mono text-[10px] text-amber-400/80">
                        {isTerminal
                          ? 'Terminal state — no simulatable events'
                          : 'Auto-progressing — ledger credit in flight…'}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-1.5">
                      {simActions.map((a) => (
                        <button
                          key={a.event}
                          onClick={() => handleSimEvent(a.event)}
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

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Payin No" value={data.payinNo} mono />
            <SidebarKV
              label="Status"
              value={<AdminBadge value={normalizedStatus} />}
            />
            <SidebarKV
              label="Type"
              value={formatTransactionTypeLabel(data.type)}
            />
            <SidebarKV label="Asset" value={data.asset.code} />
            <SidebarKV label="Owner" value={data.ownerNo} mono />
            <SidebarKV
              label="Deposit"
              value={
                linkedDepositNo && data.depositId ? (
                  <button
                    onClick={() =>
                      navigate(
                        `/admin/trading/deposits/${data.depositId}`,
                      )
                    }
                    className="text-adm-blue hover:underline"
                  >
                    {linkedDepositNo}
                  </button>
                ) : (
                  linkedDepositNo || null
                )
              }
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV
              label="Created"
              value={new Date(data.createdAt).toLocaleString()}
              mono
            />
            <SidebarKV
              label="Confirmed"
              value={
                data.confirmedAt
                  ? new Date(data.confirmedAt).toLocaleString()
                  : null
              }
              mono
            />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

/* ── PayinTimeline ── */

const PayinTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson)
    return (
      <div className="text-adm-t3 text-sm italic p-4 text-center">
        No history
      </div>
    );

  let history: any[] = [];
  try {
    history = JSON.parse(historyJson);
    history.sort(
      (a: any, b: any) =>
        new Date(b.changedAt || b.timestamp).getTime() -
        new Date(a.changedAt || a.timestamp).getTime(),
    );
  } catch {
    return (
      <div className="text-adm-red text-sm p-4">Error parsing history</div>
    );
  }

  if (!history.length)
    return (
      <div className="text-adm-t3 text-sm italic p-4 text-center">
        No events
      </div>
    );

  const dotColor: Record<string, string> = {
    CLEARED: 'bg-green-500',
    FAILED: 'bg-red-500',
    CONFIRMED: 'bg-indigo-500',
    CONFIRMING: 'bg-amber-500',
    DETECTED: 'bg-blue-500',
  };
  const badgeCls: Record<string, string> = {
    CLEARED: 'bg-green-50 text-green-700 border-green-200',
    FAILED: 'bg-red-50 text-red-700 border-red-200',
    CONFIRMED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    CONFIRMING: 'bg-amber-50 text-amber-700 border-amber-200',
    DETECTED: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <div className="relative ml-4 space-y-6 border-l-2 border-adm-border my-2">
      {history.map((item: any, idx: number) => {
        const st = normalizeRailDisplayStatus(item.status);
        return (
          <div key={idx} className="ml-8 relative">
            <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
              <div
                className={`h-3 w-3 rounded-full ${dotColor[st] || 'bg-gray-300'}`}
              />
            </span>
            <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${badgeCls[st] || 'bg-gray-50 text-gray-700 border-gray-200'}`}
              >
                {formatRailStatusLabel(st)}
              </span>
              <p className="mt-1 text-sm text-adm-t2">
                {item.reason || '—'}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
                <User size={10} />
                <span className="font-mono">
                  {item.operatorId || 'SYSTEM'}
                </span>
                <span>·</span>
                <time className="font-mono">
                  {new Date(
                    item.changedAt || item.timestamp,
                  ).toLocaleString()}
                </time>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PayinDetail;

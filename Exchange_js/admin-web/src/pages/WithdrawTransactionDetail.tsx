// admin-web/src/pages/WithdrawTransactionDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { explorerTxUrl } from '../utils/explorer';
import { copyToClipboard } from '../utils/clipboard';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';
import {
  getWithdrawActionsForStatus,
  getWithdrawStatusBadgeClass,
} from '../utils/withdrawActionMap';
import { getComplianceLayerStyle } from '../utils/depositActionMap';

/* ── Types ──────────────────────────────────────────────────── */

interface LinkedFundOrder {
  kind: 'PAYOUT' | 'INTERNAL_FUND' | 'PAYIN';
  no: string;
  id: string;
  status: string;
  amount: string;
  role: 'principal' | 'fee';
}

interface WithdrawDetail {
  id: string;
  withdrawNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type?: string | null;
  status: string;
  grossAedValue?: string | null;
  aedRate?: string | null;
  rateFetchedAt?: string | null;
  rateFetchFailed?: boolean | null;
  approvalNo?: string | null;
  assetId: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
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
  preKytStatus: string;
  preKytRiskScore: number | null;
  preKytCheckedAt: string | null;
  kytStatus: string;
  kytRiskScore: number | null;
  kytCheckedAt: string | null;
  travelRuleRequired: boolean;
  travelRuleStatus: string;
  travelRuleCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  payoutId: string | null;
  payoutNo: string | null;
  traceId?: string | null;
  statusHistory: string | null;
  asset: { code: string; type: string; network: string | null; decimals: number };
  customer?: { complianceStatus?: string | null; customerNo?: string } | null;
  payout?: {
    payoutNo: string;
    status: string;
    gasUsed?: string | null;
    effectiveGasPrice?: string | null;
  } | null;
  linkedFundOrders?: LinkedFundOrder[];
}

/* ── Page Component ─────────────────────────────────────────── */

const WithdrawTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [pendingAction, setPendingAction] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load detail'));
        navigate('/admin/trading/withdrawals');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch detail', error);
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

  /* ── Action handlers ── */

  const handleAction = async (action: string, reason?: string) => {
    if (!id) return;
    setIsSubmitting(true);
    setActionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason }),
        },
      );
      if (!response.ok) {
        setActionError(await getApiErrorMessage(response, 'Action failed.'));
        return;
      }
      await fetchData();
      setIsReasonModalOpen(false);
      setReasonText('');
      setPendingAction('');
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setActionError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onActionClick = (action: string, requiresReason: boolean) => {
    if (requiresReason) {
      setPendingAction(action);
      setIsReasonModalOpen(true);
    } else {
      handleAction(action);
    }
  };

  /* ── Loading / Empty ── */

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading details...</p>
      </div>
    );
  }

  if (!data) return null;

  const actions = getWithdrawActionsForStatus(data.status);
  const eligibilityStyle = getComplianceLayerStyle(data.customer?.complianceStatus);
  const preKytStyle = getComplianceLayerStyle(data.preKytStatus);
  const trStyle = getComplianceLayerStyle(
    data.travelRuleRequired ? data.travelRuleStatus : 'NOT_REQUIRED',
  );
  const postKytStyle = getComplianceLayerStyle(data.kytStatus);
  const isFiat = data.asset?.type === 'FIAT';

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/withdrawals')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Withdrawals"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-adm-border">

          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.withdrawNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Status</span>
                <span className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getWithdrawStatusBadgeClass(data.status)}`}>
                  {formatStatusLabel(data.status)}
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Amount</span>
                <span className="font-semibold text-adm-t1">{formatAssetAmount(data.amount, data.asset.decimals)} {data.asset.code}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Type</span>
                <span className="text-adm-t1">{formatTransactionTypeLabel(data.type || data.asset.type)}</span>
              </div>
              {data.ownerNo && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Owner</span>
                  <button
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 2. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div>
              <div className="grid grid-cols-2 gap-3">
                {/* L1: Eligibility Guard */}
                <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${eligibilityStyle.borderColor}`}>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 · Eligibility</div>
                  <div className={`mt-1 text-sm font-bold ${eligibilityStyle.textColor}`}>{eligibilityStyle.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Pre-creation check</div>
                </div>
                {/* L2: Transaction Screen */}
                <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${preKytStyle.borderColor}`}>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L2 · Transaction Screen</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-mono text-[9px] text-adm-t3 w-24">Pre-KYT:</span>
                    <span className={`text-[11px] font-semibold ${preKytStyle.textColor}`}>
                      {data.preKytStatus || '—'}
                    </span>
                    <span className="font-mono text-[10px] text-adm-t3">Risk: {data.preKytRiskScore ?? '—'}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-[9px] text-adm-t3 w-24">Travel Rule:</span>
                    <span className={`text-[11px] font-semibold ${trStyle.textColor}`}>
                      {data.travelRuleRequired ? (data.travelRuleStatus || '—') : 'NOT REQUIRED'}
                    </span>
                  </div>
                </div>
              </div>
              {/* L3: Post-Tx Archive (crypto only) */}
              {!isFiat && (
                <div className="mt-2 flex items-center gap-2 px-1">
                  <span className="font-mono text-[9px] text-adm-t3">L3 Archive:</span>
                  <span className={`text-[11px] font-semibold ${postKytStyle.textColor}`}>
                    {data.kytStatus || '—'}
                  </span>
                  <span className="font-mono text-[9px] text-adm-t3">(post-tx, non-blocking)</span>
                </div>
              )}
            </div>
          </DetailCard>

          {/* 3. Approval Gate (conditional) */}
          {(data.approvalNo || data.grossAedValue || data.rateFetchFailed) && (
            <DetailCard title="Approval Gate" columns={2}>
              <InfoField label="Approval No" value={data.approvalNo || '—'} mono />
              <InfoField label="Gross Value (AED)" value={data.grossAedValue ? Number(data.grossAedValue).toLocaleString() : '—'} accent />
              <InfoField label="AED Rate" value={data.aedRate || '—'} mono />
              <InfoField label="Rate Fetched At" value={data.rateFetchedAt ? new Date(data.rateFetchedAt).toLocaleString() : '—'} />
              {data.rateFetchFailed ? (
                <InfoField label="Valuation" value="Rate fetch failed — routed to approval (fail-closed)" />
              ) : null}
            </DetailCard>
          )}

          {/* 4. Transaction Details */}
          <DetailCard title="Transaction Details" columns={2}>
            <InfoField label="Asset" value={`${data.asset.code} · ${data.asset.type} · ${data.asset.network || 'N/A'}`} />
            <InfoField label="Amount" value={formatAssetAmount(data.amount, data.asset.decimals)} accent />
            <InfoField label="Fee" value={formatAssetAmount(data.feeAmount, data.asset.decimals)} />
            <InfoField label="Net Amount" value={formatAssetAmount(data.netAmount, data.asset.decimals)} accent />
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono link={data.txHash ? explorerTxUrl(data.asset.network, data.txHash) : undefined} />
            <InfoField label="Confirmations" value={data.confirmations ?? null} />
            <InfoField label="Gas Used" value={data.payout?.gasUsed ?? null} mono />
            <InfoField label="Effective Gas Price" value={data.payout?.effectiveGasPrice ?? null} mono />
            <InfoField label="Destination Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="From Wallet" value={data.fromWalletNo} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
          </DetailCard>

          {/* 5. Linked Funds Orders — payout (principal) + internal fund (fee) */}
          <DetailCard title="Linked Funds Orders" columns={1}>
            {data.linkedFundOrders && data.linkedFundOrders.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.linkedFundOrders.map((o) => (
                  <LinkedRelationCard
                    key={o.no}
                    cap={o.role === 'fee' ? 'Fee · Internal Fund' : 'Principal · Payout'}
                    identifier={o.no}
                    statusValue={o.status}
                    meta={`${formatAssetAmount(o.amount, data.asset.decimals)} ${data.asset.code}`}
                    onClick={() =>
                      o.kind === 'PAYOUT'
                        ? navigate(`/admin/trading/payouts/${o.id}`)
                        : navigate(`/admin/funds/internal-funds/${o.no}`)
                    }
                  />
                ))}
              </div>
            ) : (
              <LinkedRelationEmpty cap="Funds Order" message="No fund orders yet" />
            )}
          </DetailCard>

          {/* 7. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 8. Technical */}
          <DetailCard title="Technical" columns={1}>
            <InfoField label="Trace ID" value={data.traceId} mono />
          </DetailCard>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">

          {/* Actions */}
          <SidebarGroup title="Actions">
            {actionError && <p className="mb-2 text-[11px] text-adm-red">{actionError}</p>}
            <div className="flex flex-col gap-2">
              {actions.map((a) => {
                const baseCls =
                  a.variant === 'workflowPrimary'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : a.variant === 'workflowNegative'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300';
                return (
                  <button
                    key={a.action}
                    onClick={() => onActionClick(a.action, a.requiresReason)}
                    disabled={!a.enabled || isSubmitting}
                    className={`w-full rounded px-3 py-2 text-sm font-medium transition-colors ${baseCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isSubmitting && pendingAction === a.action ? 'Processing...' : a.label}
                  </button>
                );
              })}
            </div>
          </SidebarGroup>

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Withdraw No" value={data.withdrawNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={data.status} />} />
            <SidebarKV
              label="Owner"
              value={
                data.ownerNo ? (
                  <button
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo}
                  </button>
                ) : null
              }
            />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Asset" value={data.asset.code} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            {data.approvedAt && (
              <SidebarKV label="Approved" value={new Date(data.approvedAt).toLocaleString()} mono />
            )}
            {data.completedAt && (
              <SidebarKV label="Completed" value={new Date(data.completedAt).toLocaleString()} mono />
            )}
          </SidebarGroup>
        </div>
      </div>

      {/* ── Reason Modal ── */}
      {isReasonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Reason Required</h3>
            <textarea
              className="w-full rounded border p-2 text-sm mb-4"
              rows={3}
              placeholder="Enter reason for this action..."
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsReasonModalOpen(false);
                  setReasonText('');
                  setPendingAction('');
                }}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(pendingAction, reasonText)}
                disabled={isSubmitting || !reasonText.trim()}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── StatusTimeline ─────────────────────────────────────────── */

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson)
    return (
      <div className="text-adm-t3 text-sm italic p-4 text-center">
        No history available
      </div>
    );

  let history: any[] = [];
  try {
    history = JSON.parse(historyJson);
    history.sort(
      (a: any, b: any) =>
        new Date(b.timestamp || b.changedAt).getTime() -
        new Date(a.timestamp || a.changedAt).getTime(),
    );
  } catch {
    return <div className="text-adm-red text-sm p-4">Error parsing history</div>;
  }

  if (history.length === 0)
    return (
      <div className="text-adm-t3 text-sm italic p-4 text-center">No events</div>
    );

  return (
    <div className="relative ml-4 space-y-6 border-l-2 border-adm-border my-2">
      {history.map((item: any, idx: number) => (
        <div key={idx} className="ml-8 relative">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className={`h-3 w-3 rounded-full ${getTimelineDotColor(item.status)}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getTimelineBadge(item.status)}`}
              >
                {formatStatusLabel(item.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.reason || 'No reason provided'}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">
                {item.operatorId || item.actorType || 'SYSTEM'}
              </span>
              <span>·</span>
              <time className="font-mono">
                {new Date(item.timestamp || item.changedAt).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const getTimelineDotColor = (status: string) => {
  const map: Record<string, string> = {
    SUCCESS:            'bg-green-500',
    FAILED:             'bg-orange-500',
    REJECTED:           'bg-red-500',
    CANCELLED:          'bg-red-700',
    RETURNED:           'bg-purple-500',
    PENDING_COMPLIANCE: 'bg-purple-500',
    PENDING_APPROVAL:   'bg-amber-500',
    APPROVED:           'bg-blue-500',
    PAYOUT_PENDING:     'bg-blue-500',
    PROCESSING:         'bg-blue-400',
    CREATED:            'bg-gray-400',
    FROZEN:             'bg-cyan-500',
  };
  return map[status] || 'bg-gray-300';
};

const getTimelineBadge = (status: string) => {
  const map: Record<string, string> = {
    SUCCESS:            'bg-green-50 text-green-700 border-green-200',
    FAILED:             'bg-orange-50 text-orange-700 border-orange-200',
    REJECTED:           'bg-red-50 text-red-700 border-red-200',
    CANCELLED:          'bg-red-100 text-red-800 border-red-300',
    RETURNED:           'bg-purple-50 text-purple-700 border-purple-200',
    PENDING_COMPLIANCE: 'bg-purple-50 text-purple-700 border-purple-200',
    PENDING_APPROVAL:   'bg-amber-50 text-amber-700 border-amber-200',
    APPROVED:           'bg-blue-50 text-blue-700 border-blue-200',
    PAYOUT_PENDING:     'bg-blue-50 text-blue-700 border-blue-200',
    PROCESSING:         'bg-blue-50 text-blue-600 border-blue-200',
    CREATED:            'bg-gray-50 text-gray-700 border-gray-200',
    FROZEN:             'bg-cyan-50 text-cyan-700 border-cyan-200',
  };
  return map[status] || 'bg-gray-50 text-gray-700 border-gray-200';
};

export default WithdrawTransactionDetail;

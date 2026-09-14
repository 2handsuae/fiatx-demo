// admin-web/src/pages/WithdrawTransactionDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
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
import { formatSlaRemaining } from '../utils/slaDisplay';
import { formatTransactionTypeLabel } from '../utils/transactionRootDisplay';
import { getComplianceLayerStyle } from '../utils/depositActionMap';
import L1GateCard from '../components/L1GateCard';
import { GateTile } from '../components/compliance/GateTile';
import { SumsubDetailSection } from '../components/compliance/SumsubDetailSection';
import { StatusTimeline } from '../components/compliance/StatusTimeline';
import { NeedsReviewBanner } from '../components/compliance/NeedsReviewBanner';
import {
  getWithdrawStatusMeta,
  isWithdrawTerminalStatus,
} from '../utils/withdrawStatusMap';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { useSimulationMode } from '../utils/simulationMode';
import { SimulationPanel } from '../components/SimulationPanel';
import MaterialRequestPanel from '../components/MaterialRequestPanel';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

/* ── Types ──────────────────────────────────────────────────── */

/* 硬抄件。同步源：src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
   的 WithdrawWorkflowService.KYT_VERDICT_TERMINAL_STATUSES。
   ⚠️ 名字就是 TERMINAL —— 提现域**没有**跟着充值域改名成 IGNORED，grep 'IGNORED'
   在这个域里搜不到集合定义。
   ⚠️ PAYOUT_PENDING 刻意**不**在这里：后端判它 EVIDENCE_ONLY（证据照落 + 打
   needsReview），不是 no-op，所以按钮不置灰。 */
const WITHDRAW_KYT_VERDICT_TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'RETURNED',
]);

const isWithdrawVerdictIgnored = (status: string): boolean =>
  WITHDRAW_KYT_VERDICT_TERMINAL_STATUSES.has(status) || status === 'FROZEN';

interface LinkedFundOrder {
  kind: 'PAYOUT' | 'INTERNAL_FUND';
  no: string;
  id: string;
  status: string;
  amount: string;
  role: 'principal' | 'fee';
}

/** Matched-rule entry inside a Sumsub getTxn scoring result (see backend
 *  `findOneForAdmin` parseDetail). */
interface SumsubMatchedRule {
  id?: string;
  name?: string;
  action?: string;
  score?: number;
}

/** Admin-readable subset of a Sumsub getTxn report for this withdrawal's single
 *  Sumsub txn — parsed server-side from the raw stored payload. */
interface SumsubTxnDetail {
  verdict: string | null;
  reviewStatus: string | null;
  reviewAnswer: string | null;
  score: number | null;
  matchedRules: SumsubMatchedRule[];
  applicantActionIds: string[];
  tags: string[];
  raw: unknown;
}

/** Internal (non-Sumsub) approval case linked to this withdrawal — single
 *  header only, no step/steps (see backend `findOneForAdmin`). */
interface WithdrawApproval {
  approvalNo: string;
  actionType: string;
  status: string;
  createdAt: string;
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
  referenceNo: string | null;
  counterpartyIsVasp?: boolean | null;
  manualReason?: string | null;
  needsReview?: boolean;
  sumsubTxnId?: string | null;
  sumsubTxnType?: 'finance' | 'travelRule' | null;
  sumsubVerdict?: string | null;
  sumsubScore?: number | null;
  sumsubScoredAt?: string | null;
  slaDeadline?: string | null;
  slaBreached?: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  traceId?: string | null;
  statusHistory: string | null;
  l1Snapshot?: string | null;
  asset: { code: string; type: string; network: string | null; decimals: number };
  /** `lifecycle` = 客户关系生命周期七态（PROSPECT/IN_VERIFICATION/…/ACTIVE/…/OFFBOARDED）。 */
  customer?: { lifecycle?: string | null; sumsubApplicantId?: string | null; customerNo?: string | null } | null;
  linkedFundOrders?: LinkedFundOrder[];
  sumsubDetail?: SumsubTxnDetail | null;
  approvals?: WithdrawApproval[];
  /** 平账 B 批 Task 10：出款后被银行退回的认领来源（补单三路③）。 */
  returnOrigin?: { reconCaseNo: string | null; externalRef: string | null } | null;
  /** 波二 Task 7：订单↔报价互链——只放摘要四样，不铺 feeBreakdown（业主拍板）。 */
  pricingQuote?: {
    quoteNo: string;
    matchedTierName: string;
    feeLevelCode: string | null;
    totalsJson: string;
    createdAt: string;
  } | null;
}

/** Internal-approval `actionType` → English action label shown in the
 *  Internal Approvals block. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  WITHDRAW_LARGE_VALUE_APPROVAL: 'Large-Value Approval',
  WITHDRAW_UNFREEZE: 'Unfreeze',
  WITHDRAW_SANCTION_REFUND: 'Reject & Freeze Customer',
};

/* ── Page Component ─────────────────────────────────────────── */

const WithdrawTransactionDetail = () => {
  const { withdrawNo } = useParams<{ withdrawNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [dispositionSubmitting, setDispositionSubmitting] = useState(false);
  const [dispositionError, setDispositionError] = useState('');
  const [isUnfreezeModalOpen, setIsUnfreezeModalOpen] = useState(false);
  const [unfreezeReason, setUnfreezeReason] = useState('');
  const [unfreezeOrderRef, setUnfreezeOrderRef] = useState('');
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [isBounceModalOpen, setIsBounceModalOpen] = useState(false);
  const [bounceReason, setBounceReason] = useState('');
  const { enabled: simEnabled } = useSimulationMode();
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState('');
  const { hasPermission } = useAdminSession();
  // 评审修复（对账两角色收权，2026-09-10）：⚡ Simulate SLA Timeout 此前只按
  // slaDeadline/slaBreached 显隐，不查权限码——运营丢了 DEMO_CLOCK_WRITE 后按钮
  // 仍在、一点即 403；补门控，代表码见 permissions.ts。
  const canSimulateSlaTimeout = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${withdrawNo}`,
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
    if (withdrawNo) fetchData();
  }, [withdrawNo]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /* ── Frozen disposition handlers (unfreeze / sanction refund — maker-checker) ── */

  const handleUnfreezeSubmit = async () => {
    if (!data?.id || !unfreezeReason.trim() || !unfreezeOrderRef.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${data.id}/unfreeze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: unfreezeReason.trim(),
            orderRef: unfreezeOrderRef.trim(),
          }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to submit unfreeze request.'));
        return;
      }
      const result = await response.json();
      setNotice(`Unfreeze submitted for approval — ${result.approvalNo}`);
      setIsUnfreezeModalOpen(false);
      setUnfreezeReason('');
      setUnfreezeOrderRef('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to submit unfreeze request.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  const handleRefundSubmit = async () => {
    if (!data?.id || !refundReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${data.id}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: refundReason.trim() }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to submit refund request.'));
        return;
      }
      const result = await response.json();
      setNotice(`Reject & freeze submitted for approval — ${result.approvalNo}`);
      setIsRefundModalOpen(false);
      setRefundReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to submit refund request.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  /* ── Bounce handler (PAYOUT_PENDING → RETURNED, no approval — immediate) ── */

  const handleBounceSubmit = async () => {
    if (!data?.id || !bounceReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${data.id}/bounce`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: bounceReason.trim() }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to bounce payout.'));
        return;
      }
      setNotice('Payout bounced — withdrawal returned');
      setIsBounceModalOpen(false);
      setBounceReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to bounce payout.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  /* ── SLA (演示用「模拟超时」——不是 ⚡ Simulation 面板那个模拟 Sumsub
      webhook 的东西；见 SidebarGroup title="SLA") ── */

  const handleSimulateSlaTimeout = async () => {
    if (!data) return;
    setSlaSubmitting(true);
    setSlaError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${data.withdrawNo}/simulate-sla-timeout`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setSlaError(await getApiErrorMessage(response, 'Failed to simulate SLA timeout.'));
        return;
      }
      setNotice('SLA deadline moved to the past — next scan will breach it');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSlaError(error instanceof Error ? error.message : 'Failed to simulate SLA timeout.');
    } finally {
      setSlaSubmitting(false);
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

  // L1 · Eligibility — 读客户生命周期 `lifecycle`。
  // 第四批修复轮：此前读 `customer.complianceStatus`,那一列与 `restrictions` 是同一次
  // migration（20260816063807_customer_lifecycle_restrictions）一起 drop 的,早已不存在,
  // 恒 undefined → 这一格恒显示灰色 `N/A`。`lifecycle` 正是 L1GateService 的
  // CUSTOMER_ELIGIBILITY 判的东西（`access.lifecycle === 'ACTIVE'`）,口径天然一致。
  const eligibilityStyle = getComplianceLayerStyle(data.customer?.lifecycle);
  // L2 · Transaction Screen — a withdrawal submits a single Sumsub txn (finance
  // or travelRule, decided by the type resolver), one verdict shown verbatim.
  const l2Style = getComplianceLayerStyle(data.sumsubVerdict);
  const isTerminal = isWithdrawTerminalStatus(data.status);

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/withdrawals')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Withdrawals"
      />

      {/* ── Notice ── */}
      {notice && (
        <div className="shrink-0 border-b border-adm-border bg-adm-green/5 px-6 py-2.5 font-mono text-[11px] text-adm-green">
          {notice}
        </div>
      )}

      <NeedsReviewBanner
        show={!!data.needsReview}
        message="Needs review — this withdrawal is parked with no automatic action left: either a fee leg exhausted its retries, or a KYT verdict arrived after the payout broadcast. Check the audit trail for which."
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
                <span className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getWithdrawStatusMeta(data.status).badgeClass}`}>
                  {getWithdrawStatusMeta(data.status).label}
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
              {(data.ownerNo || data.customer?.customerNo) && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Owner</span>
                  <button
                    onClick={() => navigate(`/admin/customers/${data.ownerNo || data.customer?.customerNo}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo || data.customer?.customerNo}
                  </button>
                </div>
              )}
              {/* SLA — 没有 deadline（终态 / FROZEN 等不计时的单）整格不显示；
                  slaBreached 优先于时间计算（formatSlaRemaining 内部已处理），
                  软破线后单据状态与 deadline 都不变，只有这个标记能表达已超时。 */}
              {data.slaDeadline && (() => {
                const sla = formatSlaRemaining(data.slaDeadline, data.slaBreached);
                return (
                  <div>
                    <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">SLA</span>
                    <span className={`mt-1 inline-flex items-center gap-2 ${sla.tone === 'breached' ? 'font-semibold text-red-600' : 'text-adm-t1'}`}>
                      {sla.text}
                      {sla.tone === 'breached' && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] text-red-700">
                          Overdue since {new Date(data.slaDeadline).toLocaleString()}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* 2. Transaction Details */}
          <DetailCard title="Transaction Details" columns={2}>
            <InfoField label="Asset" value={`${data.asset.code} · ${data.asset.type} · ${data.asset.network || 'N/A'}`} />
            <InfoField label="Amount" value={formatAssetAmount(data.amount, data.asset.decimals)} accent />
            <InfoField label="Fee" value={formatAssetAmount(data.feeAmount, data.asset.decimals)} />
            <InfoField label="Net Amount" value={formatAssetAmount(data.netAmount, data.asset.decimals)} accent />
            {data.returnOrigin && <InfoField label="Return Origin" value={`Returned by bank after payout · case ${data.returnOrigin.reconCaseNo} · statement line ${data.returnOrigin.externalRef} · principal re-recorded, fee not refunded`} />}
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono link={data.txHash ? explorerTxUrl(data.asset.network, data.txHash) : undefined} />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="To Iban" value={data.toIban} copyable onCopy={(v) => handleCopy(v, 'toIban')} isCopied={copiedField === 'toIban'} mono />
            <InfoField label="From Wallet" value={data.fromWalletNo} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
          </DetailCard>

          {/* Pricing Quote — summary only (quote linkage, fee tier, fee total,
              quoted-at); no feeBreakdown here (业主拍板 §1-4，见 spec)。波二 Task 7。 */}
          {data.pricingQuote && (
            <DetailCard title="Pricing Quote" columns={2}>
              <InfoField
                label="Quote No"
                value={data.pricingQuote.quoteNo}
                mono
                link={`/admin/trading/withdraw-quotes/${encodeURIComponent(data.pricingQuote.quoteNo)}`}
              />
              <InfoField
                label="Fee Level / Tier"
                value={`${data.pricingQuote.feeLevelCode ?? '—'} / ${data.pricingQuote.matchedTierName}`}
              />
              <InfoField
                label="Fee Total"
                value={
                  Object.entries(JSON.parse(data.pricingQuote.totalsJson || '{}'))
                    .map(([c, v]) => `${v} ${c}`)
                    .join(' + ') || '—'
                }
              />
              <InfoField label="Quoted At" value={new Date(data.pricingQuote.createdAt).toLocaleString()} />
            </DetailCard>
          )}

          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard — 读客户生命周期。提现的闸门在建单前跑。 */}
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption="Pre-creation check"
                style={eligibilityStyle}
              />
              {/* L2: Transaction Screen — 提现只送一笔 Sumsub txn（finance 或
                  travelRule，按 `sumsubTxnType`）。2026-08-23：前缀改成与充值同款的
                  人话（此前裸显后端字面量 `finance`），Score 从主值行挪到副行，
                  主值字号升到与 L1 同级。 */}
              <GateTile
                title="L2 · Transaction Screen"
                value={`${data.sumsubTxnType === 'travelRule' ? 'Travel Rule' : 'Finance'}: ${
                  data.sumsubVerdict ?? '—'
                }`}
                caption={`Score ${data.sumsubScore ?? '—'}`}
                style={l2Style}
              />
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>

          {/* 4. Sumsub References (read-only) — Applicant ID + the single
              Sumsub txn this withdrawal submitted. */}
          <DetailCard title="Sumsub References" columns={2}>
            <div className="col-span-2">
              <InfoField
                label="Applicant ID"
                value={data.customer?.sumsubApplicantId}
                copyable
                onCopy={(v) => handleCopy(v, 'sumsubApplicantId')}
                isCopied={copiedField === 'sumsubApplicantId'}
                mono
              />
            </div>
            <div className="col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-4">
              <InfoField
                label="Txn ID"
                value={data.sumsubTxnId}
                copyable
                onCopy={(v) => handleCopy(v, 'sumsubTxnId')}
                isCopied={copiedField === 'sumsubTxnId'}
                mono
              />
              <InfoField label="Type" value={data.sumsubTxnType} />
              <InfoField label="Verdict" value={data.sumsubVerdict} />
              <InfoField
                label="Received At"
                value={data.sumsubScoredAt ? new Date(data.sumsubScoredAt).toLocaleString() : null}
              />
            </div>
          </DetailCard>

          {/* 5. Sumsub Transaction Detail — admin-readable subset of the raw
              Sumsub getTxn report for this withdrawal's single txn
              (findOneForAdmin's parseDetail on the backend). */}
          <DetailCard title="Sumsub Transaction Detail" columns={1}>
            <SumsubDetailSection detail={data.sumsubDetail} />
          </DetailCard>

          {/* 6. Internal Approvals — maker-checker cases raised against this
              withdrawal (large-value/unfreeze/sanction-refund), single header only. */}
          <DetailCard title="Internal Approvals" columns={1}>
            {data.approvals && data.approvals.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.approvals.map((a) => (
                  <LinkedRelationCard
                    key={a.approvalNo}
                    cap={APPROVAL_ACTION_LABELS[a.actionType] ?? a.actionType}
                    identifier={a.approvalNo}
                    statusValue={a.status}
                    meta={new Date(a.createdAt).toLocaleString()}
                    onClick={() => navigate(`/admin/governance/approvals/${a.approvalNo}`)}
                  />
                ))}
              </div>
            ) : (
              <LinkedRelationEmpty cap="Internal Approval" message="No internal approvals" />
            )}
          </DetailCard>

          {/* 7. Linked Funds Orders — payout (principal) + internal fund (fee) */}
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
                    onClick={() => navigate(`/admin/funds-orders/${o.no}`)}
                  />
                ))}
              </div>
            ) : (
              <LinkedRelationEmpty cap="Funds Order" message="No fund orders yet" />
            )}
          </DetailCard>

          {/* 8. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} getStatusMeta={getWithdrawStatusMeta} />
          </DetailCard>

          {/* Verification Requests — same component + endpoint as the customer
              detail page's Verification Requests section, `mode="order"` scopes
              it to this withdraw's still-live rows (G6). */}
          <DetailCard title="Verification Requests" columns={1}>
            <MaterialRequestPanel mode="order" orderDomain="WITHDRAW" orderRef={data.withdrawNo} />
          </DetailCard>

          {/* 9. Simulation (demo only — gated by the local simulation-mode
              toggle, independent of the backend SUMSUB_MOCK_MODE flag) */}
          {simEnabled && (
            <SimulationPanel
              domain="withdraw"
              orderId={data.id}
              disabled={isWithdrawVerdictIgnored(data.status)}
              onDone={() => void fetchData()}
            />
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">

          {/* Bounce — payout broadcast but bounced by bank/network. Only
              available from PAYOUT_PENDING (see WithdrawWorkflowService.onBounce's
              BOUNCE_REQUIRES_PAYOUT_PENDING/BOUNCE_REQUIRES_POSTED_PAYOUT guards). */}
          {data.status === 'PAYOUT_PENDING' && (
            <SidebarGroup title="Payout Disposition">
              {dispositionError && <p className="mb-2 text-[11px] text-adm-red">{dispositionError}</p>}
              <button
                onClick={() => {
                  setDispositionError('');
                  setBounceReason('');
                  setIsBounceModalOpen(true);
                }}
                disabled={dispositionSubmitting}
                className={adminButtonClass('workflowNegative')}
              >
                Bounce Payout
              </button>
            </SidebarGroup>
          )}

          {/* Frozen Disposition — initiate unfreeze / sanction-refund (both
              maker-checker approvals, not immediate execution): unfreeze opens a
              single-step MLRO approval; refund opens a single-step MLRO approval
              that returns the funds to sender. FROZEN can only leave via this
              maker-checker flow (see the transition table in
              withdraw-transactions.service.ts). */}
          {data.status === 'FROZEN' && (
            <SidebarGroup title="Frozen Disposition">
              {dispositionError && <p className="mb-2 text-[11px] text-adm-red">{dispositionError}</p>}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setDispositionError('');
                    setUnfreezeReason('');
                    setUnfreezeOrderRef('');
                    setIsUnfreezeModalOpen(true);
                  }}
                  disabled={dispositionSubmitting}
                  className={adminButtonClass('workflowSecondary')}
                >
                  Initiate Unfreeze
                </button>
                <button
                  onClick={() => {
                    setDispositionError('');
                    setRefundReason('');
                    setIsRefundModalOpen(true);
                  }}
                  disabled={dispositionSubmitting}
                  className={adminButtonClass('workflowNegative')}
                >
                  Reject & Freeze Customer
                </button>
              </div>
            </SidebarGroup>
          )}

          {/* Manual checking — no action buttons; disposition happens in
              Sumsub, not here (mirrors deposit's 2026-07-29 frontend spec §2.2). */}
          {data.status === 'MANUAL_CHECKING' && (
            <p className="mb-4 font-mono text-[11px] text-adm-t3">
              Disposition happens in the Sumsub console (officer tags the txn, then re-rejects).
            </p>
          )}

          {/* Terminal — no further disposition available. */}
          {isTerminal && (
            <p className="mb-4 font-mono text-[11px] text-adm-t3">
              Terminal — no further action available.
            </p>
          )}

          {/* SLA — 演示用「模拟超时」，不是 ⚡ Simulation 面板那个模拟 Sumsub
              webhook 的东西。data.slaDeadline 非空 = 该单当前处于计时状态；
              已破线（slaBreached）就不再需要这个按钮了。 */}
          {data.slaDeadline && !data.slaBreached && canSimulateSlaTimeout && (
            <SidebarGroup title="SLA">
              {slaError && <p className="mb-2 text-[11px] text-adm-red">{slaError}</p>}
              <button
                onClick={handleSimulateSlaTimeout}
                disabled={slaSubmitting}
                className="w-full rounded border border-amber-300 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {slaSubmitting ? 'Processing...' : 'Simulate SLA Timeout'}
              </button>
            </SidebarGroup>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Withdraw No" value={data.withdrawNo} mono />
            <SidebarKV
              label="Owner"
              value={
                (data.ownerNo || data.customer?.customerNo) ? (
                  <button
                    onClick={() => navigate(`/admin/customers/${data.ownerNo || data.customer?.customerNo}`)}
                    className="text-adm-blue hover:underline"
                  >
                    {data.ownerNo || data.customer?.customerNo}
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
            <SidebarKV
              label="Approved"
              value={data.approvedAt ? new Date(data.approvedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV label="Trace ID" value={data.traceId ?? null} mono />
          </SidebarGroup>
        </div>
      </div>

      {/* ── Unfreeze Modal ── */}
      {isUnfreezeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Initiate Unfreeze</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {dispositionError && <p className="text-[11px] text-adm-red">{dispositionError}</p>}
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Reason
                </label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                  rows={3}
                  placeholder="Enter reason for unfreezing this withdrawal (required)..."
                  value={unfreezeReason}
                  onChange={(e) => setUnfreezeReason(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Delisting/unfreeze order reference
                </label>
                <input
                  type="text"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                  placeholder="e.g. delisting or release order number"
                  value={unfreezeOrderRef}
                  onChange={(e) => setUnfreezeOrderRef(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsUnfreezeModalOpen(false);
                  setUnfreezeReason('');
                  setUnfreezeOrderRef('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleUnfreezeSubmit}
                disabled={dispositionSubmitting || !unfreezeReason.trim() || !unfreezeOrderRef.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Refund Modal ── */}
      {isRefundModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Reject &amp; Freeze Customer</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {dispositionError && <p className="text-[11px] text-adm-red">{dispositionError}</p>}
              <textarea
                className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                rows={3}
                placeholder="Enter reason for rejecting this withdrawal and freezing the customer (required)..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsRefundModalOpen(false);
                  setRefundReason('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleRefundSubmit}
                disabled={dispositionSubmitting || !refundReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bounce Modal ── */}
      {isBounceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Bounce Payout</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {dispositionError && <p className="text-[11px] text-adm-red">{dispositionError}</p>}
              <textarea
                className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                rows={3}
                placeholder="Enter reason the bank/network bounced this payout (required)..."
                value={bounceReason}
                onChange={(e) => setBounceReason(e.target.value)}
              />
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsBounceModalOpen(false);
                  setBounceReason('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleBounceSubmit}
                disabled={dispositionSubmitting || !bounceReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WithdrawTransactionDetail;

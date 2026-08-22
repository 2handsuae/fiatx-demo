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
import {
  getWithdrawStatusMeta,
  isWithdrawTerminalStatus,
} from '../utils/withdrawStatusMap';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { useSimulationMode } from '../utils/simulationMode';
import MaterialRequestPanel from '../components/MaterialRequestPanel';

/* ── Types ──────────────────────────────────────────────────── */

/* 10 个单步裁决按钮,与充值版镜像(去掉充值独有的 below-min)。key/label 必须与后端
   src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts 的 WITHDRAW_VERDICT_BUTTONS
   逐一对齐 —— 这里没有自动化断言(admin-web 暂无测试基建),改动任一侧务必同步改另一侧,
   否则 operator 会点不出新场景。 */
const WITHDRAW_VERDICT_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'V1_APPROVED', label: '① Approved' },
  { key: 'V2_AWAIT_USER', label: '② Awaiting user' },
  { key: 'V3_AWAIT_USER_PEP', label: '③ Awaiting user · PEP' },
  { key: 'V4_REJECTED_SANCTION_APPLICANT', label: '④ Rejected · Sanctions（客户本人）' },
  { key: 'V4B_REJECTED_SANCTION_COUNTERPARTY', label: '④B Rejected · Sanctions（对手方）' },
  { key: 'V5_REJECTED_FROZEN_MLRO', label: '⑤ Rejected · MLRO freeze' },
  { key: 'V6_REJECTED_REFUND_TAG', label: '⑥ Rejected · Refund tag' },
  { key: 'V7_REJECTED_NO_TAG', label: '⑦ Rejected · no disposition tag' },
  { key: 'V8_ONHOLD', label: '⑧ On hold' },
  { key: 'V9_REJECTED_SLA', label: '⑨ Rejected · SLA breach' },
  { key: 'V10_AWAIT_USER_MULTI', label: '⑩ Awaiting user · 多条' },
];

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
  confirmations: number;
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
  const { id } = useParams<{ id: string }>();
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
  const [simSubmitting, setSimSubmitting] = useState<string | null>(null);
  const [simError, setSimError] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState('');

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

  /* ── Demo verdict handler (SUMSUB_MOCK_MODE-gated backend endpoint) ── */

  const handleRunVerdict = async (verdict: string) => {
    if (!id) return;
    setSimSubmitting(verdict);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdraw-sumsub/demo/run-verdict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ withdrawId: id, verdict }),
        },
      );
      if (!response.ok) {
        if (response.status === 404) {
          setSimError('Demo endpoint unavailable — backend SUMSUB_MOCK_MODE is off.');
        } else {
          setSimError(await getApiErrorMessage(response, 'Verdict run failed.'));
        }
        return;
      }
      setNotice(`Verdict ${verdict} fed — withdrawal refreshed`);
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Verdict run failed.');
    } finally {
      setSimSubmitting(null);
    }
  };

  /* ── Frozen disposition handlers (unfreeze / sanction refund — maker-checker) ── */

  const handleUnfreezeSubmit = async () => {
    if (!id || !unfreezeReason.trim() || !unfreezeOrderRef.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/unfreeze`,
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
    if (!id || !refundReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/refund`,
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
    if (!id || !bounceReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/bounce`,
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

      {/* ── Needs-review banner — a KYT verdict arrived after the payout already
          broadcast, so there was no state-machine action to take (funds already
          in flight); flagged for operator awareness rather than silently dropped. ── */}
      {data.needsReview && (
        <div className="shrink-0 border-b border-adm-border bg-adm-red/5 px-6 py-2.5 font-mono text-[11px] text-adm-red">
          Needs review — a KYT verdict arrived after the payout broadcast; no automatic action was taken
        </div>
      )}

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
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
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
                          已于 {new Date(data.slaDeadline).toLocaleString()} 超时
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
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono link={data.txHash ? explorerTxUrl(data.asset.network, data.txHash) : undefined} />
            <InfoField label="Confirmations" value={data.confirmations ?? null} />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="To Iban" value={data.toIban} copyable onCopy={(v) => handleCopy(v, 'toIban')} isCopied={copiedField === 'toIban'} mono />
            <InfoField label="From Wallet" value={data.fromWalletNo} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
          </DetailCard>

          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${eligibilityStyle.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 · Eligibility</div>
                <div className={`mt-1 text-sm font-bold ${eligibilityStyle.textColor}`}>{eligibilityStyle.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Pre-creation check</div>
              </div>
              {/* L2: Transaction Screen — a withdrawal submits exactly one
                  Sumsub txn (finance or travelRule, per `sumsubTxnType`);
                  single line: type: verdict · Score. */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${l2Style.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L2 · Transaction Screen</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-[11px] font-semibold ${l2Style.textColor}`}>
                    {data.sumsubTxnType ?? '—'}: {data.sumsubVerdict ?? '—'}
                  </span>
                  <span className="font-mono text-[10px] text-adm-t3">
                    · Score {data.sumsubScore ?? '—'}
                  </span>
                </div>
              </div>
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
                    onClick={() => navigate('/admin/governance/approvals')}
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
            <StatusTimeline historyJson={data.statusHistory} />
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
            <DetailCard title="⚡ Simulation" columns={1}>
              <p className="font-mono text-[11px] text-adm-t3">
                Feeds ONE Sumsub KYT verdict webhook into the real ingestion
                pipeline. The report is generated to match this withdrawal's actual
                Sumsub txn type. Requires SUMSUB_MOCK_MODE on the backend.
              </p>
              <p className="font-mono text-[11px] text-adm-amber">
                Verdicts are atomic — chain them freely (e.g. ② then ①, or ⑦ then ⑤).
              </p>
              <p className="font-mono text-[11px] text-adm-t3">
                ⑨ only posts a rejected verdict tagged SLA_BREACH — it does not
                drive the real SLA timer (WithdrawSlaService); same code path as ⑦.
              </p>
              {simError && <p className="text-[11px] text-adm-red">{simError}</p>}
              <div className="flex flex-wrap gap-2">
                {WITHDRAW_VERDICT_BUTTONS.map((s) => (
                  <button
                    key={s.key}
                    disabled={simSubmitting !== null}
                    onClick={() => handleRunVerdict(s.key)}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simSubmitting === s.key ? 'Running...' : s.label}
                  </button>
                ))}
              </div>
            </DetailCard>
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
          {data.slaDeadline && !data.slaBreached && (
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
                    onClick={() => navigate(`/customers/${data.ownerId}`)}
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

/* ── SumsubDetailSection ─────────────────────────────────────── */

/**
 * Renders the parsed Sumsub getTxn report for this withdrawal's single Sumsub
 * txn — the raw payload behind `detail.raw` is that txn's report verbatim.
 * Mirrors DepositTransactionDetail's SumsubDetailSection (deliberate fork).
 */
const SumsubDetailSection = ({
  detail,
}: {
  detail: SumsubTxnDetail | null | undefined;
}) => (
  <div>
    {detail ? (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <InfoField label="Score" value={detail.score} mono />
          <InfoField label="Verdict" value={detail.verdict} />
          <InfoField label="Review Status" value={detail.reviewStatus} />
          <InfoField label="Review Answer" value={detail.reviewAnswer} />
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Matched Rules</div>
          {detail.matchedRules.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {detail.matchedRules.map((r, idx) => (
                <li key={r.id ?? idx} className="font-mono text-[11px] text-adm-t1">
                  {r.name ?? '—'} · {r.action ?? '—'} · {r.score ?? '—'}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 font-mono text-[11px] text-adm-t3">—</div>
          )}
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Applicant Action IDs</div>
          <div className="mt-1 font-mono text-[11px] text-adm-t1">
            {detail.applicantActionIds.length > 0 ? detail.applicantActionIds.join(', ') : '—'}
          </div>
        </div>
        <details>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
            Raw payload
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">
            {JSON.stringify(detail.raw, null, 2)}
          </pre>
        </details>
      </div>
    ) : (
      <p className="font-mono text-[11px] text-adm-t3">No Sumsub transaction detail yet</p>
    )}
  </div>
);

/* ── StatusTimeline ─────────────────────────────────────────── */

/**
 * Renders the withdrawal's `statusHistory` JSON column. Defensively reads
 * both the current write shape (`{status, timestamp, operator, note}` — see
 * WithdrawTransactionsService#updateStatus/landOnPendingApproval) and the
 * older field names (`reason`/`operatorId`/`actorType`/`changedAt`), so
 * rows written under either shape render correctly instead of showing blank
 * reason/operator text.
 */
const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) return <div className="text-adm-t3 text-sm italic p-4 text-center">No history available</div>;

  let history: any[] = [];
  try {
    history = JSON.parse(historyJson);
    history.sort((a: any, b: any) =>
      new Date(b.timestamp || b.changedAt).getTime() -
      new Date(a.timestamp || a.changedAt).getTime(),
    );
  } catch {
    return <div className="text-adm-red text-sm p-4">Error parsing history</div>;
  }

  if (history.length === 0) return <div className="text-adm-t3 text-sm italic p-4 text-center">No events</div>;

  return (
    <div className="relative ml-4 space-y-6 border-l-2 border-adm-border my-2">
      {history.map((item: any, idx: number) => (
        <div key={idx} className="ml-8 relative">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className={`h-3 w-3 rounded-full ${getWithdrawStatusMeta(item.status).badgeClass}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getWithdrawStatusMeta(item.status).badgeClass}`}>
                {getWithdrawStatusMeta(item.status).label}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">{item.note || item.reason || 'No reason provided'}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">{item.operator || item.operatorId || item.actorType || 'SYSTEM'}</span>
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

export default WithdrawTransactionDetail;

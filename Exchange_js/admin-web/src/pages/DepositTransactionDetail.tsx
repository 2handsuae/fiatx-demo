// admin-web/src/pages/DepositTransactionDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { AdminBadge } from '../components/ui/AdminBadge';
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
import {
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { getComplianceLayerStyle } from '../utils/depositActionMap';
import L1GateCard from '../components/L1GateCard';
import { getDepositStatusMeta } from '../utils/depositStatusMap';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { useSimulationMode } from '../utils/simulationMode';
import MaterialRequestPanel from '../components/MaterialRequestPanel';

/* ── Types ──────────────────────────────────────────────────── */

/* 10 个单步裁决按钮(取代旧的 8 个多步剧本)。key/label 必须与后端
   src/modules/deposit-sumsub/fixtures/verdict-buttons.ts 的 DEPOSIT_VERDICT_BUTTONS
   逐一对齐 —— 这里没有自动化断言(admin-web 暂无测试基建),改动任一侧务必同步改另一侧,
   否则 operator 会点不出新场景。 */
const DEPOSIT_VERDICT_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'V1_APPROVED', label: '① Approved' },
  { key: 'V2_AWAIT_USER', label: '② Awaiting user' },
  { key: 'V3_AWAIT_USER_PEP', label: '③ Awaiting user · PEP' },
  { key: 'V4_REJECTED_SANCTION_APPLICANT', label: '④ Rejected · Sanctions（客户本人）' },
  { key: 'V4B_REJECTED_SANCTION_COUNTERPARTY', label: '④B Rejected · Sanctions（对手方）' },
  { key: 'V5_REJECTED_FROZEN_MLRO', label: '⑤ Rejected · MLRO freeze' },
  { key: 'V6_REJECTED_RETURN', label: '⑥ Rejected · MLRO return' },
  { key: 'V7_REJECTED_NO_TAG', label: '⑦ Rejected · no disposition tag' },
  { key: 'V8_ONHOLD', label: '⑧ On hold' },
  { key: 'V9_REJECTED_SLA', label: '⑨ Rejected · SLA breach' },
  { key: 'V10_AWAIT_USER_MULTI', label: '⑩ Awaiting user · 多条' },
];

interface LinkedFundOrder {
  kind: 'PAYOUT' | 'INTERNAL_FUND' | 'PAYIN' | 'CONFISCATION';
  no: string;
  id: string;
  status: string;
  amount: string;
  role: 'principal' | 'fee';
}

interface DepositDetail {
  id: string;
  depositNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type?: string | null;
  status: string;
  assetId: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
  toWalletId: string;
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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  payinId: string | null;
  payinNo: string | null;
  payinStatus?: string | null;
  payinType?: string | null;
  traceId?: string | null;
  limitHoldReason?: string | null;
  needsReview?: boolean;
  sumsubTxnId?: string | null;
  sumsubTxnType?: 'finance' | 'travelRule' | null;
  sumsubVerdict?: string | null;
  sumsubScore?: number | null;
  slaDeadline?: string | null;
  slaBreached?: boolean | null;
  sumsubActionId?: string | null;
  actionSubmittedAt?: string | null;
  l1Snapshot?: string | null;
  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  statusHistory: string | null;
  customer?: { complianceStatus?: string | null; sumsubApplicantId?: string | null } | null;
  linkedFundOrders?: LinkedFundOrder[];
  latestSumsubWebhook?: LatestSumsubWebhook | null;
  sumsubDetail?: SumsubTxnDetail | null;
  approvals?: DepositApproval[];
}

/** Matched-rule entry inside a Sumsub getTxn scoring result (see backend
 *  `findOneForAdmin` parseDetail). */
interface SumsubMatchedRule {
  id?: string;
  name?: string;
  action?: string;
  score?: number;
}

/** Admin-readable subset of a Sumsub getTxn report for this deposit's single
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

/** Internal (non-Sumsub) approval case linked to this deposit — single
 *  header only, no step/steps (see backend `findOneForAdmin`). */
interface DepositApproval {
  approvalNo: string;
  actionType: string;
  status: string;
  createdAt: string;
}

/**
 * 该单最近一次收到的 Sumsub webhook(后端 findOneForAdmin 附带)。上面那个
 * txn ID 是提交时定格的静态引用;这个才回答"Sumsub 最近说了什么"。
 */
interface LatestSumsubWebhook {
  eventNo: string;
  eventType: string;
  status: string;
  receivedAt: string | null;
  processedAt: string | null;
  lastErrorMessage: string | null;
  isSimulated: boolean;
}

/** Internal-approval `actionType` → English action label shown in the
 *  Internal Approvals block. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  DEPOSIT_SEIZE: 'Seize',
  DEPOSIT_RETURN: 'Return',
  DEPOSIT_UNFREEZE: 'Unfreeze',
  DEPOSIT_CONFISCATION: 'Confiscate',
};

/* ── Page Component ─────────────────────────────────────────── */

const DepositTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DepositDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [dispositionSubmitting, setDispositionSubmitting] = useState(false);
  const [dispositionError, setDispositionError] = useState('');
  const [isConfiscateModalOpen, setIsConfiscateModalOpen] = useState(false);
  const [confiscateReason, setConfiscateReason] = useState('');
  const [isSeizeModalOpen, setIsSeizeModalOpen] = useState(false);
  const [seizeReason, setSeizeReason] = useState('');
  const [seizeOrderRef, setSeizeOrderRef] = useState('');
  const [isUnfreezeModalOpen, setIsUnfreezeModalOpen] = useState(false);
  const [unfreezeReason, setUnfreezeReason] = useState('');
  const [unfreezeOrderRef, setUnfreezeOrderRef] = useState('');
  const { enabled: simEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState<string | null>(null);
  const [simError, setSimError] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load detail'));
        navigate('/admin/trading/deposits');
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
        `${import.meta.env.VITE_API_URL}/admin/deposit-sumsub/demo/run-verdict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ depositId: id, verdict }),
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
      setNotice(`Verdict ${verdict} fed — deposit refreshed`);
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Verdict run failed.');
    } finally {
      setSimSubmitting(null);
    }
  };

  /* ── Below-min disposition handlers ── */

  const handleWaiveLimit = async () => {
    if (!id) return;
    // 文案跟着挂起原因走：同一个端点在 BELOW_MIN 上解的是金额下限，在 Gate 0 的
    // 行政级挂起上解的是「客户被停用 / 生命周期非 ACTIVE」——写死「below-minimum」
    // 会让运营以为自己只在解除账户暂停。
    const holdReason = data?.limitHoldReason ?? null;
    const holdLabel =
      holdReason === 'BELOW_MIN' ? 'below-minimum hold' : `hold (${holdReason})`;
    if (!window.confirm(`Release the ${holdLabel} and resume compliance processing for this deposit?`)) {
      return;
    }
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/waive-limit`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to release hold.'));
        return;
      }
      setNotice(`Hold released (${holdReason}) — deposit resumed compliance`);
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to release hold.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  const handleConfiscateSubmit = async () => {
    if (!id || !confiscateReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/confiscate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: confiscateReason.trim() }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to submit confiscation.'));
        return;
      }
      const result = await response.json();
      setNotice(`Confiscation submitted for approval — ${result.approvalNo}`);
      setIsConfiscateModalOpen(false);
      setConfiscateReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to submit confiscation.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  /* ── Frozen disposition handlers (seize / unfreeze — maker-checker) ── */

  const handleSeizeSubmit = async () => {
    if (!id || !seizeReason.trim() || !seizeOrderRef.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/seize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: seizeReason.trim(),
            orderRef: seizeOrderRef.trim(),
          }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to submit seize request.'));
        return;
      }
      const result = await response.json();
      setNotice(`Seize submitted for approval — ${result.approvalNo} (pending two-step approval)`);
      setIsSeizeModalOpen(false);
      setSeizeReason('');
      setSeizeOrderRef('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to submit seize request.');
    } finally {
      setDispositionSubmitting(false);
    }
  };

  const handleUnfreezeSubmit = async () => {
    if (!id || !unfreezeReason.trim() || !unfreezeOrderRef.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/unfreeze`,
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

  /* ── SLA (演示用「模拟超时」——不是 ⚡ Simulation 面板那个模拟 Sumsub
      webhook 的东西；见 SidebarGroup title="SLA") ── */

  const handleSimulateSlaTimeout = async () => {
    if (!data) return;
    setSlaSubmitting(true);
    setSlaError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${data.depositNo}/simulate-sla-timeout`,
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

  // B4 修复轮：Gate 0 现在也会把「客户被停用 / 生命周期非 ACTIVE」的单挂到
  // OPERATION_PENDING（挂起原因 CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE）。
  // 处置组此前只认 BELOW_MIN，那些单在界面上无路可走（无 waive 按钮、approve 静默
  // no-op、FROZEN 组也不显示），钱压在 DEPOSIT_SUSPENSE 里。
  // 门控改为「挂起原因非空」；`Confiscate as Fee` 仍**只**在 BELOW_MIN 下出现 ——
  // 没收是小额充值的专属处置，行政级挂起单不该有这个按钮（后端 initiateConfiscation
  // 与没收落地前置也都硬钉 BELOW_MIN）。
  const pendingHoldReason =
    data.status === 'OPERATION_PENDING' ? (data.limitHoldReason ?? null) : null;
  const isHoldPending = pendingHoldReason !== null;
  const isBelowMinPending = pendingHoldReason === 'BELOW_MIN';
  // 合规闸门只在 COMPLIANCE_PENDING 及之后才评估 —— 钱还没到账(PAYIN_PENDING)时
  // L1/L2 一律显示 PENDING(未评估)。此前 L1 直接绑客户级 complianceStatus,那个值
  // 与本单无关且恒为 APPROVED,导致钱还没到闸门就已经是绿的。
  const gatesNotEvaluated = data.status === 'PAYIN_PENDING';
  const eligibilityStyle = getComplianceLayerStyle(
    gatesNotEvaluated ? 'PENDING' : data.customer?.complianceStatus,
  );
  // L2 · Transaction Screen — a deposit now submits a single Sumsub txn
  // (finance or travelRule, decided by the type judge), not two lanes — so
  // there is one verdict, colored the same way the other compliance layers
  // are, but shown verbatim (not translated).
  const l2Style = getComplianceLayerStyle(
    gatesNotEvaluated ? 'PENDING' : data.sumsubVerdict,
  );

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/deposits')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Deposits"
      />

      {/* ── Notice ── */}
      {notice && (
        <div className="shrink-0 border-b border-adm-border bg-adm-green/5 px-6 py-2.5 font-mono text-[11px] text-adm-green">
          {notice}
        </div>
      )}

      {/* ── Confiscation in-transit banner ── */}
      {data.status === 'CONFISCATING' && (
        <div className="shrink-0 border-b border-adm-border bg-adm-amber/5 px-6 py-2.5 font-mono text-[11px] text-adm-amber">
          Confiscation funds order in transit — advance the linked funds order below to settle; the deposit completes automatically once it is confirmed
        </div>
      )}

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-adm-border">

          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">
              {data.depositNo}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">Status</span>
                <span className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getDepositStatusMeta(data.status).badgeClass}`}>
                  {getDepositStatusMeta(data.status).label}
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
              {/* SLA — 没有 deadline（终态 / FROZEN 等不计时的单）整格不显示；
                  slaBreached 优先于时间计算（formatSlaRemaining 内部已处理），
                  软破线后单据状态与 deadline 都不变，只有这个标记能表达已超时。 */}
              {data.slaDeadline && (() => {
                const sla = formatSlaRemaining(data.slaDeadline, data.slaBreached ?? undefined);
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
            <InfoField label="From Address" value={data.fromAddress} copyable onCopy={(v) => handleCopy(v, 'fromAddr')} isCopied={copiedField === 'fromAddr'} mono />
            <InfoField label="To Wallet" value={data.toWalletNo} mono />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
          </DetailCard>

          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${eligibilityStyle.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 · Eligibility</div>
                <div className={`mt-1 text-sm font-bold ${eligibilityStyle.textColor}`}>{eligibilityStyle.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                  {gatesNotEvaluated ? 'Not evaluated until payin lands' : 'Post-arrival check'}
                </div>
              </div>
              {/* L2: Transaction Screen — a deposit now submits exactly one
                  Sumsub txn (finance or travelRule, per `sumsubTxnType`); the
                  label follows the type and the value is the webhook verdict
                  verbatim (approved/rejected/onHold/awaitUser — not
                  translated). */}
              <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${l2Style.borderColor}`}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L2 · Transaction Screen</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[9px] text-adm-t3 w-24">
                    {data.sumsubTxnType === 'travelRule' ? 'Travel Rule:' : 'Finance:'}
                  </span>
                  <span className={`text-[11px] font-semibold ${l2Style.textColor}`}>
                    {gatesNotEvaluated ? '—' : (data.sumsubVerdict ?? '—')}
                  </span>
                  <span className="font-mono text-[10px] text-adm-t3">
                    Score: {gatesNotEvaluated ? '—' : (data.sumsubScore ?? '—')}
                  </span>
                </div>
              </div>
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>

          {/* 4. Sumsub References (read-only) — Applicant ID + the single
              Sumsub txn this deposit submitted. status/receivedAt come from
              `latestSumsubWebhook`, which now only ever reflects this one
              txn (no more per-lane split). */}
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
                value={data.latestSumsubWebhook?.receivedAt ? new Date(data.latestSumsubWebhook.receivedAt).toLocaleString() : null}
              />
              <InfoField label="Applicant Action ID" value={data.sumsubActionId} mono />
              <InfoField
                label="Customer Submitted At"
                value={data.actionSubmittedAt ? new Date(data.actionSubmittedAt).toLocaleString() : null}
              />
            </div>
          </DetailCard>

          {/* 5. Sumsub Transaction Detail — admin-readable subset of the raw
              Sumsub getTxn report for this deposit's single txn
              (findOneForAdmin's parseDetail on the backend). */}
          <DetailCard title="Sumsub Transaction Detail" columns={1}>
            <SumsubDetailSection detail={data.sumsubDetail} />
          </DetailCard>

          {/* 6. Internal Approvals — maker-checker cases raised against this
              deposit (seize/return/unfreeze/confiscate), single header only. */}
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

          {/* 7. Linked Funds Orders — payin (principal in) */}
          <DetailCard title="Linked Funds Orders" columns={1}>
            {data.linkedFundOrders && data.linkedFundOrders.length > 0 ? (
              <div className="flex flex-col gap-2">
                {data.linkedFundOrders.map((o) => (
                  <LinkedRelationCard
                    key={o.no}
                    cap={o.kind === 'CONFISCATION' ? 'Fee · Confiscation' : 'Principal · Payin'}
                    identifier={o.no}
                    statusValue={normalizeRailDisplayStatus(o.status)}
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

          {/* 9. Verification Requests — same component + endpoint as the
              customer detail page's Verification Requests section, `mode="order"`
              scopes it to this deposit's still-live rows (G6). */}
          <DetailCard title="Verification Requests" columns={1}>
            <MaterialRequestPanel mode="order" orderDomain="DEPOSIT" orderRef={data.depositNo} />
          </DetailCard>

          {/* 10. Simulation (demo only — gated by the local simulation-mode
              toggle, independent of the backend SUMSUB_MOCK_MODE flag) */}
          {simEnabled && (
            <DetailCard title="⚡ Simulation" columns={1}>
              <p className="font-mono text-[11px] text-adm-t3">
                Feeds ONE Sumsub KYT verdict webhook into the real ingestion
                pipeline. The report is generated to match this deposit's actual
                Sumsub txn type. Requires SUMSUB_MOCK_MODE on the backend.
              </p>
              <p className="font-mono text-[11px] text-adm-amber">
                Verdicts are atomic — chain them freely (e.g. ② then ①, or ⑦ then ⑤).
              </p>
              <p className="font-mono text-[11px] text-adm-t3">
                ⑨ only posts a rejected verdict tagged SLA_BREACH — it does not
                drive the real SLA timer (DepositSlaService); same code path as ⑦.
              </p>
              {simError && <p className="text-[11px] text-adm-red">{simError}</p>}
              <div className="flex flex-wrap gap-2">
                {DEPOSIT_VERDICT_BUTTONS.map((s) => (
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

          {/* Ops Disposition */}
          {isHoldPending && (
            <SidebarGroup title="Ops Disposition">
              {dispositionError && <p className="mb-2 text-[11px] text-adm-red">{dispositionError}</p>}
              {/* 运营必须先知道自己在解除**哪一条**挂起 —— 同一个按钮在
                  BELOW_MIN 上是「豁免金额下限」、在行政级上是「解除账户挂起」。 */}
              <p className="mb-2 font-mono text-[10px] text-adm-t3">
                Hold reason:{' '}
                <span className="font-semibold text-adm-amber">{pendingHoldReason}</span>
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleWaiveLimit}
                  disabled={dispositionSubmitting}
                  className={adminButtonClass('workflowPrimary', 'w-full')}
                >
                  {dispositionSubmitting
                    ? 'Processing...'
                    : isBelowMinPending
                      ? 'PASS (Waive Min-Limit)'
                      : 'Release Hold'}
                </button>
                {isBelowMinPending && (
                  <button
                    onClick={() => {
                      setDispositionError('');
                      setConfiscateReason('');
                      setIsConfiscateModalOpen(true);
                    }}
                    disabled={dispositionSubmitting}
                    className={adminButtonClass('workflowNegative', 'w-full')}
                  >
                    Confiscate as Fee
                  </button>
                )}
              </div>
            </SidebarGroup>
          )}

          {/* Frozen Disposition — initiate seize / unfreeze (both maker-checker
              approvals, not immediate execution): seize opens a two-step
              SENIOR_MANAGEMENT_OFFICER → MLRO approval; unfreeze opens a
              single-step MLRO approval. FROZEN can only leave via this
              maker-checker unfreeze/seize flow (see the transition table in
              deposit-transactions.service.ts). */}
          {data.status === 'FROZEN' && (
            <SidebarGroup title="Frozen Disposition">
              {dispositionError && <p className="mb-2 text-[11px] text-adm-red">{dispositionError}</p>}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setDispositionError('');
                    setSeizeReason('');
                    setSeizeOrderRef('');
                    setIsSeizeModalOpen(true);
                  }}
                  disabled={dispositionSubmitting}
                  className={adminButtonClass('workflowNegative')}
                >
                  Initiate Seize
                </button>
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
              </div>
            </SidebarGroup>
          )}

          {/* Manual checking — no action buttons; disposition happens in
              Sumsub, not here (see 2026-07-29 deposit-frontend spec §2.2). */}
          {data.status === 'MANUAL_CHECKING' && (
            <p className="mb-4 font-mono text-[11px] text-adm-t3">
              Disposition happens in the Sumsub console (officer tags the txn, then re-rejects).
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
            <SidebarKV label="Deposit No" value={data.depositNo} mono />
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
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV label="Trace ID" value={data.traceId ?? null} mono />
            <SidebarKV
              label="Needs Review"
              value={data.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : 'No'}
            />
          </SidebarGroup>
        </div>
      </div>

      {/* ── Confiscate Modal ── */}
      {isConfiscateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Confiscate as Fee</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-border bg-adm-card px-3 py-2.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-adm-t3">Amount</span>
                  <span className="font-mono font-semibold text-adm-t1">
                    {formatAssetAmount(data.amount, data.asset.decimals)} {data.asset.code}
                  </span>
                </div>
                <div className="mt-2 font-mono text-[10px] text-adm-t3">
                  Per T&C: below-minimum deposit handling fee
                </div>
              </div>
              {dispositionError && <p className="text-[11px] text-adm-red">{dispositionError}</p>}
              <textarea
                className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                rows={3}
                placeholder="Enter reason for confiscation (required)..."
                value={confiscateReason}
                onChange={(e) => setConfiscateReason(e.target.value)}
              />
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsConfiscateModalOpen(false);
                  setConfiscateReason('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleConfiscateSubmit}
                disabled={dispositionSubmitting || !confiscateReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Seize Modal ── */}
      {isSeizeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Initiate Seize</p>
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
                  placeholder="Enter reason for seizing this deposit (required)..."
                  value={seizeReason}
                  onChange={(e) => setSeizeReason(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Government order reference
                </label>
                <input
                  type="text"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                  placeholder="e.g. court or enforcement order number"
                  value={seizeOrderRef}
                  onChange={(e) => setSeizeOrderRef(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsSeizeModalOpen(false);
                  setSeizeReason('');
                  setSeizeOrderRef('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleSeizeSubmit}
                disabled={dispositionSubmitting || !seizeReason.trim() || !seizeOrderRef.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  placeholder="Enter reason for unfreezing this deposit (required)..."
                  value={unfreezeReason}
                  onChange={(e) => setUnfreezeReason(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Unfreeze order reference
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
    </div>
  );
};

/* ── SumsubDetailSection ─────────────────────────────────────── */

/**
 * Renders the parsed Sumsub getTxn report for this deposit's single Sumsub
 * txn — the raw payload behind `detail.raw` is that txn's report verbatim.
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

/* ── StatusTimeline (preserved from existing) ── */

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
            <div className={`h-3 w-3 rounded-full ${getDepositStatusMeta(item.status).badgeClass}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getDepositStatusMeta(item.status).badgeClass}`}>
                {getDepositStatusMeta(item.status).label}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">{item.reason || 'No reason provided'}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">{item.operatorId || item.actorType || 'SYSTEM'}</span>
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

export default DepositTransactionDetail;

// admin-web/src/pages/DepositTransactionDetail.tsx
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
import {
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { getComplianceLayerStyle } from '../utils/depositActionMap';
import L1GateCard from '../components/L1GateCard';
import { GateTile } from '../components/compliance/GateTile';
import { SumsubDetailSection } from '../components/compliance/SumsubDetailSection';
import { StatusTimeline } from '../components/compliance/StatusTimeline';
import { NeedsReviewBanner } from '../components/compliance/NeedsReviewBanner';
import { getDepositStatusMeta } from '../utils/depositStatusMap';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { useSimulationMode } from '../utils/simulationMode';
import { SimulationPanel } from '../components/SimulationPanel';
import MaterialRequestPanel from '../components/MaterialRequestPanel';

/* ── Types ──────────────────────────────────────────────────── */

/* 硬抄件（admin-web 有独立 tsconfig，后端那份是 private static，import 不过来）。
   同步源：src/modules/trading/deposit-transactions/deposit-workflow.service.ts
   的 DepositWorkflowService.KYT_VERDICT_IGNORED_STATUSES —— 5 个终态 + 3 个在途
   处置态。改了后端务必同步改这里，否则按钮置灰与后端实际 no-op 脱节。
   ⚠️ FROZEN **刻意不在这个数组里**：后端那个集合的语义是「终态 + 在途处置态」，
   FROZEN 属于另一族，加进去会影响别处对该集合的读取。后端是在 decideVerdictLanding
   里单独一行 `if (status === FROZEN) return 'IGNORE'`，这里也照样单独一支。 */
const DEPOSIT_KYT_VERDICT_IGNORED_STATUSES = new Set([
  // 终态
  'SUCCESS',
  'FAILED',
  'CONFISCATED',
  'RETURNED',
  'SEIZED',
  // 平账 B 批②：入账后被银行/托管方退汇，零出边终态——同其余终态一样
  // 收编进后端 KYT_VERDICT_IGNORED_STATUSES（deposit-workflow.service.ts）。
  'CLAWED_BACK',
  // 在途处置态
  'CONFISCATING',
  'RETURNING',
  'SEIZING',
]);

/** 该状态下投递的裁决会被后端 no-op（只落审计，不改状态）。 */
const isDepositVerdictIgnored = (status: string): boolean =>
  DEPOSIT_KYT_VERDICT_IGNORED_STATUSES.has(status) || status === 'FROZEN';

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
  l1Snapshot?: string | null;
  /** 平账 B 批 Task 10：补录才有值（案子业务归属日）。 */
  effectiveDate?: string | null;
  supplementOrigin?: {
    signalNo: string;
    reconCaseNo: string | null;
    externalRef: string | null;
    effectiveDate: string | null;
  } | null;
  clawbackOrigin?: {
    reconCaseNo: string | null;
    externalRef: string | null;
    dispositionNo: string | null;
  } | null;
  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  statusHistory: string | null;
  /** `lifecycle` = 客户关系生命周期七态（PROSPECT/IN_VERIFICATION/…/ACTIVE/…/OFFBOARDED）。 */
  customer?: { lifecycle?: string | null; sumsubApplicantId?: string | null } | null;
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
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [isSeizeModalOpen, setIsSeizeModalOpen] = useState(false);
  const [seizeReason, setSeizeReason] = useState('');
  const [seizeOrderRef, setSeizeOrderRef] = useState('');
  const [isUnfreezeModalOpen, setIsUnfreezeModalOpen] = useState(false);
  const [unfreezeReason, setUnfreezeReason] = useState('');
  const [unfreezeOrderRef, setUnfreezeOrderRef] = useState('');
  const { enabled: simEnabled } = useSimulationMode();
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

  /* ── Below-min disposition handlers ── */

  const handleWaiveLimit = async () => {
    if (!id) return;
    // 文案跟着挂起原因走：同一个端点在 BELOW_MIN 上解的是金额下限，在 L1 的
    // 行政级挂起上解的是「客户被停用 / 生命周期非 ACTIVE」——写死「below-minimum」
    // 会让运营以为自己只在解除账户暂停。
    const holdReason = data?.limitHoldReason ?? null;
    const isBelowMin = holdReason === 'BELOW_MIN';
    const holdLabel = isBelowMin ? 'below-minimum hold' : `hold (${holdReason})`;
    // 波二：L1 行政级挂起现在与 BELOW_MIN 同一形状——先合规后挂起，走到这里合规
    // 已经通过（I1 修复轮那版「从未送检、放行即无裁决」的说法已被本波「打标不
    // 换状态、照常送检」纠正，两条分支的结果文案合一）。
    const outcomeLine = isBelowMin
      ? 'Compliance already cleared this deposit, so releasing the hold lets it finish and credit the customer.'
      : `Compliance (L2) already cleared this deposit; it was held by L1 (${holdReason}). Releasing the hold lets it finish and credit the customer.`;
    if (!window.confirm(`Release the ${holdLabel}?\n\n${outcomeLine}`)) {
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
      setNotice(
        isBelowMin
          ? `Hold released (${holdReason}) — deposit resumed compliance`
          : `Hold released (${holdReason}) — compliance (L2) already cleared this deposit, so it resumes and will be credited`,
      );
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

  // 第四批 C1：OPERATION_PENDING 的第四条出路 —— 原路退回汇款人。与没收/没入同形状,
  // 打的是「开审批案」的端点,返回 approvalNo,钱不会立刻退。
  const handleReturnSubmit = async () => {
    if (!id || !returnReason.trim()) return;
    setDispositionSubmitting(true);
    setDispositionError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/return`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: returnReason.trim() }),
        },
      );
      if (!response.ok) {
        setDispositionError(await getApiErrorMessage(response, 'Failed to submit return request.'));
        return;
      }
      const result = await response.json();
      setNotice(
        `Return submitted for approval — ${result.approvalNo} (funds stay on hold until MLRO approves)`,
      );
      setIsReturnModalOpen(false);
      setReturnReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setDispositionError(error instanceof Error ? error.message : 'Failed to submit return request.');
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

  // L1 行政级挂起（CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE / ASSET_SUSPENDED）
  // 与 BELOW_MIN 同一形状：先合规后挂起，OPERATION_PENDING 时合规已过。
  // 门控改为「挂起原因非空」；`Confiscate as Fee` 仍**只**在 BELOW_MIN 下出现 ——
  // 没收是小额充值的专属处置，行政级挂起单不该有这个按钮（后端 initiateConfiscation
  // 与没收落地前置也都硬钉 BELOW_MIN）。
  const pendingHoldReason =
    data.status === 'OPERATION_PENDING' ? (data.limitHoldReason ?? null) : null;
  const isHoldPending = pendingHoldReason !== null;
  // C1 修复轮(Important C)：`Release Hold` clearing the hold reason (e.g. an L1
  // auto-approval no-op) used to make the whole Ops Disposition group — including the
  // Return-to-Sender button — disappear, with no way back in. Return doesn't depend on
  // a hold reason existing, so the group itself gates on OPERATION_PENDING alone; the
  // Release Hold button still gates on isHoldPending below.
  const isOperationPending = data.status === 'OPERATION_PENDING';
  const isBelowMinPending = pendingHoldReason === 'BELOW_MIN';
  // 合规闸门只在 COMPLIANCE_PENDING 及之后才评估 —— 钱还没到账(PAYIN_PENDING)时
  // L1/L2 一律显示 PENDING(未评估)。
  // 第四批修复轮：钱到账之后这一格此前读 `customer.complianceStatus` —— 那一列与
  // `restrictions` 是同一次 migration（20260816063807_customer_lifecycle_restrictions）
  // 一起 drop 的,早已不存在,恒 undefined → 恒显示灰色 `N/A`（上面那句旧注释说它
  // 「恒为 APPROVED」同样是错的）。改读 `lifecycle`：它正是 L1GateService 的
  // CUSTOMER_ELIGIBILITY 判的东西（`access.lifecycle === 'ACTIVE'`）,口径天然一致。
  const gatesNotEvaluated = data.status === 'PAYIN_PENDING';
  const eligibilityStyle = getComplianceLayerStyle(
    gatesNotEvaluated ? 'PENDING' : data.customer?.lifecycle,
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

      <NeedsReviewBanner
        show={!!data.needsReview}
        message="Needs review — a disposition leg exhausted its retries; the order is parked and needs manual intervention"
      />

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
                    onClick={() => navigate(`/admin/customers/${data.ownerNo}`)}
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
            <InfoField label="Tx Hash" value={data.txHash} copyable onCopy={(v) => handleCopy(v, 'txHash')} isCopied={copiedField === 'txHash'} mono link={data.txHash ? explorerTxUrl(data.asset.network, data.txHash) : undefined} />
            <InfoField label="Confirmations" value={data.confirmations ?? null} />
            <InfoField label="From Address" value={data.fromAddress} copyable onCopy={(v) => handleCopy(v, 'fromAddr')} isCopied={copiedField === 'fromAddr'} mono />
            <InfoField label="To Wallet" value={data.toWalletNo} mono />
            <InfoField label="To Address" value={data.toAddress} copyable onCopy={(v) => handleCopy(v, 'toAddr')} isCopied={copiedField === 'toAddr'} mono />
            <InfoField label="Reference No" value={data.referenceNo} mono />
            {data.effectiveDate && <InfoField label="Effective Date" value={data.effectiveDate} mono />}
            {data.supplementOrigin && <InfoField label="Supplement Origin" value={`case ${data.supplementOrigin.reconCaseNo} · statement line ${data.supplementOrigin.externalRef} · signal ${data.supplementOrigin.signalNo}`} mono />}
            {data.clawbackOrigin && <InfoField label="Clawback Origin" value={`case ${data.clawbackOrigin.reconCaseNo} · statement line ${data.clawbackOrigin.externalRef}`} mono />}
          </DetailCard>

          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard — 读客户生命周期。充值独有：钱没到账
                  (PAYIN_PENDING) 时闸门根本没跑，主值恒 PENDING、副行改说明原因。 */}
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption={gatesNotEvaluated ? 'Not evaluated until payin lands' : 'Post-arrival check'}
                style={eligibilityStyle}
              />
              {/* L2: Transaction Screen — 充值只送一笔 Sumsub txn（finance 或
                  travelRule，按 `sumsubTxnType`）；前缀跟着类型走，verdict 是 webhook
                  原值（approved/rejected/onHold/awaitUser，不翻译）。 */}
              <GateTile
                title="L2 · Transaction Screen"
                value={`${data.sumsubTxnType === 'travelRule' ? 'Travel Rule' : 'Finance'}: ${
                  gatesNotEvaluated ? '—' : (data.sumsubVerdict ?? '—')
                }`}
                caption={`Score ${gatesNotEvaluated ? '—' : (data.sumsubScore ?? '—')}`}
                style={l2Style}
              />
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
            <StatusTimeline historyJson={data.statusHistory} getStatusMeta={getDepositStatusMeta} />
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
            <SimulationPanel
              domain="deposit"
              orderId={data.id}
              disabled={isDepositVerdictIgnored(data.status)}
              onDone={() => void fetchData()}
            />
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">

          {/* Ops Disposition */}
          {isOperationPending && (
            <SidebarGroup title="Ops Disposition">
              {dispositionError && <p className="mb-2 text-[11px] text-adm-red">{dispositionError}</p>}
              {/* 运营必须先知道自己在解除**哪一条**挂起 —— 同一个按钮在
                  BELOW_MIN 上是「豁免金额下限」、在行政级上是「解除账户挂起」。
                  挂起原因可能已被清空(例如 Release Hold 点过之后)——此时只剩
                  Return 出路,Hold reason 一行与 Release Hold 按钮一起隐藏。 */}
              {isHoldPending && (
                <p className="mb-2 font-mono text-[10px] text-adm-t3">
                  Hold reason:{' '}
                  <span className="font-semibold text-adm-amber">{pendingHoldReason}</span>
                </p>
              )}
              <div className="flex flex-col gap-2">
                {isHoldPending && (
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
                )}
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
                {/* 第四批 C1：挂起单的第四条出路。此前 OPERATION_PENDING 只能放行(不该
                    放行)、上缴(小额专属)、冻结(执法级) —— 行政级挂起(客户账户已暂停)
                    的单无路可走。退回是 MLRO maker-checker 审批案,不是直推:点下去开的
                    是审批,钱不会立刻退。 */}
                <button
                  onClick={() => {
                    setDispositionError('');
                    setReturnReason('');
                    setIsReturnModalOpen(true);
                  }}
                  disabled={dispositionSubmitting}
                  className={adminButtonClass('workflowSecondary', 'w-full')}
                >
                  Initiate Return to Sender
                </button>
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
                    onClick={() => navigate(`/admin/customers/${data.ownerNo}`)}
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

      {/* ── Return to Sender Modal (C1) ── */}
      {isReturnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">Initiate Return to Sender</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {dispositionError && <p className="text-[11px] text-adm-red">{dispositionError}</p>}
              {/* 运营最容易误解的一点:以为点完钱就退了。说清楚这一步只是开审批。 */}
              <p className="rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] leading-relaxed text-adm-amber">
                This opens an MLRO approval request — it does NOT move any money yet. The
                deposit stays on hold; the funds are only sent back to the original sender
                after the approval is granted.
              </p>
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Reason
                </label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none"
                  rows={3}
                  placeholder="Why should these funds go back to the sender? (required)"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                />
              </div>
            </div>
            <div className="border-t border-adm-border bg-adm-card px-5 py-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsReturnModalOpen(false);
                  setReturnReason('');
                  setDispositionError('');
                }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={handleReturnSubmit}
                disabled={dispositionSubmitting || !returnReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {dispositionSubmitting ? 'Processing...' : 'Submit for Approval'}
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

export default DepositTransactionDetail;

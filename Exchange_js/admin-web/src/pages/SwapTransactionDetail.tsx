import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw, User } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { useSimulationMode } from '../utils/simulationMode';
import { getComplianceLayerStyle } from '../utils/depositActionMap';

/* ── Types ──────────────────────────────────────────────────── */

/* 8 个单步裁决按钮,与充值/提现版镜像(deliberate fork)。key/label 必须与后端
   src/modules/swap-sumsub/fixtures/verdict-buttons.ts 的 SWAP_VERDICT_BUTTONS
   逐一对齐——这里没有自动化断言(admin-web 暂无测试基建),改动任一侧务必同步
   改另一侧,否则 operator 会点不出新场景。 */
const SWAP_VERDICT_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'V1_APPROVED', label: '① Approved' },
  { key: 'V2_REJECTED_HARD', label: '② Rejected · 硬线（无 action）' },
  { key: 'V3_REJECTED_ACTION', label: '③ Rejected · 软线（下发认证）' },
  { key: 'V4_REJECTED_SANCTION', label: '④ Rejected · Sanctions' },
  { key: 'V5_ONHOLD', label: '⑤ On hold（我方等同拒绝）' },
  { key: 'V6_AWAIT_USER', label: '⑥ Awaiting user（我方等同拒绝）' },
  { key: 'V7_ACTION_GREEN', label: '⑦ 认证通过（清限制）' },
  { key: 'V8_ACTION_RED', label: '⑧ 认证不通过（升级）' },
];

/** Matched-rule entry inside the Sumsub compliance detail. */
interface SwapSumsubDetail {
  txnIdOut: string | null;
  txnIdIn: string | null;
  verdict: string | null;
  scoringAction: string | null;
  matchedRules: string[];
  rejectReason: string | null;
  /** 规则命中时下发给客户的补料 action（软线拒绝才有）。 */
  applicantActions?: Array<{ applicantActionId?: string; externalActionId?: string }>;
  raw: unknown;
}

interface SwapAsset {
  currency: string;
  code: string;
  type: string;
  network: string | null;
  decimals: number;
}

interface InternalFundLeg {
  id: string;
  fundsOrderNo: string;
  legSeq: number | null;
  attempt: number | null;
  status: string;
  amount: string;
  asset?: { currency: string; decimals: number } | null;
  fromWallet?: { walletRole: string } | null;
  toWallet?: { walletRole: string } | null;
}

interface SwapTransactionDetailData {
  id: string;
  swapNo: string;
  quoteId: string | null;
  quoteNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  currentStage: string | null;
  needsReview: boolean;
  fromAssetId: string;
  fromAssetCode: string | null;
  fromAmount: string;
  fromAsset: SwapAsset;
  toAssetId: string;
  toAssetCode: string | null;
  toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null;
  feeCurrency: string | null;
  feeBreakdown: string | null;
  spreadAmount: string | null;
  toAsset: SwapAsset;
  exchangeRate: string;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
    complianceStatus?: string | null;
    sumsubApplicantId?: string | null;
    // 拒绝处置在客户身上留下的三个状态位（Task 7/13）——本页侧栏只读展示，
    // 处置动作本身全在 Sumsub 控制台（officer）与 webhook 链路完成，无按钮。
    restrictions?: string | null;
    pendingActionExternalId?: string | null;
    hardLineDispositionedAt?: string | null;
  } | null;
  statusHistory: string | null;
  internalFunds?: InternalFundLeg[];
  sumsubDetail?: SwapSumsubDetail | null;
}

interface SwapFx {
  baseRate?: string;
  quotedRate?: string;
  markupBps?: number;
  effectiveBaseRate?: string;
}

const parseFx = (feeBreakdown: string | null): SwapFx | null => {
  if (!feeBreakdown) return null;
  try {
    const parsed = JSON.parse(feeBreakdown);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first && first.fx ? (first.fx as SwapFx) : null;
  } catch {
    return null;
  }
};

/* ── Leg model ──────────────────────────────────────────────── */

const LEG_STAGE: Record<number, string> = {
  1: 'SELL',
  2: 'SETTLE',
  3: 'BUY',
  4: 'FEE',
};

/* ── Page Component ─────────────────────────────────────────── */

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [legBusy, setLegBusy] = useState<number | null>(null);
  const { enabled: simEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState<string | null>(null);
  const [simError, setSimError] = useState('');
  // 喂裁决成功后的顶部回显条（对齐充值/提现详情页的 notice 形态）。
  const [notice, setNotice] = useState('');

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}`,
      );
      if (response.ok) {
        setData(await response.json());
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load swap detail'));
        navigate('/admin/trading/swaps');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch swap detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void fetchData();
  }, [id]);

  const resumeLeg = async (swapNo: string, legSeq: number) => {
    setLegBusy(legSeq);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${swapNo}/legs/${legSeq}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, `Failed to resume leg ${legSeq}`));
        return;
      }
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to resume leg', error);
      alert('Failed to resume leg');
    } finally {
      setLegBusy(null);
    }
  };

  /* ── Demo verdict handler (SUMSUB_MOCK_MODE-gated backend endpoint) ── */

  const handleRunVerdict = async (verdict: string) => {
    if (!id) return;
    setSimSubmitting(verdict);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-sumsub/demo/run-verdict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ swapId: id, verdict }),
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
      setNotice(`Verdict ${verdict} fed — swap refreshed`);
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Verdict run failed.');
    } finally {
      setSimSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading swap detail...</p>
      </div>
    );
  }

  if (!data) return null;

  const fx = parseFx(data.feeBreakdown);
  const toDecimals = data.toAsset.decimals;
  const fromDecimals = data.fromAsset.decimals;
  const ownerNo = data.ownerNo || data.customer?.customerNo || null;
  const pair = `${data.fromAsset.code} → ${data.toAsset.code}`;
  const netDisplay = `${formatAssetAmount(data.netToAmount ?? data.toAmount, toDecimals)} ${data.toAsset.currency}`;
  const feeDisplay = `${formatAssetAmount(data.feeAmount ?? '0', toDecimals)} ${data.feeCurrency || data.toAsset.currency}`;

  const ownerLink = ownerNo ? (
    <button
      onClick={() => navigate(`/customers/${data.ownerId}`)}
      className="text-adm-blue hover:underline"
    >
      {ownerNo}
    </button>
  ) : null;

  // ── Compliance 双层样式（对齐提现详情页）──
  // L1 读客户三轴里的 complianceStatus（真实值，不再写死 PASSED）；
  // L2 读本单 KYT 终裁 verdict（approved/rejected/null=还没等到）。
  const eligibilityStyle = getComplianceLayerStyle(data.customer?.complianceStatus);
  // 未裁决时传 'PENDING' 拿琥珀色（而非无值的灰色）——未决恰是 operator 最该注意的态。
  const l2Style = getComplianceLayerStyle(data.sumsubDetail?.verdict || 'PENDING');

  // ── 客户处置状态（侧栏只读；无任何按钮）──
  // 拒绝处置写在人身上：restrictions / pendingAction / 硬线标记。
  const restrictionCaps: string[] = (() => {
    try {
      const parsed = JSON.parse(data.customer?.restrictions || '[]');
      return Array.isArray(parsed)
        ? parsed.map((r: { capability?: string }) => r.capability || '').filter(Boolean)
        : [];
    } catch {
      return [];
    }
  })();
  const isTerminal = data.status === 'SUCCESS' || data.status === 'REJECTED';

  /* Group internalFunds by legSeq, then sort attempts ascending. */
  const legGroups: Array<{ legSeq: number; attempts: InternalFundLeg[] }> = (() => {
    const map = new Map<number, InternalFundLeg[]>();
    for (const f of data.internalFunds ?? []) {
      const seq = f.legSeq ?? 0;
      if (!map.has(seq)) map.set(seq, []);
      map.get(seq)!.push(f);
    }
    const groups = Array.from(map.entries())
      .map(([legSeq, attempts]) => ({
        legSeq,
        attempts: [...attempts].sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0)),
      }))
      .sort((a, b) => a.legSeq - b.legSeq);
    return groups;
  })();

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/trading/swaps')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Swaps"
      />

      {/* ── Notice banner（喂裁决成功后的回显，对齐充值/提现）── */}
      {notice && (
        <div className="border-b border-adm-border bg-adm-green/10 px-6 py-2 font-mono text-[11px] text-adm-green">
          {notice}
        </div>
      )}

      {/* ── Needs-review banner（从 Hero 徽标提为顶部横幅，对齐提现）——
          成交后迟到的 KYT 拒绝裁决只标记不动单（SWAP_POST_APPROVAL_VERDICT），
          这里给 operator 一句人话说明。── */}
      {data.needsReview && (
        <div className="flex items-center gap-2 border-b border-adm-border bg-adm-red/10 px-6 py-2 font-mono text-[11px] text-adm-red">
          <AlertTriangle size={12} />
          Needs review — a KYT verdict arrived after approval/execution; no automatic action was
          taken on this order.
        </div>
      )}

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-mono text-[19px] font-bold text-adm-amber">{data.swapNo}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={data.status} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Current Stage
                </span>
                <span className="font-mono text-adm-t1">{data.currentStage ?? '—'}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Pair
                </span>
                <span className="font-mono text-adm-t1">{pair}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Net Received
                </span>
                <span className="font-semibold text-adm-t1">{netDisplay}</span>
              </div>
              {ownerNo && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Owner
                  </span>
                  {ownerLink}
                </div>
              )}
            </div>
          </div>

          {/* 2. Conversion */}
          <DetailCard title="Conversion" columns={2}>
            <InfoField
              label="Sell Asset"
              value={`${data.fromAssetCode || data.fromAsset.code} · ${data.fromAsset.type}`}
              accent
            />
            <InfoField
              label="Buy Asset"
              value={`${data.toAssetCode || data.toAsset.code} · ${data.toAsset.type}`}
              accent
            />
            <InfoField
              label="Sell Amount"
              value={`${formatAssetAmount(data.fromAmount, fromDecimals)} ${data.fromAsset.currency}`}
              highlight
            />
            <InfoField label="Net Received" value={netDisplay} highlight />
            <InfoField
              label="Gross Out"
              value={`${formatAssetAmount(data.toAmount, toDecimals)} ${data.toAsset.currency}`}
            />
            <InfoField label="Fee" value={feeDisplay} />
          </DetailCard>

          {/* 4. Pricing */}
          <DetailCard title="Pricing" columns={2}>
            {fx?.baseRate ? (
              <InfoField label="Market Rate" value={formatRate8(fx.baseRate)} mono />
            ) : null}
            <InfoField label="Quoted All-in Rate" value={formatRate8(data.exchangeRate)} highlight />
            {fx?.markupBps !== undefined ? (
              <InfoField label="Spread (bps)" value={String(fx.markupBps)} mono />
            ) : null}
            <InfoField
              label="Spread (amount)"
              value={
                data.spreadAmount
                  ? `${formatAssetAmount(data.spreadAmount, toDecimals)} ${data.toAsset.currency}`
                  : '—'
              }
              mono
            />
            <InfoField label="Fee" value={feeDisplay} />
            <InfoField label="Net Out" value={netDisplay} highlight />
          </DetailCard>

          {/* 4. Compliance — L1 真实资格 + L2 KYT 单闸（对齐充值/提现的双层卡）。
              L1 不再写死 PASSED：读客户 complianceStatus；L2 读本单 KYT 终裁。
              兑换无 TR/大额门——L2 只有 KYT 一道，这是设计而非缺失（无对手方）。 */}
          <div className="px-6 py-5">
            <h3 className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
              Compliance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div
                className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${eligibilityStyle.borderColor}`}
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  L1 · Eligibility
                </div>
                <div className={`mt-1 text-sm font-bold ${eligibilityStyle.textColor}`}>
                  {eligibilityStyle.label}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">Pre-execution gate</div>
              </div>
              <div
                className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${l2Style.borderColor}`}
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  L2 · Transaction Screen
                </div>
                <div className={`mt-1 text-sm font-bold ${l2Style.textColor}`}>
                  {data.sumsubDetail?.verdict ? `KYT: ${data.sumsubDetail.verdict}` : 'PENDING'}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                  {data.sumsubDetail?.scoringAction
                    ? `Scoring action: ${data.sumsubDetail.scoringAction}`
                    : 'Awaiting Sumsub verdict'}
                </div>
              </div>
            </div>
          </div>

          {/* 5. Sumsub References — 身份/关联键（对齐充值/提现同名卡）。 */}
          <DetailCard title="Sumsub References" columns={2}>
            <InfoField
              label="Applicant ID"
              value={data.customer?.sumsubApplicantId}
              mono
            />
            <InfoField label="Txn ID Out (sell leg)" value={data.sumsubDetail?.txnIdOut} mono />
            <InfoField label="Txn ID In (buy leg)" value={data.sumsubDetail?.txnIdIn} mono />
            <InfoField label="Pending Action ID" value={data.customer?.pendingActionExternalId} mono />
          </DetailCard>

          {/* 6. Sumsub Detail — 裁决分析（verdict/规则/原始报文）。 */}
          <DetailCard title="Sumsub Detail" columns={1}>
            <SumsubDetailSection detail={data.sumsubDetail} />
          </DetailCard>

          {/* 7. Internal Approvals — 兑换没有任何审批流（无大额门，2026-06 评估：
              资金不出境）。显式渲染空态而非整块砍掉：告诉后来人"这里确实没有
              审批"，防止被当成缺失（与三闸门 spec「兑换无 L2 要显式标注」同理）。 */}
          <DetailCard title="Internal Approvals" columns={1}>
            <div className="rounded border border-dashed border-adm-border bg-adm-bg px-4 py-3 font-mono text-[11px] text-adm-t3">
              No internal approvals — swap has no approval workflow (no large-amount gate; funds
              never leave the platform).
            </div>
          </DetailCard>

          {/* 8. Legs (per-legSeq attempt history) */}
          <DetailCard title="Settlement Legs" columns={1}>
            {legGroups.length === 0 ? (
              <div className="rounded border border-dashed border-adm-border bg-adm-bg px-4 py-3 font-mono text-[11px] text-adm-t3">
                No legs created yet.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {legGroups.map(({ legSeq, attempts }) => {
                  const stage = LEG_STAGE[legSeq] ?? `LEG${legSeq}`;
                  const latestIdx = attempts.length - 1;
                  return (
                    <div
                      key={legSeq}
                      className="rounded border border-adm-border bg-adm-bg"
                    >
                      <div className="flex items-center justify-between border-b border-adm-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                            Leg {legSeq}
                          </span>
                          <span className="font-mono text-[12px] font-semibold text-adm-t1">
                            {stage}
                          </span>
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                          {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex flex-col divide-y divide-adm-border">
                        {attempts.map((row, idx) => {
                          const isLatest = idx === latestIdx;
                          const amountLabel = row.asset
                            ? `${formatAssetAmount(row.amount, row.asset.decimals)} ${row.asset.currency}`
                            : row.amount;
                          const routeLabel =
                            row.fromWallet?.walletRole && row.toWallet?.walletRole
                              ? `${row.fromWallet.walletRole} → ${row.toWallet.walletRole}`
                              : null;
                          return (
                            <LegAttemptRow
                              key={row.id}
                              swapNo={data.swapNo}
                              legSeq={legSeq}
                              row={row}
                              amountLabel={amountLabel}
                              routeLabel={routeLabel}
                              isLatest={isLatest}
                              busy={legBusy === legSeq}
                              onNavigate={() =>
                                navigate(`/admin/funds-orders/${row.fundsOrderNo}`)
                              }
                              onResume={resumeLeg}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DetailCard>

          {/* 6. Status History */}
          <DetailCard title="Status History" columns={1}>
            <StatusTimeline historyJson={data.statusHistory} />
          </DetailCard>

          {/* 7. Technical */}
          <DetailCard title="Technical" columns={2}>
            <InfoField label="Quote No" value={data.quoteNo} mono />
            <InfoField label="Quote ID" value={data.quoteId} mono />
            <InfoField label="Trace ID" value={data.traceId} mono />
            <InfoField label="From Asset ID" value={data.fromAssetId} mono />
            <InfoField label="To Asset ID" value={data.toAssetId} mono />
          </DetailCard>

          {/* 11. Simulation (demo only — gated by the local simulation-mode
              toggle AND by status: a swap only accepts a verdict while sitting
              in COMPLIANCE_PENDING — once it has moved to PROCESSING/SUCCESS/
              REJECTED, SwapWorkflowService#applyKytVerdict no-ops on it, so
              showing the panel there would mislead the operator. ) */}
          {simEnabled && data.status === 'COMPLIANCE_PENDING' && (
            <DetailCard title="⚡ Simulation" columns={1}>
              <p className="font-mono text-[11px] text-adm-t3">
                Feeds ONE Sumsub verdict webhook into the real ingestion
                pipeline for this swap's sell-leg KYT transaction. Requires
                SUMSUB_MOCK_MODE on the backend.
              </p>
              <p className="font-mono text-[11px] text-adm-amber">
                ⑦/⑧ act on the customer (applicantActionReviewed), not on this
                order — this swap's own status will not change.
              </p>
              {simError && <p className="text-[11px] text-adm-red">{simError}</p>}
              <div className="flex flex-wrap gap-2">
                {SWAP_VERDICT_BUTTONS.map((s) => (
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

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Swap No" value={data.swapNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={data.status} />} />
            <SidebarKV
              label="Current Stage"
              value={data.currentStage ?? '—'}
              mono
            />
            <SidebarKV
              label="Needs Review"
              value={
                data.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : 'No'
              }
            />
            <SidebarKV label="Owner" value={ownerLink} />
            <SidebarKV label="Pair" value={`${data.fromAsset.code}/${data.toAsset.code}`} mono />
            <SidebarKV label="Net Received" value={netDisplay} mono />
          </SidebarGroup>

          {/* ── Customer Disposition（只读，无任何按钮）——
              兑换的拒绝处置作用在【人】身上而非订单：订单终态不可逆，
              officer 的所有处置动作都在 Sumsub 控制台完成（打 tag / 审 action），
              经 webhook 链路落回这里展示。此块回答 operator 一个问题：
              "这个客户现在被限制了什么、凭什么解锁"。 */}
          <SidebarGroup title="Customer Disposition">
            <SidebarKV
              label="Restrictions"
              value={
                restrictionCaps.length > 0 ? (
                  <span className="font-mono text-adm-red">{restrictionCaps.join(' · ')}</span>
                ) : (
                  'None'
                )
              }
            />
            <SidebarKV
              label="Pending Action"
              value={data.customer?.pendingActionExternalId ?? '—'}
              mono
            />
            <SidebarKV
              label="Hard Line"
              value={
                data.customer?.hardLineDispositionedAt ? (
                  <AdminBadge value="SANCTION_HELD" />
                ) : (
                  'Not set'
                )
              }
            />
            {ownerNo && (
              <SidebarKV
                label="Customer"
                value={ownerLink}
              />
            )}
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={new Date(data.createdAt).toLocaleString()} mono />
            <SidebarKV
              label="Completed"
              value={data.completedAt ? new Date(data.completedAt).toLocaleString() : null}
              mono
            />
            <SidebarKV label="Trace ID" value={data.traceId} mono />
          </SidebarGroup>

          {/* ── Terminal 提示（对齐提现侧栏）── */}
          {isTerminal && (
            <p className="px-1 py-3 font-mono text-[10px] text-adm-t3">
              Terminal — no further action available on this order. Customer-level follow-up (if
              any) happens via Sumsub applicant actions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── LegAttemptRow ──────────────────────────────────────────── */

const LegAttemptRow = ({
  swapNo,
  legSeq,
  row,
  amountLabel,
  routeLabel,
  isLatest,
  busy,
  onNavigate,
  onResume,
}: {
  swapNo: string;
  legSeq: number;
  row: InternalFundLeg;
  amountLabel: string;
  routeLabel: string | null;
  isLatest: boolean;
  busy: boolean;
  onNavigate: () => void;
  onResume: (swapNo: string, legSeq: number) => void;
}) => {
  const status = row.status;
  const attemptLabel = `Attempt ${row.attempt ?? 1}`;
  const showResume = isLatest && status === 'NEEDS_REVIEW';
  // Routine leg-state advance was removed here — funds-order state is now driven
  // from the funds-order detail page's ⚡ simulation panel. Resume (stuck-leg
  // recovery) stays; the fundsOrderNo link navigates to that panel.

  return (
    <div
      className={`flex flex-col gap-2 px-3 py-2.5 ${
        isLatest ? 'bg-adm-bg' : 'bg-adm-panel/40'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
            {attemptLabel}
          </span>
          <button
            type="button"
            onClick={onNavigate}
            className="truncate font-mono text-[11px] font-semibold text-adm-amber hover:opacity-75"
          >
            {row.fundsOrderNo}
          </button>
          <AdminBadge value={status} />
          {!isLatest && (
            <span className="rounded border border-adm-border bg-adm-panel px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-adm-t3">
              History
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-adm-t2">{amountLabel}</span>
      </div>
      {routeLabel && (
        <div className="font-mono text-[10px] text-adm-t3">{routeLabel}</div>
      )}
      {showResume && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onResume(swapNo, legSeq)}
            disabled={busy}
            className={adminButtonClass('repair')}
          >
            Resume Leg
          </button>
        </div>
      )}
    </div>
  );
};

/* ── SumsubDetailSection ─────────────────────────────────────── */

/**
 * Renders the swap's parsed Sumsub compliance fields (Task 10) — verdict,
 * scoring action, matched rule names, reject reason, plus the raw sell-leg
 * getTxn payload collapsed behind a <details>. Mirrors
 * WithdrawTransactionDetail's SumsubDetailSection (deliberate fork).
 */
const SumsubDetailSection = ({
  detail,
}: {
  detail: SwapSumsubDetail | null | undefined;
}) => (
  <div>
    {detail ? (
      <div className="space-y-3">
        {/* Txn ID Out/In 已上移到 Sumsub References 卡（身份键归 References、
            裁决分析归本卡），此处不再重复。 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <InfoField label="Verdict" value={detail.verdict} />
          <InfoField label="Scoring Action" value={detail.scoringAction} />
          <InfoField label="Reject Reason" value={detail.rejectReason} />
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
            Matched Rules
          </div>
          {detail.matchedRules.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {detail.matchedRules.map((name, idx) => (
                <li key={`${name}-${idx}`} className="font-mono text-[11px] text-adm-t1">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 font-mono text-[11px] text-adm-t3">—</div>
          )}
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
            Applicant Actions（下发的补料要求）
          </div>
          {detail.applicantActions && detail.applicantActions.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {detail.applicantActions.map((a, idx) => (
                <li key={`${a.applicantActionId}-${idx}`} className="font-mono text-[11px] text-adm-t1">
                  {a.applicantActionId ?? '—'} · ext: {a.externalActionId ?? '—'}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 font-mono text-[11px] text-adm-t3">—（本裁决未下发 action）</div>
          )}
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
      <p className="font-mono text-[11px] text-adm-t3">No Sumsub compliance detail yet</p>
    )}
  </div>
);

/* ── StatusTimeline (adm-* tokens) ── */

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
  if (!historyJson) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed)) {
      return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
    }
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return <div className="p-4 text-sm text-adm-red">Error parsing history</div>;
  }

  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No events</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-6 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.timestamp || item.changedAt || idx}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className="h-3 w-3 rounded-full bg-adm-green" />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className="rounded border border-adm-green/30 bg-adm-green/10 px-2 py-0.5 font-mono text-[10px] font-bold text-adm-green">
                {item.status || 'UNKNOWN'}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.note || item.reason || 'No reason provided'}
            </p>
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
        </div>
      ))}
    </div>
  );
};

export default SwapTransactionDetail;

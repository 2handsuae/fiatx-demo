import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { getSwapStatusMeta, isSwapTerminalStatus } from '../utils/swapStatusMap';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { formatSlaRemaining } from '../utils/slaDisplay';
import { useSimulationMode } from '../utils/simulationMode';
import { getComplianceLayerStyle } from '../utils/depositActionMap';
import L1GateCard from '../components/L1GateCard';
import { GateTile } from '../components/compliance/GateTile';
import { SumsubDetailSection } from '../components/compliance/SumsubDetailSection';
import { StatusTimeline } from '../components/compliance/StatusTimeline';
import MaterialRequestPanel from '../components/MaterialRequestPanel';

/* ── Types ──────────────────────────────────────────────────── */

/* 7 个单步裁决按钮,与充值/提现版镜像(deliberate fork)。key/label 必须与后端
   src/modules/swap-sumsub/fixtures/verdict-buttons.ts 的 SWAP_VERDICT_BUTTONS
   逐一对齐——这里没有自动化断言(admin-web 暂无测试基建),改动任一侧务必同步
   改另一侧,否则 operator 会点不出新场景。
   ⚠️ 没有 V4B（对手方制裁）：业主 2026-08-20 终审裁定——兑换没有第三方对手方，
   这个场景不存在，见后端 fixture 同名注释；充值/提现两个姊妹页保留该按钮。 */
const SWAP_VERDICT_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'V1_APPROVED', label: '① Approved' },
  { key: 'V2_REJECTED_HARD', label: '② Rejected · 硬线（无 action）' },
  { key: 'V3_REJECTED_ACTION', label: '③ Rejected · 软线（下发认证）' },
  { key: 'V4_REJECTED_SANCTION_APPLICANT', label: '④ Rejected · Sanctions（客户本人）' },
  { key: 'V5_ONHOLD', label: '⑤ On hold（我方等同拒绝）' },
  { key: 'V6_AWAIT_USER', label: '⑥ Awaiting user（我方等同拒绝）' },
  { key: 'V7_ACTION_GREEN', label: '⑦ 认证通过（清限制）' },
  { key: 'V8_ACTION_RED', label: '⑧ 认证不通过（升级）' },
];

/** Matched-rule entry inside the Sumsub compliance detail. */
/** parity 2026-08-14：与提现 SumsubTxnDetail 逐字段同形 + swap 双腿补充。 */
interface SwapMatchedRule {
  id?: string;
  name?: string;
  action?: string;
  score?: number;
}
interface SwapSumsubDetail {
  verdict: string | null;
  reviewStatus: string | null;
  reviewAnswer: string | null;
  score: number | null;
  matchedRules: SwapMatchedRule[];
  applicantActionIds: string[];
  tags: string[];
  raw: unknown;
  // swap 补充：双腿 txnId（提现单腿没有）
  txnIdOut: string | null;
  txnIdIn: string | null;
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
    /** 客户关系生命周期七态（PROSPECT/IN_VERIFICATION/…/ACTIVE/…/OFFBOARDED）。 */
    lifecycle?: string | null;
    sumsubApplicantId?: string | null;
    // 拒绝处置在客户身上留下的状态位——本页侧栏只读展示，
    // 处置动作本身全在 Sumsub 控制台（officer）与 webhook 链路完成，无按钮。
    // 限制账的行：一行 = 一个被卡住的能力（scope），同一张便签（restrictionNo）
    // 卡多个能力就是同号多行。此前这里读的是 CustomerMain 上一个**不存在的列**
    // `restrictions`，恒解析成空数组 → 侧栏恒显示 None。
    restrictionRows?: Array<{
      restrictionNo: string;
      cause: string;
      scope: string;
      visibility: string;
    }>;
    hardLineDispositionedAt?: string | null;
  } | null;
  statusHistory: string | null;
  l1Snapshot?: string | null;
  internalFunds?: InternalFundLeg[];
  /** 本单还挂着的材料请求活行（PENDING_SUBMISSION / SUBMITTED）。 */
  materialRequests?: Array<{ requestNo: string; materialType: string; status: string }>;
  sumsubDetail?: SwapSumsubDetail | null;
  // parity 2026-08-14：行级裸列（References 卡消费，镜像提现顶层列）
  complianceVerdict?: string | null;
  complianceAction?: string | null;
  rejectReason?: string | null;
  sumsubTxnType?: string | null;
  sumsubScore?: number | null;
  sumsubScoredAt?: string | null;
  slaDeadline?: string | null;
  slaBreached?: boolean | null;
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
  const { enabled: simEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState<string | null>(null);
  const [simError, setSimError] = useState('');
  // 喂裁决成功后的顶部回显条（对齐充值/提现详情页的 notice 形态）。
  const [notice, setNotice] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState('');

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

  /* ── SLA (演示用「模拟超时」——不是 ⚡ Simulation 面板那个模拟 Sumsub
      webhook 的东西；见 SidebarGroup title="SLA") ── */

  const handleSimulateSlaTimeout = async () => {
    if (!data) return;
    setSlaSubmitting(true);
    setSlaError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions/${data.swapNo}/simulate-sla-timeout`,
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
  // L1 读客户生命周期 `lifecycle`；L2 读本单 KYT 终裁 verdict（approved/rejected/null=还没等到）。
  // 第四批修复轮：此前读 `customer.complianceStatus` —— 那一列与 `restrictions` 是
  // 同一次 migration（20260816063807_customer_lifecycle_restrictions）一起 drop 的,
  // 早已不存在,恒 undefined → 这一格恒显示灰色 `N/A`（一笔被制裁冻结的单也是 N/A）。
  // 改读 `lifecycle`：它正是 L1GateService 的 CUSTOMER_ELIGIBILITY 判的东西
  // （`access.lifecycle === 'ACTIVE'`）,口径天然一致。
  const eligibilityStyle = getComplianceLayerStyle(data.customer?.lifecycle);
  // 未裁决时传 'PENDING' 拿琥珀色（而非无值的灰色）——未决恰是 operator 最该注意的态。
  const l2Style = getComplianceLayerStyle(data.sumsubDetail?.verdict || 'PENDING');

  // ── 客户处置状态（侧栏只读；无任何按钮）──
  // 拒绝处置写在人身上：限制账 / 材料请求 / 硬线标记。
  // 第四批：改读限制账真数据（此前读 CustomerMain 上一个不存在的列,恒 None）。
  // 限制账是**一行一个 scope**,所以直接取 scope 去重即可,不需要 JSON.parse
  // （旧代码那次 JSON.parse 正是因为读了个不存在的列才恒返回 []）。
  const restrictionCaps: string[] = Array.from(
    new Set((data.customer?.restrictionRows ?? []).map((r) => r.scope).filter(Boolean)),
  );
  // 第四批修复轮：此前手写 `SUCCESS || REJECTED`,漏了 FROZEN —— 它是转移表里
  // 明写的零出边终态,却不显示 Terminal 提示。改走 isSwapTerminalStatus（本域自己
  // 那一份,不与提现共用：提现的 FROZEN 有合法出边,不是终态）。
  const isTerminal = isSwapTerminalStatus(data.status);

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
                {/* 第四批：改用兑换域映射表 —— 通用 StatusPill 把 FROZEN 渲染成青色,
                    与列表页/充值/提现的红色对不上（同一笔单两个颜色）。 */}
                <span
                  className={`mt-1 inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${getSwapStatusMeta(data.status).badgeClass}`}
                >
                  {getSwapStatusMeta(data.status).label}
                </span>
                {/* 拒绝理由 —— 类型早就声明了却全页零渲染（第四批补上）。
                    这是 operator 唯一能看到"为什么被拒"的地方。 */}
                {data.rejectReason && (
                  <div className="mt-1 font-mono text-[11px] text-adm-red">
                    Reject reason: {data.rejectReason}
                  </div>
                )}
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
              {/* SLA — 没有 deadline（终态等不计时的单）整格不显示；slaBreached
                  优先于时间计算（formatSlaRemaining 内部已处理），软破线后单据
                  状态与 deadline 都不变，只有这个标记能表达已超时。 */}
              {data.slaDeadline && (() => {
                const sla = formatSlaRemaining(data.slaDeadline, data.slaBreached ?? undefined);
                return (
                  <div>
                    <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                      SLA
                    </span>
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

          {/* 4. Compliance — L1 真实资格 + L2 KYT 单闸。
              L1 读客户 lifecycle（与 L1GateService 的 CUSTOMER_ELIGIBILITY 同一口径）；
              L2 读本单 KYT 终裁。
              兑换无 TR/大额门 —— L2 只有 KYT 一道，这是设计而非缺失（无对手方），
              所以 L2 前缀锁死 Finance，不做 travelRule 分支。
              2026-08-23：容器从手写 div+h3 换成 DetailCard，两个格子换成共用的
              GateTile —— 与充值/提现同一承载物（第五批 §3）。 */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption="Pre-creation check"
                style={eligibilityStyle}
              />
              <GateTile
                title="L2 · Transaction Screen"
                value={`Finance: ${data.sumsubDetail?.verdict ?? '—'}`}
                caption={
                  data.sumsubDetail?.score != null
                    ? `Score ${data.sumsubDetail.score}`
                    : data.complianceAction
                      ? `Scoring action: ${data.complianceAction}`
                      : 'Awaiting Sumsub verdict'
                }
                style={l2Style}
              />
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>

          {/* 5. Sumsub References — 身份/关联键（对齐充值/提现同名卡）。 */}
          <DetailCard title="Sumsub References" columns={2}>
            <InfoField
              label="Applicant ID"
              value={data.customer?.sumsubApplicantId}
              mono
            />
            <InfoField label="Txn ID Out (sell leg)" value={data.sumsubDetail?.txnIdOut} mono />
            <InfoField label="Txn ID In (buy leg)" value={data.sumsubDetail?.txnIdIn} mono />
            <InfoField label="Type" value={data.sumsubTxnType} />
            <InfoField label="Verdict" value={data.complianceVerdict} />
            <InfoField
              label="Received At"
              value={data.sumsubScoredAt ? new Date(data.sumsubScoredAt).toLocaleString() : null}
              mono
            />
            {/* 第四批：此前读 CustomerMain 上一个不存在的列（pending-action 指针，
                随材料请求账重写退役），恒 `—`。改显示本单还挂着的材料请求活行数。 */}
            <InfoField
              label="Verification Requests"
              value={
                (data.materialRequests?.length ?? 0) > 0
                  ? `${data.materialRequests!.length} open`
                  : '—'
              }
            />
          </DetailCard>

          {/* 6. Sumsub Transaction Detail — 裁决分析（verdict/规则/原始报文）。 */}
          <DetailCard title="Sumsub Transaction Detail" columns={1}>
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
          <DetailCard title="Linked Funds Orders" columns={1}>
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
                              row={row}
                              amountLabel={amountLabel}
                              routeLabel={routeLabel}
                              isLatest={isLatest}
                              onNavigate={() =>
                                navigate(`/admin/funds-orders/${row.fundsOrderNo}`)
                              }
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
            <StatusTimeline historyJson={data.statusHistory} getStatusMeta={getSwapStatusMeta} />
          </DetailCard>

          {/* Verification Requests — same component + endpoint as the customer
              detail page's Verification Requests section, `mode="order"` scopes
              it to this swap's still-live rows (G6). */}
          <DetailCard title="Verification Requests" columns={1}>
            <MaterialRequestPanel mode="order" orderDomain="SWAP" orderRef={data.swapNo} />
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

        {/* ── Sidebar (no compliance disposition actions — that happens in
            Sumsub, read-only here; SLA 演示用「模拟超时」按钮是唯一的例外) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
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

          <SidebarGroup title="Identity">
            <SidebarKV label="Swap No" value={data.swapNo} mono />
            <SidebarKV
              label="Status"
              value={
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getSwapStatusMeta(data.status).badgeClass}`}
                >
                  {getSwapStatusMeta(data.status).label}
                </span>
              }
            />
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

          {/* Frozen Disposition — 兑换的 FROZEN 是**零出边终态**（制裁命中客户本人时
              落地,见 truth/v6-swap.md §1）。与充值/提现刻意不同：那两域的 FROZEN
              可以经 maker-checker 解冻回流,兑换回不来 —— 所以这里**没有按钮**,
              只说明现状,免得运营去找一个不存在的解冻入口。 */}
          {data.status === 'FROZEN' && (
            <SidebarGroup title="Frozen Disposition">
              <p className="font-mono text-[11px] text-adm-t3">
                制裁冻结（零出边终态）。本单不可解冻、不可继续 —— 客户侧收敛显示为
                Unsuccessful，与普通 KYT 拒绝逐字相同。人身层处置见客户档案的限制账。
              </p>
            </SidebarGroup>
          )}

          {/* ── Ops Disposition（只读，无任何按钮）——
              兑换的拒绝处置作用在【人】身上而非订单：订单终态不可逆，
              officer 的所有处置动作都在 Sumsub 控制台完成（打 tag / 审 action），
              经 webhook 链路落回这里展示。此块回答 operator 一个问题：
              "这个客户现在被限制了什么、凭什么解锁"。 */}
          <SidebarGroup title="Ops Disposition">
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
              label="Verification Requests"
              value={
                (data.materialRequests?.length ?? 0) > 0
                  ? `${data.materialRequests!.length} open`
                  : '—'
              }
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
  row,
  amountLabel,
  routeLabel,
  isLatest,
  onNavigate,
}: {
  row: InternalFundLeg;
  amountLabel: string;
  routeLabel: string | null;
  isLatest: boolean;
  onNavigate: () => void;
}) => {
  const status = row.status;
  const attemptLabel = `Attempt ${row.attempt ?? 1}`;
  // 这里没有任何修复按钮 —— 业主 2026-08-22 裁定：兑换单不该有 resume 按钮，
  // needsReview 只标红、不给修复入口。（此前那个 Resume Leg 按钮的判据是
  // status === 'NEEDS_REVIEW'，而 FundsOrderStatus 枚举里根本没有这个值，
  // 所以它从来就点不出来。）后端 resume 端点保留，留一条命令行的路。
  // Routine leg-state advance also lives elsewhere — funds-order state is driven
  // from the funds-order detail page's ⚡ simulation panel; the fundsOrderNo
  // link navigates to that panel.

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
    </div>
  );
};

export default SwapTransactionDetail;

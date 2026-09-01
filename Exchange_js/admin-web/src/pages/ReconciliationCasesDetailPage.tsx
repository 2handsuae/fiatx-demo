// admin-web/src/pages/ReconciliationCasesDetailPage.tsx
//
// T8 "Investigation cockpit" — read-only Case detail for the WALLET_V1 engine.
// Round3 layout 乙 (confirmed in brainstorm): bucket badge + explain 5-cell +
// observation history + single mixed-bucket flow table (no grouped sections).
//
// Replaces the V8 five-formula book/asset/vintage view (kept off-screen — the
// new wallet engine never populates `book` LHS labels). The cockpit answers
// the operator's two investigation questions:
//   1. "What broke for this wallet? (balance, flows, both?)"
//   2. "Which specific external/internal lines diverge?"
//
// Layout (top → bottom):
//   1. Nav header (back + refresh)
//   2. Hero — caseNo + bucket badge + severity badge
//   3. Account Identity card — wallet, owner, asset, COA, linked run, status
//   4. 差额解释 / Delta Explained — 5 cells: Internal / External / Δ /
//      In-transit / Residual (residual is the core investigation signal)
//   5. 观察历史 / Observation — first/last-seen run history one-liner
//   6. 流水下钻 / Flow Drilldown — single mixed table sorted by severity
//      (mismatch/orphan → in-transit → matched, matched collapsed by default)
//   7. Bottom — "View in Account Statement" deep link
//   8. Sidebar (identity + lifecycle)
//
// Disposition workflow (Close / Waive / Assign) is deferred to Phase C — this
// page is investigation-only this release. Funds-order deep link (in-transit
// rows) is read-only this release too — no advance/sync/confirm actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight, ExternalLink, Plus } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { BUCKET_LABELS, formatBucketBilingual, type ReconBucket } from '../utils/reconBucketMap';
import { buildCaseConclusion } from '../utils/caseConclusion';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { triggerWalletReconRun } from '../utils/reconRunTrigger';
import ReconciliationAdjustmentCreateModal, {
  REASON_META,
  type AdjustmentBook,
  type AdjustmentPrefill,
  type AdjustmentLocked,
} from '../components/ReconciliationAdjustmentCreateModal';
import ReconciliationDispositionModal, {
  type AdjustHandoff,
} from '../components/ReconciliationDispositionModal';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { OUTLET_TONE, rowFacts, directionNoteFor } from '../utils/causeRegistry';

/* ── Types ──────────────────────────────────────────────────── */

// Legacy line-items still arrive in the response (the V8 engine wrote them).
// We no longer render them — flowComparison is the new investigation surface.
interface CaseLineItem {
  id: string;
  lineNo: number;
  matchStatus: string;
}

type FlowMatchType = 'MATCHED' | 'ORPHAN_EXTERNAL' | 'ORPHAN_INTERNAL' | 'AMOUNT_MISMATCH' | 'IN_TRANSIT';

interface FlowExternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;
  description?: string | null;
}

interface FlowInternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;
  eventCode: string;
  sourceType: string;
  sourceNo: string;
}

// Exported — T8 (平账一期半) 前端复用件（causeRegistry.ts / ReconciliationDispositionModal.tsx）
// 从这里 import type，而不是另建一份镜像类型（页面现状即唯一真相的最小改法，见 T8 brief）。
export interface FlowComparisonRow {
  externalLine: FlowExternalSide | null;
  internalFlow: FlowInternalSide | null;
  matchType: FlowMatchType;
  deltaAmount?: string;
  fundsOrderNo?: string | null;   // NEW — only for IN_TRANSIT rows
  fundsOrderStatus?: string | null; // T4 — funds order status for IN_TRANSIT rows;
                                    // CLEARED here (case still OPEN) = "已推进·待重对账"
  explainedByAdjustmentNo?: string | null; // ④ 这条差异已被哪张已落账的调账单解释
  // T8：以下三个注解同样只在三类异常行（AMOUNT_MISMATCH/ORPHAN_INTERNAL/
  // ORPHAN_EXTERNAL）上出现，MATCHED/IN_TRANSIT 恒 undefined——它们不是差异、没有
  // 可处置的东西。唯一真相在后端 reconciliation-query.service.ts。
  disposition?: {
    dispositionNo: string; causeCode: string; causeLabel: string;
    outlet: string; outletLabel: string; findingNote: string;
    adjustmentNo: string | null; createdBy: string; createdAt: string;
  } | null;
  duplicateTwinRef?: string | null;
  menu?: Array<{ code: string; label: string; clue: string; outletLabel: string }>;
}

interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}

// T6 additions — delta decomposition + observation history.
interface CaseExplain {
  internalTotal: string;
  externalClosing: string;
  delta: string;
  inTransitSigned: string;
  residual: string;
}

interface CaseObservation {
  firstSeenRunNo: string | null;
  firstSeenAt: string | null;
  lastObservedRunNo: string | null;
  reObservedCount: number;
  closedByRunNo: string | null;
  ageDays: number | null;
}

// Task 7 (调账单 admin 前端) — 案件级调账单列表，getCase 按 caseNo 直查返回，
// 独立于 lineItemId（ReconciliationLineItem 每轮对账 delete-then-insert 没有跨轮
// 身份，lineItemId 天生悬空——见控制方裁定）。
interface CaseAdjustmentRow {
  adjustmentNo: string;
  status: string;      // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  reasonCode: string;
  direction: string;   // REDUCE | INCREASE
  amount: string;       // 最小单位（分）整数字符串
}

interface ReconCaseDetail {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
  decimals: number;                   // T4 — asset.decimals; display scales 分→元 by 10^decimals
  layer: string;
  book: string | null;
  // Wallet-engine locators (T7 / T1)
  walletRef: string | null;
  walletNo: string | null;            // NEW — resolved business key via wallets table
  coaCode: string | null;
  ownerNo: string | null;
  // T1 idempotency
  firstSeenRunId: string | null;
  lastUpdatedRunId: string | null;
  openedByRunId: string | null;
  linkedRunNo: string | null;         // NEW — resolved runNo for lastUpdatedRunId ?? openedByRunId
  resolvedAt: string | null;
  resolutionReason: string | null;
  severity: string | null;
  // Balance snapshot — for WALLET_V1 cases:
  //   tbAmount         = internal book balance (bigint string)
  //   expectedExternal = external book balance (bigint string)
  //   deltaAmount      = external − internal (bigint string)
  tbAmount: string;
  inTransitAmount: string;
  expectedExternal: string;
  actualExternal: string;
  deltaAmount: string;
  status: string;
  closedByRunId: string | null;
  lastObservedRunId: string | null;
  slaDeadline: string | null;         // NEW — ISO timestamp or null
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: CaseLineItem[];
  // T3 additions
  flowComparison?: FlowComparisonRow[];
  flowSummary?: FlowComparisonSummary;
  // T6 additions (Round3) — historical cases may have bucket=null.
  bucket?: ReconBucket | null;
  explain?: CaseExplain;
  observation?: CaseObservation;
  // T7 addition — see CaseAdjustmentRow above.
  adjustments?: CaseAdjustmentRow[];
}

/* ── Constants & helpers ────────────────────────────────────── */

// T4 (canon2): amounts arrive as integer base units (分); scale 分→元 by the
// case asset's real decimals (getCase returns `decimals` from the asset table).
// bigint-safe string padding — no float, so USDT (6dp) shows every digit right.
// decimals=0 (asset lookup miss / integer asset) degrades to no fraction part.
export const formatAmount = (raw: string | null | undefined, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};

const isZeroAmount = (raw: string | null | undefined): boolean => {
  const s = String(raw ?? '0').replace(/^-/, '');
  return s === '' || /^0+$/.test(s);
};

const deltaSign = (raw: string | null | undefined): '+' | '-' | '' => {
  if (raw == null) return '';
  if (isZeroAmount(raw)) return '';
  return String(raw).startsWith('-') ? '-' : '+';
};

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

// Compact timestamp for flow-row cells (the table is dense — full timestamps blow it up).
const shortTimestamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
};

// Sort priority for the single mixed-bucket flow table (layout 乙): break-class
// rows (mismatch/orphan) first, then in-transit, then matched last (collapsed
// by default). Within each bucket, by timestamp asc (best-available side).
const MATCH_RANK: Record<FlowMatchType, number> = {
  AMOUNT_MISMATCH: 0,
  ORPHAN_INTERNAL: 1,
  ORPHAN_EXTERNAL: 1,
  IN_TRANSIT: 2,
  MATCHED: 3,
};

const rowTimestamp = (r: FlowComparisonRow): number => {
  const t = r.externalLine?.timestamp ?? r.internalFlow?.timestamp ?? null;
  return t ? new Date(t).getTime() : 0;
};

// Task 7（控制方裁定 Step 4）：开单入口挂在 flowComparison 行上，点击用该行的数据
// 预填「能预填的字段」——金额、方向；lineItemId 不传（该行的 id 来自
// ExternalStatementLine/AccountFlow，与 ReconciliationLineItem.id 不是一张表）。
// 方向是猜测性默认值，表单里仍是可编辑下拉，猜错不影响正确性。推导依据：
// deltaAmount／案件级 delta 的符号惯例统一是「外部 − 内部」（buildFlowComparison
// 里 ext.amount.minus(intl.amount)，reconciliation-query.service.ts）：
//   AMOUNT_MISMATCH  — 符号即答案：正→内部偏低→INCREASE，负→REDUCE
//   ORPHAN_EXTERNAL / IN_TRANSIT — 外部有我没记，按外部方向直接入账：IN→INCREASE，OUT→REDUCE
//   ORPHAN_INTERNAL  — 内部记了外部没有，这笔要冲销，方向与它自己相反：IN→REDUCE，OUT→INCREASE
//   MATCHED          — 两边一致，没有「要改什么」的信号，不猜
const rowAdjustmentPrefill = (row: FlowComparisonRow): AdjustmentPrefill => {
  const ext = row.externalLine;
  const intl = row.internalFlow;

  // ④ 两个解释锚一律按行原样带上——它们是这条差异的真实证据 id，后端据此在下一轮
  // 对账里把这条差异从异常数里摘掉（没有它们，调账只补得平余额，案子仍卡在
  // SOFT_FLAG 关不掉）。哪类行带哪个锚由行自身决定，这里不做筛选。
  const anchors = {
    explainedFlowId: intl?.id,
    explainedExternalLineId: ext?.id,
  };

  if (row.matchType === 'AMOUNT_MISMATCH' && row.deltaAmount != null) {
    return {
      amountMinor: row.deltaAmount.replace(/^-/, ''),
      direction: row.deltaAmount.startsWith('-') ? 'REDUCE' : 'INCREASE',
      relatedOrderNo: '',
      ...anchors,
    };
  }
  if (row.matchType === 'ORPHAN_INTERNAL' && intl) {
    return {
      amountMinor: intl.amount,
      direction: intl.direction === 'IN' ? 'REDUCE' : 'INCREASE',
      relatedOrderNo: '',
      ...anchors,
    };
  }
  if ((row.matchType === 'ORPHAN_EXTERNAL' || row.matchType === 'IN_TRANSIT') && ext) {
    return {
      amountMinor: ext.amount,
      direction: ext.direction === 'IN' ? 'INCREASE' : 'REDUCE',
      relatedOrderNo: row.matchType === 'IN_TRANSIT' ? (row.fundsOrderNo ?? '') : '',
      ...anchors,
    };
  }
  // MATCHED（或兜底）：只给金额，不猜方向。
  return { amountMinor: ext?.amount ?? intl?.amount ?? '0', direction: '', relatedOrderNo: '', ...anchors };
};

// T9：处置弹层交回（或「开单」按钮重放定性后）的 ADJUST 结论 → 调账弹层的锁定态。
// 改记族（REATTRIBUTE）额外拼一个候选查询路径——side 由行的 matchType 决定
// （ORPHAN_INTERNAL=我有外无=错记方=FROM，其余=正主方=TO，与
// disposition.service.ts listReattributionCandidates 的约定同源）；amount 用同一份
// rowAdjustmentPrefill 算出的金额——与调账弹层最终提交给后端的金额同一个数，
// 避免「查候选用一个数、开单用另一个数」两处各算一遍出现分歧。
const buildAdjustLocked = (handoff: AdjustHandoff, currentCaseNo: string): AdjustmentLocked => {
  const side = handoff.row.matchType === 'ORPHAN_INTERNAL' ? 'FROM' : 'TO';
  const amountMinor = rowAdjustmentPrefill(handoff.row).amountMinor;
  return {
    dispositionNo: handoff.dispositionNo,
    family: handoff.family,
    reasonCode: handoff.reasonCode,
    direction: handoff.direction,
    directionNote: handoff.directionNote,
    toCandidatesUrl: handoff.family === 'REATTRIBUTE'
      ? `/admin/reconciliation/cases/${encodeURIComponent(currentCaseNo)}/reattribution-candidates?side=${side}&amount=${amountMinor}`
      : undefined,
  };
};

// adm-* tone tokens — shared shape with reconBucketMap's tone names, mirrors
// ReconciliationRunsDetailPage's local TONE_CLASSES (not exported from the
// shared util) so the two cockpit pages stay visually consistent.
const TONE_CLASSES: Record<'green' | 'blue' | 'amber' | 'red', { border: string; bg: string; text: string }> = {
  green: { border: 'border-adm-green/30', bg: 'bg-adm-green/10', text: 'text-adm-green' },
  blue:  { border: 'border-adm-blue/30',  bg: 'bg-adm-blue/10',  text: 'text-adm-blue' },
  amber: { border: 'border-adm-amber/30', bg: 'bg-adm-amber/10', text: 'text-adm-amber' },
  red:   { border: 'border-adm-red/30',   bg: 'bg-adm-red/10',   text: 'text-adm-red' },
};

// Style + bilingual label maps for the type badge cell.
const MATCH_TONE: Record<FlowMatchType, string> = {
  MATCHED:         `${TONE_CLASSES.green.border} ${TONE_CLASSES.green.bg} ${TONE_CLASSES.green.text}`,
  IN_TRANSIT:      `${TONE_CLASSES.blue.border} ${TONE_CLASSES.blue.bg} ${TONE_CLASSES.blue.text}`,
  ORPHAN_INTERNAL: `${TONE_CLASSES.amber.border} ${TONE_CLASSES.amber.bg} ${TONE_CLASSES.amber.text}`,
  ORPHAN_EXTERNAL: `${TONE_CLASSES.amber.border} ${TONE_CLASSES.amber.bg} ${TONE_CLASSES.amber.text}`,
  AMOUNT_MISMATCH: `${TONE_CLASSES.red.border} ${TONE_CLASSES.red.bg} ${TONE_CLASSES.red.text}`,
};

export const MATCH_LABEL: Record<FlowMatchType, string> = {
  MATCHED:         'Matched / 已匹配',
  IN_TRANSIT:      'In-transit / 在途',
  ORPHAN_INTERNAL: 'Internal only / 我有外无',
  ORPHAN_EXTERNAL: 'External only / 外有我无',
  AMOUNT_MISMATCH: 'Mismatch / 金额不符',
};

const MatchChip = ({ row }: { row: FlowComparisonRow }) => {
  const tone = MATCH_TONE[row.matchType];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
      {row.matchType === 'MATCHED' ? <Check size={10} /> : <AlertTriangle size={10} />}
      {MATCH_LABEL[row.matchType]}
    </span>
  );
};

// 观察历史 / Observation — one text line summarizing this case's run history.
// Any null runNo (historical case, pre-T6 data) renders as "—" rather than
// throwing. OPEN cases aged 2+ days get a red "仍 OPEN·已挂 N 天" tail.
const ObservationBar = ({ kase }: { kase: ReconCaseDetail }) => {
  const obs = kase.observation;
  const runOrDash = (v: string | null | undefined) => v ?? '—';
  if (!obs) {
    return <div className="font-mono text-[12px] text-adm-t3">No observation history available.</div>;
  }
  const isAged = kase.status === 'OPEN' && (obs.ageDays ?? 0) >= 2;
  return (
    <div className="font-mono text-[12px] text-adm-t2">
      首见 <span className="text-adm-t1">{runOrDash(obs.firstSeenRunNo)}</span>
      {' → '}复观察 ×{obs.reObservedCount}（最后 <span className="text-adm-t1">{runOrDash(obs.lastObservedRunNo)}</span>）
      {kase.status === 'RESOLVED' ? (
        <>
          {' → '}已关闭 by <span className="text-adm-green">{runOrDash(obs.closedByRunNo)}</span>
          {kase.resolutionReason && <span className="text-adm-t3">{'（'}{kase.resolutionReason}{'）'}</span>}
        </>
      ) : isAged ? (
        <span className="text-adm-red font-semibold">{' → '}仍 OPEN·已挂 {obs.ageDays} 天</span>
      ) : (
        <>{' → '}仍 OPEN</>
      )}
    </div>
  );
};

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationCasesDetailPage = () => {
  const { caseNo } = useParams<{ caseNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreateAdjustment = hasPermission(PERMISSIONS.RECON_ADJUSTMENT_CREATE);
  // T8（平账一期半）：动作列六态里「未定性」状态的处置按钮门控。
  const canRecordDisposition = hasPermission(PERMISSIONS.RECON_DISPOSITION_CREATE);
  const [kase, setKase] = useState<ReconCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // MATCHED rows are collapsed by default (layout 乙 — single mixed table,
  // not grouped sections). Toggled by the "Show matched" button below the table.
  const [showMatched, setShowMatched] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  // Task 7: 开调账单弹层——prefill 来自被点击的那一行（rowAdjustmentPrefill）。
  // null = 弹层关闭；非 null = 弹层打开且带着这一行算出来的预填值。
  const [createPrefill, setCreatePrefill] = useState<AdjustmentPrefill | null>(null);
  // T9：调账弹层的锁定态——非 null 时弹层渲染锁定视图（成因/方向只读，改记额外
  // 换对端确认屏）；与 createPrefill 成对开关（弹层用哪套字段預填不受它是否为
  // null 影响，锁定态只决定「能不能改」）。
  const [adjustLocked, setAdjustLocked] = useState<AdjustmentLocked | null>(null);
  // T8: 处置弹层——null = 关闭；非 null = 打开且带着被点击的那一行。
  const [dispositionRow, setDispositionRow] = useState<FlowComparisonRow | null>(null);
  // T9：「开单」按钮重放定性请求进行中的 dispositionNo——防止重复点击（不是并发
  // 锁，纯粹是单人操作下按钮该有的 loading 态）。
  const [openingAdjustFor, setOpeningAdjustFor] = useState<string | null>(null);

  const tableRef = useRef<HTMLTableElement | null>(null);

  const fetchCase = async () => {
    if (!caseNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}`,
      );
      if (res.ok) {
        setKase((await res.json()) as ReconCaseDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load reconciliation case'));
        navigate('/admin/reconciliation/cases');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch reconciliation case', error);
    } finally {
      setLoading(false);
    }
  };

  // 一键重新对账 / Re-reconcile — 对**本案件的业务日**重跑一遍，成功后刷新本页
  // （重新观察可能把案子推到 RESOLVED：推单已把在途落地、或调账已把差额补平）。
  // 业务日必须传：跑"现在"会去取一份当天根本不存在的外部对账单，一个钱包都查不到
  // （见 utils/reconRunTrigger.ts 顶部注释）。
  const handleReReconcile = async () => {
    if (!kase) return;
    setReconciling(true);
    try {
      const ok = await triggerWalletReconRun(kase.businessDate);
      if (ok) await fetchCase();
    } finally {
      setReconciling(false);
    }
  };

  // Task 7: 创建成功 → 已在弹层内部调过 submit → 跳调账单详情页（brief §Step3）。
  // 不停留在案件页刷新——详情页本身会展示新单的状态/成因/方向/分录预览。
  const handleAdjustmentCreated = (adjustmentNo: string) => {
    setCreatePrefill(null);
    setAdjustLocked(null);
    navigate(`/admin/reconciliation/adjustments/${encodeURIComponent(adjustmentNo)}`);
  };

  // T9：已定性、出口是 ADJUST 但还没挂调账单的行——「开单」按钮点击时前端重放
  // 一次 POST /dispositions（同 causeCode、同 findingNote；disposition.service.ts
  // record() 是 upsert 覆盖语义，同锚命中已有记录就地 update，不会另开一条），
  // 换回完整的 { dispositionNo, family, reasonCode, direction }，再进锁定视图。
  //
  // 为什么不在前端直接拿 row.disposition.outlet 反查 family/reasonCode/direction：
  // disposition 表只存了 outlet（如 'ADJUST_CORRECT'），没存后两个——按 outlet 在
  // 前端还原 family 容易（outlet 去掉 'ADJUST_' 前缀），但 reasonCode/direction
  // 依赖行事实（差额符号 / 内外部流水方向 / sourceType），要在前端重新实现一遍
  // resolveOutlet 的判定逻辑，等于给后端 cause-registry.ts 立一个第二真相源——
  // 两边判定逻辑一旦某天改动不同步，「已定性」徽标和「开单」弹层就会说出两个不
  // 同的结论。用一次网络往返换回后端刚算好的同一份结果，比在前端重算更小的
  // 改动半径，也保证唯一真相不分叉。
  const openAdjustFromDisposition = async (row: FlowComparisonRow) => {
    if (!row.disposition || !kase) return;
    setOpeningAdjustFor(row.disposition.dispositionNo);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(kase.caseNo)}/dispositions`,
        {
          method: 'POST',
          body: JSON.stringify({
            matchType: row.matchType,
            explainedFlowId: row.internalFlow?.id,
            explainedExternalLineId: row.externalLine?.id,
            causeCode: row.disposition.causeCode,
            findingNote: row.disposition.findingNote,
            ...rowFacts(row),
          }),
        },
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to reopen disposition for adjustment.'));
        return;
      }
      const r = (await res.json()) as {
        dispositionNo: string;
        family: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE';
        reasonCode?: string;
        direction?: 'REDUCE' | 'INCREASE';
      };
      setCreatePrefill(rowAdjustmentPrefill(row));
      setAdjustLocked(buildAdjustLocked(
        {
          dispositionNo: r.dispositionNo, family: r.family,
          reasonCode: r.reasonCode, direction: r.direction,
          directionNote: directionNoteFor(row.matchType), row,
        },
        kase.caseNo,
      ));
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to reopen disposition for adjustment', error);
    } finally {
      setOpeningAdjustFor(null);
    }
  };

  // T9：处置弹层交回的 ADJUST 类结论——关掉处置弹层，带着锁定态打开调账弹层。
  const handleAdjustHandoff = (handoff: AdjustHandoff) => {
    if (!kase) return;
    setDispositionRow(null);
    setCreatePrefill(rowAdjustmentPrefill(handoff.row));
    setAdjustLocked(buildAdjustLocked(handoff, kase.caseNo));
  };

  useEffect(() => {
    if (caseNo) void fetchCase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNo]);

  // Single mixed-bucket table (layout 乙): mismatch/orphan rows first, then
  // in-transit, then matched (hidden unless expanded via showMatched). Within
  // each bucket, sort by timestamp asc. Hook called BEFORE early returns so
  // hook order stays stable across renders.
  const sortedFlows = useMemo<FlowComparisonRow[]>(() => {
    const rows = (kase?.flowComparison ?? []).filter((r) => showMatched || r.matchType !== 'MATCHED');
    return rows.sort((a, b) => {
      const r = MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType];
      if (r !== 0) return r;
      return rowTimestamp(a) - rowTimestamp(b);
    });
  }, [kase, showMatched]);

  const matchedCount = kase?.flowComparison?.filter((r) => r.matchType === 'MATCHED').length ?? 0;

  if (loading && !kase) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading reconciliation case...</p>
      </div>
    );
  }

  if (!kase) return null;

  // Δ display logic: zero → muted "balanced"; non-zero → bold red with sign.
  const deltaZero = isZeroAmount(kase.deltaAmount);
  const sign = deltaSign(kase.deltaAmount);

  // Bottom deep link — Account Flows prefills from the `?walletRef=` param.
  const accountStatementHref = kase.walletRef
    ? `/admin/ledger/flows?walletRef=${encodeURIComponent(kase.walletRef)}`
    : null;

  // Task 7: 开单表单要的是 CLIENT|FIRM 二选一——与后端 createDraft 同款归一化
  // （kase.book === 'FIRM' ? 'FIRM' : 'CLIENT'，adjustment.service.ts），legacy
  // 非 wallet 案件 book=null 时落 CLIENT。两边归一化写法必须一致，否则表单让选的
  // 成因，后端会用不同的账簿去校验，出现「表单选得进去，提交却 400」。
  const adjustmentBook: AdjustmentBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/reconciliation/cases')}
        onRefresh={fetchCase}
        refreshing={loading}
        backLabel="Cases"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Hero — case identity strip */}
          <section className="bg-adm-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[19px] font-bold text-adm-amber">{kase.caseNo}</span>
              {kase.bucket && (
                <span
                  className={[
                    'inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
                    TONE_CLASSES[BUCKET_LABELS[kase.bucket].tone].border,
                    TONE_CLASSES[BUCKET_LABELS[kase.bucket].tone].bg,
                    TONE_CLASSES[BUCKET_LABELS[kase.bucket].tone].text,
                  ].join(' ')}
                >
                  {kase.bucket === 'MATCHED' ? <Check size={10} /> : <AlertTriangle size={10} />}
                  {formatBucketBilingual(kase.bucket)}
                </span>
              )}
              {kase.severity && (
                <span
                  className={[
                    'inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
                    kase.severity === 'HIGH'   ? 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                    : kase.severity === 'MEDIUM' ? 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber'
                    :                              'border-adm-border bg-adm-bg text-adm-t3',
                  ].join(' ')}
                >
                  {kase.severity}
                </span>
              )}
              <StatusPill value={kase.status} size="md" />
            </div>
            {(() => {
              const c = buildCaseConclusion({ ...kase, bucket: kase.bucket ?? null }, (v) => formatAmount(v, kase.decimals));
              if (!c) return null;
              const toneCls =
                c.tone === 'red' ? 'text-adm-red'
                : c.tone === 'blue' ? 'text-adm-blue'
                : c.tone === 'amber' ? 'text-adm-amber'
                : 'text-adm-t2';
              return <div className={`mt-2 font-mono text-[12px] ${toneCls}`}>{c.text}</div>;
            })()}
          </section>

          {/* 2. 差额解释 / Delta Explained — five cells. Replaces the old 3-cell
              Balance Comparison card (Internal/External/Δ were a subset of
              this same story) so there's a single balance-explanation surface,
              not two overlapping ones. residual is the core investigation
              signal — zero means the delta is fully explained by in-transit
              funds orders; non-zero is what still needs digging. */}
          <DetailCard title={`差额解释 / Delta Explained (${kase.assetCode})`} columns={1}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {/* Internal */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  内部 / Internal
                </div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-t1">
                  {formatAmount(kase.explain?.internalTotal ?? kase.tbAmount, kase.decimals)}
                </div>
              </div>
              {/* External — actual closing balance from the external statement
                  (post-injection in demo break mode). expectedExternal is the
                  pre-injection mirror snapshot and would falsely equal internal
                  whenever the break is on a single wallet's external balance. */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  外部 / External
                </div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-t1">
                  {formatAmount(kase.explain?.externalClosing ?? kase.actualExternal, kase.decimals)}
                </div>
              </div>
              {/* Δ — muted green/check when balanced, bold red with sign when not. */}
              <div
                className={[
                  'rounded-lg border p-4',
                  deltaZero
                    ? 'border-adm-green/30 bg-adm-green/5'
                    : 'border-adm-red/30 bg-adm-red/5',
                ].join(' ')}
              >
                <div
                  className={[
                    'font-mono text-[9px] uppercase tracking-wider',
                    deltaZero ? 'text-adm-green' : 'text-adm-red',
                  ].join(' ')}
                >
                  Δ
                </div>
                <div
                  className={[
                    'mt-1 font-mono text-[18px] font-bold leading-tight',
                    deltaZero ? 'text-adm-t3' : 'text-adm-red',
                  ].join(' ')}
                >
                  {deltaZero
                    ? `${formatAmount(kase.deltaAmount, kase.decimals)}`
                    : `${sign}${formatAmount(kase.deltaAmount, kase.decimals).replace(/^-/, '')}`}
                </div>
              </div>
              {/* 在途解释 / In-transit explained — blue, the portion of Δ
                  covered by non-terminal funds orders. */}
              <div className="rounded-lg border border-adm-blue/30 bg-adm-blue/5 p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-blue">
                  在途解释 / In-transit
                </div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-blue">
                  {kase.explain ? formatAmount(kase.explain.inTransitSigned, kase.decimals) : '—'}
                </div>
              </div>
              {/* 未解释残差 / Residual — the core investigation signal. Red
                  highlight when non-zero (still needs digging); muted green
                  check when zero (delta fully explained by in-transit). */}
              <div
                className={[
                  'rounded-lg border p-4',
                  kase.explain && isZeroAmount(kase.explain.residual)
                    ? 'border-adm-green/30 bg-adm-green/5'
                    : 'border-adm-red/30 bg-adm-red/5',
                ].join(' ')}
              >
                <div
                  className={[
                    'font-mono text-[9px] uppercase tracking-wider',
                    kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-green' : 'text-adm-red',
                  ].join(' ')}
                >
                  未解释残差 / Residual
                </div>
                <div
                  className={[
                    'mt-1 font-mono text-[18px] font-bold leading-tight',
                    kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-t3' : 'text-adm-red',
                  ].join(' ')}
                >
                  {kase.explain ? formatAmount(kase.explain.residual, kase.decimals) : '—'}
                </div>
                <div
                  className={[
                    'mt-1 inline-flex items-center gap-1 font-mono text-[10px]',
                    kase.explain && isZeroAmount(kase.explain.residual) ? 'text-adm-green' : 'text-adm-red',
                  ].join(' ')}
                >
                  {!kase.explain ? null : isZeroAmount(kase.explain.residual)
                    ? <><Check size={10} /> 已解释 / explained</>
                    : <><AlertTriangle size={10} /> 待排查 / unexplained</>}
                </div>
              </div>
            </div>
          </DetailCard>

          {/* 3. Account Identity — collapsed to a single line (Round3 slim):
              wallet/owner/COA/asset·book. The old run-linkage and lifecycle
              subcards were dropped — run refs live in the Observation bar
              below, and those timestamps duplicate the sidebar Created/Updated fields. */}
          <DetailCard title="账户身份 / Account Identity" columns={1}>
            <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[12px]">
              <span><span className="text-adm-t3">钱包 </span><span className="text-adm-t1" title={kase.walletRef ?? undefined}>{kase.walletNo ?? (kase.walletRef ? kase.walletRef.slice(0, 12) : '—')}</span></span>
              <span><span className="text-adm-t3">客户 </span><span className="text-adm-t1">{kase.ownerNo ?? '—'}</span></span>
              <span><span className="text-adm-t3">科目 </span><span className="text-adm-t1">{kase.coaCode ?? '—'}</span></span>
              <span><span className="text-adm-t3">币种 </span><span className="text-adm-t1">{kase.assetCode}{kase.book ? ` · ${kase.book}` : ''}</span></span>
            </div>
          </DetailCard>

          {/* 4. 观察历史 / Observation — first/last seen, re-observed count,
              closed-by, and (for OPEN cases) how long the case has been open. */}
          <DetailCard title="观察历史 / Observation" columns={1}>
            <ObservationBar kase={kase} />
          </DetailCard>

          {/* 6. 流水下钻 / Flow Drilldown — single mixed table (layout 乙,
              confirmed in brainstorm). No grouped sections — orphans,
              mismatches, and in-transit rows sit in one table sorted by
              severity, with MATCHED rows collapsed behind a toggle below. */}
          <DetailCard
            title={`流水下钻 / Flow Drilldown · ${sortedFlows.length} row${sortedFlows.length === 1 ? '' : 's'}`}
            columns={1}
          >
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table ref={tableRef} className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      类型 / Type
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      方向 / Dir
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      金额 / Amount
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      外部单号 / External Ref
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      内部源 / Internal Source
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      时间 / Time
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      操作 / Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {sortedFlows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3">
                        No flow rows for this case.
                      </td>
                    </tr>
                  ) : (
                    sortedFlows.map((row, idx) => {
                      const ext = row.externalLine;
                      const intl = row.internalFlow;
                      const isMismatch = row.matchType === 'AMOUNT_MISMATCH';
                      const isInTransit = row.matchType === 'IN_TRANSIT';
                      const direction = ext?.direction ?? intl?.direction ?? null;
                      const timestamp = ext?.timestamp ?? intl?.timestamp ?? null;
                      return (
                        <tr
                          key={`${row.matchType}-${ext?.id ?? '_'}-${intl?.id ?? '_'}-${idx}`}
                          className="align-top"
                        >
                          {/* Type badge */}
                          <td className="px-3 py-3">
                            <MatchChip row={row} />
                          </td>
                          {/* Direction */}
                          <td className="px-3 py-3 font-mono text-[11px]">
                            {direction ? (
                              <span
                                className={`rounded border px-1 text-[9px] font-semibold ${
                                  direction === 'IN'
                                    ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                    : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                                }`}
                              >
                                {direction}
                              </span>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Amount — mismatch shows both sides "internal ≠ external" */}
                          <td className={`px-3 py-3 text-right font-mono text-[11px] ${isMismatch ? 'font-bold text-adm-red' : 'text-adm-t1'}`}>
                            {isMismatch
                              ? `${formatAmount(intl?.amount, kase.decimals)} ≠ ${formatAmount(ext?.amount, kase.decimals)}`
                              : formatAmount(ext?.amount ?? intl?.amount, kase.decimals)}
                          </td>
                          {/* External ref */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t2">
                            {ext?.externalRef ?? '—'}
                          </td>
                          {/* Internal source — IN_TRANSIT links to the funds order.
                              When that funds order is already CLEARED but this case
                              is still OPEN, badge "已推进·待重对账": a rerun will close
                              the case (use the Re-reconcile action in the sidebar). */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t2">
                            {isInTransit && row.fundsOrderNo ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <Link
                                  to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
                                  className="text-adm-blue hover:underline"
                                >
                                  {row.fundsOrderNo}
                                </Link>
                                {kase.status === 'OPEN' && row.fundsOrderStatus === 'CLEARED' && (
                                  <span className="inline-flex items-center gap-1 rounded border border-adm-blue/30 bg-adm-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-adm-blue">
                                    <Check size={9} /> 已推进·待重对账 / Pushed · re-reconcile
                                  </span>
                                )}
                              </span>
                            ) : intl ? (
                              `${intl.eventCode} · ${intl.sourceType}/${intl.sourceNo}`
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Time */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t3">
                            {timestamp ? shortTimestamp(timestamp) : '—'}
                          </td>
                          {/* 平账一期半（spec §3.1）：动作列六态。同形状同按钮——
                              给不同按钮就是假装机器知道它不知道的东西；差异化发生在
                              定性弹层里人选完成因之后。 */}
                          <td className="px-3 py-3">
                            {row.explainedByAdjustmentNo ? (
                              // ① 已解释——这条差异已经被一张落了账的调账单解释掉，
                              // 引擎算桶时已把它从异常数里摘掉，改为指回那张单。
                              <Link
                                to={`/admin/reconciliation/adjustments/${encodeURIComponent(row.explainedByAdjustmentNo)}`}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-green hover:underline"
                              >
                                已解释 · {row.explainedByAdjustmentNo}
                              </Link>
                            ) : row.matchType === 'MATCHED' ? (
                              // ② 已匹配——两边一致，没有可处置的东西。
                              null
                            ) : row.matchType === 'IN_TRANSIT' ? (
                              // ③ 在途——差异会随资金单落地自然消失，动作是推单不是处置。
                              row.fundsOrderNo ? (
                                <Link
                                  to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
                                  className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
                                >
                                  去推单 →
                                </Link>
                              ) : (
                                <span className="text-[10px] text-adm-t3">在途 · 无资金单号</span>
                              )
                            ) : row.disposition ? (
                              // ④ 已定性——查证结论已经落库；出口是 ADJUST 且还没挂单时，
                              // 额外给「开单」入口（同样按权限 + 案件 OPEN 门控整个按钮）。
                              <div className="flex flex-col gap-1">
                                <span
                                  title={row.disposition.findingNote}
                                  className={[
                                    'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px]',
                                    TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].border,
                                    TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].bg,
                                    TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].text,
                                  ].join(' ')}
                                >
                                  已定性 · {row.disposition.causeLabel} → {row.disposition.outletLabel} · {row.disposition.createdBy} {row.disposition.createdAt.slice(5, 10)}
                                </span>
                                {row.disposition.outlet.startsWith('ADJUST') && !row.disposition.adjustmentNo
                                  && canCreateAdjustment && kase.status === 'OPEN' && (
                                  <button
                                    type="button"
                                    onClick={() => void openAdjustFromDisposition(row)}
                                    disabled={openingAdjustFor === row.disposition.dispositionNo}
                                    className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline disabled:opacity-50"
                                  >
                                    <Plus size={10} />
                                    {openingAdjustFor === row.disposition.dispositionNo ? '打开中…' : '开单'}
                                  </button>
                                )}
                              </div>
                            ) : (
                              // ⑤/⑥ 未定性——这条差异还没人查过，给处置入口（按既有约定
                              // 以权限门控整个按钮的显隐，不是禁用态；案件已 RESOLVED 时
                              // 同样不给入口）。
                              canRecordDisposition && kase.status === 'OPEN' && (
                                <button
                                  type="button"
                                  onClick={() => setDispositionRow(row)}
                                  className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
                                >
                                  处置
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {matchedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowMatched((v) => !v)}
                className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
              >
                {showMatched ? `隐藏已匹配 ${matchedCount} 行 / Hide matched` : `显示已匹配 ${matchedCount} 行 / Show matched`}
              </button>
            )}
          </DetailCard>

          {/* 本案调账单 / This Case's Adjustments（Task 7 控制方裁定）——案件级列表，
              运营在这里一眼看到本案已经开过哪些调账单，防重复开单的目的靠它达成
              （不靠给差异项行"整行置灰"：flowComparison 行 id 和
              ReconciliationLineItem.id 不是一张表，做不到）。点单号进详情页。 */}
          <DetailCard
            title={`本案调账单 / This Case's Adjustments · ${kase.adjustments?.length ?? 0}`}
            columns={1}
          >
            {!kase.adjustments || kase.adjustments.length === 0 ? (
              <div className="py-4 text-center font-mono text-[11px] text-adm-t3">
                尚未开过调账单 / No adjustments opened yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        调账单号 / No.
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        状态 / Status
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        成因 / Reason
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        方向 / Dir
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        金额 / Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {kase.adjustments.map((adj) => (
                      <tr key={adj.adjustmentNo}>
                        <td className="px-3 py-2.5">
                          <Link
                            to={`/admin/reconciliation/adjustments/${encodeURIComponent(adj.adjustmentNo)}`}
                            className="font-mono text-[11px] font-semibold text-adm-amber hover:underline"
                          >
                            {adj.adjustmentNo}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill value={adj.status} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                          {REASON_META[adj.reasonCode]?.label ?? adj.reasonCode}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">
                          <span
                            className={`rounded border px-1 text-[9px] font-semibold ${
                              adj.direction === 'INCREASE'
                                ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                            }`}
                          >
                            {adj.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                          {formatAmount(adj.amount, kase.decimals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailCard>

          {/* 6. Bottom utility — deep link to Account Flows */}
          <DetailCard title="Related Views" columns={1}>
            {accountStatementHref ? (
              <button
                type="button"
                onClick={() => navigate(accountStatementHref)}
                className="inline-flex items-center gap-2 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-2 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                Flows / 流水
                <ArrowRight size={11} />
              </button>
            ) : (
              <div className="font-mono text-[11px] text-adm-t3">
                No wallet reference on this case — deep link unavailable.
              </div>
            )}
          </DetailCard>

        </div>

        {/* ── Sidebar ── */}
        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* ACTIONS — 一键重新对账 / Re-reconcile (fires a fresh wallet run so a
              pushed-then-CLEARED funds order gets re-observed and this case closed). */}
          <SidebarGroup title="Actions">
            <button
              type="button"
              disabled={reconciling}
              onClick={handleReReconcile}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-adm-blue/40 bg-adm-blue/10 px-3 py-2 font-mono text-[12px] font-semibold text-adm-blue transition-colors hover:bg-adm-blue/20 disabled:opacity-50"
            >
              <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
              重新对账 / Re-reconcile
            </button>
          </SidebarGroup>

          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Case No" value={kase.caseNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={kase.status} />} />
            <SidebarKV label="Bucket" value={kase.bucket ? formatBucketBilingual(kase.bucket) : '—'} />
            <SidebarKV label="Δ" value={deltaZero ? formatAmount(kase.deltaAmount, kase.decimals) : `${sign}${formatAmount(kase.deltaAmount, kase.decimals).replace(/^-/, '')}`} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="SLA Deadline" value={kase.slaDeadline ? fmtTime(kase.slaDeadline) : '—'} mono />
            <SidebarKV label="Created" value={fmtTime(kase.createdAt)} mono />
            <SidebarKV label="Updated" value={fmtTime(kase.updatedAt)} mono />
          </SidebarGroup>
        </aside>
      </div>

      {/* Task 7: 开调账单弹层——挂在页面最外层而不是某一行内部，因为它是全页级的
          浮层（fixed inset-0），弹层内部状态与"点的是哪一行"无关，只靠 prefill 值区分。 */}
      {createPrefill && (
        <ReconciliationAdjustmentCreateModal
          open={!!createPrefill}
          caseNo={kase.caseNo}
          caseBusinessDate={kase.businessDate}
          book={adjustmentBook}
          assetCode={kase.assetCode}
          decimals={kase.decimals}
          ownerNo={kase.ownerNo}
          walletNo={kase.walletNo}
          prefill={createPrefill}
          locked={adjustLocked ?? undefined}
          onClose={() => { setCreatePrefill(null); setAdjustLocked(null); }}
          onCreated={handleAdjustmentCreated}
        />
      )}

      {/* T8：处置弹层——同样挂在页面最外层，内部状态只靠 row 区分。caseNo 取
          kase.caseNo（非路由参数 caseNo，后者类型是 string | undefined）。 */}
      <ReconciliationDispositionModal
        open={!!dispositionRow}
        caseNo={kase.caseNo}
        row={dispositionRow}
        caseStatus={kase.status}
        decimals={kase.decimals}
        onClose={() => setDispositionRow(null)}
        onRecorded={fetchCase}
        onProceedToAdjust={handleAdjustHandoff}
      />
    </div>
  );
};

export default ReconciliationCasesDetailPage;

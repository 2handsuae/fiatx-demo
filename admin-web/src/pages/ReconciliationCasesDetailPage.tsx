// admin-web/src/pages/ReconciliationCasesDetailPage.tsx
//
// T8 "Investigation cockpit" — read-only Case detail for the WALLET_V1 engine.
// English redesign (平账收尾·界面收口 Task 8, design/Main.dc.html): plain-English
// hero conclusion + slim badge row, no bilingual labels anywhere on the page.
//
// The cockpit answers the operator's two investigation questions:
//   1. "What broke for this wallet? (balance, flows, both?)"
//   2. "Which specific external/internal lines diverge?"
//
// Layout (top → bottom):
//   1. Nav header (back + refresh)
//   2. Hero — caseNo + bucket/severity/aging badges + StatusPill + one-line
//      plain-English conclusion (buildCaseConclusion, utils/caseConclusion.ts)
//   3. Account — wallet / customer (linked) / ledger account (COA phrase) /
//      asset·book / business date
//   4. Balance Explained — 5 tiles: Internal / External / Difference /
//      In-Transit / Unexplained (Unexplained is the core investigation signal)
//   5. Case History — 3 cells: Opened By / Last Re-Checked / Aging (re-observed
//      count is intentionally not rendered — known-zero counter, spec §3.3)
//   6. Differences — single mixed table sorted by severity (mismatch/orphan →
//      in-transit → matched, matched collapsed by default), six-state
//      disposition column (width 250px, no horizontal scroll at 1280px)
//   7. This Case's Adjustments — case-level adjustment list
//   8. Related Views — deep link to Ledger flows
//   9. Sidebar (actions + identity + lifecycle)
//
// Disposition workflow (Close / Waive / Assign) is deferred to Phase C — this
// page is investigation-only this release. Funds-order deep link (in-transit
// rows) is read-only this release too — no advance/sync/confirm actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight, ExternalLink, Plus, Clock, Zap, Copy, PenLine } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { BUCKET_LABELS, formatBucket, type ReconBucket } from '../utils/reconBucketMap';
// 平账二期：划转单状态人话——与列表 / 详情页同一份词表（Task 13）
import { INTERNAL_TRANSFER_STATUS_LABEL as TRANSFER_STATUS_WORD } from '../utils/internalTransferStatusMap';
import { buildCaseConclusion } from '../utils/caseConclusion';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { triggerWalletReconRun } from '../utils/reconRunTrigger';
import { useSimulationMode } from '../utils/simulationMode';
import ReconciliationAdjustmentCreateModal, {
  REASON_LABEL,
  type AdjustmentBook,
  type AdjustmentPrefill,
  type AdjustmentLocked,
} from '../components/ReconciliationAdjustmentCreateModal';
import ReconciliationSupplementModal from '../components/ReconciliationSupplementModal';
import ReconciliationHoldModal, {
  type DispositionRecordResult,
} from '../components/ReconciliationHoldModal';
import InternalTransferInitiateModal from '../components/InternalTransferInitiateModal';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { OUTLET_TONE, directionNoteFor, rowFacts } from '../utils/causeRegistry';
import { adminButtonClass } from '../components/common/adminButtonStyles';

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
  timestamp: string | null;
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

// Exported — T8 (平账一期半) 前端复用件（causeRegistry.ts / ReconciliationHoldModal.tsx）
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
    outlet: string; outletLabel: string;
    // 出口的可执行部分（后端 resolveOutlet 算好随行下发）——「开单」直接用，
    // 前端不反推；非 ADJUST 类出口不落分录，三个都没有值。
    family?: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
    reasonCode?: string; direction?: 'REDUCE' | 'INCREASE';
    findingNote: string;
    adjustmentNo: string | null; createdBy: string; createdAt: string;
    // 平账 B 批（Task 9）：SUPPLEMENT 出口专用——去向 / 转的补单号 / 补单业务域引用。
    deferredTarget?: 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN' | string | null;
    supplementNo?: string | null;
    supplementRef?: { kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null;
    // 平账三期（Task 9 写入，Task 12 消费）：出口 = INCIDENT 且已登记后回填的事故单号——
    // 未登记恒 null，前端按它渲染「登记事故」按钮 vs「事故 · INC…」徽标。
    incidentNo?: string | null;
  } | null;
  duplicateTwinRef?: string | null;
  // Task 5（读面翻转）取代旧的一格一份平铺成因菜单 `menu`（本任务起不再下发）：
  // 这一格（matchType × book）当下合法的处置清单，按处置分组，组内带该处置在这
  // 一格可选的成因——Task 7 差异行按钮组 + 挂起弹窗的唯一数据源。
  dispositions?: Array<{
    kind: string; label: string;
    causes: Array<{ code: string; label: string; clue: string }>;
  }>;
  // ⚡ 差异行级推荐（模拟开关门控）：唯一真相在后端 reconciliation-query.service.ts
  // ——已经校验过推荐真的在上面 dispositions 清单里，前端只管展示，不自己算。
  demoRecommended?: {
    scenarioId: number; causeCode: string; causeLabel: string;
    disposition: string; dispositionLabel: string;
  };
  // 平账 A 批（spec §2.6）：超期后的下一步（服务端判）
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'CLIENT_SURPLUS' | 'COMPENSATION' | 'ADVANCE';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; direction?: 'REDUCE' | 'INCREASE'; amount?: string; effectiveDate?: string;
    adjustmentNo?: string; externalLineId?: string; customerNo?: string | null; walletNo?: string | null; available?: string; lineAmount?: string;
  };
  // 平账二期：这条差异行牵出的划转单（补款 / 垫款）回挂
  transfer?: { transferNo: string; purpose: string; status: string } | null;
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
  slaBreached: boolean;
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
  // 平账三期（Task 9 写入，Task 12 消费）：本案已登记过的事故——全类型、按创建倒序。
  // 空数组 = 该案从未挂过事故；「升级事故」/「登记欠款」按钮据此判断是否已经登记过
  // （非撤回状态即算已登记，不再重复给按钮，改给徽标）。
  incidents?: Array<{ incidentNo: string; status: string; type: string }>;
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

// 平账三期（Task 12）：登记事故表单的「金额」字段要的是元（同 RegisterIncidentDto.amount
// 口径），不能带千分位逗号——复用 formatAmount 的换算，只是去掉分组符。
const minorToMajorPlain = (raw: string | null | undefined, decimals: number): string =>
  formatAmount(raw, decimals).replace(/,/g, '');

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
  // COMPENSATING 关不掉）。哪类行带哪个锚由行自身决定，这里不做筛选。
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

// Task 7（差异行按钮组）：记完一条定性 → 调账弹层锁定态所需的最小信息。取代旧的
// 两屏处置弹层（ReconciliationDispositionModal，已断线，Task 13 已删文件）导出的同形
// AdjustHandoff 类型——本页不再引用那个文件。
interface AdjustHandoff {
  dispositionNo: string;
  // Task 13：CORRECT/REVERSE/RECORD 三族已不经这个类型（Task 8 起改走 kind 模式，见
  // openAdjustKind）；本页唯一的 buildAdjustLocked 调用点只传 'REATTRIBUTE'，
  // 'WRITE_OFF' 走 openWriteOff 直接拼 AdjustmentLocked、不经这个类型（两个成员都留着
  // 是给 buildAdjustLocked 这个通用小函数的类型面，不是说它俩当下各有一处真调用）。
  family: 'REATTRIBUTE' | 'WRITE_OFF';
  reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE';
  directionNote: string;
  row: FlowComparisonRow;
}

// T9：处置结论 → 调账弹层的锁定态。改记族（REATTRIBUTE）额外拼一个候选查询路径——
// side 由行的 matchType 决定（ORPHAN_INTERNAL=我有外无=错记方=FROM，其余=正主方=TO，
// 与 disposition.service.ts listReattributionCandidates 的约定同源）；amount 用同一份
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
  MATCHED:         'Matched',
  IN_TRANSIT:      'In-transit',
  ORPHAN_INTERNAL: 'Internal only',
  ORPHAN_EXTERNAL: 'External only',
  AMOUNT_MISMATCH: 'Mismatch',
};

// Task 8（Account 节）：科目码 → 人话短语，缺映射不算错——原码原样显示，且始终把
// 原码放 title（既给了兜底文本，也给了可核对的原始值）。Task 15：导出给 Cases 列表页
// 复用（同一份映射，不重抄）。
export const COA_PHRASE: Record<string, string> = {
  'L.CLIENT_PAYABLE': 'Client payable',
  'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE': 'Client payable + Deposit suspense',
  'E.FIRM_OPS': 'Firm operating',
};

// Task 8（Differences 表 Reference 列）：外部单号截断 + 复制，治横滚的关键一环——原
// 组件展示完整 externalRef（部分是长链上哈希），是表格撑爆 1280 视口的主因之一。
const ShortRef = ({ value }: { value: string | null }) =>
  !value ? <span className="text-adm-t3">—</span> : (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-adm-t2" title={value}>
      {value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value}
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(value); }}
        className="shrink-0 text-adm-t3 hover:text-adm-blue"
      >
        <Copy size={11} />
      </button>
    </span>
  );

// Task 8（Differences 表 Source 列）：内部行链到对应订单详情。不复用
// approvalEntityRoutes.ts 的 ENTITY_ROUTE_BY_ACTION——那张表按审批 actionType 建键
// （如 DEPOSIT_CONFISCATION），键空间与账务 sourceType（DEPOSIT/WITHDRAWAL/…）不
// 重合；这里沿用它"能给详情页用详情页、不能给（deposit/withdraw 详情路由仍是内部
// id）用列表页 + 单号定位"的既有惯例，对 recon 场景会出现的 sourceType 逐条落地。
// Fix round：三个列表页此前都不读 `?keyword=`（全管理台无人读，死参数），改传各自
// 列表页真正认识的单号过滤参数——depositNo / withdrawNo / swapNo（见三张列表页
// FilterState 初始化处新增的 URL 参数读取，逐字仿写它们旁边既有的 ownerNo 写法）。
const SOURCE_TYPE_HREF: Record<string, (no: string) => string> = {
  DEPOSIT: (no) => `/admin/trading/deposits?depositNo=${encodeURIComponent(no)}`,
  WITHDRAWAL: (no) => `/admin/trading/withdrawals?withdrawNo=${encodeURIComponent(no)}`,
  SWAP: (no) => `/admin/trading/swaps?swapNo=${encodeURIComponent(no)}`,
  INTERNAL_TRANSFER: (no) => `/admin/treasury/internal-transfers/${encodeURIComponent(no)}`,
  RECON_ADJUSTMENT: (no) => `/admin/reconciliation/adjustments/${encodeURIComponent(no)}`,
};

// Task 8（Case History 卡）：三格用的紧凑时间戳——design/Main.dc.html 字面格式
// "Sep 6, 21:51"（24 小时制，无秒）。
const caseHistoryTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Fix round：hour12:false 在午夜仍会把 00:xx 显示成 24:xx（Chrome/V8 已知行为，
  // hour12:false 只关闭 AM/PM 后缀不改小时基数）——改用 hourCycle:'h23' 才是真正的
  // 0–23 小时制,午夜正确显示 00:30 而不是 24:30。
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

// 平账三期（Task 12）：案件页三入口共用——拼「登记事故」跳转的 query。铁律⑥：
// 只传业务键（案号/定性行号/客户号/资产代码/元口径金额）；钱包与账单行参考号在
// NewIncidentModal 里没有专用结构化字段，塞进 description 供人读、可编辑，不当
// 隐藏字段提交（walletRef 字段在后端要的是内部 UUID，本页不该替它拼一个出来）。
const buildIncidentHref = (params: Record<string, string | null | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return `/admin/governance/incidents?${qs.toString()}`;
};

// 已登记事故的徽标——三处出口（未授权转出 / 大额到线 / 退汇欠款）共用同一个样式，
// 点进去是事故详情页；outlet=INCIDENT 的红色调沿用 OUTLET_TONE.INCIDENT 的既有语义。
const IncidentBadge = ({ incidentNo }: { incidentNo: string }) => (
  <Link
    to={`/admin/governance/incidents/${encodeURIComponent(incidentNo)}`}
    className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-red/30 bg-adm-red/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-red hover:underline"
  >
    Incident · {incidentNo}
  </Link>
);

const MatchChip = ({ row }: { row: FlowComparisonRow }) => {
  const tone = MATCH_TONE[row.matchType];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
      {row.matchType === 'MATCHED' ? <Check size={10} /> : <AlertTriangle size={10} />}
      {MATCH_LABEL[row.matchType]}
    </span>
  );
};

// Task 8：Case History 三格卡，替换旧的一行式 ObservationBar——OPENED BY /
// LAST RE-CHECKED / AGING（design/Main.dc.html §3）。复观察次数（reObservedCount）
// 故意不渲染：该计数器现状恒为 0（T6 已知限制，见 CaseObservation 类型定义处的
// KNOWN LIMITATION 注释——delete-then-insert 的行项目没有跨轮身份），spec §3.3
// 业主拍板不展示，不是本任务该修的 bug。RESOLVED 案子的 resolutionReason 同样不
// 在三格里落地——设计给的字面模板只有 closedByRunNo+"closed"，没有它的位置。
const CaseHistoryCell = ({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string | null; tone?: 'neutral' | 'red' }) => (
  <div
    className={[
      'rounded-lg border p-4',
      tone === 'red' ? 'border-adm-red/30 bg-adm-red/5' : 'border-adm-border bg-adm-bg',
    ].join(' ')}
  >
    <div className={['font-mono text-[9px] uppercase tracking-wider', tone === 'red' ? 'text-adm-red' : 'text-adm-t3'].join(' ')}>
      {label}
    </div>
    <div className={['mt-1 font-mono text-[13px]', tone === 'red' ? 'font-bold text-adm-red' : 'text-adm-t1'].join(' ')}>
      {value}
    </div>
    {sub && <div className="mt-0.5 font-mono text-[10px] text-adm-t3">{sub}</div>}
  </div>
);

// agingReferenceMs — Minor #5（终审）冻结逻辑：结案后的超期天数在结案那一刻冻结，
// 不再跟着 Date.now() 涨；由外层（页面组件已算好）传入，AGING 格与 Hero 徽标共用
// 同一个数，避免两处各算一遍出现分歧。
const CaseHistory = ({ kase, agingReferenceMs }: { kase: ReconCaseDetail; agingReferenceMs: number }) => {
  const obs = kase.observation;
  const runOrDash = (v: string | null | undefined) => v ?? '—';
  if (!obs) {
    return <div className="font-mono text-[12px] text-adm-t3">No observation history available.</div>;
  }
  const isResolved = kase.status === 'RESOLVED';
  const isOverdue = !isResolved && kase.slaBreached && !!kase.slaDeadline;
  const overdueDays = isOverdue && kase.slaDeadline
    ? Math.max(1, Math.floor((agingReferenceMs - new Date(kase.slaDeadline).getTime()) / 86_400_000))
    : 0;
  const ageDaysFrozen = Math.max(0, Math.floor((agingReferenceMs - new Date(kase.createdAt).getTime()) / 86_400_000));
  const lastCheckedTime = isResolved ? caseHistoryTime(kase.resolvedAt) : caseHistoryTime(kase.updatedAt);
  const lastCheckedSuffix = isResolved ? 'closed' : 'still unmatched';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <CaseHistoryCell label="Opened By" value={runOrDash(obs.firstSeenRunNo)} sub={caseHistoryTime(obs.firstSeenAt)} />
      <CaseHistoryCell
        label="Last Re-Checked"
        value={isResolved ? runOrDash(obs.closedByRunNo) : runOrDash(obs.lastObservedRunNo)}
        sub={lastCheckedTime ? `${lastCheckedTime} · ${lastCheckedSuffix}` : lastCheckedSuffix}
      />
      {isOverdue ? (
        <CaseHistoryCell
          label="Aging"
          value={`Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`}
          sub={kase.slaDeadline ? `deadline was ${caseHistoryTime(kase.slaDeadline)}` : null}
          tone="red"
        />
      ) : (
        <CaseHistoryCell label="Aging" value={`day ${ageDaysFrozen} of 3-day SLA`} />
      )}
    </div>
  );
};

// Task 7（差异行按钮组）：CORRECT/REVERSE/RECORD/REATTRIBUTE/SUPPLEMENT/INCIDENT
// 六个非挂起处置共用的「选成因 + 查证说明」小弹层——取代旧两屏处置弹层
// （ReconciliationDispositionModal，已断线、读 row.menu 这个死字段，Task 13 已删文件）
// 的第一屏，数据源换成 row.dispositions（Task 5 读面）。不导出、不另开文件：
// 与 HOLD_NEXT_PERIOD/HOLD_INVESTIGATING 两个挂起 kind 用的
// ReconciliationHoldModal 结构相近但提交后的下一步完全不同（挂起是终态，这六个
// 都要接力到别处——调账弹层 / 补单弹层 / 事故登记），拆开两个组件比硬塞一个通用
// kind 联合类型更不容易读错。
interface DispositionFindingModalProps {
  open: boolean;
  caseNo: string;
  row: FlowComparisonRow | null;
  kind: string;
  label: string;
  onClose: () => void;
  onRecorded: (result: DispositionRecordResult, findingNote: string) => void;
}

const DispositionFindingModal = ({ open, caseNo, row, kind, label, onClose, onRecorded }: DispositionFindingModalProps) => {
  const [causeCode, setCauseCode] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // ⚡ 演示推荐徽标只在模拟模式下显示——与本页其它 ⚡ 件同一开关。
  const { enabled: simEnabled } = useSimulationMode();

  const causes = row?.dispositions?.find((d) => d.kind === kind)?.causes ?? [];

  useEffect(() => {
    if (!open) return;
    setCauseCode(causes.length === 1 ? causes[0].code : '');
    setOtherReason('');
    setNote('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, kind]);

  if (!open || !row) return null;
  const isOther = causeCode === 'OTHER';
  const canSubmit = !!causeCode && note.trim().length > 0 && (!isOther || otherReason.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const findingNote = isOther ? `Other: ${otherReason.trim()}\n${note.trim()}` : note.trim();
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/dispositions`,
        {
          method: 'POST',
          body: JSON.stringify({
            matchType: row.matchType,
            explainedFlowId: row.internalFlow?.id,
            explainedExternalLineId: row.externalLine?.id,
            causeCode,
            disposition: kind,
            findingNote,
            ...rowFacts(row),
          }),
        },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to record finding.'));
      }
      const result = (await res.json()) as DispositionRecordResult;
      onRecorded(result, findingNote);
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to record finding.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">{label} · What caused this difference?</h3>
        <p className="mb-3 font-mono text-[11px] text-adm-t3">{caseNo}</p>

        <div className="space-y-1.5">
          {causes.map((c) => (
            <label
              key={c.code}
              className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
                causeCode === c.code ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
              }`}
            >
              <input
                type="radio"
                name="finding-cause"
                checked={causeCode === c.code}
                onChange={() => setCauseCode(c.code)}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="text-adm-t1">{c.label}</span>
                {simEnabled && row?.demoRecommended?.causeCode === c.code && (
                  <span className="ml-2 rounded border border-adm-amber/30 bg-adm-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-adm-amber">⚡ Recommended</span>
                )}
                <div className="mt-0.5 text-[11px] text-adm-t3">Clue: {c.clue}</div>
              </span>
            </label>
          ))}
        </div>

        {isOther && (
          <div className="mt-3">
            <label className="mb-1 block text-[11px] text-adm-t3">Describe the cause (required for Other)</label>
            <textarea
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              rows={2}
              className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
            />
          </div>
        )}

        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-adm-t3">Finding note (required — describe what was checked and the basis for the conclusion)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
          />
        </div>

        {error && <p className="mt-2 text-xs text-adm-red">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || submitting}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationCasesDetailPage = () => {
  const { caseNo } = useParams<{ caseNo: string }>();
  const navigate = useNavigate();
  const { hasPermission, hasAnyPermission } = useAdminSession();
  const canCreateAdjustment = hasPermission(PERMISSIONS.RECON_ADJUSTMENT_CREATE);
  // T8（平账一期半）：动作列六态里「未定性」状态的处置按钮门控。
  const canRecordDisposition = hasPermission(PERMISSIONS.RECON_DISPOSITION_CREATE);
  // 平账 B 批（Task 9）：三路补单入口——持三个业务域写权限任一即可看到按钮
  // （对账域自己的候选只读端点门槛更低，不额外拿来门控整个按钮，同 canCreateAdjustment 的约定）。
  const canSupplement = hasAnyPermission([
    PERMISSIONS.DEPOSIT_SUPPLEMENT_WRITE,
    PERMISSIONS.DEPOSIT_CLAWBACK_WRITE,
    PERMISSIONS.WITHDRAW_RETURN_CLAIM_WRITE,
  ]);
  // 平账二期：补款 / 垫款发起归金库——持两个写码任一即可看到按钮；运营只看到指路文字。
  const canFundClient = hasAnyPermission([PERMISSIONS.INTERNAL_TRANSFER_COMPENSATION_WRITE, PERMISSIONS.INTERNAL_TRANSFER_ADVANCE_WRITE]);
  // 平账三期（Task 12）：案件页三入口共用——登记事故写权。
  const canRegisterIncident = hasPermission(PERMISSIONS.INCIDENT_WRITE);
  // Task 7 承接①：Re-reconcile 此前无权限门（OPS 点了 403）——与后端端点一致的门控。
  const canReReconcile = hasPermission(PERMISSIONS.RECON_RUN_WRITE);
  const [fundingRow, setFundingRow] = useState<FlowComparisonRow | null>(null);
  const [searchParams] = useSearchParams();
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
  // null 影响，锁定态只决定「能不能改」）。REATTRIBUTE/WRITE_OFF 两族用它。
  const [adjustLocked, setAdjustLocked] = useState<AdjustmentLocked | null>(null);
  // Task 8（调账四族一窗到底）：CORRECT/REVERSE/RECORD 三族的「按处置进入」态——
  // 点差异行按钮直接带 kind+row 开调账弹层，不再先记一遍定性（拆两段流，交接清单
  // ①）。与 createPrefill 成对开关，和 adjustLocked 互斥（一次只会有一个非 null）。
  const [adjustKind, setAdjustKind] = useState<{ kind: 'CORRECT' | 'REVERSE' | 'RECORD'; row: FlowComparisonRow } | null>(null);
  // Task 7（差异行按钮组）：REATTRIBUTE/SUPPLEMENT/INCIDENT 共用的「选成因 + 查证
  // 说明」小弹层——null = 关闭；非 null = 打开且带着被点击的那一行 + 那一个处置种类。
  // CORRECT/REVERSE/RECORD 从 Task 8 起不再经这一步（见 adjustKind），三族原子提交
  // 直连调账弹层。取代旧两屏处置弹层的入口（ReconciliationDispositionModal 已断线，
  // Task 13 已删文件）。
  const [findingPicker, setFindingPicker] = useState<{ row: FlowComparisonRow; kind: string; label: string } | null>(null);
  // Task 7：挂起两弹窗（Hold · Next period / Hold · Investigating）共用一个组件，按 kind 切。
  const [holdPicker, setHoldPicker] = useState<{ row: FlowComparisonRow; kind: 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' } | null>(null);
  // 平账 B 批（Task 9）：补单弹层——null = 关闭；非 null = 打开且带着被点击的那一行。
  const [supplementRow, setSupplementRow] = useState<FlowComparisonRow | null>(null);
  // 平账 A 批（spec §2.4）：⚡拨钟——只在模拟模式下出现；已超期 / 已结案就不再需要它。
  const { enabled: simEnabled } = useSimulationMode();
  // 评审修复（对账两角色收权，2026-09-10）：⚡ Fast-forward aging 此前只按
  // 模拟模式/状态显隐，不查权限码——合规/审计/高管/TECH/CFO 持 RECON_CASE_READ
  // 能进案件页，会看见幽灵按钮。补门控，同款见 Deposit/Swap/WithdrawTransactionDetail.tsx、
  // ApprovalDetailPage.tsx。
  const canSimulateAging = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);
  const [agingSubmitting, setAgingSubmitting] = useState(false);
  const [agingNotice, setAgingNotice] = useState('');

  const tableRef = useRef<HTMLTableElement | null>(null);

  // Task 7: 返回刚拉到的案件（不只是 setKase）——handleFindingRecorded 的
  // SUPPLEMENT 分支需要刷新后「这一行」的最新 disposition.dispositionNo 才能
  // 接着开补单弹层（该弹层认 row.disposition.dispositionNo，见 T9 既有约定），
  // React state 更新是异步的，闭包里的 kase 变量等不到；直接用返回值找那一行。
  const fetchCase = async (): Promise<ReconCaseDetail | null> => {
    if (!caseNo) return null;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as ReconCaseDetail;
        setKase(data);
        return data;
      }
      alert(await getApiErrorMessage(res, 'Failed to load reconciliation case'));
      navigate('/admin/reconciliation/cases');
      return null;
    } catch (error) {
      if (error instanceof AdminSessionError) return null;
      console.error('Failed to fetch reconciliation case', error);
      return null;
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

  const handleSimulateAging = async () => {
    if (!kase) return;
    setAgingSubmitting(true);
    setAgingNotice('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(kase.caseNo)}/simulate-aging-timeout`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setAgingNotice(await getApiErrorMessage(res, 'Failed to fast-forward aging.'));
        return;
      }
      setAgingNotice('Deadline moved to the past — next scan will breach it.');
      await fetchCase();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setAgingNotice('Failed to fast-forward aging.');
    } finally {
      setAgingSubmitting(false);
    }
  };

  // Task 7: 创建成功 → 已在弹层内部调过 submit → 跳调账单详情页（brief §Step3）。
  // 不停留在案件页刷新——详情页本身会展示新单的状态/成因/方向/分录预览。
  const handleAdjustmentCreated = (adjustmentNo: string) => {
    setCreatePrefill(null);
    setAdjustLocked(null);
    setAdjustKind(null); // Task 8：kind 模式也走这条收尾，成对清空
    navigate(`/admin/reconciliation/adjustments/${encodeURIComponent(adjustmentNo)}`);
  };

  // Task 8（调账四族一窗到底）：CORRECT/REVERSE/RECORD 三族点按钮直接开调账弹层的
  // kind 模式——不经 findingPicker/DispositionFindingModal，不预先 POST
  // /dispositions（拆两段流，交接清单①）。弹层一次提交走原子端点：body 里带
  // causeCode/findingNote/disposition + 行事实（modal 内部拼装，见
  // ReconciliationAdjustmentCreateModal.tsx submit()），后端 createDraft 先落定性、
  // 再开单、再挂号（Task 3 已建）。若这一行早已有未挂单的定性（旧数据/被取消的），
  // 后端沿用 heldDispositionNo 路径覆盖——前端无需特判（交接清单⑤）。
  const openAdjustKind = (row: FlowComparisonRow, kind: 'CORRECT' | 'REVERSE' | 'RECORD') => {
    setCreatePrefill(rowAdjustmentPrefill(row));
    setAdjustLocked(null);
    setAdjustKind({ kind, row });
  };

  // Task 7（差异行按钮组）：DispositionFindingModal 记完一条定性后交回——按 kind 分流：
  //   REATTRIBUTE → 开既有调账弹层，走锁定视图（改记族的 reasonCode 恒为
  //     CUSTOMER_REATTRIBUTION，不随成因变化，前端可直接给定，不需要后端回传）。
  //   SUPPLEMENT → 刷新案件后直接开既有补单弹层（ReconciliationSupplementModal，
  //     Task 9）——那个弹层认 row.disposition.dispositionNo，必须用刷新后的最新行
  //     （旧的 row 闭包变量此刻还没有这个号），按 explainedFlowId/explainedExternalLineId
  //     锚在新拉回的 flowComparison 里把它找回来。
  //   INCIDENT → 直接跳转事故登记（带上刚落库的 dispositionNo），不再要求二次点击。
  // CORRECT/REVERSE/RECORD 从 Task 8 起不再经这个函数——按钮 onClick 直接调
  // openAdjustKind（见下方渲染处），不再预记一遍定性。
  // 评审修复（Minor-2）：kind 在这里窄化成字面量联合，配底部的穷尽收口——
  // findingPicker.kind／DispositionFindingModalProps.kind 仍是 string 不变（同一处
  // 已有取舍，见上方组件注释「更不容易读错」，不在那处引入联合类型），只在这个
  // 函数的入参收口，调用处相应加一个 as 断言。
  type FindingKind = 'REATTRIBUTE' | 'SUPPLEMENT' | 'INCIDENT';
  const handleFindingRecorded = async (
    row: FlowComparisonRow,
    kind: FindingKind,
    result: DispositionRecordResult,
    findingNote: string,
  ) => {
    setFindingPicker(null);
    if (!kase) return;
    if (kind === 'REATTRIBUTE') {
      setCreatePrefill(rowAdjustmentPrefill(row));
      setAdjustLocked(buildAdjustLocked(
        { dispositionNo: result.dispositionNo, family: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION', direction: undefined, directionNote: directionNoteFor(row.matchType), row },
        kase.caseNo,
      ));
      // Task 8 交接④（Task 7 评审修复漏的兄弟缺口）：定性已经落库，锁定视图弹层已经
      // 同步打开——这里不 await，后台刷新 kase.flowComparison，行上的「Finding: ...」
      // 结论 chip 与解锁的 nextStep 才不会停在刷新前的旧快照（同 CORRECT/REVERSE/
      // RECORD 三族此前的既有修复同一处境，此前只补了那三族、漏了 REATTRIBUTE）。
      void fetchCase();
      return;
    }
    if (kind === 'SUPPLEMENT') {
      const fresh = await fetchCase();
      const freshRow = fresh?.flowComparison?.find((r) =>
        (row.internalFlow?.id && r.internalFlow?.id === row.internalFlow.id)
        || (row.externalLine?.id && r.externalLine?.id === row.externalLine.id));
      if (freshRow) setSupplementRow(freshRow);
      return;
    }
    if (kind === 'INCIDENT') {
      navigate(buildIncidentHref({
        type: 'UNAUTHORIZED_OUTFLOW',
        sourceCaseNo: kase.caseNo,
        sourceDispositionNo: result.dispositionNo,
        customerNo: kase.ownerNo,
        assetCode: kase.assetCode,
        amount: minorToMajorPlain(row.externalLine?.amount ?? row.internalFlow?.amount, kase.decimals),
        title: `Unauthorized outflow · case ${kase.caseNo}`,
        description: `Wallet ${kase.walletNo ?? '—'} shows an unauthorized outflow, statement line reference ${row.externalLine?.externalRef ?? '—'}, `
          + `amount ${minorToMajorPlain(row.externalLine?.amount ?? row.internalFlow?.amount, kase.decimals)} ${kase.assetCode}. `
          + `Finding: ${findingNote}`,
      }));
      return;
    }
    // 穷尽收口（评审 Minor-2，对齐后端 cause-registry.ts 的 _exhaustive: never 风格）：
    // 上面两支已经覆盖 FindingKind 全部 3 个值（Task 8 起 CORRECT/REVERSE/RECORD
    // 不再经这个函数，见 openAdjustKind）；新增第 4 个 kind 时这里编译期报红。
    const _exhaustive: never = kind;
    throw new Error(`Unknown finding kind: ${_exhaustive}`);
  };

  // 平账 A 批：核销——用读面算好的 nextStep 四项预填，锁定视图（成因固定、方向 / 金额 / 生效日只读）。
  // 平账处置改版 Task 10：source 判定 = 行上 disposition.incidentNo 是否非空——
  // 非空说明这一步的解锁走的是事故定损（读面 reconciliation-query.service.ts
  // 的事故判定块，见 :583），不是账龄超期（同一份判据前端不重算，只读行上已有
  // 的字段）。incidentNo/assessedDisplay 只在事故来源时给值，供锁定视图前提区
  // （M12）展示；账龄来源两个字段留空，锁定视图走既有四前提文案（M10/M11）。
  const openWriteOff = (row: FlowComparisonRow) => {
    if (!kase || !row.disposition || row.nextStep?.kind !== 'WRITE_OFF') return;
    const ns = row.nextStep;
    const incidentNo = row.disposition.incidentNo ?? undefined;
    setCreatePrefill({
      amountMinor: ns.amount ?? '0', direction: ns.direction ?? '', relatedOrderNo: '',
      explainedFlowId: row.internalFlow?.id, explainedExternalLineId: row.externalLine?.id,
    });
    setAdjustLocked({
      dispositionNo: row.disposition.dispositionNo,
      family: 'WRITE_OFF', reasonCode: ns.reasonCode, direction: ns.direction,
      directionNote: `Direction makes internal equal external — ${directionNoteFor(row.matchType)}`,
      writeOff: {
        findingNote: row.disposition.findingNote,
        source: incidentNo ? 'INCIDENT' : 'AGING',
        incidentNo,
        assessedDisplay: incidentNo ? `${formatAmount(ns.amount, kase.decimals)} ${kase.assetCode}` : undefined,
      },
    });
  };

  useEffect(() => {
    if (caseNo) void fetchCase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNo]);

  // 平账三期（Task 12）：事故页「发起补款」跳转带 ?adjustmentNo=——案子加载后自动
  // 定位到那一行（nextStep.kind==='COMPENSATION' 且认损单号匹配）并直接开弹层，
  // 不用再让人在表里手动找按钮（零新通道：复用的还是本页原有的补款弹层）。只在
  // 首次带参数进页时开一次——用 ref 挡住之后每次 fetchCase()（关别的弹层也会触发
  // 刷新）把用户刚手动关掉的弹层又弹回来。
  const autoOpenedFundingRef = useRef(false);
  useEffect(() => {
    if (!kase || autoOpenedFundingRef.current) return;
    const wantAdjustmentNo = searchParams.get('adjustmentNo');
    if (!wantAdjustmentNo) return;
    autoOpenedFundingRef.current = true;
    const row = kase.flowComparison?.find((r) => r.nextStep?.kind === 'COMPENSATION' && r.nextStep.adjustmentNo === wantAdjustmentNo);
    if (row) setFundingRow(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kase]);

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
  // Task 8：Differences 卡标题用的"open rows"计数——恒等于非 MATCHED 行数，不随
  // showMatched 切换变化（切开显示已匹配行不该让标题的"open"字样失真）。
  const openRowsCount = kase?.flowComparison?.filter((r) => r.matchType !== 'MATCHED').length ?? 0;

  // 平账二期：行上的划转回挂 + 补款 / 垫款按钮。案子 RESOLVED 之后照样给（认损让案子愈了，补款是对客户的交代）。
  const renderFunding = (row: FlowComparisonRow) => (
    <>
      {row.transfer && (
        <span className="max-w-[220px] font-mono text-[10px] text-adm-t2">
          {row.transfer.purpose === 'CLIENT_ADVANCE' ? 'Advance' : 'Compensation'}{' '}
          <Link to={`/admin/treasury/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`} className="text-adm-blue hover:underline">{row.transfer.transferNo}</Link>
          {' · '}{TRANSFER_STATUS_WORD[row.transfer.status] ?? row.transfer.status}
        </span>
      )}
      {(row.nextStep?.kind === 'COMPENSATION' || row.nextStep?.kind === 'ADVANCE') && kase && (
        canFundClient ? (
          <button type="button" onClick={() => setFundingRow(row)} className="inline-flex max-w-[220px] items-start gap-1 font-mono text-[10px] font-medium text-adm-blue hover:underline">
            <Plus size={10} />
            {row.nextStep.kind === 'COMPENSATION'
              ? `Initiate compensation ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode}`
              : `Insufficient balance ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode} — Initiate advance`}
          </button>
        ) : (
          <span className="max-w-[220px] font-mono text-[10px] text-adm-amber">
            {row.nextStep.kind === 'COMPENSATION' ? 'Pending compensation (initiated by treasury)' : `Insufficient balance ${formatAmount(row.nextStep.amount, kase.decimals)} — pending treasury advance`}
          </span>
        )
      )}
      {/* Recon phase 3 (Task 12): B batch deposit-recall claim insufficient
          balance (ADVANCE) — add "Register shortfall" next to the advance button,
          prefilled with CLIENT_SHORTFALL/customer/shortfall amount/advance
          transfer no (only when row.transfer is already a CLIENT_ADVANCE
          transfer). Once registered it becomes a badge, not a second entry
          point — the dedup check keys on kase.incidents (case-level, by
          sourceCaseNo), so the case no MUST be included here or the dedup
          check can never find it and the button never converges. */}
      {row.nextStep?.kind === 'ADVANCE' && kase && (
        existingClientShortfall ? (
          <IncidentBadge incidentNo={existingClientShortfall.incidentNo} />
        ) : canRegisterIncident ? (
          <button
            type="button"
            onClick={() => navigate(buildIncidentHref({
              type: 'CLIENT_SHORTFALL',
              sourceCaseNo: kase.caseNo,
              customerNo: row.nextStep!.customerNo,
              assetCode: kase.assetCode,
              amount: minorToMajorPlain(row.nextStep!.amount, kase.decimals),
              sourceAdvanceTransferNo: row.transfer?.purpose === 'CLIENT_ADVANCE' ? row.transfer.transferNo : undefined,
              title: `Deposit-recall shortfall · customer ${row.nextStep!.customerNo ?? '—'}`,
              description: `After the deposit-recall claim, customer wallet ${row.nextStep!.walletNo ?? '—'} has insufficient balance. `
                + `The firm advances the shortfall of ${minorToMajorPlain(row.nextStep!.amount, kase.decimals)} ${kase.assetCode} first; register the shortfall for later recovery.`,
            }))}
            className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
          >
            <Plus size={10} />
            Register shortfall
          </button>
        ) : null
      )}
    </>
  );

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

  // Minor #5（终审）：结案后的超期天数要在结案那一刻冻结，不能继续跟着 Date.now() 涨。
  const agingReferenceMs = kase.status === 'RESOLVED' && kase.resolvedAt ? new Date(kase.resolvedAt).getTime() : Date.now();

  // Task 8（Hero 结论句）：残差已被哪些落账调账单解释掉的金额合计——只数
  // explainedByAdjustmentNo 非空的行，金额用与「开单」预填同一份 rowAdjustmentPrefill
  // 算出的 amountMinor（mismatch 取差额、orphan 取该行本身金额），避免结论句这里
  // 另算一套出现分歧。整数最小单位字符串求和用 BigInt——金额不含小数点，安全。
  const explainedSumMinor = (kase.flowComparison ?? [])
    .filter((r) => r.explainedByAdjustmentNo)
    .reduce((sum, r) => sum + BigInt(rowAdjustmentPrefill(r).amountMinor || '0'), 0n)
    .toString();

  // 平账三期（Task 12）：「升级事故」/「登记欠款」按钮的防重复入口——案子已经登记过
  // 同类型事故（任何非撤回状态）就不再给按钮，改显示徽标（后端 §2 不查重，前端
  // 入口收敛是唯一防线，这是设计决定不是防御校验）。
  const existingLargeUnexplained = kase.incidents?.find((i) => i.type === 'LARGE_UNEXPLAINED' && i.status !== 'WITHDRAWN');
  const existingClientShortfall = kase.incidents?.find((i) => i.type === 'CLIENT_SHORTFALL' && i.status !== 'WITHDRAWN');

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
                  {formatBucket(kase.bucket)}
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
              {/* OPEN gate aligns this badge with CaseHistory's isOverdue
                  (!isResolved && slaBreached && !!slaDeadline) — slaBreached is
                  never cleared after RESOLVED, so without the gate the red
                  OVERDUE badge and the neutral "day N" tile contradict. */}
              {kase.status === 'OPEN' && kase.slaBreached && kase.slaDeadline && (
                <span className="inline-flex items-center gap-1 rounded border border-adm-red/30 bg-adm-red/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-red">
                  <Clock size={10} />
                  OVERDUE {Math.max(1, Math.floor((agingReferenceMs - new Date(kase.slaDeadline).getTime()) / 86_400_000))}D
                </span>
              )}
              <StatusPill value={kase.status} size="md" />
            </div>
            {(() => {
              const c = buildCaseConclusion(
                { ...kase, bucket: kase.bucket ?? null, explainedSum: explainedSumMinor },
                (v) => formatAmount(v, kase.decimals),
              );
              if (!c) return null;
              const toneCls =
                c.tone === 'red' ? 'text-adm-red'
                : c.tone === 'blue' ? 'text-adm-blue'
                : c.tone === 'amber' ? 'text-adm-amber'
                : 'text-adm-t2';
              return <div className={`mt-2 font-mono text-[12px] ${toneCls}`}>{c.text}</div>;
            })()}
          </section>

          {/* 2. Account — whose wallet this is (own section, generous spacing,
              design/Main.dc.html §1b). Customer links to the customer detail
              page (business key, no UUID — project rule #6); Ledger Account
              uses COA_PHRASE's human phrase with the raw code always in title. */}
          <DetailCard title="Account" columns={1}>
            <div className="grid grid-cols-2 gap-4 font-mono text-[12px] sm:grid-cols-5">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-adm-t3">Wallet</div>
                <div className="mt-1 text-adm-t1">{kase.walletNo ?? (kase.walletRef ? kase.walletRef.slice(0, 12) : '—')}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-adm-t3">Customer</div>
                <div className="mt-1">
                  {kase.ownerNo ? (
                    <Link to={`/admin/customers/${encodeURIComponent(kase.ownerNo)}`} className="text-adm-blue hover:underline">{kase.ownerNo}</Link>
                  ) : <span className="text-adm-t1">—</span>}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-adm-t3">Ledger Account</div>
                <div className="mt-1 text-adm-t1" title={kase.coaCode ?? undefined}>
                  {kase.coaCode ? (COA_PHRASE[kase.coaCode] ?? kase.coaCode) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-adm-t3">Asset</div>
                <div className="mt-1 text-adm-t1">
                  {/* kase.book's real stored literal is 'FIRM' | 'CUSTOMER' (not
                      'CLIENT' — same underlying concept as this page's
                      adjustmentBook normalization above, different word;
                      verified against the live DB). null (legacy non-wallet
                      case) gets no suffix at all. */}
                  {kase.assetCode}{kase.book === 'FIRM' ? ' · Firm book' : kase.book ? ' · Client book' : ''}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-adm-t3">Business Date</div>
                <div className="mt-1 text-adm-t1">{kase.businessDate}</div>
              </div>
            </div>
          </DetailCard>

          {/* 3. Balance Explained — five tiles. Replaces the old 3-cell
              Balance Comparison card (Internal/External/Δ were a subset of
              this same story) so there's a single balance-explanation surface,
              not two overlapping ones. Unexplained (residual) is the core
              investigation signal — zero means the delta is fully explained by
              in-transit funds orders; non-zero is what still needs digging. */}
          <DetailCard title={`Balance Explained (${kase.assetCode})`} columns={1}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {/* Internal */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Internal
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
                  External
                </div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-t1">
                  {formatAmount(kase.explain?.externalClosing ?? kase.actualExternal, kase.decimals)}
                </div>
              </div>
              {/* Difference (Δ) — muted green/check when balanced, bold red with sign when not. */}
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
                  Difference
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
              {/* In-Transit explained — blue, the portion of Δ covered by
                  non-terminal funds orders. */}
              <div className="rounded-lg border border-adm-blue/30 bg-adm-blue/5 p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-blue">
                  In-Transit
                </div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-tight text-adm-blue">
                  {kase.explain ? formatAmount(kase.explain.inTransitSigned, kase.decimals) : '—'}
                </div>
              </div>
              {/* Unexplained (residual) — the core investigation signal. Red
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
                  Unexplained
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
                    ? <><Check size={10} /> explained</>
                    : <><AlertTriangle size={10} /> needs investigation</>}
                </div>
              </div>
            </div>
          </DetailCard>

          {/* 4. Case History — Opened By / Last Re-Checked / Aging
              (design/Main.dc.html §3; replaces the old one-line ObservationBar). */}
          <DetailCard title="Case History" columns={1}>
            <CaseHistory kase={kase} agingReferenceMs={agingReferenceMs} />
          </DetailCard>

          {/* 5. Differences (renamed from the old Flow Drilldown card, Task 8) —
              single mixed table, no grouped sections: orphans/mismatches sort
              first, then in-transit, then MATCHED collapsed behind a toggle
              below. Disposition column pinned to 250px + Reference truncated
              via ShortRef — the two changes that cure horizontal scroll at
              1280px (long externalRefs were the main overflow cause). Title
              count is the "open" (non-MATCHED) count, independent of the
              showMatched toggle — matches design/Main.dc.html §4 wording. */}
          <DetailCard
            title={`Differences · ${openRowsCount} open row${openRowsCount === 1 ? '' : 's'}`}
            columns={1}
          >
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table ref={tableRef} className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Type
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Dir
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Amount
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Reference
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Source
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Time
                    </th>
                    <th className="w-[250px] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Disposition
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
                          {/* Reference — truncated + copy (ShortRef); the main
                              lever that cures horizontal scroll (raw refs can
                              be long on-chain hashes). */}
                          <td className="px-3 py-3">
                            <ShortRef value={ext?.externalRef ?? null} />
                          </td>
                          {/* Source — IN_TRANSIT links to the funds order. When
                              that funds order is already CLEARED but this case
                              is still OPEN, badge "Pushed · re-reconcile": a
                              rerun will close the case (Re-reconcile action in
                              the sidebar). Other rows show the internal
                              business number (DEP/WD/SWP/…) linked via
                              SOURCE_TYPE_HREF, eventCode moved to title; a
                              sourceType with no route mapping falls back to
                              plain text. External-only orphan rows have no
                              internal side → em dash. */}
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
                                    <Check size={9} /> Pushed · re-reconcile
                                  </span>
                                )}
                              </span>
                            ) : intl ? (
                              SOURCE_TYPE_HREF[intl.sourceType] ? (
                                <Link to={SOURCE_TYPE_HREF[intl.sourceType](intl.sourceNo)} title={intl.eventCode} className="text-adm-blue hover:underline">
                                  {intl.sourceNo}
                                </Link>
                              ) : (
                                <span title={intl.eventCode}>{intl.sourceNo}</span>
                              )
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Time */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t3">
                            {timestamp ? shortTimestamp(timestamp) : '—'}
                          </td>
                          {/* Recon phase 1.5 (spec §3.1): six-state action column.
                              Same shape, same button — giving different buttons
                              would pretend the machine knows something it
                              doesn't; the differentiation happens once a human
                              picks a cause in the disposition modal. */}
                          <td className="px-3 py-3">
                            {row.explainedByAdjustmentNo ? (
                              // ① 已解释——这条差异已经被一张落了账的调账单解释掉，
                              // 引擎算桶时已把它从异常数里摘掉，改为指回那张单。
                              <div className="flex flex-col gap-1">
                                <Link
                                  to={`/admin/reconciliation/adjustments/${encodeURIComponent(row.explainedByAdjustmentNo)}`}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-green hover:underline"
                                >
                                  <Check size={10} />
                                  Explained · {row.explainedByAdjustmentNo}
                                </Link>
                                {renderFunding(row)}
                              </div>
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
                                  Push order →
                                </Link>
                              ) : (
                                <span className="text-[10px] text-adm-t3">In-transit · no funds order</span>
                              )
                            ) : (
                              // ④/⑤/⑥ 统一渲染（Task 7 差异行按钮组，取代旧的「已定性 vs
                              // 未定性」两分支）：结论 chip（如有）+ 处置按钮组（未锁定时）。
                              // 覆盖/重定语义——挂起是临时状态：已定性也照样给全套按钮，
                              // 再点一次就是换一个结论（承接④）。锁定 = 行上已经挂着一张
                              // 走不掉的单（调账单 / 补单）——那条单号本身就是唯一出口，
                              // 不该再给别的按钮制造「两条并行结论」的假象；未挂单（含
                              // 从未定性）都不锁。按钮词 = 后端下发的 label（row.dispositions，
                              // Task 5 读面），不前端另编。
                              <div className="flex flex-col gap-1.5">
                                {row.disposition && (
                                  <span
                                    title={row.disposition.findingNote}
                                    className={[
                                      // 与设计稿同款 max-width 换行（design/Main.dc.html §4
                                      // Row B 该徽标就带 max-width: 230px）——不用 nowrap，
                                      // 否则长成因/长操作者名会把 250px 定宽的 Disposition
                                      // 列撑宽，Differences 表就横滚了（治横滚是本任务判据）。
                                      'inline-flex max-w-[220px] items-start gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-snug',
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].border,
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].bg,
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].text,
                                    ].join(' ')}
                                  >
                                    Finding: {row.disposition.causeLabel} → {row.disposition.outletLabel} · {row.disposition.createdBy} {row.disposition.createdAt.slice(5, 10)}
                                  </span>
                                )}

                                {!(row.disposition?.adjustmentNo || row.disposition?.supplementNo)
                                  && kase.status === 'OPEN' && canRecordDisposition && (row.dispositions?.length ?? 0) > 0 && (
                                  <>
                                    {/* ⚡ 差异行级推荐（本任务）：仅模拟开关开启时展示——关掉模拟
                                        开关即消失，与列表页气泡同一开关（useSimulationMode）。 */}
                                    {simEnabled && row.demoRecommended && (
                                      <div className="font-mono text-[10px] font-medium text-adm-amber">
                                        ⚡ #{row.demoRecommended.scenarioId} Recommended: {row.demoRecommended.dispositionLabel} — {row.demoRecommended.causeLabel}
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                      {row.dispositions!.map((d) => {
                                        const isHold = d.kind === 'HOLD_NEXT_PERIOD' || d.kind === 'HOLD_INVESTIGATING';
                                        // 每个处置种类跟进动作各自的写权限——按钮组本身已被
                                        // canRecordDisposition 整体门控，这里只筛后续动作走
                                        // 不通的那几种（同既有 canCreateAdjustment/canSupplement/
                                        // canRegisterIncident 三个变量的既有约定，不新开权限口径）。
                                        const allowed = d.kind === 'SUPPLEMENT' ? canSupplement
                                          : d.kind === 'INCIDENT' ? canRegisterIncident
                                          : isHold ? true
                                          : canCreateAdjustment; // CORRECT/REVERSE/RECORD/REATTRIBUTE
                                        if (!allowed) return null;
                                        const tone: 'amber' | 'red' | 'blue' = d.kind === 'INCIDENT' ? 'red' : isHold || d.kind === 'SUPPLEMENT' ? 'amber' : 'blue';
                                        // ⚡ 推荐的那颗处置按钮加轻量高亮——非推荐按钮不动。
                                        const isRecommended = simEnabled && row.demoRecommended?.disposition === d.kind;
                                        return (
                                          <button
                                            key={d.kind}
                                            type="button"
                                            onClick={() => {
                                              if (isHold) setHoldPicker({ row, kind: d.kind as 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' });
                                              // Task 8：CORRECT/REVERSE/RECORD 三族原子一窗——直接开调账
                                              // 弹层的 kind 模式，不再先记一遍定性（拆两段流）。
                                              else if (d.kind === 'CORRECT' || d.kind === 'REVERSE' || d.kind === 'RECORD') openAdjustKind(row, d.kind);
                                              else setFindingPicker({ row, kind: d.kind, label: d.label });
                                            }}
                                            className={[
                                              'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                              TONE_CLASSES[tone].border, TONE_CLASSES[tone].bg, TONE_CLASSES[tone].text,
                                              isRecommended ? 'ring-1 ring-adm-amber ring-offset-1 ring-offset-adm-panel' : '',
                                            ].join(' ')}
                                          >
                                            <PenLine size={9} />
                                            {d.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}

                                {row.disposition?.outlet === 'SUPPLEMENT' && row.disposition.supplementNo && (
                                  <span className="max-w-[220px] font-mono text-[10px] text-adm-t2">
                                    Transferred ·{' '}
                                    {row.disposition.supplementRef?.kind === 'DEPOSIT' && row.disposition.supplementRef.id
                                      ? <Link to={`/admin/trading/deposits/${row.disposition.supplementRef.no}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
                                      : row.disposition.supplementRef?.kind === 'WITHDRAW' && row.disposition.supplementRef.id
                                        ? <Link to={`/admin/trading/withdrawals/${row.disposition.supplementRef.no}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
                                        : <span>{row.disposition.supplementNo} (Pending CFO review)</span>}
                                  </span>
                                )}

                                {/* Recon phase 3 (Task 12): outlet = INCIDENT
                                    (unauthorized outflow), already registered — badge
                                    to the incident detail. incidentNo does NOT lock the
                                    row (承接④：only adjustmentNo/supplementNo do), so this
                                    renders alongside the button group, not instead of it. */}
                                {row.disposition?.outlet === 'INCIDENT' && row.disposition.incidentNo && (
                                  <IncidentBadge incidentNo={row.disposition.incidentNo} />
                                )}

                                {row.nextStep?.kind === 'WRITE_OFF' && kase.status === 'OPEN' && (
                                  canCreateAdjustment ? (
                                    <button
                                      type="button"
                                      onClick={() => openWriteOff(row)}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
                                    >
                                      <Plus size={10} />
                                      {row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Recognize loss' : 'Write off'}
                                    </button>
                                  ) : (
                                    // 行挂了事故号（事故已定损公司承损）不是「超期」——那句话在这里是撒谎。
                                    // C1 挂接链评审修复：判据从单看 outlet==='INCIDENT' 改成看 incidentNo——
                                    // 大额升级路的定性行 outlet 一直留在 HOLD_INVESTIGATING，只有 incidentNo
                                    // 会被 attachIncident 写上，纯 outlet 判据永远照不到那条路。
                                    <span className="max-w-[220px] font-mono text-[10px] text-adm-red">
                                      {row.disposition?.incidentNo
                                        // 终审修复批 Item 6：事故已定损（公司簿也有事故升级路，见
                                        // adjustment.service.ts assertIncidentWriteOffAllowed）不代表
                                        // 一定是"认损"——公司池事故定损后走的是核销，「eligible to
                                        // recognize loss」是客户簿专属措辞，公司簿讲"认损"文不对题。
                                        ? (row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Incident assessed · eligible to recognize loss' : 'Incident assessed · eligible to write off')
                                        : (row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Overdue · eligible to recognize loss' : 'Overdue · eligible to write off')}
                                    </span>
                                  )
                                )}
                                {row.nextStep?.kind === 'INCIDENT_DEFERRED' && (
                                  existingLargeUnexplained ? (
                                    <IncidentBadge incidentNo={existingLargeUnexplained.incidentNo} />
                                  ) : canRegisterIncident ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(buildIncidentHref({
                                        type: 'LARGE_UNEXPLAINED',
                                        sourceCaseNo: kase.caseNo,
                                        // C1 挂接链评审修复：不带这个号，后端 attachIncident 的唯一
                                        // 调用点（前提是 dto.sourceDispositionNo 存在）永远不会触发——
                                        // 事故定了损也回写不到这行上。该按钮出现的前提本就是行已定性
                                        // 挂起·调查中（INCIDENT_DEFERRED），disposition 必在。
                                        sourceDispositionNo: row.disposition!.dispositionNo,
                                        customerNo: kase.ownerNo,
                                        assetCode: kase.assetCode,
                                        amount: minorToMajorPlain(row.nextStep!.amount, kase.decimals),
                                        title: `Large unexplained · case ${kase.caseNo}`,
                                        description: `Wallet ${kase.walletNo ?? '—'}'s difference is overdue and its cause could not be determined. Amount ${minorToMajorPlain(row.nextStep!.amount, kase.decimals)} ${kase.assetCode} `
                                          + `exceeds the small-amount threshold — escalating to an incident. Finding: ${row.disposition!.findingNote}`,
                                      }))}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
                                    >
                                      <Plus size={10} />
                                      Escalate to incident
                                    </button>
                                  ) : (
                                    <span className="max-w-[220px] font-mono text-[10px] text-adm-red">Overdue · pending escalation to incident</span>
                                  )
                                )}
                                {row.nextStep?.kind === 'CLIENT_SURPLUS' && (
                                  <span className="max-w-[220px] font-mono text-[10px] text-adm-amber">Overdue · surplus pending attribution, route via supplement</span>
                                )}
                                {renderFunding(row)}
                              </div>
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
                {showMatched ? `Hide ${matchedCount} matched rows` : `Show ${matchedCount} matched rows`}
              </button>
            )}
          </DetailCard>

          {/* This Case's Adjustments (Task 7 controller ruling) — case-level
              list so operations can see at a glance which adjustments have
              already been opened for this case; that's how duplicate-adjustment
              prevention is achieved (not by graying out the whole difference
              row — flowComparison row ids and ReconciliationLineItem.id are not
              the same table, so that's not possible). Click the number to go to
              the adjustment detail page. */}
          <DetailCard
            title={`This Case's Adjustments · ${kase.adjustments?.length ?? 0}`}
            columns={1}
          >
            {!kase.adjustments || kase.adjustments.length === 0 ? (
              <div className="py-4 text-center font-mono text-[11px] text-adm-t3">
                No adjustments opened yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Adjustment No
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Status
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Reason
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Dir
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Amount
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
                          {REASON_LABEL[adj.reasonCode] ?? adj.reasonCode}
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
                Ledger flows
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
          {/* ACTIONS — Re-reconcile (fires a fresh wallet run so a
              pushed-then-CLEARED funds order gets re-observed and this case closed). */}
          <SidebarGroup title="Actions">
            {canReReconcile && (
              <button
                type="button"
                disabled={reconciling}
                onClick={handleReReconcile}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-adm-blue/40 bg-adm-blue/10 px-3 py-2 font-mono text-[12px] font-semibold text-adm-blue transition-colors hover:bg-adm-blue/20 disabled:opacity-50"
              >
                <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
                Re-reconcile
              </button>
            )}
            {simEnabled && canSimulateAging && kase.status === 'OPEN' && kase.slaDeadline && !kase.slaBreached && (
              <button
                type="button"
                disabled={agingSubmitting}
                onClick={() => void handleSimulateAging()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-adm-amber/40 bg-adm-amber/10 px-3 py-2 font-mono text-[12px] font-semibold text-adm-amber transition-colors hover:bg-adm-amber/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Zap size={12} />
                Fast-forward aging
              </button>
            )}
            {agingNotice && <p className="mt-2 font-mono text-[10px] text-adm-t3">{agingNotice}</p>}
          </SidebarGroup>

          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Case No" value={kase.caseNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={kase.status} />} />
            <SidebarKV label="Bucket" value={kase.bucket ? formatBucket(kase.bucket) : '—'} />
            <SidebarKV label="Δ" value={deltaZero ? formatAmount(kase.deltaAmount, kase.decimals) : `${sign}${formatAmount(kase.deltaAmount, kase.decimals).replace(/^-/, '')}`} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="SLA Deadline" value={kase.slaDeadline ? fmtTime(kase.slaDeadline) : '—'} mono />
            <SidebarKV label="Created" value={fmtTime(kase.createdAt)} mono />
            <SidebarKV label="Updated" value={fmtTime(kase.updatedAt)} mono />
          </SidebarGroup>
        </aside>
      </div>

      {/* Task 7: the create-adjustment modal is mounted at the page's outer
          level rather than inside any one row, because it's a page-level
          overlay (fixed inset-0) — its internal state doesn't care which row
          was clicked, only the prefill value. */}
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
          kind={adjustKind?.kind}
          row={adjustKind?.row}
          onClose={() => { setCreatePrefill(null); setAdjustLocked(null); setAdjustKind(null); }}
          onCreated={handleAdjustmentCreated}
        />
      )}

      {/* Task 7: 挂起两弹窗（一个组件按 kind 切），页面外层挂载，内部状态只认 row。 */}
      <ReconciliationHoldModal
        open={!!holdPicker}
        caseNo={kase.caseNo}
        row={holdPicker?.row ?? null}
        kind={holdPicker?.kind ?? 'HOLD_NEXT_PERIOD'}
        onClose={() => setHoldPicker(null)}
        onDone={() => { setHoldPicker(null); void fetchCase(); }}
      />

      {/* Task 7: 六个非挂起处置（CORRECT/REVERSE/RECORD/REATTRIBUTE/SUPPLEMENT/
          INCIDENT）共用的「选成因 + 查证说明」小弹层——取代旧两屏处置弹层的入口。 */}
      <DispositionFindingModal
        open={!!findingPicker}
        caseNo={kase.caseNo}
        row={findingPicker?.row ?? null}
        kind={findingPicker?.kind ?? ''}
        label={findingPicker?.label ?? ''}
        onClose={() => setFindingPicker(null)}
        onRecorded={(result, findingNote) => {
          if (findingPicker) void handleFindingRecorded(findingPicker.row, findingPicker.kind as FindingKind, result, findingNote);
        }}
      />

      {/* Recon batch B (Task 9): the supplement modal is likewise mounted at
          the page's outer level, its internal state keyed only by row. */}
      <ReconciliationSupplementModal
        open={!!supplementRow}
        caseNo={kase.caseNo}
        row={supplementRow}
        onClose={() => setSupplementRow(null)}
        onDone={() => { setSupplementRow(null); fetchCase(); }}
      />

      {/* Recon phase 2 (Task 12): compensation/advance initiation modal — one
          modal, two paths, split by row.nextStep.kind. */}
      <InternalTransferInitiateModal
        open={!!fundingRow} caseNo={kase.caseNo} row={fundingRow} assetCode={kase.assetCode} decimals={kase.decimals}
        onClose={() => setFundingRow(null)}
        onDone={() => { setFundingRow(null); void fetchCase(); }}
      />
    </div>
  );
};

export default ReconciliationCasesDetailPage;

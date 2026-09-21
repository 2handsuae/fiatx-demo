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
import { RefreshCw, Check, AlertTriangle, ArrowRight, ExternalLink, Clock, Zap } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { BUCKET_LABELS, formatBucket, TONE_CLASSES } from '../utils/reconBucketMap';
import type { FlowMatchType, FlowComparisonRow, ReconCaseDetail } from '../utils/reconTypes';
import { formatAmount, minorToMajorPlain, isZeroAmount } from '../utils/reconAmount';
import { buildCaseConclusion } from '../utils/caseConclusion';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { triggerWalletReconRun } from '../utils/reconRunTrigger';
import { useSimulationMode } from '../utils/simulationMode';
import ReconciliationAdjustmentCreateModal, {
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
import { directionNoteFor, COA_PHRASE } from '../utils/causeRegistry';
import { DispositionFindingModal } from '../components/reconciliation/DispositionFindingModal';
import { CaseHistory } from '../components/reconciliation/CaseHistory';
import { CaseBalanceTiles } from '../components/reconciliation/CaseBalanceTiles';
import { CaseFlowTable } from '../components/reconciliation/CaseFlowTable';
import { buildIncidentHref } from '../components/reconciliation/caseDetailBits';

/* ── Constants & helpers ────────────────────────────────────── */

const deltaSign = (raw: string | null | undefined): '+' | '-' | '' => {
  if (raw == null) return '';
  if (isZeroAmount(raw)) return '';
  return String(raw).startsWith('-') ? '-' : '+';
};

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

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

// 波四：预填交接（非判断）——金额/方向由行上 adjustmentPrefill 判死（后端
// cause-registry.resolveAdjustmentPrefill 单一来源），这里只补两个解释锚。
// ④ 两个解释锚一律按行原样带上——它们是这条差异的真实证据 id，后端据此在下一轮
// 对账里把这条差异从异常数里摘掉。案件级入口开单时两个都空：纯补余额，不摘差异行。
const prefillFromRow = (row: FlowComparisonRow, ap: NonNullable<FlowComparisonRow['adjustmentPrefill']>): AdjustmentPrefill => ({
  amountMinor: ap.amountMinor,
  relatedOrderNo: '',
  explainedFlowId: row.internalFlow?.id,
  explainedExternalLineId: row.externalLine?.id,
});

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

// side/金额读行上 adjustmentPrefill——与查候选、开单同一个数，单一来源在后端。
const buildAdjustLocked = (handoff: AdjustHandoff, currentCaseNo: string): AdjustmentLocked => {
  const ap = handoff.row.adjustmentPrefill;
  return {
    dispositionNo: handoff.dispositionNo,
    family: handoff.family,
    reasonCode: handoff.reasonCode,
    direction: handoff.direction,
    directionNote: handoff.directionNote,
    toCandidatesUrl: handoff.family === 'REATTRIBUTE' && ap
      ? `/admin/reconciliation/cases/${encodeURIComponent(currentCaseNo)}/reattribution-candidates?side=${ap.reattributionSide}&amount=${ap.amountMinor}`
      : undefined,
  };
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
  // Task 7: 开调账单弹层——prefill 来自被点击的那一行（row.adjustmentPrefill）。
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
    const ap = row.adjustmentPrefill;
    if (!ap) return; // 按钮只在带 dispositions 的行上渲染——守卫与 openWriteOff 同款
    setCreatePrefill(prefillFromRow(row, ap));
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
      const ap = row.adjustmentPrefill;
      if (!ap) return;
      setCreatePrefill(prefillFromRow(row, ap));
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
      amountMinor: ns.amount ?? '0', relatedOrderNo: '',
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

  // 波四：CLIENT|FIRM 归一化由后端随 case 下发（createDraft 同一句），前端不再镜像。
  const adjustmentBook: AdjustmentBook = kase.adjustmentBook;

  // Minor #5（终审）：结案后的超期天数要在结案那一刻冻结，不能继续跟着 Date.now() 涨。
  const agingReferenceMs = kase.status === 'RESOLVED' && kase.resolvedAt ? new Date(kase.resolvedAt).getTime() : Date.now();

  // Task 8（Hero 结论句）：残差已被哪些落账调账单解释掉的金额合计——只数
  // explainedByAdjustmentNo 非空的行，金额读行上 adjustmentPrefill——与开单同一个数
  // （mismatch 取差额、orphan 取该行本身金额），避免结论句这里另算一套出现分歧。
  // 整数最小单位字符串求和用 BigInt——金额不含小数点，安全。
  const explainedSumMinor = (kase.flowComparison ?? [])
    .filter((r) => r.explainedByAdjustmentNo)
    .reduce((sum, r) => sum + BigInt(r.adjustmentPrefill?.amountMinor ?? '0'), 0n)
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

          <CaseBalanceTiles kase={kase} deltaZero={deltaZero} sign={sign} />

          {/* 4. Case History — Opened By / Last Re-Checked / Aging
              (design/Main.dc.html §3; replaces the old one-line ObservationBar). */}
          <DetailCard title="Case History" columns={1}>
            <CaseHistory kase={kase} agingReferenceMs={agingReferenceMs} />
          </DetailCard>

          <CaseFlowTable
            kase={kase}
            sortedFlows={sortedFlows}
            showMatched={showMatched}
            setShowMatched={setShowMatched}
            simEnabled={simEnabled}
            onOpenAdjustKind={openAdjustKind}
            onOpenFinding={(row, kind, label) => setFindingPicker({ row, kind, label })}
            onOpenHold={(row, kind) => setHoldPicker({ row, kind })}
            onOpenWriteOff={openWriteOff}
            onOpenFunding={setFundingRow}
            canRecordDisposition={canRecordDisposition}
            canCreateAdjustment={canCreateAdjustment}
            canSupplement={canSupplement}
            canRegisterIncident={canRegisterIncident}
            canFundClient={canFundClient}
            matchedCount={matchedCount}
            openRowsCount={openRowsCount}
            existingLargeUnexplained={existingLargeUnexplained}
            existingClientShortfall={existingClientShortfall}
          />

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

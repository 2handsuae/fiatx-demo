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
import { RefreshCw, Check, AlertTriangle, ArrowRight, ExternalLink } from 'lucide-react';
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

interface FlowComparisonRow {
  externalLine: FlowExternalSide | null;
  internalFlow: FlowInternalSide | null;
  matchType: FlowMatchType;
  deltaAmount?: string;
  fundsOrderNo?: string | null;   // NEW — only for IN_TRANSIT rows
  fundsOrderStatus?: string | null; // T4 — funds order status for IN_TRANSIT rows;
                                    // CLEARED here (case still OPEN) = "已推进·待重对账"
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
}

/* ── Constants & helpers ────────────────────────────────────── */

// T4 (canon2): amounts arrive as integer base units (分); scale 分→元 by the
// case asset's real decimals (getCase returns `decimals` from the asset table).
// bigint-safe string padding — no float, so USDT (6dp) shows every digit right.
// decimals=0 (asset lookup miss / integer asset) degrades to no fraction part.
const formatAmount = (raw: string | null | undefined, decimals: number): string => {
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

const MATCH_LABEL: Record<FlowMatchType, string> = {
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
  const [kase, setKase] = useState<ReconCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // MATCHED rows are collapsed by default (layout 乙 — single mixed table,
  // not grouped sections). Toggled by the "Show matched" button below the table.
  const [showMatched, setShowMatched] = useState(false);
  const [reconciling, setReconciling] = useState(false);

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

  // 一键重新对账 / Re-reconcile — fire a fresh wallet run at now; on success
  // refresh this case (a re-observation may flip it to RESOLVED if the pushed
  // funds order now nets the delta to zero).
  const handleReReconcile = async () => {
    setReconciling(true);
    try {
      const ok = await triggerWalletReconRun();
      if (ok) await fetchCase();
    } finally {
      setReconciling(false);
    }
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {sortedFlows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3">
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
    </div>
  );
};

export default ReconciliationCasesDetailPage;

// admin-web/src/pages/ReconciliationCasesDetailPage.tsx
//
// T5 "Investigation cockpit" — read-only Case detail for the WALLET_V1 engine.
//
// Replaces the V8 five-formula book/asset/vintage view (kept off-screen — the
// new wallet engine never populates `book` LHS labels). The cockpit answers
// the operator's two investigation questions:
//   1. "What broke for this wallet? (balance, flows, both?)"
//   2. "Which specific external/internal lines diverge?"
//
// Layout (top → bottom):
//   1. Nav header (back + refresh)
//   2. Account Identity card — wallet, owner, asset, COA, linked run, status
//   3. Balance Comparison — 3-number side-by-side (Internal / External / Δ)
//   4. Anomaly Summary chips — 3 chips with bucketed counts (scroll-to-row)
//   5. Flow Comparison — single table, dual-column EXTERNAL ‖ INTERNAL ‖ Match
//   6. Bottom — "View in Account Statement" deep link
//   7. Technical (trace + ids)
//
// Disposition workflow (Close / Waive / Assign) is deferred to Phase C — this
// page is investigation-only this release.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight, ExternalLink } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

// Legacy line-items still arrive in the response (the V8 engine wrote them).
// We no longer render them — flowComparison is the new investigation surface.
interface CaseLineItem {
  id: string;
  lineNo: number;
  matchStatus: string;
}

type FlowMatchType = 'MATCHED' | 'ORPHAN_EXTERNAL' | 'ORPHAN_INTERNAL' | 'AMOUNT_MISMATCH';

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
}

interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}

interface ReconCaseDetail {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
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
}

/* ── Constants & helpers ────────────────────────────────────── */

// Same 6-decimal bigint formatter as the Run cockpit — keeps the two pages
// telling the same story for the same wallet.
const DEFAULT_DECIMALS = 6;
const formatAmount = (raw: string | null | undefined): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(DEFAULT_DECIMALS + 1, '0');
  const intPart = padded.slice(0, padded.length - DEFAULT_DECIMALS) || '0';
  const fracPart = padded.slice(padded.length - DEFAULT_DECIMALS);
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}.${fracPart}`;
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

// Sort priority for flow rows: matched (audit baseline) → orphans → mismatches.
// Within each bucket, by timestamp asc (best-available side).
const MATCH_RANK: Record<FlowMatchType, number> = {
  MATCHED: 0,
  ORPHAN_INTERNAL: 1,
  ORPHAN_EXTERNAL: 2,
  AMOUNT_MISMATCH: 3,
};

const rowTimestamp = (r: FlowComparisonRow): number => {
  const t = r.externalLine?.timestamp ?? r.internalFlow?.timestamp ?? null;
  return t ? new Date(t).getTime() : 0;
};

// Style maps for the Match/Diff cell.
const MATCH_TONE: Record<FlowMatchType, string> = {
  MATCHED:         'border-adm-green/30 bg-adm-green/10 text-adm-green',
  ORPHAN_INTERNAL: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  ORPHAN_EXTERNAL: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  AMOUNT_MISMATCH: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
};

const MATCH_LABEL: Record<FlowMatchType, string> = {
  MATCHED:         'matched',
  ORPHAN_INTERNAL: 'Internal only',
  ORPHAN_EXTERNAL: 'External only',
  AMOUNT_MISMATCH: 'Amount mismatch',
};

const MatchChip = ({ row }: { row: FlowComparisonRow }) => {
  const tone = MATCH_TONE[row.matchType];
  if (row.matchType === 'MATCHED') {
    return (
      <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
        <Check size={10} /> matched
      </span>
    );
  }
  if (row.matchType === 'AMOUNT_MISMATCH') {
    const sign = deltaSign(row.deltaAmount);
    return (
      <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
        <AlertTriangle size={10} /> {MATCH_LABEL.AMOUNT_MISMATCH} {sign && `(${sign}${formatAmount(row.deltaAmount)})`}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
      <AlertTriangle size={10} /> {MATCH_LABEL[row.matchType]}
    </span>
  );
};

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationCasesDetailPage = () => {
  const { caseNo } = useParams<{ caseNo: string }>();
  const navigate = useNavigate();
  const [kase, setKase] = useState<ReconCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (caseNo) void fetchCase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseNo]);

  // Investigation surface: only problematic rows (orphans + mismatches). MATCHED
  // pairs are noise here — Case detail is the "what went wrong" screen, not the
  // ledger audit baseline. Sort orphan internal → orphan external → mismatch,
  // then by timestamp asc. Hook called BEFORE early returns so hook order stays
  // stable across renders.
  const sortedFlows = useMemo<FlowComparisonRow[]>(() => {
    const rows = (kase?.flowComparison ?? []).filter((r) => r.matchType !== 'MATCHED');
    return rows.sort((a, b) => {
      const r = MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType];
      if (r !== 0) return r;
      return rowTimestamp(a) - rowTimestamp(b);
    });
  }, [kase]);

  if (loading && !kase) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading reconciliation case...</p>
      </div>
    );
  }

  if (!kase) return null;

  // Keep raw UUID for title-hover only — display uses the resolved runNo.
  const linkedRunIdForHover = kase.lastUpdatedRunId ?? kase.openedByRunId ?? null;

  // Δ display logic: zero → muted "balanced"; non-zero → bold red with sign.
  const deltaZero = isZeroAmount(kase.deltaAmount);
  const sign = deltaSign(kase.deltaAmount);

  // Bottom deep link — AccountStatementPage detects wallets mode from `?wallet=` param.
  const accountStatementHref = kase.walletRef
    ? `/admin/ledger/account-statement?wallet=${encodeURIComponent(kase.walletRef)}&crossingOnly=true`
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
            <div className="font-mono text-[19px] font-bold text-adm-amber">{kase.caseNo}</div>
            <div className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
              <div className="text-adm-t3">STATUS</div>
              <div><StatusPill value={kase.status} size="md" /></div>
              <div className="text-adm-t3">SEVERITY</div>
              <div>
                {kase.severity ? (
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
                ) : <span className="text-adm-t3">—</span>}
              </div>
              <div className="text-adm-t3">BOOK</div>
              <div className="text-adm-t1">{kase.book ?? '—'}</div>
              <div className="text-adm-t3">ASSET</div>
              <div className="text-adm-t1">{kase.assetCode}</div>
              <div className="text-adm-t3">Δ</div>
              <div className={deltaZero ? 'text-adm-t2' : 'text-adm-red font-mono font-semibold'}>
                {deltaZero ? formatAmount(kase.deltaAmount) : `${sign}${formatAmount(kase.deltaAmount).replace(/^-/, '')}`}
              </div>
            </div>
          </section>

          {/* 2. Account Identity */}
          <DetailCard title="Account Identity" columns={1}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Wallet — primary identifier */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Wallet
                </div>
                <div
                  className="mt-1 font-mono text-[15px] font-semibold text-adm-t1"
                  title={kase.walletRef ?? undefined}
                >
                  {kase.walletNo ?? '—'}
                </div>
                <div className="mt-1 font-mono text-[10px] text-adm-t3">
                  {kase.coaCode ?? '—'}
                </div>
              </div>
              {/* Owner */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Owner
                </div>
                <div className="mt-1 font-mono text-[13px] text-adm-t1">
                  {kase.ownerNo ?? '—'}
                </div>
                <div className="mt-1 font-mono text-[10px] text-adm-t3">
                  Asset: <span className="text-adm-t1">{kase.assetCode}</span>
                  {kase.book && (
                    <>
                      {' · '}Book: <span className="text-adm-t1">{kase.book}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Linked Run */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Linked Run
                </div>
                <div className="mt-1 font-mono text-[13px] text-adm-t2" title={linkedRunIdForHover ?? undefined}>
                  {kase.linkedRunNo ?? '—'}
                </div>
                <div className="mt-1 font-mono text-[10px] text-adm-t3">
                  Business Date: <span className="text-adm-t1">{kase.businessDate}</span>
                </div>
              </div>
              {/* Lifecycle */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Lifecycle
                </div>
                <div className="mt-1 font-mono text-[11px] text-adm-t2">
                  First seen: <span className="text-adm-t1">{fmtTime(kase.createdAt) ?? '—'}</span>
                </div>
                <div className="font-mono text-[11px] text-adm-t2">
                  Last update: <span className="text-adm-t1">{fmtTime(kase.updatedAt) ?? '—'}</span>
                </div>
                {kase.resolvedAt && (
                  <div className="mt-1 font-mono text-[11px] text-adm-green">
                    Resolved: {fmtTime(kase.resolvedAt)}
                    {kase.resolutionReason && ` (${kase.resolutionReason})`}
                  </div>
                )}
              </div>
            </div>
          </DetailCard>

          {/* 3. Balance Comparison — 3 big numbers (Internal / External / Δ) */}
          <DetailCard title={`Balance Comparison (${kase.assetCode})`} columns={1}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Internal */}
              <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Internal
                </div>
                <div className="mt-1 font-mono text-[20px] font-bold leading-tight text-adm-t1">
                  {formatAmount(kase.tbAmount)}
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
                <div className="mt-1 font-mono text-[20px] font-bold leading-tight text-adm-t1">
                  {formatAmount(kase.actualExternal)}
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
                  Δ (external − internal)
                </div>
                <div
                  className={[
                    'mt-1 font-mono text-[20px] font-bold leading-tight',
                    deltaZero ? 'text-adm-t3' : 'text-adm-red',
                  ].join(' ')}
                >
                  {deltaZero
                    ? `${formatAmount(kase.deltaAmount)}`
                    : `${sign}${formatAmount(kase.deltaAmount).replace(/^-/, '')}`}
                </div>
                <div
                  className={[
                    'mt-1 inline-flex items-center gap-1 font-mono text-[10px]',
                    deltaZero ? 'text-adm-green' : 'text-adm-red',
                  ].join(' ')}
                >
                  {deltaZero ? <><Check size={10} /> balanced</> : <><AlertTriangle size={10} /> imbalance</>}
                </div>
              </div>
            </div>
          </DetailCard>

          {/* Problem Flows — only orphans + mismatches. Matched pairs are
              hidden — Case detail is "what went wrong", the audit baseline lives
              in Account Statement (linked at the bottom). */}
          <DetailCard
            title={`Problem Flows · ${sortedFlows.length} row${sortedFlows.length === 1 ? '' : 's'}`}
            columns={1}
          >
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table ref={tableRef} className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    <th className="w-[42%] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      External
                    </th>
                    <th className="w-[42%] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Internal
                    </th>
                    <th className="w-[16%] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Match / Diff
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {sortedFlows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3">
                        No problem flows for this case. (Matched pairs are hidden — open Account Statement for the full ledger.)
                      </td>
                    </tr>
                  ) : (
                    sortedFlows.map((row, idx) => {
                      const ext = row.externalLine;
                      const intl = row.internalFlow;
                      const isMismatch = row.matchType === 'AMOUNT_MISMATCH';
                      const isOrphanExt = row.matchType === 'ORPHAN_EXTERNAL';
                      const isOrphanInt = row.matchType === 'ORPHAN_INTERNAL';
                      return (
                        <tr
                          key={`${row.matchType}-${ext?.id ?? '_'}-${intl?.id ?? '_'}-${idx}`}
                          className="align-top"
                        >
                          {/* EXTERNAL side */}
                          <td className="px-3 py-3 font-mono text-[11px]">
                            {ext ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-adm-t3">{shortTimestamp(ext.timestamp)}</span>
                                  <span
                                    className={`rounded border px-1 text-[9px] font-semibold ${
                                      ext.direction === 'IN'
                                        ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                        : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                                    }`}
                                  >
                                    {ext.direction}
                                  </span>
                                  <span className={isMismatch ? 'font-bold text-adm-red' : 'text-adm-t1'}>
                                    {formatAmount(ext.amount)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-adm-t3">
                                  ref: <span className="text-adm-t2">{ext.externalRef ?? '—'}</span>
                                </div>
                                {ext.description && (
                                  <div className="text-[10px] text-adm-t3 truncate" title={ext.description}>
                                    {ext.description}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* INTERNAL side */}
                          <td className="px-3 py-3 font-mono text-[11px]">
                            {intl ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-adm-t3">{shortTimestamp(intl.timestamp)}</span>
                                  <span
                                    className={`rounded border px-1 text-[9px] font-semibold ${
                                      intl.direction === 'IN'
                                        ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                        : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                                    }`}
                                  >
                                    {intl.direction}
                                  </span>
                                  <span className={isMismatch ? 'font-bold text-adm-red' : 'text-adm-t1'}>
                                    {formatAmount(intl.amount)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-adm-t3">
                                  ref: <span className="text-adm-t2">{intl.externalRef ?? '—'}</span>
                                </div>
                                <div className="text-[10px] text-adm-t3">
                                  {intl.eventCode} · {intl.sourceType}/{intl.sourceNo}
                                </div>
                              </div>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Match / Diff */}
                          <td className="px-3 py-3">
                            <MatchChip row={row} />
                            {(isOrphanExt || isOrphanInt) && (
                              <div className="mt-1 font-mono text-[9px] text-adm-t3">
                                {isOrphanExt ? 'No internal counterpart' : 'No external counterpart'}
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
          </DetailCard>

          {/* 6. Bottom utility — deep link to Account Statement */}
          <DetailCard title="Related Views" columns={1}>
            {accountStatementHref ? (
              <button
                type="button"
                onClick={() => navigate(accountStatementHref)}
                className="inline-flex items-center gap-2 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-2 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                View this wallet's full flow in Account Statement
                <ArrowRight size={11} />
              </button>
            ) : (
              <div className="font-mono text-[11px] text-adm-t3">
                No wallet reference on this case — deep link unavailable.
              </div>
            )}
          </DetailCard>

        </div>

        {/* ── Sidebar (read-only — no Actions block) ── */}
        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Case No" value={kase.caseNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={kase.status} />} />
            <SidebarKV label="Book" value={kase.book ?? '—'} />
            <SidebarKV label="Asset" value={kase.assetCode} />
            <SidebarKV label="Δ" value={deltaZero ? formatAmount(kase.deltaAmount) : `${sign}${formatAmount(kase.deltaAmount).replace(/^-/, '')}`} mono />
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

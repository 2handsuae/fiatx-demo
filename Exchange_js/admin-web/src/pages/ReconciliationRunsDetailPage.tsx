// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
//
// Round3 cockpit — Run detail. Layout 甲 (confirmed in brainstorm): verdict
// banner → five-bucket Health Check → Case Flow triple → snapshot detail table.
//
// Five-bucket classification (T4 bucket-classifier; replaces the old
// MATCH/FLOW_REVIEW/BREAK three-tier status):
//   • MATCHED    — balance OK AND flows OK                        (green)
//   • IN_TRANSIT — delta fully explained by non-terminal funds_order (blue)
//   • SOFT_FLAG  — balance OK but flow line-items have orphan/mismatch (amber)
//   • BREAK      — residual delta unexplained after in-transit netting (red)
//
// Layout (top → bottom):
//   1. Nav header (back + refresh)
//   2. Verdict banner
//   3. Health Check — five bucket cards (click to filter the table below)
//   4. Case Flow — opened / re-observed / closed this run (click → cases list)
//   5. Account Status snapshot table — one row per wallet; click any non-MATCHED row to its case
//   6. Sidebar (identity + lifecycle)
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight, ArrowUpDown } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { BUCKET_LABELS, type ReconBucket } from '../utils/reconBucketMap';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types (mirrors ReconRunDetail / AccountStatusRow / RunDetailSummary
   in src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts) ── */

interface ReconCaseLink {
  caseNo: string;
  assetCode: string;
  book: string | null;
  status: string;
  deltaAmount: string;
}

interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;      // business key; null for XREF synthetic rows
  walletRole?: string | null;
  ownerNo?: string | null;
  asset: string;
  book: string;
  coaCode: string | null;
  internal: { balance: string };
  external: { balance: string };
  delta: string;
  inTransitAmount: string;
  flowMatched: number;
  flowTotal: number;
  flowOrphanInternal: number;
  flowOrphanExternal: number;
  flowMismatch: number;
  inTransitCount: number;
  bucket: ReconBucket;
  caseId?: string | null;
  caseNo?: string | null;
}

interface RunDetailSummary {
  walletCount: number;
  matchedCount: number;
  inTransitCount: number;
  softFlagCount: number;
  breakCount: number;
  openedCount: number;
  reObservedCount: number;
  closedCount: number;
}

interface ReconRunDetail {
  id: string;
  runNo: string;
  businessDate: string;
  layer: string;
  seq: number;
  triggerType: string;
  mode: string;
  status: string;
  invariantStatus: string;
  openedCount: number;
  reObservedCount: number;
  closedCount: number;
  traceId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  hasDemoManifest: boolean;
  legacy: boolean;
  cases?: ReconCaseLink[];
  accountStatusTable: AccountStatusRow[];
  summary: RunDetailSummary;
}

/* ── Constants ──────────────────────────────────────────────── */

const TRIGGER_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  MANUAL: 'Manual',
  POST_FIX: 'Post-Fix',
};

const fmtTrigger = (t: string) => TRIGGER_LABELS[t] || t;
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

// Decimals for amount rendering. Internal/external balances are bigints; this
// matches AccountStatementPage's default of 6 decimals so the two pages tell
// the same story for the same wallet. (FIAT shows trailing zeros — fine; the
// cockpit is for operators, not customers.)
const DEFAULT_DECIMALS = 6;
const formatAmount = (raw: string): string => {
  // Treat input as integer string of base units; do bigint-safe division.
  // Negative ok; locale comma grouping; min/max fraction = decimals.
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(DEFAULT_DECIMALS + 1, '0');
  const intPart = padded.slice(0, padded.length - DEFAULT_DECIMALS) || '0';
  const fracPart = padded.slice(padded.length - DEFAULT_DECIMALS);
  // Group thousands in the integer part.
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}.${fracPart}`;
};

const isZeroAmount = (raw: string): boolean => {
  const s = String(raw ?? '0').replace(/^-/, '');
  return s === '' || /^0+$/.test(s);
};

// adm-* tone tokens for the four bucket tones (BUCKET_LABELS[].tone), shared
// by the Health Check cards and the table's status badge — single mapping so
// card colour and badge colour never drift apart.
const TONE_CLASSES: Record<'green' | 'blue' | 'amber' | 'red', { border: string; bg: string; text: string }> = {
  green: { border: 'border-adm-green/30', bg: 'bg-adm-green/10', text: 'text-adm-green' },
  blue:  { border: 'border-adm-blue/30',  bg: 'bg-adm-blue/10',  text: 'text-adm-blue' },
  amber: { border: 'border-adm-amber/30', bg: 'bg-adm-amber/10', text: 'text-adm-amber' },
  red:   { border: 'border-adm-red/30',   bg: 'bg-adm-red/10',   text: 'text-adm-red' },
};

// Status badge for the AccountStatusRow.bucket enum (Round3 five-bucket
// classification). Labels sourced from BUCKET_LABELS (single source of truth).
const StatusBadge = ({ value }: { value: ReconBucket }) => {
  const label = BUCKET_LABELS[value];
  const tone = TONE_CLASSES[label.tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${tone.border} ${tone.bg} ${tone.text}`}
    >
      {value === 'MATCHED' ? <Check size={10} /> : <AlertTriangle size={10} />}
      {label.en} / {label.zh}
    </span>
  );
};

// Sort priority for status column — BREAK first (hard, act now), SOFT_FLAG
// and IN_TRANSIT next (investigate), MATCHED last (done).
const STATUS_RANK: Record<ReconBucket, number> = {
  BREAK: 0,
  SOFT_FLAG: 1,
  IN_TRANSIT: 2,
  MATCHED: 3,
};

type SortKey = 'status' | 'delta' | 'asset';
type SortDir = 'asc' | 'desc';

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationRunsDetailPage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<ReconRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Set by clicking a Health Check bucket card; null = no filter (all buckets).
  const [bucketFilter, setBucketFilter] = useState<ReconBucket | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc'); // status asc = breaks first

  const fetchRun = async () => {
    if (!runNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/runs/${encodeURIComponent(runNo)}`,
      );
      if (res.ok) {
        setRun((await res.json()) as ReconRunDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load reconciliation run'));
        navigate('/admin/reconciliation/runs');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch reconciliation run', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (runNo) void fetchRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNo]);

  // Sort + filter the account table BEFORE the early returns so hook order is
  // stable across re-renders (avoids the React-hooks lint rule). Filtering is
  // purely local — clicking a Health Check card sets bucketFilter, no refetch.
  const visibleRows = useMemo(() => {
    if (!run?.accountStatusTable) return [] as AccountStatusRow[];
    const filtered = bucketFilter
      ? run.accountStatusTable.filter((r) => r.bucket === bucketFilter)
      : [...run.accountStatusTable];
    const dirMul = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'status') {
        cmp = STATUS_RANK[a.bucket] - STATUS_RANK[b.bucket];
      } else if (sortKey === 'asset') {
        cmp = a.asset.localeCompare(b.asset);
      } else {
        // delta: compare by |bigint| desc by default; we apply dirMul below
        const absA = a.delta.replace(/^-/, '');
        const absB = b.delta.replace(/^-/, '');
        // string-compare with length first (works for non-negative big numbers)
        cmp = absA.length === absB.length ? absA.localeCompare(absB) : absA.length - absB.length;
        // For delta the natural "interesting" order is biggest first → invert default
        cmp = -cmp;
      }
      if (cmp !== 0) return cmp * dirMul;
      // tiebreaker — bigger |delta| first, then walletRef for stable order
      const ad = a.delta.replace(/^-/, '');
      const bd = b.delta.replace(/^-/, '');
      const tcmp = ad.length === bd.length ? bd.localeCompare(ad) : bd.length - ad.length;
      if (tcmp !== 0) return tcmp;
      return a.walletRef.localeCompare(b.walletRef);
    });
    return filtered;
  }, [run, bucketFilter, sortKey, sortDir]);

  if (loading && !run) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading reconciliation run...</p>
      </div>
    );
  }

  if (!run) return null;

  const summary: RunDetailSummary = run.summary ?? {
    walletCount: 0,
    matchedCount: 0,
    inTransitCount: 0,
    softFlagCount: 0,
    breakCount: 0,
    openedCount: 0,
    reObservedCount: 0,
    closedCount: 0,
  };
  const accountTable = run.accountStatusTable ?? [];
  const needsAttention = summary.softFlagCount + summary.breakCount;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'status' ? 'asc' : 'desc'); // status: breaks first; others: largest first
    }
  };

  const onRowClick = (row: AccountStatusRow) => {
    if (row.bucket === 'MATCHED') return; // MATCHED rows: no-op (read-only)
    if (!row.caseNo) return;
    navigate(`/admin/reconciliation/cases/${encodeURIComponent(row.caseNo)}`);
  };

  const goToCasesForRun = () => {
    navigate(`/admin/reconciliation/cases?runNo=${encodeURIComponent(run.runNo)}`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Nav Header (back + refresh only) ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/reconciliation/runs')}
        onRefresh={fetchRun}
        refreshing={loading}
        backLabel="Runs"
      />

      {/* ── Body: Main + Sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Main Body ── */}
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* 1. Verdict banner — plain-language conclusion, not a status pill wall. */}
          <div className="bg-adm-card px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[13px] text-adm-t3">
                {run.runNo} · {run.businessDate}
              </div>
              {run.hasDemoManifest && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/admin/reconciliation/demo-compare/${encodeURIComponent(run.runNo)}`)
                  }
                  className="inline-flex items-center gap-1 rounded border border-adm-amber/40 bg-adm-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-adm-amber transition-colors hover:bg-adm-amber/20"
                >
                  Demo 对比 <ArrowRight size={11} />
                </button>
              )}
            </div>
            {run.legacy ? (
              <div className="mt-3 rounded-md border border-adm-border bg-adm-bg px-4 py-3 font-mono text-[13px] text-adm-t2">
                历史 run 无快照数据（Round3 前） / Legacy run – no snapshot data
              </div>
            ) : (
              <div
                className={[
                  'mt-3 rounded-md border px-4 py-3 text-[14px] font-semibold',
                  run.invariantStatus === 'PASS'
                    ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                    : 'border-adm-red/30 bg-adm-red/10 text-adm-red',
                ].join(' ')}
              >
                {run.invariantStatus === 'PASS' ? '对平 / PASS' : '不平 / BREAK'} — {summary.walletCount} 个钱包，
                {summary.matchedCount} 个平，{summary.inTransitCount} 笔在途，{needsAttention} 个需要处理
              </div>
            )}
          </div>

          {/* 2. Health Check — five bucket cards. Click to filter the table below
              (local filter, no refetch). Total card clears the filter. */}
          <DetailCard title="本次体检 / Health Check" columns={1}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {/* Total — clears filter */}
              <button
                type="button"
                onClick={() => setBucketFilter(null)}
                className={[
                  'rounded-lg border p-4 text-left transition-colors',
                  bucketFilter === null
                    ? 'border-adm-t1 bg-adm-bg'
                    : 'border-adm-border bg-adm-bg hover:border-adm-t3',
                ].join(' ')}
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  总钱包 / Total
                </div>
                <div className="mt-1 text-[28px] font-bold leading-tight text-adm-t1">
                  {summary.walletCount}
                </div>
              </button>

              {(['MATCHED', 'IN_TRANSIT', 'SOFT_FLAG', 'BREAK'] as const).map((bucket) => {
                const label = BUCKET_LABELS[bucket];
                const tone = TONE_CLASSES[label.tone];
                const count =
                  bucket === 'MATCHED' ? summary.matchedCount :
                  bucket === 'IN_TRANSIT' ? summary.inTransitCount :
                  bucket === 'SOFT_FLAG' ? summary.softFlagCount :
                  summary.breakCount;
                const active = bucketFilter === bucket;
                const hasCount = count > 0;
                return (
                  <button
                    type="button"
                    key={bucket}
                    onClick={() => setBucketFilter(bucket)}
                    className={[
                      'rounded-lg border p-4 text-left transition-colors',
                      active
                        ? `${tone.border} ${tone.bg}`
                        : hasCount
                          ? `${tone.border} bg-adm-bg`
                          : 'border-adm-border bg-adm-bg hover:border-adm-t3',
                    ].join(' ')}
                  >
                    <div
                      className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider ${hasCount ? tone.text : 'text-adm-t3'}`}
                    >
                      {bucket === 'MATCHED' ? <Check size={11} /> : <AlertTriangle size={11} />}
                      {label.en} / {label.zh}
                    </div>
                    <div
                      className={`mt-1 text-[28px] font-bold leading-tight ${hasCount ? tone.text : 'text-adm-t1'}`}
                    >
                      {count}
                    </div>
                  </button>
                );
              })}
            </div>
          </DetailCard>

          {/* 3. Case Flow — opened / re-observed / closed this run. Own row below
              Health Check (layout 甲, confirmed in brainstorm — not side-by-side). */}
          <DetailCard title="工单流转 / Case Flow" columns={1}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={goToCasesForRun}
                className="rounded-lg border border-adm-border bg-adm-bg p-4 text-left transition-colors hover:border-adm-t3"
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  新开 / Opened
                </div>
                <div className="mt-1 text-[28px] font-bold leading-tight text-adm-t1">
                  {summary.openedCount}
                </div>
              </button>
              <button
                type="button"
                onClick={goToCasesForRun}
                className="rounded-lg border border-adm-border bg-adm-bg p-4 text-left transition-colors hover:border-adm-t3"
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  复观察 / Re-observed
                </div>
                <div className="mt-1 text-[28px] font-bold leading-tight text-adm-t1">
                  {summary.reObservedCount}
                </div>
              </button>
              <button
                type="button"
                onClick={goToCasesForRun}
                className="rounded-lg border border-adm-green/30 bg-adm-green/5 p-4 text-left transition-colors hover:bg-adm-green/10"
              >
                <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-adm-green">
                  <Check size={11} /> 本次关闭 / Closed
                </div>
                <div className="mt-1 text-[28px] font-bold leading-tight text-adm-green">
                  {summary.closedCount}
                </div>
              </button>
            </div>
          </DetailCard>

          {/* 4. Account Status snapshot table */}
          <DetailCard title="Account Status" columns={1}>
            {run.legacy ? (
              <div className="rounded-md border border-adm-border bg-adm-bg px-4 py-3 font-mono text-[13px] text-adm-t2">
                历史 run 无快照数据（Round3 前） / Legacy run – no snapshot data
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Utilities row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-[11px] text-adm-t3">
                    {bucketFilter
                      ? `Filtered: ${BUCKET_LABELS[bucketFilter].en} / ${BUCKET_LABELS[bucketFilter].zh}`
                      : `All buckets (${accountTable.length})`}
                  </div>
                  <button
                    type="button"
                    onClick={goToCasesForRun}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
                  >
                    View All Cases for this Run <ArrowRight size={11} />
                  </button>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-adm-border">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-adm-border bg-adm-bg">
                      <tr>
                        <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          Account
                        </th>
                        <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          Owner
                        </th>
                        <th
                          className="cursor-pointer select-none px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-t1"
                          onClick={() => toggleSort('asset')}
                          title="Sort by asset"
                        >
                          <span className="inline-flex items-center gap-1">
                            Asset
                            {sortKey === 'asset' && <ArrowUpDown size={10} />}
                          </span>
                        </th>
                        <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          Internal
                        </th>
                        <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          External
                        </th>
                        <th
                          className="cursor-pointer select-none px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-t1"
                          onClick={() => toggleSort('delta')}
                          title="Sort by |Δ|"
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            Δ
                            {sortKey === 'delta' && <ArrowUpDown size={10} />}
                          </span>
                        </th>
                        <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          在途 / In-transit
                        </th>
                        <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          Flows
                        </th>
                        <th
                          className="cursor-pointer select-none px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-t1"
                          onClick={() => toggleSort('status')}
                          title="Sort by status"
                        >
                          <span className="inline-flex items-center gap-1">
                            Status
                            {sortKey === 'status' && <ArrowUpDown size={10} />}
                          </span>
                        </th>
                        <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                          Case
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-adm-border">
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                          >
                            {accountTable.length === 0
                              ? 'No accounts in this run.'
                              : 'No rows match this filter.'}
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row) => {
                          const clickable = row.bucket !== 'MATCHED' && !!row.caseNo;
                          const deltaZero = isZeroAmount(row.delta);
                          const inTransitZero = isZeroAmount(row.inTransitAmount);
                          const displayWallet = row.walletNo ?? row.walletRef.slice(0, 8);
                          const flowParts = [
                            `✓${row.flowMatched}`,
                            row.flowOrphanInternal > 0 ? `OI${row.flowOrphanInternal}` : '',
                            row.flowOrphanExternal > 0 ? `OE${row.flowOrphanExternal}` : '',
                            row.flowMismatch > 0 ? `MM${row.flowMismatch}` : '',
                            row.inTransitCount > 0 ? `⧖${row.inTransitCount}` : '',
                          ].filter(Boolean).join(' ');
                          return (
                            <tr
                              key={row.walletRef}
                              onClick={() => clickable && onRowClick(row)}
                              className={[
                                'transition-colors',
                                clickable ? 'cursor-pointer hover:bg-adm-hover' : 'cursor-default',
                              ].join(' ')}
                            >
                              {/* Account */}
                              <td className="px-3 py-2.5">
                                <div className="font-mono text-[11px] font-semibold text-adm-t1">
                                  {row.walletRole ?? '(unknown)'}
                                </div>
                                <div
                                  className="font-mono text-[10px] text-adm-t3"
                                  title={row.walletRef}
                                >
                                  {displayWallet}
                                </div>
                              </td>
                              {/* Owner — ownerNo if present, else book */}
                              <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                                {row.ownerNo ?? row.book}
                              </td>
                              {/* Asset */}
                              <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                                {row.asset}
                              </td>
                              {/* Internal */}
                              <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                                {formatAmount(row.internal.balance)}
                              </td>
                              {/* External */}
                              <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                                {formatAmount(row.external.balance)}
                              </td>
                              {/* Δ — muted gray when zero, bold red when non-zero */}
                              <td
                                className={[
                                  'px-3 py-2.5 text-right font-mono text-[11px]',
                                  deltaZero
                                    ? 'text-adm-t3'
                                    : 'font-bold text-adm-red',
                                ].join(' ')}
                              >
                                {formatAmount(row.delta)}
                              </td>
                              {/* In-transit — em dash when zero */}
                              <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                                {inTransitZero ? '—' : formatAmount(row.inTransitAmount)}
                              </td>
                              {/* Flows */}
                              <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t1">
                                {flowParts}
                              </td>
                              {/* Status */}
                              <td className="px-3 py-2.5">
                                <StatusBadge value={row.bucket} />
                              </td>
                              {/* Case */}
                              <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t1">
                                {row.caseNo ?? '—'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </DetailCard>

        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Run No" value={run.runNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={run.status} />} />
            <SidebarKV label="Layer" value={run.layer} />
            <SidebarKV label="Trigger" value={fmtTrigger(run.triggerType)} />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Started" value={fmtTime(run.startedAt)} mono />
            <SidebarKV label="Completed" value={fmtTime(run.completedAt)} mono />
            <SidebarKV label="Created" value={fmtTime(run.createdAt)} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationRunsDetailPage;

// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
//
// Round3 cockpit — Run detail. Layout 甲 (confirmed in brainstorm): verdict
// banner → five-bucket Health Check → Case Flow triple → snapshot detail table.
//
// Five-bucket classification (T4 bucket-classifier; replaces the old
// MATCH/FLOW_REVIEW/BREAK three-tier status):
//   • MATCHED    — balance OK AND flows OK                        (green)
//   • IN_TRANSIT — delta fully explained by non-terminal funds_order (blue)
//   • COMPENSATING — balance OK but flow line-items have orphan/mismatch (amber)
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
import { RefreshCw, Check, AlertTriangle, Clock, ArrowRight, ArrowUpDown } from 'lucide-react';
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
import { triggerWalletReconRun } from '../utils/reconRunTrigger';

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
  decimals: number;             // T4 — asset.decimals; display scales 分→元 by 10^decimals
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

// T4 (canon2): amounts arrive as integer base units (分); scale 分→元 by each
// wallet's own asset decimals (getRun returns per-row `decimals` from the asset
// table — a run spans multiple assets, AED=2/USDT=6). bigint-safe string padding
// (no float) so USDT (6dp) shows every digit right; decimals=0 → no fraction.
const formatAmount = (raw: string, decimals: number): string => {
  // Treat input as integer string of base units; do bigint-safe division.
  // Negative ok; locale comma grouping; min/max fraction = decimals.
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  // Group thousands in the integer part.
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
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
      {value === 'MATCHED' ? <Check size={10} /> : null}
      {label.en}
    </span>
  );
};

// Sort priority for status column — BREAK first (hard, act now), COMPENSATING
// and IN_TRANSIT next (investigate), MATCHED last (done).
const STATUS_RANK: Record<ReconBucket, number> = {
  BREAK: 0,
  COMPENSATING: 1,
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
  const [reconciling, setReconciling] = useState(false);

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

  // 一键重新对账 / Re-reconcile — 对**这次运行的同一个业务日**重跑一遍，然后跳运行
  // 列表（新 run 排最前）。本页钉在一个已过时的 runNo 上，原地刷新只会重载旧数据。
  // 业务日必须传：跑"现在"会去取一份当天根本不存在的外部对账单，一个钱包都查不到
  // （见 utils/reconRunTrigger.ts 顶部注释）。
  const handleReReconcile = async () => {
    if (!run) return;
    setReconciling(true);
    try {
      const ok = await triggerWalletReconRun(run.businessDate);
      if (ok) navigate('/admin/reconciliation/runs');
    } finally {
      setReconciling(false);
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
            </div>
            {run.legacy ? (
              <div className="mt-3 rounded-md border border-adm-border bg-adm-bg px-4 py-3 font-mono text-[13px] text-adm-t2">
                Legacy run — no snapshot data (pre-Round3)
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
                {run.invariantStatus === 'PASS'
                  ? `PASS — ${summary.walletCount} wallets checked: all matched`
                  : `BREAK — ${summary.walletCount} wallets checked: ${summary.matchedCount} matched, ${summary.inTransitCount} in transit, ${needsAttention} need attention`}
              </div>
            )}
          </div>

          {/* 2. Health Check — five bucket cards. Click to filter the table below
              (local filter, no refetch). Total card clears the filter. */}
          <DetailCard title="Health Check" columns={1}>
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
                  Total Wallets
                </div>
                <div className="mt-1 text-[28px] font-bold leading-tight text-adm-t1">
                  {summary.walletCount}
                </div>
              </button>

              {(['MATCHED', 'IN_TRANSIT', 'COMPENSATING', 'BREAK'] as const).map((bucket) => {
                const label = BUCKET_LABELS[bucket];
                const tone = TONE_CLASSES[label.tone];
                const count =
                  bucket === 'MATCHED' ? summary.matchedCount :
                  bucket === 'IN_TRANSIT' ? summary.inTransitCount :
                  bucket === 'COMPENSATING' ? summary.softFlagCount :
                  summary.breakCount;
                const active = bucketFilter === bucket;
                const hasCount = count > 0;
                const Icon = bucket === 'MATCHED' ? Check : bucket === 'IN_TRANSIT' ? Clock : AlertTriangle;
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
                      <Icon size={11} />
                      {label.en}
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

          {/* 3. Case Flow — opened / re-observed / closed this run, compressed to
              one slim strip: three inline numbers + a right-aligned link to the
              cases list filtered by this run (own row below Health Check,
              confirmed in brainstorm — not side-by-side). */}
          <DetailCard title="Case Flow" columns={1}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-7">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Opened
                  </span>
                  <span className="text-[20px] font-bold text-adm-t1">{summary.openedCount}</span>
                </div>
                <div className="h-[22px] w-px bg-adm-border" />
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Re-Observed
                  </span>
                  <span className="text-[20px] font-bold text-adm-t1">{summary.reObservedCount}</span>
                </div>
                <div className="h-[22px] w-px bg-adm-border" />
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-adm-green">
                    Closed
                  </span>
                  <span className="text-[20px] font-bold text-adm-green">{summary.closedCount}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={goToCasesForRun}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
              >
                View all cases for this run <ArrowRight size={11} />
              </button>
            </div>
          </DetailCard>

          {/* 4. Account Status snapshot table — filter state now lives in the
              card title (no separate utilities row); "view all cases" only
              lives in the Case Flow strip above, not duplicated here. */}
          <DetailCard
            title={`Account Status · ${bucketFilter ? `Filtered: ${BUCKET_LABELS[bucketFilter].en}` : `All buckets (${accountTable.length})`}`}
            columns={1}
          >
            {run.legacy ? (
              <div className="rounded-md border border-adm-border bg-adm-bg px-4 py-3 font-mono text-[13px] text-adm-t2">
                Legacy run — no snapshot data (pre-Round3)
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Wallet
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
                        In-Transit
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Flow Lines
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
                        const flowWords = [
                          `${row.flowMatched} matched`,
                          row.flowMismatch > 0 && `${row.flowMismatch} mismatch`,
                          row.flowOrphanInternal > 0 && `${row.flowOrphanInternal} internal-only`,
                          row.flowOrphanExternal > 0 && `${row.flowOrphanExternal} external-only`,
                          row.inTransitCount > 0 && `${row.inTransitCount} in-transit`,
                        ].filter(Boolean).join(' · ');
                        return (
                          <tr
                            key={row.walletRef}
                            onClick={() => clickable && onRowClick(row)}
                            className={[
                              'transition-colors',
                              clickable ? 'cursor-pointer hover:bg-adm-hover' : 'cursor-default',
                            ].join(' ')}
                          >
                            {/* Wallet — walletNo primary, role secondary */}
                            <td className="px-3 py-2.5">
                              <div className="font-mono text-[11px] font-semibold text-adm-t1">
                                {displayWallet}
                              </div>
                              <div className="font-mono text-[10px] text-adm-t3">
                                {row.walletRole ?? '(unknown)'}
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
                              {formatAmount(row.internal.balance, row.decimals)}
                            </td>
                            {/* External */}
                            <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                              {formatAmount(row.external.balance, row.decimals)}
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
                              {formatAmount(row.delta, row.decimals)}
                            </td>
                            {/* In-Transit — em dash gray when zero, blue when non-zero */}
                            <td
                              className={[
                                'px-3 py-2.5 text-right font-mono text-[11px]',
                                inTransitZero ? 'text-adm-t3' : 'text-adm-blue',
                              ].join(' ')}
                            >
                              {inTransitZero ? '—' : formatAmount(row.inTransitAmount, row.decimals)}
                            </td>
                            {/* Flow Lines — plain-words summary, non-zero items only */}
                            <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                              {flowWords}
                            </td>
                            {/* Status */}
                            <td className="px-3 py-2.5">
                              <StatusBadge value={row.bucket} />
                            </td>
                            {/* Case */}
                            <td
                              className={[
                                'px-3 py-2.5 font-mono text-[11px]',
                                row.caseNo ? 'text-adm-blue' : 'text-adm-t3',
                              ].join(' ')}
                            >
                              {row.caseNo ?? '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </DetailCard>

        </div>

        {/* ── Sidebar ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {/* ACTIONS — Re-reconcile (fires a fresh wallet run so pushed-then-CLEARED
              funds orders get re-observed and cases closed). */}
          <SidebarGroup title="Actions">
            <button
              type="button"
              disabled={reconciling}
              onClick={handleReReconcile}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-adm-blue/40 bg-adm-blue/10 px-3 py-2 font-mono text-[12px] font-semibold text-adm-blue transition-colors hover:bg-adm-blue/20 disabled:opacity-50"
            >
              <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
              Re-reconcile
            </button>
          </SidebarGroup>

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

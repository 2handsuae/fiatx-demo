// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
//
// "Driver cockpit" — Run detail. Single engine (per-wallet); engine column
// removed because there's no other engine to compare against.
//
// Headline status follows the industry "balance first" convention with a
// fake-match probe on top:
//   • MATCH       — balance OK AND flows OK             (green)
//   • FLOW_REVIEW — balance OK BUT flow line-items off  (amber — Soft Flag)
//   • BREAK       — balance != external                 (red — Hard Break)
//
// Layout (top → bottom):
//   1. Header + Hero
//   2. Overview — 4 equal tiles: Accounts / Match / Hard Break / Soft Flag
//   3. Account Status table — one row per wallet; click any non-MATCH row to its case
//   4. Technical (trace + run id)
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight, ArrowUpDown } from 'lucide-react';
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

interface ReconCaseLink {
  caseNo: string;
  assetCode: string;
  book: string | null;
  status: string;
  deltaAmount: string;
}

type AccountStatusRowStatus = 'MATCH' | 'FLOW_REVIEW' | 'BREAK';

interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;      // business key; null for XREF synthetic rows
  walletRole?: string | null;
  ownerNo?: string | null;
  ownerName?: string | null;
  asset: string;
  coaCode: string;
  internal: { balance: string };
  external: { balance: string };
  delta: string;
  flowMatched: number;
  flowTotal: number;
  flowOrphanInternal: number;
  flowOrphanExternal: number;
  flowMismatch: number;
  status: AccountStatusRowStatus;
  caseId?: string | null;
  caseNo?: string | null;
}

interface RunDetailSummary {
  accountsChecked: number;
  matchCount: number;
  flowReviewCount: number;
  breakCount: number;
  // Kept on the wire for compat with non-cockpit callers; not rendered here.
  balanceBreakCount: number;
  orphanCount: number;
  mismatchCount: number;
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
  cases?: ReconCaseLink[];
  accountStatusTable?: AccountStatusRow[];
  summary?: RunDetailSummary;
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

// Status badge for the AccountStatusRow.status enum — distinct from StatusPill
// because the cockpit needs three semantic colours that don't map to the
// trading-status palette. MATCH=green, FLOW_REVIEW=amber (SOFT FLAG), BREAK=red (HARD BREAK).
const STATUS_BADGE: Record<AccountStatusRowStatus, { cls: string; icon: 'ok' | 'warn'; label: string }> = {
  MATCH:       { cls: 'border-adm-green/30 bg-adm-green/10 text-adm-green', icon: 'ok',   label: 'Match' },
  FLOW_REVIEW: { cls: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber', icon: 'warn', label: 'Soft flag' },
  BREAK:       { cls: 'border-adm-red/30 bg-adm-red/10 text-adm-red',       icon: 'warn', label: 'Hard break' },
};

const StatusBadge = ({ value }: { value: AccountStatusRowStatus }) => {
  const meta = STATUS_BADGE[value];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${meta.cls}`}
    >
      {meta.icon === 'ok' ? <Check size={10} /> : <AlertTriangle size={10} />}
      {meta.label}
    </span>
  );
};

// Sort priority for status column — BREAK first (hard, act now),
// FLOW_REVIEW next (investigate), MATCH last (done).
const STATUS_RANK: Record<AccountStatusRowStatus, number> = {
  BREAK: 0,
  FLOW_REVIEW: 1,
  MATCH: 2,
};

type SortKey = 'status' | 'delta' | 'asset';
type SortDir = 'asc' | 'desc';

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationRunsDetailPage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<ReconRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyBreaks, setOnlyBreaks] = useState(true); // cockpit default: show problems first
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
  // stable across re-renders (avoids the React-hooks lint rule).
  const visibleRows = useMemo(() => {
    if (!run?.accountStatusTable) return [] as AccountStatusRow[];
    const filtered = onlyBreaks
      ? run.accountStatusTable.filter((r) => r.status !== 'MATCH')
      : [...run.accountStatusTable];
    const dirMul = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'status') {
        cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status];
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
  }, [run, onlyBreaks, sortKey, sortDir]);

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
    accountsChecked: 0,
    matchCount: 0,
    flowReviewCount: 0,
    breakCount: 0,
    balanceBreakCount: 0,
    orphanCount: 0,
    mismatchCount: 0,
  };
  const accountTable = run.accountStatusTable ?? [];

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'status' ? 'asc' : 'desc'); // status: breaks first; others: largest first
    }
  };

  const onRowClick = (row: AccountStatusRow) => {
    if (row.status === 'MATCH') return; // MATCH rows: no-op (read-only)
    if (!row.caseNo) return;
    navigate(`/admin/reconciliation/cases/${encodeURIComponent(row.caseNo)}`);
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
          {/* 1. Hero */}
          <div className="bg-adm-card px-6 py-5">
            <div className="font-mono text-[19px] font-bold text-adm-amber">{run.runNo}</div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={run.status} size="md" />
                </span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Business Date
                </span>
                <span className="font-mono text-adm-t1">{run.businessDate}</span>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                  Invariant Status
                </span>
                <span className="mt-1 inline-block">
                  <StatusPill value={run.invariantStatus} size="md" />
                </span>
              </div>
              {run.hasDemoManifest && (
                <div>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Demo
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/admin/reconciliation/demo-compare/${encodeURIComponent(run.runNo)}`)
                    }
                    className="mt-1 inline-flex items-center gap-1 rounded border border-adm-amber/40 bg-adm-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-adm-amber transition-colors hover:bg-adm-amber/20"
                  >
                    Demo 对比 <ArrowRight size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 2. Overview — four equal cards (Accounts / Match / HARD BREAK / SOFT FLAG).
              HARD BREAK = balance != external; SOFT FLAG = balance OK but flow
              line-items have orphan/mismatch (the "fake match" probe). */}
          <DetailCard title="Overview" columns={1}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  {/* Accounts checked — the headline scope. */}
                <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                    Accounts Checked
                  </div>
                  <div className="mt-1 text-[28px] font-bold leading-tight text-adm-t1">
                    {summary.accountsChecked}
                  </div>
                </div>
                {/* Match */}
                <div className="rounded-lg border border-adm-green/30 bg-adm-green/5 p-4">
                  <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-adm-green">
                    <Check size={11} /> Match
                  </div>
                  <div className="mt-1 text-[28px] font-bold leading-tight text-adm-green">
                    {summary.matchCount}
                  </div>
                </div>
                {/* HARD BREAK — balance != external */}
                <div
                  className={`rounded-lg border p-4 ${summary.breakCount > 0 ? 'border-adm-red/30 bg-adm-red/5' : 'border-adm-border bg-adm-bg'}`}
                >
                  <div
                    className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider ${summary.breakCount > 0 ? 'text-adm-red' : 'text-adm-t3'}`}
                  >
                    <AlertTriangle size={11} /> Hard Break
                  </div>
                  <div
                    className={`mt-1 text-[28px] font-bold leading-tight ${summary.breakCount > 0 ? 'text-adm-red' : 'text-adm-t1'}`}
                  >
                    {summary.breakCount}
                  </div>
                </div>
                {/* SOFT FLAG — balance OK but flow line-items off */}
                <div
                  className={`rounded-lg border p-4 ${summary.flowReviewCount > 0 ? 'border-adm-amber/30 bg-adm-amber/5' : 'border-adm-border bg-adm-bg'}`}
                  title="Balance matched, but flow line-items have orphan/mismatch — fake-match probe"
                >
                  <div
                    className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider ${summary.flowReviewCount > 0 ? 'text-adm-amber' : 'text-adm-t3'}`}
                  >
                    <AlertTriangle size={11} /> Soft Flag
                  </div>
                  <div
                    className={`mt-1 text-[28px] font-bold leading-tight ${summary.flowReviewCount > 0 ? 'text-adm-amber' : 'text-adm-t1'}`}
                  >
                    {summary.flowReviewCount}
                  </div>
                </div>
              </div>

              {/* Self-heal chip — only shown when this run auto-healed prior breaks. */}
              {run.closedCount > 0 && (
                <div className="inline-flex w-fit items-center gap-2 rounded-md border border-adm-green/30 bg-adm-green/5 px-3 py-1.5 font-mono text-[11px] text-adm-green">
                  <Check size={12} />
                  Auto-healed {run.closedCount} case{run.closedCount === 1 ? '' : 's'} from previous runs
                </div>
              )}
            </div>
          </DetailCard>

          {/* 4. Account Status Table */}
          <DetailCard title="Account Status" columns={1}>
              <div className="flex flex-col gap-3">
                {/* Filter + utilities row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex rounded border border-adm-border bg-adm-bg p-0.5">
                    <button
                      type="button"
                      onClick={() => setOnlyBreaks(true)}
                      className={[
                        'rounded px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                        onlyBreaks
                          ? 'bg-adm-amber text-adm-bg font-semibold'
                          : 'text-adm-t3 hover:text-adm-t1',
                      ].join(' ')}
                    >
                      Only Breaks
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyBreaks(false)}
                      className={[
                        'rounded px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                        !onlyBreaks
                          ? 'bg-adm-amber text-adm-bg font-semibold'
                          : 'text-adm-t3 hover:text-adm-t1',
                      ].join(' ')}
                    >
                      All
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/reconciliation/cases?runNo=${encodeURIComponent(run.runNo)}`)}
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-adm-border">
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                          >
                            {accountTable.length === 0
                              ? 'No accounts in this run.'
                              : 'No breaks. Switch to "All" to see matched accounts.'}
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row) => {
                          const clickable = row.status !== 'MATCH' && !!row.caseNo;
                          const deltaZero = isZeroAmount(row.delta);
                          const displayWallet = row.walletNo ?? row.walletRef.slice(0, 8);
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
                              {/* Owner */}
                              <td className="px-3 py-2.5">
                                {row.ownerNo ? (
                                  <div>
                                    <div className="text-[12px] text-adm-t1">{row.ownerName ?? '—'}</div>
                                    <div className="font-mono text-[10px] text-adm-t3">{row.ownerNo}</div>
                                  </div>
                                ) : (
                                  <span className="text-adm-t3">—</span>
                                )}
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
                              {/* Flows */}
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                                  <span className="text-adm-t1">
                                    {row.flowMatched}/{row.flowTotal}
                                  </span>
                                  {row.flowOrphanInternal > 0 && (
                                    <span
                                      title="Internal-only flows (no external counterpart)"
                                      className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[9px] text-amber-500"
                                    >
                                      OI {row.flowOrphanInternal}
                                    </span>
                                  )}
                                  {row.flowOrphanExternal > 0 && (
                                    <span
                                      title="External-only flows (no internal counterpart)"
                                      className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[9px] text-amber-500"
                                    >
                                      OE {row.flowOrphanExternal}
                                    </span>
                                  )}
                                  {row.flowMismatch > 0 && (
                                    <span
                                      title="Matched pairs with amount mismatch"
                                      className="rounded border border-adm-amber/30 bg-adm-amber/10 px-1 text-[9px] text-adm-amber"
                                    >
                                      MM {row.flowMismatch}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* Status */}
                              <td className="px-3 py-2.5">
                                <StatusBadge value={row.status} />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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

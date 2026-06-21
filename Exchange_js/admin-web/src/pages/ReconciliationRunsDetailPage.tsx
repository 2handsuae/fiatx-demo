// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
import { useEffect, useState, Fragment, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Check, AlertTriangle, ArrowRight } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface InvariantCheck {
  id: string;
  invariantCode: string;
  currency: string | null;
  lhsLabel: string;
  lhsValue: string;
  rhsLabel: string;
  rhsValue: string;
  delta: string;
  status: string;
  severity: string;
  createdAt: string;
}

// Cases this run last touched — lets a failing (currency, book) scorecard cell link to its case.
interface ReconCaseLink {
  caseNo: string;
  assetCode: string;
  book: string | null;
  status: string;
  deltaAmount: string;
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
  invariantChecks: InvariantCheck[];
  cases?: ReconCaseLink[];
}

/* ── Constants ──────────────────────────────────────────────── */

const TRIGGER_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  MANUAL: 'Manual',
  POST_FIX: 'Post-Fix',
};

// Severity classes mapped onto the four available adm-* semantic colors.
const SEVERITY_TONE: Record<string, string> = {
  SAFEGUARDING: 'border-adm-red/30 bg-adm-red/10 text-adm-red',
  ATTESTATION: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  BUSINESS: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  ACCOUNT_ACTUAL: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
};

// Redesign (5-formula) runs carry layer=REDESIGN; their invariantChecks hold 式1..式5.
const isRedesignRun = (layer: string) => layer === 'REDESIGN';
const FORMULA_ORDER = ['式1', '式2', '式3', '式4', '式5'];

// English label per formula (spec 2026-06-20 §3) — UI copy stays English.
const FORMULA_LABEL: Record<string, string> = {
  式1: 'Trial Balance (ledger-wide = 0)',
  式2: 'Client Tie-out (client block ↔ open outstanding)',
  式3: 'Bridge Tie-out (bridge block ↔ unswept swap)',
  式4: 'Client Off-book (client pool ↔ external ± in-transit)',
  式5: 'Firm Off-book (firm treasury ↔ external ± in-transit)',
};
const FORMULA_TAG: Record<string, string> = {
  式1: 'F1', 式2: 'F2', 式3: 'F3', 式4: 'F4', 式5: 'F5',
};

// Layering axis (spec 2026-06-20 §3): each currency splits into three lanes by scope/book.
//   Ledger-wide — 式1 Trial Balance + 式3 Bridge Tie-out (system/integrity checks).
//   Client      — 式2 Client Tie-out + 式4 Client Off-book.
//   Firm        — 式5 Firm Off-book.
type LaneKey = 'LEDGER' | 'CLIENT' | 'FIRM';
const LANES: { key: LaneKey; label: string; formulas: string[] }[] = [
  { key: 'LEDGER', label: 'Ledger-wide', formulas: ['式1', '式3'] },
  { key: 'CLIENT', label: 'Client', formulas: ['式2', '式4'] },
  { key: 'FIRM', label: 'Firm', formulas: ['式5'] },
];
// Lane accent (adm-* semantic colors only): Ledger=blue (system), Client=amber, Firm=green.
const LANE_TONE: Record<LaneKey, string> = {
  LEDGER: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  CLIENT: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber',
  FIRM: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
};

const fmtTrigger = (t: string) => TRIGGER_LABELS[t] || t;
const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

const SeverityPill = ({ value }: { value: string }) => {
  const tone = SEVERITY_TONE[value] || 'border-adm-border bg-adm-bg text-adm-t2';
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold ${tone}`}
    >
      {value}
    </span>
  );
};

// formula code → scope/book lane; short formula tags per lane (matrix row caption).
const SCOPE_OF: Record<string, LaneKey> = {
  式1: 'LEDGER', 式3: 'LEDGER', 式2: 'CLIENT', 式4: 'CLIENT', 式5: 'FIRM',
};
const LANE_SUB: Record<LaneKey, string> = { LEDGER: 'F1 · F3', CLIENT: 'F2 · F4', FIRM: 'F5' };

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

type CellState = { rows: InvariantCheck[]; pass: boolean; worst: InvariantCheck | null };

// Aggregate checks into a scope × currency matrix; each cell carries pass/fail
// and its worst (max |Δ|) failing formula for the at-a-glance scorecard.
function buildScorecard(checks: InvariantCheck[]) {
  const currencies = [...new Set(checks.map((c) => c.currency ?? '—'))].sort();
  const cells = {} as Record<LaneKey, Record<string, CellState>>;
  for (const lane of LANES) {
    cells[lane.key] = {};
    for (const ccy of currencies) {
      const rows = checks
        .filter((c) => (c.currency ?? '—') === ccy && lane.formulas.includes(c.invariantCode))
        .sort((a, b) => FORMULA_ORDER.indexOf(a.invariantCode) - FORMULA_ORDER.indexOf(b.invariantCode));
      const fails = rows.filter((c) => c.status === 'FAIL');
      const worst = fails.reduce<InvariantCheck | null>(
        (m, c) => (!m || Math.abs(num(c.delta)) > Math.abs(num(m.delta)) ? c : m),
        null,
      );
      cells[lane.key][ccy] = { rows, pass: fails.length === 0, worst };
    }
  }
  return { currencies, cells };
}

// One scorecard cell: green when the scope balances for that currency, red with the
// worst failing formula's tag + Δ otherwise. Click selects it for the drill panel.
const MatrixCell = ({
  state,
  active,
  onClick,
}: {
  state: CellState;
  active: boolean;
  onClick: () => void;
}) => {
  if (state.rows.length === 0) {
    return (
      <div className="flex min-h-[66px] items-center justify-center rounded-lg border border-adm-border bg-adm-bg font-mono text-[11px] text-adm-t3">
        —
      </div>
    );
  }
  const ring = active ? 'ring-2 ring-adm-blue ring-offset-1 ring-offset-adm-card' : '';
  if (state.pass) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-[66px] flex-col justify-center rounded-lg border border-adm-green/30 bg-adm-green/10 px-3 py-2.5 text-left transition-colors hover:bg-adm-green/20 ${ring}`}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-adm-green">
          <Check size={13} /> balanced
        </span>
        <span className="mt-1 font-mono text-[10px] text-adm-green/70">
          {state.rows.length} checks · Δ 0
        </span>
      </button>
    );
  }
  const worst = state.worst!;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[66px] flex-col justify-center rounded-lg border border-adm-red/30 bg-adm-red/10 px-3 py-2.5 text-left transition-colors hover:bg-adm-red/20 ${ring}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-adm-red">
          <AlertTriangle size={13} /> break
        </span>
        <span className="shrink-0 rounded border border-adm-red/40 px-1 font-mono text-[9px] font-semibold text-adm-red">
          {FORMULA_TAG[worst.invariantCode]}
        </span>
      </span>
      <span className="mt-1 font-mono text-[16px] font-semibold text-adm-red">Δ {worst.delta}</span>
    </button>
  );
};

// One metric tile in the run-health strip.
const Metric = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="rounded-md border border-adm-border bg-adm-card px-3 py-2">
    <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">{label}</div>
    <div className="mt-0.5 text-[15px] font-semibold text-adm-t1">{children}</div>
  </div>
);

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationRunsDetailPage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<ReconRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Selected scorecard cell for the drill panel; null falls back to the worst cell.
  const [selected, setSelected] = useState<{ scope: LaneKey; ccy: string } | null>(null);

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
    setSelected(null);
    if (runNo) void fetchRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNo]);

  if (loading && !run) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading reconciliation run...</p>
      </div>
    );
  }

  if (!run) return null;

  const checks = run.invariantChecks ?? [];
  const redesign = isRedesignRun(run.layer);

  // Scorecard model (redesign only): scope × currency cells.
  const { currencies, cells } = redesign
    ? buildScorecard(checks)
    : { currencies: [] as string[], cells: {} as Record<LaneKey, Record<string, CellState>> };

  // Run-health roll-up.
  let passCount = 0;
  let failCount = 0;
  let worstChk: InvariantCheck | null = null;
  for (const c of checks) {
    if (c.status === 'FAIL') {
      failCount += 1;
      if (!worstChk || Math.abs(num(c.delta)) > Math.abs(num(worstChk.delta))) worstChk = c;
    } else {
      passCount += 1;
    }
  }
  const ledgerOk = checks
    .filter((c) => c.invariantCode === '式1' || c.invariantCode === '式3')
    .every((c) => c.status === 'PASS');
  const isBreak = failCount > 0;

  // Drill defaults to the worst failing cell (else the first cell).
  const fallbackCell: { scope: LaneKey; ccy: string } = worstChk
    ? { scope: SCOPE_OF[worstChk.invariantCode] ?? 'LEDGER', ccy: worstChk.currency ?? '—' }
    : { scope: 'LEDGER', ccy: currencies[0] ?? '—' };
  const active = selected ?? fallbackCell;
  const activeState: CellState | undefined = cells[active.scope]?.[active.ccy];
  const activeBook = active.scope === 'CLIENT' ? 'CLIENT' : active.scope === 'FIRM' ? 'FIRM' : null;
  const activeCase = run.cases?.find((c) => c.assetCode === active.ccy && c.book === activeBook);

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
                  Layer
                </span>
                <span className="font-mono text-adm-t1">{run.layer}</span>
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

          {/* 2. Run Summary */}
          <DetailCard title="Run Summary" columns={3}>
            <InfoField label="Seq" value={String(run.seq)} mono />
            <InfoField label="Trigger" value={fmtTrigger(run.triggerType)} />
            <InfoField label="Mode" value={run.mode} />
            <InfoField label="Opened Cases" value={String(run.openedCount)} mono />
            <InfoField label="Re-observed" value={String(run.reObservedCount)} mono />
            <InfoField label="Closed Cases" value={String(run.closedCount)} mono />
          </DetailCard>

          {/* 3. Health — scorecard (redesign): verdict strip + scope×currency matrix + drill, OR I1–I5 table (legacy) */}
          {redesign ? (
            <DetailCard title="Reconciliation Health" columns={1}>
              {checks.length === 0 ? (
                <p className="py-6 text-center font-mono text-[11px] text-adm-t3">
                  No formula checks recorded for this run.
                </p>
              ) : (
                <div className="flex flex-col gap-5">
                  {/* ── Verdict + metric strip ── */}
                  <div
                    className={`rounded-lg border p-4 ${isBreak ? 'border-adm-red/30 bg-adm-red/5' : 'border-adm-green/30 bg-adm-green/5'}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-semibold ${isBreak ? 'bg-adm-red/15 text-adm-red' : 'bg-adm-green/15 text-adm-green'}`}
                      >
                        {isBreak ? <AlertTriangle size={14} /> : <Check size={14} />}
                        {isBreak ? 'Break' : 'Balanced'}
                      </span>
                      <span className="font-mono text-[11px] text-adm-t3">
                        {currencies.length} currencies · {LANES.length} scopes · {checks.length} formula checks
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Metric label="Formulas">
                        <span className="text-adm-green">{passCount}</span>
                        <span className="text-adm-t3"> / </span>
                        <span className="text-adm-red">{failCount}</span>
                        <span className="ml-1 text-[10px] font-normal text-adm-t3">pass / fail</span>
                      </Metric>
                      <Metric label="Open cases">{run.openedCount}</Metric>
                      <Metric label="Worst Δ">
                        {worstChk ? (
                          <span className="flex items-baseline gap-1.5">
                            <span className="font-mono text-adm-red">{worstChk.delta}</span>
                            <span className="text-[10px] font-normal text-adm-t3">
                              {worstChk.currency} · {(SCOPE_OF[worstChk.invariantCode] ?? 'LEDGER').toLowerCase()}
                            </span>
                          </span>
                        ) : (
                          <span className="text-adm-green">0</span>
                        )}
                      </Metric>
                      <Metric label="Ledger integrity">
                        {ledgerOk ? (
                          <span className="inline-flex items-center gap-1 text-adm-green">
                            <Check size={14} /> ok
                          </span>
                        ) : (
                          <span className="text-adm-red">break</span>
                        )}
                      </Metric>
                    </div>
                  </div>

                  {/* ── Scorecard matrix: scope (rows) × currency (cols) ── */}
                  <div>
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                      Scorecard · scope × currency
                    </div>
                    <div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: `124px repeat(${currencies.length}, minmax(0, 1fr))` }}
                    >
                      <div />
                      {currencies.map((ccy) => (
                        <div
                          key={ccy}
                          className="pb-1 text-center font-mono text-[12px] font-semibold text-adm-t1"
                        >
                          {ccy}
                        </div>
                      ))}
                      {LANES.map((lane) => (
                        <Fragment key={lane.key}>
                          <div className="flex flex-col justify-center">
                            <span
                              className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${LANE_TONE[lane.key]}`}
                            >
                              {lane.label}
                            </span>
                            <span className="mt-0.5 font-mono text-[9px] text-adm-t3">{LANE_SUB[lane.key]}</span>
                          </div>
                          {currencies.map((ccy) => (
                            <MatrixCell
                              key={ccy}
                              state={cells[lane.key][ccy]}
                              active={active.scope === lane.key && active.ccy === ccy}
                              onClick={() => setSelected({ scope: lane.key, ccy })}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>

                  {/* ── Drill panel: selected cell's formulas + linked case ── */}
                  {activeState && (
                    <div className="rounded-lg border border-adm-border bg-adm-bg p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${LANE_TONE[active.scope]}`}
                          >
                            {LANES.find((l) => l.key === active.scope)?.label}
                          </span>
                          <span className="font-mono text-[14px] font-bold text-adm-t1">{active.ccy}</span>
                        </div>
                        {activeCase ? (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/admin/reconciliation/cases/${encodeURIComponent(activeCase.caseNo)}`)
                            }
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
                          >
                            {activeCase.caseNo} <ArrowRight size={12} />
                          </button>
                        ) : activeState.pass ? (
                          <span className="font-mono text-[11px] text-adm-green">no case · balanced</span>
                        ) : null}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-adm-border">
                              {['Chk', 'Formula', 'Internal', '', 'External', 'Result'].map((h, i) => (
                                <th
                                  key={i}
                                  className={`pb-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-adm-t3 ${h === 'Result' ? 'text-right' : 'text-left'}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-adm-border">
                            {activeState.rows.map((c) => (
                              <tr key={c.id}>
                                <td className="py-2 pr-2 align-top">
                                  <span className="rounded border border-adm-border bg-adm-panel px-1.5 py-0.5 font-mono text-[10px] font-semibold text-adm-amber">
                                    {FORMULA_TAG[c.invariantCode]}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 align-top text-[12px] text-adm-t2">
                                  {FORMULA_LABEL[c.invariantCode] ?? c.lhsLabel}
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <div className="text-[9px] text-adm-t3">{c.lhsLabel}</div>
                                  <div className="font-mono text-[12px] text-adm-t1">{c.lhsValue}</div>
                                </td>
                                <td className="px-1 py-2 text-center align-middle text-adm-t3">↔</td>
                                <td className="py-2 pr-3 align-top">
                                  <div className="text-[9px] text-adm-t3">{c.rhsLabel}</div>
                                  <div className="font-mono text-[12px] text-adm-t1">{c.rhsValue}</div>
                                </td>
                                <td className="py-2 text-right align-top">
                                  <div
                                    className={`mb-1 font-mono text-[12px] font-semibold ${c.status === 'FAIL' ? 'text-adm-red' : 'text-adm-green'}`}
                                  >
                                    {c.status === 'FAIL' ? `Δ ${c.delta}` : '✓'}
                                  </div>
                                  <StatusPill value={c.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </DetailCard>
          ) : (
            <DetailCard title="Invariant Attestation (I1–I5)" columns={1}>
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      {['Code', 'Currency', 'Severity', 'LHS', 'RHS', 'Δ', 'Status'].map((h) => (
                        <th
                          key={h}
                          className={`px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3 ${h === 'Δ' ? 'text-right' : 'text-left'}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {checks.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                        >
                          No invariant checks recorded for this run.
                        </td>
                      </tr>
                    ) : (
                      checks.map((check) => (
                        <tr key={check.id} className="transition-colors hover:bg-adm-hover">
                          <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                            {check.invariantCode}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                            {check.currency || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <SeverityPill value={check.severity} />
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                            <span className="text-adm-t3">{check.lhsLabel} = </span>
                            <span className="font-mono text-adm-t1">{check.lhsValue}</span>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-adm-t2">
                            <span className="text-adm-t3">{check.rhsLabel} = </span>
                            <span className="font-mono text-adm-t1">{check.rhsValue}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                            {check.delta}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill value={check.status} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </DetailCard>
          )}

          {/* 4. Technical (LAST) */}
          <DetailCard title="Technical" columns={2}>
            <InfoField label="Trace ID" value={run.traceId} mono />
            <InfoField label="Run ID" value={run.id} mono />
          </DetailCard>
        </div>

        {/* ── Sidebar (no Actions block — read-only) ── */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity">
            <SidebarKV label="Run No" value={run.runNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={run.status} />} />
            <SidebarKV label="Layer" value={run.layer} mono />
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

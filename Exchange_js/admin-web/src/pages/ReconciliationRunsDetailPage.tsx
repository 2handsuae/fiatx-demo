// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
import { useEffect, useState, type ReactNode } from 'react';
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

// Cases this run last touched — lets a failing formula row link to its (currency, book) case.
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

type Scope = 'CLIENT' | 'FIRM' | 'LEDGER';

// COA-code makeup per formula — mirrors engine/formula-checker.service.ts blocks
// (CLIENT_BLOCK_CODES / CLIENT_POOL_CODES / BRIDGE_BLOCK_CODES / FIRM_POOL_CODE). Keep in sync.
// lhsCodes = internal ledger side (concrete COA codes); rhsTerm = external/subledger quantity
// (no single COA account → kept descriptive); null rhsTerm = identity that must net to 0.
const FORMULA_COMPONENTS: Record<
  string,
  { scope: Scope; name: string; lhsCodes: string; rhsTerm: string | null }
> = {
  式2: {
    scope: 'CLIENT',
    name: 'Client tie-out',
    lhsCodes: 'A.CLIENT_BANK + A.CLIENT_CUSTODY + L.CLIENT_PAYABLE + L.DEPOSIT_SUSPENSE',
    rhsTerm: 'open outstanding − unsettled w/d fee',
  },
  式4: {
    scope: 'CLIENT',
    name: 'Client off-book',
    lhsCodes: 'A.CLIENT_BANK + A.CLIENT_CUSTODY',
    rhsTerm: 'external ± in-transit',
  },
  式5: {
    scope: 'FIRM',
    name: 'Firm off-book',
    lhsCodes: 'A.FIRM_TREASURY',
    rhsTerm: 'external ± in-transit',
  },
  式1: {
    scope: 'LEDGER',
    name: 'Trial balance',
    lhsCodes: 'Σ all accounts (client + bridge + firm)',
    rhsTerm: null,
  },
  式3: {
    scope: 'LEDGER',
    name: 'Bridge tie-out',
    lhsCodes: 'L.TRADE_CLEARING',
    rhsTerm: 'unswept swap',
  },
};

// Tab-internal display order: Client → Firm → Ledger-wide.
const FORMULA_DISPLAY_ORDER = ['式2', '式4', '式5', '式1', '式3'];

const SCOPE_META: Record<Scope, { label: string; tone: string; book: 'CLIENT' | 'FIRM' | null }> = {
  CLIENT: { label: 'Client', tone: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber', book: 'CLIENT' },
  FIRM: { label: 'Firm', tone: 'border-adm-green/30 bg-adm-green/10 text-adm-green', book: 'FIRM' },
  LEDGER: { label: 'Ledger-wide', tone: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue', book: null },
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

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// One formula row: scope badge + short name + COA-code equation on the left;
// net Δ on the right (Δ=0 → green pass, Δ≠0 → red break + link to that scope's case).
const FormulaRow = ({
  check,
  prevScope,
  caseNo,
  onCase,
}: {
  check: InvariantCheck;
  prevScope: Scope | undefined;
  caseNo: string | null;
  onCase: () => void;
}) => {
  const comp = FORMULA_COMPONENTS[check.invariantCode];
  if (!comp) return null;
  const scope = SCOPE_META[comp.scope];
  const fail = check.status === 'FAIL';
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border border-adm-border bg-adm-bg px-3.5 py-3 ${
        prevScope && prevScope !== comp.scope ? 'mt-1.5' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${scope.tone}`}
          >
            {scope.label}
          </span>
          <span className="text-[13px] text-adm-t1">{comp.name}</span>
        </div>
        <div className="mt-1.5 leading-relaxed">
          <span className="font-mono text-[12px] text-adm-t2">{comp.lhsCodes}</span>{' '}
          <span className="font-mono text-[12px] font-semibold text-adm-t1">{check.lhsValue}</span>
          {comp.rhsTerm ? (
            <>
              <span className="px-1.5 font-mono text-[12px] text-adm-t3">↔</span>
              <span className="font-mono text-[12px] text-adm-t2">{comp.rhsTerm}</span>{' '}
              <span className="font-mono text-[12px] font-semibold text-adm-t1">{check.rhsValue}</span>
            </>
          ) : (
            <span className="px-1.5 font-mono text-[12px] text-adm-t3">→ 0</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5" style={{ minWidth: 120 }}>
        {fail ? (
          <span className="font-mono text-[15px] font-semibold text-adm-red">Δ {check.delta}</span>
        ) : (
          <span className="flex items-center gap-1 font-mono text-[14px] text-adm-green">
            <Check size={13} /> {check.delta}
          </span>
        )}
        <StatusPill value={check.status} />
        {fail && caseNo && (
          <button
            type="button"
            onClick={onCase}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
          >
            {caseNo} <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
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
  // Selected asset tab; null falls back to the first asset with a break (else the first asset).
  const [activeCcy, setActiveCcy] = useState<string | null>(null);

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
    setActiveCcy(null);
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

  // Currencies present in this run's checks (redesign only).
  const currencies = redesign ? [...new Set(checks.map((c) => c.currency ?? '—'))].sort() : [];

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

  // Active tab defaults to the first asset with a break, else the first asset.
  const firstBreakCcy = currencies.find((ccy) =>
    checks.some((c) => (c.currency ?? '—') === ccy && c.status === 'FAIL'),
  );
  const activeCurrency = activeCcy ?? firstBreakCcy ?? currencies[0] ?? null;

  // The active asset's five formulas, ordered Client → Firm → Ledger-wide.
  const activeRows = activeCurrency
    ? checks
        .filter((c) => (c.currency ?? '—') === activeCurrency)
        .sort(
          (a, b) =>
            FORMULA_DISPLAY_ORDER.indexOf(a.invariantCode) -
            FORMULA_DISPLAY_ORDER.indexOf(b.invariantCode),
        )
    : [];

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

          {/* 3. Health — redesign: verdict strip + asset tabs + per-formula list, OR I1–I5 table (legacy) */}
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
                        {currencies.length} currencies · 3 scopes · {checks.length} formula checks
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
                              {worstChk.currency} · {(FORMULA_COMPONENTS[worstChk.invariantCode]?.scope ?? 'LEDGER').toLowerCase()}
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

                  {/* ── Asset tabs ── */}
                  <div className="border-b border-adm-border pb-3">
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                      Assets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {currencies.map((ccy) => {
                        const broke = checks.some(
                          (c) => (c.currency ?? '—') === ccy && c.status === 'FAIL',
                        );
                        const isActive = ccy === activeCurrency;
                        return (
                          <button
                            key={ccy}
                            type="button"
                            onClick={() => setActiveCcy(ccy)}
                            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 font-mono text-[13px] transition-colors ${
                              isActive
                                ? 'border-adm-amber/50 bg-adm-amber/10 text-adm-amber'
                                : 'border-adm-border text-adm-t2 hover:bg-adm-hover'
                            }`}
                          >
                            {ccy}
                            {broke && (
                              <span className="h-1.5 w-1.5 rounded-full bg-adm-red" aria-label="break" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Active asset · five formulas (Client → Firm → Ledger-wide) ── */}
                  <div className="flex flex-col gap-2">
                    {activeRows.map((c, i) => {
                      const comp = FORMULA_COMPONENTS[c.invariantCode];
                      const book = comp ? SCOPE_META[comp.scope].book : null;
                      const kase = book
                        ? run.cases?.find((k) => k.assetCode === activeCurrency && k.book === book)
                        : undefined;
                      return (
                        <FormulaRow
                          key={c.id}
                          check={c}
                          prevScope={
                            i > 0 ? FORMULA_COMPONENTS[activeRows[i - 1].invariantCode]?.scope : undefined
                          }
                          caseNo={kase?.caseNo ?? null}
                          onCase={() =>
                            kase &&
                            navigate(`/admin/reconciliation/cases/${encodeURIComponent(kase.caseNo)}`)
                          }
                        />
                      );
                    })}
                  </div>
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

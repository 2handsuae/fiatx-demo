// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
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
  invariantChecks: InvariantCheck[];
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

// One formula row (tag F1–F5, English label, Δ, PASS/FAIL pill) — shared across the three lanes.
const FormulaRow = ({ check }: { check: InvariantCheck }) => (
  <div className="flex items-center justify-between rounded-lg border border-adm-border bg-adm-bg px-4 py-2.5">
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 rounded border border-adm-border bg-adm-panel px-1.5 py-0.5 font-mono text-[10px] font-semibold text-adm-amber">
        {FORMULA_TAG[check.invariantCode] ?? check.invariantCode}
      </span>
      <span className="truncate text-[12px] text-adm-t2">
        {FORMULA_LABEL[check.invariantCode] ?? check.lhsLabel}
      </span>
    </div>
    <div className="flex shrink-0 items-center gap-4">
      <span className="font-mono text-[11px] text-adm-t3">
        Δ <span className="text-adm-t1">{check.delta}</span>
      </span>
      <StatusPill value={check.status} />
    </div>
  </div>
);

// One scope/book lane (Ledger-wide / Client / Firm) holding its formula rows.
const FormulaLane = ({
  lane,
  rows,
}: {
  lane: (typeof LANES)[number];
  rows: InvariantCheck[];
}) => (
  <div className="rounded-lg border border-adm-border bg-adm-card p-3">
    <div className="mb-2 flex items-center gap-2">
      <span
        className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${LANE_TONE[lane.key]}`}
      >
        {lane.label}
      </span>
    </div>
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 ? (
        <p className="px-1 py-1 font-mono text-[10px] text-adm-t3">No formula in this lane.</p>
      ) : (
        rows.map((check) => <FormulaRow key={check.id} check={check} />)
      )}
    </div>
  </div>
);

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationRunsDetailPage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<ReconRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Group checks by currency, formulas ordered 式1..式5 (redesign run rendering only).
  const currencyGroups: [string, InvariantCheck[]][] = (() => {
    const map = new Map<string, InvariantCheck[]>();
    for (const c of checks) {
      const ccy = c.currency ?? '—';
      if (!map.has(ccy)) map.set(ccy, []);
      map.get(ccy)!.push(c);
    }
    for (const rows of map.values()) {
      rows.sort(
        (a, b) => FORMULA_ORDER.indexOf(a.invariantCode) - FORMULA_ORDER.indexOf(b.invariantCode),
      );
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

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

          {/* 3. Attestation — per currency × (Ledger / Client / Firm) lanes (redesign) OR I1–I5 table (legacy) */}
          {isRedesignRun(run.layer) ? (
            <DetailCard title="Reconciliation Formulas (currency × client/firm)" columns={1}>
              {checks.length === 0 ? (
                <p className="py-6 text-center font-mono text-[11px] text-adm-t3">
                  No formula checks recorded for this run.
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  {currencyGroups.map(([ccy, rows]) => {
                    const byCode = new Map(rows.map((r) => [r.invariantCode, r]));
                    return (
                      <div key={ccy}>
                        <div className="mb-2.5 flex items-center gap-2">
                          <span className="font-mono text-[13px] font-bold text-adm-t1">{ccy}</span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                            5-formula · 3 lanes
                          </span>
                        </div>
                        {/* Three labeled lanes make the currency × client/firm layering explicit. */}
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                          {LANES.map((lane) => (
                            <FormulaLane
                              key={lane.key}
                              lane={lane}
                              rows={lane.formulas
                                .map((code) => byCode.get(code))
                                .filter((c): c is InvariantCheck => Boolean(c))}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
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

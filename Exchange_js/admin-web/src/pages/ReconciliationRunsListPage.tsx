// admin-web/src/pages/ReconciliationRunsListPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { StatusPill } from '../components/ui/StatusPill';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';

/* ── Interfaces ──────────────────────────────────────────────── */

interface ReconRun {
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
  // Phase B engine stamp — V8_FORMULA (legacy credit-net) | WALLET_V1 (per-wallet).
  engineVersion: string;
}

// Phase B per-wallet engine is the new default surface; All keeps the historical view discoverable.
type EngineFilter = 'WALLET_V1' | 'V8_FORMULA' | 'ALL';

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 25;

// Trigger labels — English copy, rendered as adm-* small pills (no raw colors).
const TRIGGER_LABELS: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'border-adm-border bg-adm-bg text-adm-t2' },
  MANUAL: { label: 'Manual', tone: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue' },
  POST_FIX: { label: 'Post-Fix', tone: 'border-adm-amber/30 bg-adm-amber/10 text-adm-amber' },
};

// Engine version pill tones — keep WALLET_V1 distinct as the new live engine.
const ENGINE_LABELS: Record<string, { label: string; tone: string }> = {
  WALLET_V1: { label: 'Wallet v1', tone: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue' },
  V8_FORMULA: { label: 'V8 Formula', tone: 'border-adm-border bg-adm-bg text-adm-t2' },
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationRunsListPage = () => {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Default to WALLET_V1 — that's the Phase B engine new runs are stamped with.
  // Switch to V8_FORMULA to inspect legacy credit-net runs, or ALL for the full history.
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('WALLET_V1');

  const fetchRuns = async (engine: EngineFilter = engineFilter) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${import.meta.env.VITE_API_URL}/admin/reconciliation/runs`);
      if (engine !== 'ALL') url.searchParams.set('engineVersion', engine);
      const res = await adminFetch(url.toString());
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation runs.'));
      const result = await res.json();
      const rows: ReconRun[] = Array.isArray(result) ? result : (result.items ?? []);
      setRuns(rows);
      setPage(1);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation runs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRuns(engineFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineFilter]);

  const pageRows = useMemo(
    () => runs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [runs, page],
  );

  const renderTrigger = (trigger: string) => {
    const conf = TRIGGER_LABELS[trigger] || {
      label: trigger,
      tone: 'border-adm-border bg-adm-bg text-adm-t2',
    };
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold ${conf.tone}`}
      >
        {conf.label}
      </span>
    );
  };

  const renderEngine = (engine: string | null | undefined) => {
    const value = engine ?? 'V8_FORMULA';
    const conf = ENGINE_LABELS[value] || {
      label: value,
      tone: 'border-adm-border bg-adm-bg text-adm-t2',
    };
    return (
      <span
        className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] font-semibold ${conf.tone}`}
      >
        {conf.label}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Reconciliation Runs"
        meta={`${runs.length} run${runs.length === 1 ? '' : 's'} · Daily Reconciliation`}
      >
        <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-adm-t3">
          Engine
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
            className="h-[30px] rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 focus:border-adm-blue focus:outline-none"
            title="Engine version filter (V8 Formula = legacy; Wallet v1 = Phase B)"
          >
            <option value="WALLET_V1">Wallet v1</option>
            <option value="V8_FORMULA">V8 Formula</option>
            <option value="ALL">All</option>
          </select>
        </label>
        <button
          onClick={() => void fetchRuns()}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Run No', '180px'],
                  ['Engine', '110px'],
                  ['Layer', '90px'],
                  ['Trigger', '120px'],
                  ['Invariant', '110px'],
                  ['Cases', '130px'],
                  ['Status', '120px'],
                  ['Business Date', '130px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && runs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No reconciliation runs found.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((run) => (
                <tr
                  key={run.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/reconciliation/runs/${run.runNo}`)}
                >
                  {/* Run No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {run.runNo}
                    </span>
                    <span className="ml-1 font-mono text-[10px] text-adm-t3">#{run.seq}</span>
                  </td>

                  {/* Engine */}
                  <td className="px-4 py-2.5">{renderEngine(run.engineVersion)}</td>

                  {/* Layer */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-adm-blue">
                      {run.layer}
                    </span>
                  </td>

                  {/* Trigger */}
                  <td className="px-4 py-2.5">{renderTrigger(run.triggerType)}</td>

                  {/* Invariant */}
                  <td className="px-4 py-2.5">
                    <StatusPill value={run.invariantStatus} />
                  </td>

                  {/* Cases */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    <span className="text-adm-amber">+{run.openedCount}</span>
                    {' / '}
                    <span className="text-adm-green">✓{run.closedCount}</span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <StatusPill value={run.status} />
                  </td>

                  {/* Business Date */}
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t1 whitespace-nowrap">
                    {run.businessDate}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <Pagination
        currentPage={page}
        totalItems={runs.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};

export default ReconciliationRunsListPage;

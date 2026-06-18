// admin-web/src/pages/ReconciliationRunsListPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { PageTitleBar } from '../components/ui/PageTitleBar';

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
}

/* ── Constants ───────────────────────────────────────────────── */

const TRIGGER_LABELS: Record<string, { label: string; className: string }> = {
  SCHEDULED: { label: '定时', className: 'bg-gray-100 text-gray-700' },
  POST_FIX: { label: '平账后复核', className: 'bg-purple-100 text-purple-800' },
  MANUAL: { label: '手动', className: 'bg-blue-100 text-blue-800' },
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationRunsListPage = () => {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/runs`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation runs.'));
      const result = await res.json();
      const rows: ReconRun[] = Array.isArray(result) ? result : (result.items ?? []);
      setRuns(rows);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation runs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRuns();
  }, []);

  const renderTrigger = (trigger: string) => {
    const conf = TRIGGER_LABELS[trigger] || {
      label: trigger,
      className: 'bg-gray-100 text-gray-700',
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${conf.className}`}>
        {conf.label}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Reconciliation Runs"
        meta={`${runs.length} run${runs.length === 1 ? '' : 's'} · 每日对账流水`}
      >
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
                  ['Business Date', '130px'],
                  ['Layer', '90px'],
                  ['Trigger', '120px'],
                  ['不变量', '120px'],
                  ['Case 动作', '130px'],
                  ['Status', '110px'],
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
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No reconciliation runs found.
                </td>
              </tr>
            )}
            {!loading &&
              runs.map((run) => (
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

                  {/* Business Date */}
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t1 whitespace-nowrap">
                    {run.businessDate}
                  </td>

                  {/* Layer */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-adm-blue">
                      {run.layer}
                    </span>
                  </td>

                  {/* Trigger */}
                  <td className="px-4 py-2.5">{renderTrigger(run.triggerType)}</td>

                  {/* 不变量 */}
                  <td className="px-4 py-2.5">
                    <StatusBadge value={run.invariantStatus} />
                  </td>

                  {/* Case 动作 */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    <span className="text-adm-amber">+{run.openedCount}</span>
                    {' / '}
                    <span className="text-adm-green">-{run.closedCount}</span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <StatusBadge value={run.status} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          {runs.length > 0
            ? `Showing ${runs.length} run${runs.length === 1 ? '' : 's'}`
            : 'No runs'}
        </span>
      </div>
    </div>
  );
};

export default ReconciliationRunsListPage;

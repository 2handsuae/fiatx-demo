// admin-web/src/pages/ReconciliationRunsDetailPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  StatusBadge,
  DetailCard,
  InfoField,
} from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';

/* ── Interfaces ──────────────────────────────────────────────── */

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

/* ── Constants ───────────────────────────────────────────────── */

const SEVERITY_COLORS: Record<string, string> = {
  SAFEGUARDING: 'bg-rose-100 text-rose-800',
  ATTESTATION: 'bg-purple-100 text-purple-800',
  BUSINESS: 'bg-blue-100 text-blue-800',
  ACCOUNT_ACTUAL: 'bg-amber-100 text-amber-800',
};

const TRIGGER_LABELS: Record<string, string> = {
  SCHEDULED: '定时',
  POST_FIX: '平账后复核',
  MANUAL: '手动',
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationRunsDetailPage = () => {
  const { runNo } = useParams<{ runNo: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<ReconRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = async () => {
    if (!runNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/runs/${encodeURIComponent(runNo)}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation run.'));
      const result = (await res.json()) as ReconRunDetail;
      setRun(result);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation run.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNo]);

  const checks = run?.invariantChecks ?? [];

  return (
    <div className="min-h-full bg-admin-content-bg p-6">
      {/* ── Back + Refresh ── */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/admin/reconciliation/runs')}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to Runs
        </button>
        <button
          onClick={() => void fetchRun()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !run && (
        <div className="rounded-xl border border-admin-border bg-white px-6 py-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {run && (
        <div className="space-y-6">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-gray-900">{run.runNo}</h1>
            <span className="font-mono text-sm font-semibold text-brand-primary">
              {run.layer}
            </span>
            <span className="font-mono text-sm text-gray-500">{run.businessDate}</span>
            <StatusBadge value={run.status} />
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              {TRIGGER_LABELS[run.triggerType] || run.triggerType}
            </span>
          </div>

          {/* ── Run 概要 ── */}
          <DetailCard title="Run 概要">
            <InfoField label="Run No" value={run.runNo} mono />
            <InfoField label="Business Date" value={run.businessDate} mono />
            <InfoField label="Layer" value={run.layer} mono />
            <InfoField label="Seq" value={String(run.seq)} mono />
            <InfoField label="Trigger" value={TRIGGER_LABELS[run.triggerType] || run.triggerType} />
            <InfoField label="Mode" value={run.mode} />
            <InfoField label="不变量状态" value={<StatusBadge value={run.invariantStatus} />} />
            <InfoField label="Opened Cases" value={String(run.openedCount)} mono />
            <InfoField label="Re-observed Cases" value={String(run.reObservedCount)} mono />
            <InfoField label="Closed Cases" value={String(run.closedCount)} mono />
            <InfoField label="Started" value={formatDateTime(run.startedAt)} />
            <InfoField label="Completed" value={formatDateTime(run.completedAt)} />
            <InfoField label="Trace ID" value={run.traceId || '-'} mono />
          </DetailCard>

          {/* ── 不变量 attestation (I1-I5) ── */}
          <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="text-brand-primary">
                <ShieldCheck size={18} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">
                不变量 attestation (I1-I5)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-admin-border bg-admin-content-bg">
                  <tr>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">不变量</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Currency</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Severity</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">LHS</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">RHS</th>
                    <th className="px-3 py-2 text-right text-xs uppercase text-gray-500">Δ</th>
                    <th className="px-3 py-2 text-xs uppercase text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {checks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                        No invariant checks recorded for this run.
                      </td>
                    </tr>
                  ) : (
                    checks.map((check) => (
                      <tr key={check.id}>
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-900">
                          {check.invariantCode}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                          {check.currency || '-'}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge value={check.severity} colors={SEVERITY_COLORS} />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-700">
                          <span className="text-gray-500">{check.lhsLabel} = </span>
                          <span className="font-mono">{check.lhsValue}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-700">
                          <span className="text-gray-500">{check.rhsLabel} = </span>
                          <span className="font-mono">{check.rhsValue}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-900">
                          {check.delta}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge value={check.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconciliationRunsDetailPage;

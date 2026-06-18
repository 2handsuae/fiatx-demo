// admin-web/src/pages/ReconciliationCasesListPage.tsx
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

interface ReconCase {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
  layer: string;
  tbAmount: string;
  inTransitAmount: string;
  expectedExternal: string;
  actualExternal: string;
  deltaAmount: string;
  status: string;
  openedByRunId: string | null;
  closedByRunId: string | null;
  lastObservedRunId: string | null;
  slaDeadline: string | null;
  traceId: string | null;
  reimbursementObligationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const CASE_STATUSES = ['OPEN', 'PENDING_RECHECK', 'RESOLVED'];

const shortId = (id: string | null) => (id ? `${id.slice(0, 8)}` : '—');

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationCasesListPage = () => {
  const navigate = useNavigate();
  const [cases, setCases] = useState<ReconCase[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCases = async (status: string = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const query = params.toString();
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases${query ? `?${query}` : ''}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation cases.'));
      const result = await res.json();
      const rows: ReconCase[] = Array.isArray(result) ? result : (result.items ?? []);
      setCases(rows);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation cases.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCases('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    void fetchCases(value);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Reconciliation Cases"
        meta={`${cases.length} case${cases.length === 1 ? '' : 's'} · 差异 Case`}
      >
        <button
          onClick={() => void fetchCases()}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All status</option>
          {CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

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
                  ['Case No', '180px'],
                  ['Asset', '90px'],
                  ['Layer', '90px'],
                  ['Δ', '140px'],
                  ['Status', '130px'],
                  ['Opened Run', '110px'],
                  ['Closed Run', '110px'],
                  ['Business Date', '130px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Δ' ? 'text-right' : 'text-left'}`}
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
            {!loading && cases.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No reconciliation cases found.
                </td>
              </tr>
            )}
            {!loading &&
              cases.map((kase) => {
                const hasDelta = kase.deltaAmount && Number(kase.deltaAmount) !== 0;
                return (
                  <tr
                    key={kase.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/reconciliation/cases/${kase.caseNo}`)}
                  >
                    {/* Case No */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {kase.caseNo}
                      </span>
                    </td>

                    {/* Asset */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[10px] font-semibold text-adm-blue">
                        {kase.assetCode}
                      </span>
                    </td>

                    {/* Layer */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{kase.layer}</td>

                    {/* Δ */}
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-mono text-[11px] ${hasDelta ? 'font-semibold text-adm-amber' : 'text-adm-t2'}`}
                      >
                        {kase.deltaAmount}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <StatusBadge value={kase.status} />
                    </td>

                    {/* Opened Run */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {shortId(kase.openedByRunId)}
                    </td>

                    {/* Closed Run */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {shortId(kase.closedByRunId)}
                    </td>

                    {/* Business Date */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {kase.businessDate}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          {cases.length > 0
            ? `Showing ${cases.length} case${cases.length === 1 ? '' : 's'}`
            : 'No cases'}
        </span>
      </div>
    </div>
  );
};

export default ReconciliationCasesListPage;

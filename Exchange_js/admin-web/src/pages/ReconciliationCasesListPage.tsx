// admin-web/src/pages/ReconciliationCasesListPage.tsx
//
// T6 — Cases list = tracking view.
//   - Default URL: ?status=OPEN&sort=aging.desc (server already sorts aging desc per T3).
//   - Columns: Case ID | Account | Owner | Asset | Aging | Δ | First Run | Last Run | Status.
//   - Aging tiers visualise triage urgency (0-3 muted, 4-7 amber, 8+ red).
//   - Row click → /admin/reconciliation/cases/{caseNo}.
//   - V8 columns (book/layer/business-date) removed; per-wallet model surfaces account+owner instead.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';

/* ── Interfaces ──────────────────────────────────────────────── */

interface ReconCase {
  id: string;
  caseNo: string;
  assetCode: string;
  walletRef: string | null;
  coaCode: string | null;
  ownerNo: string | null;
  deltaAmount: string;
  status: string;
  aging: number;
  firstSeenRunId: string | null;
  lastUpdatedRunId: string | null;
}

/* ── Constants ───────────────────────────────────────────────── */

// Status filter values. Server interprets `ALL` as "no status filter"; OPEN is the
// implicit landing default per T3 (omit param == OPEN).
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'WAIVED', label: 'Waived' },
  { value: 'ALL', label: 'All' },
];

const PAGE_SIZE = 25;

/* ── Helpers ─────────────────────────────────────────────────── */

const shortId = (id: string | null, n = 8) => (id ? id.slice(0, n) : null);

// Aging tier → muted (0-3d) / amber (4-7d) / red (8d+). Greys out the column when
// there's nothing urgent so the operator's eye jumps straight to red rows.
const agingClass = (days: number): string => {
  if (days >= 8) return 'text-adm-red font-semibold';
  if (days >= 4) return 'text-adm-amber font-semibold';
  return 'text-adm-t3';
};

// Status badge palette: amber for OPEN (needs attention), green for RESOLVED
// (clean), muted gray for WAIVED (acknowledged, no action). Anything else falls
// back to neutral.
const statusBadgeClass = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN' || s === 'PENDING_RECHECK') return 'bg-amber-100 text-amber-800';
  if (s === 'RESOLVED') return 'bg-green-100 text-green-800';
  if (s === 'WAIVED') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-800';
};

const statusLabel = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN') return 'Open';
  if (s === 'RESOLVED') return 'Resolved';
  if (s === 'WAIVED') return 'Waived';
  if (s === 'PENDING_RECHECK') return 'Pending recheck';
  return status;
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationCasesListPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL is the source of truth; missing/empty status param means OPEN (server default).
  const statusFromUrl = searchParams.get('status') ?? 'OPEN';

  const [cases, setCases] = useState<ReconCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchCases = async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Pass status explicitly (incl. OPEN) for clarity. `ALL` opts out per T3 contract.
      params.set('status', status);
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases?${params.toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation cases.'));
      const result = await res.json();
      const rows: ReconCase[] = Array.isArray(result) ? result : (result.items ?? []);
      setCases(rows);
      setPage(1);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation cases.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCases(statusFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFromUrl]);

  const handleStatusChange = (value: string) => {
    // Update URL → effect re-fetches. Keep sort param for shareable links even
    // though the backend already sorts; future-proofs if we add other sort modes.
    const next = new URLSearchParams(searchParams);
    next.set('status', value);
    next.set('sort', 'aging.desc');
    setSearchParams(next, { replace: true });
  };

  const pageRows = useMemo(
    () => cases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [cases, page],
  );

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Reconciliation Cases"
        meta={`${cases.length} case${cases.length === 1 ? '' : 's'} · sorted by aging`}
      >
        <button
          onClick={() => void fetchCases(statusFromUrl)}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
          Status
        </label>
        <select
          value={statusFromUrl}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={`${fi} w-36`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
                  ['Case ID', '160px', 'left'],
                  ['Account', '160px', 'left'],
                  ['Owner', '120px', 'left'],
                  ['Asset', '80px', 'left'],
                  ['Aging', '80px', 'right'],
                  ['Δ', '140px', 'right'],
                  ['First Run', '110px', 'left'],
                  ['Last Run', '110px', 'left'],
                  ['Status', '110px', 'left'],
                ] as [string, string, string][]
              ).map(([label, w, align]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && cases.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No {statusFromUrl === 'ALL' ? '' : statusLabel(statusFromUrl).toLowerCase() + ' '}
                  reconciliation cases found.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((kase) => {
                const deltaNum = Number(kase.deltaAmount ?? '0');
                const hasDelta = Number.isFinite(deltaNum) && deltaNum !== 0;
                const deltaSign = deltaNum > 0 ? '+' : '';
                const firstRunShort = shortId(kase.firstSeenRunId);
                const lastRunShort = shortId(kase.lastUpdatedRunId);
                const sameRun =
                  kase.firstSeenRunId &&
                  kase.lastUpdatedRunId &&
                  kase.firstSeenRunId === kase.lastUpdatedRunId;
                return (
                  <tr
                    key={kase.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/reconciliation/cases/${kase.caseNo}`)}
                  >
                    {/* Case ID */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {kase.caseNo}
                      </span>
                    </td>

                    {/* Account — coaCode role + short walletRef; full ref on hover */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-mono text-[10px] font-semibold text-adm-blue">
                          {kase.coaCode ?? '—'}
                        </span>
                        <span
                          className="font-mono text-[9px] text-adm-t3"
                          title={kase.walletRef ?? undefined}
                        >
                          {kase.walletRef ? `${shortId(kase.walletRef, 8)}…` : '—'}
                        </span>
                      </div>
                    </td>

                    {/* Owner — ownerNo (name not on row; can drill into detail for full identity) */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {kase.ownerNo ?? '—'}
                    </td>

                    {/* Asset */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[10px] font-semibold text-adm-blue">
                        {kase.assetCode}
                      </span>
                    </td>

                    {/* Aging — tier-coloured days since first seen */}
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-mono text-[11px] ${agingClass(kase.aging)}`}>
                        {kase.aging}d
                      </span>
                    </td>

                    {/* Δ — bold+signed when non-zero; muted "balanced" when zero */}
                    <td className="px-4 py-2.5 text-right">
                      {hasDelta ? (
                        <span className="font-mono text-[11px] font-semibold text-adm-amber">
                          {deltaSign}
                          {kase.deltaAmount}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] italic text-adm-t3">balanced</span>
                      )}
                    </td>

                    {/* First Run */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {firstRunShort ? (
                        <span title={kase.firstSeenRunId ?? undefined}>{firstRunShort}…</span>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>

                    {/* Last Run — collapse to "(same)" when identical to First Run */}
                    <td className="px-4 py-2.5 font-mono text-[10px]">
                      {!lastRunShort ? (
                        <span className="text-adm-t3">—</span>
                      ) : sameRun ? (
                        <span className="italic text-adm-t3">(same)</span>
                      ) : (
                        <span className="text-adm-t2" title={kase.lastUpdatedRunId ?? undefined}>
                          {lastRunShort}…
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(kase.status)}`}
                      >
                        {statusLabel(kase.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <Pagination
        currentPage={page}
        totalItems={cases.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};

export default ReconciliationCasesListPage;

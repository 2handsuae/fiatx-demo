// admin-web/src/pages/ReconciliationAdjustmentListPage.tsx
//
// 平账收尾·界面收口轮 Task 5 — Adjustments own list page (previously only
// reachable via a case's "本案调账单" sub-table). Consumes Task 4's
// GET /admin/reconciliation/adjustments?status=&from=&to=&skip=&take= →
// { items: AdjustmentListRow[], total }.
//
// English-only page (this wave converts new admin pages to English); reuses
// REASON_LABEL (still Chinese, Task 9's job to translate — not this task's)
// and formatAmount from their single sources rather than forking a third copy.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import Pagination from '../components/common/Pagination';
import { REASON_LABEL } from '../components/ReconciliationAdjustmentCreateModal';
import { formatAmount } from './ReconciliationCasesDetailPage';

/* ── Interfaces ──────────────────────────────────────────────── */
// Mirrors AdjustmentListRow (adjustment.dto.ts) — business keys only, no UUIDs.
interface AdjustmentListRow {
  adjustmentNo: string;
  caseNo: string;
  ownerNo: string | null;
  assetCode: string;
  decimals: number;
  reasonCode: string;
  direction: string;
  amount: string;
  status: string;
  effectiveDate: string;
  createdAt: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'REJECTED', label: 'Rejected' },
];

const PAGE_SIZE = 20;

/* ── Helpers ─────────────────────────────────────────────────── */

// Backend `to` filter is a raw midnight cutoff (`lte: new Date(to)`), so
// `to=2026-09-07` excludes that day's own rows. Send the selected end date
// +1 day so the filter reads inclusively of the whole selected day.
const toDateInclusive = (dateStr: string): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationAdjustmentListPage = () => {
  const navigate = useNavigate();

  const [items, setItems] = useState<AdjustmentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async (
    nextPage = page,
    nextStatus = status,
    nextFrom = fromDate,
    nextTo = toDate,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        skip: String((nextPage - 1) * PAGE_SIZE),
        take: String(PAGE_SIZE),
      });
      if (nextStatus) params.set('status', nextStatus);
      if (nextFrom) params.set('from', nextFrom);
      if (nextTo) params.set('to', toDateInclusive(nextTo));
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load adjustments.'));
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(nextPage);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load adjustments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar title="Adjustments" meta={`${total} adjustment${total === 1 ? '' : 's'}`}>
        <button
          onClick={() => void fetchItems(page)}
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
          value={status}
          onChange={(e) => { setStatus(e.target.value); void fetchItems(1, e.target.value, fromDate, toDate); }}
          className={`${fi} w-40`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); void fetchItems(1, status, e.target.value, toDate); }}
          title="Created from"
          className={`${fi} w-36`}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => { setToDate(e.target.value); void fetchItems(1, status, fromDate, e.target.value); }}
          title="Created to"
          className={`${fi} w-36`}
        />
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
                  ['Adjustment No', '150px', 'left'],
                  ['Case No', '140px', 'left'],
                  ['Customer', '110px', 'left'],
                  ['Asset', '90px', 'left'],
                  ['Reason', '180px', 'left'],
                  ['Dir', '70px', 'left'],
                  ['Amount', '130px', 'right'],
                  ['Status', '120px', 'left'],
                  ['Effective Date', '110px', 'left'],
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
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No adjustments found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((adj) => (
                <tr
                  key={adj.adjustmentNo}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/reconciliation/adjustments/${encodeURIComponent(adj.adjustmentNo)}`)}
                >
                  {/* Adjustment No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {adj.adjustmentNo}
                    </span>
                  </td>

                  {/* Case No — deep-links to the case, not the adjustment. */}
                  <td className="px-4 py-2.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/reconciliation/cases/${encodeURIComponent(adj.caseNo)}`); }}
                      className="font-mono text-[11px] text-adm-blue hover:underline"
                    >
                      {adj.caseNo}
                    </button>
                  </td>

                  {/* Customer — business key (ownerNo). Firm-book rows have none. */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {adj.ownerNo ?? '—'}
                  </td>

                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-adm-blue">
                      {adj.assetCode}
                    </span>
                  </td>

                  {/* Reason */}
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2">
                    {REASON_LABEL[adj.reasonCode] ?? adj.reasonCode}
                  </td>

                  {/* Dir — REDUCE/INCREASE badge, same palette as the case detail page's
                      "本案调账单" sub-table (single source of this visual convention). */}
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded border px-1 py-0.5 font-mono text-[9px] font-semibold ${
                        adj.direction === 'INCREASE'
                          ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                          : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                      }`}
                    >
                      {adj.direction}
                    </span>
                  </td>

                  {/* Amount — right-aligned, minor units (分) → display units (元). */}
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                    {formatAmount(adj.amount, adj.decimals)}
                  </td>

                  {/* Status badge */}
                  <td className="px-4 py-2.5">
                    <StatusPill value={adj.status} />
                  </td>

                  {/* Effective Date */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {adj.effectiveDate}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <Pagination
        currentPage={page}
        totalItems={total}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => void fetchItems(p)}
      />
    </div>
  );
};

export default ReconciliationAdjustmentListPage;

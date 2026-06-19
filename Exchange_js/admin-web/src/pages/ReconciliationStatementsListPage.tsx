// admin-web/src/pages/ReconciliationStatementsListPage.tsx
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

interface ExternalStatement {
  id: string;
  statementNo: string;
  source: string;
  businessDate: string;
  currency: string;
  accountRef: string;
  closingBalance: string;
  fetchedAt: string;
  createdAt: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const SOURCES = ['ZAND', 'HEXTRUST'];
const PAGE_SIZE = 25;

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationStatementsListPage = () => {
  const navigate = useNavigate();
  const [statements, setStatements] = useState<ExternalStatement[]>([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchStatements = async (source: string = sourceFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      const query = params.toString();
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/statements${query ? `?${query}` : ''}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load external statements.'));
      const result = await res.json();
      const rows: ExternalStatement[] = Array.isArray(result) ? result : (result.items ?? []);
      setStatements(rows);
      setPage(1);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load external statements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatements('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSourceChange = (value: string) => {
    setSourceFilter(value);
    void fetchStatements(value);
  };

  const pageRows = useMemo(
    () => statements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [statements, page],
  );

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="External Statements"
        meta={`${statements.length} statement${statements.length === 1 ? '' : 's'} · Bank & Custodian`}
      >
        <button
          onClick={() => void fetchStatements()}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={sourceFilter}
          onChange={(e) => handleSourceChange(e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
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
                  ['Statement No', '220px', 'left'],
                  ['Source', '110px', 'left'],
                  ['Currency', '90px', 'left'],
                  ['Account Ref', '160px', 'left'],
                  ['Closing Balance', '150px', 'right'],
                  ['Business Date', '130px', 'left'],
                  ['Fetched At', '170px', 'left'],
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
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && statements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No external statements found.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((stmt) => (
                <tr
                  key={stmt.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() =>
                    navigate(`/admin/reconciliation/statements/${encodeURIComponent(stmt.statementNo)}`)
                  }
                >
                  {/* Statement No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {stmt.statementNo}
                    </span>
                  </td>

                  {/* Source */}
                  <td className="px-4 py-2.5">
                    <StatusPill value={stmt.source} />
                  </td>

                  {/* Currency */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-adm-blue">
                      {stmt.currency}
                    </span>
                  </td>

                  {/* Account Ref */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {stmt.accountRef}
                  </td>

                  {/* Closing Balance */}
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] font-semibold text-adm-t1">
                    {stmt.closingBalance}
                  </td>

                  {/* Business Date */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {stmt.businessDate}
                  </td>

                  {/* Fetched At */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmtTime(stmt.fetchedAt)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <Pagination
        currentPage={page}
        totalItems={statements.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};

export default ReconciliationStatementsListPage;

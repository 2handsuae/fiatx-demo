// admin-web/src/pages/ReconciliationExternalBalancesListPage.tsx
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

/* ── Types ──────────────────────────────────────────────────── */

interface ExternalBalance {
  id: string;
  source: string;
  accountRef: string;
  currency: string;
  book: string; // CLIENT | FIRM
  cutoffDate: string;
  closingBalance: string;
  openingBalance: string | null;
  lineCount: number | null;
  status: string | null;
  statementId: string | null;
}

/* ── Helpers ────────────────────────────────────────────────── */

// Group/book order: client safeguarding first, then firm own funds.
const BOOK_ORDER = ['CLIENT', 'FIRM'];
const BOOK_LABEL: Record<string, string> = { CLIENT: 'Client accounts', FIRM: 'Firm accounts' };
const BOOK_TONE: Record<string, string> = {
  CLIENT: 'border-adm-blue/30 bg-adm-blue/10 text-adm-blue',
  FIRM: 'border-adm-green/30 bg-adm-green/10 text-adm-green',
};

const fmtAmount = (v: string | number | null) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};

// Per-book Σ closing by currency → "AED 8,650.38 · USDT 1,267.14".
const subtotalLabel = (rows: ExternalBalance[]) => {
  const byCcy = new Map<string, number>();
  for (const r of rows) byCcy.set(r.currency, (byCcy.get(r.currency) ?? 0) + Number(r.closingBalance));
  return [...byCcy.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ccy, sum]) => `${ccy} ${sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`)
    .join(' · ');
};

/* ── Component ──────────────────────────────────────────────── */

const ReconciliationExternalBalancesListPage = () => {
  const navigate = useNavigate();
  const [balances, setBalances] = useState<ExternalBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const fetchBalances = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/external-balances`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load external balances.'));
      const result = await res.json();
      setBalances(Array.isArray(result) ? result : (result.items ?? []));
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load external balances.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchBalances();
  }, []);

  // Available business dates (newest first) — drives the date picker (history).
  const dates = useMemo(
    () => [...new Set(balances.map((b) => b.cutoffDate))].sort((a, b) => b.localeCompare(a)),
    [balances],
  );
  // Default to the latest date once data arrives (or if the selected one disappears).
  useEffect(() => {
    if (dates.length && !dates.includes(selectedDate)) setSelectedDate(dates[0]);
  }, [dates, selectedDate]);

  // Only the selected day's snapshot — no more same-account-across-days duplicate rows.
  const visible = useMemo(
    () => balances.filter((b) => b.cutoffDate === selectedDate),
    [balances, selectedDate],
  );

  // Group by book (CLIENT → FIRM), accounts by source then accountRef — within the selected date.
  const groups = useMemo(() => {
    const map = new Map<string, ExternalBalance[]>();
    for (const b of visible) {
      if (!map.has(b.book)) map.set(b.book, []);
      map.get(b.book)!.push(b);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.source.localeCompare(b.source) || a.accountRef.localeCompare(b.accountRef));
    }
    return [...map.entries()].sort(
      (a, b) => (BOOK_ORDER.indexOf(a[0]) + 99) - (BOOK_ORDER.indexOf(b[0]) + 99),
    );
  }, [visible]);

  const openDetail = (b: ExternalBalance) => {
    if (b.statementId) navigate(`/admin/reconciliation/external-balances/${encodeURIComponent(b.statementId)}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="External Balances"
        meta={selectedDate
          ? `${selectedDate} · ${visible.length} account${visible.length === 1 ? '' : 's'} · external ledger (recon §4/§5 source)`
          : 'external ledger (recon §4/§5 source)'}
      >
        <button
          onClick={() => void fetchBalances()}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Filter bar: business-date picker (history) — same pattern as other list pages ── */}
      {dates.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-adm-t3">Business date</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-adm-t3">
            {dates.length} day{dates.length === 1 ? '' : 's'} available
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto px-5 py-4">
        {loading && (
          <p className="py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</p>
        )}
        {!loading && balances.length === 0 && (
          <p className="py-10 text-center font-mono text-[11px] text-adm-t3">No external balances found.</p>
        )}

        {!loading &&
          groups.map(([book, rows]) => (
            <div key={book} className="mb-6">
              {/* Book section header + Σ closing subtotal */}
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${BOOK_TONE[book] ?? 'border-adm-border bg-adm-bg text-adm-t2'}`}
                >
                  {BOOK_LABEL[book] ?? book}
                </span>
                <span className="font-mono text-[11px] text-adm-t3">
                  {rows.length} account{rows.length === 1 ? '' : 's'} · closing{' '}
                  <span className="text-adm-t2">{subtotalLabel(rows)}</span>
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border border-adm-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {(
                        [
                          ['Source', 'left'],
                          ['Account', 'left'],
                          ['Ccy', 'left'],
                          ['Closing', 'right'],
                          ['Lines', 'right'],
                          ['Status', 'left'],
                        ] as [string, string][]
                      ).map(([label, align]) => (
                        <th
                          key={label}
                          className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap text-${align}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const neg = Number(b.closingBalance) < 0;
                      return (
                        <tr
                          key={b.id}
                          className="cursor-pointer border-b border-adm-border last:border-0 transition-colors hover:bg-adm-hover"
                          onClick={() => openDetail(b)}
                        >
                          <td className="px-4 py-2.5 text-[11px] text-adm-t2">{b.source}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t1">{b.accountRef}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2">{b.currency}</td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono text-[12px] font-semibold ${neg ? 'text-adm-red' : 'text-adm-t1'}`}
                          >
                            {fmtAmount(b.closingBalance)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-adm-t2">
                            {b.lineCount ?? '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            {b.status ? <StatusPill value={b.status} /> : <span className="text-adm-t3">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export default ReconciliationExternalBalancesListPage;

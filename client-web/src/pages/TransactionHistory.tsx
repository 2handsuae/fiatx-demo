import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  History,
  Briefcase,
  FileText,
} from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

/* ────────────────────────────────────────────────────────────────
 *  Transaction History — one row per order, fed by the Task 10
 *  aggregated statement read-model. Entered only from the Overview
 *  asset row's history icon; not a sidebar nav item.
 *
 *  Campaign C wave 4 (T4): the "Statements" dropdown flips the page
 *  between live activity and an issued monthly statement — a frozen
 *  snapshot, shown as issued (rows stay newest-first, same as live).
 *  `?statement=<statementNo>` deep-links straight to one (Messages).
 * ──────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 20;

interface PortfolioItem {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;
  locked: string;
  decimals: number;
}

interface StatementRow {
  postedAt: string;
  kind: 'DEPOSIT' | 'WITHDRAWAL' | 'SWAP' | 'TRANSFER' | 'ADJUSTMENT';
  title: string;
  subtitle: string | null;
  amount: string;
  feeAmount: string | null;
  balanceAfter: string;
  // Back-office traceability only — deliberately not rendered on the client.
  refs: { sourceType: string; sourceNo: string }[];
}

interface StatementListItem {
  statementNo: string;
  periodMonth: string; // YYYY-MM, Dubai business month
  issuedAt: string;
}

// section.assetCode is the *currency* (USDT), matched against portfolio.currency — not the asset code.
interface StatementSection {
  assetCode: string;
  isFiat: boolean;
  openingBalance: string;
  closingBalance: string;
  rows: StatementRow[];
}

interface StatementSnapshot extends StatementListItem {
  sections: StatementSection[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Plain string split on purpose — a YYYY-MM never goes through Date (timezone drift).
const monthLabel = (periodMonth: string): string => {
  const [year, month] = periodMonth.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
};

// Backend does a plain `<=` comparison on `to`; a bare end-date string parses to
// that day's UTC midnight, which would exclude every event during the selected
// end day. Push the boundary to the start of the next day so the whole selected
// day is included.
const toBoundary = (dateStr: string): string => {
  const next = new Date(`${dateStr}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
};

const TransactionHistory = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState('');

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    () => searchParams.get('assetId'),
  );

  // Issued monthly statements. snapshotNo = null → live activity (current behaviour).
  const [issuedList, setIssuedList] = useState<StatementListItem[]>([]);
  const [snapshotNo, setSnapshotNo] = useState<string | null>(
    () => searchParams.get('statement'),
  );
  const [snapshot, setSnapshot] = useState<StatementSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  // A message deep link carries only ?statement= — remember that, so once the snapshot
  // is in we can land on an asset that actually has rows in it.
  const deepLinkPending = useRef(
    searchParams.get('statement') !== null && searchParams.get('assetId') === null,
  );

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<StatementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statementCurrency, setStatementCurrency] = useState('');
  const [decimals, setDecimals] = useState(2);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');

  const selectedAsset = portfolio.find((p) => p.assetId === selectedAssetId) ?? null;

  const fetchPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    setPortfolioError('');
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
      );
      if (response.ok) {
        const data = await response.json();
        setPortfolio(data);
      } else {
        setPortfolioError(
          await getCustomerApiErrorMessage(response, 'Failed to load your assets'),
        );
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setPortfolioError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  // Resolve the asset in play: keep the URL's/current selection if it's still a
  // held asset, otherwise fall back to the first one in the portfolio.
  useEffect(() => {
    if (portfolio.length === 0) return;
    setSelectedAssetId((current) =>
      current && portfolio.some((p) => p.assetId === current) ? current : portfolio[0].assetId,
    );
  }, [portfolio]);

  useEffect(() => {
    if (!selectedAssetId) return;
    const next: Record<string, string> = { assetId: selectedAssetId };
    if (snapshotNo) next.statement = snapshotNo;
    setSearchParams(next, { replace: true });
  }, [selectedAssetId, snapshotNo, setSearchParams]);

  const selectedCurrency = selectedAsset?.currency ?? null;

  useEffect(() => {
    (async () => {
      try {
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/portfolio/statements`,
        );
        if (response.ok) {
          const data = await response.json();
          setIssuedList(data.items ?? []);
        }
      } catch (err) {
        // The list is a convenience; live activity works without it.
        if (err instanceof CustomerSessionError) return;
      }
    })();
  }, []);

  const fetchSnapshot = useCallback(async () => {
    if (!snapshotNo) return;
    setSnapshotLoading(true);
    setSnapshotError('');
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/statements/${encodeURIComponent(snapshotNo)}`,
      );
      if (response.ok) {
        setSnapshot(await response.json());
      } else {
        setSnapshot(null);
        setSnapshotError(
          await getCustomerApiErrorMessage(response, 'Failed to load statement'),
        );
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setSnapshotError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setSnapshotLoading(false);
    }
  }, [snapshotNo]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  // Message deep link: land on the first asset that has rows in this statement.
  // Defined after the "resolve asset" effect so, when both fire together, this one wins.
  useEffect(() => {
    if (!deepLinkPending.current || !snapshot || portfolio.length === 0) return;
    deepLinkPending.current = false;
    const hasRows = (currency: string) =>
      snapshot.sections.some((sec) => sec.assetCode === currency && sec.rows.length > 0);
    const pick = portfolio.find((p) => hasRows(p.currency));
    if (pick) setSelectedAssetId(pick.assetId);
  }, [snapshot, portfolio]);

  const fetchStatement = useCallback(async () => {
    if (!selectedCurrency || snapshotNo) return;
    setStatementLoading(true);
    setStatementError('');
    try {
      const params = new URLSearchParams({ assetCurrency: selectedCurrency });
      if (startDate) params.set('from', startDate);
      if (endDate) params.set('to', toBoundary(endDate));
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/statement?${params.toString()}`,
      );
      if (response.ok) {
        const data = await response.json();
        setRows(data.items ?? []);
        setTotal(data.total ?? 0);
        setStatementCurrency(data.assetCurrency ?? selectedCurrency);
        setDecimals(data.decimals ?? 2);
      } else {
        setStatementError(
          await getCustomerApiErrorMessage(response, 'Failed to load transaction history'),
        );
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      setStatementError(err instanceof Error ? err.message : 'Network connection error');
    } finally {
      setStatementLoading(false);
    }
  }, [selectedCurrency, snapshotNo, startDate, endDate, page]);

  useEffect(() => {
    fetchStatement();
  }, [fetchStatement]);

  const handleSelectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    setPage(1);
  };

  const handleSelectSnapshot = (statementNo: string) => {
    setSnapshotNo(statementNo || null);
    setPage(1);
  };

  const handleClearDates = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  // One table, two sources: live activity (server-paged) or the frozen snapshot's section
  // for the selected currency (paged client-side — the snapshot carries every row of the month).
  const snapshotReady = !!snapshotNo && snapshot?.statementNo === snapshotNo;
  const snapshotSection = snapshotReady
    ? snapshot!.sections.find((sec) => sec.assetCode === selectedCurrency) ?? null
    : null;
  const viewRows = snapshotNo
    ? (snapshotSection?.rows ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : rows;
  const viewTotal = snapshotNo ? snapshotSection?.rows.length ?? 0 : total;
  const viewDecimals = snapshotNo ? selectedAsset?.decimals ?? 2 : decimals;
  const viewCurrency = snapshotNo ? selectedCurrency ?? '' : statementCurrency;
  const viewLoading = snapshotNo ? snapshotLoading || (!snapshotReady && !snapshotError) : statementLoading;
  const viewError = snapshotNo ? snapshotError : statementError;
  const retryView = snapshotNo ? fetchSnapshot : fetchStatement;

  const totalPages = Math.max(1, Math.ceil(viewTotal / PAGE_SIZE));
  const scale = Math.pow(10, viewDecimals);

  // The deep-linked / selected statement may be missing from the list (list still loading).
  const statementOptions =
    snapshotNo && !issuedList.some((st) => st.statementNo === snapshotNo)
      ? [
          ...issuedList,
          {
            statementNo: snapshotNo,
            periodMonth: snapshotReady ? snapshot!.periodMonth : '',
            issuedAt: '',
          },
        ]
      : issuedList;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3.5">
          <button
            onClick={() => navigate('/overview')}
            className="mt-1.5 text-fx-dust hover:text-fx-brass transition-colors"
            aria-label="Back to Overview"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="font-display text-[26px] font-normal text-fx-sand">
              Transaction History
            </h1>
            <p className="mt-1.5 text-[12px] text-fx-dust">
              Every balance change on your account — one row per order.
            </p>
          </div>
        </div>
        <button
          onClick={retryView}
          className="mt-1 text-fx-dust hover:text-fx-brass transition-colors"
          title="Refresh"
        >
          <RefreshCw size={15} className={viewLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {portfolioLoading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw className="animate-spin text-fx-dust" size={20} />
        </div>
      ) : portfolioError ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <AlertCircle size={22} className="text-fx-rust" />
          <p className="font-mono text-[12px] text-fx-rust">{portfolioError}</p>
          <button
            onClick={fetchPortfolio}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
          >
            Retry
          </button>
        </div>
      ) : portfolio.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <Briefcase size={22} className="text-fx-dust" />
          <p className="font-mono text-[12px] text-fx-dust">
            No assets available on this platform.
          </p>
        </div>
      ) : (
        <>
          {/* Asset chips + date range filter */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {portfolio.map((item) => {
                const active = item.assetId === selectedAssetId;
                return (
                  <button
                    key={item.assetId}
                    onClick={() => handleSelectAsset(item.assetId)}
                    className={`border px-4 py-[5px] font-mono text-[11px] tracking-[0.08em] transition-colors ${
                      active
                        ? 'border-fx-brass/50 bg-fx-brass/[0.08] text-fx-brass'
                        : 'border-fx-rule text-fx-dust hover:text-fx-dune'
                    }`}
                  >
                    {item.assetCode}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust">
                  Statements
                </span>
                <select
                  value={snapshotNo ?? ''}
                  onChange={(e) => handleSelectSnapshot(e.target.value)}
                  aria-label="Statements"
                  className="border border-fx-rule bg-fx-ink text-fx-dune font-mono text-[11px] px-3 py-1.5 focus:outline-none focus:border-fx-brass/50"
                >
                  <option value="">Current activity</option>
                  {statementOptions.map((st) => (
                    <option key={st.statementNo} value={st.statementNo}>
                      {st.periodMonth ? monthLabel(st.periodMonth) : st.statementNo}
                    </option>
                  ))}
                </select>
              </label>
              {!snapshotNo && (
                <>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                    className="border border-fx-rule bg-fx-ink text-fx-dune font-mono text-[11px] px-3 py-1.5 focus:outline-none focus:border-fx-brass/50"
                  />
                  <span className="font-mono text-[11px] text-fx-dust">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                    className="border border-fx-rule bg-fx-ink text-fx-dune font-mono text-[11px] px-3 py-1.5 focus:outline-none focus:border-fx-brass/50"
                  />
                  {(startDate || endDate) && (
                    <button
                      onClick={handleClearDates}
                      className="font-mono text-[11px] text-fx-dust hover:text-fx-brass transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Issued-statement banner — only for a historical month */}
          {snapshotReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-fx-rule bg-fx-ink px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 border border-fx-brass/50 bg-fx-brass/[0.08] px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] text-fx-brass">
                  <FileText size={12} />
                  Statement issued{' '}
                  {new Date(snapshot!.issuedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-[13px] font-medium text-fx-sand">
                  {monthLabel(snapshot!.periodMonth)}
                </span>
                <span className="font-mono text-[10px] text-fx-dust">{snapshot!.statementNo}</span>
              </div>
              {snapshotSection && (
                <div className="flex items-center gap-5 font-mono text-[11px] text-fx-dust">
                  <span>
                    Opening{' '}
                    <span className="text-fx-sand">
                      {formatAssetAmount(Number(snapshotSection.openingBalance) / scale, viewDecimals)}
                    </span>
                  </span>
                  <span>
                    Closing{' '}
                    <span className="text-fx-sand">
                      {formatAssetAmount(Number(snapshotSection.closingBalance) / scale, viewDecimals)}
                    </span>{' '}
                    <span className="text-[10px] opacity-60">{viewCurrency}</span>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Statement table */}
          <div className="border border-fx-rule bg-fx-ink">
            <div className="hidden sm:grid grid-cols-[150px_minmax(0,1fr)_190px_170px] border-b border-fx-rule px-5 py-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust">Date</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust">Description</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust text-right">Amount</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust text-right">Balance</span>
            </div>

            {viewLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="animate-spin text-fx-dust" size={20} />
              </div>
            ) : viewError ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <AlertCircle size={22} className="text-fx-rust" />
                <p className="font-mono text-[11px] text-fx-rust">{viewError}</p>
                <button
                  onClick={retryView}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-fx-dust hover:text-fx-brass transition-colors border border-fx-rule px-3 py-1.5"
                >
                  Retry
                </button>
              </div>
            ) : viewRows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <History size={22} className="text-fx-dust" />
                <p className="font-mono text-[11px] text-fx-dust">
                  {snapshotNo
                    ? `No ${viewCurrency} transactions in this statement.`
                    : 'No transactions in this range.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-fx-rule">
                {viewRows.map((row, idx) => {
                  const netMinor = Number(row.amount);
                  const net = netMinor / scale;
                  const isNegative = netMinor < 0;
                  const feeMinor = row.feeAmount ? Number(row.feeAmount) : 0;
                  const balance = Number(row.balanceAfter) / scale;
                  const posted = new Date(row.postedAt);
                  const dayLabel = posted.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const timeLabel = posted.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

                  return (
                    <div
                      key={`${row.postedAt}-${idx}`}
                      className="grid grid-cols-[150px_minmax(0,1fr)_190px_170px] items-start px-5 py-3.5"
                    >
                      <div>
                        <div className="text-[12px] text-fx-sand">{dayLabel}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-fx-dust">{timeLabel}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-fx-sand">{row.title}</div>
                        {row.subtitle && (
                          <div className="mt-0.5 font-mono text-[10px] text-fx-dust">{row.subtitle}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`font-mono text-[13px] font-medium ${isNegative ? 'text-fx-rust' : 'text-fx-sage'}`}>
                          {isNegative ? '' : '+'}{formatAssetAmount(net, viewDecimals)}{' '}
                          <span className="text-[10px] opacity-60">{viewCurrency}</span>
                        </div>
                        {feeMinor !== 0 && (
                          <div className="mt-0.5 font-mono text-[10px] text-fx-dust">
                            fee {formatAssetAmount(feeMinor / scale, viewDecimals)}
                          </div>
                        )}
                      </div>
                      <div className="text-right font-mono text-[13px] text-fx-sand">
                        {formatAssetAmount(balance, viewDecimals)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!viewLoading && !viewError && viewRows.length > 0 && (
              <div className="flex items-center justify-between border-t border-fx-rule px-5 py-3">
                <span className="font-mono text-[10px] text-fx-dust">
                  {viewRows.length} of {viewTotal} entries
                </span>
                <div className="flex items-center gap-2.5 text-fx-dust">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="disabled:opacity-30 hover:text-fx-brass transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="font-mono text-[10px] text-fx-dune">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="disabled:opacity-30 hover:text-fx-brass transition-colors"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TransactionHistory;

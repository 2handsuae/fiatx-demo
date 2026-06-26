import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { TB_CODE_LABELS, TB_CODE_OPTIONS } from './ledger-account.constants';

/* ── Types ──────────────────────────────────────────────────── */

interface AccountRow {
  tbAccountId: string;
  code: number;
  ownerType: string;
  ownerNo: string | null;
  ownerName: string | null;
  assetCode: string;
  status: string;
}

interface StatementRow {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  runningBalance: number;
  assetCode: string;
  memo: string | null;
  createdAt: string;
}

interface StatementResult {
  items: StatementRow[];
  currentBalance: number;
  decimals: number;
  assetCurrency: string;
  account: {
    tbAccountId: string;
    code: number;
    ownerType: string;
    ownerNo: string | null;
    ownerName: string | null;
    assetCode: string;
  };
}

const codeLabel = (code: number) => TB_CODE_LABELS[code] ?? `CODE_${code}`;
const accountTitle = (a: { code: number; assetCode: string }) =>
  `${codeLabel(a.code)} · ${a.assetCode}`;

/* ── Page ───────────────────────────────────────────────────── */

const AccountStatementPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [q, setQ] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('account'));
  const [result, setResult] = useState<StatementResult | null>(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stmtSeqRef = useRef(0);

  /* ── load all accounts once ── */
  const fetchAccounts = async () => {
    setAccountsLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts?take=500`,
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load accounts.'));
        return;
      }
      const data = await res.json();
      setAccounts(data.items ?? []);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load accounts.');
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── load statement for selected account ── */
  const fetchStatement = async (tbAccountId: string) => {
    const seq = ++stmtSeqRef.current;
    setStmtLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tbAccountId });
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/account-statement?${params}`,
      );
      if (seq !== stmtSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch statement.'));
        setResult(null);
        return;
      }
      setResult(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== stmtSeqRef.current) return;
      setError('Failed to load account statement.');
      setResult(null);
    } finally {
      if (seq === stmtSeqRef.current) setStmtLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) void fetchStatement(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selectAccount = (id: string) => {
    setSelectedId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('account', id);
      return next;
    });
  };

  /* ── currency options derived from actual account assetCodes (e.g. AED, USDT-TRON) ── */
  const currencyOptions = useMemo(
    () => ['', ...Array.from(new Set(accounts.map((a) => a.assetCode))).sort()],
    [accounts],
  );

  /* ── filtered + sorted account list ── */
  const visibleAccounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts
      .filter((a) => {
        if (codeFilter && String(a.code) !== codeFilter) return false;
        if (currencyFilter && a.assetCode !== currencyFilter) return false;
        if (needle) {
          const hay = [
            codeLabel(a.code),
            a.assetCode,
            a.ownerNo ?? '',
            a.ownerName ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort(
        (x, y) =>
          x.code - y.code ||
          x.assetCode.localeCompare(y.assetCode) ||
          (x.ownerNo ?? '').localeCompare(y.ownerNo ?? ''),
      );
  }, [accounts, q, codeFilter, currencyFilter]);

  /* ── formatting ── */
  const decimals = result?.decimals ?? 6;
  const scale = Math.pow(10, decimals);
  const formatAmount = (v: number) =>
    (v / scale).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  const items = result?.items ?? [];
  const acct = result?.account ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Account Statement" subtitle="Per-account ledger activity (流水)">
        <button
          onClick={() => selectedId && fetchStatement(selectedId)}
          className={adminIconButtonClass()}
          title="Refresh"
          disabled={!selectedId}
        >
          <RefreshCw size={14} className={stmtLoading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ════ LEFT: account list ════ */}
        <div className="flex w-[300px] min-w-[300px] flex-col border-r border-adm-border">
          {/* filters */}
          <div className="flex shrink-0 flex-col gap-2 border-b border-adm-border bg-adm-panel px-3 py-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-adm-t3" />
              <input
                placeholder="Search account / owner…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={`${fi} w-full pl-7`}
              />
            </div>
            <div className="flex gap-2">
              <select
                value={codeFilter}
                onChange={(e) => setCodeFilter(e.target.value)}
                className={`${fi} min-w-0 flex-1`}
              >
                {TB_CODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                className={`${fi} w-24`}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>{c || 'All ccy'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* list */}
          <div className="flex-1 overflow-auto">
            {accountsLoading ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="animate-spin text-adm-t3" size={18} />
              </div>
            ) : visibleAccounts.length === 0 ? (
              <p className="px-3 py-6 text-center font-mono text-[11px] text-adm-t3">
                No accounts match.
              </p>
            ) : (
              visibleAccounts.map((a) => {
                const selected = a.tbAccountId === selectedId;
                return (
                  <button
                    key={a.tbAccountId}
                    onClick={() => selectAccount(a.tbAccountId)}
                    className={[
                      'w-full border-b border-adm-border px-3 py-2 text-left transition-colors',
                      selected ? 'bg-adm-amber/10 border-l-2 border-l-adm-amber' : 'hover:bg-adm-hover border-l-2 border-l-transparent',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate font-mono text-[11px] font-semibold ${selected ? 'text-adm-amber' : 'text-adm-t1'}`}>
                        {codeLabel(a.code)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-adm-t3">{a.assetCode}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-adm-t3">
                      {a.ownerType === 'CUSTOMER'
                        ? `${a.ownerName ?? ''}${a.ownerNo ? ` · ${a.ownerNo}` : ''}`.trim() || 'CUSTOMER'
                        : 'PLATFORM'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="shrink-0 border-t border-adm-border px-3 py-1.5 font-mono text-[10px] text-adm-t3">
            {visibleAccounts.length} account{visibleAccounts.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ════ RIGHT: statement ════ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[12px] text-adm-t3">
                Select an account on the left to view its statement (流水).
              </p>
            </div>
          ) : (
            <>
              {/* account header */}
              <div className="shrink-0 border-b border-adm-border bg-adm-card px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[15px] font-bold text-adm-amber">
                      {acct ? accountTitle(acct) : '…'}
                    </div>
                    {acct && (
                      <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                        {acct.ownerType === 'CUSTOMER'
                          ? `${acct.ownerName ?? ''}${acct.ownerNo ? ` · ${acct.ownerNo}` : ''}`.trim() || 'CUSTOMER'
                          : 'PLATFORM'}
                      </div>
                    )}
                  </div>
                  {result && (
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Balance</div>
                      <div className="font-mono text-[14px] font-semibold tabular-nums text-adm-t1">
                        {formatAmount(result.currentBalance)} {result.assetCurrency}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* statement table */}
              <div className="flex-1 overflow-auto">
                {stmtLoading && items.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <RefreshCw className="animate-spin text-adm-t3" size={20} />
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="font-mono text-[12px] text-adm-t3">No transactions for this account.</p>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 z-10 bg-adm-panel">
                      <tr className="border-b border-adm-border">
                        <th className={th} style={{ width: 140 }}>Date</th>
                        <th className={th} style={{ width: 90 }}>Type</th>
                        <th className={th} style={{ width: 140 }}>Reference</th>
                        <th className={th} style={{ width: 160 }}>Event</th>
                        <th className={`${th} text-right`} style={{ width: 120 }}>In (+)</th>
                        <th className={`${th} text-right`} style={{ width: 120 }}>Out (−)</th>
                        <th className={`${th} text-right`} style={{ width: 130 }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((row) => (
                        <tr key={row.tbTransferId} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                          <td className="px-3 py-2 font-mono text-[11px] text-adm-t3 whitespace-nowrap">
                            {formatDate(row.createdAt)}
                          </td>
                          <td className="px-3 py-2"><AdminBadge value={row.sourceType} /></td>
                          <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.sourceNo}>
                            {row.sourceNo}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">{row.eventCode}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-green font-semibold">
                            {row.direction === 'IN' ? formatAmount(row.amount) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-red font-semibold">
                            {row.direction === 'OUT' ? formatAmount(row.amount) : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-adm-t1 font-semibold">
                            {formatAmount(row.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* footer */}
              {result && items.length > 0 && (
                <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-5 py-2">
                  <span className="font-mono text-[10px] text-adm-t3">
                    {items.length} transaction{items.length !== 1 ? 's' : ''} · {result.assetCurrency}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-adm-t1">
                    Balance: {formatAmount(result.currentBalance)} {result.assetCurrency}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountStatementPage;

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

type Mode = 'accounts' | 'wallets';

interface AccountRow {
  tbAccountId: string;
  code: number;
  ownerType: string;
  ownerNo: string | null;
  ownerName: string | null;
  assetCode: string;
  status: string;
}

interface WalletRow {
  walletRef: string;
  ownerType: string | null;
  ownerNo: string | null;
  ownerName: string | null;
  assetCodes: string[];
  walletRole: string | null;
  flowCount: number;
}

interface StatementRow {
  tbTransferId: string;
  tbAccountId?: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  runningBalance: number;
  assetCode: string;
  accountCode?: number | null;
  memo?: string | null;
  isExternalCrossing: boolean;
  externalRef: string | null;
  createdAt: string;
}

interface AccountStatementResult {
  items: StatementRow[];
  currentBalance: number;
  decimals: number;
  assetCurrency: string;
  crossingOnly?: boolean;
  account: {
    tbAccountId: string;
    code: number;
    ownerType: string;
    ownerNo: string | null;
    ownerName: string | null;
    assetCode: string;
  };
}

interface WalletStatementResult {
  items: StatementRow[];
  currentBalance: number;
  decimals: number;
  assetCurrency: string | null;
  walletRef: string;
  crossingOnly: boolean;
  account: {
    walletRef: string;
    ownerType: string | null;
    ownerNo: string | null;
    ownerName: string | null;
    assetCode: string | null;
  };
}

const codeLabel = (code: number) => TB_CODE_LABELS[code] ?? `CODE_${code}`;
const accountTitle = (a: { code: number; assetCode: string }) =>
  `${codeLabel(a.code)} · ${a.assetCode}`;

/* ── Page ───────────────────────────────────────────────────── */

const AccountStatementPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Wallets mode retired — page is account-only per design. URL `?wallet=…` is
  // ignored; future deep links should resolve to a CLIENT_PAYABLE / FIRM_* account.
  const mode = 'accounts' as Mode;

  // ── shared state ──
  const [error, setError] = useState<string | null>(null);
  const [crossingOnly, setCrossingOnly] = useState<boolean>(
    searchParams.get('crossingOnly') === 'true',
  );

  // ── ACCOUNTS mode state ──
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [q, setQ] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    searchParams.get('account'),
  );
  const [accountStatement, setAccountStatement] = useState<AccountStatementResult | null>(null);

  // ── WALLETS mode state ──
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletQ, setWalletQ] = useState('');
  const [selectedWalletRef, setSelectedWalletRef] = useState<string | null>(
    searchParams.get('wallet'),
  );
  const [walletStatement, setWalletStatement] = useState<WalletStatementResult | null>(null);

  // ── statement-load sequence guard ──
  const [stmtLoading, setStmtLoading] = useState(false);
  const stmtSeqRef = useRef(0);

  /* ── load all accounts (accounts mode) ── */
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

  /* ── load all wallets (wallets mode) ── */
  const fetchWallets = async () => {
    setWalletsLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/wallets`,
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load wallets.'));
        return;
      }
      const data = await res.json();
      setWallets(data.items ?? []);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load wallets.');
    } finally {
      setWalletsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load wallets the first time the user switches to that mode.
  useEffect(() => {
    if (mode === 'wallets' && wallets.length === 0 && !walletsLoading) {
      void fetchWallets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ── load statement for selected account ── */
  const fetchAccountStatement = async (tbAccountId: string, useCrossing: boolean) => {
    const seq = ++stmtSeqRef.current;
    setStmtLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tbAccountId });
      if (useCrossing) params.set('crossingOnly', 'true');
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/account-statement?${params}`,
      );
      if (seq !== stmtSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch statement.'));
        setAccountStatement(null);
        return;
      }
      setAccountStatement(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== stmtSeqRef.current) return;
      setError('Failed to load account statement.');
      setAccountStatement(null);
    } finally {
      if (seq === stmtSeqRef.current) setStmtLoading(false);
    }
  };

  /* ── load statement for selected wallet ── */
  const fetchWalletStatement = async (walletRef: string, useCrossing: boolean) => {
    const seq = ++stmtSeqRef.current;
    setStmtLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ walletRef });
      if (useCrossing) params.set('crossingOnly', 'true');
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/account-statement?${params}`,
      );
      if (seq !== stmtSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch statement.'));
        setWalletStatement(null);
        return;
      }
      setWalletStatement(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== stmtSeqRef.current) return;
      setError('Failed to load wallet statement.');
      setWalletStatement(null);
    } finally {
      if (seq === stmtSeqRef.current) setStmtLoading(false);
    }
  };

  // Refetch statement whenever the selected entity OR crossingOnly toggle changes.
  useEffect(() => {
    if (mode === 'accounts' && selectedAccountId) {
      void fetchAccountStatement(selectedAccountId, crossingOnly);
    } else if (mode === 'wallets' && selectedWalletRef) {
      void fetchWalletStatement(selectedWalletRef, crossingOnly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedAccountId, selectedWalletRef, crossingOnly]);

  /* ── URL sync helpers ── */
  const selectAccount = (id: string) => {
    setSelectedAccountId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('account', id);
      next.delete('wallet');
      if (crossingOnly) next.set('crossingOnly', 'true');
      else next.delete('crossingOnly');
      return next;
    });
  };

  const selectWallet = (ref: string) => {
    setSelectedWalletRef(ref);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('wallet', ref);
      next.delete('account');
      if (crossingOnly) next.set('crossingOnly', 'true');
      else next.delete('crossingOnly');
      return next;
    });
  };

  const toggleCrossingOnly = (v: boolean) => {
    setCrossingOnly(v);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('crossingOnly', 'true');
      else next.delete('crossingOnly');
      return next;
    });
  };

  /* ── derived ── */
  const currencyOptions = useMemo(
    () => ['', ...Array.from(new Set(accounts.map((a) => a.assetCode))).sort()],
    [accounts],
  );

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

  const visibleWallets = useMemo(() => {
    const needle = walletQ.trim().toLowerCase();
    if (!needle) return wallets;
    return wallets.filter((w) => {
      const hay = [
        w.walletRef,
        w.ownerNo ?? '',
        w.ownerName ?? '',
        w.walletRole ?? '',
        ...w.assetCodes,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [wallets, walletQ]);

  /* ── formatting ── */
  const activeStatement: AccountStatementResult | WalletStatementResult | null =
    mode === 'accounts' ? accountStatement : walletStatement;
  const decimals = activeStatement?.decimals ?? 6;
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

  const items = activeStatement?.items ?? [];

  const headerTitle = (() => {
    if (mode === 'accounts' && accountStatement?.account) {
      return accountTitle(accountStatement.account);
    }
    if (mode === 'wallets' && walletStatement?.account) {
      const w = walletStatement.account;
      const role = wallets.find((x) => x.walletRef === w.walletRef)?.walletRole;
      const roleLabel = role ?? (w.ownerType === 'CUSTOMER' ? 'Customer Wallet' : 'Firm Wallet');
      return `${roleLabel} · ${w.assetCode ?? '—'}`;
    }
    return '…';
  })();

  const headerSubtitle = (() => {
    if (mode === 'accounts' && accountStatement?.account) {
      const a = accountStatement.account;
      return a.ownerType === 'CUSTOMER'
        ? `${a.ownerName ?? ''}${a.ownerNo ? ` · ${a.ownerNo}` : ''}`.trim() || 'CUSTOMER'
        : 'PLATFORM';
    }
    if (mode === 'wallets' && walletStatement?.account) {
      const w = walletStatement.account;
      const left = w.ownerType === 'CUSTOMER'
        ? `${w.ownerName ?? ''}${w.ownerNo ? ` · ${w.ownerNo}` : ''}`.trim() || 'CUSTOMER'
        : 'PLATFORM';
      return `${left} · wallet ${w.walletRef.slice(0, 8)}…`;
    }
    return '';
  })();

  const selectedKey = mode === 'accounts' ? selectedAccountId : selectedWalletRef;

  const onRefresh = () => {
    if (mode === 'accounts' && selectedAccountId) {
      void fetchAccountStatement(selectedAccountId, crossingOnly);
    } else if (mode === 'wallets' && selectedWalletRef) {
      void fetchWalletStatement(selectedWalletRef, crossingOnly);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Account Statement" subtitle="Per-account / per-wallet ledger activity (流水)">
        <button
          onClick={onRefresh}
          className={adminIconButtonClass()}
          title="Refresh"
          disabled={!selectedKey}
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
        {/* ════ LEFT panel ════ */}
        <div className="flex w-[300px] min-w-[300px] flex-col border-r border-adm-border">
          {mode === 'accounts' ? (
            <>
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
                    const selected = a.tbAccountId === selectedAccountId;
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
            </>
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-2 border-b border-adm-border bg-adm-panel px-3 py-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-adm-t3" />
                  <input
                    placeholder="Search wallet / owner…"
                    value={walletQ}
                    onChange={(e) => setWalletQ(e.target.value)}
                    className={`${fi} w-full pl-7`}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {walletsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <RefreshCw className="animate-spin text-adm-t3" size={18} />
                  </div>
                ) : visibleWallets.length === 0 ? (
                  <p className="px-3 py-6 text-center font-mono text-[11px] text-adm-t3">
                    No wallets with flows.
                  </p>
                ) : (
                  visibleWallets.map((w) => {
                    const selected = w.walletRef === selectedWalletRef;
                    const ownerLabel = w.ownerType === 'CUSTOMER'
                      ? `${w.ownerName ?? ''}${w.ownerNo ? ` · ${w.ownerNo}` : ''}`.trim() || 'CUSTOMER'
                      : (w.walletRole ?? w.ownerType ?? 'PLATFORM');
                    return (
                      <button
                        key={w.walletRef}
                        onClick={() => selectWallet(w.walletRef)}
                        className={[
                          'w-full border-b border-adm-border px-3 py-2 text-left transition-colors',
                          selected ? 'bg-adm-amber/10 border-l-2 border-l-adm-amber' : 'hover:bg-adm-hover border-l-2 border-l-transparent',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate font-mono text-[11px] font-semibold ${selected ? 'text-adm-amber' : 'text-adm-t1'}`}>
                            {ownerLabel}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-adm-t3">
                            {w.assetCodes.join(', ') || '—'}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-adm-t3">
                          <span className="truncate" title={w.walletRef}>
                            {w.walletRole ?? '—'} · {w.walletRef.slice(0, 8)}…
                          </span>
                          <span className="shrink-0">{w.flowCount} flow{w.flowCount !== 1 ? 's' : ''}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="shrink-0 border-t border-adm-border px-3 py-1.5 font-mono text-[10px] text-adm-t3">
                {visibleWallets.length} wallet{visibleWallets.length !== 1 ? 's' : ''}
              </div>
            </>
          )}
        </div>

        {/* ════ RIGHT: statement ════ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedKey ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[12px] text-adm-t3">
                {mode === 'accounts'
                  ? 'Select an account on the left to view its statement (流水).'
                  : 'Select a wallet on the left to view its combined statement (流水).'}
              </p>
            </div>
          ) : (
            <>
              {/* header */}
              <div className="shrink-0 border-b border-adm-border bg-adm-card px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[15px] font-bold text-adm-amber">
                      {headerTitle}
                    </div>
                    {headerSubtitle && (
                      <div className="mt-0.5 font-mono text-[10px] text-adm-t3">
                        {headerSubtitle}
                      </div>
                    )}
                  </div>
                  {activeStatement && (
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">Balance</div>
                      <div className="font-mono text-[14px] font-semibold tabular-nums text-adm-t1">
                        {formatAmount(activeStatement.currentBalance)} {activeStatement.assetCurrency ?? ''}
                      </div>
                    </div>
                  )}
                </div>

                {/* crossingOnly toggle */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-adm-t3">Show:</span>
                  <div className="flex rounded border border-adm-border bg-adm-bg p-0.5">
                    <button
                      onClick={() => toggleCrossingOnly(false)}
                      className={[
                        'rounded px-2 py-0.5 font-mono text-[10px] transition-colors',
                        !crossingOnly
                          ? 'bg-adm-amber text-adm-bg font-semibold'
                          : 'text-adm-t3 hover:text-adm-t1',
                      ].join(' ')}
                    >
                      All flows
                    </button>
                    <button
                      onClick={() => toggleCrossingOnly(true)}
                      className={[
                        'rounded px-2 py-0.5 font-mono text-[10px] transition-colors',
                        crossingOnly
                          ? 'bg-adm-amber text-adm-bg font-semibold'
                          : 'text-adm-t3 hover:text-adm-t1',
                      ].join(' ')}
                    >
                      External crossings only
                    </button>
                  </div>
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
                    <p className="font-mono text-[12px] text-adm-t3">
                      {crossingOnly
                        ? 'No external crossings for this view.'
                        : 'No transactions for this view.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 z-10 bg-adm-panel">
                      <tr className="border-b border-adm-border">
                        <th className={th} style={{ width: 140 }}>Date</th>
                        <th className={th} style={{ width: 90 }}>Type</th>
                        <th className={th} style={{ width: 140 }}>Source No</th>
                        <th className={th} style={{ width: 160 }}>External Ref</th>
                        <th className={th} style={{ width: 160 }}>Event</th>
                        <th className={th} style={{ width: 70 }}>EXT</th>
                        <th className={`${th} text-right`} style={{ width: 120 }}>In (+)</th>
                        <th className={`${th} text-right`} style={{ width: 120 }}>Out (−)</th>
                        <th className={`${th} text-right`} style={{ width: 130 }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((row, idx) => (
                        <tr key={`${row.tbTransferId}-${row.tbAccountId ?? ''}-${idx}`} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                          <td className="px-3 py-2 font-mono text-[11px] text-adm-t3 whitespace-nowrap">
                            {formatDate(row.createdAt)}
                          </td>
                          <td className="px-3 py-2"><AdminBadge value={row.sourceType} /></td>
                          <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.sourceNo}>
                            {row.sourceNo}
                          </td>
                          <td
                            className={`px-3 py-2 font-mono text-[11px] truncate max-w-[160px] ${
                              row.externalRef ? 'text-adm-amber' : 'text-adm-t3'
                            }`}
                            title={row.externalRef ?? undefined}
                          >
                            {row.externalRef ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">{row.eventCode}</td>
                          <td className="px-3 py-2 font-mono text-[10px]">
                            {row.isExternalCrossing ? (
                              <span className="text-adm-amber">EXT</span>
                            ) : (
                              <span className="text-adm-t3">INT</span>
                            )}
                          </td>
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
              {activeStatement && items.length > 0 && (
                <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-5 py-2">
                  <span className="font-mono text-[10px] text-adm-t3">
                    {items.length} transaction{items.length !== 1 ? 's' : ''} · {activeStatement.assetCurrency ?? ''}
                    {crossingOnly ? ' · external crossings only' : ''}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-adm-t1">
                    Balance: {formatAmount(activeStatement.currentBalance)} {activeStatement.assetCurrency ?? ''}
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

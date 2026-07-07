import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass, adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AccountFlowRow {
  id: string;
  tbTransferId: string;
  tbAccountId: string;
  walletRef: string | null;
  direction: 'IN' | 'OUT';
  amount: string;
  balanceAfter: string | null;
  assetCode: string;
  eventCode: string;
  sourceType: string;
  sourceNo: string;
  transferType: string;
  effectiveDate: string;
  createdAt: string;
}

interface FilterState {
  q: string;
  tbAccountId: string;
  walletRef: string;
  direction: string;
  assetCode: string;
  sourceType: string;
  transferType: string;
  effectiveFrom: string;
  effectiveTo: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const DEFAULT_FILTERS: FilterState = {
  q: '',
  tbAccountId: '',
  walletRef: '',
  direction: '',
  assetCode: '',
  sourceType: '',
  transferType: '',
  effectiveFrom: '',
  effectiveTo: '',
};

const PAGE_SIZE = 50;

/* ── Helpers ─────────────────────────────────────────────────── */

/* bigint-safe 分→元: insert the decimal point into the raw minor-unit
   string without ever going through Number() (large balances lose precision
   as JS floats). Mirrors ReconciliationRunsDetailPage's formatAmount. */
const formatMinorToMajor = (raw: string, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};

/* ── Component ───────────────────────────────────────────────── */

const AccountFlowList = () => {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<AccountFlowRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    tbAccountId: searchParams.get('tbAccountId')?.trim() ?? '',
  }));
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const [decimalsMap, setDecimalsMap] = useState<Record<string, number>>({});
  const requestSeqRef = useRef(0);
  const navigate = useNavigate();

  /* Flow rows store the currency (e.g. USDT), not the network-qualified
     asset code — offer the deduped currency list as filter options and keep
     the per-currency decimals for 分→元 formatting of the balance/amount cols. */
  const fetchCurrencyOptions = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=100`);
      if (!res.ok) return;
      const data = await res.json();
      const assets = (data.items ?? data ?? []).filter((a: any) => a.tbLedgerId != null);
      const currencies = [
        ...new Set(assets.map((a: any) => String(a.currency))),
      ] as string[];
      const decimals: Record<string, number> = {};
      for (const a of assets) {
        if (typeof a.decimals === 'number') decimals[String(a.currency)] = a.decimals;
      }
      setCurrencyOptions(currencies);
      setDecimalsMap(decimals);
    } catch {
      /* ignore — dropdown simply stays empty */
    }
  };

  const decimalsOf = (assetCode: string): number => decimalsMap[assetCode] ?? 2;

  /* ── Data fetching ── */

  const fetchData = async (overridePage?: number, nextFilters: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim());
      if (nextFilters.tbAccountId.trim()) params.set('tbAccountId', nextFilters.tbAccountId.trim());
      if (nextFilters.walletRef.trim()) params.set('walletRef', nextFilters.walletRef.trim());
      if (nextFilters.direction) params.set('direction', nextFilters.direction);
      if (nextFilters.assetCode) params.set('assetCurrency', nextFilters.assetCode);
      if (nextFilters.sourceType) params.set('sourceType', nextFilters.sourceType);
      if (nextFilters.transferType) params.set('transferType', nextFilters.transferType);
      if (nextFilters.effectiveFrom) params.set('effectiveFrom', nextFilters.effectiveFrom);
      if (nextFilters.effectiveTo) params.set('effectiveTo', nextFilters.effectiveTo);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/account-flows?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch account flows.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(overridePage ?? p);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load account flows.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(1, filters);
    void fetchCurrencyOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Filter logic ── */

  const hasFilter =
    !!filters.q.trim() ||
    !!filters.tbAccountId.trim() ||
    !!filters.walletRef.trim() ||
    !!filters.direction ||
    !!filters.assetCode ||
    !!filters.sourceType ||
    !!filters.transferType ||
    !!filters.effectiveFrom ||
    !!filters.effectiveTo;

  const handleSearch = () => {
    setPage(1);
    void fetchData(1, filters);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    void fetchData(1, DEFAULT_FILTERS);
  };

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  /* balanceAfter only meaningful when filtered to ONE account. */
  const singleAccount = !!filters.tbAccountId.trim();

  /* ── Helpers ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Account Flows"
        subtitle={`${total} flow${total === 1 ? '' : 's'} · Ledger Per-Account Rows`}
      >
        <button
          onClick={() => void fetchData(page, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          className={`${fi} w-[240px]`}
          placeholder="Transfer ID / source no / event"
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <input
          className={`${fi} w-[200px]`}
          placeholder="TB Account ID"
          value={filters.tbAccountId}
          onChange={(e) => updateFilter('tbAccountId', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <input
          className={`${fi} w-40`}
          placeholder="Wallet Ref"
          value={filters.walletRef}
          onChange={(e) => updateFilter('walletRef', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <select
          value={filters.direction}
          onChange={(e) => updateFilter('direction', e.target.value)}
          className={`${fi} w-28`}
        >
          <option value="">All directions</option>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
        <select
          className={`${fi} w-28`}
          value={filters.assetCode}
          onChange={(e) => updateFilter('assetCode', e.target.value)}
        >
          <option value="">All assets</option>
          {currencyOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filters.sourceType}
          onChange={(e) => updateFilter('sourceType', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All sources</option>
          <option value="DEPOSIT">DEPOSIT</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="SWAP">SWAP</option>
          <option value="INTERNAL">INTERNAL</option>
          <option value="FEE">FEE</option>
        </select>
        <select
          value={filters.transferType}
          onChange={(e) => updateFilter('transferType', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All types</option>
          <option value="POSTED">POSTED</option>
          <option value="PENDING">PENDING</option>
          <option value="POST_PENDING">POST_PENDING</option>
          <option value="VOID_PENDING">VOID_PENDING</option>
          <option value="CORRECTING">CORRECTING</option>
        </select>
        <input
          type="date"
          className={`${fi} w-36`}
          title="Effective from"
          value={filters.effectiveFrom}
          onChange={(e) => updateFilter('effectiveFrom', e.target.value)}
        />
        <input
          type="date"
          className={`${fi} w-36`}
          title="Effective to"
          value={filters.effectiveTo}
          onChange={(e) => updateFilter('effectiveTo', e.target.value)}
        />

        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>

        <button
          onClick={() => void fetchData(page, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
          style={{ marginLeft: 'auto' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table ─── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 150 }}>Account</th>
              <th className={th} style={{ width: 130 }}>Wallet</th>
              <th className={th} style={{ width: 80 }}>Direction</th>
              <th className={th} style={{ width: 120, textAlign: 'right' }}>Amount</th>
              <th
                className={th}
                style={{ width: 130, textAlign: 'right' }}
                title="选定账户后显示余额"
              >
                Balance After
              </th>
              <th className={th} style={{ width: 80 }}>Asset</th>
              <th className={th} style={{ width: 100 }}>Source</th>
              <th className={th} style={{ width: 140 }}>Source No</th>
              <th className={th} style={{ width: 120 }}>Event</th>
              <th className={th} style={{ width: 100 }}>Type</th>
              <th className={th} style={{ width: 120 }}>Effective</th>
              <th className={th} style={{ width: 160 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No flows found.
                </td>
              </tr>
            )}
            {items.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/admin/ledger/transfer-evidence/${row.tbTransferId}`)}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover cursor-pointer"
              >
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/admin/ledger/accounts/${row.tbAccountId}`); }}
                    className="block max-w-[150px] truncate text-left text-adm-amber hover:underline"
                    title={row.tbAccountId}
                  >
                    {row.tbAccountId.slice(0, 8)}…{row.tbAccountId.slice(-6)}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[130px]" title={row.walletRef ?? ''}>
                  {row.walletRef || '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`font-mono text-[11px] font-semibold ${row.direction === 'IN' ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {row.direction}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums font-semibold">
                  {formatMinorToMajor(row.amount, decimalsOf(row.assetCode))}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums">
                  {singleAccount && row.balanceAfter != null
                    ? formatMinorToMajor(row.balanceAfter, decimalsOf(row.assetCode))
                    : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-t1">
                  {row.assetCode}
                </td>
                <td className="px-3 py-2">
                  <AdminBadge value={row.sourceType} />
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.sourceNo}>
                  {row.sourceNo}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                  {row.eventCode}
                </td>
                <td className="px-3 py-2">
                  <AdminBadge value={row.transferType} />
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 whitespace-nowrap tabular-nums">
                  {row.effectiveDate}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t3 whitespace-nowrap">
                  {formatDate(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="shrink-0 flex items-center justify-between border-t border-adm-border px-5 py-2">
        <span className="font-mono text-[10px] text-adm-t3">
          {total > 0 ? `Showing ${items.length} / ${total} flows` : 'No flows'}
        </span>
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => void fetchData(p, filters)}
        />
      </div>
    </div>
  );
};

export default AccountFlowList;

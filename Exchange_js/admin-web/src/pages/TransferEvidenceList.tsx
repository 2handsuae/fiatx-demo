import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, RefreshCw } from 'lucide-react';
import { adminIconButtonClass, adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { COA_OPTIONS } from './ledger-account.constants';
import { copyToClipboard } from '../utils/clipboard';

/* ── Interfaces ──────────────────────────────────────────────── */

interface TransferEvidenceRow {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: string;
  assetCode: string;
  transferType: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo: string | null;
  pendingId: string | null;
  createdAt: string;
}

interface FilterState {
  q: string;
  coa: string;
  sourceType: string;
  assetCode: string;
  eventCode: string;
  transferType: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const DEFAULT_FILTERS: FilterState = {
  q: '',
  coa: '',
  sourceType: '',
  assetCode: '',
  eventCode: '',
  transferType: '',
};

const PAGE_SIZE = 50;

/* ── Component ───────────────────────────────────────────────── */

const TransferEvidenceList = () => {
  const [items, setItems] = useState<TransferEvidenceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
  const requestSeqRef = useRef(0);
  const navigate = useNavigate();

  /* Evidence rows store the currency (e.g. USDT), not the network-qualified
     asset code — offer the deduped currency list as filter options. */
  const fetchCurrencyOptions = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=100`);
      if (!res.ok) return;
      const data = await res.json();
      const currencies = [
        ...new Set(
          (data.items ?? data ?? [])
            .filter((a: any) => a.tbLedgerId != null)
            .map((a: any) => String(a.currency)),
        ),
      ] as string[];
      setCurrencyOptions(currencies);
    } catch {
      /* ignore — dropdown simply stays empty */
    }
  };

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
      if (nextFilters.coa) params.set('coa', nextFilters.coa);
      if (nextFilters.sourceType) params.set('sourceType', nextFilters.sourceType);
      if (nextFilters.assetCode) params.set('assetCurrency', nextFilters.assetCode);
      if (nextFilters.eventCode) params.set('eventCode', nextFilters.eventCode);
      if (nextFilters.transferType) params.set('transferType', nextFilters.transferType);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/transfers?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch transfer evidence.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(overridePage ?? p);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load transfer evidence.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(1, filters);
    void fetchCurrencyOptions();
  }, []);

  /* ── Filter logic ── */

  const hasFilter =
    !!filters.q.trim() ||
    !!filters.coa ||
    !!filters.sourceType ||
    !!filters.assetCode ||
    !!filters.eventCode ||
    !!filters.transferType;

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
        title="Transfer Evidence"
        subtitle={`${total} transfer${total === 1 ? '' : 's'} · Ledger Evidence`}
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
          placeholder="Transfer ID / source no / trace"
          value={filters.q}
          onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
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
          className={`${fi} w-28`}
          value={filters.assetCode}
          onChange={(e) => updateFilter('assetCode', e.target.value)}
        >
          <option value="">All assets</option>
          {currencyOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          placeholder="Event code…"
          value={filters.eventCode}
          onChange={(e) => updateFilter('eventCode', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className={`${fi} w-36`}
        />
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
        <select
          className={`${fi} w-[200px]`}
          value={filters.coa}
          onChange={(e) => setFilters((p) => ({ ...p, coa: e.target.value }))}
        >
          <option value="">All accounts</option>
          {COA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

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
              <th className={th} style={{ width: 130 }}>ID</th>
              <th className={th} style={{ width: 100 }}>Source</th>
              <th className={th} style={{ width: 140 }}>Source No</th>
              <th className={th} style={{ width: 120 }}>Event</th>
              <th className={th} style={{ width: 100 }}>Debit</th>
              <th className={th} style={{ width: 100 }}>Credit</th>
              <th className={th} style={{ width: 120 }}>Amount</th>
              <th className={th} style={{ width: 90 }}>Asset</th>
              <th className={th} style={{ width: 100 }}>Type</th>
              <th className={th} style={{ width: 160 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No transfers found.
                </td>
              </tr>
            )}
            {items.map((row) => (
              <tr
                key={row.tbTransferId}
                onClick={() => navigate(`/admin/ledger/transfer-evidence/${row.tbTransferId}`)}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover cursor-pointer"
              >
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <span className="inline-flex items-center gap-1">
                    <span title={row.tbTransferId}>
                      {row.tbTransferId.slice(0, 8)}…{row.tbTransferId.slice(-6)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(row.tbTransferId); }}
                      className="text-adm-t3 hover:text-adm-t1"
                      title="Copy full ID"
                    >
                      <Copy size={10} />
                    </button>
                  </span>
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
                <td className="px-3 py-2 font-mono text-[11px] text-adm-amber">
                  {row.debitCode}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-blue-400">
                  {row.creditCode}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums font-semibold">
                  {row.amount}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-t1">
                  {row.assetCode}
                </td>
                <td className="px-3 py-2">
                  <AdminBadge value={row.transferType} />
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
          {total > 0 ? `Showing ${items.length} / ${total} transfers` : 'No transfers'}
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

export default TransferEvidenceList;

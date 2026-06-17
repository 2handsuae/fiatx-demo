// admin-web/src/pages/PayinList.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';
import { getPayinStatusBadgeClass } from '../utils/depositActionMap';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PayinItem {
  id: string;
  payinNo: string;
  status: string;
  displayStatus?: string | null;
  type: string;
  amount: string;
  asset: { code: string; type: string; decimals?: number };
  txHash: string | null;
  depositId: string | null;
  transactionNo: string | null;
  deposit?: { depositNo: string } | null;
  createdAt?: string;
  receivedAt: string | null;
}

interface FilterState {
  payinNo: string;
  txHash: string;
  status: string;
  type: string;
  startDate: string;
  endDate: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const PAYIN_STATUSES = ['DETECTED', 'CONFIRMING', 'CONFIRMED', 'CLEARED', 'FAILED'];

const DEFAULT_FILTERS: FilterState = {
  payinNo: '',
  txHash: '',
  status: '',
  type: '',
  startDate: '',
  endDate: '',
};

/* ── Helpers ─────────────────────────────────────────────────── */

const truncateHash = (hash: string | null) => {
  if (!hash || hash.length < 14) return hash || '—';
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ───────────────────────────────────────────────── */

const PayinList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PayinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const fetchItems = async (next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (next.status) params.set('status', next.status);
      if (next.txHash.trim()) params.set('txHash', next.txHash.trim());
      if (next.payinNo.trim()) params.set('payinNo', next.payinNo.trim());
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load payins.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      let filtered = Array.isArray(data.items) ? data.items : [];
      if (next.type) {
        filtered = filtered.filter(
          (i: PayinItem) => i.type?.toUpperCase() === next.type.toUpperCase(),
        );
      }
      setItems(filtered);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load payins.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(DEFAULT_FILTERS); }, []);

  /* ── Filter helpers ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.payinNo || !!filters.txHash || !!filters.status ||
    !!filters.type || !!filters.startDate || !!filters.endDate;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(DEFAULT_FILTERS);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Payin Transactions"
        meta={`${items.length} payin${items.length === 1 ? '' : 's'} · Treasury`}
      >
        <button
          onClick={() => void fetchItems()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.payinNo}
          onChange={(e) => updateFilter('payinNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Payin No"
          className={`${fi} w-36`}
        />
        <input
          value={filters.txHash}
          onChange={(e) => updateFilter('txHash', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Tx Hash"
          className={`${fi} w-40`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All status</option>
          {PAYIN_STATUSES.map((s) => (
            <option key={s} value={s}>{formatRailStatusLabel(s)}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All types</option>
          <option value="CRYPTO">Crypto</option>
          <option value="FIAT">Fiat</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => updateFilter('startDate', e.target.value)}
          className={`${fi} w-36`}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => updateFilter('endDate', e.target.value)}
          className={`${fi} w-36`}
        />
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
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
                  ['Payin No',  '140px'],
                  ['Status',    '120px'],
                  ['Amount',    '140px'],
                  ['Type',      '90px'],
                  ['Tx Hash',   '140px'],
                  ['Deposit',   '130px'],
                  ['Created',   '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Amount' ? 'text-right' : 'text-left'}`}
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
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No payins found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => {
              const ns = normalizeRailDisplayStatus(item.displayStatus || item.status);
              const depNo = item.deposit?.depositNo || item.transactionNo;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/trading/payins/${item.id}`)}
                >
                  {/* Payin No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.payinNo}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getPayinStatusBadgeClass(ns)}`}>
                      {formatRailStatusLabel(ns)}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                    </span>
                  </td>

                  {/* Type */}
                  <td className="px-4 py-2.5">
                    <span className={`font-mono text-[10px] font-semibold ${item.type?.toUpperCase() === 'CRYPTO' ? 'text-adm-amber' : 'text-adm-blue'}`}>
                      {formatTransactionTypeLabel(item.type)}
                    </span>
                  </td>

                  {/* Tx Hash */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-adm-t2">{truncateHash(item.txHash)}</span>
                  </td>

                  {/* Deposit */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-blue">{depNo || '—'}</span>
                  </td>

                  {/* Created */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(item.createdAt || item.receivedAt)}
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
          {items.length > 0
            ? `Showing ${items.length} payin${items.length === 1 ? '' : 's'}`
            : 'No payins'}
        </span>
      </div>
    </div>
  );
};

export default PayinList;

// admin-web/src/pages/PayoutList.tsx
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
import { getPayoutStatusBadgeClass } from '../utils/payoutActionMap';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PayoutItem {
  id: string;
  payoutNo: string;
  status: string;
  displayStatus?: string | null;
  type: string;
  amount: string;
  asset: { code: string; type: string; decimals?: number };
  txHash: string | null;
  withdrawId: string | null;
  transactionNo: string | null;
  withdraw?: { withdrawNo: string } | null;
  createdAt?: string;
}

interface FilterState {
  payoutNo: string;
  txHash: string;
  status: string;
  type: string;
  startDate: string;
  endDate: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const PAYOUT_STATUSES = ['CREATED', 'SIGNING', 'BROADCASTED', 'CONFIRMING', 'CONFIRMED', 'CLEARED', 'FAILED', 'TIMEOUT', 'RETURNED'];

const DEFAULT_FILTERS: FilterState = {
  payoutNo: '',
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

const PayoutList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PayoutItem[]>([]);
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
      if (next.type) params.set('type', next.type);
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/payouts?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load payouts.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      let filtered: PayoutItem[] = Array.isArray(data.items) ? data.items : [];
      if (next.payoutNo.trim()) {
        filtered = filtered.filter(
          (i) => i.payoutNo?.toLowerCase().includes(next.payoutNo.trim().toLowerCase()),
        );
      }
      if (next.txHash.trim()) {
        filtered = filtered.filter(
          (i) => i.txHash?.toLowerCase().includes(next.txHash.trim().toLowerCase()),
        );
      }
      setItems(filtered);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load payouts.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(DEFAULT_FILTERS); }, []);

  /* ── Filter helpers ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.payoutNo || !!filters.txHash || !!filters.status ||
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
        title="Payout Transactions"
        meta={`${items.length} payout${items.length === 1 ? '' : 's'} · Treasury`}
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
          value={filters.payoutNo}
          onChange={(e) => updateFilter('payoutNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Payout No"
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
          {PAYOUT_STATUSES.map((s) => (
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
                  ['Payout No',  '140px'],
                  ['Status',     '120px'],
                  ['Amount',     '140px'],
                  ['Type',       '90px'],
                  ['Tx Hash',    '140px'],
                  ['Withdraw',   '130px'],
                  ['Created',    '150px'],
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
                  No payouts found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => {
              const ns = normalizeRailDisplayStatus(item.displayStatus || item.status);
              const wdNo = item.withdraw?.withdrawNo || item.transactionNo;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/trading/payouts/${item.id}`)}
                >
                  {/* Payout No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.payoutNo}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getPayoutStatusBadgeClass(ns)}`}>
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

                  {/* Withdraw */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-blue">{wdNo || '—'}</span>
                  </td>

                  {/* Created */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(item.createdAt)}
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
            ? `Showing ${items.length} payout${items.length === 1 ? '' : 's'}`
            : 'No payouts'}
        </span>
      </div>
    </div>
  );
};

export default PayoutList;

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { copyToClipboard } from '../utils/clipboard';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  customerName: string | null;
  address: string;
  addressType: string;
  network: string;
  label: string | null;
  status: string;
  activatesAt: string;
  createdAt: string;
  updatedAt: string;
  iban: string | null;
  bankName: string | null;
  asset: { currency: string; code: string; type: string };
}

interface FilterState {
  q: string;
  customerNo: string;
  assetId: string;
  status: string;
  addressType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Address Type badge ── */

const TYPE_CLS: Record<string, string> = {
  VASP:         'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  SELF_CUSTODY: 'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  BANK:         'bg-adm-green/10 text-adm-green border-adm-green/25',
};

const TYPE_LABEL: Record<string, string> = {
  VASP: 'VASP',
  SELF_CUSTODY: 'Self-Custody',
  BANK: 'Bank',
};

const AddressTypeBadge = ({ type }: { type: string }) => {
  const cls = TYPE_CLS[type] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {TYPE_LABEL[type] || type}
    </span>
  );
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  q: '',
  customerNo: '',
  assetId: '',
  status: '',
  addressType: '',
};

/* ── Component ───────────────────────────────────────────────── */

const WithdrawalAddressList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<WithdrawalAddr[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetOptions, setAssetOptions] = useState<{ id: string; code: string }[]>([]);

  const requestSeqRef = useRef(0);

  /* ── Asset options ── */

  const fetchAssetOptions = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=100`);
      if (!res.ok) return;
      const data = await res.json();
      const options = (data.items ?? data ?? [])
        .filter((a: any) => a.tbLedgerId != null)
        .map((a: any) => ({ id: String(a.id), code: String(a.code) }));
      setAssetOptions(options);
    } catch {
      /* ignore — dropdown simply stays empty */
    }
  };

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.q.trim()) params.set('q', next.q.trim());
    if (next.customerNo.trim()) params.set('customerNo', next.customerNo.trim());
    if (next.assetId) params.set('assetId', next.assetId);
    if (next.status) params.set('status', next.status);
    if (next.addressType) params.set('addressType', next.addressType);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load withdrawal addresses.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load withdrawal addresses.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAssetOptions();
    void fetchItems(1, DEFAULT_FILTERS);
  }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.q || !!filters.customerNo || !!filters.assetId || !!filters.status || !!filters.addressType;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Withdrawal Addresses"
        meta={`${total} address${total === 1 ? '' : 'es'} · Treasury`}
      >
        <button
          onClick={() => void fetchItems(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          className={`${fi} w-[220px]`}
          placeholder="Address No / address / IBAN"
          value={filters.q}
          onChange={(e) => updateFilter('q', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <input
          value={filters.customerNo}
          onChange={(e) => updateFilter('customerNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Customer No"
          className={`${fi} w-40`}
        />
        <select
          className={`${fi} w-[150px]`}
          value={filters.assetId}
          onChange={(e) => updateFilter('assetId', e.target.value)}
        >
          <option value="">All assets</option>
          {assetOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.code}</option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All status</option>
          <option value="PENDING_ACTIVATION">PENDING_ACTIVATION</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="SUSPENDED">SUSPENDED</option>
        </select>
        <select
          value={filters.addressType}
          onChange={(e) => updateFilter('addressType', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All types</option>
          <option value="VASP">VASP</option>
          <option value="SELF_CUSTODY">SELF_CUSTODY</option>
          <option value="BANK">BANK</option>
        </select>
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
                  ['Address No',    '160px'],
                  ['Customer No',   '110px'],
                  ['Customer Name', '130px'],
                  ['Label',         '120px'],
                  ['Asset',         '80px'],
                  ['Network',       '90px'],
                  ['Address',       '160px'],
                  ['Type',          '110px'],
                  ['Status',        '130px'],
                  ['Registered',    '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No withdrawal addresses found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/custody/withdrawal-addresses/${item.addressNo}`)}
              >
                {/* Address No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.addressNo}
                  </span>
                </td>

                {/* Customer No */}
                <td className="px-3 py-2 font-mono text-[11px]">
                  {item.customerNo && item.customerId ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/customers/${item.customerId}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {item.customerNo}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>

                {/* Customer Name */}
                <td className="px-3 py-2 text-[11px] text-adm-t2">
                  {item.customerName ?? <span className="text-adm-t3">—</span>}
                </td>

                {/* Label */}
                <td className="px-3 py-2 text-[11px] text-adm-t2 truncate max-w-[140px]" title={item.label ?? ''}>
                  {item.label ?? <span className="text-adm-t3">—</span>}
                </td>

                {/* Asset */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] text-adm-t1">{item.asset?.code || '—'}</span>
                </td>

                {/* Network */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] text-adm-t2">{item.network}</span>
                </td>

                {/* Address */}
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate max-w-[130px]" title={item.addressType === 'BANK' && item.iban ? item.iban : item.address}>
                      {item.addressType === 'BANK' && item.iban ? item.iban : item.address}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(item.addressType === 'BANK' && item.iban ? item.iban : item.address); }}
                      className="text-adm-t3 hover:text-adm-t1"
                      title="Copy address"
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </td>

                {/* Type */}
                <td className="px-4 py-2.5">
                  <AddressTypeBadge type={item.addressType} />
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>

                {/* Registered */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} address${total === 1 ? '' : 'es'}`
              : 'No addresses'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchItems(page)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default WithdrawalAddressList;

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
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
import { WalletRoleBadge, VAULT_LABELS } from '../utils/walletRole.util';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletItem {
  id: string;
  walletNo: string;
  vaultCode: string;
  walletRole: string;
  ownerType: string;
  ownerNo: string | null;
  ownerName?: string | null;
  network: string;
  address: string | null;
  iban: string | null;
  custodianRef: string | null;
  status: string;
  updatedAt: string;
  networkInfo: {
    kind: string;
    custodian: string;
    bankName: string | null;
    accountName: string | null;
    explorerUrl: string | null;
  } | null;
}

interface WalletListResponse {
  total: number;
  items: WalletItem[];
}

interface FilterState {
  walletNoSearch: string;
  customerNoSearch: string;
  ownerType: string;
  vaultCode: string;
  network: string;
  status: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

/** 分组表头的固定顺序（Step 3）。 */
const VAULT_ORDER = ['F_OPS', 'F_SET', 'F_FEE', 'F_LIQ', 'CLIENT_DEPOSIT'];

const DEFAULT_FILTERS: FilterState = {
  walletNoSearch: '',
  customerNoSearch: '',
  ownerType: '',
  vaultCode: '',
  network: '',
  status: '',
};

/* ── Component ───────────────────────────────────────────────── */

const CustodianWalletList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<WalletItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.walletNoSearch.trim()) params.set('q', next.walletNoSearch.trim());
    if (next.customerNoSearch.trim()) params.set('ownerNo', next.customerNoSearch.trim());
    if (next.ownerType) params.set('ownerType', next.ownerType);
    if (next.vaultCode) params.set('vaultCode', next.vaultCode);
    if (next.network) params.set('network', next.network);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load wallets.'));

      const data = (await res.json()) as WalletListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load wallets.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Grouping (Step 3: 按 vault 分组，固定顺序) ── */
  const groups = new Map<string, WalletItem[]>();
  for (const w of items) {
    const list = groups.get(w.vaultCode) ?? [];
    list.push(w);
    groups.set(w.vaultCode, list);
  }

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.walletNoSearch || !!filters.customerNoSearch || !!filters.ownerType
    || !!filters.vaultCode || !!filters.network || !!filters.status;

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
        title="Custodian Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
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
          className={`${fi} w-[210px]`}
          placeholder="Wallet No / IBAN / address"
          value={filters.walletNoSearch}
          onChange={(e) => updateFilter('walletNoSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <input
          className={`${fi} w-[170px]`}
          placeholder="Customer No"
          value={filters.customerNoSearch}
          onChange={(e) => updateFilter('customerNoSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <select
          value={filters.ownerType}
          onChange={(e) => updateFilter('ownerType', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All owners</option>
          <option value="PLATFORM">PLATFORM</option>
          <option value="CUSTOMER">CUSTOMER</option>
        </select>
        <select
          value={filters.vaultCode}
          onChange={(e) => updateFilter('vaultCode', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All vaults</option>
          <option value="F_OPS">F_OPS</option>
          <option value="F_SET">F_SET</option>
          <option value="F_FEE">F_FEE</option>
          <option value="F_LIQ">F_LIQ</option>
          <option value="CLIENT_DEPOSIT">CLIENT_DEPOSIT</option>
        </select>
        <select
          value={filters.network}
          onChange={(e) => updateFilter('network', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All networks</option>
          <option value="TRON">TRON</option>
          <option value="AED_ZAND">AED_ZAND</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All status</option>
          <option value="CREATING">CREATING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="FAILED">FAILED</option>
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
                  ['Wallet No',       '140px'],
                  ['Role',            '90px'],
                  ['Network',         '90px'],
                  ['Address / IBAN',  '220px'],
                  ['Owner No',        '120px'],
                  ['Owner Name',      '130px'],
                  ['Custodian',       '100px'],
                  ['Status',          '90px'],
                  ['Updated',         '150px'],
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
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.
                </td>
              </tr>
            )}
            {!loading && VAULT_ORDER.flatMap((vault) => {
              const rows = groups.get(vault);
              if (!rows || rows.length === 0) return [];
              return [
                <tr key={`group-${vault}`}>
                  <td colSpan={9} className="bg-adm-panel px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">
                    {VAULT_LABELS[vault]} · {vault}
                  </td>
                </tr>,
                ...rows.map((w) => (
                  <tr
                    key={w.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/custody/wallets/${w.walletNo}`)}
                  >
                    {/* Wallet No */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {w.walletNo}
                      </span>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-2.5">
                      <WalletRoleBadge role={w.walletRole} />
                    </td>

                    {/* Network */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] text-adm-t2">{w.network}</span>
                    </td>

                    {/* Address / IBAN */}
                    <td className="px-4 py-2.5">
                      <span
                        className="block max-w-[220px] truncate font-mono text-[11px] text-adm-t1"
                        title={w.address ?? w.iban ?? undefined}
                      >
                        {w.address ?? w.iban ?? '—'}
                      </span>
                    </td>

                    {/* Owner No */}
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {w.ownerType === 'CUSTOMER' && w.ownerNo ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/customers/${w.ownerNo}`); }}
                          className="text-adm-amber hover:underline"
                          title="Open customer"
                        >
                          {w.ownerNo}
                        </button>
                      ) : (
                        <span className="text-adm-t2">{w.ownerNo ?? '—'}</span>
                      )}
                    </td>
                    {/* Owner Name */}
                    <td className="px-3 py-2 text-[11px] text-adm-t2">
                      {w.ownerName ?? <span className="text-adm-t3">—</span>}
                    </td>

                    {/* Custodian */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] text-adm-t2">{w.networkInfo?.custodian ?? '—'}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <AdminBadge value={w.status} />
                    </td>

                    {/* Updated */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {fmt(w.updatedAt)}
                    </td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} wallet${total === 1 ? '' : 's'}`
              : 'No wallets'}
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

export default CustodianWalletList;

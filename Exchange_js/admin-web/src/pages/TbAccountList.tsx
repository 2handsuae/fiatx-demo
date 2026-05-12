import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface TbAccountRow {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  ownerNo: string | null;
  assetCode: string;
  status: string;
  description: string | null;
  flags: number;
  createdAt: string;
}

interface FilterState {
  assetCode: string;
  ownerType: string;
  code: string;
}

const CODE_LABELS: Record<number, string> = {
  1: 'BANK',
  10: 'CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  120: 'FEE_RECEIVABLE',
};

const CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  { value: '1', label: '1 · BANK' },
  { value: '10', label: '10 · CUSTODY' },
  { value: '100', label: '100 · CLIENT_CREDIT' },
  { value: '101', label: '101 · CLIENT_AUDIT' },
  { value: '110', label: '110 · TRADE_CLEARING' },
  { value: '120', label: '120 · FEE_RECEIVABLE' },
];

const DEFAULT_FILTERS: FilterState = { assetCode: '', ownerType: '', code: '' };
const PAGE_SIZE = 50;

const TbAccountList = () => {
  const [items, setItems] = useState<TbAccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const fetchData = async (overridePage?: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (filters.assetCode) params.set('assetCode', filters.assetCode);
      if (filters.ownerType) params.set('ownerType', filters.ownerType);
      if (filters.code) params.set('code', filters.code);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch TB accounts.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load TB accounts.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    void fetchData(1);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="TB Accounts"
        meta={`${total} account${total === 1 ? '' : 's'} · TigerBeetle Registry`}
      >
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          placeholder="Asset code…"
          value={filters.assetCode}
          onChange={(e) => setFilters((p) => ({ ...p, assetCode: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          className={`${fi} w-28`}
        />
        <select
          value={filters.ownerType}
          onChange={(e) => { setFilters((p) => ({ ...p, ownerType: e.target.value })); }}
          className={`${fi} w-36`}
        >
          <option value="">All owners</option>
          <option value="SYSTEM">SYSTEM</option>
          <option value="CUSTOMER">CUSTOMER</option>
          <option value="LP">LP</option>
        </select>
        <select
          value={filters.code}
          onChange={(e) => { setFilters((p) => ({ ...p, code: e.target.value })); }}
          className={`${fi} w-48`}
        >
          {CODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={applyFilters}
          className="h-[30px] rounded border border-adm-amber/30 bg-adm-amber/10 px-3 font-mono text-[11px] font-semibold text-adm-amber hover:bg-adm-amber/20 transition-colors"
        >
          Apply
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {['TB Account ID', 'Code', 'Ledger', 'Owner', 'Asset', 'Status', 'Created'].map((h) => (
                <th
                  key={h}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No accounts found.</td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.tbAccountId} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 max-w-[200px] truncate" title={row.tbAccountId}>
                  {row.tbAccountId}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-adm-t1 font-semibold">{row.code}</span>
                    <span className="text-adm-t3">·</span>
                    <span className="text-adm-amber text-[10px]">{CODE_LABELS[row.code] ?? '?'}</span>
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2">{row.ledger}</td>
                <td className="px-4 py-3">
                  <AdminBadge value={row.ownerType} />
                  {row.ownerNo && (
                    <div className="mt-0.5 font-mono text-[10px] text-adm-t3 truncate max-w-[120px]" title={row.ownerNo}>
                      {row.ownerNo}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-t1">{row.assetCode}</td>
                <td className="px-4 py-3"><AdminBadge value={row.status} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0 ? `Showing ${items.length} / ${total} accounts` : 'No accounts'}
          </span>
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
};

export default TbAccountList;

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

interface OutstandingItem {
  id: string;
  outstandingNo: string | null;
  direction: 'IN' | 'OUT';
  status: string;
  ownerNo: string | null;
  sourceNo: string | null;
  assetCode: string | null;
  asset?: { code?: string | null; decimals?: number | null } | null;
  amount: string;
  createdAt: string;
}

interface FilterState {
  status: string;
  direction: string;
  outstandingNo: string;
  ownerNo: string;
  sourceNo: string;
  assetId: string;
  startDate: string;
  endDate: string;
}

const PAGE_SIZE = 20;
const DEFAULT_FILTERS: FilterState = {
  status: '', direction: '', outstandingNo: '', ownerNo: '', sourceNo: '', assetId: '', startDate: '', endDate: '',
};

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const SwapOutstandingList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('sourceType', 'SWAP');
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.status) params.set('status', next.status);
      if (next.direction) params.set('direction', next.direction);
      if (next.outstandingNo.trim()) params.set('outstandingNo', next.outstandingNo.trim());
      if (next.ownerNo.trim()) params.set('ownerNo', next.ownerNo.trim());
      if (next.sourceNo.trim()) params.set('sourceNo', next.sourceNo.trim());
      if (next.assetId.trim()) params.set('assetId', next.assetId.trim());
      if (next.startDate) params.set('startDate', new Date(next.startDate).toISOString());
      if (next.endDate) params.set('endDate', new Date(next.endDate).toISOString());

      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/outstandings?${params.toString()}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load swap outstandings.'));
      const data = await res.json();
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load swap outstandings.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  const fi = 'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
  const hasFilter = Object.values(filters).some(Boolean);
  const updateFilter = (k: keyof FilterState, v: string) => setFilters((p) => ({ ...p, [k]: v }));
  const handleSearch = () => void fetchItems(1, filters);
  const handleReset = () => { setFilters(DEFAULT_FILTERS); void fetchItems(1, DEFAULT_FILTERS); };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Swap Outstandings" meta={`${total} outstanding${total === 1 ? '' : 's'}`}>
        <button onClick={() => void fetchItems(currentPage)} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Status</option>
          <option value="OPEN">OPEN</option>
          <option value="LOCKED">LOCKED</option>
          <option value="SETTLED">SETTLED</option>
        </select>
        <select value={filters.direction} onChange={(e) => updateFilter('direction', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Direction</option>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
        </select>
        <input value={filters.outstandingNo} onChange={(e) => updateFilter('outstandingNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Outstanding No" className={`${fi} w-40`} />
        <input value={filters.ownerNo} onChange={(e) => updateFilter('ownerNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Owner No" className={`${fi} w-36`} />
        <input value={filters.sourceNo} onChange={(e) => updateFilter('sourceNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Swap No" className={`${fi} w-40`} />
        <input value={filters.assetId} onChange={(e) => updateFilter('assetId', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Asset ID" className={`${fi} w-40`} />
        <input type="date" value={filters.startDate} onChange={(e) => updateFilter('startDate', e.target.value)} className={`${fi} w-36`} />
        <input type="date" value={filters.endDate} onChange={(e) => updateFilter('endDate', e.target.value)} className={`${fi} w-36`} />
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}><Search size={13} />Search</button>
        <button onClick={handleReset} disabled={!hasFilter} className={adminButtonClass('listSecondary')}>Reset</button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">{error}</div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {([
                ['Outstanding No', '180px'], ['Direction', '90px'], ['Status', '110px'], ['Owner No', '150px'],
                ['Swap No', '160px'], ['Asset / Amount', '180px'], ['Created', '150px'],
              ] as [string, string][]).map(([label, w]) => (
                <th key={label} style={{ width: w }} className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Asset / Amount' ? 'text-right' : 'text-left'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td></tr>)}
            {!loading && items.length === 0 && (<tr><td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No outstandings found.</td></tr>)}
            {!loading && items.map((item) => (
              <tr key={item.id} className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover" onClick={() => navigate('/admin/funds/outstandings/' + item.id)}>
                <td className="px-4 py-2.5"><span className="font-mono text-[11px] font-semibold text-adm-amber">{item.outstandingNo || '—'}</span></td>
                <td className="px-4 py-2.5"><AdminBadge value={item.direction} /></td>
                <td className="px-4 py-2.5"><AdminBadge value={item.status} /></td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.ownerNo || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.sourceNo || '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[11px] text-adm-t1">{formatAssetAmount(item.amount, item.asset?.decimals)} {item.assetCode || item.asset?.code || ''}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">{fmt(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">{total > 0 ? `Showing ${items.length} / ${total} outstanding${total === 1 ? '' : 's'}` : 'No outstandings'}</span>
          {total > PAGE_SIZE && (<Pagination currentPage={currentPage} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(page) => void fetchItems(page)} />)}
        </div>
      </div>
    </div>
  );
};

export default SwapOutstandingList;

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

interface FeeAccrualListItem {
  id: string;
  feeAccrualNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerNo: string | null;
  feeKind: 'SERVICE_FEE' | 'SPREAD';
  category: 'SWAP_FEE' | 'WITHDRAW_FEE';
  assetCode: string | null;
  amount: string;
  status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  settlementBatch: { id: string; batchNo: string | null } | null;
  settledByTransfer: { id: string; internalTxNo: string | null } | null;
  createdAt: string;
}

interface FilterState {
  feeAccrualNo: string;
  sourceNo: string;
  ownerNo: string;
  status: string;
  category: string;
  feeKind: string;
  assetCode: string;
  startDate: string;
  endDate: string;
}

const PAGE_SIZE = 20;
const DEFAULT_FILTERS: FilterState = {
  feeAccrualNo: '', sourceNo: '', ownerNo: '',
  status: '', category: '', feeKind: '', assetCode: '',
  startDate: '', endDate: '',
};

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const FeeAccrualList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<FeeAccrualListItem[]>([]);
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
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      if (next.feeAccrualNo.trim()) params.set('feeAccrualNo', next.feeAccrualNo.trim());
      if (next.sourceNo.trim()) params.set('sourceNo', next.sourceNo.trim());
      if (next.ownerNo.trim()) params.set('ownerNo', next.ownerNo.trim());
      if (next.status) params.set('status', next.status);
      if (next.category) params.set('category', next.category);
      if (next.feeKind) params.set('feeKind', next.feeKind);
      if (next.assetCode.trim()) params.set('assetCode', next.assetCode.trim());
      if (next.startDate) params.set('startDate', new Date(next.startDate).toISOString());
      if (next.endDate) params.set('endDate', new Date(next.endDate).toISOString());

      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/fee-accruals?${params.toString()}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load fee accruals.'));
      const data = await res.json();
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load fee accruals.');
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
      <PageTitleBar title="Fee Accruals" meta={`${total} accrual${total === 1 ? '' : 's'}`}>
        <button onClick={() => void fetchItems(currentPage)} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input value={filters.feeAccrualNo} onChange={(e) => updateFilter('feeAccrualNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Accrual No" className={`${fi} w-40`} />
        <input value={filters.sourceNo} onChange={(e) => updateFilter('sourceNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Source No" className={`${fi} w-40`} />
        <input value={filters.ownerNo} onChange={(e) => updateFilter('ownerNo', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Owner No" className={`${fi} w-36`} />
        <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Status</option>
          <option value="ACCRUED">ACCRUED</option>
          <option value="LOCKED">LOCKED</option>
          <option value="SETTLED">SETTLED</option>
        </select>
        <select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)} className={`${fi} w-36`}>
          <option value="">All Category</option>
          <option value="SWAP_FEE">SWAP_FEE</option>
          <option value="WITHDRAW_FEE">WITHDRAW_FEE</option>
        </select>
        <select value={filters.feeKind} onChange={(e) => updateFilter('feeKind', e.target.value)} className={`${fi} w-32`}>
          <option value="">All Kind</option>
          <option value="SERVICE_FEE">SERVICE_FEE</option>
          <option value="SPREAD">SPREAD</option>
        </select>
        <input value={filters.assetCode} onChange={(e) => updateFilter('assetCode', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Asset Code" className={`${fi} w-32`} />
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
                ['Accrual No', '180px'], ['Source', '200px'], ['Category', '130px'], ['Fee Kind', '130px'],
                ['Owner No', '150px'], ['Amount', '180px'], ['Status', '110px'], ['Batch', '160px'],
                ['Transfer', '160px'], ['Created', '150px'],
              ] as [string, string][]).map(([label, w]) => (
                <th key={label} style={{ width: w }} className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Amount' ? 'text-right' : 'text-left'}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td></tr>)}
            {!loading && items.length === 0 && (<tr><td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No accruals found.</td></tr>)}
            {!loading && items.map((item) => (
              <tr key={item.id} className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover" onClick={() => navigate('/admin/funds/fee-accruals/' + item.id)}>
                <td className="px-4 py-2.5"><span className="font-mono text-[11px] font-semibold text-adm-amber">{item.feeAccrualNo || '—'}</span></td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">{item.sourceType} {item.sourceNo || '—'}</td>
                <td className="px-4 py-2.5"><AdminBadge value={item.category} /></td>
                <td className="px-4 py-2.5"><AdminBadge value={item.feeKind} /></td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.ownerNo || '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[11px] text-adm-t1">{formatAssetAmount(item.amount, undefined)} {item.assetCode || ''}</td>
                <td className="px-4 py-2.5"><AdminBadge value={item.status} /></td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.settlementBatch?.batchNo || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">{item.settledByTransfer?.internalTxNo || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">{fmt(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">{total > 0 ? `Showing ${items.length} / ${total} accrual${total === 1 ? '' : 's'}` : 'No accruals'}</span>
          {total > PAGE_SIZE && (<Pagination currentPage={currentPage} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(page) => void fetchItems(page)} />)}
        </div>
      </div>
    </div>
  );
};

export default FeeAccrualList;

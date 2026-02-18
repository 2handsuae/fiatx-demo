import { useEffect, useState } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown, X, Eye } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatAssetAmount } from '../utils/number-format';

interface JournalLineItem {
  id: string;
  journalId: string;
  lineNo: number;
  accountCode: string;
  drCr: 'DR' | 'CR';
  amount: string;
  assetId: string;
  baseAmount: string | null;
  fxRate: string | null;
  dimensions: any;
  description: string | null;
  createdAt: string;
  journal: { eventCode: string; journalNo: string };
  account: { name: string };
  asset: { code: string; decimals?: number };
}

const JournalLinesList = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<JournalLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [journalNoSearch, setJournalNoSearch] = useState('');
  const [journalIdFilter, setJournalIdFilter] = useState<string | null>(null);

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const journalId = searchParams.get('journalId');
    if (journalId) {
      setJournalIdFilter(journalId);
    }
  }, [searchParams]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      if (journalNoSearch) params.append('journalNo', journalNoSearch);
      if (journalIdFilter) params.append('journalId', journalIdFilter);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/journal-lines?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
      } else {
        if (response.status === 401) {
            localStorage.removeItem('admin_token');
            navigate('/admin/login');
        }
      }
    } catch (error) {
      console.error('Failed to fetch Journal Lines', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, pageSize, sortBy, sortOrder, journalIdFilter]);

  const handleSearch = () => {
      setPage(1);
      fetchItems();
  };

  const clearJournalFilter = () => {
    setJournalIdFilter(null);
    setSearchParams({});
    setPage(1);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const SortableHeader = ({ field, label }: { field: string, label: string }) => (
    <th 
      className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={14} className={sortBy === field ? 'text-brand-primary' : 'text-gray-300'} />
      </div>
    </th>
  );

  const totalPages = Math.ceil(total / pageSize);

  const formatDateTime = (dateStr: string) => {
      return new Date(dateStr).toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
      });
  };

  const renderDrCr = (type: 'DR' | 'CR') => {
      const isDr = type === 'DR';
      return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${isDr ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'}`}>
              {type}
          </span>
      );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Lines</h1>
          <p className="text-sm text-gray-500 mt-1">Audit granular double-entry ledger records</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-md flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={journalNoSearch}
                    onChange={(e) => setJournalNoSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Journal No..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <button onClick={handleSearch} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    Search
                </button>
            </div>
            <button onClick={fetchItems} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white self-start md:self-auto">
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
        </div>

        {journalIdFilter && (
            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                <div className="text-sm text-blue-800 flex items-center gap-2">
                    <span className="font-semibold">Filtering by Journal:</span>
                    <span className="font-mono bg-white px-2 py-0.5 rounded border border-blue-200 text-xs">{journalIdFilter}</span>
                </div>
                <button 
                    onClick={clearJournalFilter}
                    className="p-1 hover:bg-blue-100 rounded text-blue-600 transition-colors"
                    title="Clear Filter"
                >
                    <X size={16} />
                </button>
            </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <SortableHeader field="journalId" label="Journal" />
                <SortableHeader field="lineNo" label="No." />
                <SortableHeader field="accountCode" label="Account" />
                <SortableHeader field="drCr" label="D/C" />
                <SortableHeader field="amount" label="Amount" />
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Base Amount</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                <SortableHeader field="createdAt" label="Time" />
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading lines...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    No records found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                        <div 
                            className="font-mono text-xs text-gray-900 cursor-pointer hover:text-brand-primary font-bold" 
                            title={item.journalId}
                            onClick={() => navigate(`/ledger/journals/${item.journalId}`)}
                        >
                            {item.journal.journalNo || '-'}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{item.journal.eventCode}</div>
                    </td>
                    <td className="px-4 py-4 font-medium text-gray-900">{item.lineNo}</td>
                    <td className="px-4 py-4">
                        <div className="font-bold text-gray-700">{item.accountCode}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[120px]" title={item.account.name}>{item.account.name}</div>
                        {item.description && (
                            <div className="text-[9px] text-blue-500 italic truncate max-w-[120px]" title={item.description}>
                                {item.description}
                            </div>
                        )}
                    </td>
                    <td className="px-4 py-4">{renderDrCr(item.drCr)}</td>
                    <td className="px-4 py-4 font-bold text-gray-900">
                        {formatAssetAmount(item.amount, item.asset?.decimals)}
                    </td>
                    <td className="px-4 py-4">
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-bold text-gray-600">{item.asset.code}</span>
                    </td>
                    <td className="px-4 py-4 text-gray-500">
                        {item.baseAmount ? Number(item.baseAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : '-'}
                    </td>
                    <td className="px-4 py-4 text-gray-400 text-[10px]">
                        {item.fxRate ? Number(item.fxRate).toFixed(6) : '-'}
                    </td>
                    <td className="px-4 py-4 text-[10px] text-gray-500 whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-right">
                        <button 
                            onClick={() => navigate(`/ledger/journal-lines/${item.id}`)}
                            className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors" 
                            title="View Details"
                        >
                            <Eye size={16} />
                        </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 border-t border-admin-border flex items-center justify-between bg-gray-50">
            <div className="text-sm text-gray-500">
                Showing {items.length} of {total} entries
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1 rounded hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronLeft size={20} />
                </button>
                <span className="text-sm font-medium text-gray-700 bg-white px-3 py-1 rounded border border-gray-200 shadow-sm">
                    Page {page} of {totalPages || 1}
                </span>
                <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded hover:bg-white border border-transparent hover:border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronRight size={20} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default JournalLinesList;

import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface JournalItem {
  id: string;
  journalNo: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  eventCode: string | null;
  postingStatus: string;
  postedAt: string | null;
  baseAssetId: string;
  baseAsset: { code: string; type: string };
  reversalOfJournalId: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const JournalList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<JournalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filters
  const [journalNoSearch, setJournalNoSearch] = useState('');

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  interface FetchOverrides {
    journalNoSearch?: string;
    page?: number;
  }

  const hasFilters = useMemo(() => !!journalNoSearch.trim(), [journalNoSearch]);

  const fetchItems = async (overrides: FetchOverrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const nextJournalNoSearch = overrides.journalNoSearch ?? journalNoSearch;
      const nextPage = overrides.page ?? page;
      const params = new URLSearchParams();
      params.append('skip', ((nextPage - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      if (nextJournalNoSearch) params.append('journalNo', nextJournalNoSearch);
      
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/journals?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch journals.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch Journals', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch journals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, [page, pageSize, sortBy, sortOrder]);

  const handleSearch = () => {
      setPage(1);
      void fetchItems({ page: 1 });
  };

  const resetFilters = async () => {
    setJournalNoSearch('');
    setPage(1);
    await fetchItems({ journalNoSearch: '', page: 1 });
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const renderStatusBadge = (status: string) => {
    const isSuccess = status === 'POSTED';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isSuccess ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
        {status}
      </span>
    );
  };

  const SortableHeader = ({ field, label }: { field: string, label: string }) => (
    <th 
      className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={14} className={sortBy === field ? 'text-brand-primary' : 'text-gray-300'} />
      </div>
    </th>
  );

  const totalPages = Math.ceil(total / pageSize);

  const formatDateTime = (dateStr: string | null) => {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
      }).replace(/\//g, '-');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal List</h1>
          <p className="text-sm text-gray-500 mt-1">View and audit all accounting journal entries</p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

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
                <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
                    Search
                </button>
                <button
                  onClick={() => void resetFilters()}
                  className={adminButtonClass('listSecondary')}
                  disabled={!hasFilters || loading}
                >
                  Reset
                </button>
            </div>
            <button onClick={() => void fetchItems()} className={adminIconButtonClass('self-start md:self-auto')}>
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <SortableHeader field="journalNo" label="Journal No" />
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source No</th>
                <SortableHeader field="eventCode" label="Event Code" />
                <SortableHeader field="postingStatus" label="Status" />
                <SortableHeader field="postedAt" label="Posted At" />
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Description</th>
                <SortableHeader field="createdAt" label="Created At" />
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading journals...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    No journal entries found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                        <button
                            type="button"
                            className={adminButtonClass('rowKeyLink')}
                            onClick={() => navigate(`/ledger/journals/${item.id}`)}
                            title={item.journalNo}
                        >
                            {item.journalNo || '-'}
                        </button>
                        {item.reversalOfJournalId && (
                            <div className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                                <RefreshCw size={10} />
                                Reversal Entry
                            </div>
                        )}
                    </td>
                    <td className="px-6 py-4">
                        <div className="text-xs text-gray-900 font-medium">{item.sourceType}</div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">{item.sourceNo || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                        <span className="text-xs font-medium text-gray-600">{item.eventCode}</span>
                    </td>
                    <td className="px-6 py-4">{renderStatusBadge(item.postingStatus)}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">{formatDateTime(item.postedAt)}</td>
                    <td className="px-6 py-4 max-w-[150px] truncate text-xs text-gray-500" title={item.description || ''}>
                        {item.description || '-'}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">{formatDateTime(item.createdAt)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        <button 
                          onClick={() => navigate(`/ledger/journals/${item.id}`)}
                          className={adminButtonClass('rowLink')}
                          title="View"
                        >
                            View
                        </button>
                        <button 
                          onClick={() => navigate(`/ledger/journal-lines?journalId=${item.id}`)}
                          className={adminButtonClass('rowSecondaryUtility')}
                          title="Lines"
                        >
                            Lines
                        </button>
                      </div>
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

export default JournalList;

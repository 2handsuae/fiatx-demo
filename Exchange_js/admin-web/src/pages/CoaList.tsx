import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Plus, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface CoaItem {
  id: string;
  code: string;
  type: string;
  name: string;
  status: string;
  requiredTags: string[];
  createdAt: string;
}

const CoaList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<CoaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [codeSearch, setCodeSearch] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  
  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('code');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [error, setError] = useState('');

  const hasFilters = useMemo(
    () => Boolean(codeSearch.trim() || nameSearch.trim()),
    [codeSearch, nameSearch],
  );

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      if (codeSearch) params.append('code', codeSearch);
      if (nameSearch) params.append('name', nameSearch);
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);
      
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/coa?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
        return;
      }
    } catch (error) {
      console.error('Failed to fetch COA', error);
      setError('Failed to fetch accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, pageSize, sortBy, sortOrder]);

  const handleSearch = () => {
      setPage(1);
      fetchItems();
  };

  const handleReset = () => {
    setCodeSearch('');
    setNameSearch('');
    setPage(1);
    setItems([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/coa?skip=0&take=${pageSize}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
        );
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          setTotal(result.total || 0);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to fetch accounts.'));
      } catch (resetError) {
        console.error('Failed to reset COA filters', resetError);
        setError('Failed to fetch accounts.');
      } finally {
        setLoading(false);
      }
    })();
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
    const isSuccess = status === 'ACTIVE';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isSuccess ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">Manage ledger accounts and definitions</p>
        </div>
        <div className="flex gap-3">
            <button
              onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
              className={adminButtonClass('listSecondary')}
            >
                <Plus size={20} />
                <span>Open Release Center</span>
            </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        COA is now managed by config-as-code and Business Config Releases. This page remains read-only for current active accounts.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex gap-4 flex-1">
                 <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={codeSearch}
                    onChange={(e) => setCodeSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Code..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={nameSearch}
                    onChange={(e) => setNameSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Name..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
                    Search
                </button>
                <button
                  onClick={handleReset}
                  className={adminButtonClass('listSecondary')}
                  disabled={!hasFilters && !error}
                >
                  Reset
                </button>
            </div>
          <button onClick={fetchItems} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <SortableHeader field="code" label="Code" />
                <SortableHeader field="type" label="Type" />
                <SortableHeader field="name" label="Name" />
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Required Tags</th>
                <SortableHeader field="status" label="Status" />
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading accounts...
                    </div>
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No accounts found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{item.code}</td>
                    <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {item.type}
                        </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                            {item.requiredTags && item.requiredTags.length > 0 ? (
                                item.requiredTags.map((tag, idx) => (
                                    <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-100">
                                        {tag}
                                    </span>
                                ))
                            ) : (
                                <span className="text-gray-400 text-xs">-</span>
                            )}
                        </div>
                    </td>
                    <td className="px-6 py-4">{renderStatusBadge(item.status)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-3 items-center">
                        <button
                            className={adminButtonClass('rowSecondaryUtility')}
                            title="Read-only"
                            onClick={() => showBusinessConfigReadOnlyAlert('COA')}
                        >
                            Read-only
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
        <div className="px-6 py-4 border-t border-admin-border flex items-center justify-between">
            <div className="text-sm text-gray-500">
                Showing {items.length} of {total} entries
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={20} />
                </button>
                <span className="text-sm font-medium text-gray-700">
                    Page {page} of {totalPages || 1}
                </span>
                <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={20} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default CoaList;

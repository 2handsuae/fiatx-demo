import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface TemplateItem {
  id: string;
  templateCode: string;
  eventCode: string;
  version: number;
  status: 'ACTIVE' | 'INACTIVE';
  baseAssetId: string;
  description: string;
  updatedAt: string;
  acctEvent?: { eventCode: string };
  baseAsset?: { code: string };
}

const JournalHeaderTemplateList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const hasFilters = useMemo(() => Boolean(search.trim()), [search]);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      if (search) params.append('templateCode', search);
      
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/journal-header-templates?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
        return;
      }
    } catch (error) {
      console.error('Failed to fetch templates', error);
      setError('Failed to fetch journal templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, pageSize]);

  const handleSearch = () => {
      setPage(1);
      fetchItems();
  };

  const handleReset = () => {
    setSearch('');
    setPage(1);
    setItems([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/journal-header-templates?skip=0&take=${pageSize}`,
        );
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          setTotal(result.total || 0);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to fetch journal templates.'));
      } catch (resetError) {
        console.error('Failed to reset journal template filters', resetError);
        setError('Failed to fetch journal templates.');
      } finally {
        setLoading(false);
      }
    })();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Header Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Manage standard templates for journal entries</p>
        </div>
        <button 
            onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
            className={adminButtonClass('listSecondary')}
        >
            <Plus size={20} />
            <span>Open Release Center</span>
        </button>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Journal header templates are now release-managed. This page remains read-only for current active headers, while line inspection stays available.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-md flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Template Code..." 
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
            <button onClick={fetchItems} className={adminIconButtonClass('self-start md:self-auto')}>
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Template Code</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Event</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Ver</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Base Asset</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading templates...
                    </div>
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No templates found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                        <div className="font-mono font-bold text-gray-800">{item.templateCode}</div>
                        <div className="text-[10px] text-gray-400">{item.description}</div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-blue-600">{item.eventCode}</td>
                    <td className="px-4 py-4 text-xs">v{item.version}</td>
                    <td className="px-4 py-4">
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-bold text-gray-600">
                            {item.baseAsset?.code || item.baseAssetId}
                        </span>
                    </td>
                    <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${item.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.status}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-3 items-center">
                        <button 
                            className={adminButtonClass('rowSecondaryUtility')}
                            onClick={() => navigate(`/dashboard/system/journal-line-templates?templateId=${item.id}`)}
                        >
                            Lines
                        </button>
                        <button 
                            className={adminButtonClass('rowSecondaryUtility')}
                            onClick={() => showBusinessConfigReadOnlyAlert('Journal templates')}
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

export default JournalHeaderTemplateList;

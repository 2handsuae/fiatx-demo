import { useEffect, useState } from 'react';
import { Search, RefreshCw, Edit2, Power, ChevronLeft, ChevronRight, ArrowUpDown, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';

interface AcctEventItem {
  id: string;
  eventCode: string;
  entityType: string;
  ownerScope: string;
  assetType: string;
  triggerType: string;
  postingMode: string;
  clearingMode: string;
  isActive: boolean;
  description: string;
}

const AcctEventList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AcctEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [eventCodeSearch, setEventCodeSearch] = useState('');

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      if (eventCodeSearch) params.append('eventCode', eventCodeSearch);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/acct-events?${params.toString()}`, {
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
      console.error('Failed to fetch Acct Events', error);
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

  const handleToggleActive = async (eventCode: string, currentStatus: boolean) => {
      void eventCode;
      void currentStatus;
      showBusinessConfigReadOnlyAlert('Accounting events');
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Code Management</h1>
          <p className="text-sm text-gray-500 mt-1">Configure accounting event definitions and rules</p>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
                <Settings size={20} />
                <span>Open Release Center</span>
            </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Accounting events are now managed by config-as-code and Business Config Releases. This page remains read-only for current active rows.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1 max-w-md flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={eventCodeSearch}
                    onChange={(e) => setEventCodeSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Event Code..." 
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

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <SortableHeader field="eventCode" label="Event Code" />
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Entity</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Scope</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Trigger</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Posting</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Clearing</th>
                <SortableHeader field="isActive" label="Status" />
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading events...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                    No event codes found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                        <div className="font-mono font-bold text-gray-800">{item.eventCode}</div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[150px]">{item.description}</div>
                    </td>
                    <td className="px-4 py-4"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{item.entityType}</span></td>
                    <td className="px-4 py-4 text-xs">{item.ownerScope}</td>
                    <td className="px-4 py-4 text-xs">{item.assetType}</td>
                    <td className="px-4 py-4">
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100">{item.triggerType}</span>
                    </td>
                    <td className="px-4 py-4 text-xs">{item.postingMode}</td>
                    <td className="px-4 py-4 text-xs">{item.clearingMode}</td>
                    <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${item.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        <button 
                            className="p-1.5 text-gray-300 rounded transition-colors cursor-not-allowed"
                            onClick={() => showBusinessConfigReadOnlyAlert('Accounting events')}
                            title="Read-only"
                        >
                            <Edit2 size={16} />
                        </button>
                        <button 
                            className="p-1.5 rounded text-gray-300 transition-colors cursor-not-allowed"
                            onClick={() => handleToggleActive(item.eventCode, item.isActive)}
                            title="Read-only"
                        >
                            <Power size={16} />
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

export default AcctEventList;

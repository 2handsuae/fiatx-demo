import React, { useEffect, useState } from 'react';
import { 
  Search, 
  RefreshCw, 
  Eye, 
  Play,
  ChevronLeft, 
  ChevronRight,
  ArrowUpDown,
  Calendar
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ClearingItem {
  id: string;
  clearingNo: string;
  clearingType: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string;
  outAmount: number;
  outAssetId: string;
  outAssetNo?: string;
  clearingStatus: string;
  createdAt: string;
}

const ClearingManagementList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ClearingItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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

      if (search) params.append('sourceId', search);
      if (status) params.append('clearingStatus', status);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/clearings?${params.toString()}`, {
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
      console.error('Failed to fetch clearings', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, pageSize, status, sortBy, sortOrder]);

  const handleSearch = () => {
      setPage(1);
      fetchItems();
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

  const handleReClear = async (id: string) => {
      if (!window.confirm('Are you sure you want to re-run the clearing process for this item?')) return;
      
      try {
          const token = localStorage.getItem('admin_token');
          const response = await fetch(`${import.meta.env.VITE_API_URL}/clearings/${id}/re-clear`, {
              method: 'POST',
              headers: {
                  'Authorization': `Bearer ${token}`
              }
          });
          
          if (response.ok) {
              alert('Re-clearing triggered successfully');
              fetchItems();
          } else {
              alert('Failed to trigger re-clearing');
          }
      } catch (error) {
          console.error('Re-clear failed', error);
      }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clearing</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and manage business clearing records</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex flex-1 gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
                    <input 
                    type="text" 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search by Source ID..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary"
                >
                    <option value="">All Status</option>
                    <option value="OPEN">Open</option>
                    <option value="POSTED">Posted</option>
                    <option value="SETTLED">Settled</option>
                    <option value="CANCELLED">Cancelled</option>
                </select>
                <button onClick={handleSearch} className="px-6 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
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
                <SortableHeader field="clearingNo" label="Clearing ID / Batch" />
                <SortableHeader field="sourceType" label="Source Business" />
                <SortableHeader field="outAmount" label="Amount" />
                <SortableHeader field="clearingStatus" label="Status" />
                <SortableHeader field="createdAt" label="Clearing Time" />
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading records...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No clearing records found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                        <div className="font-mono font-bold text-brand-primary text-xs truncate max-w-[120px]" title={item.clearingNo}>
                            {item.clearingNo || '-'}
                        </div>
                        <div className="text-[10px] text-gray-500">{item.clearingType}</div>
                    </td>
                    <td className="px-4 py-4">
                        <div className="text-gray-900 font-medium">{item.sourceType}</div>
                        <div className="text-[10px] text-blue-600 font-mono font-bold" title={item.sourceId}>
                            {item.sourceNo || item.sourceId}
                        </div>
                    </td>
                    <td className="px-4 py-4">
                        <div className="font-bold text-gray-900">{item.outAmount}</div>
                        <div className="text-[10px] text-gray-500 font-bold" title={item.outAssetId}>
                            {item.outAssetNo || item.outAssetId}
                        </div>
                    </td>
                    <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium 
                            ${item.clearingStatus === 'SETTLED' ? 'bg-green-100 text-green-800' : 
                              item.clearingStatus === 'OPEN' ? 'bg-blue-100 text-blue-800' : 
                              'bg-gray-100 text-gray-800'}`}>
                            {item.clearingStatus}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-gray-500 text-xs">
                        <div className="flex items-center gap-1">
                            <Calendar size={12} />
                            {formatDateTime(item.createdAt)}
                        </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        <button 
                            className="p-1.5 text-gray-500 hover:text-brand-primary rounded hover:bg-gray-100 transition-colors"
                            onClick={() => navigate(`/clearing/management/${item.id}`)}
                            title="View Details"
                        >
                            <Eye size={16} />
                        </button>
                        <button 
                            className="p-1.5 text-gray-500 hover:text-brand-primary rounded hover:bg-gray-100 transition-colors"
                            onClick={() => handleReClear(item.id)}
                            title="Re-Clear"
                        >
                            <Play size={16} />
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

export default ClearingManagementList;

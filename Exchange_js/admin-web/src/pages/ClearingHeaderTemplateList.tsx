import React, { useEffect, useState } from 'react';
import { 
  Search, 
  RefreshCw, 
  Plus, 
  Edit2, 
  Power, 
  List,
  ChevronLeft, 
  ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TemplateItem {
  id: string;
  code: string;
  clearingType: string;
  sourceType: string;
  isEnabled: boolean;
  description: string;
  updatedAt: string;
}

const ClearingHeaderTemplateList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      if (search) params.append('code', search);
      if (status) params.append('status', status);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/clearing-templates?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch templates', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, pageSize, status]);

  const handleSearch = () => {
      setPage(1);
      fetchItems();
  };

  const handleToggleStatus = async (id: string, currentEnabled: boolean) => {
      if (!window.confirm(`Are you sure you want to ${currentEnabled ? 'deactivate' : 'activate'} this template?`)) return;
      
      try {
          const token = localStorage.getItem('admin_token');
          const response = await fetch(`${import.meta.env.VITE_API_URL}/clearing-templates/${id}`, {
              method: 'PATCH',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ isEnabled: !currentEnabled })
          });
          
          if (response.ok) {
              fetchItems();
          } else {
              alert('Failed to update status');
          }
      } catch (error) {
          console.error('Update failed', error);
      }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clearing Header Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Manage rules and templates for clearing processes</p>
        </div>
        <button 
            onClick={() => alert('Create functionality coming next...')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
        >
            <Plus size={20} />
            <span>Create Template</span>
        </button>
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
                    placeholder="Search by Code..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary"
                >
                    <option value="">All Status</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
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
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Template Name/Code</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Clearing Type</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Source Type</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                <th className="px-4 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading templates...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No templates found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                        <div className="font-mono font-bold text-gray-800">{item.code}</div>
                        <div className="text-[10px] text-gray-400">{item.description}</div>
                    </td>
                    <td className="px-4 py-4">
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                            {item.clearingType}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-gray-600">{item.sourceType}</td>
                    <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${item.isEnabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.isEnabled ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                    </td>
                    <td className="px-4 py-4 text-gray-500 text-xs">
                        {new Date(item.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        <button 
                            className="p-1.5 text-gray-500 hover:text-brand-primary rounded hover:bg-gray-100 transition-colors"
                            onClick={() => navigate(`/dashboard/system/clearing-line-templates?templateId=${item.id}`)}
                            title="Manage Lines"
                        >
                            <List size={16} />
                        </button>
                        <button 
                            className="p-1.5 text-gray-500 hover:text-brand-primary rounded hover:bg-gray-100 transition-colors"
                            onClick={() => alert('Edit coming soon')}
                            title="Edit"
                        >
                            <Edit2 size={16} />
                        </button>
                        <button 
                            className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${item.isEnabled ? 'text-green-600 hover:text-red-600' : 'text-gray-400 hover:text-green-600'}`}
                            onClick={() => handleToggleStatus(item.id, item.isEnabled)}
                            title={item.isEnabled ? 'Deactivate' : 'Activate'}
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

export default ClearingHeaderTemplateList;

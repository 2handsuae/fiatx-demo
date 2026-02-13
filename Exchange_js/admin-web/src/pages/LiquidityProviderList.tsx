import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Filter, RefreshCw, Plus, Edit, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface LiquidityProvider {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

const LiquidityProviderList = () => {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<LiquidityProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(`${import.meta.env.VITE_API_URL}/liquidity-providers?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setProviders(result.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch liquidity providers', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, [search, statusFilter]);

  const handleStatusChange = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'INACTIVE' ? 'deactivate' : 'activate'} this provider?`)) return;

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/liquidity-providers/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (response.ok) {
        fetchProviders();
      } else {
        alert('Failed to update status');
      }
    } catch (error) {
      console.error('Failed to update status', error);
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const renderStatusBadge = (status: string) => {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {status}
      </span>
    );
  };

  const downloadCSV = () => {
    if (providers.length === 0) return;

    const headers = ['ID', 'Name', 'Email', 'Phone', 'Status', 'Created At'];
    const rows = providers.map(p => [
      p.id,
      p.name,
      p.email || '',
      p.phone || '',
      p.status,
      p.createdAt
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `liquidity_providers_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidity Providers</h1>
          <p className="text-sm text-gray-500 mt-1">Manage external liquidity sources and their configurations</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchProviders} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={downloadCSV} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white" title="Export CSV">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          </button>
          <button 
            onClick={() => navigate('/dashboard/system/liquidity-providers/create')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors shadow-sm"
          >
            <Plus size={20} /> New Provider
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..." 
              className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Name / Contact</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && providers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading providers...
                    </div>
                  </td>
                </tr>
              ) : providers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No liquidity providers found
                  </td>
                </tr>
              ) : (
                providers.map((provider) => (
                  <tr key={provider.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4 text-xs text-gray-500 font-mono">
                      {provider.id}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{provider.name}</div>
                      <div className="text-gray-500 text-xs">
                        {provider.email && <div className="flex items-center gap-1">✉️ {provider.email}</div>}
                        {provider.phone && <div className="flex items-center gap-1">📞 {provider.phone}</div>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(provider.status)}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      <div title={formatDate(provider.createdAt)}>
                        {formatRelativeTime(provider.createdAt)}
                      </div>
                      <div className="text-gray-400 mt-0.5">
                        {new Date(provider.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleStatusChange(provider.id, provider.status)}
                          className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${provider.status === 'ACTIVE' ? 'text-red-500' : 'text-green-500'}`}
                          title={provider.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        >
                          {provider.status === 'ACTIVE' ? <XCircle size={18} /> : <CheckCircle size={18} />}
                        </button>
                        <button className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors" title="Edit">
                          <Edit size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-admin-border bg-admin-content-bg text-xs text-gray-500 flex justify-between items-center">
          <span>Showing {providers.length} records</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Previous</button>
            <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidityProviderList;

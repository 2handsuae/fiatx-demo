import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Plus } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface Asset {
  id: string;
  assetNo?: string | null;
  type: 'FIAT' | 'CRYPTO';
  code: string;
  network: string | null;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

const AssetList = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const hasFilters = !!search.trim() || !!typeFilter || !!statusFilter;

  type AssetFilters = {
    search: string;
    typeFilter: string;
    statusFilter: string;
  };

  const fetchAssets = async (overrides?: Partial<AssetFilters>) => {
    setLoading(true);
    setError('');
    try {
      const nextFilters: AssetFilters = {
        search,
        typeFilter,
        statusFilter,
        ...overrides,
      };
      const params = new URLSearchParams();
      if (nextFilters.search.trim()) params.append('code', nextFilters.search.trim());
      if (nextFilters.typeFilter) params.append('type', nextFilters.typeFilter);
      if (nextFilters.statusFilter) params.append('status', nextFilters.statusFilter);

      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setAssets(result.items || []);
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to fetch assets.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch assets', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch assets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAssets();
  }, []);

  const resetFilters = async () => {
    setSearch('');
    setTypeFilter('');
    setStatusFilter('');
    await fetchAssets({
      search: '',
      typeFilter: '',
      statusFilter: '',
    });
  };

  const handleStatusChange = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'DISABLED' ? 'disable' : 'activate'} this asset?`)) return;

    try {
      setError('');
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (response.ok) {
        await fetchAssets();
      } else {
        setError(await getApiErrorMessage(response, 'Failed to update asset status.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to update status', error);
      setError(error instanceof Error ? error.message : 'Failed to update asset status.');
    }
  };

  const renderStatusBadge = (status: string) => {
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <p className="text-sm text-gray-500 mt-1">Manage system assets and tokens</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void fetchAssets()} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => navigate('/dashboard/system/assets/create')}
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={20} /> New Asset
          </button>
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void fetchAssets()}
                placeholder="Search by asset code..." 
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
              />
            </div>
            <button
              type="button"
              onClick={() => void fetchAssets()}
              className={adminButtonClass('listPrimary')}
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => void resetFilters()}
              className={adminButtonClass('listSecondary')}
              disabled={!hasFilters || loading}
            >
              Reset
            </button>
          </div>
          <div className="flex gap-2">
            <select 
              value={typeFilter} 
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Types</option>
              <option value="FIAT">Fiat</option>
              <option value="CRYPTO">Crypto</option>
            </select>
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Network</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Decimals</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && assets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading assets...
                    </div>
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No assets found
                  </td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${asset.type === 'CRYPTO' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                        {asset.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      <button
                        type="button"
                        onClick={() => navigate(`/dashboard/system/assets/${asset.id}`)}
                        className={adminButtonClass('rowKeyLink')}
                        title={asset.assetNo || asset.code}
                      >
                        {asset.assetNo || asset.code}
                      </button>
                      <div className="text-xs text-gray-500">{asset.code}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {asset.network || '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {asset.decimals}
                    </td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={asset.description || ''}>
                      {asset.description || '-'}
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(asset.status)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => navigate(`/dashboard/system/assets/${asset.id}`)}
                          className={adminButtonClass('rowLink')}
                        >
                          View
                        </button>
                        <button 
                          onClick={() => handleStatusChange(asset.id, asset.status)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {asset.status === 'ACTIVE' ? 'Disable' : 'Enable'}
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
          <span>Showing {assets.length} records</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Previous</button>
            <button className="px-3 py-1 border border-admin-border rounded bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors" disabled>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetList;

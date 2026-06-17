import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Plus, ArrowRightLeft } from 'lucide-react';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface LiquidityConfig {
  id: string;
  lpId: string;
  lp: { name: string };
  fromAsset: { code: string; type: string };
  toAsset: { code: string; type: string };
  rateSourceType: 'API';
  spreadPercent: string;
  feePercent: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

const LiquidityConfigList = () => {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<LiquidityConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  const hasFilters = useMemo(() => Boolean(statusFilter), [statusFilter]);

  const fetchConfigs = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/liquidity-configurations?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setConfigs(result.items || []);
        return;
      }
    } catch (error) {
      console.error('Failed to fetch liquidity configurations', error);
      setError('Failed to fetch liquidity configurations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleStatusChange = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'INACTIVE' ? 'deactivate' : 'activate'} this configuration?`)) return;

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/liquidity-configurations/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (response.ok) {
        fetchConfigs();
      } else {
        setError(await getApiErrorMessage(response, 'Failed to update status.'));
      }
    } catch (error) {
      console.error('Failed to update status', error);
      setError('Failed to update status.');
    }
  };

  const handleReset = () => {
    setStatusFilter('');
    setError('');
    setConfigs([]);
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(`${import.meta.env.VITE_API_URL}/liquidity-configurations`);
        if (response.ok) {
          const result = await response.json();
          setConfigs(result.items || []);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to fetch liquidity configurations.'));
      } catch (resetError) {
        console.error('Failed to reset liquidity configuration filters', resetError);
        setError('Failed to fetch liquidity configurations.');
      } finally {
        setLoading(false);
      }
    })();
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
          <h1 className="text-2xl font-bold text-gray-900">LP Liquidity Configuration</h1>
          <p className="text-sm text-gray-500 mt-1">LP routing config only (not used for customer-platform swap pricing)</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchConfigs} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => navigate('/admin/counterparty/liquidity-config/create')}
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={20} /> New Config
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end gap-2">
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
            <button onClick={fetchConfigs} className={adminButtonClass('listPrimary')}>
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Pair</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Spread</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Fee</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading && configs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading configurations...
                    </div>
                  </td>
                </tr>
              ) : !error && configs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No configurations found
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {config.lp.name}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{config.fromAsset.code}</span>
                        <ArrowRightLeft size={14} className="text-gray-400" />
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{config.toAsset.code}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                        {config.rateSourceType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {Number(config.spreadPercent)}%
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {Number(config.feePercent)}%
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(config.status)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button 
                          type="button"
                          onClick={() => handleStatusChange(config.id, config.status)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {config.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                        {config.status === 'INACTIVE' && (
                          <button 
                            onClick={() => navigate(`/admin/counterparty/liquidity-config/edit/${config.id}`)}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LiquidityConfigList;

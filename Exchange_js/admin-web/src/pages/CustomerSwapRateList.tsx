import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, CheckCircle, Edit, Plus, RefreshCw, XCircle } from 'lucide-react';

interface CustomerSwapRateConfig {
  id: string;
  fromAsset: { code: string; type: string };
  toAsset: { code: string; type: string };
  spreadPercent: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

const CustomerSwapRateList = () => {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<CustomerSwapRateConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/customers/swap-rates?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        setConfigs(result.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch customer swap rate configurations', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, [statusFilter]);

  const handleStatusChange = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!window.confirm(`Are you sure you want to ${newStatus === 'INACTIVE' ? 'deactivate' : 'activate'} this configuration?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/customers/swap-rates/${id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        fetchConfigs();
      } else {
        alert('Failed to update status');
      }
    } catch (error) {
      console.error('Failed to update status', error);
    }
  };

  const renderStatusBadge = (status: string) => (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {status}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Swap Rate Config</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure platform-facing rates for customer swap pairs
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchConfigs}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/dashboard/pricing/rates/create')}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors shadow-sm"
          >
            <Plus size={20} /> New Config
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end">
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

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Pair</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Spread</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading configurations...
                    </div>
                  </td>
                </tr>
              ) : configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No configurations found
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{config.fromAsset.code}</span>
                        <ArrowRightLeft size={14} className="text-gray-400" />
                        <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{config.toAsset.code}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{Number(config.spreadPercent)}%</td>
                    <td className="px-6 py-4">{renderStatusBadge(config.status)}</td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(config.createdAt).toLocaleString('en-US')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleStatusChange(config.id, config.status)}
                          className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${
                            config.status === 'ACTIVE' ? 'text-red-500' : 'text-green-500'
                          }`}
                          title={config.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        >
                          {config.status === 'ACTIVE' ? <XCircle size={18} /> : <CheckCircle size={18} />}
                        </button>
                        <button
                          onClick={() => navigate(`/dashboard/pricing/rates/edit/${config.id}`)}
                          className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
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
      </div>
    </div>
  );
};

export default CustomerSwapRateList;

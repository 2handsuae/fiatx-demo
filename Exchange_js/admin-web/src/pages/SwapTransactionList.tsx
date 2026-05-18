import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface SwapTransaction {
  id: string;
  swapNo: string;
  ownerType: string;
  ownerId: string;
  status: string;
  fromAsset: { currency: string; code: string; type: string; decimals?: number | null };
  fromAmount: string;
  toAsset: { currency: string; code: string; type: string; decimals?: number | null };
  toAmount: string;
  exchangeRate: string;
  createdAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
}

const SwapTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SwapTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [swapNo, setSwapNo] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const hasFilters = useMemo(
    () => Boolean(swapNo.trim() || ownerId.trim() || statusFilter),
    [swapNo, ownerId, statusFilter],
  );

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (swapNo) params.append('swapNo', swapNo);
      if (ownerId) params.append('ownerId', ownerId);
      if (statusFilter) params.append('status', statusFilter);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        return;
      }
      setError(await getApiErrorMessage(response, 'Failed to load swap transactions.'));
    } catch (error) {
      console.error('Failed to fetch swap transactions', error);
      setError('Failed to load swap transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleSearch = () => {
    fetchItems();
  };

  const handleReset = () => {
    setSwapNo('');
    setOwnerId('');
    setStatusFilter('');
    setItems([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/swap-transactions`,
        );
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to load swap transactions.'));
      } catch (resetError) {
        console.error('Failed to reset swap transactions', resetError);
        setError('Failed to load swap transactions.');
      } finally {
        setLoading(false);
      }
    })();
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      SUCCESS: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Swap Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Review swap lifecycle and monitor Risk Execution / Alert / Case progress</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchItems} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex flex-1 gap-2 flex-wrap">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
                    <input 
                    type="text" 
                    value={swapNo}
                    onChange={(e) => setSwapNo(e.target.value)}
                    placeholder="Search Swap No..." 
                    className="pl-9 pr-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
                    />
                </div>
                <input 
                    type="text" 
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    placeholder="Search Owner No / Id..." 
                    className="px-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
                />
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
          <div className="flex gap-2">
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm text-gray-600 focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="PENDING_COMPLIANCE">PENDING_COMPLIANCE</option>
              <option value="UNDER_REVIEW">UNDER_REVIEW</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Swap No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Sell (From)</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Buy (To)</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/exchange/swap-transactions/${item.id}`)}
                        className={adminButtonClass('rowKeyLink')}
                      >
                        {item.swapNo}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      {item.customer ? (
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">
                            {item.customer.firstName} {item.customer.lastName}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">{item.customer.customerNo}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                           <span className="text-sm font-medium text-gray-900">{item.ownerType}</span>
                           <span className="text-xs text-gray-500 font-mono" title={item.ownerId}>
                             {item.ownerId.substring(0, 8)}...
                           </span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-red-600">
                        {formatAssetAmount(item.fromAmount, item.fromAsset.decimals)} {item.fromAsset.currency}
                      </div>
                      <div className="text-xs text-gray-400">{item.fromAsset.type}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-green-600">
                        {formatAssetAmount(item.toAmount, item.toAsset.decimals)} {item.toAsset.currency}
                      </div>
                      <div className="text-xs text-gray-400">{item.toAsset.type}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-600">
                      {formatRate8(item.exchangeRate)}
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(item.status)}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                        <div>Created: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                        {item.completedAt && <div className="text-gray-400">Completed: {new Date(item.completedAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/exchange/swap-transactions/${item.id}`)}
                        className={adminButtonClass('rowLink')}
                      >
                        View
                      </button>
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

export default SwapTransactionList;

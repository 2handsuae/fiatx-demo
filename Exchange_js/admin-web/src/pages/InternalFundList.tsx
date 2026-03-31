import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

type InternalFundItem = {
  id: string;
  internalFundNo: string;
  status: string;
  amount: string;
  feeAmount: string;
  txHash?: string | null;
  confirmations?: number;
  fromAddress?: string | null;
  toAddress?: string | null;
  createdAt: string;
  asset?: {
    code: string;
    type: string;
    network?: string | null;
    decimals?: number;
  };
  internalTransaction?: {
    id: string;
    internalTxNo: string;
    status: string;
    type: string;
  };
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-800',
  SIGNING: 'bg-indigo-100 text-indigo-800',
  BROADCASTED: 'bg-blue-100 text-blue-800',
  CONFIRMING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CLEAR: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  TIMEOUT: 'bg-orange-100 text-orange-800',
  RETURNED: 'bg-purple-100 text-purple-800',
  CANCELLED: 'bg-slate-100 text-slate-800',
};

const InternalFundList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InternalFundItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchNo, setSearchNo] = useState('');
  const [error, setError] = useState('');

  const hasFilters = useMemo(
    () => Boolean(statusFilter || searchNo.trim()),
    [searchNo, statusFilter],
  );

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchNo) params.append('internalFundNo', searchNo);

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-funds?${params.toString()}`,
      );

      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        return;
      }
      setError(await getApiErrorMessage(response, 'Failed to load internal funds.'));
    } catch (error) {
      console.error('Failed to fetch internal funds', error);
      setError('Failed to load internal funds.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleCreateMock = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds/mock`, {
        method: 'POST',
      });

      if (!response.ok) {
        setError(await getApiErrorMessage(response, 'Create mock internal fund failed.'));
      }
      await fetchItems();
    } catch (error) {
      console.error('Failed to create mock internal fund', error);
      setError('Create mock internal fund failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStatusFilter('');
    setSearchNo('');
    setItems([]);
    setError('');
    setLoading(true);
    void (async () => {
      try {
        const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-funds`);
        if (response.ok) {
          const result = await response.json();
          setItems(result.items || []);
          return;
        }
        setError(await getApiErrorMessage(response, 'Failed to load internal funds.'));
      } catch (resetError) {
        console.error('Failed to reset internal fund filters', resetError);
        setError('Failed to load internal funds.');
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Internal Funds</h1>
          <p className="text-sm text-gray-500 mt-1">Atomic transfer facts with workflow status controls</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchItems}
            className={adminIconButtonClass()}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-indigo-900">Manual Simulation</h2>
            <p className="text-sm text-indigo-700">
              Demo-only entry point for creating mock internal fund records.
            </p>
          </div>
          <button onClick={handleCreateMock} className={adminButtonClass('simulationAction')}>
            Create Mock Internal Fund
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex flex-col md:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchNo}
                onChange={(e) => setSearchNo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchItems()}
                placeholder="Search by Internal Fund No"
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary transition-all"
              />
            </div>
            <button
              onClick={fetchItems}
              className={adminButtonClass('listPrimary')}
            >
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

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm focus:outline-none focus:border-brand-primary"
          >
            <option value="">All Status</option>
            <option value="CREATED">CREATED</option>
            <option value="SIGNING">SIGNING</option>
            <option value="BROADCASTED">BROADCASTED</option>
            <option value="CONFIRMING">CONFIRMING</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="CLEAR">CLEAR</option>
            <option value="FAILED">FAILED</option>
            <option value="TIMEOUT">TIMEOUT</option>
            <option value="RETURNED">RETURNED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Fund</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Internal Tx</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">From / To</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
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
                    <RefreshCw className="animate-spin mx-auto mb-2 text-brand-primary" size={20} />
                    Loading internal funds...
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No internal funds found</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <button
                        className={adminButtonClass('rowKeyLink')}
                        onClick={() => navigate(`/dashboard/treasury/internal-funds/${item.id}`)}
                      >
                        {item.internalFundNo}
                      </button>
                      <div className="text-[10px] text-gray-500 mt-1">{new Date(item.createdAt).toLocaleString()}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{item.txHash || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        className={adminButtonClass('rowSecondaryUtility')}
                        onClick={() =>
                          item.internalTransaction?.id &&
                          navigate(`/exchange/internal-transactions/${item.internalTransaction.id}`)
                        }
                      >
                        {item.internalTransaction?.internalTxNo || '-'}
                      </button>
                      <div className="text-xs text-gray-500 mt-1">{item.internalTransaction?.type || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                        {item.asset?.code || '-'}
                      </div>
                      <div className="text-xs text-gray-500">
                        fee: {formatAssetAmount(item.feeAmount, item.asset?.decimals)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-gray-500 truncate max-w-[240px]" title={item.fromAddress || ''}>
                        from: {item.fromAddress || '-'}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-[240px]" title={item.toAddress || ''}>
                        to: {item.toAddress || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2 flex-wrap items-center">
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/treasury/internal-funds/${item.id}`)}
                          className={adminButtonClass('rowLink')}
                        >
                          View
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

export default InternalFundList;

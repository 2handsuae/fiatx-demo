import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  AlertCircle
} from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

interface TransactionItem {
  id: string;
  journalId: string;
  lineNo: number;
  accountCode: string;
  drCr: 'DR' | 'CR';
  amount: string;
  assetId: string;
  changeAmount: string;
  postBalance: string;
  description: string | null;
  createdAt: string;
  journal: {
    eventCode: string;
    sourceType: string;
    sourceId: string;
  };
  asset: {
    currency: string;
    code: string;
    decimals: number;
  };
}

interface AssetInfo {
  code: string;
  type: string;
  name?: string;
}

const TransactionHistory = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const assetId = searchParams.get('assetId');

  const [items, setItems] = useState<TransactionItem[]>([]);
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const fetchAssetInfo = useCallback(async () => {
    if (!assetId) return;
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/assets/${assetId}`);
      if (response.ok) {
        const data = await response.json();
        setAssetInfo(data);
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      console.error('Failed to fetch asset info', err);
    }
  }, [assetId]);

  const fetchTransactions = useCallback(async () => {
    if (!user || !assetId) return;

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('customerId', user.id);
      params.append('assetId', assetId);
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/journal-lines/customer-balance-history?${params.toString()}`,
      );
      
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
      } else {
        setError(await getCustomerApiErrorMessage(response, 'Failed to fetch transaction history'));
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
      console.error('Failed to fetch transactions', err);
      setError('Network connection error');
    } finally {
      setLoading(false);
    }
  }, [user, assetId, page, pageSize, startDate, endDate]);

  useEffect(() => {
    fetchAssetInfo();
    fetchTransactions();
  }, [fetchAssetInfo, fetchTransactions]);

  const formatAmount = (amount: string | number, decimals: number = 2) =>
    formatAssetAmount(amount, decimals);

  const totalPages = Math.ceil(total / pageSize);

  const assetCode = assetInfo?.code || (items.length > 0 ? items[0].asset.code : '');

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/overview')}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transaction History</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {assetCode ? `${assetCode} Balance History` : 'View your balance changes'}
          </p>
        </div>
        <div className="ml-auto">
          <button 
            onClick={fetchTransactions}
            className="p-2 text-gray-400 hover:text-brand-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
              <Calendar size={14} /> From Date
            </label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-brand-primary dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
              <Calendar size={14} /> To Date
            </label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-brand-primary dark:text-white"
            />
          </div>

          <button 
            onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {error ? (
          <div className="p-12 text-center">
            <AlertCircle size={48} className="mx-auto text-red-400 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Error Loading Data</h3>
            <p className="text-gray-500 dark:text-gray-400">{error}</p>
            <button 
              onClick={fetchTransactions}
              className="mt-4 px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                  <th className="px-6 py-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Amount</th>
                  <th className="px-6 py-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center">
                        <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                        Loading transactions...
                      </div>
                    </td>
                  </tr>
                ) : !assetId ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <div className="flex flex-col items-center justify-center opacity-40">
                        <Search size={48} className="mb-2" />
                        Please select an asset from the Overview page to view history
                      </div>
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <div className="flex flex-col items-center justify-center opacity-40">
                        <History size={48} className="mb-2" />
                        No transactions found for this asset
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const isPositive = Number(item.changeAmount) > 0;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-gray-900 dark:text-white font-medium">
                              {new Date(item.createdAt).toLocaleDateString()}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                              {new Date(item.createdAt).toLocaleTimeString()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-gray-900 dark:text-white font-medium">
                            {item.description || item.journal.eventCode.replace('EVT_', '').replace(/_/g, ' ')}
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1">
                            Ref: {item.journal.sourceType}-{item.journal.sourceId.substring(0, 8)}
                          </div>
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          <div className="flex items-center justify-end gap-1">
                              {isPositive ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                              {isPositive ? '+' : ''}{formatAmount(item.changeAmount, item.asset.decimals)}
                              <span className="text-[10px] ml-1 opacity-60">{item.asset.currency}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-gray-900 dark:text-white bg-gray-50/30 dark:bg-gray-900/30">
                          {formatAmount(item.postBalance, item.asset.decimals)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
            <div className="text-sm text-gray-500 dark:text-gray-400">
                Showing {items.length} of {total} entries
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1 rounded hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronLeft size={20} className="text-gray-500" />
                </button>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 px-3 py-1 rounded border border-gray-200 dark:border-gray-700 shadow-sm">
                    Page {page} of {totalPages || 1}
                </span>
                <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1 rounded hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <ChevronRight size={20} className="text-gray-500" />
                </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionHistory;

import React, { useEffect, useState, useCallback } from 'react';
import { 
  Search, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Download,
  Calendar,
  User,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  History
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BalanceHistoryItem {
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
    code: string;
    decimals: number;
  };
}

interface Asset {
  id: string;
  code: string;
  type: string;
}

const CustomerBalanceHistory = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<BalanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  
  // Filters
  const [customerId, setCustomerId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const fetchAssets = useCallback(async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/assets?take=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAssets(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch assets', error);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    if (!customerId || !assetId) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.append('customerId', customerId);
      params.append('assetId', assetId);
      params.append('skip', ((page - 1) * pageSize).toString());
      params.append('take', pageSize.toString());
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/journal-lines/customer-balance-history?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
        setTotal(result.total || 0);
      } else if (response.status === 401) {
        navigate('/admin/login');
      }
    } catch (error) {
      console.error('Failed to fetch balance history', error);
    } finally {
      setLoading(false);
    }
  }, [customerId, assetId, page, pageSize, startDate, endDate, navigate]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    if (customerId && assetId) {
        fetchItems();
    } else {
        setItems([]);
        setTotal(0);
    }
  }, [customerId, assetId, page, fetchItems]);

  const handleExport = async () => {
    if (!customerId || !assetId) return;
    
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      params.append('customerId', customerId);
      params.append('assetId', assetId);
      params.append('skip', '0');
      params.append('take', '10000'); // Export up to 10k records
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/journal-lines/customer-balance-history?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const result = await response.json();
        const exportData = result.items || [];
        
        const headers = ['Time', 'Type', 'Source ID', 'Change', 'Balance', 'Description'];
        const csvRows = [
          headers.join(','),
          ...exportData.map((item: BalanceHistoryItem) => [
            new Date(item.createdAt).toISOString(),
            item.journal.eventCode,
            item.journal.sourceId,
            item.changeAmount,
            item.postBalance,
            `"${item.description || ''}"`
          ].join(','))
        ];
        
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `balance_history_${customerId}_${assetId}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Export failed', error);
    }
  };

  const formatAmount = (amount: string | number, decimals: number = 2) => {
    return Number(amount).toLocaleString(undefined, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Balance History</h1>
          <p className="text-sm text-gray-500 mt-1">Track available balance changes for specific customer and asset</p>
        </div>
        <button 
          onClick={handleExport}
          disabled={!customerId || !assetId || items.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-admin-sidebar-bg text-white rounded-lg hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-admin-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
              <User size={14} /> Customer ID
            </label>
            <input 
              type="text"
              value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}
              placeholder="Enter Customer ID"
              className="w-full px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
              <Coins size={14} /> Asset
            </label>
            <select 
              value={assetId}
              onChange={(e) => { setAssetId(e.target.value); setPage(1); }}
              className="w-full px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            >
              <option value="">Select Asset</option>
              {assets.map(asset => (
                <option key={asset.id} value={asset.id}>{asset.code} ({asset.type})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
              <Calendar size={14} /> From Date
            </label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="w-full px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
              <Calendar size={14} /> To Date
            </label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="w-full px-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-4 font-medium text-gray-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-4 font-medium text-gray-500 uppercase tracking-wider">Type / Source</th>
                <th className="px-6 py-4 font-medium text-gray-500 uppercase tracking-wider text-right">Change Amount</th>
                <th className="px-6 py-4 font-medium text-gray-500 uppercase tracking-wider text-right">Post Balance</th>
                <th className="px-6 py-4 font-medium text-gray-500 uppercase tracking-wider">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading history...
                    </div>
                  </td>
                </tr>
              ) : !customerId || !assetId ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center opacity-40">
                      <Search size={48} className="mb-2" />
                      Please select Customer and Asset to view history
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No records found for the selected criteria
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isPositive = Number(item.changeAmount) > 0;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-gray-900 font-medium">
                            {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-500">
                            {new Date(item.createdAt).toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-[10px] text-gray-500 font-mono">
                            {item.journal.sourceType}: {item.journal.sourceId}
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-right font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        <div className="flex items-center justify-end gap-1">
                            {isPositive ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                            {isPositive ? '+' : ''}{formatAmount(item.changeAmount, item.asset.decimals)}
                            <span className="text-[10px] ml-1 text-gray-400">{item.asset.code}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-gray-900 bg-gray-50/50">
                        {formatAmount(item.postBalance, item.asset.decimals)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-600 text-xs max-w-xs truncate" title={item.description || ''}>
                            {item.description || '-'}
                        </div>
                        <div className="text-[9px] text-gray-400 mt-0.5 font-mono">
                            ID: {item.id}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
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
        )}
      </div>

      {/* Summary Card (Optional) */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-admin-border">
                <div className="text-xs font-bold text-gray-400 uppercase mb-2">Total Transactions</div>
                <div className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <History className="text-brand-primary" />
                    {total}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default CustomerBalanceHistory;

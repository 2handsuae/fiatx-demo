import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye, CheckCircle, XCircle, ShieldCheck } from 'lucide-react';

interface SwapTransaction {
  id: string;
  swapNo: string;
  ownerType: string;
  ownerId: string;
  status: string;
  fromAsset: { code: string; type: string };
  fromAmount: string;
  toAsset: { code: string; type: string };
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
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filters
  const [swapNo, setSwapNo] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (swapNo) params.append('swapNo', swapNo);
      if (ownerId) params.append('ownerId', ownerId);
      if (statusFilter) params.append('status', statusFilter);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/swap-transactions?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else {
        if (response.status === 401) {
            localStorage.removeItem('admin_token');
            navigate('/admin/login');
        }
      }
    } catch (error) {
      console.error('Failed to fetch swap transactions', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [statusFilter]);

  const handleAction = async (id: string, action: string) => {
    setProcessingId(id);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });
      
      if (response.ok) {
        fetchItems();
      } else {
        const err = await response.json();
        alert(`Action failed: ${err.message}`);
      }
    } catch (error) {
      console.error('Action failed', error);
    } finally {
      setProcessingId(null);
    }
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

  const getAvailableActions = (status: string) => {
    const actions = [];
    switch (status) {
      case 'PENDING_COMPLIANCE':
        actions.push({ action: 'success', label: 'Approve', icon: <CheckCircle size={14} />, style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', icon: <XCircle size={14} />, style: 'bg-red-600 hover:bg-red-700 text-white' });
        actions.push({ action: 'flag', label: 'Review', icon: <ShieldCheck size={14} />, style: 'bg-yellow-600 hover:bg-yellow-700 text-white' });
        break;
      case 'UNDER_REVIEW':
        actions.push({ action: 'success', label: 'Approve', icon: <CheckCircle size={14} />, style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', icon: <XCircle size={14} />, style: 'bg-red-600 hover:bg-red-700 text-white' });
        break;
    }
    return actions;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Swap Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage currency exchange transactions and compliance flow</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchItems} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
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
                    placeholder="Search Owner ID..." 
                    className="px-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
                />
                <button onClick={fetchItems} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors">
                    Search
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm font-medium text-gray-900">{item.swapNo}</div>
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
                        {Number(item.fromAmount).toLocaleString()} {item.fromAsset.code}
                      </div>
                      <div className="text-xs text-gray-400">{item.fromAsset.type}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-green-600">
                        {Number(item.toAmount).toLocaleString()} {item.toAsset.code}
                      </div>
                      <div className="text-xs text-gray-400">{item.toAsset.type}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-gray-600">
                      {Number(item.exchangeRate).toFixed(6)}
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(item.status)}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                        <div>Created: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                        {item.completedAt && <div className="text-gray-400">Completed: {new Date(item.completedAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                          {getAvailableActions(item.status).map(act => (
                              <button
                                key={act.action}
                                onClick={() => handleAction(item.id, act.action)}
                                disabled={processingId === item.id}
                                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded shadow-sm transition-all ${act.style} ${processingId === item.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                {act.icon}
                                {act.label}
                              </button>
                          ))}
                          
                          <button 
                            onClick={() => navigate(`/exchange/swap-transactions/${item.id}`)}
                            className="p-1.5 text-blue-600 rounded hover:bg-blue-50 transition-colors" 
                            title="View Details"
                          >
                              <Eye size={18} />
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

export default SwapTransactionList;

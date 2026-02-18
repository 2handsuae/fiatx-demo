import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

interface PayoutItem {
  id: string;
  payoutNo: string;
  withdrawId: string;
  type: string;
  status: string;
  amount: string;
  assetId: string;
  asset: { code: string; type: string; network: string | null; decimals?: number };
  toAddress: string | null;
  toIban: string | null;
  txHash: string | null;
  referenceNo: string | null;
  providerTxnId: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  withdraw: {
    withdrawNo: string;
  };
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
  ownerId?: string;
}

const PayoutList = () => {
  const navigate = useNavigate();
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchPayouts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchQuery) params.append('withdrawId', searchQuery); // Simplified search
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setPayouts(result.items || []);
      } else {
        if (response.status === 401) {
            localStorage.removeItem('admin_token');
            navigate('/admin/login');
        }
      }
    } catch (error) {
      console.error('Failed to fetch payouts', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, [statusFilter]);

  const handleUpdateAction = async (id: string, action: string) => {
    setProcessingId(id);
    try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action })
        });

        if (response.ok) {
            fetchPayouts();
        } else {
            const err = await response.json();
            alert(`Action failed: ${err.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Action failed', error);
        alert('Action failed due to network error');
    } finally {
        setProcessingId(null);
    }
  };

  const handleCreateMock = async () => {
    setLoading(true);
    try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/mock`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            fetchPayouts();
        } else {
            const err = await response.json();
            alert(`Failed to create mock payouts: ${err.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Failed to create mock payouts', error);
        alert('Failed to create mock payouts due to network error');
    } finally {
        setLoading(false);
    }
  };

  const getPayoutActions = (payout: PayoutItem) => {
    const { status, type } = payout;
    const actions: { action: string; label: string; color: string }[] = [];

    if (type === 'CRYPTO') {
      switch (status) {
        case 'CREATED':
          actions.push({ action: 'SIGN', label: 'Sign', color: 'bg-blue-600 text-white hover:bg-blue-700' });
          break;
        case 'SIGNING':
          actions.push({ action: 'BROADCAST', label: 'Broadcast', color: 'bg-indigo-600 text-white hover:bg-indigo-700' });
          actions.push({ action: 'SIGN_FAIL', label: 'Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
          break;
        case 'BROADCASTED':
          actions.push({ action: 'SEEN_IN_MEMPOOL', label: 'Seen', color: 'bg-blue-600 text-white hover:bg-blue-700' });
          actions.push({ action: 'DROP', label: 'Drop', color: 'bg-orange-600 text-white hover:bg-orange-700' });
          break;
        case 'CONFIRMING':
          actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 text-white hover:bg-green-700' });
          actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
          break;
        case 'CONFIRMED':
          actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 text-white hover:bg-emerald-700' });
          break;
      }
    } else if (type === 'FIAT') {
      switch (status) {
        case 'CREATED':
          actions.push({ action: 'SUBMIT', label: 'Submit', color: 'bg-blue-600 text-white hover:bg-blue-700' });
          break;
        case 'CONFIRMING':
          actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 text-white hover:bg-green-700' });
          actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 text-white hover:bg-red-700' });
          break;
        case 'CONFIRMED':
          actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 text-white hover:bg-emerald-700' });
          actions.push({ action: 'RETURN', label: 'Return', color: 'bg-orange-600 text-white hover:bg-orange-700' });
          break;
        case 'CLEAR':
          actions.push({ action: 'RETURN', label: 'Return', color: 'bg-orange-600 text-white hover:bg-orange-700' });
          break;
      }
    }

    return actions;
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      SIGNING: 'bg-indigo-100 text-indigo-800',
      BROADCASTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      CLEAR: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      TIMEOUT: 'bg-orange-100 text-orange-800',
      RETURNED: 'bg-purple-100 text-purple-800',
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
          <h1 className="text-2xl font-bold text-gray-900">Payout Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and monitor outbound fund transfers</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleCreateMock} 
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 text-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Create Mock Payouts
          </button>
          <button onClick={fetchPayouts} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPayouts()}
                placeholder="Search by Withdraw ID..." 
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary transition-all"
                />
            </div>
            <button onClick={fetchPayouts} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                Search
            </button>
          </div>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-admin-border rounded-lg bg-white text-sm focus:outline-none focus:border-brand-primary"
          >
            <option value="">All Status</option>
            <option value="CREATED">Created</option>
            <option value="SIGNING">Signing</option>
            <option value="BROADCASTED">Broadcasted</option>
            <option value="CONFIRMING">Confirming</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CLEAR">Clear</option>
            <option value="FAILED">Failed</option>
            <option value="TIMEOUT">Timeout</option>
            <option value="RETURNED">Returned</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Payout No / Time</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Transaction Info</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && payouts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading payouts...
                    </div>
                  </td>
                </tr>
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">No payouts found</td>
                </tr>
              ) : (
                payouts.map((payout) => (
                  <tr key={payout.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div 
                        className="font-mono text-xs text-brand-primary font-bold hover:text-blue-800 cursor-pointer truncate max-w-[150px]"
                        title={payout.payoutNo}
                        onClick={() => navigate(`/dashboard/treasury/payouts/${payout.id}`)}
                      >
                        {payout.payoutNo || '-'}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1">
                        {new Date(payout.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${payout.type === 'CRYPTO' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {payout.type}
                          </span>
                          <div className="text-xs text-gray-500 font-mono" title="Withdraw No">
                              {payout.withdraw.withdrawNo}
                          </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {payout.customer ? (
                          <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">
                                  {payout.customer.firstName} {payout.customer.lastName}
                              </span>
                              <span className="text-xs text-gray-500 font-mono">{payout.customer.customerNo}</span>
                          </div>
                      ) : (
                          <div className="text-xs text-gray-400 font-mono">
                              {payout.ownerId || '-'}
                          </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{formatAssetAmount(payout.amount, payout.asset.decimals)} {payout.asset.code}</div>
                      <div className="text-xs text-gray-500">{payout.asset.network}</div>
                    </td>
                    <td className="px-6 py-4">{renderStatusBadge(payout.status)}</td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                            {payout.type === 'FIAT' ? (
                                <div className="text-xs font-mono text-gray-600 truncate max-w-[150px]" title={`IBAN: ${payout.toIban || 'N/A'}`}>
                                    {payout.toIban || 'N/A'}
                                </div>
                            ) : (
                                <>
                                    <div className="text-xs font-mono text-gray-600 truncate max-w-[150px]" title={payout.toAddress || ''}>
                                        {payout.toAddress ? `To: ${payout.toAddress.substring(0, 8)}...` : '-'}
                                    </div>
                                    {payout.txHash && (
                                        <div className="text-xs font-mono text-blue-600 truncate max-w-[150px]" title={payout.txHash}>
                                            Tx: {payout.txHash.substring(0, 12)}...
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        {getPayoutActions(payout).map((item) => (
                          <button 
                            key={item.action}
                            onClick={() => handleUpdateAction(payout.id, item.action)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors shadow-sm ${item.color} ${processingId === payout.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={processingId === payout.id}
                          >
                            {item.label}
                          </button>
                        ))}
                        <div className="w-px h-4 bg-gray-200 mx-1"></div>
                        <button 
                          onClick={() => navigate(`/dashboard/treasury/payouts/${payout.id}`)}
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

export default PayoutList;

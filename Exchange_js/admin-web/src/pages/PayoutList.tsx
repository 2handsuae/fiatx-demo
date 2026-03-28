import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';

interface PayoutItem {
  id: string;
  payoutNo: string;
  withdrawId: string;
  type: string;
  status: string;
  displayStatus?: string | null;
  ownerNo?: string | null;
  transactionType?: string | null;
  transactionId?: string | null;
  transactionNo?: string | null;
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

  const renderStatusBadge = (status: string, displayStatus?: string | null) => {
    const normalizedDisplayStatus = normalizeRailDisplayStatus(
      displayStatus || status,
    );
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      SIGNING: 'bg-indigo-100 text-indigo-800',
      BROADCASTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      CLEARED: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      TIMEOUT: 'bg-orange-100 text-orange-800',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[normalizedDisplayStatus] || 'bg-gray-100 text-gray-800'}`}>
        {formatRailStatusLabel(normalizedDisplayStatus)}
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
            <option value="CLEAR">Cleared</option>
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Linked Transaction</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type / Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Rail Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Settlement Evidence</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">View</th>
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
                payouts.map((payout) => {
                  const displayType = formatTransactionTypeLabel(payout.type);

                  return (
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                              {payout.transactionType || 'WITHDRAW'}
                          </span>
                          <div className="text-xs text-gray-500 font-mono" title="Withdraw No">
                              {payout.transactionNo || payout.withdraw.withdrawNo}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono" title="Linked Transaction ID">
                              {payout.transactionId || payout.withdrawId || '-'}
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
                      <div className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${displayType === 'FIAT' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                        {displayType}
                      </div>
                      <div className="mt-1 font-medium text-gray-900">{formatAssetAmount(payout.amount, payout.asset.decimals)} {payout.asset.code}</div>
                      <div className="text-xs text-gray-500">{payout.asset.network || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4">{renderStatusBadge(payout.status, payout.displayStatus)}</td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                            {displayType === 'FIAT' ? (
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PayoutList;

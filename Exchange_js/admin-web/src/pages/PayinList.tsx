import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye, ArrowDownLeft, ShieldCheck, ShieldAlert, Globe } from 'lucide-react';

interface PayinItem {
  id: string;
  payinNo: string;
  depositId: string | null;
  status: string;
  asset: { code: string; type: string; network: string | null };
  type: string;
  amount: string;
  toWallet: { ownerType: string; ownerId: string | null; address: string | null; accountName: string | null } | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  referenceNo: string | null;
  deposit: {
    kytStatus: string;
    travelRuleStatus: string;
    depositNo: string;
  } | null;
  receivedAt: string | null;
  confirmedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
  ownerNo?: string | null;
}

const PayinList = () => {
  const navigate = useNavigate();
  const [payins, setPayins] = useState<PayinItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [assetIdFilter, setAssetIdFilter] = useState(''); // Would need asset list, simplified for now
  const [txHashSearch, setTxHashSearch] = useState('');

  const fetchPayins = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (txHashSearch) params.append('txHash', txHashSearch);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/payins?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setPayins(result.items || []);
      } else {
        if (response.status === 401) {
            localStorage.removeItem('admin_token');
            navigate('/admin/login');
        }
      }
    } catch (error) {
      console.error('Failed to fetch payins', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayins();
  }, [statusFilter]);

  const handleAction = async (id: string, action: string) => {
    // Determine button style for confirm message if needed
    const isDangerous = ['drop', 'flag', 'hold'].includes(action);
    if (isDangerous) {
        if (!window.confirm(`Are you sure you want to ${action.toUpperCase()} this payin?`)) return;
    }

    setProcessingId(id);
    try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/payins/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action })
        });

        if (response.ok) {
            fetchPayins();
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

  // Define action configurations
  const actionConfig: Record<string, { label: string, style: string }> = {
      confirm: { label: 'Confirm', style: 'bg-green-600 text-white hover:bg-green-700' },
      fail: { label: 'Fail', style: 'bg-red-600 text-white hover:bg-red-700' },
      clear: { label: 'Clear', style: 'bg-green-600 text-white hover:bg-green-700' },
      block: { label: 'Seen in Mempool', style: 'bg-blue-600 text-white hover:bg-blue-700' }
  };

  const getAvailableActions = (payin: PayinItem) => {
      const { status, type } = payin;
      const actions: string[] = [];

      if (type === 'fiat') {
          switch (status) {
              case 'DETECTED': actions.push('confirm', 'fail'); break;
              case 'CONFIRMED': actions.push('clear'); break;
          }
      } else {
          switch (status) {
              case 'DETECTED': actions.push('block'); break;
              case 'CONFIRMING': actions.push('confirm', 'fail'); break;
              case 'CONFIRMED': actions.push('clear'); break;
          }
      }
      
      return actions.map(action => ({
          action,
          ...actionConfig[action]
      }));
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DETECTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-indigo-100 text-indigo-800',
      CLEARED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
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
          <h1 className="text-2xl font-bold text-gray-900">Payin Management</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor and manage incoming funds</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchPayins} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
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
                    value={txHashSearch}
                    onChange={(e) => setTxHashSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchPayins()}
                    placeholder="Search by Tx Hash..." 
                    className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
                    />
                </div>
                <button onClick={fetchPayins} className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
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
              <option value="DETECTED">Detected</option>
              <option value="CONFIRMING">Confirming</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CLEARED">Cleared</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Payin No / Time</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Transaction Info</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source / Hash</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && payins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading payins...
                    </div>
                  </td>
                </tr>
              ) : payins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No payins found
                  </td>
                </tr>
              ) : (
                payins.map((payin) => (
                  <tr key={payin.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div 
                        className="font-mono text-xs text-brand-primary font-bold hover:text-blue-800 cursor-pointer truncate max-w-[150px]" 
                        title={payin.payinNo}
                        onClick={() => navigate(`/dashboard/treasury/payins/${payin.id}`)}
                      >
                        {payin.payinNo || '-'}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1" title={payin.receivedAt ? new Date(payin.receivedAt).toLocaleString() : ''}>
                        {payin.receivedAt ? new Date(payin.receivedAt).toLocaleDateString() : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${payin.type === 'fiat' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                              {payin.type}
                          </span>
                          <div className="text-xs text-gray-500 font-mono" title="Transaction No (Deposit No)">
                              {payin.deposit?.depositNo || '-'}
                          </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {payin.customer ? (
                          <div className="flex flex-col">
                              <span className="text-sm font-medium text-gray-900">
                                  {payin.customer.firstName} {payin.customer.lastName}
                              </span>
                              <span className="text-xs text-gray-500 font-mono">{payin.customer.customerNo}</span>
                          </div>
                      ) : (
                          <div className="text-xs text-gray-400 font-mono">
                              {payin.toWallet?.ownerId || '-'}
                          </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{Number(payin.amount).toLocaleString()} {payin.asset.code}</div>
                      <div className="text-xs text-gray-500">{payin.asset.network}</div>
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(payin.status)}
                    </td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                            {payin.type === 'fiat' ? (
                                <>
                                    <div className="text-xs font-mono text-gray-600 truncate max-w-[150px]" title={`From IBAN: ${payin.fromIban || 'N/A'}`}>
                                        {payin.fromIban || 'N/A'}
                                    </div>
                                    <div className="text-xs font-mono text-gray-500 truncate max-w-[150px]" title={`Ref: ${payin.referenceNo || 'N/A'}`}>
                                        Ref: {payin.referenceNo || 'N/A'}
                                    </div>
                                </>
                            ) : (
                                <>
                                    {payin.fromAddress && (
                                        <div className="text-xs font-mono text-gray-600 truncate max-w-[150px]" title={payin.fromAddress}>
                                            From: {payin.fromAddress}
                                        </div>
                                    )}
                                    {payin.txHash && (
                                        <div className="text-xs font-mono text-blue-600 truncate max-w-[150px]" title={payin.txHash}>
                                            Tx: {payin.txHash}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                        {/* Action Buttons */}
                        {getAvailableActions(payin).map((btn) => (
                            <button
                                key={btn.action}
                                onClick={() => handleAction(payin.id, btn.action)}
                                disabled={processingId === payin.id}
                                className={`px-2 py-1 text-xs font-medium rounded transition-colors shadow-sm ${btn.style} ${processingId === payin.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {processingId === payin.id && btn.action === 'bank_post' ? '...' : btn.label}
                            </button>
                        ))}
                        
                        <div className="w-px h-4 bg-gray-200 mx-1"></div>

                        <button 
                          onClick={() => navigate(`/dashboard/treasury/payins/${payin.id}`)}
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

export default PayinList;

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye, Download, CheckCircle, Copy, Plus, ShieldCheck, ArrowRight, XCircle } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface WithdrawTransaction {
  id: string;
  withdrawNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo?: string;
  status: string;
  type: string;
  asset: { code: string; type: string; network: string | null };
  amount: string;
  netAmount: string;
  feeAmount: string;
  toWalletId: string | null;
  toAddress: string | null;
  toIban: string | null;
  txHash: string | null;
  referenceNo: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
}

const WithdrawTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithdrawTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);

  // Filters
  const [withdrawNo, setWithdrawNo] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams();
      if (withdrawNo) params.append('withdrawNo', withdrawNo);
      if (ownerId) params.append('ownerId', ownerId);
      if (statusFilter) params.append('status', statusFilter);
      
      const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions?${params.toString()}`, {
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
      console.error('Failed to fetch withdraw transactions', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [statusFilter]);

  const handleSeedMock = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/mock`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        alert('Successfully created 10 mock withdraw transactions');
        fetchItems();
      } else {
        alert('Failed to create mock data');
      }
    } catch (error) {
      console.error('Seed mock failed', error);
    }
  };

  const handleAction = async (id: string, action: string, reason?: string) => {
    setProcessingId(id);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, reason })
      });
      
      if (response.ok) {
        fetchItems();
        setIsRejectModalOpen(false);
        setRejectReason('');
        setTargetId(null);
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

  const getAvailableActions = (status: string) => {
    const actions = [];
    switch (status) {
      case 'CREATED':
        actions.push({ action: 'check', label: 'Check', icon: <ArrowRight size={14} />, style: 'bg-blue-600 hover:bg-blue-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', icon: <XCircle size={14} />, style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'PENDING_COMPLIANCE':
        actions.push({ action: 'flag', label: 'Flag', icon: <ShieldCheck size={14} />, style: 'bg-orange-600 hover:bg-orange-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', icon: <XCircle size={14} />, style: 'bg-red-600 hover:bg-red-700 text-white' });
        actions.push({ action: 'approve', label: 'Approve', icon: <CheckCircle size={14} />, style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', icon: <XCircle size={14} />, style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'UNDER_REVIEW':
        actions.push({ action: 'approve', label: 'Approve', icon: <CheckCircle size={14} />, style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', icon: <XCircle size={14} />, style: 'bg-red-600 hover:bg-red-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', icon: <XCircle size={14} />, style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'PAYOUT_PENDING':
        actions.push({ action: 'success', label: 'Success', icon: <CheckCircle size={14} />, style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'fail', label: 'Fail', icon: <XCircle size={14} />, style: 'bg-red-600 hover:bg-red-700 text-white' });
        break;
    }
    return actions;
  };

  const handleExport = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const params = new URLSearchParams();
        if (withdrawNo) params.append('withdrawNo', withdrawNo);
        if (ownerId) params.append('ownerId', ownerId);
        if (statusFilter) params.append('status', statusFilter);
        
        const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions?${params.toString()}&take=10000`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const items = data.items || [];
            // Simple CSV export logic
            const headers = ['Withdraw No', 'Owner Type', 'Owner ID', 'Status', 'Asset', 'Amount', 'Destination', 'Created At'];
            const rows = items.map((item: any) => [
                item.withdrawNo,
                item.ownerType,
                item.ownerId,
                item.status,
                item.asset.code,
                item.amount,
                item.toAddress || item.toIban || '',
                item.createdAt
            ]);
            
            const csvContent = [
                headers.join(','),
                ...rows.map((row: any[]) => row.join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'withdraw_transactions.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
      } catch (error) {
          console.error('Export failed', error);
      }
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      PAYOUT_PENDING: 'bg-indigo-100 text-indigo-800',
      SUCCESS: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      REJECTED: 'bg-red-100 text-red-800',
      CANCELLED: 'bg-gray-400 text-white',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const handleCopy = (text: string, id: string) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const renderDestination = (item: WithdrawTransaction) => {
    if (item.type === 'fiat') {
        return (
            <div className="flex flex-col gap-1.5 min-w-[160px]">
                {item.toIban && (
                    <div className="flex items-center gap-1 group">
                        <span className="text-[10px] uppercase font-bold text-gray-400 w-8">IBAN</span>
                        <code className="text-xs font-mono text-gray-900 truncate max-w-[140px]" title={item.toIban}>
                            {item.toIban}
                        </code>
                        <button 
                            onClick={() => handleCopy(item.toIban!, `iban-${item.id}`)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                        >
                            {copied === `iban-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                        </button>
                    </div>
                )}
                {item.referenceNo && (
                    <div className="flex items-center gap-1 group">
                        <span className="text-[10px] uppercase font-bold text-gray-400 w-8">REF</span>
                        <code className="text-xs font-mono text-gray-600 truncate max-w-[140px]" title={item.referenceNo}>
                            {item.referenceNo}
                        </code>
                        <button 
                            onClick={() => handleCopy(item.referenceNo!, `ref-${item.id}`)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                        >
                            {copied === `ref-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Crypto
    return (
        <div className="flex flex-col gap-1.5 min-w-[160px]">
            {item.toAddress ? (
                <div className="flex items-center gap-1 group">
                    <span className="text-[10px] uppercase font-bold text-gray-400 w-8">Addr</span>
                    <code className="text-xs font-mono text-blue-600 truncate max-w-[140px]" title={item.toAddress}>
                        {item.toAddress}
                    </code>
                    <button 
                        onClick={() => handleCopy(item.toAddress!, `addr-${item.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                    >
                        {copied === `addr-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                    </button>
                </div>
            ) : (
                <span className="text-xs text-gray-400 italic">No destination</span>
            )}
            {item.txHash && (
                 <div className="flex items-center gap-1 group">
                    <span className="text-[10px] uppercase font-bold text-gray-400 w-8">Hash</span>
                    <code className="text-xs font-mono text-gray-500 truncate max-w-[140px]" title={item.txHash}>
                        {item.txHash}
                    </code>
                    <button 
                        onClick={() => handleCopy(item.txHash!, `hash-${item.id}`)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                    >
                        {copied === `hash-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                    </button>
                </div>
            )}
        </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Withdraw Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage withdrawal requests and status</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleSeedMock} className="flex items-center gap-2 px-3 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-secondary transition-colors shadow-sm">
             <Plus size={18} />
             <span className="text-sm font-medium">Seed 10 Mock Records</span>
          </button>
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-800 bg-white border border-gray-200 rounded-lg transition-colors">
            <Download size={18} />
            <span className="text-sm font-medium">Export</span>
          </button>
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
                    value={withdrawNo}
                    onChange={(e) => setWithdrawNo(e.target.value)}
                    placeholder="Search Withdraw No..." 
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
              <option value="CREATED">Created</option>
              <option value="PENDING_COMPLIANCE">Pending Compliance</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="APPROVED">Approved</option>
              <option value="PAYOUT_PENDING">Payout Pending</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="RETURNED">Returned</option>
              <option value="HELD">Held</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Withdraw No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm font-medium text-gray-900 hover:text-blue-600 cursor-pointer" onClick={() => navigate(`/exchange/withdraw-transactions/${item.id}`)}>
                        {item.withdrawNo}
                      </div>
                      {item.type && (
                          <div className="mt-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${item.type === 'fiat' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                                  {item.type === 'fiat' ? 'FIAT' : 'CRYPTO'}
                              </span>
                          </div>
                      )}
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
                             {item.ownerNo || item.ownerId.substring(0, 8) + '...'}
                           </span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {Number(item.amount).toLocaleString()} {item.asset.code}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(item.status)}
                    </td>
                    <td className="px-6 py-4">
                        {renderDestination(item)}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                        <div>Created: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                        {item.completedAt && <div className="text-gray-400">Completed: {new Date(item.completedAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                          {getAvailableActions(item.status).map(action => (
                              <button
                                  key={action.action}
                                  onClick={() => {
                                      if (action.action === 'reject') {
                                          setTargetId(item.id);
                                          setIsRejectModalOpen(true);
                                      } else {
                                          handleAction(item.id, action.action);
                                      }
                                  }}
                                  disabled={processingId === item.id}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded shadow-sm transition-all ${action.style} ${processingId === item.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                  {action.icon}
                                  {action.label}
                              </button>
                          ))}
                          
                          <button 
                            onClick={() => navigate(`/exchange/withdraw-transactions/${item.id}`)}
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

      {/* Reject Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Reject Transaction</h3>
            <p className="text-sm text-gray-500 mb-4">
              Please provide a reason for rejecting this transaction. This will be recorded in the audit logs.
            </p>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all mb-4"
              rows={4}
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsRejectModalOpen(false);
                  setRejectReason('');
                  setTargetId(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => targetId && handleAction(targetId, 'reject', rejectReason)}
                disabled={!rejectReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WithdrawTransactionList;

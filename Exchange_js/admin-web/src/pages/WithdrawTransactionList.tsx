import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Download, CheckCircle, Copy, Plus } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatDerivedComplianceStatusLabel,
  isLegacyWithdrawStatus,
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';

interface WithdrawTransaction {
  id: string;
  withdrawNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo?: string;
  status: string;
  derivedComplianceStatus?: string;
  type: string;
  asset: { code: string; type: string; network: string | null; decimals?: number };
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
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Filters
  const [withdrawNo, setWithdrawNo] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  type WithdrawFilters = {
    withdrawNo: string;
    ownerId: string;
    statusFilter: string;
  };

  const hasFilters = useMemo(
    () => !!withdrawNo.trim() || !!ownerId.trim() || !!statusFilter,
    [ownerId, statusFilter, withdrawNo],
  );

  const fetchItems = async (
    overrides?: Partial<WithdrawFilters>,
  ) => {
    setLoading(true);
    setError('');
    try {
      const nextFilters: WithdrawFilters = {
        withdrawNo,
        ownerId,
        statusFilter,
        ...overrides,
      };
      const params = new URLSearchParams();
      if (nextFilters.withdrawNo) params.append('withdrawNo', nextFilters.withdrawNo);
      if (nextFilters.ownerId) params.append('ownerId', nextFilters.ownerId);
      if (nextFilters.statusFilter) params.append('status', nextFilters.statusFilter);
      
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to fetch withdraw transactions.'),
        );
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch withdraw transactions', error);
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to fetch withdraw transactions.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const resetFilters = async () => {
    setWithdrawNo('');
    setOwnerId('');
    setStatusFilter('');
    await fetchItems({
      withdrawNo: '',
      ownerId: '',
      statusFilter: '',
    });
  };

  const handleSeedMock = async () => {
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/mock`, {
        method: 'POST',
      });
      if (response.ok) {
        alert('Successfully created 10 mock withdraw transactions');
        await fetchItems();
      } else {
        throw new Error(await getApiErrorMessage(response, 'Failed to create mock data.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Seed mock failed', error);
      setError(error instanceof Error ? error.message : 'Seed mock failed.');
    }
  };

  const handleExport = async () => {
      try {
        const params = new URLSearchParams();
        if (withdrawNo) params.append('withdrawNo', withdrawNo);
        if (ownerId) params.append('ownerId', ownerId);
        if (statusFilter) params.append('status', statusFilter);
        
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/withdraw-transactions?${params.toString()}&take=10000`,
        );
        
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
        } else {
            throw new Error(await getApiErrorMessage(response, 'Export failed.'));
        }
      } catch (error) {
          if (error instanceof AdminSessionError) return;
          console.error('Export failed', error);
          setError(error instanceof Error ? error.message : 'Export failed.');
      }
  };

  const renderStatusBadge = (status: string) => {
    const legacy = isLegacyWithdrawStatus(status);
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
      <div className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
          {formatStatusLabel(status)}
        </span>
        {legacy ? (
          <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            Legacy
          </span>
        ) : null}
      </div>
    );
  };

  const renderComplianceBadge = (status?: string) => {
    const colors: Record<string, string> = {
      CLEAR: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      HOLD: 'bg-amber-50 text-amber-700 border border-amber-200',
      REJECT: 'bg-rose-50 text-rose-700 border border-rose-200',
      PENDING: 'bg-slate-50 text-slate-700 border border-slate-200',
    };
    const normalized = String(status || 'PENDING').toUpperCase();
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${colors[normalized] || colors.PENDING}`}
      >
        {formatDerivedComplianceStatusLabel(normalized)}
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
          <button onClick={() => void handleSeedMock()} className={adminButtonClass('listPrimary')}>
             <Plus size={18} />
             <span className="text-sm font-medium">Seed 10 Mock Records</span>
          </button>
          <button onClick={() => void handleExport()} className={adminButtonClass('listSecondary')}>
            <Download size={18} />
            <span className="text-sm font-medium">Export</span>
          </button>
          <button onClick={() => void fetchItems()} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

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
                    placeholder="Search Owner No or ID..." 
                    className="px-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-48"
                />
                <button onClick={() => void fetchItems()} className={adminButtonClass('listPrimary')}>
                    Search
                </button>
                <button
                  onClick={() => void resetFilters()}
                  className={adminButtonClass('listSecondary')}
                  disabled={!hasFilters || loading}
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
              <option value="CREATED">Created (Legacy)</option>
              <option value="PENDING_COMPLIANCE">Pending Compliance</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="APPROVED">Approved (Legacy)</option>
              <option value="PAYOUT_PENDING">Payout Pending</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="RETURNED">Returned</option>
              <option value="HELD">Held (Legacy)</option>
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
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
                      <button
                        type="button"
                        className={adminButtonClass('rowKeyLink')}
                        onClick={() => navigate(`/exchange/withdraw-transactions/${item.id}`)}
                        title={item.withdrawNo}
                      >
                        {item.withdrawNo}
                      </button>
                      {item.type && (
                          <div className="mt-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${item.type === 'fiat' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                                  {formatTransactionTypeLabel(item.type)}
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
                          <span className="text-xs text-gray-500 font-mono">{item.ownerNo || item.customer.customerNo}</span>
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
                        {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {renderStatusBadge(item.status)}
                        {renderComplianceBadge(item.derivedComplianceStatus)}
                      </div>
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
                          <button 
                            onClick={() => navigate(`/exchange/withdraw-transactions/${item.id}`)}
                            className={adminButtonClass('rowLink')}
                            title="View"
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

export default WithdrawTransactionList;

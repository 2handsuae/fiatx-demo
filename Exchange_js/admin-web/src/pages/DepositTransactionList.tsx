import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Download, CheckCircle, Copy } from 'lucide-react';
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
  formatStatusLabel,
  formatTransactionTypeLabel,
} from '../utils/transactionRootDisplay';

interface DepositTransaction {
  id: string;
  depositNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  status: string;
  derivedComplianceStatus?: string;
  type?: string;
  asset: { currency: string; code: string; type: string; network: string | null; decimals?: number };
  amount: string;
  netAmount: string;
  feeAmount: string;
  toWalletId: string;
  fromAddress: string | null;
  fromIban: string | null;
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

const DepositTransactionList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<DepositTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied] = useState<string | null>(null);

  // Filters
  const [depositNo, setDepositNo] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [toWalletId, setToWalletId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assetIdFilter] = useState('');

  type DepositFilters = {
    depositNo: string;
    ownerId: string;
    toWalletId: string;
    statusFilter: string;
    assetIdFilter: string;
  };

  const hasFilters = useMemo(
    () =>
      !!depositNo.trim() ||
      !!ownerId.trim() ||
      !!toWalletId.trim() ||
      !!statusFilter ||
      !!assetIdFilter,
    [assetIdFilter, depositNo, ownerId, statusFilter, toWalletId],
  );

  const fetchItems = async (
    overrides?: Partial<DepositFilters>,
  ) => {
    setLoading(true);
    setError('');
    try {
      const nextFilters: DepositFilters = {
        depositNo,
        ownerId,
        toWalletId,
        statusFilter,
        assetIdFilter,
        ...overrides,
      };
      const params = new URLSearchParams();
      if (nextFilters.depositNo) params.append('depositNo', nextFilters.depositNo);
      if (nextFilters.ownerId) params.append('ownerId', nextFilters.ownerId);
      if (nextFilters.toWalletId) params.append('toWalletId', nextFilters.toWalletId);
      if (nextFilters.statusFilter) params.append('status', nextFilters.statusFilter);
      if (nextFilters.assetIdFilter) params.append('assetId', nextFilters.assetIdFilter);
      
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions?${params.toString()}`,
      );
      if (response.ok) {
        const result = await response.json();
        setItems(result.items || []);
      } else {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to fetch deposit transactions.'),
        );
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch deposit transactions', error);
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to fetch deposit transactions.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const resetFilters = async () => {
    setDepositNo('');
    setOwnerId('');
    setToWalletId('');
    setStatusFilter('');
    await fetchItems({
      depositNo: '',
      ownerId: '',
      toWalletId: '',
      statusFilter: '',
      assetIdFilter,
    });
  };

  const handleExport = async () => {
      try {
        const params = new URLSearchParams();
        if (depositNo) params.append('depositNo', depositNo);
        if (ownerId) params.append('ownerId', ownerId);
        if (statusFilter) params.append('status', statusFilter);
        
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/deposit-transactions/export?${params.toString()}`,
        );
        
        if (response.ok) {
            const data = await response.json();
            // Simple CSV export logic
            const headers = ['Deposit No', 'Owner Type', 'Owner ID', 'Status', 'Asset', 'Amount', 'Tx Hash', 'Created At'];
            const rows = data.map((item: any) => [
                item.depositNo,
                item.ownerType,
                item.ownerId,
                item.status,
                item.asset.code,
                item.amount,
                item.txHash,
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
            link.setAttribute('download', 'deposit_transactions.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            throw new Error(
              await getApiErrorMessage(response, 'Export failed.'),
            );
        }
      } catch (error) {
          if (error instanceof AdminSessionError) return;
          console.error('Export failed', error);
          setError(error instanceof Error ? error.message : 'Export failed.');
      }
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PAYIN_PENDING: 'bg-blue-100 text-blue-800',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
      ACTION_PENDING: 'bg-amber-100 text-amber-800',
      SUCCESS: 'bg-green-100 text-green-800',
      FROZEN: 'bg-cyan-100 text-cyan-800',
      REJECTED: 'bg-red-100 text-red-800',
      FAILED: 'bg-orange-100 text-orange-800',
      EXPIRED: 'bg-gray-100 text-gray-800',
      CONFISCATED: 'bg-red-200 text-red-900',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {formatStatusLabel(status)}
      </span>
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deposit Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">Read-only deposit list for search, export, and detail inspection</p>
        </div>
        <div className="flex gap-3">
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
                    value={depositNo}
                    onChange={(e) => setDepositNo(e.target.value)}
                    placeholder="Deposit No..." 
                    className="pl-9 pr-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-40"
                    />
                </div>
                <input 
                    type="text" 
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    placeholder="Owner No or ID..." 
                    className="px-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-40"
                />
                <input 
                    type="text" 
                    value={toWalletId}
                    onChange={(e) => setToWalletId(e.target.value)}
                    placeholder="Wallet ID..." 
                    className="px-3 py-2 bg-admin-content-bg border border-admin-border rounded-lg text-sm focus:outline-none focus:border-brand-primary w-40"
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
              <option value="PAYIN_PENDING">Payin Pending</option>
              <option value="COMPLIANCE_PENDING">Compliance Pending</option>
              <option value="ACTION_PENDING">Action Pending</option>
              <option value="SUCCESS">Success</option>
              <option value="FROZEN">Frozen</option>
              <option value="REJECTED">Rejected</option>
              <option value="FAILED">Failed</option>
              <option value="EXPIRED">Expired</option>
              <option value="CONFISCATED">Confiscated</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Deposit No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Source</th>
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
                        onClick={() => navigate(`/exchange/deposit-transactions/${item.id}`)}
                        title={item.depositNo}
                      >
                        {item.depositNo}
                      </button>
                      <div className="mt-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${(item.type || '').toLowerCase() === 'fiat' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                              {formatTransactionTypeLabel(item.type || item.asset.type)}
                          </span>
                      </div>
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
                              <span className="text-sm text-gray-900">{item.ownerType}</span>
                              <span className="text-xs text-gray-500 font-mono">{item.ownerNo || item.ownerId}</span>
                          </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.currency}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {renderStatusBadge(item.status)}
                        {renderComplianceBadge(item.derivedComplianceStatus)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5 min-w-[160px]">
                             {/* Fiat Logic: Show Reference & IBAN */}
                             {item.asset.type === 'FIAT' ? (
                                <>
                                    {item.referenceNo ? (
                                        <div className="flex items-center gap-1 group">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 w-8">Ref</span>
                                            <code className="text-xs font-mono text-gray-900 truncate max-w-[140px]" title={item.referenceNo}>
                                                {item.referenceNo}
                                            </code>
                                            <button 
                                                onClick={() => copyToClipboard(item.referenceNo!, `ref-${item.id}`)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                                            >
                                                {copied === `ref-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                                            </button>
                                        </div>
                                    ) : <span className="text-xs text-gray-400 italic">No Reference</span>}
                                    
                                    {item.fromIban ? (
                                        <div className="flex items-center gap-1 group">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 w-8">From</span>
                                            <code className="text-xs font-mono text-gray-600 truncate max-w-[140px]" title={item.fromIban}>
                                                {item.fromIban}
                                            </code>
                                            <button 
                                                onClick={() => copyToClipboard(item.fromIban!, `iban-${item.id}`)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                                            >
                                                {copied === `iban-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                                            </button>
                                        </div>
                                    ) : <span className="text-xs text-gray-400 italic">No IBAN</span>}
                                </>
                             ) : (
                                /* Crypto Logic: Show Hash & Address */
                                <>
                                    {item.txHash ? (
                                        <div className="flex items-center gap-1 group">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 w-8">Tx</span>
                                            <code className="text-xs font-mono text-blue-600 truncate max-w-[140px]" title={item.txHash}>
                                                {item.txHash}
                                            </code>
                                            <button 
                                                onClick={() => copyToClipboard(item.txHash!, `tx-${item.id}`)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                                            >
                                                {copied === `tx-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                                            </button>
                                        </div>
                                    ) : <span className="text-xs text-gray-400 italic">Pending Tx</span>}
                                    
                                    {item.fromAddress ? (
                                        <div className="flex items-center gap-1 group">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 w-8">From</span>
                                            <code className="text-xs font-mono text-gray-600 truncate max-w-[140px]" title={item.fromAddress}>
                                                {item.fromAddress}
                                            </code>
                                            <button 
                                                onClick={() => copyToClipboard(item.fromAddress!, `addr-${item.id}`)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-brand-primary"
                                            >
                                                {copied === `addr-${item.id}` ? <CheckCircle size={12} className="text-green-500"/> : <Copy size={12}/>}
                                            </button>
                                        </div>
                                    ) : <span className="text-xs text-gray-400 italic">Pending Address</span>}
                                </>
                             )}
                        </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                        <div>Created: {new Date(item.createdAt).toLocaleString('en-US')}</div>
                        {item.completedAt && <div className="text-gray-400">Completed: {new Date(item.completedAt).toLocaleString('en-US')}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 items-center">
                          <button 
                            onClick={() => navigate(`/exchange/deposit-transactions/${item.id}`)}
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

export default DepositTransactionList;

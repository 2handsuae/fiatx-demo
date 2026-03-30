import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Eye } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';

interface PayinItem {
  id: string;
  payinNo: string;
  depositId: string | null;
  status: string;
  displayStatus?: string | null;
  asset: { code: string; type: string; network: string | null; decimals?: number };
  type: string;
  amount: string;
  transactionType?: string | null;
  transactionId?: string | null;
  transactionNo?: string | null;
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
  const [error, setError] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [txHashSearch, setTxHashSearch] = useState('');

  const fetchPayins = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (txHashSearch) params.append('txHash', txHashSearch);
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/treasury/payins?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load payins.'));
      }
      const result = await response.json();
      setPayins(result.items || []);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to load payins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayins();
  }, [statusFilter]);

  const renderStatusBadge = (status: string, displayStatus?: string | null) => {
    const normalizedDisplayStatus = normalizeRailDisplayStatus(displayStatus || status);
    const colors: Record<string, string> = {
      DETECTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-indigo-100 text-indigo-800',
      CLEARED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
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
          <h1 className="text-2xl font-bold text-gray-900">Payin Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">Read-only monitoring for inbound payin records</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchPayins} className="p-2 text-gray-500 hover:text-brand-primary transition-colors border border-gray-200 rounded-lg bg-white">
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Linked Transaction</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type / Asset / Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Rail Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Settlement Evidence</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading && payins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading payins...
                    </div>
                  </td>
                </tr>
              ) : payins.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No payins found
                  </td>
                </tr>
              ) : (
                payins.map((payin) => {
                  const displayType = formatTransactionTypeLabel(payin.type);

                  return (
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                              {payin.transactionType || 'DEPOSIT'}
                          </span>
                          <div className="text-xs text-gray-500 font-mono" title="Transaction No (Deposit No)">
                              {payin.transactionNo || payin.deposit?.depositNo || '-'}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono" title="Linked Transaction ID">
                              {payin.transactionId || payin.depositId || '-'}
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
                              {payin.ownerNo || payin.toWallet?.ownerId || '-'}
                          </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${displayType === 'FIAT' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                        {displayType}
                      </div>
                      <div className="mt-1 font-medium text-gray-900">{formatAssetAmount(payin.amount, payin.asset.decimals)} {payin.asset.code}</div>
                      <div className="text-xs text-gray-500">{payin.asset.network || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4">
                      {renderStatusBadge(payin.status, payin.displayStatus)}
                    </td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                            {displayType === 'FIAT' ? (
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
                      <div className="flex justify-end items-center">
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

export default PayinList;

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  type PayoutFilters = {
    statusFilter: string;
    searchQuery: string;
  };

  const hasFilters = useMemo(
    () => !!statusFilter || !!searchQuery.trim(),
    [searchQuery, statusFilter],
  );

  const fetchPayouts = async (
    overrides?: Partial<PayoutFilters>,
  ) => {
    setLoading(true);
    setError('');
    try {
      const nextFilters: PayoutFilters = {
        statusFilter,
        searchQuery,
        ...overrides,
      };
      const params = new URLSearchParams();
      if (nextFilters.statusFilter) params.append('status', nextFilters.statusFilter);
      if (nextFilters.searchQuery) params.append('withdrawId', nextFilters.searchQuery); // Simplified search

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/payouts?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load payouts.'));
      }
      const result = await response.json();
      setPayouts(result.items || []);
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Failed to load payouts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPayouts();
  }, []);

  const resetFilters = async () => {
    setStatusFilter('');
    setSearchQuery('');
    await fetchPayouts({
      statusFilter: '',
      searchQuery: '',
    });
  };

  const handleCreateMock = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
        const response = await adminFetch(`${import.meta.env.VITE_API_URL}/payouts/mock`, {
            method: 'POST',
        });

        if (!response.ok) {
            throw new Error(await getApiErrorMessage(response, 'Failed to create mock payouts.'));
        }
        setMessage('Mock payouts created.');
        await fetchPayouts();
    } catch (error) {
        if (error instanceof AdminSessionError) return;
        setError(error instanceof Error ? error.message : 'Failed to create mock payouts.');
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
          <button onClick={() => void fetchPayouts()} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-indigo-900">Manual Simulation</h2>
            <p className="mt-1 text-sm text-indigo-700">
              Mock payout generation is demo-only support tooling. It stays outside the list utility bar and outside payout workflow actions.
            </p>
          </div>
          <button
            onClick={handleCreateMock}
            disabled={loading}
            className={adminButtonClass('simulationAction')}
          >
            Create Mock Payouts
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
            <button onClick={() => void fetchPayouts()} className={adminButtonClass('listPrimary')}>
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
            <option value="CLEARED">Cleared</option>
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
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
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
                      <button
                        type="button"
                        className={adminButtonClass('rowKeyLink')}
                        title={payout.payoutNo}
                        onClick={() => navigate(`/dashboard/treasury/payouts/${payout.id}`)}
                      >
                        {payout.payoutNo || '-'}
                      </button>
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
                              {payout.ownerNo || payout.ownerId || '-'}
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
                          className={adminButtonClass('rowLink')}
                          title="View"
                        >
                          View
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

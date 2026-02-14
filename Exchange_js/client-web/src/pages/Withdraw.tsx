import { useState, useEffect } from 'react';
import { Wallet, Building2, History, RefreshCw, Info, AlertTriangle, ArrowRight, X, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

interface AssetBalance {
  assetId: string;
  assetCode: string;
  clientCredit: number;
  lockedBalance: number;
}

interface WalletItem {
  id: string;
  type: string;
  direction: string;
  asset: { id: string; code: string; type: string };
  address?: string;
  memo?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  accountName?: string;
  beneficiaryName?: string;
}

interface WithdrawTransaction {
  id: string;
  withdrawNo: string;
  status: string;
  amount: string;
  asset: { code: string; network: string | null };
  createdAt: string;
  completedAt: string | null;
  toAddress: string | null;
  toIban: string | null;
  txHash: string | null;
}

const Withdraw = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat' | 'history'>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [isManualInput, setIsManualInput] = useState(false);
  const [amount, setAmount] = useState('');
  const [, setLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // History State
  const [transactions, setTransactions] = useState<WithdrawTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedTx, setSelectedTx] = useState<WithdrawTransaction | null>(null);

  // Fetch Assets & Balances
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setBalanceLoading(true);
      try {
        const token = localStorage.getItem('customer_token');
        
        // Fetch Assets
        const assetsResponse = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (assetsResponse.ok) {
          const data = await assetsResponse.json();
          setAssets(data.items || []);
        }

        // Fetch Balances
        const balancesResponse = await fetch(`${import.meta.env.VITE_API_URL}/treasury/customer/${user.id}/assets`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (balancesResponse.ok) {
          const data = await balancesResponse.json();
          setBalances(data);
        }
      } catch (error) {
        console.error('Failed to fetch data', error);
      } finally {
        setBalanceLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // Fetch Wallets (Outbound) when Asset Changes
  useEffect(() => {
    if (!user || activeTab === 'history' || !selectedAssetId) {
        setWallets([]);
        return;
    }

    const fetchWallets = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('customer_token');
        // Following requirement: direction=OUTBOUND & assetId=...
        const params = new URLSearchParams({
            ownerType: 'CUSTOMER',
            ownerId: user.id,
            direction: 'OUTBOUND',
            assetId: selectedAssetId
        });
        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            setWallets(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch wallets', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWallets();
  }, [user, activeTab, selectedAssetId]);

  // Fetch History
  useEffect(() => {
      if (activeTab === 'history' && user) {
          fetchHistory();
      }
  }, [activeTab, page, user]);

  const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
          const token = localStorage.getItem('customer_token');
          const params = new URLSearchParams({
              skip: ((page - 1) * 10).toString(),
              take: '10',
          });

          const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/my?${params.toString()}`, {
              headers: { 'Authorization': `Bearer ${token}` }
          });

          if (response.ok) {
              const data = await response.json();
              setTransactions(data.items || []);
              setTotal(data.total || 0);
          }
      } catch (error) {
          console.error('Failed to fetch history', error);
      } finally {
          setHistoryLoading(false);
      }
  };

  const selectedBalance = balances.find(b => b.assetId === selectedAssetId);
  const availableBalance = selectedBalance ? selectedBalance.clientCredit : 0;

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId || !amount || (!selectedWalletId && !isManualInput && activeTab !== 'history')) {
        alert('Please fill in all required fields');
        return;
    }

    if (isManualInput && !manualAddress) {
        alert('Please enter a destination address');
        return;
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount > availableBalance) {
        alert('Insufficient balance');
        return;
    }

    setSubmitting(true);
    try {
        const token = localStorage.getItem('customer_token');
        const wallet = wallets.find(w => w.id === selectedWalletId);
        const asset = assets.find(a => a.id === selectedAssetId);
        
        const payload = {
            assetId: selectedAssetId,
            amount: withdrawAmount,
            toWalletId: isManualInput ? undefined : selectedWalletId,
            toAddress: isManualInput ? (asset?.type === 'CRYPTO' ? manualAddress : undefined) : wallet?.address,
            toIban: isManualInput ? (asset?.type === 'FIAT' ? manualAddress : undefined) : wallet?.iban,
        };

        const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('Withdrawal request submitted successfully!');
            setActiveTab('history');
            setAmount('');
            setSelectedWalletId('');
            // Refresh balances
            const balancesResponse = await fetch(`${import.meta.env.VITE_API_URL}/treasury/customer/${user?.id}/assets`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (balancesResponse.ok) {
                const data = await balancesResponse.json();
                setBalances(data);
            }
        } else {
            const err = await response.json();
            alert(err.message || 'Failed to submit withdrawal request');
        }
    } catch (error) {
        console.error('Withdrawal failed', error);
        alert('An unexpected error occurred');
    } finally {
        setSubmitting(false);
    }
  };

  const filteredAssets = assets.filter(a => 
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT'
  );

  const filteredWallets = wallets; // Now filtered by API

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
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdraw</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Withdraw Crypto or Fiat from your account</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden min-h-[500px]">
        {/* Tabs */}
        <div className="border-b border-gray-100 dark:border-gray-700">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => { setActiveTab('crypto'); setSelectedAssetId(''); setSelectedWalletId(''); }}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet size={18} />
                Crypto Withdrawal
              </div>
            </button>
            <button
              onClick={() => { setActiveTab('fiat'); setSelectedAssetId(''); setSelectedWalletId(''); }}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'fiat' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                Fiat Withdrawal
              </div>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'history' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <History size={18} />
                Transactions
              </div>
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'history' ? (
              <div className="space-y-4">
                  <div className="flex justify-end mb-4">
                      <button 
                        onClick={fetchHistory}
                        className="p-2 text-gray-500 dark:text-gray-400 hover:text-brand-primary hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Refresh"
                      >
                          <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                      </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                      <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Transaction No</th>
                                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Time</th>
                                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Asset / Amount</th>
                                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Action</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {historyLoading && transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                          Loading transactions...
                                      </td>
                                  </tr>
                              ) : transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                                          <div className="flex flex-col items-center">
                                              <History size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
                                              <p>No transactions found</p>
                                          </div>
                                      </td>
                                  </tr>
                              ) : (
                                  transactions.map(tx => (
                                      <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                          <td className="px-4 py-3">
                                              <div className="font-mono text-gray-900 dark:text-white">{tx.withdrawNo}</div>
                                          </td>
                                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                                              <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                                              <div>{new Date(tx.createdAt).toLocaleTimeString()}</div>
                                          </td>
                                          <td className="px-4 py-3">
                                              <div className="font-medium text-gray-900 dark:text-white">
                                                  {Number(tx.amount).toLocaleString()} {tx.asset.code}
                                              </div>
                                          </td>
                                          <td className="px-4 py-3">
                                              {renderStatusBadge(tx.status)}
                                          </td>
                                          <td className="px-4 py-3 text-right">
                                              <button 
                                                onClick={() => setSelectedTx(tx)}
                                                className="text-brand-primary hover:text-brand-primary/80 text-xs font-medium px-3 py-1.5 bg-brand-primary/10 rounded hover:bg-brand-primary/20 transition-colors"
                                              >
                                                  Details
                                              </button>
                                          </td>
                                      </tr>
                                  ))
                              )}
                          </tbody>
                      </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex justify-between items-center pt-2 text-sm text-gray-500 dark:text-gray-400">
                      <div>
                          Showing {transactions.length} of {total} records
                      </div>
                      <div className="flex gap-2">
                          <button 
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                              Previous
                          </button>
                          <button 
                            disabled={page * 10 >= total}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                              Next
                          </button>
                      </div>
                  </div>
              </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left Column: Form */}
                <div className="flex-1 space-y-6">
                    <form onSubmit={handleWithdraw} className="space-y-6 max-w-lg">
                        {/* Asset Selector */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Asset</label>
                            <select
                                required
                                value={selectedAssetId}
                                onChange={(e) => { setSelectedAssetId(e.target.value); setSelectedWalletId(''); }}
                                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            >
                                <option value="">Select a currency...</option>
                                {filteredAssets.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.code} {a.network ? `(${a.network})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Address/Account Selector */}
                        {selectedAssetId && (
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {activeTab === 'crypto' ? 'Withdrawal Address' : 'Withdrawal Bank Account'}
                                    </label>
                                    <button 
                                        type="button"
                                        onClick={() => { setIsManualInput(!isManualInput); setSelectedWalletId(''); setManualAddress(''); }}
                                        className="text-xs text-brand-primary hover:underline font-medium"
                                    >
                                        {isManualInput ? 'Choose from saved' : 'Input manually'}
                                    </button>
                                </div>

                                {isManualInput ? (
                                    <input
                                        required
                                        type="text"
                                        value={manualAddress}
                                        onChange={(e) => setManualAddress(e.target.value)}
                                        placeholder={activeTab === 'crypto' ? 'Enter wallet address...' : 'Enter IBAN / Account Number...'}
                                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                                    />
                                ) : filteredWallets.length > 0 ? (
                                    <select
                                        required
                                        value={selectedWalletId}
                                        onChange={(e) => setSelectedWalletId(e.target.value)}
                                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="">Select an address...</option>
                                        {filteredWallets.map(w => (
                                            <option key={w.id} value={w.id}>
                                                {activeTab === 'crypto' ? w.address : `${w.bankName} - ${w.iban || w.bankAccount}`}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30 rounded-lg flex items-start gap-3">
                                        <AlertTriangle className="text-orange-500 shrink-0" size={20} />
                                        <div className="text-sm text-orange-800 dark:text-orange-300">
                                            <p className="font-medium">No saved {activeTab === 'crypto' ? 'addresses' : 'accounts'} found.</p>
                                            <button 
                                                type="button"
                                                onClick={() => navigate('/wallet')}
                                                className="mt-1 text-orange-600 dark:text-orange-400 underline font-medium flex items-center gap-1"
                                            >
                                                Add one in Wallet Management <Plus size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Amount Input */}
                        {selectedAssetId && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="number"
                                        step="any"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:border-brand-primary bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                                    />
                                    <div className="absolute right-4 top-3.5 text-gray-400 dark:text-gray-500 font-medium">
                                        {assets.find(a => a.id === selectedAssetId)?.code}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex justify-between">
                                    <span>
                                        {balanceLoading ? (
                                            <span className="flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Loading balance...</span>
                                        ) : (
                                            `Available: ${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${assets.find(a => a.id === selectedAssetId)?.code}`
                                        )}
                                    </span>
                                    <button 
                                        type="button" 
                                        onClick={() => setAmount(availableBalance.toString())}
                                        className="text-brand-primary hover:underline font-medium"
                                    >
                                        Withdraw All
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="pt-4">
                            <button
                                type="submit"
                                disabled={submitting || !selectedAssetId || !selectedWalletId}
                                className="w-full py-4 bg-brand-primary text-white rounded-xl hover:bg-brand-primary/90 transition-all disabled:opacity-50 font-bold shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={20} />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Withdraw Now
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Right Column: Instructions */}
                <div className="lg:w-80 shrink-0">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 border border-blue-100 dark:border-blue-900/30 sticky top-6">
                        <div className="flex items-center gap-2 mb-4 text-blue-800 dark:text-blue-300">
                            <Info size={20} />
                            <h3 className="font-bold">Important Instructions</h3>
                        </div>
                        
                        {activeTab === 'crypto' ? (
                            <div className="space-y-4 text-sm text-blue-900 dark:text-blue-200">
                                <div>
                                    <h4 className="font-bold mb-1">Network Selection</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">Ensure the withdrawal network matches the recipient's network. Selecting the wrong network will result in permanent loss of funds.</p>
                                </div>
                                <div>
                                    <h4 className="font-bold mb-1">Withdrawal Time</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">Typically processed within 30-60 minutes after network confirmation.</p>
                                </div>
                                <div>
                                    <h4 className="font-bold mb-1">Minimum Withdrawal</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">Minimum withdrawal is 0.001 BTC / 0.01 ETH. Fees are deducted from the amount.</p>
                                </div>
                                <div className="flex gap-2 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-900/30 mt-4">
                                    <AlertTriangle size={24} className="text-amber-500 shrink-0" />
                                    <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                                        For security reasons, your first withdrawal after changing security settings will be delayed by 24 hours.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4 text-sm text-blue-900 dark:text-blue-200">
                                <div>
                                    <h4 className="font-bold mb-1">Beneficiary Name</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">Withdrawals can only be made to bank accounts held in your own name.</p>
                                </div>
                                <div>
                                    <h4 className="font-bold mb-1">Processing Time</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">1-3 business days. Banks do not process transfers on weekends or holidays.</p>
                                </div>
                                <div>
                                    <h4 className="font-bold mb-1">Withdrawal Fees</h4>
                                    <p className="text-blue-800/80 dark:text-blue-300/80">Standard SEPA/SWIFT fees apply. Please refer to our Fee Schedule for details.</p>
                                </div>
                                <div className="flex gap-2 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-900/30 mt-4">
                                    <AlertTriangle size={24} className="text-amber-500 shrink-0" />
                                    <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                                        Ensure all bank details are correct. Incorrect IBANs may lead to significant delays and return fees.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal (Simplified) */}
      {selectedTx && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
                  <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">Withdrawal Details</h3>
                      <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-500 dark:text-gray-400">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div className="text-center">
                          <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                              {Number(selectedTx.amount).toLocaleString()} <span className="text-gray-500 dark:text-gray-400 text-xl">{selectedTx.asset.code}</span>
                          </div>
                          <div className="mt-2">
                               {renderStatusBadge(selectedTx.status)}
                          </div>
                      </div>
                      <div className="space-y-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                          <div className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">Withdraw No</span>
                              <span className="font-mono font-medium text-gray-900 dark:text-white">{selectedTx.withdrawNo}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">Date</span>
                              <span className="font-medium text-gray-900 dark:text-white">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">Destination</span>
                              <span className="font-medium text-gray-900 dark:text-white truncate max-w-[200px]" title={selectedTx.toAddress || selectedTx.toIban || ''}>
                                  {selectedTx.toAddress || selectedTx.toIban || 'N/A'}
                              </span>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Withdraw;

import { useState, useEffect } from 'react';
import { Wallet, Building2, History, RefreshCw, Info, AlertTriangle, ArrowRight, X, Plus, Filter, ShieldCheck, Clock, Coins } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatAssetAmount } from '../utils/number-format';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
  decimals?: number;
}

interface AssetBalance {
  assetId: string;
  assetCode: string;
  clientCredit: number;
  lockedBalance: number;
  assetDecimals?: number;
}

interface WalletItem {
  id: string;
  type: string;
  direction: string;
  asset: { id: string; code: string; type: string; decimals?: number };
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
  asset: { code: string; network: string | null; decimals?: number };
  createdAt: string;
  completedAt: string | null;
  toAddress: string | null;
  toIban: string | null;
  txHash: string | null;
}

interface WithdrawQuoteFeeLine {
  itemCode: 'WITHDRAW_SERVICE_FEE' | 'NETWORK_FEE_EST';
  calcType: 'FLAT' | 'PERCENT';
  currency: string;
  amount: string;
  adjustable: boolean;
}

interface WithdrawQuoteResult {
  quoteId: string;
  quoteNo: string;
  createdAt: string;
  expiresAt: string;
  matched: {
    assetEntryId: string;
    tierId: string;
    tierName: string;
  };
  fees: WithdrawQuoteFeeLine[];
  totals: Record<string, string>;
}

const Withdraw = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat' | 'history'>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [isManualInput, setIsManualInput] = useState(false);
  const [amount, setAmount] = useState('');
  const [, setLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quote, setQuote] = useState<WithdrawQuoteResult | null>(null);
  
  // History State
  const [transactions, setTransactions] = useState<WithdrawTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedTx, setSelectedTx] = useState<WithdrawTransaction | null>(null);
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyAssetId, setHistoryAssetId] = useState('');

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
  }, [activeTab, page, user, historyStatus, historyAssetId]);

  const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
          const token = localStorage.getItem('customer_token');
          const params = new URLSearchParams({
              skip: ((page - 1) * 10).toString(),
              take: '10',
          });
          if (historyStatus) params.append('status', historyStatus);
          if (historyAssetId) params.append('assetId', historyAssetId);

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
  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  const getErrorMessage = (message: unknown, fallback: string) => {
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    return fallback;
  };

  const clearQuoteState = () => {
    setQuote(null);
    setQuoteError(null);
  };

  const handlePreviewQuote = async () => {
    if (!selectedAssetId || !amount || Number(amount) <= 0) {
      setQuoteError('Please input a valid amount before preview.');
      setQuote(null);
      return;
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount > availableBalance) {
      setQuoteError('Insufficient balance');
      setQuote(null);
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/quotes`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            assetId: selectedAssetId,
            amount: withdrawAmount,
          }),
        },
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(getErrorMessage(err?.message, 'Failed to generate withdrawal quote'));
      }

      const data = (await response.json()) as WithdrawQuoteResult;
      setQuote(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate withdrawal quote';
      setQuoteError(message);
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  };

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
    if (!quote?.quoteId) {
        alert('Please preview fee to generate a quote first.');
        return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem('customer_token');
      const wallet = wallets.find(w => w.id === selectedWalletId);
      const asset = selectedAsset;

      const payload = {
          assetId: selectedAssetId,
          amount: withdrawAmount,
          toWalletId: isManualInput ? undefined : selectedWalletId,
          toAddress: isManualInput ? (asset?.type === 'CRYPTO' ? manualAddress : undefined) : wallet?.address,
          toIban: isManualInput ? (asset?.type === 'FIAT' ? manualAddress : undefined) : wallet?.iban,
          quoteId: quote.quoteId,
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
            clearQuoteState();
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
            alert(getErrorMessage(err?.message, 'Failed to submit withdrawal request'));
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
  const destinationReady = isManualInput ? Boolean(manualAddress) : Boolean(selectedWalletId);

  useEffect(() => {
    clearQuoteState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId, amount]);

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      PAYOUT_PENDING: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
      SUCCESS: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      CANCELLED: 'bg-slate-400 text-white dark:bg-slate-600',
      RETURNED: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-slate-100 text-slate-800'}`}>
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

      <div className="min-h-[600px] bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => {
                setActiveTab('crypto');
                setSelectedAssetId('');
                setSelectedWalletId('');
                setAmount('');
                clearQuoteState();
              }}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet size={18} />
                Crypto
              </div>
            </button>
            <button
              onClick={() => {
                setActiveTab('fiat');
                setSelectedAssetId('');
                setSelectedWalletId('');
                setAmount('');
                clearQuoteState();
              }}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'fiat' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                Fiat
              </div>
            </button>
            <button
              onClick={() => {
                setActiveTab('history');
                clearQuoteState();
              }}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'history' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <History size={18} />
                History
              </div>
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'history' ? (
              <div className="space-y-4">
                  <div className="flex flex-wrap gap-3 mb-4">
                      <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                          <Filter size={16} className="text-slate-500 dark:text-slate-400" />
                          <select 
                            value={historyStatus}
                            onChange={(e) => setHistoryStatus(e.target.value)}
                            className="bg-transparent text-sm text-slate-700 dark:text-slate-200 focus:outline-none"
                          >
                              <option value="">All Status</option>
                              <option value="CREATED">Created</option>
                              <option value="SUCCESS">Success</option>
                              <option value="PENDING_COMPLIANCE">Pending Compliance</option>
                              <option value="PAYOUT_PENDING">Payout Pending</option>
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                          <Wallet size={16} className="text-slate-500 dark:text-slate-400" />
                          <select 
                            value={historyAssetId}
                            onChange={(e) => setHistoryAssetId(e.target.value)}
                            className="bg-transparent text-sm text-slate-700 dark:text-slate-200 focus:outline-none"
                          >
                              <option value="">All Assets</option>
                              {assets.map(a => (
                                  <option key={a.id} value={a.id}>{a.code}</option>
                              ))}
                          </select>
                      </div>
                      <button 
                        onClick={fetchHistory}
                        className="p-2 text-slate-500 dark:text-slate-400 hover:text-brand-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors ml-auto"
                        title="Refresh"
                      >
                          <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                      </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                      <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                              <tr>
                                  <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Transaction No</th>
                                  <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Time</th>
                                  <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Asset / Amount</th>
                                  <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Status</th>
                                  <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400 text-right">Action</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                              {historyLoading && transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                                          Loading transactions...
                                      </td>
                                  </tr>
                              ) : transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                                          <div className="flex flex-col items-center">
                                              <History size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
                                              <p>No transactions found</p>
                                          </div>
                                      </td>
                                  </tr>
                              ) : (
                                  transactions.map(tx => (
                                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                          <td className="px-4 py-3">
                                              <div className="font-mono text-gray-900 dark:text-white">{tx.withdrawNo}</div>
                                          </td>
                                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                                              <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                                              <div>{new Date(tx.createdAt).toLocaleTimeString()}</div>
                                          </td>
                                          <td className="px-4 py-3">
                                              <div className="font-medium text-gray-900 dark:text-white">
                                                  {formatAssetAmount(tx.amount, tx.asset.decimals)} {tx.asset.code}
                                              </div>
                                          </td>
                                          <td className="px-4 py-3">
                                              {renderStatusBadge(tx.status)}
                                          </td>
                                          <td className="px-4 py-3 text-right">
                                              <button 
                                                onClick={() => setSelectedTx(tx)}
                                                className="text-brand-primary hover:text-brand-primary/80 text-xs font-medium px-3 py-1.5 bg-brand-primary/10 rounded-lg hover:bg-brand-primary/20 transition-colors"
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
                  <div className="flex justify-between items-center pt-2 text-sm text-slate-500 dark:text-slate-400">
                      <div>
                          Showing {transactions.length} of {total} records
                      </div>
                      <div className="flex gap-2">
                          <button 
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                          >
                              Previous
                          </button>
                          <button 
                            disabled={page * 10 >= total}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                          >
                              Next
                          </button>
                      </div>
                  </div>
              </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Form */}
                <div className="lg:col-span-2 space-y-6">
                    <form onSubmit={handleWithdraw} className="space-y-6 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                        {/* Asset Selector */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Asset</label>
                            <select
                                required
                                value={selectedAssetId}
                                onChange={(e) => { setSelectedAssetId(e.target.value); setSelectedWalletId(''); }}
                                className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                            >
                                <option value="">Select a currency...</option>
                                {filteredAssets.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.code} {a.network ? `(${a.network})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {!selectedAssetId ? (
                            <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-3 text-slate-400 mx-auto">
                                    {activeTab === 'crypto' ? <Wallet size={24} /> : <Building2 size={24} />}
                                </div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                                    Select {activeTab === 'crypto' ? 'Asset' : 'Currency'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Choose an asset above to continue withdrawal.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Recipient */}
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
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                                    />
                                ) : filteredWallets.length > 0 ? (
                                    <select
                                        required
                                        value={selectedWalletId}
                                        onChange={(e) => setSelectedWalletId(e.target.value)}
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="">Select an address...</option>
                                        {filteredWallets.map(w => (
                                            <option key={w.id} value={w.id}>
                                                {activeTab === 'crypto' ? w.address : `${w.bankName} - ${w.iban || w.bankAccount}`}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-xl flex items-start gap-3">
                                        <AlertTriangle className="text-amber-500 shrink-0" size={20} />
                                        <div className="text-sm text-amber-800 dark:text-amber-300">
                                            <p className="font-bold">No saved {activeTab === 'crypto' ? 'addresses' : 'accounts'} found.</p>
                                            <button 
                                                type="button"
                                                onClick={() => navigate('/wallet')}
                                                className="mt-1 text-amber-600 dark:text-amber-400 underline font-bold flex items-center gap-1"
                                            >
                                                Add one in Wallet Management <Plus size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                        {/* Amount Input */}
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
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                                    />
                                    <div className="absolute right-4 top-3.5 text-slate-400 dark:text-slate-500 font-medium">
                                        {assets.find(a => a.id === selectedAssetId)?.code}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex justify-between">
                                    <span>
                                        {balanceLoading ? (
                                            <span className="flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Loading balance...</span>
                                        ) : (
                                            `Available: ${formatAssetAmount(
                                              availableBalance,
                                              assets.find((a) => a.id === selectedAssetId)
                                                ?.decimals,
                                            )} ${assets.find(a => a.id === selectedAssetId)?.code}`
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

                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">Fee Preview</h4>
                                    <button
                                        type="button"
                                        onClick={handlePreviewQuote}
                                        disabled={quoteLoading || !selectedAssetId || !amount || Number(amount) <= 0}
                                        className="px-3 py-1.5 text-xs rounded-lg bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
                                    >
                                        {quoteLoading ? <RefreshCw size={12} className="animate-spin" /> : null}
                                        Preview Fee
                                    </button>
                                </div>

                                {quoteError && (
                                    <div className="text-xs text-red-600 dark:text-red-300">
                                        {quoteError}
                                    </div>
                                )}

                                {!quote && !quoteError && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        Generate a quote to preview service fee, gas fee, total fee and net amount.
                                    </div>
                                )}

                                {quote && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-slate-500 dark:text-slate-400">Service Fee</span>
                                            <span className="font-medium text-gray-900 dark:text-white">
                                                {formatAssetAmount(
                                                    quote.fees.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE')?.amount || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.code}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500 dark:text-slate-400">Gas Fee</span>
                                            <span className="font-medium text-gray-900 dark:text-white">
                                                {formatAssetAmount(
                                                    quote.fees.find((item) => item.itemCode === 'NETWORK_FEE_EST')?.amount || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.code}
                                            </span>
                                        </div>
                                        <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2">
                                            <span className="text-slate-500 dark:text-slate-400">Total Fee</span>
                                            <span className="font-medium text-gray-900 dark:text-white">
                                                {formatAssetAmount(
                                                    quote.totals[selectedAsset?.code || ''] || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.code}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500 dark:text-slate-400">Net Amount</span>
                                            <span className="font-bold text-gray-900 dark:text-white">
                                                {formatAssetAmount(
                                                    Number(amount || 0) -
                                                      Number(quote.totals[selectedAsset?.code || ''] || 0),
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.code}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                            Quote: {quote.quoteId}
                                        </div>
                                    </div>
                                )}
                            </div>

                        {/* Submit Button */}
                        <div className="pt-4">
                            <button
                                type="submit"
                                disabled={
                                    submitting ||
                                    !selectedAssetId ||
                                    !destinationReady ||
                                    !quote?.quoteId ||
                                    !!quoteLoading
                                }
                                className="w-full py-4 bg-gradient-to-r from-brand-primary to-brand-primary/80 text-white rounded-xl hover:from-brand-primary/90 hover:to-brand-primary/70 transition-all disabled:opacity-50 font-bold shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={20} />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Confirm Withdraw
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                            {!quote?.quoteId && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                    Please generate fee preview before submitting.
                                </p>
                            )}
                        </div>
                        </>
                    )}
                    </form>
                </div>

                {/* Right Column: Instructions */}
                <div className="lg:col-span-1">
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-6 border border-blue-100 dark:border-blue-900/30 sticky top-6">
                        <div className="flex items-center gap-2 mb-4 text-blue-800 dark:text-blue-300">
                            <div className="p-2 bg-blue-100 dark:bg-blue-800/30 rounded-lg">
                                <Info size={24} />
                            </div>
                            <h3 className="font-bold text-lg">Instructions</h3>
                        </div>
                        
                        {activeTab === 'crypto' ? (
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <ShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Network Selection</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            Ensure withdrawal network matches recipient's. Wrong network = <strong className="underline">permanent loss</strong>.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Clock size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Withdrawal Time</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            Typically processed within <strong className="underline">30-60 minutes</strong> after network confirmation.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Coins size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Minimum Withdrawal</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            Min: <strong>0.001 BTC / 0.01 ETH</strong>. Fees deducted from amount.
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-blue-100 dark:border-blue-900/30 mt-2">
                                    <div className="flex gap-2 items-start">
                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
                                            For security reasons, your first withdrawal after changing security settings will be delayed by 24 hours.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <Building2 size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Beneficiary Name</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            Withdrawals can only be made to bank accounts held in <strong className="underline">your own name</strong>.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Clock size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Processing Time</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            <strong className="underline">1-3 business days</strong>. No processing on weekends/holidays.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Coins size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Withdrawal Fees</h4>
                                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                            Standard SEPA/SWIFT fees apply. Refer to Fee Schedule.
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-blue-100 dark:border-blue-900/30 mt-2">
                                    <div className="flex gap-2 items-start">
                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
                                            Ensure all bank details are correct. Incorrect IBANs may lead to significant delays and return fees.
                                        </p>
                                    </div>
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
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
                  <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-slate-700">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">Withdrawal Details</h3>
                      <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 dark:text-slate-400">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div className="text-center">
                          <div className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                              {formatAssetAmount(selectedTx.amount, selectedTx.asset.decimals)} <span className="text-slate-500 dark:text-slate-400 text-xl">{selectedTx.asset.code}</span>
                          </div>
                          <div className="mt-2">
                               {renderStatusBadge(selectedTx.status)}
                          </div>
                      </div>
                      <div className="space-y-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                          <div className="flex justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Withdraw No</span>
                              <span className="font-mono font-medium text-gray-900 dark:text-white">{selectedTx.withdrawNo}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Date</span>
                              <span className="font-medium text-gray-900 dark:text-white">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-slate-500 dark:text-slate-400">Destination</span>
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

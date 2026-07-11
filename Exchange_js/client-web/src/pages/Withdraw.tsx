import { useState, useEffect } from 'react';
import { Wallet, Building2, History, RefreshCw, Info, AlertTriangle, ArrowRight, X, Plus, Filter, ShieldCheck, Clock, Coins } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatAssetAmount } from '../utils/number-format';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string | null;
  decimals?: number;
}

interface AssetBalance {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;
  locked: string;
  decimals: number;
}

interface WithdrawalAddressItem {
  id: string;
  addressNo: string;
  assetId: string;
  address: string;
  addressType: string;
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  iban?: string;
  bankName?: string;
  status: string;
  asset: { id: string; code: string; type: string; decimals?: number };
}

interface WithdrawTransaction {
  id: string;
  withdrawNo: string;
  status: string;
  amount: string;
  asset: { currency: string; code: string; network: string | null; decimals?: number };
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
  const [addresses, setAddresses] = useState<WithdrawalAddressItem[]>([]);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [selectedAddressNo, setSelectedAddressNo] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [isManualInput, setIsManualInput] = useState(false);
  const [amount, setAmount] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [quote, setQuote] = useState<WithdrawQuoteResult | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  
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
        // Fetch Assets
        const assetsResponse = await customerFetch(
          `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`,
        );
        if (assetsResponse.ok) {
          const data = await assetsResponse.json();
          setAssets(data.items || []);
        }

        // Fetch Balances
        const balancesResponse = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
        );
        if (balancesResponse.ok) {
          const data = await balancesResponse.json();
          setBalances(data);
          setBalanceError(null);
        } else {
          setBalanceError('Failed to load balances');
        }
      } catch (error: unknown) {
        if (error instanceof CustomerSessionError) {
          return;
        }
        setBalanceError('Failed to load balances');
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
        setAddresses([]);
        return;
    }

    const fetchAddresses = async () => {
      try {
        const params = new URLSearchParams({
            assetId: selectedAssetId,
            status: 'ACTIVE',
        });
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/withdrawal-addresses?${params.toString()}`,
        );

        if (response.ok) {
            const data = await response.json();
            setAddresses(data.items || []);
        }
      } catch (error: unknown) {
        if (error instanceof CustomerSessionError) {
          return;
        }
        console.error('Failed to fetch addresses', error);
      }
    };

    fetchAddresses();
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
          const params = new URLSearchParams({
              skip: ((page - 1) * 10).toString(),
              take: '10',
          });
          if (historyStatus) params.append('status', historyStatus);
          if (historyAssetId) params.append('assetId', historyAssetId);

          const response = await customerFetch(
            `${import.meta.env.VITE_API_URL}/client/withdraw-transactions?${params.toString()}`,
          );

          if (response.ok) {
              const data = await response.json();
              setTransactions(data.items || []);
              setTotal(data.total || 0);
          }
      } catch (error: unknown) {
          if (error instanceof CustomerSessionError) {
            return;
          }
          console.error('Failed to fetch history', error);
      } finally {
          setHistoryLoading(false);
      }
  };

  const selectedBalance = balances.find(b => b.assetId === selectedAssetId);
  const availableBalance = selectedBalance ? parseFloat(selectedBalance.available) : 0;
  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  const clearQuoteState = () => {
    setQuote(null);
    setQuoteError(null);
    setConfirmModalOpen(false);
  };

  const validateWithdrawRequest = (): string | null => {
    if (!selectedAssetId || !amount || Number(amount) <= 0) {
      return 'Please input a valid amount before continuing.';
    }

    if (!destinationReady) {
      return 'Please fill in all required fields';
    }

    if (isManualInput && !manualAddress) {
      return 'Please enter a destination address';
    }

    if (parseFloat(amount) > availableBalance) {
      return 'Insufficient balance';
    }

    return null;
  };

  const handlePreviewQuote = async (): Promise<WithdrawQuoteResult | null> => {
    if (!selectedAssetId || !amount || Number(amount) <= 0) {
      setQuoteError('Please input a valid amount before preview.');
      setQuote(null);
      return null;
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount > availableBalance) {
      setQuoteError('Insufficient balance');
      setQuote(null);
      return null;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/withdraw-transactions/quotes`,
        {
          method: 'POST',
          body: JSON.stringify({
            assetId: selectedAssetId,
            amount: withdrawAmount,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getCustomerApiErrorMessage(response, 'Failed to generate withdrawal quote'),
        );
      }

      const data = (await response.json()) as WithdrawQuoteResult;
      setQuote(data);
      return data;
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        return null;
      }
      const message = error instanceof Error ? error.message : 'Failed to generate withdrawal quote';
      setQuoteError(message);
      setQuote(null);
      return null;
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateWithdrawRequest();
    if (validationError) {
        alert(validationError);
        return;
    }

    const generatedQuote = await handlePreviewQuote();
    if (generatedQuote?.quoteId) {
      setConfirmModalOpen(true);
    }
  };

  const handleConfirmWithdraw = async () => {
    if (!quote?.quoteId) {
      alert('Quote expired. Please submit again to refresh the fee summary.');
      clearQuoteState();
      return;
    }

    const withdrawAmount = parseFloat(amount);
    setSubmitting(true);
    try {
      const selectedAddr = addresses.find(a => a.addressNo === selectedAddressNo);
      const asset = selectedAsset;

      const payload = {
          assetId: selectedAssetId,
          amount: withdrawAmount,
          toAddress: isManualInput ? (asset?.type === 'CRYPTO' ? manualAddress : undefined) : selectedAddr?.address,
          toIban: isManualInput ? (asset?.type === 'FIAT' ? manualAddress : undefined) : selectedAddr?.iban,
          quoteId: quote.quoteId,
      };

        const response = await customerFetch(`${import.meta.env.VITE_API_URL}/client/withdraw-transactions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('Withdrawal request submitted successfully!');
            setActiveTab('history');
            setAmount('');
            setSelectedAddressNo('');
            setManualAddress('');
            clearQuoteState();
            // Refresh balances
            const balancesResponse = await customerFetch(
              `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
            );
            if (balancesResponse.ok) {
                const data = await balancesResponse.json();
                setBalances(data);
            }
        } else {
            const message = await getCustomerApiErrorMessage(
              response,
              'Failed to submit withdrawal request',
            );
            alert(message);
            if (message.toLowerCase().includes('quote')) {
              clearQuoteState();
            }
        }
    } catch (error: unknown) {
        if (error instanceof CustomerSessionError) {
          return;
        }
        console.error('Withdrawal failed', error);
        alert('An unexpected error occurred');
    } finally {
        setSubmitting(false);
    }
  };



  const filteredAssets = assets.filter(a =>
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT'
  );

  const filteredAddresses = addresses; // Now filtered by API
  const destinationReady = isManualInput ? Boolean(manualAddress) : Boolean(selectedAddressNo);

  useEffect(() => {
    clearQuoteState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId, amount, selectedAddressNo, manualAddress, isManualInput]);

  const getCustomerFacingWithdrawStatus = (status: string): { label: string; className: string } => {
    const s = status?.toUpperCase() || '';
    if (['SUCCESS'].includes(s))
      return { label: 'Completed', className: 'text-fx-sage bg-fx-sage/10' };
    if (['REJECTED', 'CANCELLED'].includes(s))
      return { label: 'Declined', className: 'text-rose-400 bg-rose-500/10' };
    if (['FAILED', 'RETURNED'].includes(s))
      return { label: 'Failed', className: 'text-fx-rust bg-fx-rust/10' };
    if (['EXPIRED'].includes(s))
      return { label: 'Expired', className: 'text-fx-dust bg-fx-dust/10' };
    return { label: 'Processing', className: 'text-fx-brass bg-fx-brass/10' };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fx-sand">Withdraw</h1>
        <p className="mt-1 text-sm text-fx-dust">Send funds to your wallet or bank account</p>
      </div>

      <div className="min-h-[600px] bg-fx-ink/40 rounded-3xl shadow-sm border border-fx-rule overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-fx-rule">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => {
                setActiveTab('crypto');
                setSelectedAssetId('');
                setSelectedAddressNo('');
                setAmount('');
                clearQuoteState();
              }}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-sand'
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
                setSelectedAddressNo('');
                setAmount('');
                clearQuoteState();
              }}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'fiat'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-sand'
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
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-sand'
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
                      <div className="flex items-center gap-2 bg-fx-charcoal px-3 py-2 rounded-lg border border-fx-rule">
                          <Filter size={16} className="text-fx-dust" />
                          <select
                            value={historyStatus}
                            onChange={(e) => setHistoryStatus(e.target.value)}
                            className="bg-transparent text-sm text-fx-sand focus:outline-none"
                          >
                              <option value="">All Status</option>
                              <option value="CREATED,PENDING_APPROVAL,PENDING_COMPLIANCE,UNDER_REVIEW,APPROVED,PAYOUT_PENDING,FROZEN">Processing</option>
                              <option value="SUCCESS">Completed</option>
                              <option value="REJECTED,CANCELLED">Declined</option>
                              <option value="FAILED,RETURNED">Failed</option>
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-fx-charcoal px-3 py-2 rounded-lg border border-fx-rule">
                          <Wallet size={16} className="text-fx-dust" />
                          <select
                            value={historyAssetId}
                            onChange={(e) => setHistoryAssetId(e.target.value)}
                            className="bg-transparent text-sm text-fx-sand focus:outline-none"
                          >
                              <option value="">All Assets</option>
                              {assets.map(a => (
                                  <option key={a.id} value={a.id}>{a.code}</option>
                              ))}
                          </select>
                      </div>
                      <button
                        onClick={fetchHistory}
                        className="p-2 text-fx-dust hover:text-fx-brass hover:bg-fx-ink/60 rounded-lg transition-colors ml-auto"
                        title="Refresh"
                      >
                          <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                      </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-xl border border-fx-rule">
                      <table className="w-full text-left text-sm">
                          <thead className="border-b border-fx-rule">
                              <tr>
                                  <th className="px-4 py-3 font-medium text-fx-dust">Transaction No</th>
                                  <th className="px-4 py-3 font-medium text-fx-dust">Time</th>
                                  <th className="px-4 py-3 font-medium text-fx-dust">Asset / Amount</th>
                                  <th className="px-4 py-3 font-medium text-fx-dust">Status</th>
                                  <th className="px-4 py-3 font-medium text-fx-dust text-right">Action</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-fx-rule">
                              {historyLoading && transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-8 text-center text-fx-dust">
                                          Loading transactions...
                                      </td>
                                  </tr>
                              ) : transactions.length === 0 ? (
                                  <tr>
                                      <td colSpan={5} className="px-4 py-12 text-center text-fx-dust">
                                          <div className="flex flex-col items-center">
                                              <History size={32} className="text-fx-dust/50 mb-2" />
                                              <p>No transactions found</p>
                                          </div>
                                      </td>
                                  </tr>
                              ) : (
                                  transactions.map(tx => {
                                      const st = getCustomerFacingWithdrawStatus(tx.status);
                                      return (
                                      <tr key={tx.id} className="hover:bg-fx-ink/60 transition-colors">
                                          <td className="px-4 py-3">
                                              <div className="font-mono text-fx-sand">{tx.withdrawNo}</div>
                                          </td>
                                          <td className="px-4 py-3 text-fx-dust text-xs">
                                              <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                                              <div>{new Date(tx.createdAt).toLocaleTimeString()}</div>
                                          </td>
                                          <td className="px-4 py-3">
                                              <div className="font-medium text-fx-sand">
                                                  {formatAssetAmount(tx.amount, tx.asset.decimals)} {tx.asset.currency}
                                              </div>
                                          </td>
                                          <td className="px-4 py-3">
                                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${st.className}`}>
                                                  {st.label}
                                              </span>
                                          </td>
                                          <td className="px-4 py-3 text-right">
                                              <button
                                                onClick={() => setSelectedTx(tx)}
                                                className="text-fx-brass hover:text-fx-brass/80 text-xs font-medium px-3 py-1.5 bg-fx-brass/10 rounded-lg hover:bg-fx-brass/20 transition-colors"
                                              >
                                                  Details
                                              </button>
                                          </td>
                                      </tr>
                                      );
                                  })
                              )}
                          </tbody>
                      </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex justify-between items-center pt-2 text-sm text-fx-dust">
                      <div>
                          Showing {transactions.length} of {total} records
                      </div>
                      <div className="flex gap-2">
                          <button
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 border border-fx-rule rounded-lg text-fx-dust hover:text-fx-sand hover:bg-fx-ink/60 disabled:opacity-50"
                          >
                              Previous
                          </button>
                          <button
                            disabled={page * 10 >= total}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 border border-fx-rule rounded-lg text-fx-dust hover:text-fx-sand hover:bg-fx-ink/60 disabled:opacity-50"
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
                    <form onSubmit={handleWithdraw} className="space-y-6 p-6 bg-fx-ink/40 rounded-2xl border border-fx-rule">
                        {/* Asset Selector */}
                        <div>
                            <label className="block text-sm font-medium text-fx-dune mb-2">Select Asset</label>
                            <select
                                required
                                value={selectedAssetId}
                                onChange={(e) => { setSelectedAssetId(e.target.value); setSelectedAddressNo(''); }}
                                className="w-full px-4 py-3 border border-fx-rule rounded-xl focus:outline-none focus:border-fx-brass focus:ring-2 focus:ring-fx-brass/20 bg-fx-charcoal text-fx-sand"
                            >
                                <option value="">Select a currency...</option>
                                {filteredAssets.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.code}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {!selectedAssetId ? (
                            <div className="text-center py-12 border-2 border-dashed border-fx-rule rounded-xl">
                                <div className="w-12 h-12 bg-fx-charcoal rounded-full flex items-center justify-center mb-3 text-fx-dust mx-auto">
                                    {activeTab === 'crypto' ? <Wallet size={24} /> : <Building2 size={24} />}
                                </div>
                                <h3 className="text-sm font-bold text-fx-sand mb-1">
                                    Select {activeTab === 'crypto' ? 'Asset' : 'Currency'}
                                </h3>
                                <p className="text-xs text-fx-dust">
                                    Choose an asset above to continue withdrawal.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Recipient */}
                                <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-sm font-medium text-fx-dune">
                                        {activeTab === 'crypto' ? 'Withdrawal Address' : 'Withdrawal Bank Account'}
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => { setIsManualInput(!isManualInput); setSelectedAddressNo(''); setManualAddress(''); }}
                                        className="text-xs text-fx-brass hover:underline font-medium"
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
                                        className="w-full px-4 py-3 border border-fx-rule rounded-xl focus:outline-none focus:border-fx-brass focus:ring-2 focus:ring-fx-brass/20 bg-fx-charcoal text-fx-sand placeholder:text-fx-dust"
                                    />
                                ) : filteredAddresses.length > 0 ? (
                                    <select
                                        required
                                        value={selectedAddressNo}
                                        onChange={(e) => setSelectedAddressNo(e.target.value)}
                                        className="w-full px-4 py-3 border border-fx-rule rounded-xl focus:outline-none focus:border-fx-brass focus:ring-2 focus:ring-fx-brass/20 bg-fx-charcoal text-fx-sand"
                                    >
                                        <option value="">Select an address...</option>
                                        {filteredAddresses.map(a => (
                                            <option key={a.addressNo} value={a.addressNo}>
                                                {activeTab === 'crypto' ? (a.label ? `${a.label} (${a.address})` : a.address) : `${a.bankName} - ${a.iban}`}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
                                        <AlertTriangle className="text-amber-500 shrink-0" size={20} />
                                        <div className="text-sm text-amber-300">
                                            <p className="font-bold">No saved {activeTab === 'crypto' ? 'addresses' : 'accounts'} found.</p>
                                            <button
                                                type="button"
                                                onClick={() => navigate('/withdrawal-addresses')}
                                                className="mt-1 text-amber-400 underline font-bold flex items-center gap-1"
                                            >
                                                Add one in Wallet Management <Plus size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                        {/* Amount Input */}
                            <div>
                                {balanceError && (
                                    <div className="p-3 bg-fx-rust/10 border border-fx-rust/30 rounded-xl text-sm text-fx-rust flex items-center gap-2">
                                        <AlertTriangle size={16} />
                                        {balanceError}
                                    </div>
                                )}
                                <label className="block text-sm font-medium text-fx-dune mb-2">Amount</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="number"
                                        step="any"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full px-4 py-3 border border-fx-rule rounded-xl focus:outline-none focus:border-fx-brass focus:ring-2 focus:ring-fx-brass/20 bg-fx-charcoal text-fx-sand placeholder:text-fx-dust"
                                    />
                                    <div className="absolute right-4 top-3.5 text-fx-dust font-medium">
                                        {assets.find(a => a.id === selectedAssetId)?.currency}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-fx-dust flex justify-between">
                                    <span>
                                        {balanceLoading ? (
                                            <span className="flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Loading balance...</span>
                                        ) : (
                                            `Available: ${formatAssetAmount(
                                              availableBalance,
                                              assets.find((a) => a.id === selectedAssetId)
                                                ?.decimals,
                                            )} ${assets.find(a => a.id === selectedAssetId)?.currency}`
                                        )}
                                    </span>
                                    <button 
                                        type="button" 
                                        onClick={() => setAmount(availableBalance.toString())}
                                        className="text-fx-brass hover:underline font-medium"
                                    >
                                        Withdraw All
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-xl border border-fx-rule bg-fx-charcoal p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-fx-sand">Fee Summary</h4>
                                    {quote ? (
                                        <span className="text-[11px] font-mono text-fx-dust">
                                            {quote.quoteNo}
                                        </span>
                                    ) : null}
                                </div>

                                {quoteError && (
                                    <div className="text-xs text-fx-rust">
                                        {quoteError}
                                    </div>
                                )}

                                {!quote && !quoteError && (
                                    <div className="text-xs text-fx-dust">
                                        Click submit once to generate a quote and review the fee breakdown in the confirmation modal.
                                    </div>
                                )}

                                {quote && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-fx-dust">Service Fee</span>
                                            <span className="font-medium text-fx-sand">
                                                {formatAssetAmount(
                                                    quote.fees.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE')?.amount || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.currency}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-fx-dust">Gas Fee</span>
                                            <span className="font-medium text-fx-sand">
                                                {formatAssetAmount(
                                                    quote.fees.find((item) => item.itemCode === 'NETWORK_FEE_EST')?.amount || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.currency}
                                            </span>
                                        </div>
                                        <div className="flex justify-between border-t border-fx-rule pt-2">
                                            <span className="text-fx-dust">Total Fee</span>
                                            <span className="font-medium text-fx-sand">
                                                {formatAssetAmount(
                                                    quote.totals[selectedAsset?.currency || ''] || 0,
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.currency}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-fx-dust">Net Amount</span>
                                            <span className="font-bold text-fx-sand">
                                                {formatAssetAmount(
                                                    Number(amount || 0) -
                                                      Number(quote.totals[selectedAsset?.currency || ''] || 0),
                                                    selectedAsset?.decimals,
                                                )} {selectedAsset?.currency}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-fx-dust/60 font-mono">
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
                                    quoteLoading ||
                                    !selectedAssetId ||
                                    !destinationReady ||
                                    !amount ||
                                    Number(amount) <= 0
                                }
                                className="w-full py-4 bg-fx-brass text-fx-obsidian rounded-xl hover:bg-fx-brass/90 transition-all disabled:opacity-50 font-bold flex items-center justify-center gap-2"
                            >
                                {quoteLoading ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={20} />
                                        Generating Quote...
                                    </>
                                ) : submitting ? (
                                    <>
                                        <RefreshCw className="animate-spin" size={20} />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Review Withdrawal
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                            <p className="text-xs text-fx-dust mt-2">
                                Submit once to review fees. The withdrawal is created only after the second confirmation.
                            </p>
                        </div>
                        </>
                    )}
                    </form>
                </div>

                {/* Right Column: Instructions */}
                <div className="lg:col-span-1">
                    <div className="bg-fx-ink/60 rounded-2xl p-6 border border-fx-rule sticky top-6">
                        <div className="flex items-center gap-2 mb-4 text-fx-brass">
                            <div className="p-2 bg-fx-brass/10 rounded-lg">
                                <Info size={24} />
                            </div>
                            <h3 className="font-bold text-lg">Instructions</h3>
                        </div>
                        
                        {activeTab === 'crypto' ? (
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <ShieldCheck size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Network Selection</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            Ensure withdrawal network matches recipient's. Wrong network = <strong className="underline">permanent loss</strong>.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Clock size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Withdrawal Time</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            Typically processed within <strong className="underline">30-60 minutes</strong> after network confirmation.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Coins size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Minimum Withdrawal</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            Min: <strong>0.001 BTC / 0.01 ETH</strong>. Fees deducted from amount.
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 bg-fx-charcoal/60 rounded-xl border border-fx-rule mt-2">
                                    <div className="flex gap-2 items-start">
                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[11px] font-bold text-fx-dust leading-relaxed">
                                            For security reasons, your first withdrawal after changing security settings will be delayed by 24 hours.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <Building2 size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Beneficiary Name</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            Withdrawals can only be made to bank accounts held in <strong className="underline">your own name</strong>.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Clock size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Processing Time</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            <strong className="underline">1-3 business days</strong>. No processing on weekends/holidays.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Coins size={20} className="text-fx-brass shrink-0 mt-1" />
                                    <div>
                                        <h4 className="text-sm font-bold text-fx-brass">Withdrawal Fees</h4>
                                        <p className="text-xs text-fx-dust mt-1">
                                            Standard SEPA/SWIFT fees apply. Refer to Fee Schedule.
                                        </p>
                                    </div>
                                </div>

                                <div className="p-4 bg-fx-charcoal/60 rounded-xl border border-fx-rule mt-2">
                                    <div className="flex gap-2 items-start">
                                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[11px] font-bold text-fx-dust leading-relaxed">
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

      {confirmModalOpen && quote ? (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-2xl border border-fx-rule bg-fx-ink shadow-2xl">
                  <div className="flex items-center justify-between border-b border-fx-rule px-6 py-5">
                      <div>
                          <h3 className="text-lg font-bold text-fx-sand">Confirm Withdrawal</h3>
                          <p className="mt-1 text-xs text-fx-dust">
                              Review all fees before consuming quote `{quote.quoteNo}`.
                          </p>
                      </div>
                      <button
                          onClick={clearQuoteState}
                          className="rounded-full p-2 text-fx-dust transition-colors hover:bg-fx-charcoal"
                      >
                          <X size={18} />
                      </button>
                  </div>

                  <div className="space-y-5 px-6 py-5">
                      <div className="rounded-xl border border-fx-rule bg-fx-charcoal p-4">
                          <div className="flex justify-between text-sm">
                              <span className="text-fx-dust">Amount</span>
                              <span className="font-semibold text-fx-sand">
                                  {formatAssetAmount(amount, selectedAsset?.decimals)} {selectedAsset?.currency}
                              </span>
                          </div>
                          <div className="mt-2 flex justify-between text-sm">
                              <span className="text-fx-dust">Destination</span>
                              <span className="max-w-[240px] truncate text-right font-medium text-fx-sand" title={manualAddress || selectedAddressNo}>
                                  {isManualInput ? manualAddress : addresses.find(a => a.addressNo === selectedAddressNo)?.address || addresses.find(a => a.addressNo === selectedAddressNo)?.iban || 'Saved destination'}
                              </span>
                          </div>
                          <div className="mt-2 flex justify-between text-sm">
                              <span className="text-fx-dust">Expires At</span>
                              <span className="font-medium text-fx-sand">
                                  {new Date(quote.expiresAt).toLocaleString()}
                              </span>
                          </div>
                      </div>

                      <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                              <span className="text-fx-dust">Service Fee</span>
                              <span className="font-medium text-fx-sand">
                                  {formatAssetAmount(
                                      quote.fees.find((item) => item.itemCode === 'WITHDRAW_SERVICE_FEE')?.amount || 0,
                                      selectedAsset?.decimals,
                                  )} {selectedAsset?.currency}
                              </span>
                          </div>
                          <div className="flex justify-between">
                              <span className="text-fx-dust">Network Fee</span>
                              <span className="font-medium text-fx-sand">
                                  {formatAssetAmount(
                                      quote.fees.find((item) => item.itemCode === 'NETWORK_FEE_EST')?.amount || 0,
                                      selectedAsset?.decimals,
                                  )} {selectedAsset?.currency}
                              </span>
                          </div>
                          <div className="flex justify-between border-t border-fx-rule pt-3">
                              <span className="text-fx-dust">Total Fee</span>
                              <span className="font-semibold text-fx-sand">
                                  {formatAssetAmount(
                                      quote.totals[selectedAsset?.currency || ''] || 0,
                                      selectedAsset?.decimals,
                                  )} {selectedAsset?.currency}
                              </span>
                          </div>
                          <div className="flex justify-between">
                              <span className="text-fx-dust">Net Amount</span>
                              <span className="font-bold text-fx-sand">
                                  {formatAssetAmount(
                                      Number(amount || 0) - Number(quote.totals[selectedAsset?.currency || ''] || 0),
                                      selectedAsset?.decimals,
                                  )} {selectedAsset?.currency}
                              </span>
                          </div>
                      </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-fx-rule px-6 py-5">
                      <button
                          onClick={clearQuoteState}
                          className="rounded-xl border border-fx-rule px-4 py-2 text-sm font-medium text-fx-dust transition-colors hover:text-fx-sand"
                      >
                          Cancel
                      </button>
                      <button
                          onClick={handleConfirmWithdraw}
                          disabled={submitting}
                          className="inline-flex items-center gap-2 rounded-xl bg-fx-brass px-4 py-2 text-sm font-semibold text-fx-obsidian transition-colors hover:bg-fx-brass/90 disabled:opacity-50"
                      >
                          {submitting ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                          Confirm and Submit
                      </button>
                  </div>
              </div>
          </div>
      ) : null}

      {/* Detail Modal (Simplified) */}
      {selectedTx && (() => {
          const detailSt = getCustomerFacingWithdrawStatus(selectedTx.status);
          return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-fx-rule">
                  <div className="flex justify-between items-center p-6 border-b border-fx-rule">
                      <h3 className="text-xl font-bold text-fx-sand">Withdrawal Details</h3>
                      <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div className="text-center">
                          <div className="text-3xl font-bold text-fx-sand mb-1">
                              {formatAssetAmount(selectedTx.amount, selectedTx.asset.decimals)} <span className="text-fx-dust text-xl">{selectedTx.asset.currency}</span>
                          </div>
                          <div className="mt-2">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${detailSt.className}`}>
                                  {detailSt.label}
                              </span>
                          </div>
                      </div>
                      <div className="space-y-4 bg-fx-charcoal p-4 rounded-xl border border-fx-rule">
                          <div className="flex justify-between text-sm">
                              <span className="text-fx-dust">Withdraw No</span>
                              <span className="font-mono font-medium text-fx-sand">{selectedTx.withdrawNo}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-fx-dust">Date</span>
                              <span className="font-medium text-fx-sand">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                              <span className="text-fx-dust">Destination</span>
                              <span className="font-medium text-fx-sand truncate max-w-[200px]" title={selectedTx.toAddress || selectedTx.toIban || ''}>
                                  {selectedTx.toAddress || selectedTx.toIban || 'N/A'}
                              </span>
                          </div>
                      </div>
                      <button
                        onClick={() => setSelectedTx(null)}
                        className="mt-4 w-full rounded-xl bg-fx-charcoal py-2.5 text-sm font-medium text-fx-sand hover:bg-fx-charcoal/80"
                      >
                        Close
                      </button>
                  </div>
              </div>
          </div>
          );
      })()}
    </div>
  );
};

export default Withdraw;

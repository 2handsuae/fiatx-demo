import { useState, useEffect } from 'react';
import { Copy, RefreshCw, Check, Wallet, Building2, ArrowRightLeft, Info, AlertTriangle, History, X, Filter } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

interface WalletItem {
  id: string;
  type: string;
  asset: { code: string; type: string };
  address?: string;
  memo?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  accountName?: string;
  bankCode?: string;
}

interface Transaction {
    id: string;
    depositNo: string;
    status: string;
    amount: string;
    createdAt: string;
    completedAt: string | null;
    asset: {
        code: string;
        network: string | null;
    };
    txHash: string | null;
    referenceNo: string | null;
    fromAddress: string | null;
    fromIban: string | null;
}

const Deposit = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat' | 'history'>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [depositWallet, setDepositWallet] = useState<WalletItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [copied, setCopied] = useState(false);

  // History State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  
  // History Filters
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyAssetId, setHistoryAssetId] = useState('');

  // Fetch Assets
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const token = localStorage.getItem('customer_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setAssets(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch assets', error);
      }
    };
    fetchAssets();
  }, []);

  // Fetch Existing Wallet when Asset Changes
  useEffect(() => {
    if (!selectedAssetId || !user || activeTab === 'history') {
      setDepositWallet(null);
      return;
    }

    const fetchWallet = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('customer_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets?ownerType=CUSTOMER&ownerId=${user.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            const items: WalletItem[] = data.items || [];
            const found = items.find(w => 
                w.asset.code === assets.find(a => a.id === selectedAssetId)?.code &&
                (w.type === 'CRYPTO_ADDRESS' || w.type === 'FIAT_BANK') &&
                (w as any).direction === 'INBOUND'
            );
            setDepositWallet(found || null);
        }
      } catch (error) {
        console.error('Failed to fetch wallet', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWallet();
  }, [selectedAssetId, user, assets, activeTab]);

  // Fetch History
  useEffect(() => {
      if (activeTab === 'history' && user) {
          fetchHistory();
      }
  }, [activeTab, page, historyStatus, historyAssetId, user]);

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

          const response = await fetch(`${import.meta.env.VITE_API_URL}/deposit-transactions/my?${params.toString()}`, {
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

  const handleGenerate = async () => {
    if (!selectedAssetId || !user) return;
    setGenerating(true);
    try {
        const token = localStorage.getItem('customer_token');
        const payload = {
            ownerType: 'CUSTOMER',
            ownerId: user.id,
            direction: 'INBOUND',
            type: activeTab === 'crypto' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
            assetId: selectedAssetId,
        };

        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const newWallet = await response.json();
            setDepositWallet(newWallet);
        } else {
            const err = await response.json();
            alert(err.message || 'Failed to generate address');
        }
    } catch (error) {
        console.error('Generation failed', error);
        alert('An unexpected error occurred');
    } finally {
        setGenerating(false);
    }
  };

  const handleSimulatePayin = async () => {
    if (!depositWallet || !user) return;
    setSimulating(true);
    try {
        const token = localStorage.getItem('customer_token');
        const payload = {
            assetId: selectedAssetId,
            toWalletId: depositWallet.id,
            type: activeTab === 'crypto' ? 'crypto' : 'fiat'
        };

        const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/payins/simulate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('Simulation successful! Payin created.');
        } else {
            const err = await response.json();
            alert(`Simulation failed: ${err.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Simulation failed', error);
        alert('Simulation failed due to network error');
    } finally {
        setSimulating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredAssets = assets.filter(a => 
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT'
  );

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      PAYIN_LINKED: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-indigo-100 text-indigo-800',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
      HELD: 'bg-orange-100 text-orange-800',
      SUCCESS: 'bg-emerald-100 text-emerald-800',
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Deposit Crypto or Fiat to your account</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden min-h-[500px]">
        {/* Tabs */}
        <div className="border-b border-gray-100 dark:border-gray-700">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet size={18} />
                Crypto Deposit
              </div>
            </button>
            <button
              onClick={() => setActiveTab('fiat')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'fiat' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                Fiat Deposit
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
                  {/* Filters */}
                  <div className="flex flex-wrap gap-3 mb-4">
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
                          <Filter size={16} className="text-gray-500 dark:text-gray-400" />
                          <select 
                            value={historyStatus}
                            onChange={(e) => setHistoryStatus(e.target.value)}
                            className="bg-transparent text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                          >
                              <option value="">All Status</option>
                              <option value="CREATED">Created</option>
                              <option value="SUCCESS">Success</option>
                              <option value="HELD">Held</option>
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700">
                          <Wallet size={16} className="text-gray-500 dark:text-gray-400" />
                          <select 
                            value={historyAssetId}
                            onChange={(e) => setHistoryAssetId(e.target.value)}
                            className="bg-transparent text-sm text-gray-700 dark:text-gray-200 focus:outline-none"
                          >
                              <option value="">All Assets</option>
                              {assets.map(a => (
                                  <option key={a.id} value={a.id}>{a.code}</option>
                              ))}
                          </select>
                      </div>
                      <button 
                        onClick={fetchHistory}
                        className="p-2 text-gray-500 dark:text-gray-400 hover:text-brand-primary hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors ml-auto"
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
                                              <div className="font-mono text-gray-900 dark:text-white">{tx.depositNo}</div>
                                              {tx.txHash && (
                                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={tx.txHash}>
                                                      Ref: {tx.txHash.substring(0, 8)}...
                                                  </div>
                                              )}
                                              {tx.referenceNo && (
                                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[120px]" title={tx.referenceNo}>
                                                      Ref: {tx.referenceNo}
                                                  </div>
                                              )}
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
            <>
                {/* Asset Selector */}
                <div className="mb-8 max-w-md">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Asset</label>
                    <select
                    value={selectedAssetId}
                    onChange={(e) => setSelectedAssetId(e.target.value)}
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

                {selectedAssetId ? (
                    <div className="flex flex-col lg:flex-row gap-8 relative">
                        {/* Left Column: Asset Info & Address/Account Details */}
                        <div className="flex-1 space-y-6">
                            {loading ? (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                                    Checking for existing address...
                                </div>
                            ) : depositWallet ? (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                                <div className="flex justify-between items-start mb-6">
                                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            {activeTab === 'crypto' ? 'Deposit Address' : 'Bank Account Details'}
                                        </h3>
                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 text-xs px-2 py-1 rounded-full font-medium">
                                            Active
                                        </span>
                                </div>

                                {activeTab === 'crypto' ? (
                                    <div className="space-y-6">
                                        <div className="flex justify-center bg-white dark:bg-gray-100 p-4 rounded-lg border border-gray-200 dark:border-gray-700 w-fit mx-auto">
                                                <QRCodeSVG 
                                                    value={depositWallet.address || ''} 
                                                    size={160}
                                                    level="M"
                                                    includeMargin={true}
                                                />
                                        </div>
                                        <div className="text-center text-sm text-gray-500 dark:text-gray-400 font-medium">
                                            Scan to deposit {depositWallet.asset.code}
                                        </div>

                                        <div>
                                            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Wallet Address</label>
                                            <div className="flex items-center justify-between bg-white dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600">
                                                <code className="text-sm sm:text-base font-mono text-gray-900 dark:text-white break-all">{depositWallet.address}</code>
                                                <button 
                                                        onClick={() => copyToClipboard(depositWallet.address || '')}
                                                        className="ml-3 p-2 text-gray-400 hover:text-brand-primary transition-colors shrink-0"
                                                        title="Copy address"
                                                >
                                                    {copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                                                </button>
                                            </div>
                                        </div>
                                        {depositWallet.memo && (
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Memo / Tag</label>
                                                <div className="flex items-center justify-between bg-white dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600">
                                                    <span className="font-mono text-sm sm:text-base text-gray-900 dark:text-white">{depositWallet.memo}</span>
                                                    <button 
                                                            onClick={() => copyToClipboard(depositWallet.memo || '')}
                                                            className="ml-3 p-2 text-gray-400 hover:text-brand-primary shrink-0"
                                                            title="Copy memo"
                                                    >
                                                        <Copy size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="bg-white dark:bg-gray-700 p-4 rounded border border-gray-200 dark:border-gray-600 space-y-4">
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Account Holder</label>
                                                <div className="font-medium text-gray-900 dark:text-white">{depositWallet.accountName || 'FiatX User'}</div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Bank Name</label>
                                                <div className="font-medium text-gray-900 dark:text-white">{depositWallet.bankName}</div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">IBAN</label>
                                                <div className="flex items-center justify-between">
                                                        <code className="text-lg font-mono text-gray-900 dark:text-white break-all">{depositWallet.iban}</code>
                                                        <button 
                                                            onClick={() => copyToClipboard(depositWallet.iban || '')}
                                                            className="ml-2 p-1 text-gray-400 hover:text-brand-primary shrink-0"
                                                            title="Copy IBAN"
                                                        >
                                                            {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                                                        </button>
                                                </div>
                                            </div>
                                            {depositWallet.bankCode && (
                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">SWIFT / BIC</label>
                                                    <div className="font-mono text-gray-900 dark:text-white">{depositWallet.bankCode}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                </div>
                            ) : (
                                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 h-full flex flex-col justify-center items-center">
                                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
                                        {activeTab === 'crypto' ? <Wallet size={32} /> : <Building2 size={32} />}
                                    </div>
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                                        No {activeTab === 'crypto' ? 'Deposit Address' : 'Account'} Generated
                                    </h3>
                                    <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
                                        Generate a unique {activeTab === 'crypto' ? 'deposit address' : 'bank account'} to start funding your account with {filteredAssets.find(a => a.id === selectedAssetId)?.code}.
                                    </p>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="px-6 py-3 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 font-medium"
                                    >
                                        {generating ? (
                                            <>
                                                <RefreshCw className="animate-spin" size={20} />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                Generate {activeTab === 'crypto' ? 'Address' : 'Account'}
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                            
                            {/* Simulate Button (Fixed Bottom Right of Viewport) */}
                            {depositWallet && (
                                <div className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-50">
                                    <button
                                        onClick={handleSimulatePayin}
                                        disabled={simulating}
                                        className="px-5 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-full hover:bg-gray-800 dark:hover:bg-gray-600 transition-all shadow-xl hover:shadow-2xl flex items-center gap-2 text-sm font-medium transform hover:-translate-y-1"
                                        title="Simulate a Payin for testing"
                                    >
                                        {simulating ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                                        Simulate Payin
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Instructions & Tips */}
                        <div className="lg:w-80 shrink-0">
                            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-5 border border-blue-100 dark:border-blue-900/30 h-full">
                                <div className="flex items-center gap-2 mb-4 text-blue-800 dark:text-blue-300">
                                    <Info size={20} />
                                    <h3 className="font-bold">Important Instructions</h3>
                                </div>
                                
                                {activeTab === 'crypto' ? (
                                    <div className="space-y-4 text-sm text-blue-900 dark:text-blue-200">
                                        <p>
                                            For the safety of your funds, please verify that the deposit network matches the platform supported chain.
                                        </p>
                                        <ul className="list-disc pl-4 space-y-2 text-blue-800/80 dark:text-blue-300/80">
                                            <li>Deposits typically require <strong>1-3 network confirmations</strong>.</li>
                                            <li>System will automatically process your deposit after confirmation.</li>
                                        </ul>
                                        <div className="flex gap-2 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-900/30 mt-4">
                                            <AlertTriangle size={24} className="text-amber-500 shrink-0" />
                                            <p className="text-xs text-amber-800 dark:text-amber-300">
                                                Do not deposit any other assets to this address, otherwise your assets may be permanently lost.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 text-sm text-blue-900 dark:text-blue-200">
                                        <p>
                                            Please use a bank account under your own name for the transfer.
                                        </p>
                                        <ul className="list-disc pl-4 space-y-2 text-blue-800/80 dark:text-blue-300/80">
                                            <li>
                                                Please ensure to include the <strong>Reference Number / Memo</strong> (if applicable) for faster processing.
                                            </li>
                                            <li>
                                                Arrival time is typically <strong>1-3 business days</strong>, depending on bank processing speed.
                                            </li>
                                        </ul>
                                        <div className="flex gap-2 p-3 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-blue-100 dark:border-blue-900/30 mt-4">
                                            <AlertTriangle size={24} className="text-amber-500 shrink-0" />
                                            <p className="text-xs text-amber-800 dark:text-amber-300">
                                                Transfers from third-party accounts may be rejected and refunded (fees may apply).
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-20 text-gray-400 dark:text-gray-600">
                        <ArrowRightLeft className="mx-auto mb-4 opacity-20" size={64} />
                        <p>Select an asset above to proceed</p>
                    </div>
                )}
            </>
          )}
        </div>
      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-gray-700">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Transaction Details</h3>
                    <button 
                        onClick={() => setSelectedTx(null)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-500 dark:text-gray-400"
                    >
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
                            <span className="text-gray-500 dark:text-gray-400">Transaction No</span>
                            <span className="font-mono font-medium text-gray-900 dark:text-white">{selectedTx.depositNo}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Date</span>
                            <span className="font-medium text-gray-900 dark:text-white">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                        </div>
                        {selectedTx.completedAt && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Completed</span>
                                <span className="font-medium text-gray-900 dark:text-white">{new Date(selectedTx.completedAt).toLocaleString()}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Network</span>
                            <span className="font-medium text-gray-900 dark:text-white">{selectedTx.asset.network || 'N/A'}</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-medium text-sm uppercase tracking-wider text-gray-500 dark:text-gray-400">Source Details</h4>
                        {selectedTx.fromAddress && (
                            <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">From Address</label>
                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-sm font-mono break-all border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white">
                                    {selectedTx.fromAddress}
                                </div>
                            </div>
                        )}
                        {selectedTx.fromIban && (
                            <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">From IBAN</label>
                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-sm font-mono break-all border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white">
                                    {selectedTx.fromIban}
                                </div>
                            </div>
                        )}
                        {selectedTx.txHash && (
                            <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Transaction Hash</label>
                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-sm font-mono break-all border border-gray-100 dark:border-gray-700 flex items-center justify-between text-gray-900 dark:text-white">
                                    <span>{selectedTx.txHash}</span>
                                    <button onClick={() => copyToClipboard(selectedTx.txHash!)} className="text-brand-primary">
                                        <Copy size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                        {selectedTx.referenceNo && (
                            <div>
                                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Reference Number</label>
                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-sm font-mono break-all border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white">
                                    {selectedTx.referenceNo}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-2xl">
                    <button 
                        onClick={() => setSelectedTx(null)}
                        className="w-full py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Deposit;

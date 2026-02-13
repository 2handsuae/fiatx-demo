import React, { useState, useEffect } from 'react';
import { 
  ArrowRightLeft, 
  History, 
  Info, 
  AlertTriangle, 
  RefreshCw, 
  Check, 
  X, 
  ArrowDownUp,
  ShieldCheck,
  Zap,
  TrendingUp,
  ArrowRight
} from 'lucide-react';
import { Decimal } from 'decimal.js';
import { useAuth } from '../context/AuthContext';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

interface SwapTransaction {
  id: string;
  swapNo: string;
  status: string;
  fromAsset: { code: string };
  fromAmount: string;
  toAsset: { code: string };
  toAmount: string;
  exchangeRate: string;
  createdAt: string;
  completedAt: string | null;
}

interface PreviewResult {
  fromAssetId: string;
  fromAssetCode: string;
  fromAmount: number;
  toAssetId: string;
  toAssetCode: string;
  toAmount: number;
  exchangeRate: number;
}

interface AssetBalance {
  assetId: string;
  assetCode: string;
  assetType: string;
  clientCredit: string;
  lockedBalance: string;
  walletId: string;
}

const Swap = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'swap' | 'history'>('swap');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [fromAssetId, setFromAssetId] = useState('');
  const [toAssetId, setToAssetId] = useState('');
  const [fromAmount, setFromAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [swapping, setSwapping] = useState(false);

  // Live Rate State
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Constants
  const AED_USD_RATE = 3.6725;

  // History State
  const [history, setHistory] = useState<SwapTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetchAssets();
    if (user) {
      fetchBalances();
    }
  }, [user]);

  const fetchBalances = async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/customer/${user.id}/assets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setBalances(data);
      }
    } catch (error) {
      console.error('Failed to fetch balances', error);
    }
  };

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

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/swap-transactions/my`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setHistory(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch history', error);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab]);

  const fetchBinanceRate = async (from: Asset, to: Asset) => {
    setRateLoading(true);
    setRateError(null);
    try {
      const getBinanceCode = (asset: Asset) => {
        if (asset.code === 'USD' || asset.code === 'AED') return 'USDT';
        return asset.code;
      };

      const fromCode = getBinanceCode(from);
      const toCode = getBinanceCode(to);

      let finalRate = new Decimal(1);

      if (fromCode !== toCode) {
        const pair = `${fromCode}${toCode}`;
        const reversePair = `${toCode}${fromCode}`;

        let rate: Decimal | null = null;
        
        try {
          const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
          if (resp.ok) {
            const data = await resp.json();
            rate = new Decimal(data.price);
          }
        } catch (e) {}

        if (!rate) {
          try {
            const respRev = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${reversePair}`);
            if (respRev.ok) {
              const data = await respRev.json();
              const revRate = new Decimal(data.price);
              rate = new Decimal(1).div(revRate);
            }
          } catch (e) {}
        }

        if (!rate) {
          throw new Error('Market pair not available on Binance');
        }
        
        finalRate = rate;
      }

      const aedUsdDecimal = new Decimal(AED_USD_RATE);
      if (from.code === 'AED') finalRate = finalRate.div(aedUsdDecimal);
      if (to.code === 'AED') finalRate = finalRate.mul(aedUsdDecimal);

      setLiveRate(finalRate.toNumber());
    } catch (error: any) {
      setRateError(error.message);
      setLiveRate(null);
    } finally {
      setRateLoading(false);
    }
  };

  useEffect(() => {
    const from = assets.find(a => a.id === fromAssetId);
    const to = assets.find(a => a.id === toAssetId);
    if (from && to) {
      if (from.type === 'FIAT' && to.type === 'FIAT') {
        setLiveRate(null);
        setRateError('Fiat to Fiat swap is not supported');
        return;
      }
      fetchBinanceRate(from, to);
    } else {
      setLiveRate(null);
    }
  }, [fromAssetId, toAssetId, assets]);

  const currentBalance = balances.find(b => b.assetId === fromAssetId)?.clientCredit || '0';

  const handleFromAmountChange = (value: string) => {
    if (value === '') {
      setFromAmount('');
      return;
    }

    const numValue = parseFloat(value);
    const maxBalance = parseFloat(currentBalance);

    if (numValue > maxBalance) {
      setFromAmount(currentBalance);
    } else {
      setFromAmount(value);
    }
  };

  const handleSetMax = () => {
    setFromAmount(currentBalance);
  };

  const handleSwapAssets = () => {
    const temp = fromAssetId;
    setFromAssetId(toAssetId);
    setToAssetId(temp);
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!fromAssetId || !toAssetId || !fromAmount || Number(fromAmount) <= 0) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/swap-transactions/preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fromAssetId,
          toAssetId,
          fromAmount: Number(fromAmount)
        })
      });
      if (response.ok) {
        const data = await response.json();
        setPreview(data);
        setShowConfirm(true);
      } else {
        const err = await response.json();
        alert(err.message || 'Failed to get preview');
      }
    } catch (error) {
      console.error('Preview failed', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteSwap = async () => {
    if (!preview) return;
    setSwapping(true);
    try {
      const token = localStorage.getItem('customer_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/swap-transactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fromAssetId: preview.fromAssetId,
          toAssetId: preview.toAssetId,
          fromAmount: preview.fromAmount,
          toAmount: preview.toAmount,
          ownerType: 'CUSTOMER',
          ownerId: user?.id
        })
      });
      if (response.ok) {
        alert('Swap transaction created successfully!');
        setShowConfirm(false);
        setFromAmount('');
        setPreview(null);
        setActiveTab('history');
        fetchBalances(); // Refresh balances after swap
      } else {
        const err = await response.json();
        alert(err.message || 'Swap failed');
      }
    } catch (error) {
      console.error('Swap failed', error);
    } finally {
      setSwapping(false);
    }
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      SUCCESS: 'bg-emerald-100 text-emerald-800',
      REJECTED: 'bg-red-100 text-red-800',
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Swap</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Exchange assets instantly with competitive rates</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden min-h-[500px]">
        {/* Tabs */}
        <div className="border-b border-gray-100 dark:border-gray-700">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('swap')}
              className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'swap' 
                  ? 'border-brand-primary text-brand-primary' 
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={18} />
                Swap Assets
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
                Transaction History
              </div>
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'swap' ? (
            <div className="flex flex-col lg:flex-row gap-12">
              {/* Left Side: Swap Interface */}
              <div className="flex-1 max-w-xl">
                <div className="space-y-4">
                  {/* From Asset Widget */}
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 hover:border-brand-primary/30 transition-all">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">You Sell</span>
                        {fromAssetId && (
                          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 dark:text-gray-500">
                            Available: <span className="text-brand-primary">{parseFloat(currentBalance).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                            <button 
                              onClick={handleSetMax}
                              className="ml-1 px-1.5 py-0.5 bg-brand-primary/10 text-brand-primary rounded hover:bg-brand-primary/20 transition-colors"
                            >
                              MAX
                            </button>
                          </div>
                        )}
                      </div>
                      <select
                        value={fromAssetId}
                        onChange={(e) => setFromAssetId(e.target.value)}
                        className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full px-3 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:border-brand-primary shadow-sm"
                      >
                        <option value="">Select Asset</option>
                        {assets.map(a => (
                          <option key={a.id} value={a.id}>{a.code}{a.network ? `-${a.network}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-4">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={fromAmount}
                        onChange={(e) => handleFromAmountChange(e.target.value)}
                        max={currentBalance}
                        className="flex-1 bg-transparent text-4xl font-bold text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-200 dark:placeholder:text-gray-700"
                      />
                      <div className="text-xl font-bold text-gray-400 dark:text-gray-500">
                        {assets.find(a => a.id === fromAssetId)?.code || ''}
                      </div>
                    </div>
                  </div>

                  {/* Switch Button */}
                  <div className="flex justify-center -my-6 relative z-10">
                    <button 
                      onClick={handleSwapAssets}
                      className="p-3 bg-white dark:bg-gray-800 border-4 border-white dark:border-gray-800 rounded-2xl shadow-xl hover:shadow-2xl hover:scale-110 text-brand-primary transition-all group"
                    >
                      <ArrowDownUp size={24} className="group-hover:rotate-180 transition-transform duration-500" />
                    </button>
                  </div>

                  {/* To Asset Widget */}
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 hover:border-brand-primary/30 transition-all">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">You Receive</span>
                      <select
                        value={toAssetId}
                        onChange={(e) => setToAssetId(e.target.value)}
                        className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full px-3 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 focus:outline-none focus:border-brand-primary shadow-sm"
                      >
                        <option value="">Select Asset</option>
                        {assets.map(a => (
                          <option key={a.id} value={a.id}>{a.code}{a.network ? `-${a.network}` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 text-4xl font-bold text-gray-900 dark:text-white overflow-hidden truncate">
                        {liveRate && fromAmount ? (Number(fromAmount) * liveRate).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '0.00'}
                      </div>
                      <div className="text-xl font-bold text-gray-400 dark:text-gray-500">
                        {assets.find(a => a.id === toAssetId)?.code || ''}
                      </div>
                    </div>
                  </div>

                  {/* Live Rate Info */}
                  <div className="px-2 py-1">
                    {rateLoading ? (
                      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                        <RefreshCw size={12} className="animate-spin" /> Fetching real-time Binance rate...
                      </div>
                    ) : rateError ? (
                      <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
                        <AlertTriangle size={12} /> {rateError}
                      </div>
                    ) : liveRate ? (
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="text-gray-400 dark:text-gray-500">Price:</span>
                        <span className="text-gray-900 dark:text-gray-200 font-mono">
                          1 {assets.find(a => a.id === fromAssetId)?.code} = {liveRate.toFixed(8)} {assets.find(a => a.id === toAssetId)?.code}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <button
                    onClick={handlePreview}
                    disabled={loading || !fromAssetId || !toAssetId || !fromAmount || !!rateError || rateLoading}
                    className="w-full py-5 bg-brand-primary text-white rounded-3xl font-bold text-lg hover:bg-brand-primary/90 transition-all shadow-xl shadow-brand-primary/20 disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
                    {rateError && rateError.includes('Fiat') ? 'Unsupported Pair' : 'Swap Now'}
                  </button>
                </div>
              </div>

              {/* Right Side: Educational Info */}
              <div className="lg:w-80 shrink-0">
                <div className="bg-brand-primary/5 dark:bg-brand-primary/10 rounded-2xl p-6 border border-brand-primary/10 dark:border-brand-primary/20 space-y-6">
                  <div className="flex items-center gap-2 text-brand-primary">
                    <div className="p-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-lg">
                      <Info size={24} />
                    </div>
                    <h3 className="font-bold text-lg">About Swap</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <Zap size={20} className="text-brand-primary shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">Instant Execution</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Exchange assets instantly without waiting for market orders.</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-3">
                      <TrendingUp size={20} className="text-brand-primary shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">Competitive Rates</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">We source the best rates from multiple liquidity providers.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <ShieldCheck size={20} className="text-brand-primary shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">Secure & Compliant</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">All transactions are monitored for safety and compliance.</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-brand-primary/10 dark:border-brand-primary/20">
                    <div className="flex gap-2 items-start">
                      <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                        Rates are subject to market volatility. The final amount may vary slightly from the preview if market conditions change rapidly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Transaction History Tab */
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400">Transaction No</th>
                      <th className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400">Time</th>
                      <th className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400">Swap Pair</th>
                      <th className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400">Amount</th>
                      <th className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {historyLoading ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                          <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                          Loading history...
                        </td>
                      </tr>
                    ) : history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                          <div className="flex flex-col items-center">
                            <History size={32} className="opacity-20 dark:opacity-10 mb-2" />
                            <p>No swap transactions found</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      history.map(tx => (
                        <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-gray-900 dark:text-white">{tx.swapNo}</td>
                          <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-xs">
                            <div>{new Date(tx.createdAt).toLocaleDateString('en-US')}</div>
                            <div>{new Date(tx.createdAt).toLocaleTimeString('en-US')}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                              {tx.fromAsset.code} <ArrowRight size={14} className="text-gray-400 dark:text-gray-500" /> {tx.toAsset.code}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-gray-900 dark:text-white">
                              {Number(tx.toAmount).toLocaleString('en-US')} {tx.toAsset.code}
                            </div>
                            <div className="text-[10px] text-gray-400 dark:text-gray-500">
                              From: {Number(tx.fromAmount).toLocaleString('en-US')} {tx.fromAsset.code}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {renderStatusBadge(tx.status)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && preview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-gray-700">
            <div className="p-8 space-y-8">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Confirm Swap</h3>
                <button onClick={() => setShowConfirm(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                  <X size={20} className="text-gray-400 dark:text-gray-500" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-700">
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Sell</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{preview.fromAmount} {preview.fromAssetCode}</p>
                  </div>
                  <div className="w-10 h-10 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center shadow-sm border border-gray-100 dark:border-gray-600">
                    <ArrowRight size={20} className="text-brand-primary" />
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Buy</p>
                    <p className="text-lg font-bold text-brand-primary">{preview.toAmount.toFixed(6)} {preview.toAssetCode}</p>
                  </div>
                </div>

                <div className="space-y-3 px-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">Exchange Rate</span>
                    <span className="font-mono text-gray-900 dark:text-gray-200">1 {preview.fromAssetCode} = {preview.exchangeRate.toFixed(6)} {preview.toAssetCode}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">Network Fee</span>
                    <span className="text-green-600 dark:text-green-400 font-bold">Free</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleExecuteSwap}
                disabled={swapping}
                className="w-full py-4 bg-brand-primary text-white rounded-2xl font-bold hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
              >
                {swapping ? <RefreshCw className="animate-spin" size={20} /> : <Check size={20} />}
                Confirm and Swap
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Swap;

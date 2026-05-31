import { useState, useEffect } from 'react';
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
  ArrowRight,
  Filter
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatAssetAmount, formatRate8, normalizeDecimals } from '../utils/number-format';
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
  decimals?: number | null;
}

interface SwapTransaction {
  id: string;
  swapNo: string;
  status: string;
  fromAsset: { currency: string; code: string; decimals?: number | null };
  fromAmount: string;
  toAsset: { currency: string; code: string; decimals?: number | null };
  toAmount: string;
  netToAmount?: string | null;
  feeAmount?: string | null;
  feeCurrency?: string | null;
  exchangeRate: string;
  createdAt: string;
  completedAt: string | null;
}

interface SwapMatchedInfo {
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
}

interface SwapPricingSourceInfo {
  provider: 'BINANCE';
  endpoint: 'api/v3/ticker/bookTicker';
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: 'BID' | 'INVERSE_ASK';
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
  effectiveBaseRate: string;
  fetchedAt: string;
}

interface FirmQuoteResult {
  quoteId: string;
  quoteType: 'FIRM' | 'INDICATIVE';
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
  baseCurrency: string;
  quoteCurrency: string;
  side: 'SELL_BASE' | 'BUY_BASE';
  amountType: 'EXACT_IN' | 'EXACT_OUT';
  amountIn: number;
  currencyIn: string;
  amountOut: number;
  netAmountOut: number;
  currencyOut: string;
  rateDisplay: number;
  rateAllIn: number;
  marketRate: number;
  spreadPercent: number;
  spreadBps: number;
  rateSource: string;
  fetchedAt: string;
  feeTotal: number;
  feeCurrency: string | null;
  feeBreakdown: Array<Record<string, unknown>>;
  matched?: SwapMatchedInfo | null;
  pricingSource?: SwapPricingSourceInfo | null;
}

interface LiveRateResult {
  fromAssetId: string;
  toAssetId: string;
  fromAssetCode: string;
  toAssetCode: string;
  marketRate: number;
  spreadPercent: number;
  executableRate: number;
  rateSource: 'BINANCE';
  fetchedAt: string;
  grossAmountOut: number;
  netAmountOut: number;
  feeTotal: number;
  feeCurrency: string | null;
  matched?: SwapMatchedInfo | null;
  pricingSource?: SwapPricingSourceInfo | null;
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

const Swap = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'swap' | 'history'>('swap');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [fromAssetId, setFromAssetId] = useState('');
  const [toAssetId, setToAssetId] = useState('');
  const [fromAmount, setFromAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [firmQuote, setFirmQuote] = useState<FirmQuoteResult | null>(null);
  const [quoteExpiresIn, setQuoteExpiresIn] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [swapping, setSwapping] = useState(false);

  // Live Rate State
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateMeta, setRateMeta] = useState<{
    marketRate: number;
    spreadPercent: number;
    rateSource: string;
    fetchedAt: string;
    grossAmountOut: number;
    netAmountOut: number;
    feeTotal: number;
    feeCurrency: string | null;
    matched: SwapMatchedInfo | null;
    pricingSource: SwapPricingSourceInfo | null;
  } | null>(null);

  // History State
  const [history, setHistory] = useState<SwapTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');

  useEffect(() => {
    fetchAssets();
    if (user) {
      fetchBalances();
    }
  }, [user]);

  const fetchBalances = async () => {
    if (!user) return;
    try {
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
      );
      if (response.ok) {
        const data = await response.json();
        setBalances(data);
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to fetch balances', error);
    }
  };

  const fetchAssets = async () => {
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`);
      if (response.ok) {
        const data = await response.json();
        setAssets(data.items || []);
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to fetch assets', error);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (historyStatus) params.append('status', historyStatus);
      
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/swap-transactions/my?${params.toString()}`,
      );
      if (response.ok) {
        const data = await response.json();
        setHistory(data.items || []);
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Failed to fetch history', error);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, historyStatus]);

  const fetchLiveRate = async (
    currentFromAssetId: string,
    currentToAssetId: string,
    amount: number,
    background = false,
  ) => {
    if (!background) {
      setRateLoading(true);
    }
    setRateError(null);
    try {
      const params = new URLSearchParams({
        fromAssetId: currentFromAssetId,
        toAssetId: currentToAssetId,
        amount: String(amount),
      });
      const response = await customerFetch(
        `${import.meta.env.VITE_API_URL}/swap-transactions/rate?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(
          await getCustomerApiErrorMessage(response, 'Failed to fetch real-time rate'),
        );
      }
      const data: LiveRateResult = await response.json();
      setLiveRate(data.executableRate);
      setRateMeta({
        marketRate: data.marketRate,
        spreadPercent: data.spreadPercent,
        rateSource: data.rateSource,
        fetchedAt: data.fetchedAt,
        grossAmountOut: data.grossAmountOut,
        netAmountOut: data.netAmountOut,
        feeTotal: data.feeTotal,
        feeCurrency: data.feeCurrency,
        matched: data.matched || null,
        pricingSource: data.pricingSource || null,
      });
    } catch (error: any) {
      if (error instanceof CustomerSessionError) return;
      setRateError(error.message || 'Failed to fetch real-time rate');
      setLiveRate(null);
      setRateMeta(null);
    } finally {
      if (!background) {
        setRateLoading(false);
      }
    }
  };

  useEffect(() => {
    const from = assets.find(a => a.id === fromAssetId);
    const to = assets.find(a => a.id === toAssetId);
    const parsedAmount = Number(fromAmount);
    const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (from && to) {
      if (from.type === 'FIAT' && to.type === 'FIAT') {
        setLiveRate(null);
        setRateMeta(null);
        setRateError('Fiat to Fiat swap is not supported');
      } else if (!hasValidAmount) {
        setLiveRate(null);
        setRateMeta(null);
        setRateError('输入金额后获取档位汇率');
      } else {
        fetchLiveRate(from.id, to.id, parsedAmount, false);
        intervalId = setInterval(() => {
          fetchLiveRate(from.id, to.id, parsedAmount, true);
        }, 10000);
      }
    } else {
      setLiveRate(null);
      setRateMeta(null);
      setRateError(null);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [fromAssetId, toAssetId, fromAmount, assets]);

  const currentBalance = balances.find(b => b.assetId === fromAssetId)?.available || '0';
  const fromAsset = assets.find((a) => a.id === fromAssetId);
  const toAsset = assets.find((a) => a.id === toAssetId);
  const fromAssetDecimals = normalizeDecimals(fromAsset?.decimals, 8);
  const toAssetDecimals = normalizeDecimals(toAsset?.decimals, 8);
  const getAssetDecimalsByCode = (code?: string | null) =>
    normalizeDecimals(assets.find((a) => a.code === code)?.decimals, 8);

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
    setFirmQuote(null);
  };

  const handlePreview = async () => {
    if (!fromAssetId || !toAssetId || !fromAmount || Number(fromAmount) <= 0) return;
    setLoading(true);
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/swap-transactions/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          fromAssetId,
          toAssetId,
          fromAmount: Number(fromAmount)
        })
      });
      if (response.ok) {
        const data: FirmQuoteResult = await response.json();
        const expiresInSec = Math.max(
          0,
          Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
        );
        setFirmQuote(data);
        setQuoteExpiresIn(expiresInSec);
        setShowConfirm(true);
      } else {
        alert(await getCustomerApiErrorMessage(response, 'Failed to get quote'));
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Quote creation failed', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseConfirm = async () => {
    if (firmQuote && quoteExpiresIn > 0 && firmQuote.status === 'ACTIVE') {
      try {
        await customerFetch(`${import.meta.env.VITE_API_URL}/swap-transactions/quotes/${firmQuote.quoteId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({})
        });
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
        console.error('Quote cancel failed', error);
      }
    }

    setShowConfirm(false);
    setFirmQuote(null);
    setQuoteExpiresIn(0);
  };

  const handleExecuteSwap = async () => {
    if (!firmQuote) return;
    if (quoteExpiresIn <= 0) {
      alert('Quote expired. Please request a new quote.');
      return;
    }

    setSwapping(true);
    try {
      const response = await customerFetch(`${import.meta.env.VITE_API_URL}/swap-transactions`, {
        method: 'POST',
        body: JSON.stringify({
          quoteId: firmQuote.quoteId,
        })
      });
      if (response.ok) {
        alert('Swap transaction created successfully!');
        setShowConfirm(false);
        setFromAmount('');
        setFirmQuote(null);
        setQuoteExpiresIn(0);
        setActiveTab('history');
        fetchBalances(); // Refresh balances after swap
      } else {
        const message = await getCustomerApiErrorMessage(response, 'Swap failed');
        alert(message);

        if (message.includes('Quote')) {
          setShowConfirm(false);
          setFirmQuote(null);
          setQuoteExpiresIn(0);
        }
      }
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      console.error('Swap failed', error);
    } finally {
      setSwapping(false);
    }
  };

  useEffect(() => {
    if (!showConfirm || !firmQuote) return;

    const updateCountdown = () => {
      const seconds = Math.max(
        0,
        Math.floor((new Date(firmQuote.expiresAt).getTime() - Date.now()) / 1000),
      );
      setQuoteExpiresIn(seconds);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [showConfirm, firmQuote]);

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING_COMPLIANCE: 'bg-fx-brass/10 text-fx-brass',
      UNDER_REVIEW: 'bg-fx-brass/10 text-fx-brass',
      SUCCESS: 'bg-fx-sage/15 text-fx-sage',
      REJECTED: 'bg-fx-rust/15 text-fx-rust',
      FAILED: 'bg-fx-rust/15 text-fx-rust',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-fx-ink/40 text-fx-dune'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-fx-sand">Swap</h1>
          <p className="text-fx-dune mt-1">Exchange assets instantly with competitive rates</p>
        </div>
      </div>

      <div className="min-h-[600px] bg-fx-ink/40 rounded-3xl shadow-sm border border-fx-rule overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-fx-rule">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => setActiveTab('swap')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'swap'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-brass'
              }`}
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={18} />
                Swap
              </div>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'history'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-brass'
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
          {activeTab === 'swap' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Side: Swap Interface */}
              <div className="lg:col-span-2">
                <div className="space-y-4 p-6 bg-fx-ink/40 rounded-2xl border border-fx-rule">
                  {/* From Asset Widget */}
                  <div className="bg-fx-charcoal rounded-3xl p-6 border border-fx-rule hover:border-fx-brass/30 transition-all">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-fx-dust uppercase tracking-wider">You Sell</span>
                        {fromAssetId && (
                          <div className="flex items-center gap-1 text-[10px] font-bold text-fx-dust">
                            Available: <span className="text-fx-brass">{formatAssetAmount(currentBalance, fromAssetDecimals)}</span>
                            <button
                              onClick={handleSetMax}
                              className="ml-1 px-1.5 py-0.5 bg-fx-brass/10 text-fx-brass rounded hover:bg-fx-brass/20 transition-colors"
                            >
                              MAX
                            </button>
                          </div>
                        )}
                      </div>
                      <select
                        value={fromAssetId}
                        onChange={(e) => setFromAssetId(e.target.value)}
                        className="bg-fx-charcoal text-fx-sand border border-fx-rule rounded-full px-3 py-1 text-xs font-bold focus:outline-none focus:border-fx-brass shadow-sm"
                      >
                        <option value="">Select Asset</option>
                        {assets.map(a => (
                          <option key={a.id} value={a.id}>{a.code}</option>
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
                        className="flex-1 bg-transparent text-4xl font-bold text-fx-sand focus:outline-none placeholder:text-fx-dust"
                      />
                      <div className="text-xl font-bold text-fx-dust">
                        {assets.find(a => a.id === fromAssetId)?.code || ''}
                      </div>
                    </div>
                  </div>

                  {/* Switch Button */}
                  <div className="flex justify-center -my-6 relative z-10">
                    <button 
                      onClick={handleSwapAssets}
                      className="p-3 bg-fx-brass text-fx-obsidian border-4 border-fx-rule rounded-2xl shadow-xl hover:shadow-2xl hover:scale-110 transition-all group"
                    >
                      <ArrowDownUp size={24} className="group-hover:rotate-180 transition-transform duration-500" />
                    </button>
                  </div>

                  {/* To Asset Widget */}
                  <div className="bg-fx-charcoal rounded-3xl p-6 border border-fx-rule hover:border-fx-brass/30 transition-all">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xs font-bold text-fx-dust uppercase tracking-wider">You Receive</span>
                      <select
                        value={toAssetId}
                        onChange={(e) => setToAssetId(e.target.value)}
                        className="bg-fx-charcoal text-fx-sand border border-fx-rule rounded-full px-3 py-1 text-xs font-bold focus:outline-none focus:border-fx-brass shadow-sm"
                      >
                        <option value="">Select Asset</option>
                        {assets.map(a => (
                          <option key={a.id} value={a.id}>{a.code}</option>
                        ))}
                      </select>
                    </div>
                      <div className="flex items-center gap-4">
                      <div className="flex-1 text-4xl font-bold text-fx-brass overflow-hidden truncate">
                        {rateMeta?.netAmountOut
                          ? formatAssetAmount(rateMeta.netAmountOut, toAssetDecimals)
                          : formatAssetAmount(0, toAssetDecimals)}
                      </div>
                      <div className="text-xl font-bold text-fx-dust">
                        {assets.find(a => a.id === toAssetId)?.code || ''}
                      </div>
                    </div>
                  </div>

                  {/* Live Rate Info */}
                  <div className="px-2 py-1">
                    {rateLoading ? (
                      <div className="flex items-center gap-2 text-xs text-fx-dust">
                        <RefreshCw size={12} className="animate-spin" /> Fetching real-time executable rate...
                      </div>
                    ) : rateError ? (
                      <div className="flex items-center gap-2 text-xs text-fx-rust">
                        <AlertTriangle size={12} /> {rateError}
                      </div>
                    ) : liveRate ? (
                      <div className="space-y-1 text-xs font-medium">
                        <div className="flex items-center justify-between">
                          <span className="text-fx-dust">Executable:</span>
                          <span className="text-fx-sand font-mono">
                            1 {assets.find(a => a.id === fromAssetId)?.code} = {formatRate8(liveRate)} {assets.find(a => a.id === toAssetId)?.code}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-fx-dust">
                          <span>Market:</span>
                          <span className="font-mono">{formatRate8(rateMeta?.marketRate)} | Spread: {rateMeta?.spreadPercent ?? 0}%</span>
                        </div>
                        <span className="text-[10px] text-fx-dust">
                          Source: {rateMeta?.rateSource || 'BINANCE'}
                        </span>
                        {rateMeta?.matched && (
                          <div className="flex items-center justify-between text-fx-dust">
                            <span>Matched:</span>
                            <span className="font-mono">
                              {rateMeta.matched.pairId} / {rateMeta.matched.tierId}
                            </span>
                          </div>
                        )}
                        {rateMeta?.pricingSource && (
                          <>
                            <div className="flex items-center justify-between text-fx-dust">
                              <span>Order Book:</span>
                              <span className="font-mono">
                                {rateMeta.pricingSource.symbol} ({rateMeta.pricingSource.sideUsed === 'BID' ? 'BID' : '1/ASK'})
                              </span>
                            </div>
                            <div className="text-[10px] text-fx-dust break-all">
                              Formula: {rateMeta.pricingSource.formula}
                            </div>
                          </>
                        )}
                        {rateMeta && (
                          <div className="mt-2 rounded-xl border border-fx-rule bg-fx-ink/40 p-3 space-y-1">
                            <div className="flex items-center justify-between text-fx-dune">
                              <span>Gross Receive</span>
                              <span className="font-mono text-fx-sand">
                                {formatAssetAmount(rateMeta.grossAmountOut, toAssetDecimals)} {assets.find(a => a.id === toAssetId)?.currency}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-fx-dune">
                              <span>Fee</span>
                              <span className="font-mono text-fx-sand">
                                {formatAssetAmount(rateMeta.feeTotal, getAssetDecimalsByCode(rateMeta.feeCurrency))} {rateMeta.feeCurrency || '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-fx-dune">
                              <span>Net Receive</span>
                              <span className="font-mono text-fx-sage">
                                {formatAssetAmount(rateMeta.netAmountOut, toAssetDecimals)} {assets.find(a => a.id === toAssetId)?.currency}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <button
                    onClick={handlePreview}
                    disabled={loading || !fromAssetId || !toAssetId || !fromAmount || !!rateError || rateLoading}
                    className="w-full py-5 bg-fx-brass hover:bg-fx-brass/90 text-fx-obsidian rounded-2xl font-bold text-lg transition-all shadow-xl shadow-fx-brass/20 disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
                    {rateError && rateError.includes('Fiat') ? 'Unsupported Pair' : 'Swap Now'}
                  </button>
                </div>
              </div>

              {/* Right Side: Educational Info */}
              <div className="lg:col-span-1">
                <div className="bg-fx-ink/60 rounded-2xl p-6 border border-fx-rule space-y-6 sticky top-6">
                  <div className="flex items-center gap-2 text-fx-brass">
                    <div className="p-2 bg-fx-brass/10 rounded-lg">
                      <Info size={24} />
                    </div>
                    <h3 className="font-bold text-lg">Instructions</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <Zap size={20} className="text-fx-brass shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-fx-brass">Instant Execution</h4>
                        <p className="text-xs text-fx-dust mt-1">Exchange assets instantly without waiting for market orders.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <TrendingUp size={20} className="text-fx-brass shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-fx-brass">Competitive Rates</h4>
                        <p className="text-xs text-fx-dust mt-1">Quotes are executed under the active pricing policy and current market-source snapshot.</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <ShieldCheck size={20} className="text-fx-brass shrink-0 mt-1" />
                      <div>
                        <h4 className="text-sm font-bold text-fx-brass">Secure & Compliant</h4>
                        <p className="text-xs text-fx-dust mt-1">All transactions are monitored for safety and compliance.</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-fx-charcoal/60 rounded-xl border border-fx-rule">
                    <div className="flex gap-2 items-start">
                      <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-fx-dust leading-relaxed">
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
              <div className="flex flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-2 bg-fx-charcoal px-3 py-2 rounded-lg border border-fx-rule">
                      <Filter size={16} className="text-fx-dust" />
                      <select
                        value={historyStatus}
                        onChange={(e) => setHistoryStatus(e.target.value)}
                        className="bg-transparent text-sm text-fx-sand focus:outline-none"
                      >
                          <option value="">All Status</option>
                          <option value="SUCCESS">Success</option>
                          <option value="FAILED">Failed</option>
                          <option value="PENDING_COMPLIANCE">Pending Compliance</option>
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

              <div className="overflow-x-auto rounded-lg border border-fx-rule">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-fx-rule">
                    <tr>
                      <th className="px-6 py-4 font-medium text-fx-dust">Transaction No</th>
                      <th className="px-6 py-4 font-medium text-fx-dust">Time</th>
                      <th className="px-6 py-4 font-medium text-fx-dust">Swap Pair</th>
                      <th className="px-6 py-4 font-medium text-fx-dust">Amount</th>
                      <th className="px-6 py-4 font-medium text-fx-dust">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fx-rule">
                    {historyLoading ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-fx-dust">
                          <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                          Loading history...
                        </td>
                      </tr>
                    ) : history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-fx-dust">
                          <div className="flex flex-col items-center">
                            <History size={32} className="opacity-20 mb-2" />
                            <p>No swap transactions found</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      history.map(tx => (
                        <tr key={tx.id} className="hover:bg-fx-ink/60 transition-colors">
                          <td className="px-6 py-4 font-mono text-fx-sand">{tx.swapNo}</td>
                          <td className="px-6 py-4 text-fx-dune text-xs">
                            <div>{new Date(tx.createdAt).toLocaleDateString('en-US')}</div>
                            <div>{new Date(tx.createdAt).toLocaleTimeString('en-US')}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 font-medium text-fx-sand">
                              {tx.fromAsset.code} <ArrowRight size={14} className="text-fx-dust" /> {tx.toAsset.code}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-fx-sand">
                              {formatAssetAmount(tx.netToAmount || tx.toAmount, tx.toAsset.decimals)} {tx.toAsset.currency}
                            </div>
                            <div className="text-[10px] text-fx-dust">
                              From: {formatAssetAmount(tx.fromAmount, tx.fromAsset.decimals)} {tx.fromAsset.currency}
                            </div>
                            {tx.feeAmount && Number(tx.feeAmount) > 0 && (
                              <div className="text-[10px] text-fx-dust">
                                Fee: {formatAssetAmount(tx.feeAmount, getAssetDecimalsByCode(tx.feeCurrency))} {tx.feeCurrency || ''}
                              </div>
                            )}
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
      {showConfirm && firmQuote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-fx-rule">
            <div className="p-8 space-y-8">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-fx-sand">Confirm Swap</h3>
                <button onClick={handleCloseConfirm} className="p-2 hover:bg-fx-charcoal rounded-full transition-colors">
                  <X size={20} className="text-fx-dust" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-fx-charcoal rounded-2xl border border-fx-rule">
                  <div className="space-y-1">
                    <p className="text-xs text-fx-dune uppercase font-bold tracking-wider">Sell</p>
                    <p className="text-lg font-bold text-fx-sand">
                      {formatAssetAmount(firmQuote.amountIn, getAssetDecimalsByCode(firmQuote.currencyIn))} {firmQuote.currencyIn}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-fx-charcoal rounded-full flex items-center justify-center shadow-sm border border-fx-rule">
                    <ArrowRight size={20} className="text-fx-brass" />
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-fx-dune uppercase font-bold tracking-wider">Net Receive</p>
                    <p className="text-lg font-bold text-fx-brass">
                      {formatAssetAmount(firmQuote.netAmountOut, getAssetDecimalsByCode(firmQuote.currencyOut))} {firmQuote.currencyOut}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 px-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Gross Receive</span>
                    <span className="font-mono text-fx-sand">
                      {formatAssetAmount(firmQuote.amountOut, getAssetDecimalsByCode(firmQuote.currencyOut))} {firmQuote.currencyOut}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Fee</span>
                    <span className="font-mono text-fx-sand">
                      {formatAssetAmount(firmQuote.feeTotal, getAssetDecimalsByCode(firmQuote.feeCurrency))} {firmQuote.feeCurrency || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Net Receive</span>
                    <span className="font-mono text-fx-sage">
                      {formatAssetAmount(firmQuote.netAmountOut, getAssetDecimalsByCode(firmQuote.currencyOut))} {firmQuote.currencyOut}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Exchange Rate</span>
                    <span className="font-mono text-fx-sand">1 {firmQuote.currencyIn} = {formatRate8(firmQuote.rateAllIn)} {firmQuote.currencyOut}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Market / Spread</span>
                    <span className="font-mono text-fx-sand">{formatRate8(firmQuote.marketRate)} / {firmQuote.spreadPercent}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Quote ID</span>
                    <span className="font-mono text-fx-sand">{firmQuote.quoteId}</span>
                  </div>
                  {firmQuote.matched && (
                    <div className="flex justify-between text-sm">
                      <span className="text-fx-dune font-medium">Matched Pair / Tier</span>
                      <span className="font-mono text-fx-sand">
                        {firmQuote.matched.pairId} / {firmQuote.matched.tierId}
                      </span>
                    </div>
                  )}
                  {firmQuote.pricingSource && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-fx-dune font-medium">Source Symbol / Side</span>
                        <span className="font-mono text-fx-sand">
                          {firmQuote.pricingSource.symbol} / {firmQuote.pricingSource.sideUsed === 'BID' ? 'BID' : '1/ASK'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-fx-dune font-medium text-sm">Pricing Formula</span>
                        <div className="font-mono text-[11px] text-fx-sand break-all">
                          {firmQuote.pricingSource.formula}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-fx-dune font-medium">Expires In</span>
                    <span className={`font-bold ${quoteExpiresIn > 0 ? 'text-fx-brass' : 'text-fx-rust'}`}>
                      {quoteExpiresIn > 0 ? `${quoteExpiresIn}s` : 'Expired'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleExecuteSwap}
                disabled={swapping || quoteExpiresIn <= 0}
                className="w-full py-4 bg-fx-brass hover:bg-fx-brass/90 text-fx-obsidian rounded-2xl font-bold transition-all shadow-lg shadow-fx-brass/20 flex items-center justify-center gap-2"
              >
                {swapping ? <RefreshCw className="animate-spin" size={20} /> : <Check size={20} />}
                {quoteExpiresIn > 0 ? 'Confirm and Swap' : 'Quote Expired'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Swap;

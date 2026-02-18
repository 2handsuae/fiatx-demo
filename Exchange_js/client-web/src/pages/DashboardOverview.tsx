import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, TrendingUp, TrendingDown, Lock, RefreshCw, DollarSign, ShieldCheck, History, AlertCircle, ArrowUpRight, ArrowDownRight, Coins } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Decimal } from 'decimal.js';
import { formatAssetAmount } from '../utils/number-format';

interface AssetData {
  assetId: string;
  assetCode: string;
  assetType: string;
  clientCredit: string;
  lockedBalance: string;
  walletId: string;
  assetDecimals?: number;
}

interface PlatformAsset {
  id: string;
  code: string;
  type: string;
  status: string;
  name?: string;
  decimals?: number;
}

interface MarketRate {
  code: string;
  name: string;
  price: number;
  change24h: number;
  icon: string;
}

const AED_USD_RATE = 3.6725;

const POPULAR_ASSETS = [
  { code: 'BTC', name: 'Bitcoin', icon: '₿' },
  { code: 'ETH', name: 'Ethereum', icon: 'Ξ' },
  { code: 'USDT', name: 'Tether', icon: '₮' },
  { code: 'USDC', name: 'USD Coin', icon: '$' },
  { code: 'AED', name: 'UAE Dirham', icon: 'د.إ' },
  { code: 'BNB', name: 'BNB', icon: 'B' },
  { code: 'SOL', name: 'Solana', icon: 'S' },
  { code: 'XRP', name: 'Ripple', icon: 'X' },
];

const DashboardOverview = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [platformAssets, setPlatformAssets] = useState<PlatformAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rates, setRates] = useState<Record<string, number>>({});
  const [marketRates, setMarketRates] = useState<MarketRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState('');

  const fetchAssets = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('customer_token');
      
      // Fetch platform assets (all active assets)
      const platformResponse = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (platformResponse.ok) {
        const platformData = await platformResponse.json();
        setPlatformAssets(platformData.items || []);
      }

      // Fetch user balances
      const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/customer/${user.id}/assets`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAssets(data);
        // After fetching assets, fetch their market rates
        fetchMarketRates(data);
      } else {
        setError('Failed to load asset data');
      }
    } catch (err) {
      console.error(err);
      setError('Network connection error');
    } finally {
      setLoading(false);
    }
  };

  const fetchMarketRates = useCallback(async (assetList: AssetData[]) => {
    setRatesLoading(true);
    setRatesError('');
    const newRates: Record<string, number> = {
      'USD': 1.0,
      'USDT': 1.0,
      'USDC': 1.0,
      'AED': 1 / AED_USD_RATE
    };

    const popularRates: MarketRate[] = [];

    try {
      const uniqueAssetCodes = new Set([
        ...assetList.map(a => a.assetCode),
        ...POPULAR_ASSETS.map(a => a.code)
      ]);
      
      for (const code of uniqueAssetCodes) {
        if (newRates[code] !== undefined) {
          popularRates.push({ code, name: POPULAR_ASSETS.find(p => p.code === code)?.name || code, price: newRates[code], change24h: 0, icon: POPULAR_ASSETS.find(p => p.code === code)?.icon || code.slice(0,2) });
          continue;
        }

        try {
          const pair = `${code}USDT`;
          const resp = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`);
          if (resp.ok) {
            const data = await resp.json();
            const price = parseFloat(data.lastPrice);
            const change = parseFloat(data.priceChangePercent);
            newRates[code] = price;
            const assetInfo = POPULAR_ASSETS.find(p => p.code === code);
            popularRates.push({ 
              code, 
              name: assetInfo?.name || code, 
              price, 
              change24h: change,
              icon: assetInfo?.icon || code.slice(0,2)
            });
          }
        } catch (e) {
          console.error(`Failed to fetch rate for ${code}`, e);
        }
      }

      setRates(newRates);
      setMarketRates(popularRates.sort((a, b) => b.change24h - a.change24h));
    } catch (err) {
      console.error('Error fetching market rates:', err);
      setRatesError('Failed to update market rates');
    } finally {
      setRatesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [user]);

  useEffect(() => {
    if (assets.length === 0) return;
    
    const interval = setInterval(() => {
      fetchMarketRates(assets);
    }, 30000);

    return () => clearInterval(interval);
  }, [assets, fetchMarketRates]);

  const totalValueAED = assets.reduce((acc, asset) => {
    const priceInUSD = rates[asset.assetCode] || 0;
    const balance = new Decimal(asset.clientCredit).plus(new Decimal(asset.lockedBalance));
    const valueInUSD = balance.mul(new Decimal(priceInUSD));
    const valueInAED = valueInUSD.mul(new Decimal(AED_USD_RATE));
    return acc.plus(valueInAED);
  }, new Decimal(0)).toNumber();

  const totalChange24h = marketRates.length > 0 
    ? marketRates.reduce((acc, r) => acc + r.change24h, 0) / marketRates.length 
    : 0;

  if (loading && assets.length === 0) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <RefreshCw className="animate-spin text-slate-400" size={32} />
        </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Market <span className="text-blue-600">Overview</span></h1>
            <p className="text-slate-500 font-medium mt-1 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              Real-time market data active
            </p>
        </div>
        <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
            {ratesLoading && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-blue-600 animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                Updating...
              </div>
            )}
            {ratesError && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-red-500 bg-red-50 rounded-xl">
                <AlertCircle size={14} />
                <span>Error</span>
              </div>
            )}
            <button 
              onClick={fetchAssets} 
              className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-all"
              title="Refresh"
            >
                <RefreshCw size={20} />
            </button>
        </div>
      </div>

      {/* Main Grid: Left (Assets) + Right (Market Trends) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Asset Summary + Asset Details */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* ===== Module 1: Asset Summary ===== */}
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            <div className="relative bg-slate-900 p-8 rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
              <div className="absolute top-0 right-0 p-12 opacity-5">
                <Wallet size={280} className="text-white" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-500/20 rounded-xl">
                      <Wallet className="text-blue-400" size={24} />
                    </div>
                    <span className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Total Portfolio</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 rounded-full">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400">Verified</span>
                  </div>
                </div>
                
                <div className="flex flex-col gap-1 mb-8">
                  <h2 className="text-5xl md:text-6xl font-black text-white tracking-tighter">
                    {totalValueAED.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-2xl text-blue-400 ml-3">AED</span>
                  </h2>
                  <div className={`flex items-center gap-2 mt-3 text-base font-bold ${totalChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalChange24h >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                    <span>{totalChange24h >= 0 ? '+' : ''}{totalChange24h.toFixed(2)}%</span>
                    <span className="text-slate-500 font-normal ml-2">avg 24h</span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={() => navigate('/deposit')} className="flex-1 py-4 bg-white text-slate-900 rounded-2xl font-bold text-sm hover:bg-blue-50 transition-all active:scale-95 shadow-xl">DEPOSIT</button>
                  <button onClick={() => navigate('/withdraw')} className="flex-1 py-4 bg-white/10 text-white backdrop-blur-md border border-white/10 rounded-2xl font-bold text-sm hover:bg-white/20 transition-all active:scale-95">WITHDRAW</button>
                </div>
              </div>
            </div>
          </div>

          {/* ===== Module 2: Asset Details ===== */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DollarSign className="text-blue-600" size={22} />
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">My Assets</h2>
                  <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">{platformAssets.length} assets</span>
                </div>
            </div>
            
            {error ? (
                <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertCircle size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">{error}</h3>
                    <p className="text-slate-500 text-sm">Please check your network and try again.</p>
                </div>
            ) : platformAssets.length === 0 ? (
                <div className="p-16 text-center">
                    <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Coins size={32} />
                    </div>
                    <p className="text-slate-500 font-medium">No assets available on this platform.</p>
                </div>
            ) : (
                <div className="divide-y divide-slate-100">
                    {platformAssets.map((platformAsset) => {
                      const userAsset = assets.find(a => a.assetCode === platformAsset.code);
                      const available = userAsset ? parseFloat(userAsset.clientCredit) : 0;
                      const locked = userAsset ? parseFloat(userAsset.lockedBalance) : 0;
                      const total = available + locked;
                      const amountDecimals =
                        platformAsset.decimals ?? userAsset?.assetDecimals;
                      
                      return (
                        <div key={platformAsset.id} className="px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className="w-11 h-11 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center font-bold text-slate-700 text-sm shadow-sm">
                                    {platformAsset.code.substring(0, 2)}
                                </div>
                                <div>
                                  <span className="block font-bold text-slate-900">{platformAsset.code}</span>
                                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{platformAsset.type}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-8">
                                <div className="text-right">
                                    <span className="block font-semibold text-slate-900">{formatAssetAmount(available, amountDecimals)}</span>
                                    <span className="text-[10px] text-slate-400">Available</span>
                                </div>
                                <div className="text-right min-w-[80px]">
                                    <div className="flex items-center justify-end gap-1 text-slate-500">
                                        {locked > 0 && <Lock size={12} className="text-amber-500" />}
                                        <span className="font-medium">{formatAssetAmount(locked, amountDecimals)}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400">Locked</span>
                                </div>
                                <div className="text-right min-w-[100px]">
                                    <span className="block font-bold text-slate-900">
                                        {(total * (rates[platformAsset.code] || 0) * AED_USD_RATE).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED
                                    </span>
                                </div>
                                <button 
                                    onClick={() => navigate(`/transactions?assetId=${platformAsset.id}`)}
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <History size={18} />
                                </button>
                            </div>
                        </div>
                      );
                    })}
                </div>
            )}
          </div>
        </div>

        {/* Right Column: Currency Trends */}
        <div className="space-y-6">
          {/* ===== Module 3: Currency Trends ===== */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden sticky top-6">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TrendingUp className="text-blue-600" size={22} />
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">Market Trends</h2>
                </div>
                <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">24h</span>
            </div>

            {ratesLoading && marketRates.length === 0 ? (
                <div className="p-8 flex justify-center">
                    <RefreshCw className="animate-spin text-slate-400" size={24} />
                </div>
            ) : (
                <div className="divide-y divide-slate-100">
                    {marketRates.slice(0, 8).map((rate) => (
                        <div key={rate.code} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold ${
                                    rate.code === 'BTC' ? 'bg-orange-100 text-orange-600' :
                                    rate.code === 'ETH' ? 'bg-purple-100 text-purple-600' :
                                    rate.code === 'USDT' || rate.code === 'USDC' ? 'bg-green-100 text-green-600' :
                                    'bg-slate-100 text-slate-600'
                                }`}>
                                    {rate.icon}
                                </div>
                                <div>
                                    <span className="block font-bold text-slate-900">{rate.code}</span>
                                    <span className="text-[10px] text-slate-400">{rate.name}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="block font-semibold text-slate-900">
                                    {rate.price >= 1 ? rate.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : rate.price.toFixed(6)}
                                </span>
                                <div className={`flex items-center justify-end gap-1 text-xs font-bold ${rate.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {rate.change24h >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                    {rate.change24h >= 0 ? '+' : ''}{rate.change24h.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 text-center">Powered by Binance API</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DashboardOverview;

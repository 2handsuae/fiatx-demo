import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, TrendingUp, Lock, RefreshCw, DollarSign, ShieldCheck, History, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Decimal } from 'decimal.js';

interface AssetData {
  assetId: string;
  assetCode: string;
  assetType: string;
  clientCredit: string;
  lockedBalance: string;
  walletId: string;
}

const AED_USD_RATE = 3.6725;

const DashboardOverview = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rates, setRates] = useState<Record<string, number>>({});
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState('');

  const fetchAssets = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('customer_token');
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
    if (assetList.length === 0) return;
    
    setRatesLoading(true);
    setRatesError('');
    const newRates: Record<string, number> = {
      'USD': 1.0,
      'USDT': 1.0,
      'USDC': 1.0,
      'AED': 1 / AED_USD_RATE
    };

    try {
      const uniqueAssetCodes = Array.from(new Set(assetList.map(a => a.assetCode)));
      
      const ratePromises = uniqueAssetCodes.map(async (code) => {
        // Skip if we already have it or it's a stablecoin/fiat we defined
        if (newRates[code] !== undefined) return;

        try {
          // For crypto, use Binance
          const pair = `${code}USDT`;
          const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
          if (resp.ok) {
            const data = await resp.json();
            newRates[code] = parseFloat(data.price);
          } else {
            // Try reverse pair if needed or set to 0/1 as fallback
            const revPair = `USDT${code}`;
            const revResp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${revPair}`);
            if (revResp.ok) {
              const data = await revResp.json();
              newRates[code] = 1 / parseFloat(data.price);
            } else {
              // If it's a STOCK or BOND and not on Binance, we might need another API
              // For MVP, we'll mark it as 0 or use a placeholder if unknown
              newRates[code] = 0; 
            }
          }
        } catch (e) {
          console.error(`Failed to fetch rate for ${code}`, e);
          newRates[code] = 0;
        }
      });

      await Promise.all(ratePromises);
      setRates(newRates);
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

  // Periodic refresh for rates (every 30 seconds)
  useEffect(() => {
    if (assets.length === 0) return;
    
    const interval = setInterval(() => {
      fetchMarketRates(assets);
    }, 30000);

    return () => clearInterval(interval);
  }, [assets, fetchMarketRates]);

  // Calculate total estimated value in AED
  const totalValueAED = assets.reduce((acc, asset) => {
    const priceInUSD = rates[asset.assetCode] || 0;
    const balance = new Decimal(asset.clientCredit).plus(new Decimal(asset.lockedBalance));
    const valueInUSD = balance.mul(new Decimal(priceInUSD));
    const valueInAED = valueInUSD.mul(new Decimal(AED_USD_RATE));
    return acc.plus(valueInAED);
  }, new Decimal(0)).toNumber();

  if (loading && assets.length === 0) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <RefreshCw className="animate-spin text-gray-400" size={32} />
        </div>
    );
  }

  return (
    <div className="space-y-10 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Market <span className="text-brand-primary">Overview</span></h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 flex items-center gap-2">
              <span className="w-2 h-2 bg-fin-emerald rounded-full animate-pulse"></span>
              Real-time asset tracking active
            </p>
        </div>
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            {ratesLoading && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-brand-primary animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                Updating Rates...
              </div>
            )}
            {ratesError && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-fin-rose bg-rose-50 dark:bg-rose-900/20 rounded-xl">
                <AlertCircle size={14} />
                <span>Sync Error</span>
              </div>
            )}
            <button 
              onClick={fetchAssets} 
              className="p-2.5 text-slate-400 hover:text-brand-primary hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all active:scale-95"
              title="Manual Refresh"
            >
                <RefreshCw size={20} />
            </button>
        </div>
      </div>

      {/* Hero Stats Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Total Balance Hero Card */}
        <div className="lg:col-span-2 relative group">
          <div className="absolute -inset-0.5 bg-tech-gradient rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
          <div className="relative h-full bg-slate-900 dark:bg-slate-950 p-8 rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col justify-between">
            {/* Background pattern */}
            <div className="absolute top-0 right-0 p-10 opacity-10">
              <TrendingUp size={240} className="text-white" />
            </div>
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-brand-primary/20 rounded-lg">
                  <Wallet className="text-brand-primary" size={24} />
                </div>
                <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">Total Portfolio Value</span>
              </div>
              
              <div className="flex flex-col gap-1">
                <h2 className="text-5xl md:text-6xl font-black text-white tracking-tighter fin-number">
                  {totalValueAED.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-2xl text-brand-accent ml-3">AED</span>
                </h2>
                <div className="flex items-center gap-2 mt-4 text-fin-emerald font-bold">
                  <TrendingUp size={18} />
                  <span>+2.45%</span>
                  <span className="text-slate-500 font-medium ml-2 opacity-60">vs last 24h</span>
                </div>
              </div>
            </div>

            <div className="relative z-10 flex gap-4 mt-10">
              <button onClick={() => navigate('/deposit')} className="flex-1 py-4 bg-white text-slate-950 rounded-2xl font-black text-sm hover:bg-brand-accent transition-all active:scale-95 shadow-xl">DEPOSIT</button>
              <button onClick={() => navigate('/withdraw')} className="flex-1 py-4 bg-white/10 text-white backdrop-blur-md border border-white/10 rounded-2xl font-black text-sm hover:bg-white/20 transition-all active:scale-95">WITHDRAW</button>
            </div>
          </div>
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-1 gap-6">
          <div className="tech-card p-6 flex items-center gap-5">
              <div className="p-4 bg-fin-emerald/10 text-fin-emerald rounded-2xl">
                  <ShieldCheck size={28} />
              </div>
              <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Account Security</p>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Verified</h3>
              </div>
          </div>
          <div className="tech-card p-6 flex items-center gap-5">
              <div className="p-4 bg-brand-primary/10 text-brand-primary rounded-2xl">
                  <TrendingUp size={28} />
              </div>
              <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Active Assets</p>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white fin-number">{assets.length}</h3>
              </div>
          </div>
        </div>
      </div>

      {/* Asset Table Section */}
      <div className="tech-card overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="text-brand-primary" size={24} />
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">My Digital Assets</h2>
            </div>
            <div className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              STABLE & CRYPTO
            </div>
        </div>
        
        {error ? (
            <div className="p-16 text-center">
                <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-fin-rose rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle size={40} />
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{error}</h3>
                <p className="text-slate-500 max-w-xs mx-auto">Please check your network connection and try again.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                            <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-widest">Asset</th>
                            <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Available</th>
                            <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Locked</th>
                            <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Total Balance</th>
                            <th className="px-8 py-5 text-xs font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        {assets.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-8 py-20 text-center">
                                    <p className="text-slate-400 font-medium italic">No assets detected. Fund your account to start trading.</p>
                                </td>
                            </tr>
                        ) : (
                            assets.map((asset) => (
                                <tr key={asset.assetId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center font-black text-sm text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-700 transition-transform group-hover:scale-110">
                                                {asset.assetCode.substring(0, 2)}
                                            </div>
                                            <div>
                                              <span className="block font-black text-slate-900 dark:text-white text-lg tracking-tight">{asset.assetCode}</span>
                                              <span className="text-[10px] font-black text-brand-primary bg-brand-primary/10 px-2 py-0.5 rounded-md uppercase tracking-widest">{asset.assetType}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <span className="block font-black text-slate-900 dark:text-white fin-number">
                                          {parseFloat(asset.clientCredit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                                        </span>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <div className="flex items-center justify-end gap-2 text-slate-400 fin-number">
                                            {parseFloat(asset.lockedBalance) > 0 && <Lock size={14} className="text-brand-accent animate-pulse" />}
                                            {parseFloat(asset.lockedBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <div className="flex flex-col items-end">
                                          <span className="font-black text-slate-900 dark:text-white text-lg fin-number">
                                              {(parseFloat(asset.clientCredit) + parseFloat(asset.lockedBalance)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                                          </span>
                                          <span className="text-xs font-bold text-slate-400 fin-number">
                                            ≈ {((parseFloat(asset.clientCredit) + parseFloat(asset.lockedBalance)) * (rates[asset.assetCode] || 0) * AED_USD_RATE).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED
                                          </span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <button 
                                            onClick={() => navigate(`/transactions?assetId=${asset.assetId}`)}
                                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-950 rounded-xl text-xs font-black tracking-widest transition-all hover:bg-brand-primary dark:hover:bg-brand-accent hover:text-white dark:hover:text-slate-950 active:scale-95 shadow-lg"
                                        >
                                            <History size={14} />
                                            HISTORY
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
};

export default DashboardOverview;

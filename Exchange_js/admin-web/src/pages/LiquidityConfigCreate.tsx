import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

interface LiquidityProvider {
  id: string;
  name: string;
}

const LiquidityConfigCreate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [providers, setProviders] = useState<LiquidityProvider[]>([]);

  const [formData, setFormData] = useState({
    lpId: '',
    fromAssetId: '',
    toAssetId: '',
    rateSourceType: 'API',
    spreadPercent: 0,
    feePercent: 0,
    feeFixedAmount: 0,
    minFromAmount: 0,
    maxFromAmount: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assetsRes, providersRes] = await Promise.all([
          adminFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`),
          adminFetch(`${import.meta.env.VITE_API_URL}/liquidity-providers?status=ACTIVE`)
        ]);

        if (assetsRes.ok) {
          const data = await assetsRes.json();
          setAssets(data.items || []);
        }
        if (providersRes.ok) {
          const data = await providersRes.json();
          setProviders(data.items || []);
        }
      } catch (err) {
        if (err instanceof AdminSessionError) return;
        console.error('Failed to fetch initial data', err);
      }
    };
    fetchData();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: ['spreadPercent', 'feePercent', 'feeFixedAmount', 'minFromAmount', 'maxFromAmount'].includes(name) 
        ? parseFloat(value) || 0 
        : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (formData.fromAssetId === formData.toAssetId) {
        setError('From Asset and To Asset cannot be the same');
        setLoading(false);
        return;
    }

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/liquidity-configurations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        navigate('/admin/counterparty/liquidity-config');
      } else {
        setError(await getApiErrorMessage(response, 'Failed to create configuration'));
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to create configuration', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/admin/counterparty/liquidity-config')}
          className={adminButtonClass('detailUtility', 'px-2')}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Liquidity Config</h1>
          <p className="text-sm text-gray-500 mt-1">LP routing config only (not used for customer-platform swap pricing)</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-start gap-3 text-sm">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Liquidity Provider <span className="text-red-500">*</span></label>
              <select
                name="lpId"
                value={formData.lpId}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
              >
                <option value="">Select Provider</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">From Asset <span className="text-red-500">*</span></label>
                <select
                    name="fromAssetId"
                    value={formData.fromAssetId}
                    onChange={handleChange}
                    className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    required
                >
                    <option value="">Select Asset</option>
                    {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.code} ({a.type})</option>
                    ))}
                </select>
                </div>

                <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">To Asset <span className="text-red-500">*</span></label>
                <select
                    name="toAssetId"
                    value={formData.toAssetId}
                    onChange={handleChange}
                    className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    required
                >
                    <option value="">Select Asset</option>
                    {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.code} ({a.type})</option>
                    ))}
                </select>
                </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Rate Source <span className="text-red-500">*</span></label>
              <select
                name="rateSourceType"
                value={formData.rateSourceType}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
              >
                <option value="API">API (Automatic)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Spread Percent (%)</label>
                    <input
                        type="number"
                        name="spreadPercent"
                        value={formData.spreadPercent}
                        onChange={handleChange}
                        min="0"
                        step="0.01"
                        className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Fee Percent (%)</label>
                    <input
                        type="number"
                        name="feePercent"
                        value={formData.feePercent}
                        onChange={handleChange}
                        min="0"
                        step="0.01"
                        className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Fixed Fee Amount</label>
                    <input
                        type="number"
                        name="feeFixedAmount"
                        value={formData.feeFixedAmount}
                        onChange={handleChange}
                        min="0"
                        step="0.00000001"
                        className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Min Amount</label>
                    <input
                        type="number"
                        name="minFromAmount"
                        value={formData.minFromAmount}
                        onChange={handleChange}
                        min="0"
                        className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Max Amount</label>
                    <input
                        type="number"
                        name="maxFromAmount"
                        value={formData.maxFromAmount}
                        onChange={handleChange}
                        min="0"
                        className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                    />
                </div>
            </div>

          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-admin-border">
            <button
              type="button"
              onClick={() => navigate('/admin/counterparty/liquidity-config')}
              className={adminButtonClass('modalCancel')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={adminButtonClass('modalConfirm')}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={18} />
              )}
              Create Config
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LiquidityConfigCreate;

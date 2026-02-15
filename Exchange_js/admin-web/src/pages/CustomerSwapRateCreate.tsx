import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
}

const CustomerSwapRateCreate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);

  const [formData, setFormData] = useState({
    fromAssetId: '',
    toAssetId: '',
    spreadPercent: 0,
  });

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setAssets(data.items || []);
        }
      } catch (err) {
        console.error('Failed to fetch assets', err);
      }
    };

    fetchAssets();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'spreadPercent' ? parseFloat(value) || 0 : value,
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
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/customers/swap-rates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        navigate('/dashboard/pricing/rates');
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to create configuration');
      }
    } catch (err) {
      console.error('Failed to create customer swap rate config', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/dashboard/pricing/rates')}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Customer Swap Rate Config</h1>
          <p className="text-sm text-gray-500 mt-1">Configure platform-facing rate spread for customer swap pair</p>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  From Asset <span className="text-red-500">*</span>
                </label>
                <select
                  name="fromAssetId"
                  value={formData.fromAssetId}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                  required
                >
                  <option value="">Select Asset</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} ({a.type}) {a.network ? `- ${a.network}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  To Asset <span className="text-red-500">*</span>
                </label>
                <select
                  name="toAssetId"
                  value={formData.toAssetId}
                  onChange={handleChange}
                  className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                  required
                >
                  <option value="">Select Asset</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} ({a.type}) {a.network ? `- ${a.network}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

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
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-admin-border">
            <button
              type="button"
              onClick={() => navigate('/dashboard/pricing/rates')}
              className="px-4 py-2 text-gray-700 bg-white border border-admin-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

export default CustomerSwapRateCreate;

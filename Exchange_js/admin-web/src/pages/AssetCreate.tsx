import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

const AssetCreate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    type: 'CRYPTO',
    code: '',
    network: '',
    decimals: 0,
    description: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'decimals' ? parseInt(value) || 0 : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        navigate('/dashboard/system/assets');
      } else {
        setError(await getApiErrorMessage(response, 'Failed to create asset'));
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to create asset', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/dashboard/system/assets')}
          className={adminButtonClass('detailUtility', 'px-2')}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Asset</h1>
          <p className="text-sm text-gray-500 mt-1">Add a new asset to the system</p>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Asset Type <span className="text-red-500">*</span></label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
              >
                <option value="CRYPTO">Crypto</option>
                <option value="FIAT">Fiat</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Asset Code <span className="text-red-500">*</span></label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleChange}
                placeholder="e.g. USDT, BTC"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all uppercase"
                required
                maxLength={16}
              />
              <p className="text-xs text-gray-500">Max 16 characters</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Network {formData.type === 'CRYPTO' && <span className="text-red-500">*</span>}</label>
              <input
                type="text"
                name="network"
                value={formData.network}
                onChange={handleChange}
                placeholder="e.g. TRC20, ERC20"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all uppercase"
                required={formData.type === 'CRYPTO'}
                maxLength={32}
              />
              <p className="text-xs text-gray-500">Required for Crypto assets</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Decimals <span className="text-red-500">*</span></label>
              <input
                type="number"
                name="decimals"
                value={formData.decimals}
                onChange={handleChange}
                min="0"
                max="18"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
              />
              <p className="text-xs text-gray-500">Integer between 0-18</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
              maxLength={64}
            />
            <p className="text-xs text-gray-500">Optional description (max 64 chars)</p>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-admin-border">
            <button
              type="button"
              onClick={() => navigate('/dashboard/system/assets')}
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
              Create Asset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AssetCreate;

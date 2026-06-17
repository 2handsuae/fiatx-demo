import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

const LiquidityConfigEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Read-only info
  const [configInfo, setConfigInfo] = useState<{
    lpName: string;
    fromAsset: string;
    toAsset: string;
    status: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    rateSourceType: 'API',
    spreadPercent: 0,
    feePercent: 0,
    feeFixedAmount: 0,
    minFromAmount: 0,
    maxFromAmount: 0,
  });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/liquidity-configurations/${id}`,
        );

        if (response.ok) {
          const data = await response.json();
          if (data.status !== 'INACTIVE') {
            setError('Only INACTIVE configurations can be edited.');
            setLoading(false);
            return;
          }

          setConfigInfo({
            lpName: data.lp.name,
            fromAsset: data.fromAsset.code,
            toAsset: data.toAsset.code,
            status: data.status,
          });

          setFormData({
            rateSourceType: data.rateSourceType,
            spreadPercent: Number(data.spreadPercent || 0),
            feePercent: Number(data.feePercent),
            feeFixedAmount: Number(data.feeFixedAmount),
            minFromAmount: Number(data.minFromAmount || 0),
            maxFromAmount: Number(data.maxFromAmount || 0),
          });
        } else {
          setError(await getApiErrorMessage(response, 'Failed to load configuration'));
        }
      } catch (err) {
        if (err instanceof AdminSessionError) return;
        console.error('Failed to fetch config', err);
        setError('An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchConfig();
  }, [id]);

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
    setSubmitting(true);
    setError(null);

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/liquidity-configurations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        navigate('/admin/counterparty/liquidity-config');
      } else {
        setError(await getApiErrorMessage(response, 'Failed to update configuration'));
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to update configuration', err);
      setError('An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
      return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

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
          <h1 className="text-2xl font-bold text-gray-900">Edit Liquidity Config</h1>
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

          {/* Read-only Section */}
          <div className="grid grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
            <div>
                <label className="block text-xs font-medium text-gray-500 uppercase">Provider</label>
                <div className="mt-1 text-sm font-medium text-gray-900">{configInfo?.lpName}</div>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-500 uppercase">Pair</label>
                <div className="mt-1 text-sm font-medium text-gray-900">{configInfo?.fromAsset} → {configInfo?.toAsset}</div>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-500 uppercase">Status</label>
                <div className="mt-1 text-sm font-medium text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-800">
                        {configInfo?.status}
                    </span>
                </div>
            </div>
          </div>

          <div className="space-y-6">
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
              disabled={submitting || !!error}
              className={adminButtonClass('modalConfirm')}
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={18} />
              )}
              Update Config
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LiquidityConfigEdit;

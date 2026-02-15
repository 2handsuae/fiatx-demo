import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Save } from 'lucide-react';

const CustomerSwapRateEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [configInfo, setConfigInfo] = useState<{
    fromAsset: string;
    toAsset: string;
    status: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    spreadPercent: 0,
  });

  const parseErrorMessage = (message: unknown, fallback: string) => {
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    return fallback;
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/customers/swap-rates/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const data = await response.json();
          setConfigInfo({
            fromAsset: data.fromAsset.code,
            toAsset: data.toAsset.code,
            status: data.status,
          });

          setFormData({
            spreadPercent: Number(data.spreadPercent || 0),
          });
        } else {
          setError('Failed to load configuration');
        }
      } catch (err) {
        console.error('Failed to fetch customer swap rate config', err);
        setError('An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchConfig();
    }
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setFormData({
      spreadPercent: parseFloat(value) || 0,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/customers/swap-rates/${id}`, {
        method: 'PUT',
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
        setError(
          parseErrorMessage(data?.message, 'Failed to update configuration'),
        );
      }
    } catch (err) {
      console.error('Failed to update customer swap rate config', err);
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
          onClick={() => navigate('/dashboard/pricing/rates')}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Customer Swap Rate Config</h1>
          <p className="text-sm text-gray-500 mt-1">Modify spread for customer-facing swap pair</p>
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

          <div className="grid grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase">Pair</label>
              <div className="mt-1 text-sm font-medium text-gray-900">
                {configInfo?.fromAsset} → {configInfo?.toAsset}
              </div>
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

          {configInfo?.status === 'ACTIVE' && (
            <div className="bg-amber-50 text-amber-700 p-3 rounded-lg text-sm border border-amber-100">
              This change affects live customer executable rate immediately.
            </div>
          )}

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
              disabled={submitting || !!error}
              className="flex items-center gap-2 px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

export default CustomerSwapRateEdit;

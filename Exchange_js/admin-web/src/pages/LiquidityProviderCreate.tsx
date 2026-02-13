import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';

const LiquidityProviderCreate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Filter out empty phone string to avoid validation error
    const payload = {
      ...formData,
      phone: formData.phone.trim() === '' ? undefined : formData.phone
    };

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/liquidity-providers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        navigate('/dashboard/system/liquidity-providers');
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to create provider');
      }
    } catch (err) {
      console.error('Failed to create provider', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/dashboard/system/liquidity-providers')}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Liquidity Provider</h1>
          <p className="text-sm text-gray-500 mt-1">Onboard a new liquidity partner</p>
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

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Provider Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Binance Institutional"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
                maxLength={128}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Contact Email <span className="text-red-500">*</span></label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="e.g. contact@provider.com"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Contact Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="e.g. +8613800000000"
                className="w-full px-3 py-2 bg-white border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all"
              />
              <p className="text-xs text-gray-500">Optional. Must be in E.164 format (e.g. +1234567890)</p>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-admin-border">
            <button
              type="button"
              onClick={() => navigate('/dashboard/system/liquidity-providers')}
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
              Create Provider
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LiquidityProviderCreate;

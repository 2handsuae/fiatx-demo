import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

/* ── Helpers ─────────────────────────────────────────────────── */

const fi =
  'w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

const Label = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <label className="block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">
    {children}{required && <span className="text-adm-red ml-0.5">*</span>}
  </label>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 font-mono text-[9px] text-adm-t3">{children}</p>
);

/* ── Component ───────────────────────────────────────────────── */

const AssetCreate = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    type: 'CRYPTO',
    currency: '',
    network: '',
    decimals: 18,
    description: '',
    minDepositAmount: 0,
    maxDepositAmount: 0,
    minWithdrawAmount: 0,
    maxWithdrawAmount: 0,
    depositEnabled: true,
    withdrawalEnabled: true,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]:
        type === 'checkbox' ? (e.target as HTMLInputElement).checked
        : type === 'number' || name === 'decimals' ? parseFloat(value) || 0
        : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload: Record<string, unknown> = {
      type: formData.type,
      currency: formData.currency,
      decimals: formData.decimals,
      description: formData.description || undefined,
      minDepositAmount: formData.minDepositAmount,
      maxDepositAmount: formData.maxDepositAmount,
      minWithdrawAmount: formData.minWithdrawAmount,
      maxWithdrawAmount: formData.maxWithdrawAmount,
      depositEnabled: formData.depositEnabled,
      withdrawalEnabled: formData.withdrawalEnabled,
    };
    if (formData.type === 'CRYPTO' && formData.network) {
      payload.network = formData.network;
    }

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/assets/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        navigate('/admin/assets');
      } else {
        setError(await getApiErrorMessage(response, 'Failed to create asset'));
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-adm-border bg-adm-panel px-4 py-3">
        <button
          onClick={() => navigate('/admin/assets')}
          className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="font-mono text-[12px] font-semibold text-adm-t1">Create New Asset</p>
          <p className="font-mono text-[9px] text-adm-t3">Asset will be created in PROVISIONING status</p>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-red/5 px-4 py-2.5 font-mono text-[11px] text-adm-red flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Form ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">

          {/* ① Identity */}
          <fieldset className="space-y-4">
            <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3 border-b border-adm-border pb-2">
              Asset Identity
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <Label required>Asset Type</Label>
                <select name="type" value={formData.type} onChange={handleChange} className={fi} required>
                  <option value="CRYPTO">CRYPTO</option>
                  <option value="FIAT">FIAT</option>
                </select>
              </div>
              <div>
                <Label required>Currency</Label>
                <input name="currency" value={formData.currency} onChange={handleChange} placeholder="e.g. USDT, BTC" className={`${fi} uppercase`} required maxLength={16} />
                <Hint>Max 16 characters</Hint>
              </div>
              <div>
                <Label required={formData.type === 'CRYPTO'}>Network</Label>
                <input name="network" value={formData.network} onChange={handleChange} placeholder="e.g. TRC20, ERC20" className={`${fi} uppercase`} required={formData.type === 'CRYPTO'} maxLength={32} />
                <Hint>Required for Crypto assets</Hint>
              </div>
              <div>
                <Label required>Decimals</Label>
                <input type="number" name="decimals" value={formData.decimals} onChange={handleChange} min={0} max={18} className={fi} required />
                <Hint>0–18</Hint>
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows={2} className={fi} maxLength={256} placeholder="Optional description" />
              </div>
            </div>
          </fieldset>

          {/* ② Limits */}
          <fieldset className="space-y-4">
            <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3 border-b border-adm-border pb-2">
              Deposit & Withdrawal Limits
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <Label required>Min Deposit Amount</Label>
                <input type="number" name="minDepositAmount" value={formData.minDepositAmount} onChange={handleChange} min={0} step="any" className={fi} required />
              </div>
              <div>
                <Label required>Max Deposit Amount</Label>
                <input type="number" name="maxDepositAmount" value={formData.maxDepositAmount} onChange={handleChange} min={0} step="any" className={fi} required />
                <Hint>Must be &ge; min deposit</Hint>
              </div>
              <div>
                <Label required>Min Withdraw Amount</Label>
                <input type="number" name="minWithdrawAmount" value={formData.minWithdrawAmount} onChange={handleChange} min={0} step="any" className={fi} required />
              </div>
              <div>
                <Label required>Max Withdraw Amount</Label>
                <input type="number" name="maxWithdrawAmount" value={formData.maxWithdrawAmount} onChange={handleChange} min={0} step="any" className={fi} required />
                <Hint>Must be &ge; min withdraw</Hint>
              </div>
            </div>
          </fieldset>

          {/* ③ Toggles */}
          <fieldset className="space-y-4">
            <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3 border-b border-adm-border pb-2">
              Feature Flags
            </p>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 font-mono text-[11px] text-adm-t2 cursor-pointer">
                <input type="checkbox" name="depositEnabled" checked={formData.depositEnabled} onChange={handleChange} className="accent-adm-amber" />
                Deposit Enabled
              </label>
              <label className="flex items-center gap-2 font-mono text-[11px] text-adm-t2 cursor-pointer">
                <input type="checkbox" name="withdrawalEnabled" checked={formData.withdrawalEnabled} onChange={handleChange} className="accent-adm-amber" />
                Withdrawal Enabled
              </label>
            </div>
          </fieldset>

          {/* ④ Submit */}
          <div className="flex justify-end gap-3 border-t border-adm-border pt-4">
            <button type="button" onClick={() => navigate('/admin/assets')} className={adminButtonClass('modalCancel')}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className={adminButtonClass('modalConfirm')}>
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={13} />
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

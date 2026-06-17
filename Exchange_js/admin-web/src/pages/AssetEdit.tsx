import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle, Lock } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

/* ── Helpers ─────────────────────────────────────────────────── */

const fi =
  'w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

const fiReadonly =
  'w-full rounded border border-adm-border bg-adm-bg/50 px-3 py-2 font-mono text-[11px] text-adm-t3 outline-none cursor-not-allowed';

const Label = ({ children, required, locked }: { children: React.ReactNode; required?: boolean; locked?: boolean }) => (
  <label className="flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">
    {children}
    {required && <span className="text-adm-red">*</span>}
    {locked && <Lock size={8} className="text-adm-t3" />}
  </label>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 font-mono text-[9px] text-adm-t3">{children}</p>
);

/* ── Component ───────────────────────────────────────────────── */

interface AssetData {
  id: string;
  assetNo: string | null;
  type: string;
  currency: string;
  code: string;
  network: string | null;
  decimals: number;
  description: string | null;
  status: string;
  minDepositAmount: number;
  maxDepositAmount: number;
  minWithdrawAmount: number;
  maxWithdrawAmount: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
}

const AssetEdit = () => {
  const { assetNo: assetNoParam } = useParams<{ assetNo: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Identity fields (read-only) */
  const [identity, setIdentity] = useState<{
    assetNo: string;
    type: string;
    currency: string;
    code: string;
    network: string | null;
    decimals: number;
  } | null>(null);

  /* Editable fields */
  const [formData, setFormData] = useState({
    description: '',
    minDepositAmount: 0,
    maxDepositAmount: 0,
    minWithdrawAmount: 0,
    maxWithdrawAmount: 0,
    depositEnabled: true,
    withdrawalEnabled: true,
  });

  /* ── Fetch existing asset ── */
  useEffect(() => {
    if (!assetNoParam) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${assetNoParam}`);
        if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load asset'));
        const data: AssetData = await res.json();

        if (data.status !== 'PROVISIONING') {
          setError(`Cannot edit: asset is ${data.status}. Only PROVISIONING assets can be edited.`);
          setLoading(false);
          return;
        }

        setIdentity({
          assetNo: data.assetNo || data.code,
          type: data.type,
          currency: data.currency,
          code: data.code,
          network: data.network,
          decimals: data.decimals,
        });

        setFormData({
          description: data.description || '',
          minDepositAmount: data.minDepositAmount ?? 0,
          maxDepositAmount: data.maxDepositAmount ?? 0,
          minWithdrawAmount: data.minWithdrawAmount ?? 0,
          maxWithdrawAmount: data.maxWithdrawAmount ?? 0,
          depositEnabled: data.depositEnabled ?? true,
          withdrawalEnabled: data.withdrawalEnabled ?? true,
        });
      } catch (err) {
        if (err instanceof AdminSessionError) return;
        setError(err instanceof Error ? err.message : 'Failed to load asset');
      } finally {
        setLoading(false);
      }
    })();
  }, [assetNoParam]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]:
        type === 'checkbox' ? (e.target as HTMLInputElement).checked
        : type === 'number' ? parseFloat(value) || 0
        : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity) return;
    setSaving(true);
    setError(null);

    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${identity.assetNo}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: formData.description || undefined,
            minDepositAmount: formData.minDepositAmount,
            maxDepositAmount: formData.maxDepositAmount,
            minWithdrawAmount: formData.minWithdrawAmount,
            maxWithdrawAmount: formData.maxWithdrawAmount,
            depositEnabled: formData.depositEnabled,
            withdrawalEnabled: formData.withdrawalEnabled,
          }),
        },
      );

      if (res.ok) {
        navigate(`/admin/assets/${assetNoParam}`);
      } else {
        setError(await getApiErrorMessage(res, 'Failed to update asset'));
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading asset…</p>
      </div>
    );
  }

  /* ── Error-only state (e.g. not PROVISIONING) ── */
  if (!identity) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Asset not found'}</div>
        <button onClick={() => navigate('/admin/assets')} className={adminButtonClass('detailUtility')}>
          Back to Assets
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-adm-border bg-adm-panel px-4 py-3">
        <button
          onClick={() => navigate(`/admin/assets/${assetNoParam}`)}
          className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="font-mono text-[12px] font-semibold text-adm-t1">
            Edit Asset · {identity.assetNo}
          </p>
          <p className="font-mono text-[9px] text-adm-t3">
            {identity.code} · {identity.currency} · {identity.type} · Only operational fields are editable
          </p>
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

          {/* ① Identity (read-only) */}
          <fieldset className="space-y-4">
            <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3 border-b border-adm-border pb-2">
              Asset Identity <span className="text-adm-t3 normal-case tracking-normal">— read-only, tied to TB ledger</span>
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <Label locked>Asset Type</Label>
                <input value={identity.type} readOnly className={fiReadonly} />
              </div>
              <div>
                <Label locked>Code</Label>
                <input value={identity.code} readOnly className={`${fiReadonly} uppercase`} />
              </div>
              <div>
                <Label locked>Network</Label>
                <input value={identity.network || '—'} readOnly className={`${fiReadonly} uppercase`} />
              </div>
              <div>
                <Label locked>Decimals</Label>
                <input value={identity.decimals} readOnly className={fiReadonly} />
              </div>
            </div>
          </fieldset>

          {/* ② Editable metadata */}
          <fieldset className="space-y-4">
            <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3 border-b border-adm-border pb-2">
              Metadata
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="col-span-2">
                <Label>Description</Label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows={2} className={fi} maxLength={256} placeholder="Optional description" />
              </div>
            </div>
          </fieldset>

          {/* ③ Limits */}
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

          {/* ④ Toggles */}
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

          {/* ⑤ Submit */}
          <div className="flex justify-end gap-3 border-t border-adm-border pt-4">
            <button type="button" onClick={() => navigate(`/admin/assets/${assetNoParam}`)} className={adminButtonClass('modalCancel')}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={adminButtonClass('modalConfirm')}>
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={13} />
              )}
              Save Changes
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default AssetEdit;

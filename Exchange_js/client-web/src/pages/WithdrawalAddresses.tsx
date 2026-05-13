import { useEffect, useState } from 'react';
import { AlertCircle, Plus, Clock } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';

const VITE_API_URL = import.meta.env.VITE_API_URL;

interface Asset { id: string; code: string; type: string; network: string; }
interface WithdrawalAddr {
  addressNo: string; address: string; addressType: string; network: string;
  status: string; label: string | null; activatesAt: string; activatedAt: string | null;
  counterpartyVaspName: string | null;
  asset: { code: string };
}

type View = 'list' | 'form' | 'confirmation';

export default function WithdrawalAddresses() {
  const [view, setView] = useState<View>('list');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [addresses, setAddresses] = useState<WithdrawalAddr[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [declaration, setDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastCreated, setLastCreated] = useState<WithdrawalAddr | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await customerFetch(`${VITE_API_URL}/assets?take=200`);
        if (res.ok) {
          const data = await res.json();
          const cryptoActive = ((data.items ?? data) as Asset[]).filter(a => a.type === 'CRYPTO');
          setAssets(cryptoActive);
          if (cryptoActive.length > 0) setSelectedAssetId(cryptoActive[0].id);
        }
      } catch { /* ignore */ }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!selectedAssetId) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await customerFetch(`${VITE_API_URL}/client/withdrawal-addresses?assetId=${selectedAssetId}`);
        if (res.ok) {
          const data = await res.json();
          setAddresses(data.items ?? []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    void load();
  }, [selectedAssetId, view]);

  const activeCount = addresses.filter(a => ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAdd = activeCount < 3;

  const handleSubmit = async () => {
    setError('');
    if (!newAddress.trim()) { setError('Address is required'); return; }
    if (!declaration) { setError('You must accept the ownership declaration'); return; }
    setSubmitting(true);
    try {
      const res = await customerFetch(`${VITE_API_URL}/client/withdrawal-addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: selectedAssetId, address: newAddress.trim(), ownershipDeclaration: true, label: newLabel.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to register address');
        return;
      }
      const created = await res.json();
      setLastCreated(created);
      setView('confirmation');
      setNewAddress('');
      setNewLabel('');
      setDeclaration(false);
    } catch (err: any) {
      setError(err.message || 'Failed to register address');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (addrNo: string) => {
    try {
      const res = await customerFetch(`${VITE_API_URL}/client/withdrawal-addresses/${addrNo}`, { method: 'DELETE' });
      if (res.ok) {
        setAddresses(prev => prev.map(a => a.addressNo === addrNo ? { ...a, status: 'CANCELLED' } : a));
        if (lastCreated?.addressNo === addrNo) setView('list');
      }
    } catch { /* ignore */ }
  };

  const formatCountdown = (activatesAt: string) => {
    const ms = Math.max(0, new Date(activatesAt).getTime() - Date.now());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  if (view === 'confirmation' && lastCreated) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <Clock size={24} className="text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-white">Cooling Period Active</h2>
        <p className="mt-2 text-sm text-gray-400">Your address has been registered and will be available for withdrawals after the safety cooling period expires.</p>
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-gray-900 p-4">
          <div className="text-xs text-amber-400 uppercase">Activates In</div>
          <div className="mt-1 text-2xl font-bold font-mono text-amber-400">{formatCountdown(lastCreated.activatesAt)}</div>
          <div className="mt-1 text-xs text-gray-500">{new Date(lastCreated.activatesAt).toLocaleString()}</div>
        </div>
        <div className="mt-4 rounded-lg bg-gray-900 p-3 text-left text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Address</span><span className="text-white font-mono">{lastCreated.address.slice(0, 6)}...{lastCreated.address.slice(-4)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Type</span><span className={lastCreated.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}>{lastCreated.addressType}</span></div>
          {lastCreated.label && <div className="flex justify-between"><span className="text-gray-500">Label</span><span className="text-white">{lastCreated.label}</span></div>}
        </div>
        <button onClick={() => handleCancel(lastCreated.addressNo)}
          className="mt-4 w-full rounded-lg border border-red-500/30 py-2 text-xs text-red-400 hover:bg-red-500/10">Cancel Registration</button>
        <button onClick={() => setView('list')}
          className="mt-2 w-full py-2 text-xs text-gray-400 hover:text-white">Back to Addresses</button>
      </div>
    );
  }

  if (view === 'form') {
    return (
      <div className="mx-auto max-w-md p-6">
        <button onClick={() => setView('list')} className="mb-4 text-xs text-gray-400 hover:text-white">← Back</button>
        <h2 className="text-lg font-semibold text-white mb-4">New Withdrawal Address</h2>
        {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Wallet Address</label>
            <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x..." className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-600 outline-none focus:border-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. My Ledger" className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-purple-500" />
          </div>
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-purple-300 leading-relaxed">I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action.</span>
            </label>
          </div>
          <button onClick={handleSubmit} disabled={submitting || !declaration}
            className="w-full rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">{submitting ? 'Registering...' : 'Register Address'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-4">My Withdrawal Addresses</h2>
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-1">Asset</label>
        <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white">
          {assets.map(a => <option key={a.id} value={a.id}>{a.code} — {a.network}</option>)}
        </select>
      </div>

      <div className="mb-2 text-xs text-gray-500">Registered Addresses ({activeCount}/3)</div>
      {loading ? <div className="text-center text-xs text-gray-500 py-8">Loading...</div> : (
        <div className="space-y-2 mb-4">
          {addresses.filter(a => a.status !== 'CANCELLED').map(a => (
            <div key={a.addressNo} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white">{a.label || a.address.slice(0, 10) + '...'}</div>
                  <div className="text-xs text-gray-500 font-mono">{a.address.slice(0, 6)}...{a.address.slice(-4)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${a.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}`}>{a.addressType === 'VASP' ? 'VASP' : 'Self'}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    a.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' :
                    a.status === 'PENDING_ACTIVATION' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'}`}>{a.status === 'PENDING_ACTIVATION' ? formatCountdown(a.activatesAt) : a.status}</span>
                </div>
              </div>
              {a.status === 'PENDING_ACTIVATION' && (
                <button onClick={() => handleCancel(a.addressNo)} className="mt-2 text-[10px] text-red-400 hover:underline">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setView('form')} disabled={!canAdd}
        className="w-full rounded-lg border border-dashed border-purple-500/50 py-2.5 text-sm text-purple-400 hover:bg-purple-500/5 disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus size={14} className="inline mr-1" /> Add Withdrawal Address
      </button>
      {!canAdd && <div className="mt-1 text-center text-[10px] text-gray-500">Maximum 3 addresses reached</div>}
    </div>
  );
}

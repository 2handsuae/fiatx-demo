import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { adminFetch, getApiErrorMessage, AdminSessionError } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  address: string;
  addressType: string;
  network: string;
  label: string | null;
  counterpartyVaspName: string | null;
  counterpartyVaspDid: string | null;
  ownershipDeclaredAt: string | null;
  status: string;
  activatesAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendReason: string | null;
  cancelledAt: string | null;
  traceId: string;
  createdAt: string;
  asset: { code: string; type: string };
  customer: { id: string; customerNo: string } | null;
}

export default function WithdrawalAddressDetail() {
  const { addressNo } = useParams<{ addressNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawalAddr | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendModal, setShowSuspendModal] = useState(false);

  const fetchData = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}`);
      if (res.ok) setData(await res.json());
    } catch { /* session handled globally */ }
    setLoading(false);
  };

  useEffect(() => { void fetchData(); }, [addressNo]);

  const handleSkipCooling = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/skip-cooling`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to skip cooling')); return; }
      await fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to skip cooling period');
    } finally { setActionLoading(false); }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: suspendReason }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to suspend')); return; }
      setShowSuspendModal(false);
      setSuspendReason('');
      await fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to suspend address');
    } finally { setActionLoading(false); }
  };

  if (loading) return <div className="p-6 text-adm-t3">Loading...</div>;
  if (!data) return <div className="p-6 text-adm-t3">Address not found</div>;

  const isPending = data.status === 'PENDING_ACTIVATION';
  const isActive = data.status === 'ACTIVE';
  const remaining = isPending ? Math.max(0, new Date(data.activatesAt).getTime() - Date.now()) : 0;
  const remainingHours = Math.floor(remaining / 3600000);
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000);
  const elapsed = isPending ? Math.max(0, Date.now() - new Date(data.createdAt).getTime()) : 0;
  const totalCooling = isPending ? new Date(data.activatesAt).getTime() - new Date(data.createdAt).getTime() : 1;
  const progressPct = Math.min(100, Math.round((elapsed / totalCooling) * 100));

  const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3';
  const valCls = 'text-xs text-adm-t1 mt-0.5';

  return (
    <div className="p-6">
      <button onClick={() => navigate('/withdrawal-addresses')} className="mb-3 flex items-center gap-1 text-xs text-adm-t3 hover:text-adm-t1">
        <ArrowLeft size={14} /> Withdrawal Addresses
      </button>

      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-adm-t1">{data.addressNo}</h1>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
          isPending ? 'bg-amber-500/10 text-amber-400' :
          isActive ? 'bg-emerald-500/10 text-emerald-400' :
          data.status === 'SUSPENDED' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'
        }`}>{data.status}</span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{error}</div>}

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 space-y-4">
          {/* Identity */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Identity</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className={labelCls}>Address No</div><div className={valCls}>{data.addressNo}</div></div>
              <div><div className={labelCls}>Type</div><div className={`${valCls} ${data.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}`}>{data.addressType}</div></div>
              <div className="col-span-2"><div className={labelCls}>Address</div><div className="mt-0.5 rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[11px] text-adm-t1 break-all">{data.address}</div></div>
            </div>
          </div>

          {/* Asset & Network */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Asset & Network</div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className={labelCls}>Asset</div><div className={valCls}>{data.asset.code}</div></div>
              <div><div className={labelCls}>Network</div><div className={valCls}>{data.network}</div></div>
              <div><div className={labelCls}>Label</div><div className={valCls}>{data.label || '—'}</div></div>
            </div>
          </div>

          {/* Customer */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Customer</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className={labelCls}>Customer No</div><div className={`${valCls} text-adm-blue cursor-pointer underline`}>{data.customerNo}</div></div>
              <div><div className={labelCls}>Ownership Declaration</div>
                <div className={valCls}>{data.ownershipDeclaredAt ? `✓ Declared ${new Date(data.ownershipDeclaredAt).toLocaleString()}` : '—'}</div>
              </div>
            </div>
          </div>

          {/* VASP Info */}
          {data.addressType === 'VASP' && (
            <div className="rounded-lg border border-blue-500/30 bg-adm-card p-4">
              <div className={`${labelCls} mb-3 text-blue-400`}>VASP Info</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className={labelCls}>Counterparty VASP</div><div className={valCls}>{data.counterpartyVaspName || '—'}</div></div>
                <div><div className={labelCls}>VASP DID</div><div className={`${valCls} font-mono text-[10px]`}>{data.counterpartyVaspDid || '—'}</div></div>
              </div>
            </div>
          )}

          {/* Cooling Period */}
          {isPending && (
            <div className="rounded-lg border border-amber-500/30 bg-adm-card p-4">
              <div className={`${labelCls} mb-3 text-amber-400`}>Cooling Period</div>
              <div className="grid grid-cols-3 gap-3">
                <div><div className={labelCls}>Registered At</div><div className={valCls}>{new Date(data.createdAt).toLocaleString()}</div></div>
                <div><div className={labelCls}>Activates At</div><div className={`${valCls} font-semibold text-amber-400`}>{new Date(data.activatesAt).toLocaleString()}</div></div>
                <div><div className={labelCls}>Remaining</div><div className="mt-0.5 text-sm font-bold text-amber-400">{remainingHours}h {remainingMinutes}m</div></div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-adm-border">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-adm-t3">{progressPct}% elapsed</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-[272px] space-y-5">
          {/* Actions */}
          <div>
            <div className={`${labelCls} mb-2`}>Actions</div>
            {isPending && (
              <>
                <button onClick={handleSkipCooling} disabled={actionLoading}
                  className="mb-1.5 w-full rounded-md border border-dashed border-purple-400 bg-purple-500/5 px-3 py-2 text-[11px] font-semibold text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50">
                  ⚡ Skip Cooling Period
                </button>
                <div className="mb-4 px-1 text-[9px] text-adm-t3">Simulation — immediately activates this address</div>
              </>
            )}
            {isActive && (
              <>
                <button onClick={() => setShowSuspendModal(true)} disabled={actionLoading}
                  className="w-full rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  Force Suspend
                </button>
                <div className="mt-1 px-1 text-[9px] text-adm-t3">Requires reason — compliance action</div>
              </>
            )}
            {!isPending && !isActive && (
              <div className="text-[10px] text-adm-t3">No actions available</div>
            )}
          </div>

          {/* Status */}
          <div>
            <div className={`${labelCls} mb-2`}>Status</div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-adm-t3">Status</span><span className="text-adm-t1">{data.status}</span></div>
              <div className="flex justify-between"><span className="text-adm-t3">Type</span><span className="text-adm-t1">{data.addressType}</span></div>
              <div className="flex justify-between"><span className="text-adm-t3">Network</span><span className="text-adm-t1">{data.network}</span></div>
            </div>
          </div>

          {/* Audit Trace */}
          <div>
            <div className={`${labelCls} mb-2`}>Audit Trace</div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-adm-t3">Trace ID</span><span className="text-adm-t1 font-mono text-[10px]">{data.traceId.slice(0, 8)}...{data.traceId.slice(-4)}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Suspend Modal */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-white shadow-xl">
            <div className="border-b border-adm-border px-6 py-4">
              <h2 className="text-base font-semibold text-adm-t1">Suspend Withdrawal Address</h2>
              <p className="mt-1 text-xs text-adm-t3">This will prevent the address from being used for withdrawals.</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">Reason</label>
              <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Sanctioned address identified by KYT"
                className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber h-20 resize-none" />
            </div>
            <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
              <button onClick={() => { setShowSuspendModal(false); setSuspendReason(''); }} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button onClick={handleSuspend} disabled={!suspendReason.trim() || actionLoading}
                className="rounded-md bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">Suspend</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

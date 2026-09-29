// admin-web/src/pages/LpProfileList.tsx
// 战役乙波一 Task 7：LP 档案列表——金库注册、CFO 单步批。模板：InternalTransferList.tsx
// （结构/fetch 写法）+ ComplianceRegistersPage.tsx（建档弹层写法）。铁律⑥：投影零 UUID。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface Item {
  lpNo: string;
  name: string;
  status: string;
  agreementRef: string;
  createdAt: string;
}

const RegisterLpModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: { lpNo: string; approvalNo: string }) => void;
}) => {
  const [name, setName] = useState('');
  const [fiatBankName, setFiatBankName] = useState('');
  const [fiatIban, setFiatIban] = useState('');
  const [cryptoNetwork, setCryptoNetwork] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [agreementRef, setAgreementRef] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setFiatBankName('');
    setFiatIban('');
    setCryptoNetwork('');
    setCryptoAddress('');
    setAgreementRef('');
    setReason('');
    setError('');
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!fiatBankName.trim()) { setError('Fiat bank name is required'); return; }
    if (!fiatIban.trim()) { setError('Fiat IBAN is required'); return; }
    if (!cryptoNetwork.trim()) { setError('Crypto network is required'); return; }
    if (!cryptoAddress.trim()) { setError('Crypto address is required'); return; }
    if (!agreementRef.trim()) { setError('Agreement ref is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          fiatBankName: fiatBankName.trim(),
          fiatIban: fiatIban.trim(),
          cryptoNetwork: cryptoNetwork.trim(),
          cryptoAddress: cryptoAddress.trim(),
          agreementRef: agreementRef.trim(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to register the liquidity provider')); return; }
      const data = await res.json();
      onSaved({ lpNo: data.lpNo, approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to register the liquidity provider');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Register LP</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Submitting opens an approval — CFO signs it off.</p>

        <label className="mb-3 block text-xs">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Northbridge Liquidity Ltd" />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Fiat Bank Name
            <input value={fiatBankName} onChange={(e) => setFiatBankName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
          <label className="block text-xs">Fiat IBAN
            <input value={fiatIban} onChange={(e) => setFiatIban(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Crypto Network
            <input value={cryptoNetwork} onChange={(e) => setCryptoNetwork(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. TRC20" />
          </label>
          <label className="block text-xs">Crypto Address
            <input value={cryptoAddress} onChange={(e) => setCryptoAddress(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
        </div>

        <label className="mb-3 block text-xs">Agreement Ref
          <input value={agreementRef} onChange={(e) => setAgreementRef(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="e.g. LPA-2026-014" />
        </label>

        <label className="mb-3 block text-xs">Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Why is this LP being onboarded?" />
        </label>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
};

const LpProfileList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.LP_PROFILE_CREATE);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load LP profiles')); return; }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="LP Register"
        subtitle="Liquidity provider profiles — registered by treasury, signed off by the CFO"
        meta={`${items.length} LP(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Register LP
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {notice && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          {notice}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['LP No.', 'Name', 'Status', 'Agreement Ref', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.lpNo}
                onClick={() => navigate(`/admin/lp-profiles/${encodeURIComponent(it.lpNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.lpNo}</td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="px-4 py-2">
                  <StatusPill value={it.status} />
                </td>
                <td className="px-4 py-2 font-mono">{it.agreementRef}</td>
                <td className="px-4 py-2 font-mono text-adm-t3">
                  {new Date(it.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-adm-t3">
                  No liquidity providers registered yet — click &quot;Register LP&quot; to add the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RegisterLpModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(result) => {
          setShowCreate(false);
          setNotice(`Registered ${result.lpNo} — approval ${result.approvalNo} opened, awaiting CFO.`);
          void fetchItems();
        }}
      />
    </div>
  );
};

export default LpProfileList;

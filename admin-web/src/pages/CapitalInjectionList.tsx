// admin-web/src/pages/CapitalInjectionList.tsx
// 战役乙波二 Task 6：注资单列表——金库开单、CFO 单步批。模板：LpExchangeList.tsx
// （结构/fetch/权限门控写法，同一域先例）。铁律⑥：投影零 UUID。
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

interface Item {
  cinNo: string;
  contributorName: string;
  status: string;
  assetCode: string;
  amount: string;
  createdAt: string;
}

interface AssetOption {
  id: string;
  code: string;
  currency: string;
  decimals: number;
  type: string;
}

const fi =
  'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';

const InitiateInjectionModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: { cinNo: string; approvalNo: string }) => void;
}) => {
  const [contributorName, setContributorName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [prudentialPurpose, setPrudentialPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setContributorName('');
    setAssetId('');
    setAmount('');
    setPrudentialPurpose('');
    setReason('');
    setError('');
    void (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`);
        if (res.ok) {
          const data = await res.json();
          setAssets(Array.isArray(data.items) ? data.items : []);
        }
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      }
    })();
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!contributorName.trim()) { setError('Contributor name is required'); return; }
    if (!assetId) { setError('Select an asset'); return; }
    if (!amount.trim() || Number(amount) <= 0) { setError('Amount must be greater than zero'); return; }
    if (!prudentialPurpose.trim()) { setError('Prudential purpose is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/capital-injections`, {
        method: 'POST',
        body: JSON.stringify({
          contributorName: contributorName.trim(),
          assetId,
          amount: amount.trim(),
          prudentialPurpose: prudentialPurpose.trim(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate the capital injection')); return; }
      const data = await res.json();
      onSaved({ cinNo: data.cinNo, approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to initiate the capital injection');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Initiate Capital Injection</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Submitting opens an approval — CFO signs it off.</p>

        <label className="mb-3 block text-xs">Contributor Name
          <input
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
            className={fi}
            placeholder="e.g. Acme Holdings Ltd"
          />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Asset
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={fi}>
              <option value="">Select…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.code}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${fi} font-mono`}
              placeholder="e.g. 50000"
            />
          </label>
        </div>

        <label className="mb-3 block text-xs">Prudential Purpose
          <textarea
            value={prudentialPurpose}
            onChange={(e) => setPrudentialPurpose(e.target.value)}
            rows={2}
            className={fi}
            placeholder="Prudential management purpose (required — 8-year safe-harbour record)"
          />
        </label>

        <label className="mb-3 block text-xs">Reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={fi}
            placeholder="Why is this injection being initiated?"
          />
        </label>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Initiate'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CapitalInjectionList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.CAPITAL_INJECTION_CREATE);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/capital-injections?take=200`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load capital injections')); return; }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
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
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Capital Injections"
        subtitle="Contribute funds into the firm's operating account — a runtime capital top-up"
        meta={`${items.length} injection(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Initiate injection
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {notice && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          {notice.text}
          {notice.approvalNo && (
            <>
              {' '}
              <Link to={`/admin/governance/approvals/${encodeURIComponent(notice.approvalNo)}`} className="underline hover:opacity-75">
                View approval
              </Link>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Injection No.', 'Contributor', 'Amount', 'Status', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.cinNo}
                onClick={() => navigate(`/admin/capital-injections/${encodeURIComponent(it.cinNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.cinNo}</td>
                <td className="px-4 py-2 font-mono">{it.contributorName}</td>
                <td className="px-4 py-2 font-mono">{it.amount} {it.assetCode}</td>
                <td className="px-4 py-2">
                  <StatusPill value={it.status} />
                </td>
                <td className="px-4 py-2 font-mono text-adm-t3">
                  {new Date(it.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-adm-t3">
                  No capital injections yet — click &quot;Initiate injection&quot; to open the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InitiateInjectionModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(result) => {
          setShowCreate(false);
          setNotice({ text: `Initiated ${result.cinNo} — approval ${result.approvalNo} opened, awaiting CFO.`, approvalNo: result.approvalNo });
          void fetchItems();
        }}
      />
    </div>
  );
};

export default CapitalInjectionList;

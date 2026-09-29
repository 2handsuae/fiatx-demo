// admin-web/src/pages/VendorPaymentList.tsx
// 战役乙波二 Task 7：付款单列表——金库开单（收款方从在册外包商下拉选）、CFO 单步批。
// 模板：CapitalInjectionList.tsx（结构/fetch/权限门控写法，Treasury 域最近先例）。
// 铁律⑥：投影零 UUID。
//
// 收款方下拉：GET /admin/outsourcing-vendors 返回裸数组（OutsourcingVendorsService.list()
// 直接 `rows.map(toListItem)`，不像 capital-injections/vendor-payments 列表端点那样包一层
// {items,total}）——前端按 status==='ACTIVE' 过滤后渲染 `name (vendorNo)`；该端点是金库
// （FUNDING_WRITE）/内审合规（COMPLIANCE_OFFICE_VIEW）OR 粗门（T5 已开）。
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
  payNo: string;
  vendorName: string;
  status: string;
  assetCode: string;
  amount: string;
  purposeNote: string;
  createdAt: string;
}

interface VendorOption {
  vendorNo: string;
  name: string;
  status: string;
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

const InitiatePaymentModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: { payNo: string; approvalNo: string }) => void;
}) => {
  const [vendorNo, setVendorNo] = useState('');
  const [payeeAccountRef, setPayeeAccountRef] = useState('');
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [purposeNote, setPurposeNote] = useState('');
  const [prudentialPurpose, setPrudentialPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setVendorNo('');
    setPayeeAccountRef('');
    setAssetId('');
    setAmount('');
    setPurposeNote('');
    setPrudentialPurpose('');
    setReason('');
    setError('');
    void (async () => {
      try {
        const [vendorsRes, assetsRes] = await Promise.all([
          adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors`),
          adminFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`),
        ]);
        if (vendorsRes.ok) {
          const data = await vendorsRes.json();
          const rows: VendorOption[] = Array.isArray(data) ? data : [];
          setVendors(rows.filter((v) => v.status === 'ACTIVE'));
        }
        if (assetsRes.ok) {
          const data = await assetsRes.json();
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
    if (!vendorNo) { setError('Select a payee (registered outsourcing vendor)'); return; }
    if (!payeeAccountRef.trim()) { setError('Payee account reference is required'); return; }
    if (!assetId) { setError('Select an asset'); return; }
    if (!amount.trim() || Number(amount) <= 0) { setError('Amount must be greater than zero'); return; }
    if (!purposeNote.trim()) { setError('Purpose is required'); return; }
    if (!prudentialPurpose.trim()) { setError('Prudential purpose is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/vendor-payments`, {
        method: 'POST',
        body: JSON.stringify({
          vendorNo,
          payeeAccountRef: payeeAccountRef.trim(),
          assetId,
          amount: amount.trim(),
          purposeNote: purposeNote.trim(),
          prudentialPurpose: prudentialPurpose.trim(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate the vendor payment')); return; }
      const data = await res.json();
      onSaved({ payNo: data.payNo, approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to initiate the vendor payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Initiate Vendor Payment</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Submitting opens an approval — CFO signs it off.</p>

        <label className="mb-3 block text-xs">Payee (registered outsourcing vendor)
          <select value={vendorNo} onChange={(e) => setVendorNo(e.target.value)} className={fi}>
            <option value="">Select…</option>
            {vendors.map((v) => (
              <option key={v.vendorNo} value={v.vendorNo}>{v.name} ({v.vendorNo})</option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-xs">Payee Account Reference
          <input
            value={payeeAccountRef}
            onChange={(e) => setPayeeAccountRef(e.target.value)}
            className={fi}
            placeholder="e.g. IBAN / wallet address the payment settles to"
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
              placeholder="e.g. 5000"
            />
          </label>
        </div>

        <label className="mb-3 block text-xs">Purpose
          <input
            value={purposeNote}
            onChange={(e) => setPurposeNote(e.target.value)}
            className={fi}
            placeholder="What is this payment for? (e.g. Q3 custody fee invoice #1044)"
          />
        </label>

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
            placeholder="Why is this payment being initiated?"
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

const VendorPaymentList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.VENDOR_PAYMENT_CREATE);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/vendor-payments?take=200`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load vendor payments')); return; }
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
        title="Vendor Payments"
        subtitle="Pay a registered outsourcing vendor out of the firm's operating account"
        meta={`${items.length} payment(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Initiate payment
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
              {['Payment No.', 'Payee', 'Amount', 'Purpose', 'Status', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.payNo}
                onClick={() => navigate(`/admin/vendor-payments/${encodeURIComponent(it.payNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.payNo}</td>
                <td className="px-4 py-2 font-mono">{it.vendorName}</td>
                <td className="px-4 py-2 font-mono">{it.amount} {it.assetCode}</td>
                <td className="px-4 py-2">{it.purposeNote}</td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-adm-t3">
                  No vendor payments yet — click &quot;Initiate payment&quot; to open the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InitiatePaymentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(result) => {
          setShowCreate(false);
          setNotice({ text: `Initiated ${result.payNo} — approval ${result.approvalNo} opened, awaiting CFO.`, approvalNo: result.approvalNo });
          void fetchItems();
        }}
      />
    </div>
  );
};

export default VendorPaymentList;

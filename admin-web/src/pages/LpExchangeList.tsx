// admin-web/src/pages/LpExchangeList.tsx
// 战役乙波一 Task 8：LP 兑换单列表——金库开单、CFO 单步批。模板：LpProfileList.tsx
// （结构/fetch 写法，同一域先例）。铁律⑥：投影零 UUID。
//
// 列表投影（LpExchangeView）没有 LP 名字段（只有 lpNo）——同页并行拉一次
// `/admin/lp-profiles`（全量，同 LpProfileList.tsx 自己的写法）在前端拼 lpNo→name，
// 不新开后端字段（T8 只改前端文件，不碰已冻结的 T4/T6 后端投影）。
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
  exchangeNo: string;
  lpNo: string;
  status: string;
  sellAssetCode: string;
  sellAmount: string;
  buyAssetCode: string;
  buyAmount: string;
  createdAt: string;
}

interface LpProfileOption {
  lpNo: string;
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

const InitiateExchangeModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: { exchangeNo: string; approvalNo: string }) => void;
}) => {
  const [lpNo, setLpNo] = useState('');
  const [sellAssetId, setSellAssetId] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [buyAssetId, setBuyAssetId] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [prudentialPurpose, setPrudentialPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [profiles, setProfiles] = useState<LpProfileOption[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLpNo('');
    setSellAssetId('');
    setSellAmount('');
    setBuyAssetId('');
    setBuyAmount('');
    setPrudentialPurpose('');
    setReason('');
    setError('');
    void (async () => {
      try {
        const [profileRes, assetRes] = await Promise.all([
          // GET /admin/lp-profiles 不支持 status 查询参数（controller.list() 无 @Query）——
          // 拿全量，ACTIVE 过滤在前端做（同 LpProfileList.tsx fetchItems 的调用形状）。
          adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles`),
          adminFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`),
        ]);
        if (profileRes.ok) {
          const data = await profileRes.json();
          setProfiles(Array.isArray(data) ? data.filter((p: LpProfileOption) => p.status === 'ACTIVE') : []);
        }
        if (assetRes.ok) {
          const data = await assetRes.json();
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
    if (!lpNo) { setError('Select a liquidity provider'); return; }
    if (!sellAssetId) { setError('Select the sell asset'); return; }
    if (!sellAmount.trim() || Number(sellAmount) <= 0) { setError('Sell amount must be greater than zero'); return; }
    if (!buyAssetId) { setError('Select the buy asset'); return; }
    if (!buyAmount.trim() || Number(buyAmount) <= 0) { setError('Buy amount must be greater than zero'); return; }
    if (sellAssetId === buyAssetId) { setError('The sell asset and buy asset must be different'); return; }
    if (!prudentialPurpose.trim()) { setError('Prudential purpose is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-exchanges`, {
        method: 'POST',
        body: JSON.stringify({
          lpNo,
          sellAssetId,
          sellAmount: sellAmount.trim(),
          buyAssetId,
          buyAmount: buyAmount.trim(),
          prudentialPurpose: prudentialPurpose.trim(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate the LP exchange')); return; }
      const data = await res.json();
      onSaved({ exchangeNo: data.exchangeNo, approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to initiate the LP exchange');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Initiate LP Exchange</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Submitting opens an approval — CFO signs it off.</p>

        <label className="mb-3 block text-xs">Liquidity Provider
          <select value={lpNo} onChange={(e) => setLpNo(e.target.value)} className={fi}>
            <option value="">Select an active LP…</option>
            {profiles.map((p) => (
              <option key={p.lpNo} value={p.lpNo}>{p.lpNo} · {p.name}</option>
            ))}
          </select>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Sell Asset
            <select value={sellAssetId} onChange={(e) => setSellAssetId(e.target.value)} className={fi}>
              <option value="">Select…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.code}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">Sell Amount
            <input
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              className={`${fi} font-mono`}
              placeholder="e.g. 10000"
            />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Buy Asset
            <select value={buyAssetId} onChange={(e) => setBuyAssetId(e.target.value)} className={fi}>
              <option value="">Select…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.code}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">Buy Amount
            <input
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              className={`${fi} font-mono`}
              placeholder="e.g. 2723"
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
            placeholder="Why is this exchange being initiated?"
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

const LpExchangeList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.LP_EXCHANGE_CREATE);
  const [items, setItems] = useState<Item[]>([]);
  const [lpNames, setLpNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const [exchangeRes, profileRes] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-exchanges?take=200`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles`),
      ]);
      if (!exchangeRes.ok) { alert(await getApiErrorMessage(exchangeRes, 'Failed to load LP exchanges')); return; }
      const data = await exchangeRes.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      if (profileRes.ok) {
        const profiles = await profileRes.json();
        const map = new Map<string, string>();
        if (Array.isArray(profiles)) {
          profiles.forEach((p: LpProfileOption) => map.set(p.lpNo, p.name));
        }
        setLpNames(map);
      }
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
        title="LP Exchanges"
        subtitle="Sell one asset to a liquidity provider, buy another — first pay out, then wait for delivery"
        meta={`${items.length} exchange(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Initiate exchange
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
              {['Exchange No.', 'LP', 'Sell', 'Buy', 'Status', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.exchangeNo}
                onClick={() => navigate(`/admin/lp-exchanges/${encodeURIComponent(it.exchangeNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.exchangeNo}</td>
                <td className="px-4 py-2 font-mono">
                  {lpNames.get(it.lpNo) ?? it.lpNo}
                  {lpNames.has(it.lpNo) && <span className="ml-1 text-adm-t3">({it.lpNo})</span>}
                </td>
                <td className="px-4 py-2 font-mono">{it.sellAmount} {it.sellAssetCode}</td>
                <td className="px-4 py-2 font-mono">{it.buyAmount} {it.buyAssetCode}</td>
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
                  No LP exchanges yet — click &quot;Initiate exchange&quot; to open the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InitiateExchangeModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(result) => {
          setShowCreate(false);
          setNotice({ text: `Initiated ${result.exchangeNo} — approval ${result.approvalNo} opened, awaiting CFO.`, approvalNo: result.approvalNo });
          void fetchItems();
        }}
      />
    </div>
  );
};

export default LpExchangeList;

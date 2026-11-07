// admin-web/src/pages/HouseTransferList.tsx
// 戊波二 Task 6：公司调拨单列表——金库开单（在公司自己的运营户与手续费户之间挪钱）、CFO 单步批。
// 模板：VendorPaymentList.tsx（结构 / fetch / 权限门控 / 开单后通知条写法，Treasury 域最近先例）。
// 铁律⑥：投影零 UUID，钱包只显示 walletNo。
//
// 开单弹层：用途下拉本波只有一项 Fee sweep（FEE_SWEEP）。From / To 两个下拉的数据同付款单「Pay From」
// （spec §5.3，不加端点）：GET /admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=<币种>，只留运营户 F_OPS 与
// 手续费户 F_FEE，值 = 该注册表行的 ownerUuid（下拉里只显示 walletNo，不显示 id）。To 只列「除 From 以外」的那只，
// 结算户 / 流动性户根本进不了 To 下拉——后端对不合格 to 钱包的报错话术写的是「from」，前端不去触发它。
// 默认整扫：手续费户 → 运营户，金额默认 = From 钱包的全部余额（金库可改小；后端收 0 < 金额 ≤ 余额，R15）。
// From = 手续费户且 To = 运营户时多一行提示：这笔钱走的同时，已扫走的那截手续费收入也结转进公司权益（码 90）。
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, X } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  HOUSE_TRANSFER_PURPOSE_LABEL,
  houseTransferStatusMeta,
  isFeeSweepRoute,
} from '../utils/houseTransferStatusMap';
import { isZeroAmount, minorToMajorPlain } from '../utils/reconAmount';
import { WALLET_ROLE_LABEL } from '../utils/walletRole.util';
import { formatMinorToMajor } from './companyFundsFormat';

interface Item {
  transferNo: string;
  purpose: string;
  assetCode: string;
  amount: string;
  fromWalletNo: string | null;
  toWalletNo: string | null;
  status: string;
  failureReasonCode: string | null;
  createdAt: string;
}

interface AssetOption {
  id: string;
  code: string;
  currency: string;
  decimals: number;
  type: string;
}

/** `GET /admin/tb/accounts?ownerType=WALLET&code=50` 的行（公司现金户）：ownerUuid = 钱包 id（表单提交用），
 *  walletNo / walletRole / balance（最小单位）显示用。 */
interface HouseWalletOption {
  ownerUuid: string;
  walletNo: string;
  walletRole: string;
  balance: string;
}

/** 调拨只在运营户与手续费户之间挪；手续费户排前、做默认 From（扫费 = 手续费户 → 运营户）。 */
const HOUSE_WALLET_ROLES = ['F_FEE', 'F_OPS'];

const fi =
  'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';

const InitiateHouseTransferModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (result: { transferNo: string; approvalNo: string }) => void;
}) => {
  const [purpose, setPurpose] = useState('FEE_SWEEP');
  const [assetId, setAssetId] = useState('');
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [wallets, setWallets] = useState<HouseWalletOption[]>([]);
  const [fromWalletId, setFromWalletId] = useState('');
  const [toWalletId, setToWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPurpose('FEE_SWEEP');
    setAssetId('');
    setWallets([]);
    setFromWalletId('');
    setToWalletId('');
    setAmount('');
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

  const selectedAsset = assets.find((a) => a.id === assetId);
  const selectedCurrency = selectedAsset?.currency;
  const decimals = selectedAsset?.decimals ?? 2;

  /** 选定 From：To 自动是「另一只」，金额回到 From 的全额（余额为 0 则留空，让金库自己填）。 */
  const chooseFrom = (fromId: string, list: HouseWalletOption[], assetDecimals: number) => {
    const from = list.find((w) => w.ownerUuid === fromId);
    const to = list.find((w) => w.ownerUuid !== fromId);
    setFromWalletId(from?.ownerUuid ?? '');
    setToWalletId(to?.ownerUuid ?? '');
    setAmount(from && !isZeroAmount(from.balance) ? minorToMajorPlain(from.balance, assetDecimals) : '');
  };

  // 选定资产后取该币种的公司现金户，留手续费户 / 运营户；默认 From = 手续费户、To = 运营户、金额 = 全额。
  useEffect(() => {
    setWallets([]);
    setFromWalletId('');
    setToWalletId('');
    setAmount('');
    if (!open || !selectedCurrency) return undefined;
    let stale = false;
    void (async () => {
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=${encodeURIComponent(selectedCurrency)}&take=100`,
        );
        if (!res.ok || stale) return;
        const data = await res.json();
        const rows: HouseWalletOption[] = (Array.isArray(data.items) ? data.items : [])
          .filter((r: HouseWalletOption) => HOUSE_WALLET_ROLES.includes(r.walletRole) && r.ownerUuid)
          .sort((a: HouseWalletOption, b: HouseWalletOption) => HOUSE_WALLET_ROLES.indexOf(a.walletRole) - HOUSE_WALLET_ROLES.indexOf(b.walletRole));
        setWallets(rows);
        const defaultFrom = rows.find((r) => r.walletRole === 'F_FEE') ?? rows[0];
        chooseFrom(defaultFrom?.ownerUuid ?? '', rows, assets.find((a) => a.currency === selectedCurrency)?.decimals ?? 2);
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCurrency]);

  if (!open) return null;

  const fromWallet = wallets.find((w) => w.ownerUuid === fromWalletId);
  const toWallet = wallets.find((w) => w.ownerUuid === toWalletId);
  const toOptions = wallets.filter((w) => w.ownerUuid !== fromWalletId);
  const walletLabel = (w: HouseWalletOption) =>
    `${w.walletNo} · ${WALLET_ROLE_LABEL[w.walletRole] ?? w.walletRole} · balance ${formatMinorToMajor(w.balance, decimals)} ${selectedCurrency ?? ''}`.trim();

  const submit = async () => {
    setError('');
    if (!assetId) { setError('Select an asset'); return; }
    if (!fromWalletId) { setError('Select the company wallet to move money from'); return; }
    if (!toWalletId) { setError('Select the company wallet to move money to'); return; }
    if (!amount.trim() || Number(amount) <= 0) { setError('Amount must be greater than zero'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/house-transfers`, {
        method: 'POST',
        body: JSON.stringify({
          purpose,
          assetId,
          amount: amount.trim(),
          fromWalletId,
          toWalletId,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate the house transfer')); return; }
      const data = await res.json();
      onSaved({ transferNo: data.transferNo, approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to initiate the house transfer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
          <div>
            <p className="font-mono text-[11px] font-semibold text-adm-t1">Initiate House Transfer</p>
            <p className="mt-1 font-mono text-[9px] text-adm-t3">
              Moves the firm&apos;s own money between its operating and fee wallets — submitting opens an approval, CFO signs it off.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <label className="mb-3 block text-xs">Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={fi}>
              <option value="FEE_SWEEP">{HOUSE_TRANSFER_PURPOSE_LABEL.FEE_SWEEP}</option>
            </select>
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
                placeholder="Defaults to the full From balance"
              />
            </label>
          </div>

          <label className="mb-3 block text-xs">From
            <select
              value={fromWalletId}
              onChange={(e) => chooseFrom(e.target.value, wallets, decimals)}
              className={fi}
              disabled={!assetId}
            >
              <option value="">{assetId ? 'Select…' : 'Select an asset first'}</option>
              {wallets.map((w) => (
                <option key={w.ownerUuid} value={w.ownerUuid}>{walletLabel(w)}</option>
              ))}
            </select>
          </label>

          <label className="mb-3 block text-xs">To
            <select value={toWalletId} onChange={(e) => setToWalletId(e.target.value)} className={fi} disabled={!assetId || !fromWalletId}>
              <option value="">{assetId ? 'Select…' : 'Select an asset first'}</option>
              {toOptions.map((w) => (
                <option key={w.ownerUuid} value={w.ownerUuid}>{walletLabel(w)}</option>
              ))}
            </select>
            {isFeeSweepRoute(fromWallet?.walletRole, toWallet?.walletRole) && (
              <span className="mt-1 block font-mono text-[10px] text-adm-t3">
                Fee sweep: the amount swept (capped at the fee income collected so far) is also closed from income into firm equity.
              </span>
            )}
          </label>

          <label className="mb-1 block text-xs">Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={fi}
              placeholder="Why is this transfer being initiated?"
            />
          </label>

          {error && (
            <div className="mt-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Initiate'}
          </button>
        </div>
      </div>
    </div>
  );
};

const HouseTransferList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.HOUSE_TRANSFER_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/house-transfers?take=200`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load house transfers')); return; }
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
        title="House Transfers"
        subtitle="Move the firm's own money between its operating and fee wallets — a fee sweep also closes the swept fee income into equity"
        meta={`${items.length} transfer(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Initiate transfer
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
              {['Transfer No.', 'Purpose', 'Route', 'Amount', 'Status', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const meta = houseTransferStatusMeta(it.status, it.failureReasonCode);
              return (
                <tr
                  key={it.transferNo}
                  onClick={() => navigate(`/admin/house-transfers/${encodeURIComponent(it.transferNo)}`)}
                  className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.transferNo}</td>
                  <td className="px-4 py-2">{HOUSE_TRANSFER_PURPOSE_LABEL[it.purpose] ?? it.purpose}</td>
                  <td className="px-4 py-2 font-mono">{it.fromWalletNo ?? '—'} → {it.toWalletNo ?? '—'}</td>
                  <td className="px-4 py-2 font-mono">{it.amount} {it.assetCode}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-adm-t3">
                    {new Date(it.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-adm-t3">
                  No house transfers yet — click &quot;Initiate transfer&quot; to open the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InitiateHouseTransferModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(result) => {
          setShowCreate(false);
          setNotice({ text: `Initiated ${result.transferNo} — approval ${result.approvalNo} opened, awaiting CFO.`, approvalNo: result.approvalNo });
          void fetchItems();
        }}
      />
    </div>
  );
};

export default HouseTransferList;

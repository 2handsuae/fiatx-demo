// admin-web/src/pages/LpProfileDetail.tsx
// 战役乙波一 Task 7：LP 档案详情——基本信息 + 动作区（状态×持码双维，禁加第三维）
// + 审计区。模板：InternalTransferDetail.tsx（结构/fetch/权限门控写法）。
// 铁律⑥：后端投影已无 UUID，本页类型里也不出现。
// LP 两步准入 Task 7：加「Entity Screening」背调结论区与「Payout Addresses」打款地址簿区块
// （列表行 + Register modal；条目详情在 LpPayoutAddressDetail.tsx，route-only）。
// LP 两步准入 Task 9：档案不再持有结算坐标——「Settlement Coordinates」区块与「Propose settlement
// change」入口随四坐标列一并退役，收款坐标只在打款地址簿里。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField, InfoSlot } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { ScreeningBadge } from '../components/ui/AddressBadges';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

interface Detail {
  lpNo: string;
  name: string;
  agreementRef: string;
  status: string;
  approvalNo: string | null;
  /** 建档时刻的实体背调结论与尽调档案引用号 */
  screeningAnswer: string | null;
  screenedAt: string | null;
  dueDiligenceRef: string | null;
  createdBy: string;
  createdAt: string;
}

interface PayoutAddress {
  addressNo: string;
  assetCode: string | null;
  network: string | null;
  address: string | null;
  iban: string | null;
  label: string | null;
  status: string;
  screeningAnswer: string | null;
  createdAt: string;
}

interface AssetOption {
  id: string;
  code: string;
  type: string;
  network: string;
}

const fi = 'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';

/** 列表里的坐标摘要：链上 = network · address，法币 = IBAN。 */
const coordinateSummary = (a: PayoutAddress): string =>
  a.iban ? a.iban : `${a.network ?? ''} · ${a.address ?? ''}`;

const RegisterPayoutAddressModal = ({
  open,
  lpNo,
  lpName,
  onClose,
  onSaved,
}: {
  open: boolean;
  lpNo: string;
  lpName: string;
  onClose: () => void;
  onSaved: (result: { addressNo: string; approvalNo: string | null; status: string }) => void;
}) => {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetId, setAssetId] = useState('');
  const [address, setAddress] = useState('');
  const [declaredHosting, setDeclaredHosting] = useState('');
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [swiftBic, setSwiftBic] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAssetId('');
    setAddress('');
    setDeclaredHosting('');
    setIban('');
    setBankName('');
    setSwiftBic('');
    setEvidenceRef('');
    setLabel('');
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

  // 坐标组跟资产类型走：CRYPTO → 链上组（network 由资产带出、只读，address 手填），其余 → IBAN 组。
  const asset = assets.find((a) => a.id === assetId);

  const submit = async () => {
    setError('');
    if (!asset) { setError('Select the asset this address is registered for'); return; }
    const isCrypto = asset.type === 'CRYPTO';
    if (isCrypto) {
      if (!address.trim()) { setError('Address is required'); return; }
      if (!declaredHosting) { setError('Declared hosting is required for an on-chain address'); return; }
    } else if (!iban.trim()) { setError('IBAN is required'); return; }
    if (!evidenceRef.trim()) { setError('Evidence ref is required'); return; }
    setSubmitting(true);
    try {
      const coordinate: Record<string, string> = isCrypto
        ? { network: asset.network, address: address.trim(), declaredHosting }
        : {
          iban: iban.trim(),
          ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
          ...(swiftBic.trim() ? { swiftBic: swiftBic.trim() } : {}),
        };
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(lpNo)}/payout-addresses`,
        {
          method: 'POST',
          body: JSON.stringify({
            assetId: asset.id,
            ...coordinate,
            evidenceRef: evidenceRef.trim(),
            ...(label.trim() ? { label: label.trim() } : {}),
          }),
        },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to register the payout address')); return; }
      const data = await res.json();
      onSaved({ addressNo: data.addressNo, approvalNo: data.approvalNo ?? null, status: data.status });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to register the payout address');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="max-h-[85vh] w-[560px] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Register Payout Address</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">
          {lpNo} · {lpName} — the address is screened on entry (RED is rejected on the spot); otherwise the CFO signs it off.
        </p>

        <label className="mb-3 block text-xs">Asset
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={fi}>
            <option value="">Select an asset…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.code}</option>
            ))}
          </select>
        </label>

        {asset?.type === 'CRYPTO' && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block text-xs">Network (from the asset)
                <input value={asset.network} readOnly className={`${fi} cursor-not-allowed bg-adm-card text-adm-t2`} />
              </label>
              <label className="block text-xs">Declared Hosting
                <select value={declaredHosting} onChange={(e) => setDeclaredHosting(e.target.value)} className={fi}>
                  <option value="">Select…</option>
                  <option value="SELF_CUSTODY">Self-Custody</option>
                  <option value="VASP">VASP</option>
                </select>
              </label>
            </div>
            <label className="mb-3 block text-xs">Address
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={`${fi} font-mono`} placeholder="On-chain address of the LP" />
            </label>
          </>
        )}

        {asset && asset.type !== 'CRYPTO' && (
          <>
            <label className="mb-3 block text-xs">IBAN
              <input value={iban} onChange={(e) => setIban(e.target.value)} className={`${fi} font-mono`} placeholder="e.g. AE07 0331 2345 6789 0123 456" />
            </label>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="block text-xs">Bank Name (optional)
                <input value={bankName} onChange={(e) => setBankName(e.target.value)} className={fi} />
              </label>
              <label className="block text-xs">SWIFT / BIC (optional)
                <input value={swiftBic} onChange={(e) => setSwiftBic(e.target.value)} className={`${fi} font-mono`} />
              </label>
            </div>
          </>
        )}

        <label className="mb-3 block text-xs">Evidence Ref
          <input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} className={`${fi} font-mono`} placeholder="Agreement clause / contract attachment proving the LP owns this coordinate" />
        </label>

        <label className="mb-3 block text-xs">Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={fi} placeholder="e.g. Primary USDT payout" />
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

const LpProfileDetail = () => {
  const { lpNo } = useParams<{ lpNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canSuspend = hasPermission(PERMISSIONS.LP_PROFILE_SUSPEND);
  const canReactivate = hasPermission(PERMISSIONS.LP_PROFILE_REACTIVATE);
  const canReadAddresses = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESSES_READ);
  const canRegisterAddress = hasPermission(PERMISSIONS.LP_PAYOUT_ADDRESS_CREATE);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [addresses, setAddresses] = useState<PayoutAddress[]>([]);
  const [showRegisterAddress, setShowRegisterAddress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchDetail = async () => {
    if (!lpNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(lpNo)}`);
      if (res.ok) setDetail((await res.json()) as Detail);
      else {
        alert(await getApiErrorMessage(res, 'Failed to load LP profile'));
        navigate('/admin/lp-profiles');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAddresses = async () => {
    if (!lpNo || !canReadAddresses) return;
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(lpNo)}/payout-addresses`);
      if (res.ok) {
        const data = await res.json();
        setAddresses(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchDetail(), fetchAddresses()]);
  };

  useEffect(() => {
    if (lpNo) void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const suspend = async () => {
    if (!detail) return;
    const reason = window.prompt('Suspension reason (required)');
    if (!reason?.trim()) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(detail.lpNo)}/suspend`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to suspend the liquidity provider')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setWorking(false);
    }
  };

  const reactivate = async () => {
    if (!detail) return;
    const reason = window.prompt('Reactivation reason (required)');
    if (!reason?.trim()) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(detail.lpNo)}/reactivate`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to reactivate the liquidity provider')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setWorking(false);
    }
  };

  if (loading && !detail)
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading LP profile...</p>
      </div>
    );
  if (!detail) return null;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Liquidity Provider"
        subtitle={detail.lpNo}
        onBack={() => navigate('/admin/lp-profiles')}
        onRefresh={() => void refreshAll()}
        refreshing={loading}
        backLabel="LP Register"
      >
        <StatusPill value={detail.status} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.lpNo }} />
        {detail.status === 'ACTIVE' && canSuspend && (
          <button type="button" disabled={working} onClick={() => void suspend()} className={adminButtonClass('workflowNegative')}>
            Suspend
          </button>
        )}
        {detail.status === 'SUSPENDED' && canReactivate && (
          <button type="button" disabled={working} onClick={() => void reactivate()} className={adminButtonClass('workflowPrimary')}>
            Reactivate
          </button>
        )}
      </DetailPageHeader>

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

      {detail.status === 'PENDING_APPROVAL' && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Pending CFO review — read-only until decided.
        </div>
      )}

      {detail.status === 'REJECTED' && detail.screeningAnswer === 'RED' && (
        <div className="border-b border-adm-border bg-adm-red/10 px-5 py-2 font-mono text-[11px] text-adm-red">
          Entity screening returned RED at registration — rejected on the spot, no approval was opened.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Liquidity Provider" columns={3}>
            <InfoField label="Name" value={detail.name} />
            <InfoField label="Agreement Ref" value={detail.agreementRef} mono />
            <InfoField
              label="Approval"
              value={detail.approvalNo}
              mono
              link={detail.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}` : undefined}
            />
          </DetailCard>

          <DetailCard title="Entity Screening" columns={3}>
            <InfoSlot label="Verdict">
              {detail.screeningAnswer ? <ScreeningBadge answer={detail.screeningAnswer} /> : <span className="text-adm-t3">—</span>}
            </InfoSlot>
            <InfoField label="Screened At" value={detail.screenedAt ? new Date(detail.screenedAt).toLocaleString() : null} mono />
            <InfoField label="Due Diligence Ref" value={detail.dueDiligenceRef} mono />
          </DetailCard>

          {canReadAddresses && (
            <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-panel shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                  Payout Addresses
                </span>
                {detail.status === 'ACTIVE' && canRegisterAddress && (
                  <button type="button" onClick={() => setShowRegisterAddress(true)} className={adminButtonClass('detailUtility')}>
                    <Plus size={13} /> Register address
                  </button>
                )}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-adm-border text-left text-adm-t3">
                    {['Address No.', 'Asset', 'Coordinates', 'Label', 'Status', 'Screening'].map((h) => (
                      <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((a) => (
                    <tr
                      key={a.addressNo}
                      onClick={() => navigate(`/admin/lp-payout-addresses/${encodeURIComponent(a.addressNo)}`)}
                      className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
                    >
                      <td className="px-4 py-2 font-mono text-adm-blue">{a.addressNo}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{a.assetCode ?? '—'}</td>
                      <td className="max-w-[260px] truncate px-4 py-2 font-mono text-[10px] text-adm-t2" title={coordinateSummary(a)}>
                        {coordinateSummary(a)}
                      </td>
                      <td className="px-4 py-2 text-adm-t2">{a.label ?? '—'}</td>
                      <td className="px-4 py-2"><AdminBadge value={a.status} /></td>
                      <td className="px-4 py-2">
                        {a.screeningAnswer ? <ScreeningBadge answer={a.screeningAnswer} /> : <span className="text-adm-t3">—</span>}
                      </td>
                    </tr>
                  ))}
                  {addresses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-adm-t3">
                        {detail.status === 'ACTIVE'
                          ? 'No payout addresses yet — register one so LP exchange orders have a destination to pay out to'
                          : 'Payout addresses can be registered once the profile is ACTIVE'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>

        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV
              label="Created"
              value={`${detail.createdBy} · ${new Date(detail.createdAt).toLocaleString()}`}
            />
          </SidebarGroup>
        </aside>
      </div>

      <RegisterPayoutAddressModal
        open={showRegisterAddress}
        lpNo={detail.lpNo}
        lpName={detail.name}
        onClose={() => setShowRegisterAddress(false)}
        onSaved={(result) => {
          setShowRegisterAddress(false);
          setNotice(
            result.approvalNo
              ? { text: `Registered ${result.addressNo} — awaiting CFO.`, approvalNo: result.approvalNo }
              : { text: `Registered ${result.addressNo} — address screening came back RED, rejected on the spot (no approval opened).` },
          );
          void fetchAddresses();
        }}
      />
    </div>
  );
};

export default LpProfileDetail;

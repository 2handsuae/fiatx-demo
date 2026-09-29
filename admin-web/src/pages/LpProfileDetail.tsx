// admin-web/src/pages/LpProfileDetail.tsx
// 战役乙波一 Task 7：LP 档案详情——基本信息 + 结算坐标 + 动作区（状态×持码双维，禁加第三维）
// + 审计区。模板：InternalTransferDetail.tsx（结构/fetch/权限门控写法）。
// 铁律⑥：后端投影已无 UUID，本页类型里也不出现。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
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
  fiatBankName: string;
  fiatIban: string;
  cryptoNetwork: string;
  cryptoAddress: string;
  agreementRef: string;
  status: string;
  approvalNo: string | null;
  createdBy: string;
  createdAt: string;
}

const ProposeSettlementChangeModal = ({
  open,
  detail,
  onClose,
  onSaved,
}: {
  open: boolean;
  detail: Detail | null;
  onClose: () => void;
  onSaved: (result: { approvalNo: string }) => void;
}) => {
  const [fiatBankName, setFiatBankName] = useState('');
  const [fiatIban, setFiatIban] = useState('');
  const [cryptoNetwork, setCryptoNetwork] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !detail) return;
    setFiatBankName(detail.fiatBankName);
    setFiatIban(detail.fiatIban);
    setCryptoNetwork(detail.cryptoNetwork);
    setCryptoAddress(detail.cryptoAddress);
    setReason('');
    setError('');
  }, [open, detail]);

  if (!open || !detail) return null;

  const submit = async () => {
    setError('');
    if (!fiatBankName.trim()) { setError('Fiat bank name is required'); return; }
    if (!fiatIban.trim()) { setError('Fiat IBAN is required'); return; }
    if (!cryptoNetwork.trim()) { setError('Crypto network is required'); return; }
    if (!cryptoAddress.trim()) { setError('Crypto address is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(detail.lpNo)}/settlement-change`,
        {
          method: 'POST',
          body: JSON.stringify({
            fiatBankName: fiatBankName.trim(),
            fiatIban: fiatIban.trim(),
            cryptoNetwork: cryptoNetwork.trim(),
            cryptoAddress: cryptoAddress.trim(),
            reason: reason.trim(),
          }),
        },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to propose the settlement change')); return; }
      const data = await res.json();
      onSaved({ approvalNo: data.approvalNo });
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to propose the settlement change');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[520px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Propose Settlement Change</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">{detail.lpNo} · {detail.name}</p>

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
            <input value={cryptoNetwork} onChange={(e) => setCryptoNetwork(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
          <label className="block text-xs">Crypto Address
            <input value={cryptoAddress} onChange={(e) => setCryptoAddress(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
        </div>

        <label className="mb-3 block text-xs">Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Why is this settlement change being proposed?" />
        </label>

        <div className="mb-3 rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2 font-mono text-[10px] text-adm-amber">
          This opens an approval — the CFO decides.
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Propose Change'}
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
  const canProposeChange = hasPermission(PERMISSIONS.LP_PROFILE_SETTLEMENT_CHANGE_WRITE);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState(false);
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

  useEffect(() => {
    if (lpNo) void fetchDetail();
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
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="LP Register"
      >
        <StatusPill value={detail.status} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.lpNo }} />
        {detail.status === 'ACTIVE' && canProposeChange && (
          <button type="button" disabled={working} onClick={() => setShowChangeModal(true)} className={adminButtonClass('detailUtility')}>
            Propose settlement change
          </button>
        )}
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

          <DetailCard title="Settlement Coordinates" columns={2}>
            <InfoField label="Fiat Bank" value={detail.fiatBankName} />
            <InfoField label="Fiat IBAN" value={detail.fiatIban} mono />
            <InfoField label="Crypto Network" value={detail.cryptoNetwork} />
            <InfoField label="Crypto Address" value={detail.cryptoAddress} mono />
          </DetailCard>
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

      <ProposeSettlementChangeModal
        open={showChangeModal}
        detail={detail}
        onClose={() => setShowChangeModal(false)}
        onSaved={(result) => {
          setShowChangeModal(false);
          setNotice({ text: 'Settlement change proposed — awaiting CFO.', approvalNo: result.approvalNo });
        }}
      />
    </div>
  );
};

export default LpProfileDetail;

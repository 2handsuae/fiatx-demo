import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, ShieldOff, ShieldCheck, Zap, Pencil } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssetDetailData {
  id: string;
  assetNo?: string | null;
  type: 'FIAT' | 'CRYPTO';
  currency: string;
  code: string;
  network: string | null;
  decimals: number;
  description: string | null;
  status: string;
  minDepositAmount?: number | null;
  maxDepositAmount?: number | null;
  minWithdrawAmount?: number | null;
  maxWithdrawAmount?: number | null;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  suspendedAt?: string | null;
  suspendReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Layout primitives (Pattern B) ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function AssetDetail() {
  const { assetNo } = useParams<{ assetNo: string }>();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<AssetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [submittingSuspend, setSubmittingSuspend] = useState(false);

  const [showActivateModal, setShowActivateModal] = useState(false);
  const [submittingActivate, setSubmittingActivate] = useState(false);

  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [submittingReactivate, setSubmittingReactivate] = useState(false);

  const fetchDetail = async () => {
    if (!assetNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${assetNo}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load asset detail.'));
      setAsset(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load asset detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [assetNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Activate / Suspend / Reactivate actions ── */

  const handleSubmitActivate = async () => {
    if (!asset?.assetNo) return;
    setSubmittingActivate(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/activate`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit activation request'));
      const data = await res.json();
      setShowActivateModal(false);
      setNotice(`Activation request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit activation request.');
    } finally {
      setSubmittingActivate(false);
    }
  };

  const handleSubmitSuspend = async () => {
    if (!asset?.assetNo || !suspendReason.trim()) return;
    setSubmittingSuspend(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit suspension request'));
      const data = await res.json();
      setShowSuspendModal(false);
      setSuspendReason('');
      setNotice(`Suspension request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit suspension request.');
    } finally {
      setSubmittingSuspend(false);
    }
  };

  const handleSubmitReactivate = async () => {
    if (!asset?.assetNo) return;
    setSubmittingReactivate(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/reactivate`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit reactivation request'));
      const data = await res.json();
      setShowReactivateModal(false);
      setNotice(`Reactivation request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit reactivation request.');
    } finally {
      setSubmittingReactivate(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !asset) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading asset…</p>
        <button onClick={() => navigate('/admin/assets')} className={adminButtonClass('detailUtility')}>
          ← Back to Assets
        </button>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Asset not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/admin/assets')} className={adminButtonClass('detailUtility')}>
            Back to Assets
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.code}
            </p>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                <div className="mt-1"><AdminBadge value={asset.status} /></div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2">
              <InfoField label="Currency" value={asset.currency} mono />
              <InfoField label="Type" value={asset.type} />
              {asset.network && <InfoField label="Network" value={asset.network} />}
            </div>
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Asset Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Code" value={asset.code} mono />
              <InfoField label="Currency" value={asset.currency} mono />
              <InfoField label="Type" value={asset.type} />
              <InfoField label="Network" value={asset.network || '—'} />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Description" value={asset.description || '—'} />
            </div>
          </section>

          {/* ③ Limits */}
          <section className="px-6 py-5">
            <Cap>Deposit & Withdrawal</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Min Deposit" value={asset.minDepositAmount != null ? String(asset.minDepositAmount) : '—'} mono />
              <InfoField label="Max Deposit" value={asset.maxDepositAmount != null ? String(asset.maxDepositAmount) : '—'} mono />
              <InfoField label="Min Withdraw" value={asset.minWithdrawAmount != null ? String(asset.minWithdrawAmount) : '—'} mono />
              <InfoField label="Max Withdraw" value={asset.maxWithdrawAmount != null ? String(asset.maxWithdrawAmount) : '—'} mono />
              <InfoField label="Deposit Enabled" value={asset.depositEnabled ? 'Yes' : 'No'} />
              <InfoField label="Withdrawal Enabled" value={asset.withdrawalEnabled ? 'Yes' : 'No'} />
            </div>
          </section>

          {/* ④ Suspension Info (visible when suspended) */}
          {asset.status === 'SUSPENDED' && (
            <section className="px-6 py-5">
              <Cap>Suspension</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField label="Suspended At" value={fmt(asset.suspendedAt)} mono />
                <InfoField label="Reason" value={asset.suspendReason || '—'} />
              </div>
            </section>
          )}
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {(asset.status === 'PROVISIONING' || asset.status === 'ACTIVE' || asset.status === 'SUSPENDED') && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {asset.status === 'PROVISIONING' && (
                  <>
                    <button
                      onClick={() => navigate(`/admin/assets/${assetNo}/edit`)}
                      className={adminButtonClass('detailUtility')}
                    >
                      <Pencil size={13} />
                      Edit Asset
                    </button>
                    <button
                      onClick={() => setShowActivateModal(true)}
                      className={adminButtonClass('workflowPrimary')}
                    >
                      <Zap size={13} />
                      Activate Asset
                    </button>
                  </>
                )}
                {asset.status === 'ACTIVE' && (
                  <button
                    onClick={() => { setSuspendReason(''); setShowSuspendModal(true); }}
                    className={adminButtonClass('workflowNegative')}
                  >
                    <ShieldOff size={13} />
                    Suspend Asset
                  </button>
                )}
                {asset.status === 'SUSPENDED' && (
                  <button
                    onClick={() => setShowReactivateModal(true)}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <ShieldCheck size={13} />
                    Reactivate Asset
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Asset No" value={asset.assetNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={asset.status} />} />
            <SidebarKV label="Currency" value={asset.currency} mono />
            <SidebarKV label="Type" value={asset.type} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(asset.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(asset.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Activate Modal ════ */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Activate Asset
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {asset.assetNo} · {asset.code}
                </p>
              </div>
              <button
                onClick={() => setShowActivateModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit an activation request for CISO approval. If approved, the asset will
                go live and all business operations (deposits, withdrawals, trading) will be enabled.
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowActivateModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitActivate()}
                disabled={submittingActivate}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingActivate ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ════ Suspend Modal ════ */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Suspend Asset
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {asset.assetNo} · {asset.code}
                </p>
              </div>
              <button
                onClick={() => setShowSuspendModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a suspension request for CISO approval. If approved, the asset will
                be suspended and deposit/withdrawal will be disabled immediately.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Suspension
                </p>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this asset should be suspended…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowSuspendModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitSuspend()}
                disabled={submittingSuspend || !suspendReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingSuspend ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ════ Reactivate Modal ════ */}
      {showReactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Reactivate Asset
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {asset.assetNo} · {asset.code}
                </p>
              </div>
              <button
                onClick={() => setShowReactivateModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a reactivation request for CISO approval. If approved, the asset
                will be reactivated and deposit/withdrawal settings will be restored.
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowReactivateModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitReactivate()}
                disabled={submittingReactivate}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingReactivate ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

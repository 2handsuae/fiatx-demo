import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssetDetailData {
  id: string;
  assetNo?: string | null;
  type: 'FIAT' | 'CRYPTO';
  code: string;
  network: string | null;
  decimals: number;
  contractAddress?: string | null;
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<AssetDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load asset detail.'));
      setAsset(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load asset detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* ── Suspend / Reactivate actions ── */

  const handleSuspend = async () => {
    if (!asset?.assetNo || !suspendReason.trim()) return;
    setActionBusy(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/suspend`,
        { method: 'POST', body: JSON.stringify({ reason: suspendReason.trim() }) },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to request suspension.'));
      setShowSuspendDialog(false);
      setSuspendReason('');
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to request suspension.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReactivate = async () => {
    if (!asset?.assetNo) return;
    if (!window.confirm(`Request reactivation for asset ${asset.code}? This requires CISO approval.`)) return;
    setActionBusy(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets/${asset.assetNo}/reactivate`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to request reactivation.'));
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to request reactivation.');
    } finally {
      setActionBusy(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !asset) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading asset…</p>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Asset not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/dashboard/system/assets')} className={adminButtonClass('detailUtility')}>
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
        title="ASSET"
        subtitle={asset.assetNo || asset.code}
        onBack={() => navigate('/dashboard/system/assets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Asset</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.assetNo || asset.code}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={asset.status} />
              <span className="font-mono text-[10px] text-adm-t2">{asset.code} · {asset.type}</span>
            </div>
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Network" value={asset.network || '—'} />
              <InfoField label="Decimals" value={String(asset.decimals)} mono />
              <InfoField label="Contract Address" value={asset.contractAddress || '—'} mono />
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

          {/* ⑤ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(asset.createdAt)} mono />
              <InfoField label="Updated" value={fmt(asset.updatedAt)} mono />
            </div>
          </section>

          {/* ⑥ Actions */}
          {(asset.status === 'ACTIVE' || asset.status === 'SUSPENDED') && (
            <section className="px-6 py-5">
              <Cap>Actions</Cap>
              <div className="mt-3 flex flex-col gap-3">
                {asset.status === 'ACTIVE' && !showSuspendDialog && (
                  <button
                    onClick={() => { setShowSuspendDialog(true); setTimeout(() => reasonRef.current?.focus(), 50); }}
                    disabled={actionBusy}
                    className={adminButtonClass('detailUtility')}
                  >
                    Suspend Asset
                  </button>
                )}
                {asset.status === 'ACTIVE' && showSuspendDialog && (
                  <div className="rounded border border-adm-border bg-adm-bg p-4 space-y-3">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                      Suspension requires CISO approval
                    </p>
                    <textarea
                      ref={reasonRef}
                      className="w-full rounded border border-adm-border bg-adm-card px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                      rows={3}
                      placeholder="Reason for suspension (required)"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleSuspend()}
                        disabled={actionBusy || !suspendReason.trim()}
                        className={adminButtonClass('detailUtility')}
                      >
                        {actionBusy ? 'Submitting…' : 'Submit Suspension Request'}
                      </button>
                      <button
                        onClick={() => { setShowSuspendDialog(false); setSuspendReason(''); }}
                        disabled={actionBusy}
                        className={adminButtonClass('detailUtility')}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {asset.status === 'SUSPENDED' && (
                  <button
                    onClick={() => void handleReactivate()}
                    disabled={actionBusy}
                    className={adminButtonClass('detailUtility')}
                  >
                    {actionBusy ? 'Submitting…' : 'Reactivate Asset'}
                  </button>
                )}
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Asset No" value={asset.assetNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={asset.status} />} />
            <SidebarKV label="Type" value={asset.type} />
            <SidebarKV label="Code" value={asset.code} mono />
            <SidebarKV label="Asset ID" value={asset.id} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Pencil } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PolicyDetailData {
  id: string;
  policyNo: string;
  tradingTier: string;
  operationType: string;
  period: string;
  limitAmount: string;
  status: string;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (!v) return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/* ── Layout primitives ── */

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

export default function TransactionLimitDetail() {
  const { policyNo } = useParams<{ policyNo: string }>();
  const navigate = useNavigate();

  const [policy, setPolicy] = useState<PolicyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const fetchDetail = async () => {
    if (!policyNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policy detail.'));
      setPolicy(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load policy detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [policyNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Edit Limit action ── */

  const handleSubmitEdit = async () => {
    if (!policyNo || !newAmount.trim() || !changeReason.trim()) return;
    const amount = parseFloat(newAmount);
    if (Number.isNaN(amount) || amount <= 0) return;

    setSubmittingEdit(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}/change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limitAmount: amount, changeReason: changeReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit limit change'));
      const data = await res.json();
      setShowEditModal(false);
      setNewAmount('');
      setChangeReason('');
      setNotice(`Limit change submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit limit change.');
    } finally {
      setSubmittingEdit(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !policy) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading policy…</p>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Policy not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/admin/assets/transaction-limits')} className={adminButtonClass('detailUtility')}>
            Back to Limits
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
        onBack={() => navigate('/admin/assets/transaction-limits')}
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

          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {policy.policyNo}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={policy.tradingTier} />
              <AdminBadge value={policy.operationType} />
              <AdminBadge value={policy.period} />
              <AdminBadge value={policy.status} />
            </div>
          </section>

          {/* ② Core Context */}
          <section className="px-6 py-5">
            <Cap>Limit Configuration</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Daily Limit (AED)" value={fmtAmount(policy.limitAmount)} mono />
              <InfoField label="Status" value={policy.status} />
              <InfoField label="Trading Tier" value={policy.tradingTier} />
              <InfoField label="Operation Type" value={policy.operationType} />
              <InfoField label="Period" value={policy.period} />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {policy.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button
                  onClick={() => {
                    setNewAmount('');
                    setChangeReason('');
                    setShowEditModal(true);
                  }}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <Pencil size={13} />
                  Edit Limit
                </button>
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Trading Tier" value={policy.tradingTier} />
            <SidebarKV label="Operation" value={policy.operationType} />
            <SidebarKV label="Period" value={policy.period} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(policy.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(policy.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Edit Limit Modal ════ */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Edit Limit
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {policy.policyNo} · {policy.tradingTier} · {policy.operationType}
                </p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a limit change request for MLRO → SMO approval.
                The current limit remains in effect until the change is approved.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Current Limit (AED)
                </p>
                <p className="font-mono text-[13px] font-semibold text-adm-t1">
                  {fmtAmount(policy.limitAmount)}
                </p>
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  New Limit (AED)
                </p>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="Enter new limit amount"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Change
                </p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Describe why this limit should be changed…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowEditModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitEdit()}
                disabled={submittingEdit || !newAmount.trim() || !changeReason.trim() || parseFloat(newAmount) <= 0 || parseFloat(newAmount) === parseFloat(policy.limitAmount)}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingEdit ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

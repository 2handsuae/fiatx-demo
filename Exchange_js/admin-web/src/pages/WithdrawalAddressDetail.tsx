import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  address: string;
  addressType: string;
  network: string;
  label: string | null;
  counterpartyVaspName: string | null;
  counterpartyVaspDid: string | null;
  ownershipDeclaredAt: string | null;
  ownershipProofType: string | null;
  beneficiaryName: string | null;
  iban: string | null;
  swiftBic: string | null;
  bankName: string | null;
  customerName: string | null;
  status: string;
  activatesAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendReason: string | null;
  cancelledAt: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  asset: { currency: string; code: string; type: string; network: string | null };
  customer: { id: string; customerNo: string } | null;
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

/* ── Address Type badge ── */

const TYPE_CLS: Record<string, string> = {
  VASP:         'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  SELF_CUSTODY: 'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  BANK:         'bg-adm-green/10 text-adm-green border-adm-green/25',
};

const TYPE_LABEL: Record<string, string> = {
  VASP: 'VASP',
  SELF_CUSTODY: 'Self-Custody',
  BANK: 'Bank Account',
};

const AddressTypeBadge = ({ type }: { type: string }) => {
  const cls = TYPE_CLS[type] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {TYPE_LABEL[type] || type}
    </span>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function WithdrawalAddressDetail() {
  const { addressNo } = useParams<{ addressNo: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<WithdrawalAddr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const fetchData = async () => {
    if (!addressNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch address details.'));
      setData(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [addressNo]);

  /* ── Actions ── */

  const handleSkipCooling = async () => {
    if (!window.confirm('Skip the cooling period and immediately activate this address?')) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/skip-cooling`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to skip cooling'));
        return;
      }
      setNotice('Cooling period skipped — address activated.');
      void fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to skip cooling period');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to suspend'));
        return;
      }
      setShowSuspendModal(false);
      setSuspendReason('');
      setNotice('Address suspended successfully.');
      void fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to suspend address');
    } finally {
      setActionLoading(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !data) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading address…</p>
        <button onClick={() => navigate('/admin/custody/withdrawal-addresses')} className={adminButtonClass('detailUtility')}>
          ← Back to Withdrawal Addresses
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Address not found'}</div>
        <button onClick={() => navigate(-1)} className={adminButtonClass('detailUtility')}>
          Back
        </button>
      </div>
    );
  }

  /* ── Derived state ── */

  const isPending = data.status === 'PENDING_ACTIVATION';
  const isActive = data.status === 'ACTIVE';
  const isBank = data.addressType === 'BANK';
  const isVasp = data.addressType === 'VASP';
  const showActions = isPending || isActive;

  const remaining = isPending ? Math.max(0, new Date(data.activatesAt).getTime() - Date.now()) : 0;
  const remainingHours = Math.floor(remaining / 3600000);
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000);
  const elapsed = isPending ? Math.max(0, Date.now() - new Date(data.createdAt).getTime()) : 0;
  const totalCooling = isPending ? new Date(data.activatesAt).getTime() - new Date(data.createdAt).getTime() : 1;
  const progressPct = Math.min(100, Math.round((elapsed / totalCooling) * 100));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel="Withdrawal Addresses"
        onBack={() => navigate('/admin/custody/withdrawal-addresses')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      />

      {/* ── Notices ── */}
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
              {data.addressNo}
            </p>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                <div className="mt-1"><AdminBadge value={data.status} /></div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Type</div>
                <div className="mt-1"><AddressTypeBadge type={data.addressType} /></div>
              </div>
            </div>
            {data.label && (
              <div className="mt-3">
                <InfoField label="Label" value={data.label} />
              </div>
            )}
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</div>
                <div className="mt-1 text-[13px]">
                  {data.customerNo && data.customerId ? (
                    <button
                      onClick={() => navigate(`/admin/customers/${data.customerId}`)}
                      className="text-adm-amber hover:underline font-mono text-[11px]"
                      title="Open customer"
                    >
                      {data.customerNo}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-adm-t2">{data.customerNo ?? '—'}</span>
                  )}
                </div>
              </div>
              <InfoField label="Customer Name" value={data.customerName ?? '—'} />
              <InfoField label="Asset" value={data.asset.code} />
              <InfoField label="Network" value={data.network} />
              <InfoField label="Registered" value={fmt(data.createdAt)} mono />
            </div>
          </section>

          {/* ③ Address / Bank Info */}
          <section className="px-6 py-5">
            <Cap>{isBank ? 'Bank Account' : 'Crypto Address'}</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              {isBank ? (
                <>
                  <InfoField label="IBAN" value={data.iban} mono />
                  <InfoField label="SWIFT / BIC" value={data.swiftBic} mono />
                  <InfoField label="Bank Name" value={data.bankName} />
                  <InfoField label="Beneficiary Name" value={data.beneficiaryName} />
                </>
              ) : (
                <>
                  <div className="col-span-2">
                    <InfoField label="Address" value={data.address} mono />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ④ VASP Info (conditional) */}
          {isVasp && (
            <section className="px-6 py-5">
              <Cap>VASP Information</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField label="Counterparty VASP" value={data.counterpartyVaspName} />
                <InfoField label="VASP DID" value={data.counterpartyVaspDid} mono />
              </div>
            </section>
          )}

          {/* ⑤ Ownership Declaration */}
          <section className="px-6 py-5">
            <Cap>Ownership Declaration</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField
                label="Declared"
                value={data.ownershipDeclaredAt ? fmt(data.ownershipDeclaredAt) : '—'}
                mono
              />
              <InfoField label="Proof Type" value={data.ownershipProofType || '—'} />
            </div>
          </section>

          {/* ⑥ Cooling Period (conditional) */}
          {isPending && (
            <section className="px-6 py-5">
              <Cap>Cooling Period</Cap>
              <div className="mt-3 grid grid-cols-3 gap-x-8 gap-y-4">
                <InfoField label="Registered At" value={fmt(data.createdAt)} mono />
                <InfoField label="Activates At" value={fmt(data.activatesAt)} mono highlight />
                <InfoField label="Remaining" value={`${remainingHours}h ${remainingMinutes}m`} highlight />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-adm-border">
                <div
                  className="h-full rounded-full bg-adm-amber"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[9px] text-adm-t3">{progressPct}% elapsed</div>
            </section>
          )}

          {/* ⑦ Suspension Info (conditional) */}
          {data.status === 'SUSPENDED' && (
            <section className="px-6 py-5">
              <Cap>Suspension</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField label="Suspended At" value={fmt(data.suspendedAt)} mono />
                <InfoField label="Suspended By" value={data.suspendedBy} mono />
                <div className="col-span-2">
                  <InfoField label="Reason" value={data.suspendReason} />
                </div>
              </div>
            </section>
          )}

          {/* ⑧ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(data.createdAt)} mono />
              <InfoField label="Updated" value={fmt(data.updatedAt)} mono />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {showActions && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {isPending && (
                  <button
                    onClick={() => void handleSkipCooling()}
                    disabled={actionLoading}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Skip Cooling Period
                  </button>
                )}
                {isActive && (
                  <button
                    onClick={() => setShowSuspendModal(true)}
                    disabled={actionLoading}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Force Suspend
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Address No" value={data.addressNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={data.status} />} />
            <SidebarKV label="Type" value={data.addressType} mono />
            <SidebarKV label="Asset" value={data.asset.code} />
            <SidebarKV label="Customer No" value={data.customerNo} mono />
            <SidebarKV label="Customer Name" value={data.customerName} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(data.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(data.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ── Suspend Modal ── */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border px-6 py-4">
              <h2 className="text-base font-semibold text-adm-t1">Suspend Withdrawal Address</h2>
              <p className="mt-1 text-xs text-adm-t3">This will prevent the address from being used for withdrawals.</p>
            </div>
            <div className="px-6 py-4">
              <label className="block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">
                Reason
              </label>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Sanctioned address identified by KYT"
                className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber h-20 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
              <button
                onClick={() => { setShowSuspendModal(false); setSuspendReason(''); }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSuspend()}
                disabled={!suspendReason.trim() || actionLoading}
                className={adminButtonClass('workflowNegative')}
              >
                Suspend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

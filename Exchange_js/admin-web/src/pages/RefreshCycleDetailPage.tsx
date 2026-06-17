import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface CycleDetail {
  id: string;
  cycleNo: string;
  customerId: string;
  holdingId: string;
  materialType: string;
  status: string;
  stage: string;
  triggerType: string;
  createdAt: string;
  stageNudgeAt?: string | null;
  stageUrgentAt?: string | null;
  stageBlockingAt?: string | null;
  clearedAt?: string | null;
  rejectedAt?: string | null;
  graceExpiresAt?: string | null;
  resolutionReason?: string | null;
  customerSubmittedAt?: string | null;
  sumsubActionId?: string | null;
  sumsubActionLevelName?: string | null;
  sumsubActionCreatedAt?: string | null;
  traceId: string;
  customer: {
    id: string;
    customerNo: string;
    email: string;
    riskTier: string;
    complianceStatus?: string | null;
    sumsubCurrentLevelName?: string | null;
  };
  holding: {
    id: string;
    holdingNo: string;
    materialType: string;
    managementMode: string;
    status: string;
    expiresAt?: string | null;
    verifiedAt?: string | null;
  };
}

/* ── Layout primitives (mirrors MaterialHoldingDetailPage) ──── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

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

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtDate = (v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const MATERIAL_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  LIVENESS: 'Liveness Check',
  PROOF_OF_ADDRESS: 'Proof of Address',
  SOURCE_OF_FUNDS: 'Source of Funds',
  SOURCE_OF_WEALTH: 'Source of Wealth',
};

/* ── Page ────────────────────────────────────────────────────── */

const RefreshCycleDetailPage = () => {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<CycleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!cycleId) {
      setError('Cycle ID is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/cycles/${cycleId}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load cycle.'));
      setDetail((await res.json()) as CycleDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load cycle detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [cycleId]);

  /* ── Loading / error ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <DetailPageHeader
          title="Refresh Cycle"
          onBack={() => navigate('/admin/customers/refresh-cycles')}
          onRefresh={() => void fetchDetail()}
          refreshing={loading}
          backLabel="Refresh Cycles"
        />
        <div className="px-6 py-6">
          {error ? (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-adm-t3">Cycle not found.</p>
          )}
        </div>
      </div>
    );
  }

  /* ── Derived ── */

  const materialLabel = MATERIAL_LABELS[detail.materialType] || detail.materialType;

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        title="Refresh Cycle"
        onBack={() => navigate('/admin/customers/refresh-cycles')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Refresh Cycles"
      />

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
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
            <Cap>Refresh Cycle</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.cycleNo}
            </p>
            <p className="mt-1 font-mono text-[13px] text-adm-t2">
              {materialLabel}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <AdminBadge value={detail.status} />
              {detail.stage && <AdminBadge value={detail.stage} />}
            </div>
            <button
              className={adminButtonClass('rowLink')}
              onClick={() =>
                navigate(`/admin/customers/${detail.customer.id}`)
              }
            >
              {detail.customer.customerNo} ({detail.customer.email})
            </button>
          </section>

          {/* ② Cycle Context */}
          <section className="px-6 py-5">
            <Cap>Cycle Context</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Trigger Type" value={detail.triggerType} />
              <Field label="Stage" value={detail.stage} />
              <Field label="Material Type" value={detail.materialType} amber />
              <Field label="Status" value={detail.status} />
              <Field label="Grace Expires At" value={fmt(detail.graceExpiresAt)} mono />
              <Field label="Created At" value={fmt(detail.createdAt)} mono />
              <Field label="Cleared At" value={fmt(detail.clearedAt)} mono />
              <Field label="Rejected At" value={fmt(detail.rejectedAt)} mono />
              <Field label="Resolution Reason" value={detail.resolutionReason} full />
              <Field label="Customer Submitted At" value={fmt(detail.customerSubmittedAt)} mono />
            </div>
          </section>

          {/* ③ Sumsub */}
          <section className="px-6 py-5">
            <Cap>Sumsub</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Action ID" value={detail.sumsubActionId} mono />
              <Field label="Action Level Name" value={detail.sumsubActionLevelName} mono />
              <Field label="Action Created At" value={fmt(detail.sumsubActionCreatedAt)} mono />
            </div>
          </section>

          {/* ④ Holding Link */}
          <section className="px-6 py-5">
            <Cap>Holding Link</Cap>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[11px] font-semibold text-adm-amber">
                  {detail.holding.holdingNo}
                </span>
                <AdminBadge value={detail.holding.status} />
                <span className="font-mono text-[10px] text-adm-t3">
                  {MATERIAL_LABELS[detail.holding.materialType] || detail.holding.materialType}
                </span>
                <span className="font-mono text-[10px] text-adm-t3">
                  {detail.holding.managementMode}
                </span>
              </div>
              {detail.holding.expiresAt && (
                <p className="font-mono text-[10px] text-adm-t3">
                  Expires: {fmtDate(detail.holding.expiresAt)}
                </p>
              )}
              <button
                className={adminButtonClass('rowLink')}
                onClick={() =>
                  navigate(`/admin/customers/material-holdings/${detail.holdingId}`)
                }
              >
                View Holding Detail
              </button>
            </div>
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="hidden w-72 shrink-0 flex-col divide-y divide-adm-border overflow-y-auto border-l border-adm-border bg-adm-panel px-5 pt-5 lg:flex">
          {/* Customer */}
          <SidebarGroup title="Customer">
            <SidebarKV label="Customer No" value={detail.customer.customerNo} />
            <SidebarKV label="Email" value={detail.customer.email} mono />
            <SidebarKV label="Risk Tier" value={detail.customer.riskTier} />
            <SidebarKV
              label="Compliance"
              value={
                detail.customer.complianceStatus &&
                detail.customer.complianceStatus !== 'CLEAR'
                  ? detail.customer.complianceStatus
                  : null
              }
            />
          </SidebarGroup>

          {/* Holding */}
          <SidebarGroup title="Holding">
            <SidebarKV label="Holding No" value={detail.holding.holdingNo} />
            <SidebarKV
              label="Material"
              value={MATERIAL_LABELS[detail.holding.materialType] || detail.holding.materialType}
            />
            <SidebarKV label="Mode" value={detail.holding.managementMode} mono />
            <SidebarKV label="Status" value={detail.holding.status} />
            <SidebarKV
              label="Expires"
              value={detail.holding.expiresAt ? fmtDate(detail.holding.expiresAt) : null}
              mono
            />
          </SidebarGroup>

          {/* Timestamps */}
          <SidebarGroup title="Timestamps">
            <SidebarKV label="Created" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Nudge" value={fmt(detail.stageNudgeAt)} mono />
            <SidebarKV label="Urgent" value={fmt(detail.stageUrgentAt)} mono />
            <SidebarKV label="Blocking" value={fmt(detail.stageBlockingAt)} mono />
            <SidebarKV label="Cleared" value={fmt(detail.clearedAt)} mono />
            <SidebarKV label="Rejected" value={fmt(detail.rejectedAt)} mono />
          </SidebarGroup>

          {/* Sumsub */}
          <SidebarGroup title="Sumsub">
            <SidebarKV label="Action ID" value={detail.sumsubActionId} mono />
            <SidebarKV label="Level Name" value={detail.sumsubActionLevelName} mono />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default RefreshCycleDetailPage;

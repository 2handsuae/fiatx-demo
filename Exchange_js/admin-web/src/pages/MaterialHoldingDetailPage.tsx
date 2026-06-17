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

interface RefreshCycle {
  id: string;
  cycleNo: string;
  status: string;
  stage?: string | null;
  triggerType?: string | null;
  sumsubActionId?: string | null;
  resolutionReason?: string | null;
  graceExpiresAt?: string | null;
  clearedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MaterialHoldingDetail {
  id: string;
  materialType: string;
  managementMode: string;
  status: string;
  expiresAt?: string | null;
  verifiedAt?: string | null;
  daysFromExpiry?: number | null;
  sumsubIdDocSetType?: string | null;
  sumsubDocId?: string | null;
  activeRefreshCycleId?: string | null;
  activeRefreshCycle?: RefreshCycle | null;
  refreshCycles: RefreshCycle[];
  customer: {
    id: string;
    customerNo: string;
    email: string;
    riskTier: string;
    complianceStatus?: string | null;
    sumsubCurrentLevelName?: string | null;
  };
}

type SimStage = 'T_MINUS_30' | 'T_MINUS_7' | 'T_0' | 'T_PLUS_30' | 'GREEN' | 'RED';

/* ── Layout primitives (mirrors ApprovalDetailPage exactly) ─── */

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

const MaterialHoldingDetailPage = () => {
  const { holdingId } = useParams<{ holdingId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<MaterialHoldingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [simLoading, setSimLoading] = useState<SimStage | null>(null);
  const [simMessage, setSimMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!holdingId) {
      setError('Holding ID is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/holdings/${holdingId}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load holding.'));
      setDetail((await res.json()) as MaterialHoldingDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load holding detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [holdingId]);

  useEffect(() => {
    if (!simMessage) return undefined;
    const t = window.setTimeout(() => setSimMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [simMessage]);

  /* ── Simulate ── */

  const simulate = async (targetStage: SimStage) => {
    if (!holdingId || simLoading) return;
    setSimLoading(targetStage);
    setSimMessage(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/holdings/${holdingId}/simulate-stage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetStage }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Simulation failed.'));
      const data = (await res.json()) as { ok: boolean; message?: string };
      setSimMessage({ ok: data.ok, text: data.message ?? 'Done.' });
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setSimMessage({
        ok: false,
        text: e instanceof Error ? e.message : 'Simulation failed.',
      });
    } finally {
      setSimLoading(null);
    }
  };

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
          title="Material Holding"
          onBack={() => navigate('/admin/customers/material-holdings')}
          onRefresh={() => void fetchDetail()}
          refreshing={loading}
          backLabel="Material Management"
        />
        <div className="px-6 py-6">
          {error ? (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-adm-t3">Holding not found.</p>
          )}
        </div>
      </div>
    );
  }

  /* ── Derived ── */

  const daysLeft = detail.daysFromExpiry;
  const daysLabel =
    daysLeft === null || daysLeft === undefined
      ? null
      : daysLeft < 0
        ? `${Math.abs(daysLeft)}d overdue`
        : `${daysLeft}d left`;

  const daysColor =
    daysLeft === null || daysLeft === undefined
      ? ''
      : daysLeft < 7
        ? 'text-adm-red font-bold'
        : daysLeft <= 30
          ? 'text-adm-amber font-semibold'
          : 'text-adm-green';

  const materialLabel = MATERIAL_LABELS[detail.materialType] || detail.materialType;
  const activeCycle = detail.activeRefreshCycle;

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        title="Material Holding"
        onBack={() => navigate('/admin/customers/material-holdings')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Material Management"
      />

      {/* ── Notices ── */}
      {(simMessage || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {simMessage && (
            <div
              className={[
                'rounded border px-4 py-2 font-mono text-[11px]',
                simMessage.ok
                  ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                  : 'border-adm-red/30 bg-adm-red/10 text-adm-red',
              ].join(' ')}
            >
              {simMessage.text}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout (matches ApprovalDetailPage) ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
          {/* ① Identity — holding ID prominent, material type subtitle */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Material Holding</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.id.slice(0, 12).toUpperCase()}
            </p>
            <p className="mt-1 font-mono text-[13px] text-adm-t2">
              {materialLabel}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <AdminBadge value={detail.status} />
              <AdminBadge value={detail.customer.riskTier} />
              {detail.customer.complianceStatus &&
                detail.customer.complianceStatus !== 'CLEAR' && (
                  <AdminBadge value={detail.customer.complianceStatus} />
                )}
            </div>
            <p className="mt-3 font-mono text-[11px] text-adm-t3">
              {detail.managementMode}
            </p>
            <button
              className={adminButtonClass('rowLink')}
              onClick={() =>
                navigate(`/admin/customers/${detail.customer.id}`)
              }
            >
              {detail.customer.customerNo} ({detail.customer.email})
            </button>
          </section>

          {/* ② Holding Context */}
          <section className="px-6 py-5">
            <Cap>Holding Context</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Material Type" value={detail.materialType} amber />
              <Field label="Management Mode" value={detail.managementMode} />
              <Field label="Sumsub Level" value={detail.customer.sumsubCurrentLevelName} mono />
              <Field label="Sumsub Doc Set Type" value={detail.sumsubIdDocSetType} mono />
              <Field label="Verified At" value={fmtDate(detail.verifiedAt)} mono />
              <Field
                label="Expires At"
                value={
                  detail.expiresAt
                    ? `${fmtDate(detail.expiresAt)}${daysLabel ? ` (${daysLabel})` : ''}`
                    : null
                }
                mono
              />
            </div>
          </section>

          {/* ③ Stage Simulation */}
          <section className="px-6 py-5">
            <Cap>Stage Simulation</Cap>
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Lifecycle stage
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { stage: 'T_MINUS_30' as SimStage, label: '→ T-30 Nudge' },
                      { stage: 'T_MINUS_7' as SimStage, label: '→ T-7 Urgent' },
                      { stage: 'T_0' as SimStage, label: '→ T-0 Block' },
                      { stage: 'T_PLUS_30' as SimStage, label: '→ T+30 Offboard' },
                    ]
                  ).map(({ stage, label }) => (
                    <button
                      key={stage}
                      disabled={simLoading !== null}
                      onClick={() => void simulate(stage)}
                      className={adminButtonClass('simulationAction')}
                    >
                      {simLoading === stage ? 'Working…' : label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-adm-border pt-4">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Customer action simulation
                </p>
                <p className="font-mono text-[10px] text-adm-t3 leading-relaxed">
                  To simulate customer completing or failing this material refresh, use the{' '}
                  <button
                    className={adminButtonClass('rowLink')}
                    onClick={() => navigate('/admin/compliance/sumsub-events')}
                  >
                    Sumsub Events
                  </button>{' '}
                  simulation panel with the Applicant Action Result endpoint.
                  {activeCycle?.sumsubActionId && (
                    <span className="block mt-1.5 font-mono text-[9px] text-adm-t3">
                      Action ID: <span className="text-adm-amber">{activeCycle.sumsubActionId}</span>
                    </span>
                  )}
                </p>
              </div>
            </div>
          </section>

          {/* ④ Refresh Cycle History */}
          <section className="px-6 py-5">
            <Cap>Refresh Cycle History</Cap>
            {detail.refreshCycles.length === 0 ? (
              <p className="mt-3 font-mono text-[11px] text-adm-t3">
                No refresh cycles yet.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-adm-border rounded border border-adm-border">
                {detail.refreshCycles.map((cycle) => {
                  const isActive = cycle.id === detail.activeRefreshCycleId;
                  return (
                    <div
                      key={cycle.id}
                      className={[
                        'px-4 py-3.5 space-y-1.5',
                        isActive ? 'bg-adm-amber/5' : '',
                      ].join(' ')}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-adm-amber">
                          {cycle.cycleNo}
                        </span>
                        <AdminBadge value={cycle.status} />
                        {cycle.stage && (
                          <span className="font-mono text-[9px] text-adm-t3">{cycle.stage}</span>
                        )}
                        {cycle.triggerType && (
                          <span className="font-mono text-[9px] text-adm-t3">
                            trigger: {cycle.triggerType}
                          </span>
                        )}
                        {isActive && (
                          <span className="font-mono text-[9px] font-semibold text-adm-blue">
                            ← active
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-adm-t3">
                        <span>Created: {fmtDate(cycle.createdAt)}</span>
                        {cycle.clearedAt && <span>Cleared: {fmtDate(cycle.clearedAt)}</span>}
                        {cycle.rejectedAt && <span>Rejected: {fmtDate(cycle.rejectedAt)}</span>}
                        {cycle.graceExpiresAt && (
                          <span>Grace: {fmtDate(cycle.graceExpiresAt)}</span>
                        )}
                      </div>
                      {cycle.sumsubActionId && (
                        <p className="font-mono text-[9px] text-adm-t3">
                          Action: {cycle.sumsubActionId}
                        </p>
                      )}
                      {cycle.resolutionReason && (
                        <p className="font-mono text-[9px] text-adm-t3">
                          Resolution: {cycle.resolutionReason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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

          {/* Verification */}
          <SidebarGroup title="Verification">
            <SidebarKV label="Verified At" value={fmtDate(detail.verifiedAt)} mono />
            <SidebarKV
              label="Expires At"
              value={detail.expiresAt ? fmtDate(detail.expiresAt) : null}
              mono
            />
            {daysLabel && (
              <SidebarKV
                label="Countdown"
                value={<span className={daysColor}>{daysLabel}</span>}
              />
            )}
          </SidebarGroup>

          {/* Sumsub */}
          <SidebarGroup title="Sumsub">
            <SidebarKV label="Level" value={detail.customer.sumsubCurrentLevelName} mono />
            <SidebarKV label="Doc Set Type" value={detail.sumsubIdDocSetType} mono />
            <SidebarKV label="Doc ID" value={detail.sumsubDocId} mono />
          </SidebarGroup>

          {/* Active Cycle */}
          {activeCycle && (
            <SidebarGroup title="Active Cycle">
              <SidebarKV label="Cycle No" value={activeCycle.cycleNo} />
              <SidebarKV label="Stage" value={activeCycle.stage} />
              <SidebarKV label="Trigger" value={activeCycle.triggerType} mono />
              <SidebarKV label="Grace" value={fmt(activeCycle.graceExpiresAt)} mono />
              <SidebarKV label="Action ID" value={activeCycle.sumsubActionId} mono />
            </SidebarGroup>
          )}

          {/* Lifecycle */}
          <SidebarGroup title="Identification">
            <SidebarKV label="Holding ID" value={detail.id} mono />
            <SidebarKV label="Short Ref" value={detail.id.slice(0, 12).toUpperCase()} mono />
            <SidebarKV label="Material" value={detail.materialType} mono />
            <SidebarKV label="Total Cycles" value={String(detail.refreshCycles.length)} />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default MaterialHoldingDetailPage;

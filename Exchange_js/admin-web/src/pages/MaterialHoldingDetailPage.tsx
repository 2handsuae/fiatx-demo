import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  DetailPageHeader,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RefreshCycle {
  id: string;
  cycleNo: string;
  status: string;
  stage?: string | null;
  sumsubActionId?: string | null;
  resolution?: string | null;
  graceExpiresAt?: string | null;
  clearedAt?: string | null;
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
  sumsubActionLevelName?: string | null;
  levelName?: string | null;
  activeRefreshCycleId?: string | null;
  activeRefreshCycle?: RefreshCycle | null;
  refreshCycles: RefreshCycle[];
  customer: {
    id: string;
    customerNo: string;
    email: string;
    riskTier: string;
    restrictionStatus?: string | null;
    sumsubCurrentLevelName?: string | null;
  };
}

type SimStage = 'T_MINUS_30' | 'T_MINUS_7' | 'T_0' | 'T_PLUS_30' | 'GREEN' | 'RED';

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const fmtDateTime = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Layout primitives ───────────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const KV = ({
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
    <div className="flex items-baseline gap-3">
      <span className="w-36 shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const MaterialHoldingDetailPage = () => {
  const { holdingId } = useParams<{ holdingId: string }>();
  const navigate = useNavigate();

  const [detail,  setDetail]  = useState<MaterialHoldingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  /* Simulation state */
  const [simLoading, setSimLoading] = useState<SimStage | null>(null);
  const [simMessage, setSimMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── Fetch detail ── */

  const fetchDetail = async () => {
    if (!holdingId) { setError('Holding ID is required.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/holdings/${holdingId}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load holding.'));
      const data = (await res.json()) as MaterialHoldingDetail;
      setDetail(data);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this holding.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load holding detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [holdingId]);

  /* Auto-dismiss sim message */
  useEffect(() => {
    if (!simMessage) return undefined;
    const t = window.setTimeout(() => setSimMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [simMessage]);

  /* ── Simulate stage ── */

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

  /* ── Loading / error stubs ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/compliance/material-management')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button
            onClick={() => navigate('/dashboard/compliance/material-management')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Holding not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const daysLeft = detail.daysFromExpiry;
  const daysLabel =
    daysLeft === null || daysLeft === undefined
      ? null
      : daysLeft < 0
        ? `${Math.abs(daysLeft)} days overdue`
        : `${daysLeft} days left`;

  const daysColor =
    daysLeft === null || daysLeft === undefined
      ? 'text-adm-t3'
      : daysLeft < 7
        ? 'text-adm-red font-bold'
        : daysLeft <= 30
          ? 'text-adm-amber font-semibold'
          : 'text-adm-green';

  const stageButtons: { stage: SimStage; label: string }[] = [
    { stage: 'T_MINUS_30', label: '→ T-30 Nudge' },
    { stage: 'T_MINUS_7',  label: '→ T-7 Urgent' },
    { stage: 'T_0',        label: '→ T-0 Block' },
    { stage: 'T_PLUS_30',  label: '→ T+30 Offboard' },
  ];

  const actionButtons: { stage: SimStage; label: string; variant: 'workflowPrimary' | 'workflowNegative' }[] = [
    { stage: 'GREEN', label: '✓ GREEN: Accepted',  variant: 'workflowPrimary' },
    { stage: 'RED',   label: '✗ RED: Rejected',    variant: 'workflowNegative' },
  ];

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ── */}
      <DetailPageHeader
        title="Material Holding"
        subtitle={detail.materialType}
        onBack={() => navigate('/dashboard/compliance/material-management')}
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

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* ════ Section 1: Holding Info ════ */}
        <section className="rounded-lg border border-adm-border bg-adm-panel shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
            <Cap>Holding Details</Cap>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {/* Customer header */}
            <div className="mb-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer</p>
              <button
                className={adminButtonClass('rowLink')}
                onClick={() => navigate(`/dashboard/customer/management/${detail.customer.id}`)}
              >
                {detail.customer.customerNo} ({detail.customer.email})
              </button>
            </div>

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-adm-border">
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-adm-t3">Status</p>
                <AdminBadge value={detail.status} />
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-adm-t3">Risk Tier</p>
                <AdminBadge value={detail.customer.riskTier} />
              </div>
              {detail.customer.sumsubCurrentLevelName && (
                <div>
                  <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-adm-t3">Sumsub Level</p>
                  <span className="font-mono text-[10px] text-adm-t2">
                    {detail.customer.sumsubCurrentLevelName}
                  </span>
                </div>
              )}
              {detail.customer.restrictionStatus && (
                <div>
                  <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-adm-t3">Restriction</p>
                  <AdminBadge value={detail.customer.restrictionStatus} />
                </div>
              )}
            </div>

            {/* Fields */}
            <KV label="Management Mode"     value={detail.managementMode} />
            <KV label="Level"               value={detail.levelName} mono />
            <KV label="Sumsub Action Level" value={detail.sumsubActionLevelName} mono />
            <KV label="Verified At"         value={fmtDate(detail.verifiedAt)} mono />
            <KV
              label="Expires At"
              value={
                detail.expiresAt
                  ? (
                    <span>
                      {fmtDate(detail.expiresAt)}
                      {daysLabel && (
                        <span className={`ml-2 font-mono text-[10px] ${daysColor}`}>
                          ({daysLabel})
                        </span>
                      )}
                    </span>
                  )
                  : '—'
              }
            />
          </div>
        </section>

        {/* ════ Section 2: Simulation Panel ════ */}
        <section className="rounded-lg border border-adm-border bg-adm-panel shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
            <Cap>§ Stage Simulation</Cap>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                Stage simulation
              </p>
              <div className="flex flex-wrap gap-2">
                {stageButtons.map(({ stage, label }) => (
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

            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                Customer action simulation
              </p>
              <div className="flex flex-wrap gap-2">
                {actionButtons.map(({ stage, label, variant }) => (
                  <button
                    key={stage}
                    disabled={simLoading !== null}
                    onClick={() => void simulate(stage)}
                    className={adminButtonClass(variant)}
                  >
                    {simLoading === stage ? 'Working…' : label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ════ Section 3: Refresh Cycle History ════ */}
        <section className="rounded-lg border border-adm-border bg-adm-panel shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
            <Cap>§ Refresh Cycle History</Cap>
          </div>
          <div className="divide-y divide-adm-border">
            {detail.refreshCycles.length === 0 && (
              <p className="px-5 py-4 font-mono text-[11px] text-adm-t3">
                No refresh cycles yet.
              </p>
            )}
            {detail.refreshCycles.map((cycle) => {
              const isActive = cycle.id === detail.activeRefreshCycleId;
              return (
                <div
                  key={cycle.id}
                  className={[
                    'px-5 py-3.5 space-y-1.5',
                    isActive ? 'bg-adm-blue/4' : '',
                  ].join(' ')}
                >
                  {/* Header row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {cycle.cycleNo}
                    </span>
                    <AdminBadge value={cycle.status} />
                    {cycle.stage && (
                      <span className="font-mono text-[9px] text-adm-t3">
                        {cycle.stage}
                      </span>
                    )}
                    <span className="font-mono text-[9px] text-adm-t3">
                      Created: {fmtDate(cycle.createdAt)}
                    </span>
                    {cycle.clearedAt && (
                      <span className="font-mono text-[9px] text-adm-t3">
                        Cleared: {fmtDate(cycle.clearedAt)}
                      </span>
                    )}
                    {isActive && (
                      <span className="font-mono text-[9px] font-semibold text-adm-blue">
                        ← active cycle
                      </span>
                    )}
                  </div>

                  {/* Details */}
                  {cycle.sumsubActionId && (
                    <p className="font-mono text-[9px] text-adm-t3">
                      Sumsub Action: {cycle.sumsubActionId}
                    </p>
                  )}
                  {cycle.resolution && (
                    <p className="font-mono text-[9px] text-adm-t3">
                      Resolution: {cycle.resolution}
                    </p>
                  )}
                  {cycle.graceExpiresAt && (
                    <p className="font-mono text-[9px] text-adm-t3">
                      Grace expires: {fmtDateTime(cycle.graceExpiresAt)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
};

export default MaterialHoldingDetailPage;

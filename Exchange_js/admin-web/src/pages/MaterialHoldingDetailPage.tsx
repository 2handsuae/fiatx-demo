import { useEffect, useState } from 'react';
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
  DetailCard,
  InfoField,
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
        <DetailCard title="Holding Details" columns={3}>
          <InfoField label="Customer" value={`${detail.customer.customerNo} (${detail.customer.email})`} link={`/dashboard/customer/management/${detail.customer.id}`} />
          <InfoField label="Material Type" value={detail.materialType} accent />
          <InfoField label="Management Mode" value={detail.managementMode} mono />
          <InfoField label="Status" value={<AdminBadge value={detail.status} />} />
          <InfoField label="Risk Tier" value={<AdminBadge value={detail.customer.riskTier} />} />
          <InfoField label="Sumsub Level" value={detail.customer.sumsubCurrentLevelName} mono />
          <InfoField label="Restriction" value={detail.customer.restrictionStatus ? <AdminBadge value={detail.customer.restrictionStatus} /> : null} />
          <InfoField label="Verified At" value={fmtDate(detail.verifiedAt)} mono />
          <InfoField
            label="Expires At"
            value={detail.expiresAt ? `${fmtDate(detail.expiresAt)} (${daysLabel || ''})` : null}
            highlight={daysLeft !== null && daysLeft !== undefined && daysLeft < 7}
          />
          <InfoField label="Sumsub Action Level" value={detail.sumsubActionLevelName} mono />
        </DetailCard>

        {/* ════ Section 2: Simulation Panel ════ */}
        <DetailCard title="Stage Simulation" columns={1}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                Lifecycle stage simulation
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
            <div className="border-t border-adm-border pt-4">
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
        </DetailCard>

        {/* ════ Section 3: Refresh Cycle History ════ */}
        <DetailCard title="Refresh Cycle History" columns={1}>
          {detail.refreshCycles.length === 0 ? (
            <p className="font-mono text-[11px] text-adm-t3">No refresh cycles yet.</p>
          ) : (
            <div className="divide-y divide-adm-border -mx-4">
              {detail.refreshCycles.map((cycle) => {
                const isActive = cycle.id === detail.activeRefreshCycleId;
                return (
                  <div
                    key={cycle.id}
                    className={`px-4 py-3.5 space-y-1.5 ${isActive ? 'bg-adm-blue/5' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {cycle.cycleNo}
                      </span>
                      <AdminBadge value={cycle.status} />
                      {cycle.stage && (
                        <span className="font-mono text-[9px] text-adm-t3">{cycle.stage}</span>
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
          )}
        </DetailCard>

      </div>
    </div>
  );
};

export default MaterialHoldingDetailPage;

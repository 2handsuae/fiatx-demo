import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

type EntityType = 'DEPOSIT' | 'SWAP' | 'WITHDRAW' | 'INTERNAL_TX';
type AssetType  = 'CRYPTO' | 'FIAT' | 'ALL';

interface AcctEventPayload {
  eventCode: string;
  entityType: EntityType;
  ownerScope: 'CUSTOMER' | 'PLATFORM';
  assetType: AssetType;
  triggerType: string;
  triggerKey: string;
  fromStatus: string | null;
  toStatus: string;
  description: string;
  postingMode: string;
  clearingMode: string;
  isActive: boolean;
}

interface ReleaseContext {
  releaseNo: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
}

/* ── Layout primitives ──────────────────────────────────────────── */

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
  value?: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span className={['min-w-0 break-all text-right text-adm-t2', mono ? 'font-mono text-[10px]' : 'text-[11px]'].join(' ')}>
        {value}
      </span>
    </div>
  );
};

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div className={['grid gap-x-8 gap-y-4', cols === 1 ? 'grid-cols-1' : 'grid-cols-2'].join(' ')}>
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">{label}</p>
      <p className={['break-all leading-relaxed', mono ? 'font-mono text-[10px]' : 'text-[11px]', amber ? 'font-semibold text-adm-amber' : 'text-adm-t2'].join(' ')}>
        {value}
      </p>
    </div>
  );
};

/* ── Display helpers ─────────────────────────────────────────────── */

const ENTITY_BADGE: Record<EntityType, string> = {
  DEPOSIT:     'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
  SWAP:        'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  WITHDRAW:    'border-adm-red/25 bg-adm-red/10 text-adm-red',
  INTERNAL_TX: 'border-adm-green/25 bg-adm-green/10 text-adm-green',
};

const ENTITY_ACCENT: Record<EntityType, string> = {
  DEPOSIT:     'bg-adm-blue',
  SWAP:        'bg-adm-amber',
  WITHDRAW:    'bg-adm-red',
  INTERNAL_TX: 'bg-adm-green',
};

const ASSET_BADGE: Record<AssetType, string> = {
  CRYPTO: 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  FIAT:   'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
  ALL:    'border-adm-border bg-adm-bg text-adm-t3',
};

const EntityBadge = ({ type }: { type: EntityType }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${ENTITY_BADGE[type]}`}>
    {type}
  </span>
);

const AssetBadge = ({ type }: { type: AssetType }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${ASSET_BADGE[type]}`}>
    {type}
  </span>
);

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── State Transition Diagram ────────────────────────────────────
   Signature element: visualises the fromStatus → toStatus lifecycle.
   This is the one thing operators remember about this page.
   ─────────────────────────────────────────────────────────────── */

const StateTransitionDiagram = ({
  fromStatus,
  toStatus,
}: {
  fromStatus: string | null;
  toStatus: string;
}) => (
  <div className="mt-4 flex flex-col gap-2">
    <Cap>State Transition</Cap>
    <div className="flex items-center gap-2 pt-1">
      {/* From state */}
      <div className="min-w-[120px] rounded border border-adm-border bg-adm-bg px-3 py-2">
        <p className="mb-0.5 font-mono text-[7.5px] uppercase tracking-[0.14em] text-adm-t3">From</p>
        <p className="font-mono text-[10px] text-adm-t2 leading-snug">
          {fromStatus ?? <span className="italic text-adm-t3">any state</span>}
        </p>
      </div>

      {/* Arrow */}
      <div className="flex shrink-0 items-center gap-0">
        <div className="h-px w-6 bg-adm-amber/50" />
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-adm-amber">
          <path d="M0 5 L7 5 M4 2 L7 5 L4 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* To state */}
      <div className="min-w-[120px] rounded border border-adm-amber/30 bg-adm-amber/8 px-3 py-2">
        <p className="mb-0.5 font-mono text-[7.5px] uppercase tracking-[0.14em] text-adm-amber/70">To</p>
        <p className="font-mono text-[10px] font-semibold text-adm-amber leading-snug">
          {toStatus}
        </p>
      </div>
    </div>
    <p className="font-mono text-[9px] text-adm-t3">
      Fires on <span className="text-adm-t2">STATUS_TRANSITION</span> trigger
    </p>
  </div>
);

/* ── Component ─────────────────────────────────────────────────── */

const AcctEventDetail = () => {
  const { eventCode } = useParams<{ eventCode: string }>();
  const navigate = useNavigate();

  const [payload, setPayload] = useState<AcctEventPayload | null>(null);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ACCT_EVENT&status=ACTIVE&take=1`,
      );
      if (!relRes.ok)
        throw new Error(await getApiErrorMessage(relRes, 'Failed to fetch releases.'));

      const listData = await relRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active ACCT_EVENT release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo as string}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = (detail.items as Array<{ businessKey: string; payload: unknown }> | undefined)
        ?.find((i) => i.businessKey === eventCode);
      if (!item) throw new Error(`Event "${eventCode ?? ''}" not found in current release.`);

      setPayload(item.payload as AcctEventPayload);
      setRelease({
        releaseNo: detail.releaseNo as string,
        publishedAt: (detail.publishedAt ?? null) as string | null,
        effectiveFrom: (detail.effectiveFrom ?? null) as string | null,
      });
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load event.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [eventCode]);

  if (loading && !payload) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center">
          <button
            onClick={() => navigate('/dashboard/system/acct-events')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Accounting Events
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

  if (!payload) return null;

  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;
  // Synthesise a status string for AdminBadge
  const statusValue = payload.isActive ? 'ACTIVE' : 'DISABLED';

  return (
    <div className="flex h-full flex-col overflow-hidden">

      <DetailPageHeader
        title="Accounting Events · Event Detail"
        subtitle={payload.eventCode}
        onBack={() => navigate('/dashboard/system/acct-events')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Accounting Events"
      />

      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Event</Cap>
            <div className="mt-1.5 flex items-center gap-3">
              <div className={`h-10 w-1 shrink-0 rounded-full ${ENTITY_ACCENT[payload.entityType]}`} />
              <p className="font-mono text-[16px] font-bold leading-snug tracking-tight text-adm-amber break-all">
                {payload.eventCode}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <EntityBadge type={payload.entityType} />
              <AssetBadge type={payload.assetType} />
              <AdminBadge value={statusValue} />
            </div>
            {payload.description && (
              <p className="mt-3 text-[12px] text-adm-t2 leading-relaxed">
                {payload.description}
              </p>
            )}
          </section>

          {/* ② State Transition Diagram — the signature element */}
          <section className="px-6 py-5">
            <StateTransitionDiagram
              fromStatus={payload.fromStatus}
              toStatus={payload.toStatus}
            />
          </section>

          {/* ③ Configuration */}
          <section className="px-6 py-5">
            <Cap>Configuration</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Entity Type"   value={payload.entityType}  mono amber />
                <Field label="Owner Scope"   value={payload.ownerScope}  mono />
                <Field label="Asset Type"    value={payload.assetType}   mono />
                <Field label="Trigger Type"  value={payload.triggerType} mono />
                <Field label="Trigger Key"   value={payload.triggerKey}  mono />
                <Field label="Posting Mode"  value={payload.postingMode} mono />
                <Field label="Clearing Mode" value={payload.clearingMode || 'NONE'} mono />
              </FieldGrid>
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {release && (
            <SidebarGroup title="Release">
              <SidebarKV label="Release No"  value={release.releaseNo}            mono />
              <SidebarKV label="Effective"   value={fmtDate(effectiveDate)}       mono />
              <SidebarKV label="Published"   value={fmtDate(release.publishedAt)} mono />
            </SidebarGroup>
          )}

          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/dashboard/system/acct-events/history')}
              className="text-left font-mono text-[10px] text-adm-amber underline transition-opacity hover:opacity-75"
            >
              View all versions →
            </button>
          </SidebarGroup>

        </div>
      </div>

    </div>
  );
};

export default AcctEventDetail;

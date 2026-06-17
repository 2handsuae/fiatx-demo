import { useEffect, type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, RefreshCw } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  DetailPageHeader,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

type AuditResult = 'SUCCESS' | 'FAILED' | 'REJECTED';

interface AuditLogDetail {
  id: string;
  auditNo: string;
  triggerType: string;
  action: string;
  entityType: string;
  entityNo?: string | null;
  entityOwnerType?: string | null;
  entityOwnerId?: string | null;
  entityOwnerNo?: string | null;
  actorType: string;
  actorId: string;
  actorNo?: string | null;
  actorRole?: string | null;
  result: AuditResult;
  reason?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  occurredAt: string;
  traceId?: string | null;
  workflowType?: string | null;
  requestId?: string | null;
  sourceIp?: string | null;
  sourcePlatform?: string | null;
  metadata?: unknown;
  beforeData?: unknown;
  afterData?: unknown;
  idempotencyKey?: string | null;
  payloadDigest?: string | null;
  maskVersion?: string | null;
  retainedUntil?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;

}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Shared primitives ───────────────────────────────────────── */

/** Dim ALL-CAPS section label */
const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

/** 2-col (default) field grid */
const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div className={['grid gap-x-8 gap-y-4', cols === 1 ? 'grid-cols-1' : 'grid-cols-2'].join(' ')}>
    {children}
  </div>
);

/** Labeled field — renders nothing if value absent */
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
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">{label}</p>
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

/* ── Sidebar primitives ──────────────────────────────────────── */

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
      <span className={['min-w-0 break-all text-right text-adm-t2', mono ? 'font-mono text-[10px]' : 'text-[11px]'].join(' ')}>
        {value}
      </span>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────── */

/* ── Raw Record Block ──────────────────────────────────────────── */

const RawRecordBlock = ({ detail }: { detail: AuditLogDetail }) => {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(detail, null, 2);

  const handleCopy = () => {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="px-6 py-5">
      <div className="flex items-center justify-between">
        <Cap>Raw Record</Cap>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded border border-adm-border bg-adm-card px-2 py-1 font-mono text-[9px] text-adm-t3 transition-colors hover:border-adm-amber hover:text-adm-amber"
        >
          {copied
            ? <><Check size={10} /><span>Copied</span></>
            : <><Copy size={10} /><span>Copy</span></>
          }
        </button>
      </div>
      <pre className="mt-2 overflow-auto rounded bg-gray-950 p-4 font-mono text-[11px] leading-relaxed text-gray-200 border border-gray-800">
        {json}
      </pre>
    </section>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const AuditLogDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = async () => {
    if (!id) { setError('Audit log id is required.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/audit-logs/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load audit log detail.'));
      setDetail((await res.json()) as AuditLogDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load audit log detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button onClick={() => navigate('/admin/audit/logs')} className={adminButtonClass('detailUtility')}>← Back</button>
        </div>
        <div className="flex flex-1 items-center justify-center gap-3">
          <RefreshCw size={22} className="animate-spin text-adm-amber" />
          <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button onClick={() => navigate('/admin/audit/logs')} className={adminButtonClass('detailUtility')}>← Back</button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}><RefreshCw size={13} /> Retry</button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">{error}</div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button onClick={() => navigate('/admin/audit/logs')} className={adminButtonClass('detailUtility')}>← Back</button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Audit log not found.</div>
      </div>
    );
  }

  const hasStateChange = !!(detail.statusFrom || detail.statusTo);
  const hasOwner      = !!(detail.entityOwnerType || detail.entityOwnerId || detail.entityOwnerNo);
  const hasPayload    = detail.metadata != null || detail.beforeData != null || detail.afterData != null;
  const hasWorkflow   = !!(detail.workflowType || detail.traceId);

  const payloadBlocks = [
    detail.metadata   != null && { title: 'Metadata',    value: detail.metadata },
    detail.beforeData != null && { title: 'Before Data', value: detail.beforeData },
    detail.afterData  != null && { title: 'After Data',  value: detail.afterData },
  ].filter(Boolean) as { title: string; value: unknown }[];

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header — back + refresh only ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/audit/logs')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Back to Audit Logs"
      />

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ── 1 · HERO ── */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-none text-adm-amber">
              {detail.auditNo}
            </p>
            <div className="mt-4 border-t border-adm-border pt-4 grid grid-cols-2 gap-x-8 gap-y-3">
              <div className="col-span-2">
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Action</p>
                <p className="text-[15px] font-semibold leading-tight text-adm-t1">{detail.action}</p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Result</p>
                <AdminBadge value={detail.result} />
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Occurred</p>
                <p className="font-mono text-[11px] text-adm-t2">{fmt(detail.occurredAt)}</p>
              </div>
              {detail.reason && (
                <div className="col-span-2">
                  <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Reason</p>
                  <p className="font-mono text-[10px] text-adm-t2">{detail.reason}</p>
                </div>
              )}
            </div>
            {hasStateChange && (
              <div className="mt-5 flex items-stretch gap-0">
                {/* Before */}
                <div className="flex flex-1 flex-col justify-center rounded-l border border-adm-border bg-adm-bg px-5 py-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-adm-t3">Before</p>
                  <p className="mt-1 font-mono text-[12px] text-adm-t2">{detail.statusFrom ?? '—'}</p>
                </div>
                {/* Arrow */}
                <div className="flex items-center border-y border-adm-border bg-adm-bg px-3 text-adm-t3">
                  <ArrowRight size={15} />
                </div>
                {/* After */}
                <div className="flex flex-1 flex-col justify-center rounded-r border border-adm-amber bg-adm-card px-5 py-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-adm-t3">After</p>
                  <p className="mt-1 font-mono text-[12px] font-semibold text-adm-amber">{detail.statusTo ?? '—'}</p>
                </div>
              </div>
            )}
          </section>

          {/* ── 2 · ACTOR ──────────────────────────────────────────
               Who triggered this event. Time is in the Hero Card above. ── */}
          <section className="px-6 py-5">
            <Cap>Actor</Cap>
            <p className="mt-1.5 font-mono text-[15px] font-semibold leading-snug text-adm-amber">
              {detail.actorNo ?? detail.actorId}
            </p>
            <p className="mt-1 font-mono text-[10px] text-adm-t3">
              {[detail.actorType, detail.actorRole].filter(Boolean).join(' · ') || '—'}
            </p>
            {(detail.sourcePlatform || detail.sourceIp) && (
              <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                {[detail.sourcePlatform, detail.sourceIp].filter(Boolean).join(' · ')}
              </p>
            )}
          </section>

          {/* ── 3 · ENTITY ─────────────────────────────────────────
               Entity is the target of the action.
               Type as a dim qualifier, No as the amber identifier.
               Owner detail rendered below only when data exists. ── */}
          <section className="px-6 py-5">
            <Cap>Entity</Cap>
            <div className="mt-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                {detail.entityType}
              </p>
              <p className="mt-1 font-mono text-[14px] font-semibold text-adm-amber">
                {detail.entityNo ?? '—'}
              </p>
            </div>

            {hasOwner && (
              <div className="mt-4 pt-4 border-t border-adm-border">
                <Cap>Owner</Cap>
                <div className="mt-3">
                  <FieldGrid>
                    <Field label="Owner Type" value={detail.entityOwnerType} />
                    <Field label="Owner No"   value={detail.entityOwnerNo}   mono />
                    <Field label="Owner ID"   value={detail.entityOwnerId}   mono full />
                  </FieldGrid>
                </div>
              </div>
            )}
          </section>

          {/* ── 4 · WORKFLOW CONTEXT ───────────────────────────────
               Where in the business process did this event occur?
               Only rendered when at least one workflow field is populated. ── */}
          {hasWorkflow && (
            <section className="px-6 py-5">
              <Cap>Workflow</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field label="Type"        value={detail.workflowType} />
                  <Field label="Trace ID"    value={detail.traceId}      mono full />
                </FieldGrid>
              </div>
            </section>
          )}

          {/* ── 5 · PAYLOAD ── */}
          {hasPayload && (
            <section className="px-6 py-5">
              <Cap>Payload</Cap>
              <div
                className={[
                  'mt-3 grid gap-4',
                  payloadBlocks.length === 1
                    ? 'grid-cols-1'
                    : payloadBlocks.length === 2
                      ? 'grid-cols-1 xl:grid-cols-2'
                      : 'grid-cols-1 xl:grid-cols-3',
                ].join(' ')}
              >
                {payloadBlocks.map((b) => (
                  <JsonBlock key={b.title} title={b.title} value={b.value} />
                ))}
              </div>
            </section>
          )}

          {/* ── 6 · INTEGRITY ── */}
          <section className="px-6 py-5">
            <Cap>Integrity</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Trigger Type"    value={detail.triggerType}                      />
                <Field label="Request ID"      value={detail.requestId}              mono      />
                <Field label="Idempotency Key" value={detail.idempotencyKey}         mono full />
                <Field label="Payload Digest"  value={detail.payloadDigest}          mono full />
                <Field label="Mask Version"    value={detail.maskVersion}                      />
              </FieldGrid>
            </div>
          </section>

          {/* ── 7 · RAW RECORD ── */}
          <RawRecordBlock detail={detail} />

        </div>

        {/* ════ RIGHT SIDEBAR — governance & technical metadata ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Trigger"      value={detail.triggerType} />
            <SidebarKV label="Entity Type"  value={detail.entityType}  />
            <SidebarKV label="Actor Type"   value={detail.actorType}   />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Retained Until" value={fmt(detail.retainedUntil)} mono />
            <SidebarKV label="Archived At"    value={fmt(detail.archivedAt)}    mono />
            <SidebarKV label="Created At"     value={fmt(detail.createdAt)}     mono />
            <SidebarKV label="Updated At"     value={fmt(detail.updatedAt)}     mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
};

export default AuditLogDetailPage;

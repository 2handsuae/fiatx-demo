import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
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
  ownerScope: string;
  assetType: AssetType;
  toStatus: string;
  postingMode: string;
  clearingMode: string;
  isActive: boolean;
}

interface ReleaseItem {
  businessKey: string;
  revisionNo: number;
  payload: AcctEventPayload;
}

interface ValidationSummary {
  ok: boolean;
  issues?: string[];
  warnings?: string[];
  validatedAt?: string;
}

interface Release {
  releaseNo: string;
  status: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
  publishedBy: string | null;
  basedOnReleaseNo: string | null;
  changeTicketId: string | null;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: ReleaseItem[];
  validationSummary: ValidationSummary | null;
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

/* ── Display helpers ─────────────────────────────────────────────── */

const ENTITY_BADGE: Record<EntityType, string> = {
  DEPOSIT:     'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
  SWAP:        'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  WITHDRAW:    'border-adm-red/25 bg-adm-red/10 text-adm-red',
  INTERNAL_TX: 'border-adm-green/25 bg-adm-green/10 text-adm-green',
};

const ACCENT_COLOR: Record<AssetType, string> = {
  CRYPTO: 'bg-adm-amber',
  FIAT:   'bg-adm-blue',
  ALL:    'bg-adm-t3/50',
};

const EntityBadge = ({ type }: { type: EntityType }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${ENTITY_BADGE[type] ?? 'border-adm-border text-adm-t3'}`}>
    {type}
  </span>
);

const EnabledDot = ({ v }: { v: boolean }) => (
  <span className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium ${v ? 'text-adm-green' : 'text-adm-t3'}`}>
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v ? 'bg-adm-green' : 'bg-adm-t3'}`} />
    {v ? 'On' : 'Off'}
  </span>
);

const fmtDate = (v?: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

const COLS = ['Event Code', 'Entity', 'Scope', 'Asset', 'To Status', 'Posting', 'Clearing', 'Active'] as const;

/* ── Component ─────────────────────────────────────────────────── */

const AcctEventSnapshot = () => {
  const { releaseNo } = useParams<{ releaseNo: string }>();
  const navigate = useNavigate();

  const [release, setRelease] = useState<Release | null>(null);
  const [effectiveUntil, setEffectiveUntil] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, listRes] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/business-config/releases/${releaseNo}`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ACCT_EVENT&take=50`),
      ]);

      if (!detailRes.ok) throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release.'));
      const detail = await detailRes.json() as Release;
      setRelease(detail);

      if (listRes.ok) {
        const listData = await listRes.json();
        const all: Array<{ releaseNo: string; effectiveFrom: string | null; publishedAt: string | null }> =
          listData?.items ?? [];
        const idx = all.findIndex((r) => r.releaseNo === releaseNo);
        if (idx > 0) {
          const newer = all[idx - 1];
          setEffectiveUntil(newer.effectiveFrom ?? newer.publishedAt ?? null);
        }
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load snapshot.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, [releaseNo]);

  const isActive = release?.status === 'ACTIVE';
  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;
  const validation = release?.validationSummary;
  const hasIssues = validation && !validation.ok && (validation.issues?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      <DetailPageHeader
        title={isActive ? 'Accounting Events · Current Release' : 'Accounting Events · Historical Snapshot'}
        subtitle={releaseNo ?? ''}
        onBack={() => navigate('/dashboard/system/acct-events/history')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Version History"
      >
        <div className="flex items-center gap-2">
          {release && <AdminBadge value={release.status} />}
          {release && !isActive && (
            <button
              onClick={() => navigate('/dashboard/system/acct-events')}
              className={adminButtonClass('listSecondary')}
            >
              View current →
            </button>
          )}
        </div>
      </DetailPageHeader>

      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT: events table ════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-1 border-b border-adm-border bg-adm-panel" />
                  {COLS.map((label) => (
                    <th
                      key={label}
                      className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && (release?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                      No items in this release.
                    </td>
                  </tr>
                )}
                {!loading && (release?.items ?? []).map((item) => {
                  const p = item.payload;
                  return (
                    <tr key={item.businessKey} className="border-b border-adm-border">
                      <td className="py-3 pl-3">
                        <div className={`h-5 w-0.5 rounded-full ${ACCENT_COLOR[p.assetType] ?? 'bg-adm-t3/50'}`} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                        {p.eventCode}
                      </td>
                      <td className="px-4 py-3">
                        <EntityBadge type={p.entityType} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                        {p.ownerScope}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                        {p.assetType}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                        {p.toStatus || <span className="text-adm-t3">—</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[110px]">
                        <span className="block truncate font-mono text-[11px] text-adm-t2" title={p.postingMode}>
                          {p.postingMode || <span className="text-adm-t3">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[110px]">
                        <span className="block truncate font-mono text-[11px] text-adm-t2" title={p.clearingMode}>
                          {p.clearingMode || <span className="text-adm-t3">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <EnabledDot v={p.isActive} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && release && (
            <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
              <span className="font-mono text-[10px] text-adm-t3">
                {release.itemCount} event{release.itemCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          <SidebarGroup title="Release">
            <SidebarKV label="Release No"   value={release?.releaseNo}                              mono />
            <SidebarKV label="Items"        value={release ? String(release.itemCount) : undefined} mono />
            <SidebarKV label="Based On"     value={release?.basedOnReleaseNo ?? undefined}          mono />
            <SidebarKV label="Published By" value={release?.publishedBy ?? undefined}               />
          </SidebarGroup>

          <SidebarGroup title="Timeline">
            <SidebarKV label="Effective" value={fmtDate(effectiveDate)}         mono />
            <SidebarKV
              label="Until"
              value={
                isActive
                  ? <span className="text-adm-green">Ongoing</span>
                  : fmtDate(effectiveUntil) !== '—' ? fmtDate(effectiveUntil) : undefined
              }
              mono={!isActive}
            />
            <SidebarKV label="Published" value={fmtDate(release?.publishedAt)} mono />
            <SidebarKV label="Created"   value={fmtDate(release?.createdAt)}   mono />
          </SidebarGroup>

          {validation && (
            <SidebarGroup title="Validation">
              <SidebarKV
                label="Result"
                value={
                  validation.ok
                    ? <span className="text-adm-green">OK</span>
                    : <span className="text-adm-red">{validation.issues?.length ?? 0} issue{(validation.issues?.length ?? 0) !== 1 ? 's' : ''}</span>
                }
              />
              <SidebarKV label="Validated At" value={fmtDate(validation.validatedAt)} mono />
              {hasIssues && validation.issues?.map((issue, i) => (
                <div key={i} className="font-mono text-[9px] text-adm-red leading-relaxed">· {issue}</div>
              ))}
              {(validation.warnings ?? []).length > 0 && (
                <>
                  <SidebarKV label="Warnings" value={String((validation.warnings ?? []).length)} />
                  {(validation.warnings ?? []).map((w, i) => (
                    <div key={i} className="font-mono text-[9px] text-adm-yellow leading-relaxed">· {w}</div>
                  ))}
                </>
              )}
            </SidebarGroup>
          )}

          {(release?.changeTicketId || release?.approvalCaseId) && (
            <SidebarGroup title="Governance">
              <SidebarKV label="Change Ticket" value={release.changeTicketId ?? undefined} mono />
              <SidebarKV label="Approval Case" value={release.approvalCaseId ?? undefined} mono />
            </SidebarGroup>
          )}

        </div>
      </div>

    </div>
  );
};

export default AcctEventSnapshot;

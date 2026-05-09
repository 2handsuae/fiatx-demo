import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Types ────────────────────────────────────────────────────── */

interface RolePermission {
  code: string;
  method: string;
  path: string;
  name: string;
  description: string;
}

interface RoleMember {
  id: string;
  userNo: string;
  email: string;
  status: string;
}

interface RoleDetail {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
  members: RoleMember[];
}

/* ── API types (from GET /admin/iam/action-buckets) ───────── */

interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: string[];
}

interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}

interface ActionBucketCatalogResponse {
  domains: ActionDomain[];
  permCodeToGroups: Record<string, string[]>;
}

/* ── Shared sidebar primitives ────────────────────────────────── */

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
      {title}
    </p>
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
  if (value === null || value === undefined || value === '') return null;
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

/* ── Action bucket row ───────────────────────────────────────── */

const BucketRow = ({
  bucket,
  held,
}: {
  bucket: ActionBucket;
  held: boolean;
}) => (
  <div
    className={[
      'flex items-center gap-2.5 py-2',
      held ? '' : 'opacity-40',
    ].join(' ')}
    title={bucket.description}
  >
    {held ? (
      <Check size={12} className="shrink-0 text-adm-green" />
    ) : (
      <span className="shrink-0 font-mono text-[12px] leading-none text-adm-red">✗</span>
    )}
    <span
      className={[
        'font-mono text-[10px] leading-relaxed',
        held ? 'text-adm-t1' : 'text-adm-t3',
      ].join(' ')}
    >
      {bucket.label}
    </span>
  </div>
);

/* ── Domain capability card ──────────────────────────────────── */

const DomainCard = ({
  domain,
  heldGroups,
}: {
  domain: ActionDomain;
  heldGroups: Set<string>;
}) => (
  <div className="overflow-hidden rounded-lg border border-adm-border bg-adm-card">
    {/* Header */}
    <div className="flex items-center gap-2 border-b border-adm-border px-4 py-3">
      <span className="text-sm leading-none">{domain.icon}</span>
      <span className="font-mono text-[11px] font-semibold text-adm-t1">
        {domain.label}
      </span>
    </div>
    {/* Bucket rows */}
    <div className="divide-y divide-adm-border/40 px-4">
      {domain.buckets.map((bucket) => (
        <BucketRow
          key={bucket.key}
          bucket={bucket}
          held={bucket.groups.some((g) => heldGroups.has(g))}
        />
      ))}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Main page
   ═══════════════════════════════════════════════════════════════ */

const RoleDetailPage = () => {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode ? decodeURIComponent(rawCode) : '';
  const navigate = useNavigate();

  const [detail, setDetail]   = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [catalog, setCatalog] = useState<ActionBucketCatalogResponse | null>(null);

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!code) {
      setError('Role code is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to load role catalog.'));
      }
      const payload = (await res.json()) as RoleDetail[];
      const found = payload.find((r) => r.code === code) ?? null;
      setDetail(found);
      if (!found) setError(`Role "${code}" not found in catalog.`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view the role catalog.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load role detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/action-buckets`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as ActionBucketCatalogResponse;
        setCatalog(data);
      })
      .catch(() => {});
  }, []);

  /* ── Derive held permission groups from returned routes ── */

  const heldGroups = useMemo(() => {
    const s = new Set<string>();
    if (!catalog) return s;
    for (const p of detail?.permissions ?? []) {
      const groups = catalog.permCodeToGroups[p.code];
      if (groups) {
        for (const g of groups) s.add(g);
      }
    }
    return s;
  }, [detail, catalog]);

  /* ── Visible domains: only those with at least one held bucket ── */
  const visibleDomains = useMemo(
    () => (catalog?.domains ?? []).filter((d) =>
      d.buckets.length > 0 &&
      d.buckets.some((b) => b.groups.some((g) => heldGroups.has(g)))
    ),
    [catalog, heldGroups],
  );

  /* ── Loading ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={22} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  /* ── Error (no detail) ── */

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button onClick={() => navigate('/dashboard/members/roles')} className={adminButtonClass('detailUtility')}>
            ← Back
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
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
          <button onClick={() => navigate('/dashboard/members/roles')} className={adminButtonClass('detailUtility')}>
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Role not found.</div>
      </div>
    );
  }

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Sticky nav header */}
      <DetailPageHeader
        title="Role"
        onBack={() => navigate('/dashboard/members/roles')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Roles"
      />

      {/* Inline error banner */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* Body — two-panel layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto divide-y divide-adm-border">

          {/* ① Identity banner */}
          <section className="bg-adm-card px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
                  Role
                </p>
                <p className="mt-1.5 font-mono text-[20px] font-bold leading-tight text-adm-amber">
                  {detail.code}
                </p>
                <p className="mt-1 font-mono text-[12px] text-adm-t2">{detail.name || '—'}</p>
              </div>
              <AdminBadge value={detail.status} />
            </div>
            {detail.description && (
              <p className="mt-3 border-t border-adm-border pt-3 font-mono text-[10px] leading-relaxed text-adm-t3">
                {detail.description}
              </p>
            )}
          </section>

          {/* ② Domain capability cards */}
          <section className="flex-1 px-6 py-5">
            <p className="mb-4 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
              Capabilities · V1
            </p>
            <div className="flex flex-col gap-3">
              {visibleDomains.length === 0 ? (
                <div className="py-10 text-center font-mono text-[11px] text-adm-t3">
                  No permission domains assigned to this role.
                </div>
              ) : (
                visibleDomains.map((domain) => (
                  <DomainCard
                    key={domain.id}
                    domain={domain}
                    heldGroups={heldGroups}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[240px] min-w-[240px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
          {/* Quick Info */}
          <SidebarGroup title="Quick Info">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Status</span>
              <AdminBadge value={detail.status} />
            </div>
            <SidebarKV
              label="Domains"
              value={`${visibleDomains.length} / ${(catalog?.domains ?? []).filter(d => d.buckets.length > 0).length}`}
              mono
            />
            <SidebarKV
              label="API Routes"
              value={String(detail.permissions?.length ?? 0)}
              mono
            />
          </SidebarGroup>

          {/* Members */}
          <SidebarGroup title={`Members (${detail.members?.length ?? 0})`}>
            {(detail.members ?? []).length === 0 ? (
              <p className="font-mono text-[9px] text-adm-t3">No members hold this role.</p>
            ) : (
              <>
                {(detail.members ?? []).map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2.5 py-1.5"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-adm-amber/15 font-mono text-[9px] font-semibold text-adm-amber">
                      {member.email
                        .split('@')[0]
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[10px] text-adm-t2">
                        {member.email}
                      </p>
                      <p className="font-mono text-[8px] text-adm-t3">
                        {member.userNo}
                      </p>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/members')}
                  className="mt-2 font-mono text-[9px] text-adm-t3 transition-colors hover:text-adm-t2"
                >
                  → View all in Members page
                </button>
              </>
            )}
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default RoleDetailPage;

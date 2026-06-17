import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Pencil, RefreshCw, X } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

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
  forcedOn?: boolean;
  restricted?: boolean;
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

  const { hasPermission } = useAdminSession();
  const canModify = hasPermission(PERMISSIONS.IAM_ROLE_DEFINITIONS_MODIFY);

  /* Modify modal state */
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyName, setModifyName] = useState('');
  const [modifyDescription, setModifyDescription] = useState('');
  const [modifySelectedBuckets, setModifySelectedBuckets] = useState<Set<string>>(new Set());
  const [modifyReason, setModifyReason] = useState('');
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [modifyLoading, setModifyLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  /* Notice auto-dismiss */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

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

  /* Open modify modal — pre-fill current values */
  const openModifyModal = () => {
    if (!detail || !catalog) return;
    setModifyName(detail.name || '');
    setModifyDescription(detail.description || '');
    /* Pre-select currently held buckets */
    const held = new Set<string>();
    for (const domain of catalog.domains) {
      for (const bucket of domain.buckets) {
        if (bucket.groups.some((g) => heldGroups.has(g))) {
          held.add(bucket.key);
        }
      }
    }
    setModifySelectedBuckets(held);
    setModifyReason('');
    setModifyError(null);
    setShowModifyModal(true);
  };

  const closeModifyModal = () => {
    setShowModifyModal(false);
    setModifyError(null);
  };

  const submitModify = async () => {
    if (!detail) return;
    setModifyError(null);
    const name = modifyName.trim();
    const reason = modifyReason.trim();
    const hasForcedBuckets = (catalog?.domains ?? []).some((d) => d.buckets.some((b) => b.forcedOn));
    if (!name || (!hasForcedBuckets && modifySelectedBuckets.size === 0) || !reason) {
      setModifyError('Name, at least one capability, and change reason are required.');
      return;
    }
    setModifyLoading(true);
    try {
      const domainsWithBuckets = (catalog?.domains ?? []).filter((d) => d.buckets.length > 0);
      const permissionGroupCodes = Array.from(new Set(
        domainsWithBuckets
          .flatMap((d) => d.buckets)
          .filter((b) => !b.restricted && (b.forcedOn || modifySelectedBuckets.has(b.key)))
          .flatMap((b) => b.groups),
      ));
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-definitions/${detail.id}/modify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedName: name,
            proposedDescription: modifyDescription.trim() || undefined,
            proposedPermissionGroups: permissionGroupCodes,
            changeReason: reason,
          }),
        },
      );
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to submit modify request.');
        setModifyError(msg);
        return;
      }
      const data = (await res.json()) as { approvalNo: string; requestNo: string };
      closeModifyModal();
      void fetchDetail();
      setNotice(`Role modify approval ${data.approvalNo} submitted for ${detail.code}.`);
    } catch (err: unknown) {
      setModifyError(err instanceof Error ? err.message : 'Failed to submit.');
    } finally {
      setModifyLoading(false);
    }
  };

  /* ── Loading ── */

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button onClick={() => navigate('/admin/iam/roles')} className={adminButtonClass('detailUtility')}>
            ← Back
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center gap-3">
          <RefreshCw size={22} className="animate-spin text-adm-amber" />
          <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
        </div>
      </div>
    );
  }

  /* ── Error (no detail) ── */

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button onClick={() => navigate('/admin/iam/roles')} className={adminButtonClass('detailUtility')}>
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
          <button onClick={() => navigate('/admin/iam/roles')} className={adminButtonClass('detailUtility')}>
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
        onBack={() => navigate('/admin/iam/roles')}
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

      {notice && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
            {notice}
          </div>
        </div>
      )}

      {/* Body — two-panel layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto divide-y divide-adm-border">

          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.code}
            </p>
            <div className="mt-4 border-t border-adm-border pt-4 grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Status</p>
                <AdminBadge value={detail.status} />
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Name</p>
                <p className="font-mono text-[11px] text-adm-t2">{detail.name || '—'}</p>
              </div>
              {detail.description && (
                <div className="col-span-2">
                  <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Description</p>
                  <p className="font-mono text-[10px] leading-relaxed text-adm-t3">{detail.description}</p>
                </div>
              )}
            </div>
          </section>

          {/* ② Capabilities */}
          <section className="px-6 py-5">
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

          {/* ③ Members */}
          <section className="px-6 py-5">
            <p className="mb-4 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
              Members ({detail.members?.length ?? 0})
            </p>
            {(detail.members ?? []).length === 0 ? (
              <p className="font-mono text-[11px] text-adm-t3">No members hold this role.</p>
            ) : (
              <div className="flex flex-col divide-y divide-adm-border/40">
                {(detail.members ?? []).map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5 py-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-adm-amber/15 font-mono text-[9px] font-semibold text-adm-amber">
                      {member.email.split('@')[0].slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[10px] text-adm-t2">{member.email}</p>
                      <p className="font-mono text-[8px] text-adm-t3">{member.userNo}</p>
                    </div>
                    <AdminBadge value={member.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {canModify && detail.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
                Actions
              </p>
              <div className="mt-2.5 flex flex-col gap-2">
                <button
                  onClick={openModifyModal}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <Pencil size={13} />
                  Modify Role
                </button>
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
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
              label="Permissions"
              value={String(detail.permissions?.length ?? 0)}
              mono
            />
          </SidebarGroup>
        </div>
      </div>

      {/* ════ Modify Role Modal ════ */}
      {showModifyModal && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Modify Role Definition
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Submits an approval request. Changes take effect after approval.
                </p>
              </div>
              <button
                onClick={closeModifyModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">

              {/* Role Code (read-only) */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Code
                </p>
                <p className="font-mono text-[11px] font-semibold text-adm-amber">
                  {detail.code}
                </p>
              </div>

              {/* Role Name */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Name
                </p>
                <input
                  value={modifyName}
                  onChange={(e) => setModifyName(e.target.value)}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Description (optional)
                </p>
                <input
                  value={modifyDescription}
                  onChange={(e) => setModifyDescription(e.target.value)}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Capabilities */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Capabilities
                </p>
                <div className="space-y-2">
                  {(catalog?.domains ?? [])
                    .filter((d) => d.buckets.length > 0)
                    .map((domain) => (
                      <div key={domain.id}>
                        <p className="flex items-center gap-1.5 py-1 font-mono text-[10px] font-semibold text-adm-t2">
                          <span>{domain.icon}</span>
                          {domain.label}
                        </p>
                        <div className="space-y-1">
                          {domain.buckets.map((bucket) => (
                            <label
                              key={bucket.key}
                              className={`flex gap-3 rounded border border-adm-border bg-adm-bg p-3 ${bucket.forcedOn || bucket.restricted ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-adm-card'}`}
                              title={bucket.restricted ? 'Restricted — CISO only' : bucket.forcedOn ? 'Required — cannot be disabled' : bucket.description}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={bucket.forcedOn ? true : bucket.restricted ? false : modifySelectedBuckets.has(bucket.key)}
                                disabled={bucket.forcedOn || bucket.restricted}
                                onChange={(e) => {
                                  if (bucket.forcedOn || bucket.restricted) return;
                                  setModifySelectedBuckets((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(bucket.key);
                                    } else {
                                      next.delete(bucket.key);
                                    }
                                    return next;
                                  });
                                }}
                              />
                              <div>
                                <p className="font-mono text-[10px] font-semibold text-adm-t1">
                                  {bucket.label}
                                  {bucket.forcedOn && <span className="ml-1.5 text-[8px] text-adm-t3">(required)</span>}
                                  {bucket.restricted && <span className="ml-1.5 text-[8px] text-adm-t3">(CISO only)</span>}
                                </p>
                                <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                                  {bucket.description}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Change Reason */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Change Reason
                </p>
                <textarea
                  value={modifyReason}
                  onChange={(e) => setModifyReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this role definition change is needed."
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors resize-none"
                />
              </div>

              {modifyError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {modifyError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeModifyModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitModify()}
                disabled={modifyLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {modifyLoading ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default RoleDetailPage;

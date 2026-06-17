import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RolePermission {
  code: string;
  method: string;
  path: string;
  name: string;
  description: string;
}

interface RoleItem {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
}

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

/* ─────────────────────────────────────────────────────────────── */

const RolesPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.IAM_ROLE_DEFINITIONS_CREATE);

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Filters — client-side */
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /* Create modal state */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [selectedBucketKeys, setSelectedBucketKeys] = useState<Set<string>>(new Set());
  const [createReason, setCreateReason] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [actionDomains, setActionDomains] = useState<ActionDomain[]>([]);

  /* Success notice with auto-dismiss */
  const [notice, setNotice] = useState<string | null>(null);

  /* ── Data fetching ── */

  const loadRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load roles.'));
      }
      const payload = (await response.json()) as RoleItem[];
      setRoles(Array.isArray(payload) ? payload : []);
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view the role catalog.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load roles.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRoles(); }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Action buckets fetch (when create modal opens) ── */

  useEffect(() => {
    if (!showCreateModal) return;
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/action-buckets`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { domains: ActionDomain[] };
        setActionDomains((data.domains ?? []).filter((d) => d.buckets.length > 0));
      })
      .catch(() => {});
  }, [showCreateModal]);

  /* ── Modal open/close helpers ── */

  const openCreateModal = () => setShowCreateModal(true);
  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateCode('');
    setCreateName('');
    setCreateDescription('');
    setSelectedBucketKeys(new Set());
    setCreateReason('');
    setCreateError(null);
  };

  /* ── Submit create ── */

  const submitCreate = async () => {
    setCreateError(null);
    const code = createCode.trim().toUpperCase();
    const name = createName.trim();
    const reason = createReason.trim();
    const hasForcedBuckets = actionDomains.some((d) => d.buckets.some((b) => b.forcedOn));
    if (!code || !name || (!hasForcedBuckets && selectedBucketKeys.size === 0) || !reason) {
      setCreateError('All fields except description are required.');
      return;
    }
    setCreateLoading(true);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-definitions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roleCode: code,
            roleName: name,
            description: createDescription.trim() || undefined,
            permissionGroupCodes: Array.from(new Set(
              actionDomains
                .flatMap((d) => d.buckets)
                .filter((b) => !b.restricted && (b.forcedOn || selectedBucketKeys.has(b.key)))
                .flatMap((b) => b.groups),
            )),
            changeReason: reason,
          }),
        },
      );
      if (!response.ok) {
        const msg = await getApiErrorMessage(response, 'Failed to submit');
        setCreateError(msg);
        return;
      }
      const res = (await response.json()) as { approvalNo: string };
      closeCreateModal();
      void loadRoles();
      setNotice(`Role definition approval ${res.approvalNo} submitted for ${code}.`);
    } catch (err: unknown) {
      if (err instanceof AdminPermissionError) {
        setCreateError('Permission denied. You cannot submit role definition requests.');
      } else {
        setCreateError(err instanceof Error ? err.message : 'Failed to submit.');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  /* ── Derived ── */

  const filteredRoles = useMemo(() => {
    const kw = applied.trim().toLowerCase();
    return roles.filter((r) => {
      const matchKw =
        !kw ||
        r.code?.toLowerCase().includes(kw) ||
        r.name?.toLowerCase().includes(kw) ||
        r.description?.toLowerCase().includes(kw);
      const matchStatus = !statusFilter || r.status === statusFilter;
      return matchKw && matchStatus;
    });
  }, [applied, statusFilter, roles]);

  const totalPermissions = useMemo(
    () => roles.reduce((sum, r) => sum + (r.permissions?.length ?? 0), 0),
    [roles],
  );

  const hasFilter = !!keyword.trim() || !!applied.trim() || !!statusFilter;

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Roles"
        meta={`${roles.length} role${roles.length === 1 ? '' : 's'} · ${totalPermissions} permission bindings · Identity & Access`}
      >
        {canCreate && (
          <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
            <Plus size={13} />
            Create Role
          </button>
        )}
        <button
          onClick={() => void loadRoles()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setApplied(keyword.trim())}
          placeholder="Code / Name / Description"
          className={`${fi} w-56`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All Status</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
        </select>
        <button
          onClick={() => setApplied(keyword.trim())}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button
          onClick={() => { setKeyword(''); setApplied(''); setStatusFilter(''); }}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {/* ── Notices ── */}
      {notice && (
        <div className="shrink-0 border-b border-adm-green/20 bg-adm-green/6 px-5 py-2.5 font-mono text-[11px] text-adm-green">
          {notice}
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Code',        '200px'],
                  ['Name',        '200px'],
                  ['Status',      '130px'],
                  ['Permissions', '130px'],
                  ['Description', 'auto'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
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
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredRoles.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  {roles.length === 0 ? 'No roles found.' : 'No roles match the current filters.'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredRoles.map((role) => (
                <tr
                  key={role.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/iam/roles/${encodeURIComponent(role.code)}`)}
                >
                  {/* Code — amber mono dominant identifier */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {role.code || '—'}
                    </span>
                  </td>
                  {/* Name */}
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                    {role.name || <span className="text-adm-t3">—</span>}
                  </td>
                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={role.status} />
                  </td>
                  {/* Permissions count */}
                  <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                    {role.permissions?.length ?? 0}
                  </td>
                  {/* Description */}
                  <td className="max-w-0 px-4 py-2.5 font-mono text-[10px] text-adm-t3">
                    <span className="block truncate">
                      {role.description || '—'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          Showing {filteredRoles.length} / {roles.length} role{roles.length === 1 ? '' : 's'}
          {' · '}
          Fixed backend catalog
        </span>
      </div>

      {/* ════ Create Role Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Create Role Definition
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Submits an approval request. The role becomes active after approval.
                </p>
              </div>
              <button
                onClick={closeCreateModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">

              {/* Role Code */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Code
                </p>
                <input
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  placeholder="e.g. RISK_ANALYST"
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors uppercase"
                />
              </div>

              {/* Role Name */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Name
                </p>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Risk Analyst"
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Description (optional)
                </p>
                <input
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Capabilities */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Capabilities
                </p>
                <div className="space-y-2">
                  {actionDomains.length === 0 && (
                    <p className="font-mono text-[10px] text-adm-t3">Loading…</p>
                  )}
                  {actionDomains.map((domain) => (
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
                              checked={bucket.forcedOn ? true : bucket.restricted ? false : selectedBucketKeys.has(bucket.key)}
                              disabled={bucket.forcedOn || bucket.restricted}
                              onChange={(e) => {
                                if (bucket.forcedOn || bucket.restricted) return;
                                setSelectedBucketKeys((prev) => {
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
                  value={createReason}
                  onChange={(e) => setCreateReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this role definition is needed."
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors resize-none"
                />
              </div>

              {createError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {createError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitCreate()}
                disabled={createLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {createLoading ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default RolesPage;

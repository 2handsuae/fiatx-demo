import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface Member {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  firstLoginStatus: string | null;
  mfaEnabledAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  roles?: string[];
}

interface RoleCatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: Array<{
    code: string;
    method: string;
    path: string;
    name: string;
    description: string;
  }>;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** Returns a short label + color when the user's security setup is incomplete. */
const getSecurityBadge = (
  firstLoginStatus: string | null,
  mfaEnabledAt: string | null,
): { label: string; color: string } | null => {
  if (!firstLoginStatus || firstLoginStatus === 'COMPLETED') {
    // Defensive: COMPLETED but MFA somehow missing
    if (!mfaEnabledAt) return { label: 'MFA Off', color: 'text-adm-amber border-adm-amber/25 bg-adm-amber/10' };
    return null; // normal — no badge
  }
  const map: Record<string, string> = {
    PENDING_IDENTITY_CONFIRM: 'Setup Pending',
    MFA_BINDING: 'MFA Pending',
  };
  return {
    label: map[firstLoginStatus] || firstLoginStatus,
    color: 'text-adm-amber border-adm-amber/25 bg-adm-amber/10',
  };
};

/* ─────────────────────────────────────────────────────────────── */

const PlatformMembers = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [members, setMembers]           = useState<Member[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<RoleCatalogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  /* Filters — client-side */
  const [keyword, setKeyword]       = useState('');
  const [applied, setApplied]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /* Create modal */
  const [isCreateOpen, setIsCreateOpen]     = useState(false);
  const [createEmail, setCreateEmail]       = useState('');
  const [createRoleCodes, setCreateRoleCodes] = useState<string[]>([]);
  const [createReason, setCreateReason]     = useState('');
  const [creating, setCreating]             = useState(false);
  const [createError, setCreateError]       = useState<string | null>(null);

  /* Permissions */
  const canReadRoleCatalog = hasAnyPermission([PERMISSIONS.IAM_ROLES_READ]);
  const canCreateMember    = hasAnyPermission([PERMISSIONS.USERS_CREATE]);

  /* ── Data fetching ── */

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await adminFetch(url, init);
    if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Request failed.'));
    return (await res.json()) as T;
  };

  const refreshData = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetches: Promise<unknown>[] = [
        fetchJson<Member[]>(`${import.meta.env.VITE_API_URL}/users`).then(setMembers),
      ];
      if (canReadRoleCatalog || canCreateMember) {
        fetches.push(
          fetchJson<RoleCatalogItem[]>(`${import.meta.env.VITE_API_URL}/admin/iam/roles`).then(
            setRolesCatalog,
          ),
        );
      }
      await Promise.all(fetches);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this resource.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load platform members.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshData(); }, [canReadRoleCatalog, canCreateMember]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Derived ── */

  const filteredMembers = useMemo(() => {
    const kw = applied.trim().toLowerCase();
    return members.filter((m) => {
      const matchKw =
        !kw ||
        m.email?.toLowerCase().includes(kw) ||
        m.userNo?.toLowerCase().includes(kw);
      const matchStatus = !statusFilter || m.status === statusFilter;
      return matchKw && matchStatus;
    });
  }, [applied, statusFilter, members]);

  const activeRoles = useMemo(
    () => rolesCatalog.filter((r) => r.status === 'ACTIVE'),
    [rolesCatalog],
  );

  const hasFilter = !!keyword.trim() || !!applied.trim() || !!statusFilter;

  /* ── Create modal ── */

  const toggleRoleCode = (
    setter: Dispatch<SetStateAction<string[]>>,
    code: string,
  ) => {
    setter((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code].sort()));
  };

  const openCreateModal = () => {
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateReason('');
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateReason('');
    setCreateError(null);
  };

  const submitCreate = async () => {
    const email = createEmail.trim().toLowerCase();
    if (!email)                   { setCreateError('Email is required.'); return; }
    if (!createRoleCodes.length)  { setCreateError('Select at least one role.'); return; }
    if (!createReason.trim())     { setCreateError('Change reason is required.'); return; }

    setCreating(true); setCreateError(null);
    try {
      const payload = await fetchJson<{ userNo: string; approvalNo: string; status: string }>(
        `${import.meta.env.VITE_API_URL}/users`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            roleCodes: createRoleCodes,
            changeReason: createReason.trim(),
          }),
        },
      );
      closeCreateModal();
      setNotice(
        `Invite approval ${payload.approvalNo} submitted for ${email} (${payload.userNo}). The member will receive an invitation link once the CISO approves.`,
      );
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setCreateError('Permission denied. You cannot submit provisioning requests.');
      } else {
        setCreateError(err instanceof Error ? err.message : 'Failed to create provisioning request.');
      }
    } finally {
      setCreating(false);
    }
  };

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Platform Members"
        meta={`${members.length} members · Identity & Access`}
      >
        {canCreateMember && (
          <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
            <Plus size={13} />
            Invite Member
          </button>
        )}
        <button
          onClick={() => void refreshData()}
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
          placeholder="User No / Email"
          className={`${fi} w-44`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${fi} w-52`}
        >
          <option value="">All Status</option>
          <option value="PENDING_INVITE_APPROVAL">PENDING_INVITE_APPROVAL</option>
          <option value="INVITE_SENT">INVITE_SENT</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="PENDING_SUSPENSION_APPROVAL">PENDING_SUSPENSION_APPROVAL</option>
          <option value="SUSPENDED">SUSPENDED</option>
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
                  ['User No',    '148px'],
                  ['Email',      '220px'],
                  ['Roles',      '200px'],
                  ['Status',     '90px'],
                  ['MFA',        '100px'],
                  ['Joined',     '130px'],
                  ['Last Login', 'auto'],
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
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredMembers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No members found.
                </td>
              </tr>
            )}
            {!loading &&
              filteredMembers.map((member) => {
                const roleCodes =
                  member.roles && member.roles.length > 0 ? member.roles : [member.role];

                return (
                  <tr
                    key={member.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/iam/members/${member.id}`)}
                  >
                    {/* User No */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {member.userNo || '—'}
                      </span>
                    </td>
                    {/* Email */}
                    <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2">
                      {member.email || '—'}
                    </td>
                    {/* Roles */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {roleCodes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center rounded border border-adm-blue/25 bg-adm-blue/10 px-2 py-0.5 font-mono text-[9px] text-adm-blue"
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-2.5">
                      <AdminBadge value={member.status} />
                    </td>
                    {/* MFA */}
                    <td className="px-4 py-2.5">
                      {(() => {
                        const badge = getSecurityBadge(member.firstLoginStatus, member.mfaEnabledAt);
                        if (!badge) {
                          return (
                            <span className="inline-flex items-center rounded border border-adm-green/25 bg-adm-green/10 px-2 py-0.5 font-mono text-[9px] text-adm-green">
                              Active
                            </span>
                          );
                        }
                        return (
                          <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] ${badge.color}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    {/* Joined */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </td>
                    {/* Last Login */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {fmt(member.lastLoginAt)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          Showing {filteredMembers.length} / {members.length} members
        </span>
      </div>

      {/* ════ Create Provisioning Modal ════ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Invite Admin Member
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Submits a CISO approval request. The invite link is dispatched after approval.
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

              {/* Email */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Email
                </p>
                <input
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  type="email"
                  placeholder="new-admin@example.com"
                  className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors"
                />
              </div>

              {/* Role Codes */}
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Role Codes
                </p>
                {activeRoles.length === 0 ? (
                  <p className="font-mono text-[10px] text-adm-t3">No active roles available.</p>
                ) : (
                  <div className="space-y-2">
                    {activeRoles.map((role) => (
                      <label
                        key={role.id}
                        className="flex cursor-pointer gap-3 rounded border border-adm-border bg-adm-bg p-3 hover:bg-adm-card"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={createRoleCodes.includes(role.code)}
                          onChange={() => toggleRoleCode(setCreateRoleCodes, role.code)}
                        />
                        <div>
                          <p className="font-mono text-[10px] font-semibold text-adm-t1">
                            {role.code}
                          </p>
                          <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                            {role.description || role.name}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
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
                  placeholder="Explain why this member access is needed."
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
                disabled={creating}
                className={adminButtonClass('modalConfirm')}
              >
                {creating ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default PlatformMembers;

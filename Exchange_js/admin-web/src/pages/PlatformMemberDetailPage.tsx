import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, RefreshCw, X } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  hydrateMemberInvitationLink,
  persistMemberInvitationLink,
} from '../utils/memberInvitationLinkCache';
import { createDeleteRequest, DELETE_REQUEST_TARGET_TYPES } from '../utils/deleteRequests';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface InvitationDetail {
  inviteExpiresAt: string;
  inviteStatus: string;
  inviteLink?: string;
  consumedAt?: string | null;
  revokedAt?: string | null;
  createdByUserId?: string | null;
  workflowType?: string | null;
  workflowNo?: string | null;
  traceId?: string | null;
  createdAt?: string | null;
}

interface MemberDetail {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  updatedAt: string;
  roles?: string[];
  failedLoginAttempts?: number | null;
  lockedUntil?: string | null;
  latestInvitation: InvitationDetail | null;
}

interface RoleCatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Shared layout primitives ────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
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
  if (!value) return null;
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

/* ─────────────────────────────────────────────────────────────── */

const PlatformMemberDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [detail, setDetail]   = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState<string | null>(null);

  /* Role change modal */
  const [isRoleModalOpen, setIsRoleModalOpen]       = useState(false);
  const [rolesCatalog, setRolesCatalog]             = useState<RoleCatalogItem[]>([]);
  const [selectedRoleCodes, setSelectedRoleCodes]   = useState<string[]>([]);
  const [roleChangeReason, setRoleChangeReason]     = useState('');
  const [modalLoading, setModalLoading]             = useState(false);
  const [savingRoles, setSavingRoles]               = useState(false);
  const [modalError, setModalError]                 = useState<string | null>(null);

  /* Resend invitation */
  const [resending, setResending] = useState(false);
  const resendSeqRef              = useRef(0);

  /* Delete modal */
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteReason, setDeleteReason]           = useState('');
  const [requestingDelete, setRequestingDelete]   = useState(false);
  const [deleteModalError, setDeleteModalError]   = useState<string | null>(null);

  /* Permissions */
  const canReadUserRoles   = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_READ]);
  const canAssignRoles     = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_WRITE]);
  const canReadRoleCatalog = hasAnyPermission([PERMISSIONS.IAM_ROLES_READ]);
  const canResendInvite    = hasAnyPermission([
    PERMISSIONS.USERS_INVITATION_RESEND,
    PERMISSIONS.USERS_CREATE,
  ]);
  const canRequestDeletion = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CREATE]);

  /* ── Fetching ── */

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await adminFetch(url, init);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Request failed.'));
    }
    return (await response.json()) as T;
  };

  const fetchDetail = async () => {
    if (!id) { setError('Member id is required.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const payload = await fetchJson<MemberDetail>(
        `${import.meta.env.VITE_API_URL}/users/${id}`,
      );
      setDetail({
        ...payload,
        latestInvitation: hydrateMemberInvitationLink(
          undefined,
          payload.id,
          payload.latestInvitation,
        ),
      });
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this member.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load member detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(
      () => setNotice((c) => (c === notice ? null : c)),
      4000,
    );
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Role change modal ── */

  const openRoleModal = async () => {
    if (!detail) return;
    setIsRoleModalOpen(true);
    setModalLoading(true);
    setModalError(null);
    setRoleChangeReason('');

    try {
      const [rolesPayload, catalogPayload] = await Promise.all([
        canReadUserRoles
          ? fetchJson<{ userId: string; roles: Array<{ code: string }> }>(
              `${import.meta.env.VITE_API_URL}/admin/iam/users/${detail.id}/roles`,
            )
          : Promise.resolve({ userId: detail.id, roles: [] as Array<{ code: string }> }),
        canReadRoleCatalog
          ? fetchJson<RoleCatalogItem[]>(
              `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
            )
          : Promise.resolve([] as RoleCatalogItem[]),
      ]);
      setSelectedRoleCodes(rolesPayload.roles.map((r) => r.code));
      setRolesCatalog(catalogPayload.filter((r) => r.status === 'ACTIVE'));
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot read role data.');
      } else {
        setModalError(err instanceof Error ? err.message : 'Failed to load role data.');
      }
    } finally {
      setModalLoading(false);
    }
  };

  const closeRoleModal = () => {
    setIsRoleModalOpen(false);
    setSelectedRoleCodes([]);
    setRolesCatalog([]);
    setModalError(null);
    setRoleChangeReason('');
  };

  const toggleRoleCode = (code: string) => {
    setSelectedRoleCodes((c) =>
      c.includes(code) ? c.filter((x) => x !== code) : [...c, code].sort(),
    );
  };

  const submitRoleChange = async () => {
    if (!detail) return;
    if (!roleChangeReason.trim()) { setModalError('Change reason is required.'); return; }
    setSavingRoles(true); setModalError(null);
    try {
      const payload = await fetchJson<{ ticketNo: string }>(
        `${import.meta.env.VITE_API_URL}/admin/iam/users/${detail.id}/roles`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roleCodes: selectedRoleCodes,
            changeReason: roleChangeReason.trim(),
          }),
        },
      );
      closeRoleModal();
      setNotice(
        `Role binding change request ${payload.ticketNo} created. Existing bindings remain until approval and execution.`,
      );
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot submit role change requests.');
      } else {
        setModalError(err instanceof Error ? err.message : 'Failed to create role change request.');
      }
    } finally {
      setSavingRoles(false);
    }
  };

  /* ── Resend invitation ── */

  const submitResendInvite = async () => {
    if (!detail) return;
    const seq = resendSeqRef.current + 1;
    resendSeqRef.current = seq;
    setResending(true); setError('');
    try {
      const payload = await fetchJson<{
        inviteLink: string;
        inviteExpiresAt: string;
        inviteStatus: string;
      }>(`${import.meta.env.VITE_API_URL}/users/${detail.id}/invitations/resend`, {
        method: 'POST',
      });
      if (resendSeqRef.current !== seq) return;
      persistMemberInvitationLink(undefined, detail.id, payload);
      setDetail((c) =>
        c
          ? {
              ...c,
              latestInvitation: hydrateMemberInvitationLink(undefined, detail.id, {
                inviteLink: payload.inviteLink,
                inviteExpiresAt: payload.inviteExpiresAt,
                inviteStatus: payload.inviteStatus,
              }),
            }
          : c,
      );
      setNotice(`Invitation reissued for ${detail.userNo}. Invite link updated below.`);
    } catch (err) {
      if (resendSeqRef.current !== seq) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot resend invitations.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to resend invitation.');
      }
    } finally {
      if (resendSeqRef.current === seq) setResending(false);
    }
  };

  const copyInviteLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Invitation link copied.');
    } catch {
      setError('Copy failed. Please copy the link manually.');
    }
  };

  /* ── Delete modal ── */

  const openDeleteModal = () => {
    setDeleteReason('');
    setDeleteModalError(null);
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteReason('');
    setDeleteModalError(null);
  };

  const submitDeleteRequest = async () => {
    if (!detail) return;
    const reason = deleteReason.trim();
    if (!reason) { setDeleteModalError('Delete reason is required.'); return; }
    setRequestingDelete(true); setDeleteModalError(null);
    try {
      const created = await createDeleteRequest({
        targetType: DELETE_REQUEST_TARGET_TYPES.ADMIN_USER,
        targetNo: detail.userNo,
        deleteReason: reason,
      });
      closeDeleteModal();
      navigate(`/dashboard/control-gates/delete-requests/${created.id}`);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setDeleteModalError('Permission denied. You cannot request member deletion.');
      } else {
        setDeleteModalError(err instanceof Error ? err.message : 'Failed to create delete request.');
      }
    } finally {
      setRequestingDelete(false);
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
            onClick={() => navigate('/dashboard/members')}
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
            onClick={() => navigate('/dashboard/members')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Member not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const roleCodes =
    detail.roles && detail.roles.length > 0
      ? detail.roles
      : detail.role
        ? [detail.role]
        : [];

  const hasLockInfo =
    (detail.failedLoginAttempts != null && detail.failedLoginAttempts > 0) ||
    !!detail.lockedUntil;

  const inv = detail.latestInvitation;
  const hasInvitation  = !!inv;
  const hasInvTrace    = !!(inv?.workflowType || inv?.workflowNo || inv?.traceId);

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        title="Platform Member"
        onBack={() => navigate('/dashboard/members')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Platform Members"
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
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
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ② Identity — UserNo dominant, status, then dim details */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Member</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.userNo}
            </p>
            <div className="mt-2.5">
              <AdminBadge value={detail.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{detail.email}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{detail.id}</p>
            </div>
          </section>

          {/* ③ Account State — only when there is lock info */}
          {hasLockInfo && (
            <section className="px-6 py-5">
              <Cap>Account State</Cap>
              <div className="mt-3">
                <FieldGrid>
                  {detail.failedLoginAttempts != null && detail.failedLoginAttempts > 0 && (
                    <Field
                      label="Failed Login Attempts"
                      value={String(detail.failedLoginAttempts)}
                    />
                  )}
                  <Field label="Locked Until" value={fmt(detail.lockedUntil)} mono />
                </FieldGrid>
              </div>
            </section>
          )}

          {/* ④ Role Bindings */}
          <section className="px-6 py-5">
            <Cap>Role Bindings</Cap>
            <p className="mt-1 font-mono text-[9px] text-adm-t3">
              Current bindings · submit a change request to alter them
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {roleCodes.length === 0 ? (
                <p className="font-mono text-[10px] text-adm-t3">No roles assigned.</p>
              ) : (
                roleCodes.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center rounded border border-adm-blue/25 bg-adm-blue/10 px-2.5 py-1 font-mono text-[10px] text-adm-blue"
                  >
                    {code}
                  </span>
                ))
              )}
            </div>
          </section>

          {/* ⑤ Invitation & Activation */}
          {hasInvitation && inv && (
            <section className="px-6 py-5">
              <Cap>Invitation &amp; Activation</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Canonical invitation state for this member
              </p>

              <div className="rounded border border-adm-border bg-adm-bg p-4">
                <FieldGrid>
                  <div>
                    <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                      Invite Status
                    </p>
                    <AdminBadge value={inv.inviteStatus} />
                  </div>
                  <Field label="Expires At" value={fmt(inv.inviteExpiresAt)} mono />
                  {inv.consumedAt && (
                    <Field label="Consumed At" value={fmt(inv.consumedAt)} mono />
                  )}
                  {inv.revokedAt && (
                    <Field label="Revoked At" value={fmt(inv.revokedAt)} mono />
                  )}
                  {inv.createdByUserId && (
                    <Field label="Invited By" value={inv.createdByUserId} mono full />
                  )}
                </FieldGrid>

                {inv.inviteLink && (
                  <div className="mt-4 border-t border-adm-border pt-4">
                    <Cap>Invite Link</Cap>
                    <div className="mt-2 rounded border border-adm-border bg-adm-card px-3 py-2.5">
                      <p className="break-all font-mono text-[9px] text-adm-t3">
                        {inv.inviteLink}
                      </p>
                    </div>
                    <button
                      onClick={() => void copyInviteLink(inv.inviteLink!)}
                      className={`mt-2 ${adminButtonClass('detailUtility')}`}
                    >
                      <Copy size={12} />
                      Copy Link
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {(canAssignRoles || (canResendInvite && detail.status === 'INACTIVE') || canRequestDeletion) && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {canAssignRoles && (
                  <button
                    onClick={() => void openRoleModal()}
                    className={adminButtonClass('detailUtility')}
                  >
                    Request Role Change
                  </button>
                )}
                {canResendInvite && detail.status === 'INACTIVE' && (
                  <button
                    onClick={() => void submitResendInvite()}
                    disabled={resending}
                    className={adminButtonClass('detailUtility')}
                  >
                    {resending ? 'Reissuing…' : 'Resend Invitation'}
                  </button>
                )}
                {canRequestDeletion && (
                  <button
                    onClick={openDeleteModal}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Request Deletion
                  </button>
                )}
              </div>
            </div>
          )}

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Joined"     value={fmt(detail.createdAt)}   mono />
            <SidebarKV label="Last Login" value={fmt(detail.lastLoginAt)} mono />
            <SidebarKV label="Updated"    value={fmt(detail.updatedAt)}   mono />
          </SidebarGroup>

          {hasInvTrace && inv && (
            <SidebarGroup title="Invitation Trace">
              <SidebarKV label="Workflow Type" value={inv.workflowType}           />
              <SidebarKV label="Workflow No"   value={inv.workflowNo}       mono  />
              <SidebarKV label="Trace ID"      value={inv.traceId}          mono  />
              <SidebarKV label="Issued At"     value={fmt(inv.createdAt)}   mono  />
            </SidebarGroup>
          )}

        </div>
      </div>

      {/* ════ Role Change Modal ════ */}
      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Submit Role Binding Change
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {detail.userNo} · {detail.email}
                </p>
              </div>
              <button
                onClick={closeRoleModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal body */}
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
              {modalLoading ? (
                <p className="font-mono text-[11px] text-adm-t3">Loading roles…</p>
              ) : rolesCatalog.length === 0 ? (
                <p className="font-mono text-[11px] text-adm-t3">No active roles available.</p>
              ) : (
                rolesCatalog.map((role) => (
                  <label
                    key={role.id}
                    className="flex cursor-pointer gap-3 rounded border border-adm-border bg-adm-bg p-3 hover:bg-adm-card"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedRoleCodes.includes(role.code)}
                      onChange={() => toggleRoleCode(role.code)}
                    />
                    <div>
                      <p className="font-mono text-[10px] font-semibold text-adm-t1">{role.code}</p>
                      <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                        {role.description || role.name}
                      </p>
                    </div>
                  </label>
                ))
              )}

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Change Reason
                </p>
                <textarea
                  value={roleChangeReason}
                  onChange={(e) => setRoleChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why these role bindings should change."
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none"
                />
              </div>

              {modalError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {modalError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeRoleModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitRoleChange()}
                disabled={savingRoles || modalLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {savingRoles ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ════ Delete Modal ════ */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Request Member Deletion
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {detail.userNo} · {detail.email}
                </p>
              </div>
              <button
                onClick={closeDeleteModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="font-mono text-[10px] text-adm-t3">
                This opens a governed deletion proposal for{' '}
                <span className="text-adm-amber">{detail.userNo}</span>.
                The member record remains active until the request is approved and executed.
              </p>
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Delete Reason
                </p>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  rows={4}
                  placeholder="Explain why this member should enter governed deletion…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
              {deleteModalError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {deleteModalError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeDeleteModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitDeleteRequest()}
                disabled={requestingDelete || !deleteReason.trim()}
                className={adminButtonClass('workflowNegative')}
              >
                {requestingDelete ? 'Requesting…' : 'Submit Request'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default PlatformMemberDetailPage;

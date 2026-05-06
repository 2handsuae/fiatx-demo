import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mail, RefreshCw, Copy, Check, ShieldCheck, UserX, X } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

/* ── Interfaces ──────────────────────────────────────────────── */

interface MemberDetail {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  latestInvitation: {
    inviteStatus: 'PENDING' | 'EXPIRED' | 'USED' | 'REVOKED';
    inviteExpiresAt: string;
    inviteLink: string | null;
  } | null;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Shared layout primitives (same as ApprovalDetailPage) ──── */

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

/* ── Main Component ──────────────────────────────────────────── */

export default function PlatformMemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showRoleChangeModal, setShowRoleChangeModal] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submittingRoleChange, setSubmittingRoleChange] = useState(false);

  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [submittingSuspend, setSubmittingSuspend] = useState(false);

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!id) { setError('Member id is required.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/users/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load member'));
      setMember((await res.json()) as MemberDetail);
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this member.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load member detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Resend invitation ── */

  const handleResend = async () => {
    if (!member) return;
    setResending(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/users/${id}/invitations/resend`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to resend invitation'));
      setNotice(`Invitation resent successfully for ${member.userNo}.`);
      void fetchDetail();
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to resend invitation.');
    } finally {
      setResending(false);
    }
  };

  /* ── Role change ── */

  const handleOpenRoleChange = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/roles`);
      if (res.ok) {
        const data = await res.json();
        setAvailableRoles(Array.isArray(data) ? data.map((r: any) => r.code) : []);
      }
    } catch { /* ignore */ }
    const roleCodes = member?.roles?.length ? member.roles : member?.role ? [member.role] : [];
    setSelectedRoles(roleCodes);
    setChangeReason('');
    setShowRoleChangeModal(true);
  };

  const handleToggleRole = (code: string) => {
    setSelectedRoles((prev) =>
      prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code],
    );
  };

  const handleSubmitRoleChange = async () => {
    if (!member || selectedRoles.length === 0 || !changeReason.trim()) return;
    setSubmittingRoleChange(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-change-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUserId: member.id,
            roleCodes: selectedRoles,
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit role change request'));
      setShowRoleChangeModal(false);
      setNotice('Role change request submitted for approval.');
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit role change request.');
    } finally {
      setSubmittingRoleChange(false);
    }
  };

  /* ── Suspend user ── */

  const handleSubmitSuspend = async () => {
    if (!member || !suspendReason.trim()) return;
    setSubmittingSuspend(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/users/${id}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit suspension request'));
      const data = await res.json();
      setShowSuspendModal(false);
      setSuspendReason('');
      setNotice(`Suspension request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit suspension request.');
    } finally {
      setSubmittingSuspend(false);
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

  if (error && !member) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button onClick={() => navigate('/dashboard/members')} className={adminButtonClass('detailUtility')}>
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

  if (!member) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button onClick={() => navigate('/dashboard/members')} className={adminButtonClass('detailUtility')}>
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Member not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const canResend = member.status === 'INVITE_SENT' || member.status === 'INACTIVE';
  const canChangeRoles =
    member.status === 'ACTIVE' && hasAnyPermission([PERMISSIONS.IAM_ROLE_CHANGE_REQUESTS_CREATE]);
  const canSuspend =
    (member.status === 'ACTIVE' || member.status === 'INACTIVE') &&
    hasAnyPermission([PERMISSIONS.USERS_SUSPEND]);
  const showActions = canResend || canChangeRoles || canSuspend;
  const roleCodes = member.roles?.length ? member.roles : member.role ? [member.role] : [];
  const invitation = member.latestInvitation;

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        title="Platform Member"
        subtitle={member.userNo}
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

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Member</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {member.userNo}
            </p>
            <div className="mt-2.5">
              <AdminBadge value={member.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{member.email}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{member.id}</p>
            </div>
          </section>

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Primary Role" value={member.role} mono />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">All Roles</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {roleCodes.length === 0 ? (
                    <span className="font-mono text-[11px] text-adm-t3">No roles assigned</span>
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
              </div>
              <InfoField label="Created" value={fmt(member.createdAt)} mono />
              <InfoField label="Updated" value={fmt(member.updatedAt)} mono />
              <InfoField label="Last Login" value={member.lastLoginAt ? fmt(member.lastLoginAt) : 'Never'} mono />
            </div>
          </section>

          {/* ③ Invitation Status */}
          {invitation && (
            <section className="px-6 py-5">
              <Cap>Invitation</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField label="Invite Status" value={invitation.inviteStatus} mono accent />
                <InfoField label="Expires At" value={fmt(invitation.inviteExpiresAt)} mono />
              </div>
              {invitation.inviteLink && (
                <InviteLinkField link={invitation.inviteLink} />
              )}
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {showActions && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {canChangeRoles && (
                  <button
                    onClick={() => void handleOpenRoleChange()}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <ShieldCheck size={13} />
                    Change Roles
                  </button>
                )}
                {canResend && (
                  <button
                    onClick={() => void handleResend()}
                    disabled={resending}
                    className={adminButtonClass('detailUtility')}
                  >
                    <Mail size={13} />
                    {resending ? 'Reissuing…' : 'Resend Invitation'}
                  </button>
                )}
                {canSuspend && (
                  <button
                    onClick={() => { setSuspendReason(''); setShowSuspendModal(true); }}
                    className={adminButtonClass('workflowNegative')}
                  >
                    <UserX size={13} />
                    Suspend User
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Account */}
          <SidebarGroup title="Account">
            <SidebarKV label="User No" value={member.userNo} />
            <SidebarKV label="Email" value={member.email} />
            <SidebarKV label="Primary Role" value={member.role} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(member.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(member.updatedAt)} mono />
            <SidebarKV label="Last Login" value={member.lastLoginAt ? fmt(member.lastLoginAt) : 'Never'} mono />
          </SidebarGroup>

          {/* Invitation */}
          {invitation && (
            <SidebarGroup title="Invitation">
              <SidebarKV label="Status" value={invitation.inviteStatus} />
              <SidebarKV label="Expires" value={fmt(invitation.inviteExpiresAt)} mono />
            </SidebarGroup>
          )}

        </div>
      </div>

      {/* ════ Role Change Modal ════ */}
      {showRoleChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Change Role Bindings
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {member.userNo} · {member.email}
                </p>
              </div>
              <button
                onClick={() => setShowRoleChangeModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Select Roles
                </p>
                <div className="flex flex-wrap gap-2 rounded border border-adm-border bg-adm-bg p-3 max-h-36 overflow-y-auto">
                  {availableRoles.length === 0 ? (
                    <span className="font-mono text-[10px] text-adm-t3">Loading roles…</span>
                  ) : (
                    availableRoles.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => handleToggleRole(code)}
                        className={[
                          'inline-flex rounded border px-2.5 py-1 font-mono text-[10px] transition-colors',
                          selectedRoles.includes(code)
                            ? 'border-adm-blue/50 bg-adm-blue/15 text-adm-blue'
                            : 'border-adm-border bg-adm-panel text-adm-t2 hover:border-adm-blue/30',
                        ].join(' ')}
                      >
                        {code}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Change
                </p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this role change is needed…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowRoleChangeModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitRoleChange()}
                disabled={submittingRoleChange || selectedRoles.length === 0 || !changeReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingRoleChange ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ════ Suspend Modal ════ */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Suspend Admin Account
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {member.userNo} · {member.email}
                </p>
              </div>
              <button
                onClick={() => setShowSuspendModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a suspension request for approval. If approved, this user will be
                immediately blocked from accessing the admin panel.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Suspension
                </p>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this account should be suspended…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowSuspendModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitSuspend()}
                disabled={submittingSuspend || !suspendReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingSuspend ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

/* ── Invite Link sub-component ───────────────────────────────── */

function InviteLinkField({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4">
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Invite Link</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-[10px] text-adm-t2">
          {link}
        </code>
        <button
          onClick={() => void handleCopy()}
          className="shrink-0 rounded p-1.5 text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-amber"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-adm-green" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

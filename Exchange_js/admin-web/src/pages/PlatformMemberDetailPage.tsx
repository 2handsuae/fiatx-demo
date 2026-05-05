import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mail, RefreshCw, Copy, Check } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

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

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const INVITE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-adm-blue',
  USED: 'text-adm-green',
  EXPIRED: 'text-adm-red',
  REVOKED: 'text-adm-red',
};

function InvitationSection({ invitation }: { invitation: NonNullable<MemberDetail['latestInvitation']> }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!invitation.inviteLink) return;
    await navigator.clipboard.writeText(invitation.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="px-6 py-5">
      <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Invitation Status</p>
      <div className="rounded border border-adm-border bg-adm-bg p-4 space-y-4">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Invite Status</p>
            <span
              className={[
                'font-mono text-[10px] font-semibold',
                INVITE_STATUS_COLORS[invitation.inviteStatus] || 'text-adm-t2',
              ].join(' ')}
            >
              {invitation.inviteStatus}
            </span>
          </div>
          <div>
            <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Expires At</p>
            <p className="font-mono text-[10px] text-adm-t2">
              {fmt(invitation.inviteExpiresAt)}
            </p>
          </div>
        </div>
        {invitation.inviteLink && (
          <div>
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Invite Link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[10px] text-adm-t2">
                {invitation.inviteLink}
              </code>
              <button
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1 rounded border border-adm-border bg-adm-panel px-2 py-1.5 font-mono text-[10px] text-adm-t2 hover:border-adm-amber/50 transition-colors"
              >
                {copied ? <Check size={12} className="text-adm-green" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function PlatformMemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) { setError('Member id is required.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/users/${id}`);
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to load member');
        throw new Error(msg);
      }
      const data = (await res.json()) as MemberDetail;
      setMember(data);
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

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const handleResend = async () => {
    if (!member) return;
    setResending(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/users/${id}/invitations/resend`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to resend invitation');
        throw new Error(msg);
      }
      setNotice(`Invitation resent successfully for ${member.userNo}.`);
      void fetchDetail();
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to resend invitation.');
    } finally {
      setResending(false);
    }
  };

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
          <button
            onClick={() => navigate('/platform-members')}
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

  if (!member) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button
            onClick={() => navigate('/platform-members')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Member not found.</div>
      </div>
    );
  }

  const canResend = member.status === 'INVITE_SENT' || member.status === 'INACTIVE';
  const roleCodes =
    member.roles && member.roles.length > 0
      ? member.roles
      : member.role
        ? [member.role]
        : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">

      <DetailPageHeader
        title="Platform Member"
        onBack={() => navigate('/platform-members')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Platform Members"
      />

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

      <div className="flex min-h-0 flex-1 overflow-y-auto flex-col divide-y divide-adm-border">

        {/* Identity */}
        <section className="bg-adm-card px-6 py-5">
          <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Member</p>
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

        {/* Member Details */}
        <section className="px-6 py-5">
          <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Details</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Primary Role</p>
              <p className="text-[11px] text-adm-t2">{member.role || '—'}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">All Roles</p>
              <div className="flex flex-wrap gap-1.5">
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
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Created</p>
              <p className="font-mono text-[10px] text-adm-t2">{fmt(member.createdAt)}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Updated</p>
              <p className="font-mono text-[10px] text-adm-t2">{fmt(member.updatedAt)}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Last Login</p>
              <p className="font-mono text-[10px] text-adm-t2">
                {member.lastLoginAt ? fmt(member.lastLoginAt) : 'Never'}
              </p>
            </div>
          </div>
        </section>

        {/* Invitation Status */}
        {member.latestInvitation && (
          <InvitationSection invitation={member.latestInvitation} />
        )}

        {/* Actions */}
        {canResend && (
          <section className="px-6 py-5">
            <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Actions</p>
            <button
              onClick={() => void handleResend()}
              disabled={resending}
              className={adminButtonClass('detailUtility')}
            >
              <Mail size={13} />
              {resending ? 'Reissuing…' : 'Resend Invitation'}
            </button>
          </section>
        )}

      </div>
    </div>
  );
}

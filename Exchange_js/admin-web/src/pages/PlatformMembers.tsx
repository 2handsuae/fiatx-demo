import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
import { createDeleteRequest, DELETE_REQUEST_TARGET_TYPES } from '../utils/deleteRequests';
import {
  hydrateMemberInvitationLink,
  persistMemberInvitationLink,
} from '../utils/memberInvitationLinkCache';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

interface Member {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
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

interface InvitationSummary {
  inviteExpiresAt: string;
  inviteStatus: string;
  inviteLink?: string;
}

interface MemberDetail extends Member {
  updatedAt: string;
  latestInvitation: InvitationSummary | null;
}

const formatMemberIdentity = (member?: { userNo?: string; email?: string } | null) => {
  if (!member) {
    return '-';
  }

  const { userNo, email } = member;
  if (userNo && email) {
    return `${userNo} · ${email}`;
  }

  return userNo || email || '-';
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
};

const PlatformMembers = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [members, setMembers] = useState<Member[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<RoleCatalogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestSeqRef = useRef(0);
  const detailMemberIdRef = useRef<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createRoleCodes, setCreateRoleCodes] = useState<string[]>([]);
  const [createChangeReason, setCreateChangeReason] = useState('');
  const [creatingMember, setCreatingMember] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);
  const [roleChangeReason, setRoleChangeReason] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [resendingMemberId, setResendingMemberId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [requestingDeleteMemberId, setRequestingDeleteMemberId] = useState<string | null>(null);
  const resendRequestSeqRef = useRef(0);
  const resendMemberIdRef = useRef<string | null>(null);
  const deleteRequestSeqRef = useRef(0);
  const deleteMemberIdRef = useRef<string | null>(null);

  const canReadRoleCatalog = hasAnyPermission([PERMISSIONS.IAM_ROLES_READ]);
  const canReadUserRoles = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_READ]);
  const canAssignRoles = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_WRITE]);
  const canCreateMember = hasAnyPermission([PERMISSIONS.USERS_CREATE]);
  const canResendInvite = hasAnyPermission([
    PERMISSIONS.USERS_INVITATION_RESEND,
    PERMISSIONS.USERS_CREATE,
  ]);
  const canRequestDeletion = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CREATE]);

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await adminFetch(url, init);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Request failed.'));
    }
    return (await response.json()) as T;
  };

  const hydrateMemberDetail = (detail: MemberDetail): MemberDetail => ({
    ...detail,
    latestInvitation: hydrateMemberInvitationLink(undefined, detail.id, detail.latestInvitation),
  });

  const fetchMembers = async () => {
    const payload = await fetchJson<Member[]>(`${import.meta.env.VITE_API_URL}/users`);
    setMembers(payload);
  };

  const fetchMemberDetail = async (memberId: string) => {
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    setDetailLoading(true);
    setDetailError(null);

    try {
      const payload = await fetchJson<MemberDetail>(`${import.meta.env.VITE_API_URL}/users/${memberId}`);
      if (
        detailRequestSeqRef.current !== requestSeq ||
        detailMemberIdRef.current !== memberId
      ) {
        return;
      }
      setMemberDetail(hydrateMemberDetail(payload));
    } catch (err) {
      if (
        detailRequestSeqRef.current !== requestSeq ||
        detailMemberIdRef.current !== memberId
      ) {
        return;
      }
      setMemberDetail(null);
      if (err instanceof AdminPermissionError) {
        setDetailError('Permission denied. You cannot view member detail.');
      } else {
        setDetailError(err instanceof Error ? err.message : 'Failed to load member detail.');
      }
    } finally {
      if (
        detailRequestSeqRef.current !== requestSeq ||
        detailMemberIdRef.current !== memberId
      ) {
        return;
      }
      setDetailLoading(false);
    }
  };

  const fetchRoleCatalog = async () => {
    if (!canReadRoleCatalog && !canAssignRoles && !canCreateMember) {
      setRolesCatalog([]);
      return;
    }

    const payload = await fetchJson<RoleCatalogItem[]>(
      `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
    );
    setRolesCatalog(payload);
  };

  const refreshData = async () => {
    setLoading(true);
    setError(null);

    try {
      await Promise.all([fetchMembers(), fetchRoleCatalog()]);
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

  useEffect(() => {
    void refreshData();
  }, [canReadRoleCatalog, canAssignRoles, canCreateMember]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  useEffect(() => {
    if (!detailMemberId) {
      detailRequestSeqRef.current += 1;
      detailMemberIdRef.current = null;
      deleteRequestSeqRef.current += 1;
      deleteMemberIdRef.current = null;
      setMemberDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setDeleteReason('');
      setRequestingDeleteMemberId(null);
      return;
    }

    detailMemberIdRef.current = detailMemberId;
    deleteRequestSeqRef.current += 1;
    deleteMemberIdRef.current = null;
    setMemberDetail(null);
    setDeleteReason('');
    setRequestingDeleteMemberId(null);
    void fetchMemberDetail(detailMemberId);
  }, [detailMemberId]);

  const filteredMembers = useMemo(() => {
    const keyword = appliedSearch.trim().toLowerCase();
    if (!keyword) {
      return members;
    }

    return members.filter((member) => {
      const byEmail = member.email?.toLowerCase().includes(keyword);
      const byUserNo = member.userNo?.toLowerCase().includes(keyword);
      return byEmail || byUserNo;
    });
  }, [appliedSearch, members]);

  const hasSearch = !!searchInput.trim() || !!appliedSearch.trim();

  const activeRoles = useMemo(
    () => rolesCatalog.filter((role) => role.status === 'ACTIVE'),
    [rolesCatalog],
  );

  const activeMemberDetail =
    memberDetail && detailMemberId && memberDetail.id === detailMemberId ? memberDetail : null;

  const toggleRoleCode = (
    setter: Dispatch<SetStateAction<string[]>>,
    roleCode: string,
  ) => {
    setter((current) => {
      if (current.includes(roleCode)) {
        return current.filter((item) => item !== roleCode);
      }
      return [...current, roleCode].sort();
    });
  };

  const selectDetailMember = (memberId: string) => {
    detailMemberIdRef.current = memberId;
    setDetailMemberId(memberId);
  };

  const openCreateModal = () => {
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateChangeReason('');
    setCreateError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateChangeReason('');
    setCreateError(null);
  };

  const submitCreateMember = async () => {
    const normalizedEmail = createEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setCreateError('Email is required.');
      return;
    }

    if (createRoleCodes.length === 0) {
      setCreateError('Select at least one role.');
      return;
    }

    if (!createChangeReason.trim()) {
      setCreateError('Change reason is required.');
      return;
    }

    setCreatingMember(true);
    setCreateError(null);
    setNotice(null);

    try {
      const payload = await fetchJson<{
        id: string;
        ticketNo: string;
        status: string;
      }>(`${import.meta.env.VITE_API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          roleCodes: createRoleCodes,
          changeReason: createChangeReason.trim(),
        }),
      });

      closeCreateModal();
      setNotice(
        `Provisioning request ${payload.ticketNo} created for ${normalizedEmail}. The member will appear after approval and execution.`,
      );
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setCreateError('Permission denied. You cannot submit provisioning requests.');
      } else {
        setCreateError(
          err instanceof Error ? err.message : 'Failed to create provisioning request.',
        );
      }
    } finally {
      setCreatingMember(false);
    }
  };

  const copyInviteLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Invitation link copied. Canonical invitation status remains in member detail.');
    } catch {
      setError('Copy failed. Please copy the invitation link manually.');
    }
  };

  const submitResendInvite = async () => {
    const currentDetailId = detailMemberIdRef.current;
    if (!currentDetailId || !activeMemberDetail || activeMemberDetail.id !== currentDetailId) {
      return;
    }

    const detailIdentity = {
      id: activeMemberDetail.id,
      userNo: activeMemberDetail.userNo,
      email: activeMemberDetail.email,
    };
    const requestSeq = resendRequestSeqRef.current + 1;
    resendRequestSeqRef.current = requestSeq;
    resendMemberIdRef.current = currentDetailId;

    setResendingMemberId(currentDetailId);
    setError(null);
    setNotice(null);

    try {
      const payload = await fetchJson<{
        userNo?: string;
        email: string;
        inviteLink: string;
        inviteExpiresAt: string;
        inviteStatus: string;
      }>(`${import.meta.env.VITE_API_URL}/users/${currentDetailId}/invitations/resend`, {
        method: 'POST',
      });

      if (
        resendRequestSeqRef.current !== requestSeq ||
        resendMemberIdRef.current !== currentDetailId ||
        detailMemberIdRef.current !== currentDetailId
      ) {
        return;
      }

      setNotice(
        `Invitation reissued for ${formatMemberIdentity(detailIdentity)}. Member detail updated below.`,
      );
      persistMemberInvitationLink(undefined, currentDetailId, {
        inviteLink: payload.inviteLink,
        inviteExpiresAt: payload.inviteExpiresAt,
        inviteStatus: payload.inviteStatus,
      });
      setMemberDetail((current) =>
        current && current.id === currentDetailId
          ? {
              ...current,
              latestInvitation: hydrateMemberInvitationLink(undefined, currentDetailId, {
                inviteLink: payload.inviteLink,
                inviteExpiresAt: payload.inviteExpiresAt,
                inviteStatus: payload.inviteStatus,
              }),
            }
          : current,
      );
    } catch (err) {
      if (
        resendRequestSeqRef.current !== requestSeq ||
        resendMemberIdRef.current !== currentDetailId
      ) {
        return;
      }
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot resend invitations.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to resend invitation.');
      }
    } finally {
      if (
        resendRequestSeqRef.current !== requestSeq ||
        resendMemberIdRef.current !== currentDetailId
      ) {
        return;
      }
      resendMemberIdRef.current = null;
      setResendingMemberId(null);
    }
  };

  const requestMemberDeletion = async () => {
    const currentDetailId = detailMemberIdRef.current;
    if (!currentDetailId || !activeMemberDetail || activeMemberDetail.id !== currentDetailId) {
      return;
    }

    const normalizedReason = deleteReason.trim();
    if (!normalizedReason) {
      setError('Delete reason is required.');
      return;
    }

    const requestSeq = deleteRequestSeqRef.current + 1;
    deleteRequestSeqRef.current = requestSeq;
    deleteMemberIdRef.current = currentDetailId;

    setRequestingDeleteMemberId(currentDetailId);
    setError(null);
    setNotice(null);

    try {
      const created = await createDeleteRequest({
        targetType: DELETE_REQUEST_TARGET_TYPES.ADMIN_USER,
        targetNo: activeMemberDetail.userNo,
        deleteReason: normalizedReason,
      });
      if (
        deleteRequestSeqRef.current !== requestSeq ||
        deleteMemberIdRef.current !== currentDetailId ||
        detailMemberIdRef.current !== currentDetailId
      ) {
        return;
      }
      navigate(`/dashboard/control-gates/delete-requests/${created.id}`);
    } catch (err) {
      if (
        deleteRequestSeqRef.current !== requestSeq ||
        deleteMemberIdRef.current !== currentDetailId ||
        detailMemberIdRef.current !== currentDetailId
      ) {
        return;
      }
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot request member deletion.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create delete request.');
      }
    } finally {
      if (
        deleteRequestSeqRef.current !== requestSeq ||
        deleteMemberIdRef.current !== currentDetailId
      ) {
        return;
      }
      deleteMemberIdRef.current = null;
      setRequestingDeleteMemberId(null);
    }
  };

  const closeRoleModal = () => {
    setIsRoleModalOpen(false);
    setSelectedMember(null);
    setSelectedRoleCodes([]);
    setModalError(null);
    setRoleChangeReason('');
  };

  const openRoleModal = async (member: Member) => {
    setIsRoleModalOpen(true);
    setSelectedMember(member);
    setModalLoading(true);
    setModalError(null);
    setRoleChangeReason('');

    try {
      if (!canReadUserRoles) {
        throw new Error('The current account cannot read user role bindings.');
      }

      const payload = await fetchJson<{
        userId: string;
        roles: Array<{ code: string }>;
      }>(`${import.meta.env.VITE_API_URL}/admin/iam/users/${member.id}/roles`);

      setSelectedRoleCodes(payload.roles.map((item) => item.code));
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot read this user role binding.');
      } else {
        setModalError(err instanceof Error ? err.message : 'Failed to load user roles.');
      }
    } finally {
      setModalLoading(false);
    }
  };

  const submitRoleChanges = async () => {
    if (!selectedMember) {
      return;
    }

    if (!roleChangeReason.trim()) {
      setModalError('Change reason is required.');
      return;
    }

    setSavingRoles(true);
    setModalError(null);

    try {
      const payload = await fetchJson<{ id: string; ticketNo: string; status: string }>(
        `${import.meta.env.VITE_API_URL}/admin/iam/users/${selectedMember.id}/roles`,
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
        `Role binding change request ${payload.ticketNo} created for ${formatMemberIdentity(selectedMember)}. Existing bindings stay in effect until approval and execution.`,
      );
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot submit role change requests.');
      } else {
        setModalError(
          err instanceof Error ? err.message : 'Failed to create role binding change request.',
        );
      }
    } finally {
      setSavingRoles(false);
    }
  };

  const handleSearch = () => {
    setAppliedSearch(searchInput.trim());
  };

  const handleReset = () => {
    setSearchInput('');
    setAppliedSearch('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Members</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review member access posture, inspect activation, and submit governed access change proposals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canCreateMember && (
            <button
              onClick={openCreateModal}
              className={adminButtonClass('listPrimary')}
            >
              <Plus size={16} />
              Submit Provisioning Request
            </button>
          )}
          <button
            onClick={() => {
              void refreshData();
            }}
            className={adminIconButtonClass()}
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex gap-4">
          <div className="relative flex-1 max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
                placeholder="Search by email or userNo..."
                className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
              />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              className={adminButtonClass('listPrimary')}
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={adminButtonClass('listSecondary')}
              disabled={!hasSearch}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Roles</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Loading members...
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    No members found.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => {
                  const roleCodes =
                    member.roles && member.roles.length > 0 ? member.roles : [member.role];
                  const isSelected = detailMemberId === member.id;

                  return (
                    <tr
                      key={member.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{member.userNo || '-'}</div>
                        <div className="text-sm text-gray-500">{member.email || '-'}</div>
                        <div className="flex gap-2 text-[10px] font-mono">
                          <span className="text-brand-primary font-bold">No: {member.userNo || '-'}</span>
                          <span className="text-gray-400">ID: {member.id.substring(0, 8)}...</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {roleCodes.map((roleCode) => (
                            <span
                              key={roleCode}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                            >
                              {roleCode}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            member.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {formatDateTime(member.lastLoginAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => {
                              selectDetailMember(member.id);
                            }}
                            className={adminButtonClass('rowSecondaryUtility')}
                          >
                            {isSelected ? 'Viewing Details' : 'View Details'}
                          </button>
                          {canAssignRoles ? (
                            <button
                              onClick={() => {
                                void openRoleModal(member);
                              }}
                              className={adminButtonClass('rowSecondaryUtility')}
                            >
                              Request Role Change
                            </button>
                          ) : null}
                          {!canAssignRoles ? (
                            <span className="text-xs text-gray-400">No edit permission</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      <div className="p-4 border-t border-admin-border bg-admin-content-bg text-xs text-gray-500">
        Showing {filteredMembers.length} / {members.length} records
      </div>
    </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border">
        <div className="px-5 py-4 border-b border-admin-border">
          <h2 className="text-lg font-semibold text-gray-900">Member Detail</h2>
          <p className="text-sm text-gray-500 mt-1">
            Invitation status and activation information live here for the selected member.
          </p>
        </div>

        {!detailMemberId ? (
          <div className="px-5 py-8 text-sm text-gray-500">
            Select a member from the table to inspect identity, role bindings, and invitation status.
          </div>
        ) : detailLoading ? (
          <div className="px-5 py-8 text-sm text-gray-500">Loading member detail...</div>
        ) : detailError ? (
          <div className="px-5 py-8 text-sm text-red-700">{detailError}</div>
        ) : activeMemberDetail ? (
          <div className="px-5 py-5 space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-admin-border bg-admin-content-bg px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-500">Member</div>
                <div className="mt-2 font-semibold text-gray-900">{formatMemberIdentity(activeMemberDetail)}</div>
                <div className="mt-1 text-xs font-mono text-gray-500">ID: {activeMemberDetail.id}</div>
              </div>
              <div className="rounded-lg border border-admin-border bg-admin-content-bg px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-500">Status</div>
                <div className="mt-2 text-sm font-semibold text-gray-900">{activeMemberDetail.status}</div>
                <div className="mt-1 text-xs text-gray-500">Primary role: {activeMemberDetail.role || '-'}</div>
              </div>
              <div className="rounded-lg border border-admin-border bg-admin-content-bg px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-500">Created</div>
                <div className="mt-2 text-sm text-gray-900">{formatDateTime(activeMemberDetail.createdAt)}</div>
              </div>
              <div className="rounded-lg border border-admin-border bg-admin-content-bg px-4 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-500">Last Login</div>
                <div className="mt-2 text-sm text-gray-900">{formatDateTime(activeMemberDetail.lastLoginAt)}</div>
              </div>
            </div>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Role Bindings</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Current bindings visible on the member record. Submit a role change request to alter them.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(activeMemberDetail.roles && activeMemberDetail.roles.length > 0
                  ? activeMemberDetail.roles
                  : [activeMemberDetail.role]
                ).map((roleCode) => (
                  <span
                    key={roleCode}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {roleCode}
                  </span>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Invitation & Activation</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Canonical invitation state for this member lives here. The global notice only confirms recent actions.
                  </p>
                </div>
                {canResendInvite && activeMemberDetail.status === 'INACTIVE' ? (
                  <button
                    onClick={() => {
                      void submitResendInvite();
                    }}
                    disabled={resendingMemberId === activeMemberDetail.id}
                    className={adminButtonClass('rowSecondaryUtility')}
                  >
                    {resendingMemberId === activeMemberDetail.id ? 'Reissuing...' : 'Resend Invitation'}
                  </button>
                ) : null}
              </div>

              {activeMemberDetail.latestInvitation ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-blue-700">Invite Status</div>
                      <div className="mt-1 text-sm font-semibold text-blue-900">
                        {activeMemberDetail.latestInvitation.inviteStatus}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-blue-700">Invite Expires At</div>
                      <div className="mt-1 text-sm text-blue-900">
                        {formatDateTime(activeMemberDetail.latestInvitation.inviteExpiresAt)}
                      </div>
                    </div>
                  </div>

                  {activeMemberDetail.latestInvitation.inviteLink ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-blue-700">Invite Link</div>
                      <div className="break-all font-mono text-xs bg-white border border-blue-100 rounded px-2 py-2 text-blue-900">
                        {activeMemberDetail.latestInvitation.inviteLink}
                      </div>
                      <button
                        onClick={() => {
                          void copyInviteLink(activeMemberDetail.latestInvitation!.inviteLink!);
                        }}
                        className="text-xs px-3 py-1.5 rounded-md border border-blue-200 bg-white hover:bg-blue-100 transition-colors"
                      >
                        Copy Invite Link
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-blue-800">
                      Latest status and expiry remain here. Invite links are only exposed immediately after a fresh invitation is issued or resent.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-admin-border px-4 py-4 text-sm text-gray-500">
                  No invitation record available for this member yet.
                </div>
              )}
            </section>

            {canRequestDeletion ? (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Request Deletion</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Open a governed deletion proposal for member {activeMemberDetail.userNo}. The member record remains until the delete request completes.
                  </p>
                </div>

                <div className="rounded-lg border border-admin-border bg-admin-content-bg px-4 py-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                      Delete Reason
                    </label>
                    <textarea
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                      rows={3}
                      placeholder="Explain why this admin member should enter governed deletion."
                      className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => {
                        void requestMemberDeletion();
                      }}
                      disabled={requestingDeleteMemberId === activeMemberDetail.id || !deleteReason.trim()}
                      className={adminButtonClass('workflowSecondary')}
                    >
                      {requestingDeleteMemberId === activeMemberDetail.id
                        ? 'Requesting...'
                        : 'Request Deletion'}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-gray-500">No member detail available.</div>
        )}
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-admin-border overflow-hidden">
            <div className="px-5 py-4 border-b border-admin-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Submit Provisioning Request</h3>
                <p className="text-xs text-gray-500 mt-1">
                  This creates a governed access change request. The member record is only provisioned after approval and execution.
                </p>
              </div>
              <button onClick={closeCreateModal} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-auto">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                  Email
                </label>
                <input
                  value={createEmail}
                  onChange={(event) => setCreateEmail(event.target.value)}
                  type="email"
                  placeholder="new-admin@fiatx.com"
                  className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                  Role Codes
                </label>
                {activeRoles.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-admin-border rounded-lg px-3 py-4">
                    No active roles available.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeRoles.map((role) => (
                      <label
                        key={role.id}
                        className="flex gap-3 p-3 border border-admin-border rounded-lg hover:bg-admin-content-bg"
                      >
                        <input
                          type="checkbox"
                          checked={createRoleCodes.includes(role.code)}
                          onChange={() => toggleRoleCode(setCreateRoleCodes, role.code)}
                        />
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{role.code}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {role.description || role.name}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                  Change Reason
                </label>
                <textarea
                  value={createChangeReason}
                  onChange={(event) => setCreateChangeReason(event.target.value)}
                  rows={4}
                  placeholder="Explain why this member access is needed."
                  className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                />
              </div>

              {createError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={closeCreateModal}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitCreateMember();
                }}
                disabled={creatingMember}
                className={adminButtonClass('modalConfirm')}
              >
                {creatingMember ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-admin-border overflow-hidden">
            <div className="px-5 py-4 border-b border-admin-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Submit Role Binding Change</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {formatMemberIdentity(selectedMember)}. Existing bindings remain active until the request is approved and executed.
                </p>
              </div>
              <button onClick={closeRoleModal} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-auto">
              {modalLoading ? (
                <div className="text-sm text-gray-500">Loading user roles...</div>
              ) : activeRoles.length === 0 ? (
                <div className="text-sm text-gray-500">No active roles available.</div>
              ) : (
                activeRoles.map((role) => (
                  <label
                    key={role.id}
                    className="flex gap-3 p-3 border border-admin-border rounded-lg hover:bg-admin-content-bg"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedRoleCodes.includes(role.code)}
                      onChange={() => toggleRoleCode(setSelectedRoleCodes, role.code)}
                    />
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{role.code}</div>
                      <div className="text-xs text-gray-500 mt-1">{role.description || role.name}</div>
                    </div>
                  </label>
                ))
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                  Change Reason
                </label>
                <textarea
                  value={roleChangeReason}
                  onChange={(event) => setRoleChangeReason(event.target.value)}
                  rows={4}
                  placeholder="Explain why these role bindings should change."
                  className="w-full px-3 py-2 border border-admin-border rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                />
              </div>

              {modalError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={closeRoleModal}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitRoleChanges();
                }}
                disabled={savingRoles || !canAssignRoles || modalLoading}
                className={adminButtonClass('modalConfirm')}
              >
                {savingRoles ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformMembers;

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  AdminPermissionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
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

const PlatformMembers = () => {
  const { hasAnyPermission } = useAdminSession();

  const [members, setMembers] = useState<Member[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<RoleCatalogItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createRoleCodes, setCreateRoleCodes] = useState<string[]>([]);
  const [creatingMember, setCreatingMember] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalWarnings, setModalWarnings] = useState<string[]>([]);

  const canReadRoleCatalog = hasAnyPermission([PERMISSIONS.IAM_ROLES_READ]);
  const canReadUserRoles = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_READ]);
  const canAssignRoles = hasAnyPermission([PERMISSIONS.IAM_USER_ROLES_WRITE]);
  const canCreateMember = hasAnyPermission([PERMISSIONS.USERS_CREATE]);

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await adminFetch(url, init);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Request failed.'));
    }
    return (await response.json()) as T;
  };

  const fetchMembers = async () => {
    const payload = await fetchJson<Member[]>(`${import.meta.env.VITE_API_URL}/users`);
    setMembers(payload);
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
    setNotice(null);

    try {
      await Promise.all([fetchMembers(), fetchRoleCatalog()]);
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setError('权限不足，无法查看该资源。');
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

  const filteredMembers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return members;
    }

    return members.filter((member) => {
      const byEmail = member.email?.toLowerCase().includes(keyword);
      const byUserNo = member.userNo?.toLowerCase().includes(keyword);
      return byEmail || byUserNo;
    });
  }, [members, searchTerm]);

  const activeRoles = useMemo(
    () => rolesCatalog.filter((role) => role.status === 'ACTIVE'),
    [rolesCatalog],
  );

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

  const openCreateModal = () => {
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreateEmail('');
    setCreateRoleCodes([]);
    setCreateError(null);
  };

  const submitCreateMember = async () => {
    const normalizedEmail = createEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setCreateError('邮箱不能为空。');
      return;
    }

    if (createRoleCodes.length === 0) {
      setCreateError('请至少选择一个角色。');
      return;
    }

    setCreatingMember(true);
    setCreateError(null);

    try {
      await fetchJson<{
        id: string;
        userNo: string;
        email: string;
        status: string;
        roles: string[];
      }>(`${import.meta.env.VITE_API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          roleCodes: createRoleCodes,
        }),
      });

      closeCreateModal();
      setNotice(`已创建成员 ${normalizedEmail}，初始密码为 123456。`);
      await fetchMembers();
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setCreateError('权限不足，无法创建成员。');
      } else {
        setCreateError(err instanceof Error ? err.message : 'Failed to create member.');
      }
    } finally {
      setCreatingMember(false);
    }
  };

  const closeRoleModal = () => {
    setIsRoleModalOpen(false);
    setSelectedMember(null);
    setSelectedRoleCodes([]);
    setModalWarnings([]);
    setModalError(null);
  };

  const openRoleModal = async (member: Member) => {
    setIsRoleModalOpen(true);
    setSelectedMember(member);
    setModalLoading(true);
    setModalWarnings([]);
    setModalError(null);

    try {
      if (!canReadUserRoles) {
        throw new Error('当前账号没有读取用户角色的权限。');
      }

      const payload = await fetchJson<{
        userId: string;
        roles: Array<{ code: string }>;
      }>(`${import.meta.env.VITE_API_URL}/admin/iam/users/${member.id}/roles`);

      setSelectedRoleCodes(payload.roles.map((item) => item.code));
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('权限不足，无法读取该用户角色。');
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

    setSavingRoles(true);
    setModalWarnings([]);
    setModalError(null);

    try {
      const payload = await fetchJson<{ roles: string[]; warnings?: string[] }>(
        `${import.meta.env.VITE_API_URL}/admin/iam/users/${selectedMember.id}/roles`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleCodes: selectedRoleCodes }),
        },
      );

      closeRoleModal();
      setNotice(`已更新 ${selectedMember.email} 的角色绑定。`);
      if (payload.warnings && payload.warnings.length > 0) {
        setModalWarnings(payload.warnings);
      }
      await fetchMembers();
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setModalError('权限不足，无法更新角色。');
      } else {
        setModalError(err instanceof Error ? err.message : 'Failed to update roles.');
      }
    } finally {
      setSavingRoles(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Members</h1>
          <p className="text-sm text-gray-500 mt-1">
            成员管理页：创建成员、查看成员、多角色绑定。
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canCreateMember && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm hover:bg-black transition-colors"
            >
              <Plus size={16} />
              Create Member
            </button>
          )}
          <button
            onClick={() => {
              void refreshData();
            }}
            className="p-2 text-gray-500 hover:text-brand-primary transition-colors"
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

      {modalWarnings.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          {modalWarnings.join(' | ')}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by email or userNo..."
              className="w-full pl-10 pr-4 py-2 bg-admin-content-bg border border-admin-border rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 transition-all duration-200"
            />
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

                  return (
                    <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{member.email}</div>
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
                        {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canAssignRoles ? (
                          <button
                            onClick={() => {
                              void openRoleModal(member);
                            }}
                            className="text-xs px-3 py-1.5 rounded-md border border-admin-border hover:bg-admin-content-bg"
                          >
                            Assign Roles
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">No edit permission</span>
                        )}
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

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-admin-border overflow-hidden">
            <div className="px-5 py-4 border-b border-admin-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Create Member</h3>
                <p className="text-xs text-gray-500 mt-1">初始密码固定为 123456</p>
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

              {createError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={closeCreateModal}
                className="px-4 py-2 text-sm border border-admin-border rounded-md hover:bg-admin-content-bg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitCreateMember();
                }}
                disabled={creatingMember}
                className="px-4 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-60"
              >
                {creatingMember ? 'Creating...' : 'Create'}
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
                <h3 className="font-semibold text-gray-900">Assign Roles</h3>
                <p className="text-xs text-gray-500 mt-1">{selectedMember?.email || '-'}</p>
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

              {modalError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={closeRoleModal}
                className="px-4 py-2 text-sm border border-admin-border rounded-md hover:bg-admin-content-bg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitRoleChanges();
                }}
                disabled={savingRoles || !canAssignRoles || modalLoading}
                className="px-4 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-60"
              >
                {savingRoles ? 'Saving...' : 'Save Roles'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformMembers;

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { AdminPermissionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

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

const RoleManagement = () => {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [expandedRoleCodes, setExpandedRoleCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoles = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/iam/roles`);
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load roles.'));
      }

      const payload = (await response.json()) as RoleItem[];
      setRoles(payload);
      setExpandedRoleCodes(payload.map((role) => role.code));
    } catch (err) {
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view the role catalog.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load roles.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRoles();
  }, []);

  const totalPermissions = useMemo(
    () =>
      roles.reduce((sum, role) => {
        return sum + role.permissions.length;
      }, 0),
    [roles],
  );

  const toggleRole = (code: string) => {
    setExpandedRoleCodes((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }
      return [...current, code];
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Read-only catalog of fixed system roles and their bound API permissions.
          </p>
        </div>
        <button
          onClick={() => {
            void loadRoles();
          }}
          className="p-2 text-gray-500 hover:text-brand-primary transition-colors"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-admin-border bg-white p-4">
          <div className="text-xs text-gray-500">Roles</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{roles.length}</div>
        </div>
        <div className="rounded-xl border border-admin-border bg-white p-4">
          <div className="text-xs text-gray-500">Permission Bindings</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{totalPermissions}</div>
        </div>
        <div className="rounded-xl border border-admin-border bg-white p-4">
          <div className="text-xs text-gray-500">Catalog Type</div>
          <div className="mt-2 text-sm font-semibold text-gray-800">Fixed Backend Catalog</div>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="rounded-xl border border-admin-border bg-white p-8 text-center text-gray-500">
            Loading roles...
          </div>
        ) : roles.length === 0 ? (
          <div className="rounded-xl border border-admin-border bg-white p-8 text-center text-gray-500">
            No roles found.
          </div>
        ) : (
          roles.map((role) => {
            const expanded = expandedRoleCodes.includes(role.code);
            return (
              <div
                key={role.id}
                className="rounded-xl border border-admin-border bg-white overflow-hidden"
              >
                <button
                  onClick={() => toggleRole(role.code)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-admin-content-bg transition-colors"
                >
                  <div className="flex items-center gap-3 text-left">
                    <ShieldCheck size={16} className="text-brand-primary shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{role.code}</span>
                        <span className="text-xs text-gray-500">{role.name}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            role.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {role.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {role.description || '-'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{role.permissions.length} permissions</span>
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-admin-border overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-admin-content-bg">
                        <tr>
                          <th className="px-4 py-2 text-left text-gray-500 uppercase tracking-wider">
                            Code
                          </th>
                          <th className="px-4 py-2 text-left text-gray-500 uppercase tracking-wider">
                            Method
                          </th>
                          <th className="px-4 py-2 text-left text-gray-500 uppercase tracking-wider">
                            Path
                          </th>
                          <th className="px-4 py-2 text-left text-gray-500 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-4 py-2 text-left text-gray-500 uppercase tracking-wider">
                            Description
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-admin-border">
                        {role.permissions.map((permission) => (
                          <tr key={permission.code}>
                            <td className="px-4 py-2 font-mono text-gray-700">
                              {permission.code}
                            </td>
                            <td className="px-4 py-2 text-gray-700">{permission.method}</td>
                            <td className="px-4 py-2 font-mono text-gray-500">{permission.path}</td>
                            <td className="px-4 py-2 text-gray-700">{permission.name}</td>
                            <td className="px-4 py-2 text-gray-500">
                              {permission.description || '-'}
                            </td>
                          </tr>
                        ))}
                        {role.permissions.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-4 text-center text-gray-500">
                              No permissions bound.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RoleManagement;
